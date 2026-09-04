import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ArchiveJobManager } from "./archive-job-manager";
import { ArchiveJobStore, atomicWrite } from "./archive-job-store";
import { archiveItemSchema, mediaUrlSchema, mergeItems, type ArchiveEvent } from "./archive-job-types";
import type { ArchiveRunner } from "./archive-job-runner";

const managers: ArchiveJobManager[] = [];
afterEach(() => { for (const m of managers) m.dispose(); managers.length = 0; vi.restoreAllMocks(); });
const item = (id = "1", username = "example") => archiveItemSchema.parse({ id: `${id}:m${id}`, postId: id,
  postUrl: `https://x.com/${username}/status/${id}`, postText: "Video", createdAt: "2026-09-01T12:00:00.000Z",
  media: { mediaKey: `m${id}`, type: "video", previewImageUrl: "https://pbs.twimg.com/thumb.jpg", variants: [{ url: "https://video.twimg.com/test.mp4", contentType: "video/mp4" }] } });
const batch = (ids = ["1"]): ArchiveEvent => ({ type: "batch", items: ids.map((id) => item(id)), postsScanned: ids.length, batchesRead: 1 });
async function setup(events: ArchiveEvent[] | ArchiveRunner, now = () => Date.now()) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "signaldesk-jobs-"));
  const store = new ArchiveJobStore(directory, path.join(directory, "legacy"));
  const runner: ArchiveRunner = typeof events === "function" ? events : async function* () { for (const event of events) yield event; };
  const manager = new ArchiveJobManager(store, runner, now, async () => [], false);
  managers.push(manager); await manager.init();
  return { manager, store, directory, runner };
}
describe("durable anonymous collection", () => {
  it("opens a saved account without rewriting disk, creating jobs, or starting a worker", async () => {
    const { manager, store } = await setup([batch(), { type: "done", reason: "exhausted" }]);
    const first = await manager.create("example"); await manager.pump();
    const writes = vi.spyOn(store, "save");
    for (let n = 0; n < 5; n++) {
      const saved = await manager.create("example");
      expect(saved.job.id).toBe(first.job.id); expect(saved.source).toBe("saved");
      expect(saved.result.items).toHaveLength(1); expect(saved.job.newItems).toBe(0);
    }
    expect(writes).not.toHaveBeenCalled(); expect((await manager.list()).jobs).toHaveLength(1);
    const fresh = await manager.create("example", true);
    expect(fresh.job.id).not.toBe(first.job.id); expect(writes).toHaveBeenCalledOnce();
  });
  it("notifies live viewers only after persistence and isolates disconnected listeners", async () => {
    const { manager, store } = await setup([]);
    let finish!: () => void;
    const writing = new Promise<void>(resolve => { finish = resolve; });
    vi.spyOn(store, "save").mockImplementation(async () => { await writing; });
    const listener = vi.fn();
    const unsubscribe = manager.subscribe(listener);
    manager.subscribe(() => { throw Error("Viewer disconnected"); });
    const first = manager.create("example");
    await vi.waitFor(() => expect(store.save).toHaveBeenCalled());
    expect(listener).not.toHaveBeenCalled(); finish(); await first;
    expect(listener).toHaveBeenCalledOnce(); unsubscribe();
    await manager.create("ordinary"); expect(listener).toHaveBeenCalledOnce();
  });
  it("continues without a ten-second wait while giving a new account priority", async () => {
    const checkpoint = { provider: "fxtwitter" as const, username: "example", userId: "123", displayName: "Example", cursor: "next", seenPostIds: ["1"], batchesRead: 1 };
    const calls: string[] = [];
    const { manager } = await setup(async function* (username, _signal, resume) {
      calls.push(username);
      if (username === "example" && !resume) { yield batch(); yield { type: "checkpoint", checkpoint }; yield { type: "done", reason: "yield" }; }
      else yield { type: "done", reason: "exhausted" };
    });
    const first = await manager.create("example"); await manager.pump();
    expect((await manager.get(first.job.id)).job.retryAt).toBeUndefined();
    await manager.create("ordinary"); await manager.pump(); await manager.pump();
    expect(calls).toEqual(["example", "ordinary", "example"]);
    expect((await manager.get(first.job.id)).job.status).toBe("partial");
  });
  it("persists incremental media, deduplicates, rejects wrong authors, and keeps richer previous collections", async () => {
    let pass = 0;
    const { manager, store } = await setup(async function* () {
      pass++;
      yield { type: "profile", username: "example", displayName: "Example" };
      yield pass === 1 ? { ...batch(), type: "batch", items: [item("1"), item("1"), item("2"), item("3", "stranger")], postsScanned: 4, batchesRead: 1 } : batch();
      yield { type: "done", reason: "exhausted" };
    });
    const first = await manager.create("@Example"); await manager.pump();
    expect((await manager.get(first.job.id)).result.items).toHaveLength(2);
    expect((await store.load()).accounts.example.items).toHaveLength(2);
    const second = await manager.retry(first.job.id); await manager.pump();
    expect((await manager.get(second.job.id)).result.items).toHaveLength(2);
    expect((await manager.get(second.job.id)).result.complete).toBe(false);
    expect((await manager.create("example")).source).toBe("saved");
  });
  it("shares an active job for repeated submissions and runs only one worker", async () => {
    let finish!: () => void;
    const hold = new Promise<void>((resolve) => { finish = resolve; });
    let runs = 0;
    const { manager } = await setup(async function* () { runs++; yield batch(); await hold; yield { type: "done", reason: "exhausted" }; });
    const [a, b] = await Promise.all([manager.create("example"), manager.create("example")]);
    expect(a.job.id).toBe(b.job.id);
    const pumping = manager.pump();
    await vi.waitFor(() => expect(runs).toBe(1));
    await manager.pump(); expect(runs).toBe(1);
    finish(); await pumping;
  });
  it("keeps media during rate limits and enforces global cooldown and three retries", async () => {
    let now = Date.now();
    const { manager } = await setup([batch(), { type: "done", reason: "rate_limit", retryAt: now + 3_600_000 }], () => now);
    const first = await manager.create("example"); await manager.pump();
    let view = await manager.get(first.job.id);
    expect(view.job.status).toBe("waiting"); expect(view.result.items).toHaveLength(1);
    expect(view.job.retryAt).toBe(now + 3_600_000);
    await manager.pump(); expect((await manager.get(first.job.id)).job.retries).toBe(1);
    for (let n = 0; n < 3; n++) { now += 3_600_001; await manager.pump(); }
    view = await manager.get(first.job.id);
    expect(view.job.status).toBe("partial"); expect(view.job.retries).toBe(3);
    expect(view.job.message).toContain("exhausted");
    const next = await manager.retry(first.job.id); await manager.pump();
    const cooling = await manager.get(next.job.id);
    expect(cooling.job.status).toBe("waiting");
    expect(cooling.job.retryAt).toBeGreaterThan(now);
    expect(cooling.job.retries).toBe(0);
  });
  it("cancels a running worker while preserving its last batch", async () => {
    const { manager } = await setup(async function* (_name, signal) {
      yield batch(); await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      yield { type: "done", reason: "exhausted" };
    });
    const view = await manager.create("example"); const running = manager.pump();
    await vi.waitFor(async () => expect((await manager.get(view.job.id)).result.items).toHaveLength(1));
    await manager.cancel(view.job.id); await running;
    expect((await manager.get(view.job.id)).job.status).toBe("cancelled");
    expect((await manager.get(view.job.id)).result.items).toHaveLength(1);
  });
  it("recovers interrupted jobs from disk and retains items across a restart", async () => {
    const { manager, store, runner } = await setup([batch(), { type: "done", reason: "exhausted" }]);
    const first = await manager.create("example"); await manager.pump(); manager.dispose();
    const state = await store.load(); state.jobs[first.job.id].status = "running"; await store.save(state);
    const recovered = new ArchiveJobManager(store, runner, Date.now, async () => [], false); managers.push(recovered); await recovered.init();
    expect((await recovered.get(first.job.id)).result.items).toHaveLength(1);
    await recovered.pump();
    expect((await recovered.get(first.job.id)).result.items).toHaveLength(1);
    expect((await recovered.get(first.job.id)).job.status).toBe("partial");
  });
  it("imports valid guest cache once, ignores credentials and preserves malformed originals", async () => {
    const { manager, store, directory } = await setup([]); manager.dispose();
    const fresh = new ArchiveJobStore(path.join(directory, "fresh"), store.legacyDirectory);
    await mkdir(store.legacyDirectory);
    await writeFile(path.join(store.legacyDirectory, "example.json"), JSON.stringify({ fetchedAt: Date.now(), result: { access: "guest", username: "example", displayName: "Example", items: [item()], postsScanned: 1, pagesFetched: 1 } }));
    await writeFile(path.join(store.legacyDirectory, "broken.json"), "not json");
    const state = await fresh.load(); expect(state.accounts.example.items).toHaveLength(1); expect(state.accounts.broken).toBeUndefined();
    await fresh.save(state); expect((await fresh.load()).accounts.example.items).toHaveLength(1);
    expect(await readFile(path.join(store.legacyDirectory, "broken.json"), "utf8")).toBe("not json");
  });
  it("preserves a corrupt state file and ignores interrupted temporary writes", async () => {
    const { manager, store, directory } = await setup([]); manager.dispose();
    await writeFile(store.file + ".interrupted.tmp", "{unfinished");
    expect((await store.load()).version).toBe(1);
    await writeFile(store.file, "broken");
    await expect(store.load()).rejects.toThrow("preserved");
    expect(await readFile(store.file, "utf8")).toBe("broken");
    await atomicWrite(path.join(directory, "atomic.json"), { ok: true });
    expect((await readdir(directory)).filter((name) => name.startsWith("atomic.json."))).toHaveLength(0);
  });
  it("reports storage failure without overwriting the last saved collection", async () => {
    const { manager, store } = await setup([batch(), { type: "done", reason: "exhausted" }]);
    const view = await manager.create("example"); await manager.pump();
    vi.spyOn(store, "save").mockRejectedValue(new Error("Disk full"));
    await expect(manager.retry(view.job.id)).rejects.toThrow("disk");
    const kept = await manager.get(view.job.id);
    expect(kept.result.items).toHaveLength(1); expect(kept.job.status).toBe("failed");
  });
  it("keeps video variants when a refresh omits them and rejects unsafe URLs", () => {
    const original = item();
    expect(mergeItems([original], [{ ...original, media: { ...original.media, variants: [] } }])[0].media.variants).toHaveLength(1);
    for (const url of ["javascript:alert(1)", "http://127.0.0.1/a", "https://video.twimg.com.evil.test/a", "https://secret@video.twimg.com/a"]) expect(mediaUrlSchema.safeParse(url).success).toBe(false);
  });
  it("distinguishes unavailable accounts from empty public collections", async () => {
    const { manager } = await setup([{ type: "done", reason: "unavailable" }]);
    const view = await manager.create("missing"); await manager.pump();
    expect((await manager.get(view.job.id)).job.status).toBe("unavailable");
    await expect(manager.create("../escape")).rejects.toThrow();
    await expect(manager.get("../../escape")).rejects.toThrow();
  });
  it("automatically processes queued jobs and lists the saved account", async () => {
    const { manager, store, runner } = await setup([batch(), { type: "done", reason: "exhausted" }]); manager.dispose();
    const automatic = new ArchiveJobManager(store, runner, Date.now, async () => []); managers.push(automatic);
    const job = await automatic.create("example");
    await vi.waitFor(async () => expect((await automatic.get(job.job.id)).job.status).toBe("partial"), { timeout: 8000 });
    expect((await automatic.list()).accounts[0]).toMatchObject({ username: "example", count: 1 });
    await automatic.cancel(job.job.id);
    expect((await automatic.get(job.job.id)).job.status).toBe("partial");
  });
  it("repairs missing links and refuses unknown saved posts", async () => {
    const missing = item(); missing.media.variants = [];
    const { manager, store } = await setup([]); manager.dispose();
    const repair = vi.fn().mockResolvedValue([item()]);
    const repairs = new ArchiveJobManager(store, async function* () { yield { ...batch(), type: "batch", items: [missing], postsScanned: 1, batchesRead: 1 }; yield { type: "done", reason: "exhausted" }; }, Date.now, repair, false);
    managers.push(repairs); const job = await repairs.create("example"); await repairs.pump();
    expect(repair).toHaveBeenCalled(); expect((await repairs.get(job.job.id)).result.items[0].media.variants).toHaveLength(1);
    await expect(repairs.repair(job.job.id, "2")).rejects.toThrow("not in");
    repair.mockResolvedValue([]); await expect(repairs.repair(job.job.id, "1")).rejects.toThrow("could not be refreshed");
  });
  it("bounds the queue and rejects unknown job IDs", async () => {
    const { manager } = await setup([]);
    for (let n = 0; n < 25; n++) await manager.create(`account${n}`);
    await expect(manager.create("overflow")).rejects.toThrow("queue is full");
    await expect(manager.get("c3ab4e8f-414a-4ea1-91b6-a591f8d4ab45")).rejects.toThrow("not found");
  });
  it("treats thrown worker errors as retryable and cannot mix profile identities", async () => {
    const { manager } = await setup(async function* () { yield { type: "profile", username: "wrong", displayName: "Wrong" }; });
    const job = await manager.create("example"); await manager.pump();
    expect((await manager.get(job.job.id)).job.status).toBe("waiting");
    expect((await manager.get(job.job.id)).result.displayName).toBe("example");
  });
  it("prioritizes an untried account over an older retry after a shared rate limit", async () => {
    let now = Date.now(); const calls: string[] = [];
    const { manager } = await setup(async function* (name) {
      calls.push(name); yield { type: "done", reason: name === "large" ? "rate_limit" : "exhausted" };
    }, () => now);
    await manager.create("large"); await manager.pump();
    await manager.create("ordinary"); now += 900001; await manager.pump();
    expect(calls).toEqual(["large", "ordinary"]);
  });
  it("does not let one account's network error block another account", async () => {
    const calls: string[] = [];
    const { manager } = await setup(async function* (name) {
      calls.push(name); yield { type: "done", reason: name === "broken" ? "timeout" : "exhausted" };
    });
    await manager.create("broken"); await manager.pump();
    await manager.create("ordinary"); await manager.pump();
    expect(calls).toEqual(["broken", "ordinary"]);
    expect((await manager.list()).accounts).toHaveLength(0);
  });
  it("persists page checkpoints and resumes the same job without resetting progress", async () => {
    let now = Date.now(); let pass = 0;
    const checkpoint = { username: "example", userId: "123", displayName: "Example", cursor: "page-two", seenPostIds: ["1"], batchesRead: 1 };
    const { manager, store, runner } = await setup(async function* (_name, _signal, resume) {
      if (pass++ === 0) { yield batch(); yield { type: "checkpoint", checkpoint }; yield { type: "done", reason: "yield" }; }
      else { expect(resume).toEqual(checkpoint); yield batch(["1", "2"]); yield { type: "done", reason: "exhausted" }; }
    }, () => now);
    const first = await manager.create("example"); await manager.pump();
    expect((await manager.get(first.job.id)).job).toMatchObject({ status: "queued", retries: 0, newItems: 1 });
    expect((await store.load()).jobs[first.job.id].checkpoint).toEqual(checkpoint);
    manager.dispose(); now += 10001;
    const recovered = new ArchiveJobManager(store, runner, () => now, async () => [], false); managers.push(recovered);
    await recovered.pump();
    const result = await recovered.get(first.job.id);
    expect(result.result.items).toHaveLength(2); expect(result.job.newItems).toBe(2);
    expect(result.job.checkpoint).toBeUndefined();
  });
  it("wakes a new search immediately while another account has a future retry", async () => {
    const { manager, store } = await setup([{ type: "done", reason: "timeout" }]);
    await manager.create("broken"); await manager.pump(); manager.dispose();
    const calls: string[] = [];
    const automatic = new ArchiveJobManager(store, async function* (name) { calls.push(name); yield { type: "done", reason: "exhausted" }; }, Date.now, async () => []);
    managers.push(automatic); await automatic.init(); await automatic.pump();
    await automatic.create("ordinary");
    await vi.waitFor(() => expect(calls).toEqual(["ordinary"]), { timeout: 5000 });
  });
  it("keeps the page position when a stopped collection is continued manually", async () => {
    const checkpoint = { username: "example", userId: "123", displayName: "Example", cursor: "page-two", seenPostIds: ["1"], batchesRead: 1 };
    const { manager } = await setup([batch(), { type: "checkpoint", checkpoint }, { type: "done", reason: "yield" }]);
    const job = await manager.create("example"); await manager.pump(); await manager.cancel(job.job.id);
    const resumed = await manager.retry(job.job.id);
    expect(resumed.job.id).not.toBe(job.job.id);
    expect(resumed.job.checkpoint).toEqual(checkpoint); expect(resumed.job.postsScanned).toBe(1);
  });
});
