import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type {
  ProviderAccount,
  ProviderTweet,
  TrackerState,
  TrackedAccount,
  TrackedTweet,
  XDataProvider,
} from "./types";

const originalDataFile = process.env.TRACKER_DATA_FILE;
const originalToken = process.env.X_BEARER_TOKEN;
const temporaryDirectories: string[] = [];

function nowIso(): string {
  return new Date().toISOString();
}

function providerAccount(
  username: string,
  xUserId = `x-${username}`,
): ProviderAccount {
  return {
    source: "x",
    xUserId,
    username,
    displayName: `Display ${username}`,
    bio: "AI and software",
    followersCount: 10_000,
    followingCount: 100,
    tweetCount: 500,
    verified: false,
  };
}

function trackedAccount(
  username: string,
  overrides: Partial<TrackedAccount> = {},
): TrackedAccount {
  const source = providerAccount(username, overrides.xUserId);
  return {
    ...source,
    id: `account-${source.xUserId}`,
    active: true,
    manualNiches: [],
    inferredNiches: ["AI & Tech"],
    nicheConfidence: { "AI & Tech": 90 },
    addedAt: nowIso(),
    lastSyncedAt: nowIso(),
    syncStatus: "ready",
    ...overrides,
    source: overrides.source ?? "x",
  };
}

function providerTweet(
  id: string,
  overrides: Partial<ProviderTweet> = {},
): ProviderTweet {
  return {
    id,
    text: "A practical AI workflow.",
    createdAt: new Date(Date.now() - 60 * 60 * 1_000).toISOString(),
    language: "en",
    conversationId: id,
    possiblySensitive: false,
    metrics: {
      likeCount: 100,
      repostCount: 10,
      replyCount: 5,
      quoteCount: 2,
      bookmarkCount: 3,
    },
    ...overrides,
    source: overrides.source ?? "x",
  };
}

function trackedTweet(account: TrackedAccount, id: string): TrackedTweet {
  const post = providerTweet(id);
  const observedAt = nowIso();
  return {
    ...post,
    accountId: account.id,
    authorUsername: account.username,
    authorDisplayName: account.displayName,
    authorFollowersCount: account.followersCount,
    url: `https://x.com/${account.username}/status/${id}`,
    niches: ["AI & Tech"],
    snapshots: [{ observedAt, metrics: post.metrics }],
    viralityScore: 50,
    replyScore: 50,
    confidence: 50,
    stage: "baseline",
    scoreReasons: [],
    replyReasons: [],
    riskFlags: [],
    workflowStatus: "new",
    firstSeenAt: observedAt,
    lastSeenAt: observedAt,
  };
}

function state(
  accounts: TrackedAccount[] = [],
  tweets: TrackedTweet[] = [],
): TrackerState {
  return {
    version: 2,
    accounts,
    tweets,
    createdAt: nowIso(),
    lastSyncedAt: "2026-08-01T00:00:00.000Z",
  };
}

function fakeProvider() {
  const resolveAccount = vi.fn(async (username: string) =>
    providerAccount(username),
  );
  const refreshAccount = vi.fn(async (account: ProviderAccount) =>
    providerAccount(account.username, account.xUserId),
  );
  const fetchRecentTweets = vi.fn(async (account: ProviderAccount) => [
    providerTweet(`${account.xUserId}-post`),
  ]);
  const provider: XDataProvider = {
    mode: "x",
    resolveAccount,
    refreshAccount,
    fetchRecentTweets,
  };
  return { provider, resolveAccount, refreshAccount, fetchRecentTweets };
}

async function loadHarness(initialState: TrackerState, provider: XDataProvider) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "signaldesk-service-"));
  temporaryDirectories.push(directory);
  process.env.TRACKER_DATA_FILE = path.join(directory, "state.json");
  process.env.X_BEARER_TOKEN = "test-token";
  vi.resetModules();

  const providerModule = await import("./provider");
  providerModule.setProviderForTests(provider);
  const store = await import("./store");
  await store.replaceTrackerState(initialState);
  const service = await import("./service");
  return { service, store };
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
  vi.resetModules();
});

