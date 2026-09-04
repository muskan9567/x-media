import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: vi.fn(actual.readFile),
    rename: vi.fn(actual.rename),
    writeFile: vi.fn(actual.writeFile),
  };
});

import { createSeedState } from "./seed";

const originalDataFile = process.env.TRACKER_DATA_FILE;
const originalToken = process.env.X_BEARER_TOKEN;
const temporaryDirectories: string[] = [];

async function temporaryFile(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "signaldesk-store-"));
  temporaryDirectories.push(directory);
  return path.join(directory, "tracker-state.json");
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

async function legacyState() {
  const seeded = await createSeedState(
    new Date("2026-08-23T12:00:00.000Z"),
  );
  const legacy = structuredClone(seeded) as unknown as {
    version: number;
    accounts: Array<Record<string, unknown>>;
    tweets: Array<Record<string, unknown>>;
  };
  legacy.version = 1;
  legacy.accounts.forEach((account) => delete account.source);
  legacy.tweets.forEach((tweet) => delete tweet.source);
  return legacy;
}

async function loadStore(file: string, mode: "mock" | "x") {
  process.env.TRACKER_DATA_FILE = file;
  if (mode === "x") process.env.X_BEARER_TOKEN = "test-token";
  else delete process.env.X_BEARER_TOKEN;
  vi.resetModules();
  return import("./store");
}

afterEach(async () => {
  if (originalDataFile === undefined) delete process.env.TRACKER_DATA_FILE;
  else process.env.TRACKER_DATA_FILE = originalDataFile;
  if (originalToken === undefined) delete process.env.X_BEARER_TOKEN;
  else process.env.X_BEARER_TOKEN = originalToken;
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
  vi.clearAllMocks();
  vi.resetModules();
});

