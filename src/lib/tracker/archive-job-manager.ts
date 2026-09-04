import { randomUUID } from "node:crypto";
import { ApiError } from "../api-response";
import { emptyAccount, isActiveJob, jobIdSchema, mergeItems, usernameSchema, type ArchiveCheckpoint, type ArchiveEvent, type ArchiveJob, type ArchiveJobView, type ArchiveState } from "./archive-job-types";
import { ArchiveJobStore } from "./archive-job-store";
import { runArchiveWorker, type ArchiveRunner } from "./archive-job-runner";
import { resolvePostMedia } from "./archive-media-resolver";

const MESSAGES: Record<Extract<ArchiveEvent, { type: "done" }>["reason"], string> = {
  exhausted: "Collected the available public media. Older or unavailable posts may still be missing.",
  repeated: "X repeated earlier posts. All media found so far is saved.",
  limit: "Reached this run's 10,000-post limit. All media found so far is saved.",
  timeout: "Collection timed out. Saved media is still available.",
  rate_limit: "The public media source is limiting requests. Saved media is still available.",
  upstream: "X could not finish this request. Saved media is still available.",
  unavailable: "X did not make this account available anonymously. Check the username or try again later.",
  yield: "Progress saved. Continuing with the next page; new searches can run between batches.",
};
export class ArchiveJobManager {
  private state!: ArchiveState;
  private ready?: Promise<void>;
  private writes: Promise<unknown> = Promise.resolve();
  private timer?: ReturnType<typeof setTimeout>;
  private timerDue = Infinity;
  private controller?: AbortController;
  private active?: string;
  private pumping = false;
  private disposed = false;
  private storageError?: string;
  private listeners = new Set<() => void>();
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  private publish() {
    for (const listener of this.listeners) { try { listener(); } catch { /* A disconnected viewer cannot interrupt persistence. */ } }
  }
  constructor(private readonly store: ArchiveJobStore, private readonly runner: ArchiveRunner = runArchiveWorker,
    private readonly now: () => number = Date.now, private readonly resolver = resolvePostMedia, private readonly autoSchedule = true) {}
  init(): Promise<void> {
    this.ready ??= (async () => {
      this.state = await this.store.load();
      this.state.accounts = Object.assign(Object.create(null), this.state.accounts);
      for (const job of Object.values(this.state.jobs)) if (job.status === "running") {
        job.status = "queued"; job.message = "Resuming after a server restart. Previously found media is saved.";
      }
      await this.store.save(this.state);
      this.schedule();
    })();
    return this.ready;
  }
  private async change<T>(update: () => T): Promise<T> {
    const operation = this.writes.then(async () => {
      if (this.storageError) throw new ApiError(this.storageError, 503);
      const previous = structuredClone(this.state);
      const value = update();
      try { await this.store.save(this.state); }
      catch { this.state = previous; this.storageError = "The archive could not be saved to disk. Existing files were preserved. Check disk space and restart the server."; this.publish(); throw new ApiError(this.storageError, 503); }
      this.publish();
      return value;
    });
    this.writes = operation.catch(() => undefined);
    return operation;
  }
  private view(job: ArchiveJob): ArchiveJobView {
    const account = this.state.accounts[job.username] || emptyAccount(job.username);
    if (job.status === "queued" && this.state.cooldownUntil > this.now()) {
      job = { ...job, status: "waiting", retryAt: this.state.cooldownUntil,
        message: "The public collector is cooling down after a temporary failure. This collection will start automatically; saved media remains available." };
    }
    return structuredClone({ job, collectedAt: account.collectedAt,
      source: job.batchesRead ? "live" : "saved",
      result: { mode: "scraper", access: "guest", complete: false, username: account.username,
        displayName: account.displayName, profileImageUrl: account.profileImageUrl,
        items: account.items, postsScanned: account.postsScanned, pagesFetched: account.batchesRead,
        newestAt: account.items[0]?.createdAt, oldestAt: account.items.at(-1)?.createdAt,
        warning: "Available public media only. X can omit older posts from anonymous access." },
    });
  }
  async list() {
    await this.init(); await this.writes;
    return { accounts: Object.values(this.state.accounts).filter((a) => a.items.length > 0).map((a) => ({ username: a.username, displayName: a.displayName, count: a.items.length, collectedAt: a.collectedAt })),
      jobs: Object.values(this.state.jobs).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50), storageError: this.storageError };
  }
  async get(id: string): Promise<ArchiveJobView> {
    await this.init(); await this.writes;
    const job = this.state.jobs[jobIdSchema.parse(id)];
    if (!job) throw new ApiError("Collection not found.", 404);
    if (this.storageError) return this.view({ ...job, status: "failed", message: this.storageError });
    return this.view(job);
  }
  async create(input: string, refresh = false, checkpoint?: ArchiveCheckpoint): Promise<ArchiveJobView> {
    const username = usernameSchema.parse(input); await this.init(); await this.writes;
    const previous = Object.values(this.state.jobs).filter((j) => j.username === username).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const active = previous.find(isActiveJob);
    if (active) return this.get(active.id);
    // Opening a saved collection is read-only: no new job, disk rewrite, or upstream request.
    if (!refresh && this.state.accounts[username]?.collectedAt && previous[0]) {
      const saved = await this.get(previous[0].id);
      if (!this.storageError) saved.job = { ...saved.job, status: "partial", newItems: 0, message: "Showing your saved collection. Refresh to look for more public media." };
      saved.source = "saved";
      return saved;
    }
    const id = await this.change(() => {
      const existing = Object.values(this.state.jobs).find((j) => j.username === username && isActiveJob(j));
      if (existing) return existing.id;
      if (Object.values(this.state.jobs).filter(isActiveJob).length >= 25) throw new ApiError("The collection queue is full. Wait for a job or cancel one.", 429);
      const account = this.state.accounts[username] ??= emptyAccount(username);
      const stamp = new Date(this.now()).toISOString();
      const cached = !refresh && !!account.collectedAt;
      const job: ArchiveJob = { id: randomUUID(), username, status: cached ? "partial" : "queued", createdAt: stamp, updatedAt: stamp,
        retries: 0, postsScanned: checkpoint?.seenPostIds.length ?? 0, batchesRead: checkpoint?.batchesRead ?? 0, newItems: 0, checkpoint,
        message: cached ? "Showing your saved collection. Refresh to look for more public media." : "Waiting to collect public media." };
      this.state.jobs[job.id] = job; return job.id;
    });
    this.schedule(); return this.get(id);
  }
  async cancel(id: string) {
    await this.get(id);
    await this.change(() => {
      const job = this.state.jobs[id];
      if (isActiveJob(job)) { job.status = "cancelled"; job.retryAt = undefined; job.message = "Collection stopped. Media found so far is saved."; job.updatedAt = new Date(this.now()).toISOString(); }
    });
    if (this.active === id) this.controller?.abort();
    return this.get(id);
  }
  async retry(id: string) {
    const previous = await this.get(id);
    return this.create(previous.job.username, true, previous.job.checkpoint);
  }
  async repair(id: string, postId: string, signal?: AbortSignal) {
    const view = await this.get(id);
    const items = view.result.items.filter((i) => i.postId === postId);
    if (!items.length) throw new ApiError("That post is not in the saved collection.", 404);
    const fixed = await this.resolver(view.job.username, postId, items, signal);
    if (!fixed.length) throw new ApiError("The video link could not be refreshed. Try again later or open the original post.", 503);
    await this.change(() => { const account = this.state.accounts[view.job.username]; account.items = mergeItems(account.items, fixed); });
    return this.get(id);
  }
  private schedule(delay = 0) {
    if (!this.autoSchedule || this.disposed || this.storageError) return;
    const due = Date.now() + delay;
    if (this.timer && this.timerDue <= due) return;
    clearTimeout(this.timer); this.timerDue = due;
    this.timer = setTimeout(() => { this.timer = undefined; this.timerDue = Infinity; void this.pump().catch(() => undefined); }, delay);
    this.timer.unref();
  }
  async pump(): Promise<void> {
    await this.init();
    if (this.disposed || this.pumping || this.storageError) return;
    this.pumping = true;
    try {
      await this.writes;
      const pending = Object.values(this.state.jobs).filter((j) => j.status === "queued" || j.status === "waiting");
      const job = pending.filter((j) => Math.max(j.retryAt || 0, this.state.cooldownUntil) <= this.now())
        .sort((a, b) => Number(!!a.checkpoint || a.retries > 0 || a.postsScanned > 0) - Number(!!b.checkpoint || b.retries > 0 || b.postsScanned > 0)
          || a.updatedAt.localeCompare(b.updatedAt) || a.createdAt.localeCompare(b.createdAt))[0];
      if (!job) {
        if (pending.length) this.schedule(Math.max(100, Math.min(...pending.map((j) => Math.max(j.retryAt || 0, this.state.cooldownUntil))) - this.now()));
        return;
      }
      this.active = job.id; this.controller = new AbortController();
      const signal = this.controller.signal;
      await this.change(() => {
        job.status = "running"; job.message = job.checkpoint ? "Continuing from the last saved page. You can browse media as it arrives." : "Collecting public posts. You can browse media as it arrives.";
        if (!job.checkpoint) { job.postsScanned = 0; job.batchesRead = 0; job.newItems = 0; }
        job.retryAt = undefined; job.updatedAt = new Date(this.now()).toISOString();
      });
      let ending: Extract<ArchiveEvent, { type: "done" }> = { type: "done", reason: "upstream" };
      try {
        for await (const event of this.runner(job.username, signal, job.checkpoint)) {
          if (signal.aborted) break;
          if (event.type === "done") { ending = event; break; }
          await this.change(() => {
            if (job.status !== "running") return;
            const account = this.state.accounts[job.username];
            if (event.type === "profile") {
              if (event.username !== job.username) throw new Error("Collector returned a different account.");
              account.displayName = event.displayName; account.profileImageUrl = event.profileImageUrl;
            } else if (event.type === "checkpoint") {
              if (event.checkpoint.username !== job.username) throw new Error("Checkpoint belongs to a different account.");
              job.checkpoint = event.checkpoint;
            } else {
              const owned = event.items.filter((i) => new URL(i.postUrl).pathname.split("/")[1].toLowerCase() === job.username);
              const oldCount = account.items.length;
              account.items = mergeItems(account.items, owned);
              job.newItems += account.items.length - oldCount;
              job.postsScanned = event.postsScanned; job.batchesRead = event.batchesRead;
              account.postsScanned = Math.max(account.postsScanned, event.postsScanned);
              account.batchesRead = Math.max(account.batchesRead, event.batchesRead);
              account.collectedAt = new Date(this.now()).toISOString();
            }
            job.updatedAt = new Date(this.now()).toISOString();
          });
        }
        if (!signal.aborted && !["rate_limit", "upstream", "timeout", "yield"].includes(ending.reason)) {
          const missing = [...new Set(this.state.accounts[job.username].items.filter((i) => i.media.type !== "photo" && !i.media.variants.length).map((i) => i.postId))].slice(0, 10);
          for (const postId of missing) { if (signal.aborted) break; await this.repair(job.id, postId, signal).catch(() => undefined); }
        }
      } catch { ending = { type: "done", reason: "upstream" }; }
      if (!signal.aborted) await this.change(() => {
        if (job.status !== "running") return;
        const transient = ["rate_limit", "timeout", "upstream"].includes(ending.reason);
        const retryAt = Math.max(this.now() + (ending.reason === "rate_limit" ? 15 * 60_000 : 30_000 * 2 ** job.retries), ending.retryAt || 0);
        if (ending.reason === "rate_limit") this.state.cooldownUntil = Math.max(this.state.cooldownUntil, retryAt);
        job.message = MESSAGES[ending.reason];
        if (ending.reason === "yield" && job.checkpoint) {
          job.status = "queued"; job.retryAt = undefined;
        } else if (transient && job.retries < 3) {
          job.retries++; job.status = "waiting"; job.retryAt = retryAt;
          job.message += ` Automatic retry ${job.retries} of 3 is scheduled.`;
        } else {
          job.status = this.state.accounts[job.username].items.length ? "partial" : ending.reason === "unavailable" ? "unavailable" : transient ? "failed" : "partial";
          if (transient) job.message += " Automatic retries are exhausted. You can retry later.";
          if (!transient) job.checkpoint = undefined;
        }
        job.updatedAt = new Date(this.now()).toISOString();
      });
    } finally {
      const processed = !!this.active;
      this.pumping = false; this.active = undefined; this.controller = undefined;
      if (processed && Object.values(this.state.jobs).some((j) => j.status === "queued" || j.status === "waiting")) this.schedule(100);
    }
  }
  dispose() { this.disposed = true; clearTimeout(this.timer); this.controller?.abort(); this.listeners.clear(); }
}