describe.sequential("tracker service integrity", () => {
  it(
    "rejects known duplicate and full-watchlist additions before provider work",
    async () => {
      const existing = trackedAccount("existing");
      const fake = fakeProvider();
      const duplicateHarness = await loadHarness(state([existing]), fake.provider);

      await expect(
        duplicateHarness.service.addTrackedAccount({ username: "@Existing" }),
      ).rejects.toMatchObject({ status: 409 });
      expect(fake.resolveAccount).not.toHaveBeenCalled();
      expect(fake.fetchRecentTweets).not.toHaveBeenCalled();

      const fullAccounts = Array.from({ length: 25 }, (_, index) =>
        trackedAccount(`user${index}`),
      );
      const fullFake = fakeProvider();
      const fullHarness = await loadHarness(state(fullAccounts), fullFake.provider);

      await expect(
        fullHarness.service.addTrackedAccount({ username: "another" }),
      ).rejects.toMatchObject({ status: 409 });
      expect(fullFake.resolveAccount).not.toHaveBeenCalled();
      expect(fullFake.fetchRecentTweets).not.toHaveBeenCalled();
    },
    15_000,
  );

  it("rejects an alias resolving to an existing X user before fetching posts", async () => {
    const existing = trackedAccount("canonical", { xUserId: "x-42" });
    const fake = fakeProvider();
    fake.resolveAccount.mockResolvedValue(
      providerAccount("canonical", existing.xUserId),
    );
    const { service } = await loadHarness(state([existing]), fake.provider);

    await expect(
      service.addTrackedAccount({ username: "alias" }),
    ).rejects.toMatchObject({ status: 409 });
    expect(fake.resolveAccount).toHaveBeenCalledTimes(1);
    expect(fake.fetchRecentTweets).not.toHaveBeenCalled();
  });

  it("keeps immutable identity when an ID refresh returns a mismatch", async () => {
    const existing = trackedAccount("original", { xUserId: "x-original" });
    const oldPost = trackedTweet(existing, "old-post");
    const fake = fakeProvider();
    fake.refreshAccount.mockResolvedValue(
      providerAccount("original", "x-different-person"),
    );
    const { service, store } = await loadHarness(
      state([existing], [oldPost]),
      fake.provider,
    );

    const report = await service.syncTrackedAccounts();
    const persisted = await store.readTrackerState();

    expect(report).toMatchObject({
      outcome: "failed",
      attempted: 1,
      succeeded: 0,
      failed: 1,
    });
    expect(fake.fetchRecentTweets).not.toHaveBeenCalled();
    expect(persisted.lastSyncedAt).toBe("2026-08-01T00:00:00.000Z");
    expect(persisted.accounts[0]).toMatchObject({
      id: existing.id,
      xUserId: existing.xUserId,
      displayName: existing.displayName,
      syncStatus: "error",
    });
    expect(persisted.tweets.map((tweet) => tweet.id)).toEqual(["old-post"]);
  });

  it("refreshes a renamed account by immutable X user ID", async () => {
    const existing = trackedAccount("oldhandle", { xUserId: "x-stable" });
    const oldPost = trackedTweet(existing, "old-post");
    const fake = fakeProvider();
    fake.refreshAccount.mockResolvedValue(
      providerAccount("newhandle", existing.xUserId),
    );
    fake.fetchRecentTweets.mockResolvedValue([providerTweet("new-post")]);
    const { service, store } = await loadHarness(
      state([existing], [oldPost]),
      fake.provider,
    );

    const report = await service.syncTrackedAccounts();
    const persisted = await store.readTrackerState();

    expect(report).toMatchObject({ outcome: "success", succeeded: 1 });
    expect(fake.resolveAccount).not.toHaveBeenCalled();
    expect(fake.refreshAccount).toHaveBeenCalledWith(
      expect.objectContaining({ xUserId: "x-stable", username: "oldhandle" }),
    );
    expect(persisted.accounts[0]).toMatchObject({
      id: existing.id,
      xUserId: "x-stable",
      username: "newhandle",
    });
    expect(persisted.tweets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "old-post",
          authorUsername: "newhandle",
          url: "https://x.com/newhandle/status/old-post",
        }),
        expect.objectContaining({
          id: "new-post",
          authorUsername: "newhandle",
        }),
      ]),
    );
  });

  it("reports partial results and advances time only when something succeeds", async () => {
    const good = trackedAccount("good");
    const bad = trackedAccount("bad");
    const fake = fakeProvider();
    fake.refreshAccount.mockImplementation(async (account) => {
      if (account.username === "bad") throw new Error("Upstream unavailable");
      return providerAccount(account.username, account.xUserId);
    });
    const { service, store } = await loadHarness(
      state([good, bad]),
      fake.provider,
    );

    const report = await service.syncTrackedAccounts();
    const persisted = await store.readTrackerState();

    expect(report).toMatchObject({
      outcome: "partial",
      attempted: 2,
      succeeded: 1,
      failed: 1,
    });
    expect(persisted.lastSyncedAt).not.toBe("2026-08-01T00:00:00.000Z");
    expect(
      persisted.accounts.find((account) => account.id === bad.id),
    ).toMatchObject({ syncStatus: "error", syncError: "Upstream unavailable" });
  });

  it("reports a no-op without advancing time when no account is active", async () => {
    const paused = trackedAccount("paused", { active: false });
    const fake = fakeProvider();
    const { service, store } = await loadHarness(state([paused]), fake.provider);

    const report = await service.syncTrackedAccounts();

    expect(report).toMatchObject({ outcome: "noop", attempted: 0 });
    expect((await store.readTrackerState()).lastSyncedAt).toBe(
      "2026-08-01T00:00:00.000Z",
    );
    expect(fake.refreshAccount).not.toHaveBeenCalled();
  });

  it("rejects unknown, inactive, empty, and duplicate selections before network work", async () => {
    const active = trackedAccount("active");
    const paused = trackedAccount("paused", { active: false });
    const fake = fakeProvider();
    const { service } = await loadHarness(
      state([active, paused]),
      fake.provider,
    );

    await expect(service.syncTrackedAccounts([])).rejects.toMatchObject({
      status: 422,
    });
    await expect(
      service.syncTrackedAccounts(["missing"]),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      service.syncTrackedAccounts([paused.id]),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.syncTrackedAccounts([active.id, active.id]),
    ).rejects.toMatchObject({ status: 422 });
    expect(fake.refreshAccount).not.toHaveBeenCalled();
  });

  it("preserves a post creation timestamp across same-ID syncs", async () => {
    const existing = trackedAccount("stable");
    const oldPost = trackedTweet(existing, "stable-post");
    const originalCreatedAt = oldPost.createdAt;
    const fake = fakeProvider();
    fake.fetchRecentTweets.mockResolvedValue([
      providerTweet("stable-post", {
        createdAt: new Date().toISOString(),
        metrics: { ...oldPost.metrics, likeCount: 250 },
      }),
    ]);
    const { service } = await loadHarness(
      state([existing], [oldPost]),
      fake.provider,
    );

    const report = await service.syncTrackedAccounts();

    expect(report.snapshot.tweets[0].createdAt).toBe(originalCreatedAt);
    expect(report.snapshot.tweets[0].metrics.likeCount).toBe(250);
  });

  it("shares the sync queue across separate module instances", async () => {
    const existing = trackedAccount("sharedqueue");
    let firstFetchStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      firstFetchStarted = resolve;
    });
    let releaseFirstFetch!: () => void;
    const release = new Promise<void>((resolve) => {
      releaseFirstFetch = resolve;
    });
    let fetchCount = 0;
    const fake = fakeProvider();
    fake.fetchRecentTweets.mockImplementation(async () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        firstFetchStarted();
        await release;
      }
      return [providerTweet(`queued-post-${fetchCount}`)];
    });
    const firstHarness = await loadHarness(state([existing]), fake.provider);

    const firstSync = firstHarness.service.syncTrackedAccounts();
    await started;
    vi.resetModules();
    const providerModule = await import("./provider");
    providerModule.setProviderForTests(fake.provider);
    const secondService = await import("./service");
    const secondSync = secondService.syncTrackedAccounts();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(fetchCount).toBe(1);
    releaseFirstFetch();
    const [firstReport, secondReport] = await Promise.all([
      firstSync,
      secondSync,
    ]);
    expect(fetchCount).toBe(2);
    expect(firstReport.succeeded).toBe(1);
    expect(secondReport.succeeded).toBe(1);
  });

  it("limits provider concurrency while allowing account edits during fetch", async () => {
    const accounts = Array.from({ length: 6 }, (_, index) =>
      trackedAccount(`limit${index}`),
    );
    let activeFetches = 0;
    let maximumFetches = 0;
    let firstFetchStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      firstFetchStarted = resolve;
    });
    let releaseFetches!: () => void;
    const release = new Promise<void>((resolve) => {
      releaseFetches = resolve;
    });
    const fake = fakeProvider();
    fake.fetchRecentTweets.mockImplementation(async (account) => {
      activeFetches += 1;
      maximumFetches = Math.max(maximumFetches, activeFetches);
      firstFetchStarted();
      await release;
      activeFetches -= 1;
      return [providerTweet(`${account.xUserId}-post`)];
    });
    const { service } = await loadHarness(state(accounts), fake.provider);

    const sync = service.syncTrackedAccounts();
    await started;
    const updated = await Promise.race([
      service
        .updateTrackedAccount(accounts[0].id, {
          manualNiches: ["Research"],
        })
        .then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 100)),
    ]);
    expect(updated).toBe(true);
    releaseFetches();
    const report = await sync;

    expect(maximumFetches).toBe(3);
    expect(report.succeeded).toBe(6);
    expect(
      report.snapshot.accounts.find((account) => account.id === accounts[0].id)
        ?.manualNiches,
    ).toEqual(["Research"]);
  });

  it("does not resurrect an account deleted while its fetch is pending", async () => {
    const existing = trackedAccount("deleted");
    let fetchStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      fetchStarted = resolve;
    });
    let releaseFetch!: () => void;
    const release = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    const fake = fakeProvider();
    fake.fetchRecentTweets.mockImplementation(async () => {
      fetchStarted();
      await release;
      return [providerTweet("late-post")];
    });
    const { service, store } = await loadHarness(state([existing]), fake.provider);

    const sync = service.syncTrackedAccounts();
    await started;
    await service.removeTrackedAccount(existing.id);
    releaseFetch();
    const report = await sync;

    expect(report).toMatchObject({ outcome: "noop", skipped: 1, succeeded: 0 });
    expect((await store.readTrackerState()).accounts).toEqual([]);
  });

  it("does not let an old sync mutate a removed and re-added X user", async () => {
    const existing = trackedAccount("readded", { xUserId: "x-readded" });
    let firstFetchStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      firstFetchStarted = resolve;
    });
    let releaseFirstFetch!: () => void;
    const release = new Promise<void>((resolve) => {
      releaseFirstFetch = resolve;
    });
    let fetchCount = 0;
    const fake = fakeProvider();
    fake.resolveAccount.mockResolvedValue(
      providerAccount(existing.username, existing.xUserId),
    );
    fake.fetchRecentTweets.mockImplementation(async () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        firstFetchStarted();
        await release;
        return [providerTweet("stale-sync-post")];
      }
      return [providerTweet("replacement-post")];
    });
    const { service, store } = await loadHarness(state([existing]), fake.provider);

    const oldSync = service.syncTrackedAccounts();
    await started;
    await service.removeTrackedAccount(existing.id);
    const replacementSnapshot = await service.addTrackedAccount({
      username: existing.username,
    });
    const replacement = replacementSnapshot.accounts[0];
    releaseFirstFetch();
    const report = await oldSync;
    const persisted = await store.readTrackerState();

    expect(replacement.id).not.toBe(existing.id);
    expect(report).toMatchObject({
      outcome: "noop",
      succeeded: 0,
      failed: 0,
      skipped: 1,
    });
    expect(persisted.accounts).toEqual([
      expect.objectContaining({
        id: replacement.id,
        xUserId: existing.xUserId,
        syncStatus: "ready",
      }),
    ]);
    expect(persisted.tweets.map((tweet) => tweet.id)).toEqual([
      "replacement-post",
    ]);
  });

  it("serializes concurrent additions at the final identity check", async () => {
    const fake = fakeProvider();
    fake.resolveAccount.mockImplementation(async () =>
      providerAccount("canonical", "x-shared"),
    );
    const { service, store } = await loadHarness(state(), fake.provider);

    const results = await Promise.allSettled([
      service.addTrackedAccount({ username: "aliasone" }),
      service.addTrackedAccount({ username: "aliastwo" }),
    ]);
    const persisted = await store.readTrackerState();

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(
      1,
    );
    expect(persisted.accounts).toHaveLength(1);
    expect(new Set(persisted.accounts.map((account) => account.xUserId)).size).toBe(
      1,
    );
  });

  it("uses an inclusive retention cutoff", async () => {
    const existing = trackedAccount("retention");
    const reference = new Date("2026-08-23T12:00:00.000Z");
    const expired = trackedTweet(existing, "expired");
    expired.createdAt = "2026-07-24T11:59:59.999Z";
    const atCutoff = trackedTweet(existing, "at-cutoff");
    atCutoff.createdAt = "2026-07-24T12:00:00.000Z";
    const fresh = trackedTweet(existing, "fresh");
    fresh.createdAt = "2026-08-23T11:00:00.000Z";
    const fake = fakeProvider();
    const { service } = await loadHarness(
      state([existing], [expired, atCutoff, fresh]),
      fake.provider,
    );

    const pruned = service.pruneExpiredTweets(
      state([existing], [expired, atCutoff, fresh]),
      reference,
      30,
    );

    expect(pruned.tweets.map((tweet) => tweet.id)).toEqual([
      "at-cutoff",
      "fresh",
    ]);
  });

  it("enforces retention on an idle snapshot read and persists the removal", async () => {
    const existing = trackedAccount("idle");
    const expired = trackedTweet(existing, "expired-idle");
    expired.createdAt = new Date(
      Date.now() - 31 * 24 * 60 * 60 * 1_000,
    ).toISOString();
    const fresh = trackedTweet(existing, "fresh-idle");
    const fake = fakeProvider();
    const { service, store } = await loadHarness(
      state([existing], [expired, fresh]),
      fake.provider,
    );

    const snapshot = await service.getTrackerSnapshot();
    const persisted = await store.readTrackerState();

    expect(snapshot.tweets.map((tweet) => tweet.id)).toEqual(["fresh-idle"]);
    expect(persisted.tweets.map((tweet) => tweet.id)).toEqual(["fresh-idle"]);
  });
});