describe.sequential("tracker store", () => {
  it("initializes demo data only in mock mode", async () => {
    const file = await temporaryFile();
    const store = await loadStore(file, "mock");

    const state = await store.readTrackerState();

    expect(state.version).toBe(2);
    expect(state.accounts.length).toBeGreaterThan(0);
    expect(state.accounts.every((account) => account.source === "mock")).toBe(
      true,
    );
    expect(state.tweets.every((tweet) => tweet.source === "mock")).toBe(true);
  });

  it("initializes an empty state when the X provider is configured", async () => {
    const file = await temporaryFile();
    const store = await loadStore(file, "x");

    const state = await store.readTrackerState();

    expect(state).toMatchObject({ version: 2, accounts: [], tweets: [] });
    expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({
      version: 2,
      accounts: [],
      tweets: [],
    });
  });

  it("migrates legacy provenance once and persists version 2", async () => {
    const file = await temporaryFile();
    const legacy = await legacyState();
    await writeFile(file, JSON.stringify(legacy), "utf8");
    const store = await loadStore(file, "x");

    const state = await store.readTrackerState();

    expect(state.version).toBe(2);
    expect(state.accounts.every((account) => account.source === "mock")).toBe(
      true,
    );
    expect(JSON.parse(await readFile(file, "utf8")).version).toBe(2);
  });

  it("serializes operations across module instances per data path", async () => {
    const file = await temporaryFile();
    const otherFile = await temporaryFile();
    const firstStore = await loadStore(file, "x");
    const secondStore = await loadStore(file, "x");
    const otherStore = await loadStore(otherFile, "x");
    const firstEntered = deferred();
    const releaseFirst = deferred();

    const firstOperation = firstStore.updateTrackerState(async (state) => {
      firstEntered.resolve();
      await releaseFirst.promise;
      return [state, undefined];
    });
    await firstEntered.promise;

    let secondEntered = false;
    const secondOperation = secondStore.updateTrackerState((state) => {
      secondEntered = true;
      return [state, undefined];
    });

    await expect(otherStore.readTrackerState()).resolves.toMatchObject({
      version: 2,
      accounts: [],
    });
    const secondEnteredWhileFirstWasRunning = secondEntered;

    releaseFirst.resolve();
    await Promise.all([firstOperation, secondOperation]);

    expect(secondEnteredWhileFirstWasRunning).toBe(false);
    expect(secondEntered).toBe(true);
  });

  it("serializes concurrent reads that can migrate state", async () => {
    const file = await temporaryFile();
    await writeFile(file, JSON.stringify(await legacyState()), "utf8");
    const store = await loadStore(file, "x");
    const mockedFs = await import("node:fs/promises");
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
    const firstReadStarted = deferred();
    const releaseFirstRead = deferred();
    const readFileMock = vi.mocked(mockedFs.readFile);

    const delayedRead = async (
      target: Parameters<typeof mockedFs.readFile>[0],
    ) => {
      const contents = await actualFs.readFile(target, "utf8");
      firstReadStarted.resolve();
      await releaseFirstRead.promise;
      return contents;
    };
    readFileMock.mockImplementationOnce(delayedRead as typeof mockedFs.readFile);

    const firstRead = store.readTrackerState();
    await firstReadStarted.promise;
    const secondRead = store.readTrackerState();
    await new Promise<void>((resolve) => setImmediate(resolve));
    const readsBeforeRelease = readFileMock.mock.calls.length;

    releaseFirstRead.resolve();
    const states = await Promise.all([firstRead, secondRead]);

    expect(readsBeforeRelease).toBe(1);
    expect(states.every((state) => state.version === 2)).toBe(true);
    expect(JSON.parse(await readFile(file, "utf8")).version).toBe(2);
  });

  it("uses distinct temporary paths across module instances", async () => {
    const file = await temporaryFile();
    const firstStore = await loadStore(file, "x");
    const firstFs = await import("node:fs/promises");

    await firstStore.readTrackerState();
    const firstTemporaryPath = vi
      .mocked(firstFs.writeFile)
      .mock.calls.map(([target]) => String(target))
      .find((target) => target.startsWith(`${file}.tmp-`));

    vi.mocked(firstFs.writeFile).mockClear();
    await rm(file, { force: true });
    const secondStore = await loadStore(file, "x");
    const secondFs = await import("node:fs/promises");

    await secondStore.readTrackerState();
    const secondTemporaryPath = vi
      .mocked(secondFs.writeFile)
      .mock.calls.map(([target]) => String(target))
      .find((target) => target.startsWith(`${file}.tmp-`));

    expect(firstTemporaryPath).toBeDefined();
    expect(secondTemporaryPath).toBeDefined();
    expect(secondTemporaryPath).not.toBe(firstTemporaryPath);
  });

  it("propagates migration write failures without quarantining valid state", async () => {
    const file = await temporaryFile();
    const legacy = await legacyState();
    await writeFile(file, JSON.stringify(legacy), "utf8");
    const store = await loadStore(file, "x");
    const mockedFs = await import("node:fs/promises");
    const failure = Object.assign(new Error("disk full"), { code: "ENOSPC" });
    vi.mocked(mockedFs.writeFile).mockRejectedValueOnce(failure);

    await expect(store.readTrackerState()).rejects.toBe(failure);

    expect(JSON.parse(await readFile(file, "utf8")).version).toBe(1);
    expect(
      (await readdir(path.dirname(file))).some((name) =>
        name.includes(".corrupt-"),
      ),
    ).toBe(false);
  });

  it("propagates migration rename failures without quarantining valid state", async () => {
    const file = await temporaryFile();
    const legacy = await legacyState();
    await writeFile(file, JSON.stringify(legacy), "utf8");
    const store = await loadStore(file, "x");
    const mockedFs = await import("node:fs/promises");
    const failure = Object.assign(new Error("permission denied"), {
      code: "EACCES",
    });
    vi.mocked(mockedFs.rename).mockRejectedValueOnce(failure);

    await expect(store.readTrackerState()).rejects.toBe(failure);

    expect(JSON.parse(await readFile(file, "utf8")).version).toBe(1);
    expect(
      (await readdir(path.dirname(file))).some((name) =>
        name.includes(".corrupt-"),
      ),
    ).toBe(false);
  });

  it("quarantines malformed JSON and creates mode-appropriate state", async () => {
    const file = await temporaryFile();
    await writeFile(file, "{not-json", "utf8");
    const store = await loadStore(file, "x");

    const state = await store.readTrackerState();
    const siblingNames = await readdir(path.dirname(file));

    expect(state.accounts).toEqual([]);
    expect(siblingNames.some((name) => name.includes(".corrupt-"))).toBe(true);
  });

  it("quarantines invalid nested state", async () => {
    const file = await temporaryFile();
    const invalid = structuredClone(
      await createSeedState(new Date("2026-08-23T12:00:00.000Z")),
    ) as unknown as {
      tweets: Array<{ metrics: Record<string, unknown> }>;
    };
    invalid.tweets[0].metrics.likeCount = "many";
    await writeFile(file, JSON.stringify(invalid), "utf8");
    const store = await loadStore(file, "x");

    const state = await store.readTrackerState();
    const siblingNames = await readdir(path.dirname(file));

    expect(state.accounts).toEqual([]);
    expect(siblingNames.some((name) => name.includes(".corrupt-"))).toBe(true);
  });

  it("rejects invalid updater output without replacing valid data", async () => {
    const file = await temporaryFile();
    const store = await loadStore(file, "x");
    const original = await store.readTrackerState();

    await expect(
      store.updateTrackerState((state) => [
        { ...state, accounts: [{ id: "broken" }] } as never,
        undefined,
      ]),
    ).rejects.toThrow();

    expect(await store.readTrackerState()).toEqual(original);
  });

  it("propagates non-missing filesystem read errors without reseeding", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "signaldesk-store-directory-"),
    );
    temporaryDirectories.push(directory);
    const store = await loadStore(directory, "x");

    await expect(store.readTrackerState()).rejects.toMatchObject({
      code: expect.not.stringMatching(/^ENOENT$/),
    });
    expect(await readdir(directory)).toEqual([]);
  });
});
