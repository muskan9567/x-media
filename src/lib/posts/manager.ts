import { randomUUID } from "node:crypto";
import { ApiError } from "@/lib/api-response";
import { PostsStore } from "./store";
import { createPostsSource, PostSourceError, type FetchPostsPage } from "./source";
import { activeAccount, handleSchema, isOriginalPost, type AccountSummary, type PostAccount, type PostsView, type PostState } from "./types";
import { archiveImportSchema, type ArchiveImport } from "./archive-import";

export class PostsManager {
  private state!: PostState;
  private ready?: Promise<void>;
  private writes: Promise<unknown> = Promise.resolve();
  private timer?: ReturnType<typeof setTimeout>;
  private controller?: AbortController;
  private active?: string;
  private pumping = false;
  private disposed = false;
  private storageError?: string;
  constructor(private store: PostsStore, private source: FetchPostsPage = createPostsSource(), private now = Date.now,
    private autoSchedule = true, private pageBudget = 50, private sourceKind: "timeline" | "full_archive" = "timeline") {}
  init() {
    this.ready ??= (async () => {
      this.state = await this.store.load();
      this.state.accounts = Object.assign(Object.create(null), this.state.accounts);
      let recovered = false;
      for (const account of Object.values(this.state.accounts)) if (this.sourceKind === "timeline" && account.source !== "timeline") {
        account.source = "timeline"; account.cursor = undefined; account.refreshCursor = undefined;
        account.recentCursors = []; account.exhausted = false; account.historyComplete = false;
        account.archiveFrom = undefined; account.archiveThrough = undefined; account.retryAt = undefined;
        account.pages = 0; account.runPages = 0; account.scanned = 0; account.retries = 0;
        account.status = "paused"; account.message = "Free collection is ready. Your saved tweets are kept. Collect tweets to check the public timeline.";
        this.touch(account); recovered = true;
      } else if (this.sourceKind === "full_archive" && account.source !== "full_archive" && activeAccount(account)) {
        account.status = "paused"; account.message = "This is a partial timeline from the previous collector. Collect full history to search the X archive."; account.revision++; recovered = true;
      } else if (account.status === "collecting") {
        account.status = "queued"; account.message = "Resuming collection after the app restarted."; account.revision++; recovered = true;
      }
      if (recovered) await this.store.save(this.state);
      this.schedule();
    })();
    return this.ready;
  }
  private change<T>(action: (state: PostState) => T): Promise<T> {
    const operation = this.writes.then(async () => {
      if (this.storageError) throw new ApiError(this.storageError, 503);
      const next = structuredClone(this.state);
      // Account names such as "constructor" must remain ordinary keys.
      next.accounts = Object.assign(Object.create(null), next.accounts);
      const result = action(next);
      try { await this.store.save(next); }
      catch { this.storageError = "Tweets could not be saved. Existing files are preserved. Check disk space and restart X Media."; throw new ApiError(this.storageError, 503); }
      this.state = next;
      return result;
    });
    this.writes = operation.catch(() => undefined);
    return operation;
  }
  private touch(account: PostAccount) { account.revision++; account.updatedAt = new Date(this.now()).toISOString(); }
  private view(account: PostAccount): PostsView {
    const copy = structuredClone(account);
    const { cursor, refreshCursor: _refresh, recentCursors: _cursors, runId: _id, ...rest } = copy;
    void _refresh; void _cursors; void _id;
    rest.posts = rest.posts.filter(isOriginalPost);
    if (this.storageError) { rest.status = "failed"; rest.message = this.storageError; }
    else if (activeAccount(copy) && this.state.cooldownUntil > this.now()) {
      rest.status = "waiting"; rest.retryAt = Math.max(rest.retryAt || 0, this.state.cooldownUntil);
      rest.message = this.sourceKind === "full_archive" ? "The X API is cooling down. Collection will resume automatically." : "The public source is cooling down. Collection will resume automatically.";
    }
    return { ...rest, canContinue: this.sourceKind === "full_archive" ? !copy.historyComplete : !copy.exhausted && (!!cursor || copy.pages === 0) };
  }
  async list(): Promise<AccountSummary[]> {
    await this.init(); await this.writes;
    return Object.values(this.state.accounts).map(a => ({ username: a.username, name: a.profile?.name || a.username, status: a.status, count: a.posts.filter(isOriginalPost).length, fetchedAt: a.fetchedAt }))
      .sort((a, b) => (b.fetchedAt || "").localeCompare(a.fetchedAt || ""));
  }
  async get(input: string): Promise<PostsView> {
    const username = handleSchema.parse(input); await this.init(); await this.writes;
    const account = this.state.accounts[username];
    if (!account) throw new ApiError("Search this account to start collecting tweets.", 404);
    return this.view(account);
  }
  async start(input: string, action: "open" | "continue" | "refresh" | "collect" = "open") {
    const username = handleSchema.parse(input); await this.init(); await this.writes;
    if (this.storageError) throw new ApiError(this.storageError, 503);
    const prior = this.state.accounts[username];
    if (prior && (activeAccount(prior) || action === "open" && (prior.posts.length > 0 || prior.exhausted || prior.importedAt))) return this.get(username);
    await this.change(state => {
      const old = state.accounts[username];
      if (old && activeAccount(old)) return;
      if (Object.values(state.accounts).filter(activeAccount).length >= 10) throw new ApiError("Ten accounts are collecting. Stop one or wait before starting another.", 429);
      const account: PostAccount = old ?? {
        username, posts: [], status: "queued", message: "", revision: 0, runId: "", mode: "history", exhausted: false,
        recentCursors: [], pages: 0, scanned: 0, runPages: 0, retries: 0, updatedAt: new Date(this.now()).toISOString(),
        source: this.sourceKind, historyComplete: false,
      };
      if (account.source !== this.sourceKind) {
        account.source = this.sourceKind; account.cursor = undefined; account.refreshCursor = undefined; account.exhausted = false;
        account.historyComplete = false; account.pages = 0; account.scanned = 0; account.archiveFrom = undefined; account.archiveThrough = undefined;
        // Cursors belong to a source; switching must preserve posts, not cursors.
        action = "collect";
      }
      if (action === "continue" && account.exhausted) throw new ApiError("The source has no further pages. Refresh latest to check for new tweets.", 409);
      if (action === "refresh") { account.mode = "refresh"; account.refreshCursor = undefined; }
      else account.mode = "history";
      account.runId = randomUUID(); account.runPages = 0; account.retries = 0; account.retryAt = undefined;
      account.status = "queued"; account.message = action === "refresh" ? "Checking recent tweets and engagement counts…" : "Collecting public tweets. Results appear as they are saved.";
      account.recentCursors = []; this.touch(account); state.accounts[username] = account;
    });
    this.schedule(); return this.get(username);
  }
  async stop(input: string) {
    const username = handleSchema.parse(input); await this.get(username);
    await this.change(state => {
      const account = state.accounts[username];
      if (!activeAccount(account)) return;
      account.status = "paused"; account.retryAt = undefined; account.message = "Collection stopped. Your tweets and place in the timeline are saved.";
      this.touch(account);
    });
    if (this.active === username) this.controller?.abort();
    return this.get(username);
  }
  private schedule(delay = 0) {
    if (!this.autoSchedule || this.disposed || this.storageError) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.pump().catch(() => undefined); }, delay);
    this.timer.unref();
  }
  async pump(): Promise<void> {
    await this.init();
    if (this.pumping || this.disposed || this.storageError) return;
    this.pumping = true;
    try {
      await this.writes;
      const pending = Object.values(this.state.accounts).filter(a => a.status === "queued" || a.status === "waiting");
      const account = pending.filter(a => Math.max(a.retryAt || 0, this.state.cooldownUntil) <= this.now())
        .sort((a, b) => a.runPages - b.runPages || a.updatedAt.localeCompare(b.updatedAt))[0];
      if (!account) return;
      const username = account.username, runId = account.runId;
      this.active = username; this.controller = new AbortController();
      const signal = this.controller.signal;
      await this.change(state => { const a = state.accounts[username]; if (a.runId === runId && activeAccount(a)) { a.status = "collecting"; this.touch(a); } });
      if (signal.aborted) return;
      try {
        const cursor = account.mode === "refresh" ? account.refreshCursor : account.cursor;
        const latestCovered = account.historyComplete ? account.archiveThrough : account.posts[0]?.createdAt;
        const from = account.mode === "refresh" && latestCovered ? new Date(Date.parse(latestCovered) - 7 * 86_400_000).toISOString() : undefined;
        const page = await this.source(username, cursor, signal, account.profile, { from });
        if (signal.aborted) return;
        await this.change(state => {
          const a = state.accounts[username];
          if (a.runId !== runId || !activeAccount(a)) return;
          if (page.profile.username !== username || (a.profile && a.profile.id !== page.profile.id)) throw new PostSourceError("unavailable", "Account identity changed. Saved tweets were preserved.");
          a.profile = page.profile;
          const posts = new Map(a.posts.map(p => [p.id, p]));
          for (const p of page.posts) if (p.username === username && p.authorId === page.profile.id) {
            const old = posts.get(p.id);
            posts.set(p.id, old ? { ...p, likes: p.likes ?? old.likes, reposts: p.reposts ?? old.reposts, replies: p.replies ?? old.replies,
              views: p.views ?? old.views, media: p.media.length ? p.media : old.media, hasMedia: p.hasMedia || old.hasMedia } : p);
          }
          a.posts = [...posts.values()].sort((x, y) => y.createdAt.localeCompare(x.createdAt) || y.id.localeCompare(x.id));
          a.pages++; a.runPages++; a.scanned += page.scanned; a.fetchedAt = new Date(this.now()).toISOString(); a.retryAt = undefined; a.retries = 0;
          const repeated = !!page.cursor && (page.cursor === cursor || a.recentCursors.includes(page.cursor));
          if (page.cursor) a.recentCursors = [...a.recentCursors, page.cursor].slice(-100);
          if (a.mode === "history") {
            a.cursor = page.cursor; a.exhausted = !page.cursor;
            if (page.archiveWindow) {
              a.archiveFrom = page.archiveWindow.from; a.archiveThrough = page.archiveWindow.through;
              a.historyComplete = !page.cursor && !repeated;
            }
          }
          else {
            a.refreshCursor = page.cursor;
            // Advance full coverage only after every new-post page has committed.
            if (!page.cursor && !repeated && a.historyComplete && page.archiveWindow && a.archiveThrough && page.archiveWindow.from <= a.archiveThrough) a.archiveThrough = page.archiveWindow.through;
          }
          if (repeated) {
            a.status = "paused"; a.message = "The source repeated a page. Tweets found so far are saved; try continuing later.";
          } else if (!page.cursor || a.source !== "full_archive" && a.mode === "refresh" && a.runPages >= 5) {
            a.status = "ready"; a.message = a.mode === "refresh" ? "Recent tweets and their available counts are refreshed. Older saved tweets are kept." : a.source === "full_archive" ? "Finished paginating the X archive for this account. All posts returned for the searched period are saved." : !a.posts.length ? (a.profile.reportedPosts === 0 ? "The public source reports 0 posts for this account. Check the handle or import an archive." : "The public source returned no authored tweets. Check the handle, try again later, or import an archive.") : "Collected the available timeline for free. Older posts may be missing; import an archive to add them.";
          } else if (a.source !== "full_archive" && a.runPages >= this.pageBudget) {
            a.status = "paused"; a.message = `Saved ${a.runPages} pages this run. Continue older posts to collect more history.`;
          } else {
            a.status = "queued"; a.message = a.mode === "refresh" ? "Refreshing recent tweets and counts…" : "Collecting older tweets. You can browse and filter while this runs.";
          }
          this.touch(a);
        });
      } catch (error) {
        if (signal.aborted || this.storageError) return;
        await this.change(state => {
          const a = state.accounts[username]; if (a.runId !== runId || !activeAccount(a)) return;
          const unavailable = error instanceof PostSourceError && error.kind === "unavailable";
          const access = error instanceof PostSourceError && error.kind === "access";
          const limited = error instanceof PostSourceError && error.kind === "rate_limit";
          const retryAt = Math.max(this.now() + (limited ? 900_000 : 30_000 * 2 ** a.retries), error instanceof PostSourceError ? error.retryAt || 0 : 0);
          if (limited) state.cooldownUntil = Math.max(state.cooldownUntil, retryAt);
          a.message = error instanceof PostSourceError ? error.message : "The source could not finish this page. Saved tweets are available.";
          if (!unavailable && !access && a.retries < 3) { a.retries++; a.status = "waiting"; a.retryAt = retryAt; a.message += ` Automatic retry ${a.retries} of 3 is scheduled.`; }
          else { a.status = unavailable ? "unavailable" : "failed"; a.retryAt = undefined; if (!unavailable && !access) a.message += " Try continuing later."; }
          this.touch(a);
        });
      }
    } finally {
      this.pumping = false; this.active = undefined; this.controller = undefined;
      if (!this.storageError) {
        const pending = Object.values(this.state.accounts).filter(a => a.status === "queued" || a.status === "waiting");
        if (pending.length) this.schedule(Math.max(1200, Math.min(...pending.map(a => Math.max(a.retryAt || 0, this.state.cooldownUntil))) - this.now()));
      }
    }
  }
  async importArchive(input: ArchiveImport) {
    const archive = archiveImportSchema.parse(input);
    await this.init();
    const username = archive.profile.username;
    await this.change(state => {
      const old = state.accounts[username];
      if (old && activeAccount(old)) throw new ApiError("Stop collection for this account before importing its archive.", 409);
      if (old?.profile && old.profile.id !== archive.profile.id) throw new ApiError("This archive belongs to a different account ID. Your saved tweets were preserved.", 409);
      const timestamp = new Date(this.now()).toISOString();
      const account: PostAccount = old ?? {
        username, posts: [], status: "ready", message: "", revision: 0, runId: randomUUID(), mode: "history", exhausted: false,
        recentCursors: [], pages: 0, scanned: 0, runPages: 0, retries: 0, updatedAt: timestamp, source: this.sourceKind, historyComplete: false,
      };
      const posts = new Map(account.posts.map(post => [post.id, post]));
      const before = posts.size;
      // Imports fill missing history. Existing fetched records keep their current metrics.
      for (const post of archive.posts) if (!posts.has(post.id)) posts.set(post.id, post);
      account.posts = [...posts.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
      account.profile = account.profile ?? archive.profile;
      account.importedAt = timestamp; account.importedCount = archive.posts.length;
      account.status = "ready"; account.retryAt = undefined;
      account.message = `Imported ${posts.size - before} new tweets from ${archive.posts.length} archive records. Existing tweets are kept; the file's completeness is not verified.`;
      this.touch(account); state.accounts[username] = account;
    });
    return this.get(username);
  }
  dispose() { this.disposed = true; clearTimeout(this.timer); this.controller?.abort(); }
}
