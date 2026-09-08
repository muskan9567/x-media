import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PostsManager } from "./manager";
import { PostsStore } from "./store";
import { createPostsSource, parsePost, parseProfile, PostSourceError, type FetchPostsPage } from "./source";
import { defaultFilters, handleSchema, selectPosts, type Post, type PostProfile } from "./types";

const profile: PostProfile = { id: "123", username: "example", name: "Example", bio: "Public posts", followers: 100 };
const stamp = "2026-09-07T12:00:00.000Z";
const post = (id: string, overrides: Partial<Post> = {}): Post => ({
  id, authorId: "123", username: "example", text: `Tweet ${id}`, createdAt: stamp, fetchedAt: stamp,
  likes: 10, reposts: 2, replies: 0, views: 100, isReply: false, isQuote: false, hasMedia: false, characterCount: 7, media: [], ...overrides,
});
const managers: PostsManager[] = [];
afterEach(() => { managers.splice(0).forEach(m => m.dispose()); vi.restoreAllMocks(); });
async function setup(source: FetchPostsPage, now = () => Date.parse(stamp), budget = 50) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "x-media-posts-"));
  const store = new PostsStore(directory), manager = new PostsManager(store, source, now, false, budget);
  managers.push(manager); await manager.init(); return { manager, store, directory };
}

describe("post identity and categories", () => {
  it("accepts handles and profile URLs without allowing arbitrary URLs or paths", () => {
    for (const input of [" @EXAMPLE ", "https://x.com/Example", "twitter.com/example/", "https://www.x.com/example?lang=en"]) expect(handleSchema.parse(input)).toBe("example");
    for (const input of ["https://evil.test/example", "https://x.com/example/status/123", "../../secret", "a b", "@", "abcdefghijklmnop", "https://x.com@evil.test/example"]) expect(handleSchema.safeParse(input).success).toBe(false);
  });
  it("ranks pinned old posts chronologically and keeps missing metrics last", () => {
    const rows = [post("1", { likes: 900, createdAt: "2020-01-01T00:00:00.000Z" }), post("2", { likes: null, views: null }), post("3", { likes: 0, views: 0 })];
    expect(selectPosts(rows, defaultFilters).map(p => p.id)).toEqual(["1", "3", "2"]);
    expect(selectPosts(rows, { ...defaultFilters, category: "oldest" })[0].id).toBe("1");
    expect(selectPosts(rows, { ...defaultFilters, category: "recent" })[0].id).toBe("3");
    expect(rows[0].id).toBe("1");
  });
  it("short bangers excludes replies, quote posts, media, empty and unliked posts", () => {
    const rows = [post("1"), post("2", { isReply: true }), post("3", { isQuote: true }), post("4", { hasMedia: true }), post("5", { text: "", characterCount: 0 }), post("6", { likes: 0 }), post("7", { likes: null }), post("8", { characterCount: 141 })];
    expect(selectPosts(rows, { ...defaultFilters, category: "short" }).map(p => p.id)).toEqual(["1"]);
    expect(selectPosts(rows, { ...defaultFilters, category: "short", maxLength: 280 }).map(p => p.id)).toEqual(["8", "1"]);
  });
  it("combines date, keyword and minimum likes without including replies", () => {
    const rows = [post("1", { text: "Build things", likes: 50, isReply: true }), post("2", { text: "build more", likes: 20 }), post("3", { text: "build older", likes: 100, createdAt: "2020-01-01T00:00:00.000Z" })];
    const filters = { ...defaultFilters, keyword: " BUILD ", minLikes: 30, days: 7 };
    expect(selectPosts(rows, filters, Date.parse(stamp))).toHaveLength(0);
    expect(selectPosts(rows, { ...filters, minLikes: 20 }, Date.parse(stamp)).map(p => p.id)).toEqual(["2"]);
    expect(selectPosts(rows, { ...defaultFilters, metric: "reposts" })).toHaveLength(2);
  });
  it("shows only standalone originals in every category while retaining original media posts", () => {
    const rows = [post("1"), post("2", { isReply: true, likes: 10000 }), post("3", { isQuote: true, likes: 9000 }), post("4", { hasMedia: true })];
    for (const category of ["popular", "recent", "oldest", "short"] as const) {
      const result = selectPosts(rows, { ...defaultFilters, category });
      expect(result.map(p => p.id).sort()).toEqual(category === "short" ? ["1"] : ["1", "4"]);
    }
  });
});

describe("FxTwitter post source", () => {
  const user = { id: "123", screen_name: "Example", name: "Example", followers: 100 };
  const raw = (changes = {}) => ({ type: "status", id: "1", text: "👩‍💻 tiny idea", author: user, created_timestamp: Date.parse(stamp) / 1000, likes: 4, reposts: 1, replies: 2, ...changes });
  const page = (results: unknown[], bottom: string | null = null) => Response.json({ code: 200, results, cursor: { bottom } });
  it("includes text-only posts with grapheme length, and distinguishes unknown counts", () => {
    const result = parsePost(raw({ views: null }), profile, stamp)!;
    expect(result.text).toBe("👩‍💻 tiny idea"); expect(result.characterCount).toBe(11); expect(result.views).toBeNull();
    expect(result.media).toEqual([]); expect(result.hasMedia).toBe(false);
    expect(parsePost(raw({ created_timestamp: undefined, created_at: stamp }), profile, stamp)?.createdAt).toBe(stamp);
  });
  it("rejects wrong authors, reposts, protected and malformed records", () => {
    for (const item of [raw({ author: { ...user, id: "999" } }), raw({ reposted_by: user }), raw({ author: { ...user, protected: true } }), raw({ created_timestamp: NaN }), {}, raw({ author: { ...user, screen_name: "wrong" } })]) expect(parsePost(item, profile, stamp)).toBeNull();
    expect(() => parseProfile({ ...user, protected: true }, "example")).toThrow("not available publicly");
  });
  it("keeps supported images/video, rejects unsafe URLs and excludes unsupported media from shorts", () => {
    const result = parsePost(raw({ media: { all: [
      { id: "a", type: "photo", url: "https://pbs.twimg.com/a.jpg" },
      { type: "video", url: "https://video.twimg.com/a.mp4", formats: [{ url: "https://video.twimg.com/b.mp4", bitrate: 100 }] },
      { type: "gif", thumbnail_url: "https://pbs.twimg.com/c.jpg" },
      { type: "photo", url: "http://127.0.0.1/private" }, { type: "audio" },
    ] } }), profile, stamp)!;
    expect(result.media).toHaveLength(3); expect(result.media[1].variants).toHaveLength(2); expect(result.media[2].type).toBe("animated_gif");
    expect(parsePost(raw({ media: { all: [{ type: "audio" }] } }), profile, stamp)?.hasMedia).toBe(true);
  });
  it("paginates using explicit reply-enabled timelines and verifies account identity", async () => {
    const fetcher = vi.fn().mockImplementation(async () => page([raw()], "two"));
    const result = await createPostsSource(fetcher)("@Example", "one", new AbortController().signal, profile);
    expect(result.posts).toHaveLength(1); expect(result.cursor).toBe("two");
    expect(fetcher.mock.calls[0][0]).toContain("with_replies=1&cursor=one");
    await expect(createPostsSource(fetcher)("example", undefined, new AbortController().signal, { ...profile, id: "999" })).rejects.toThrow("different account");
  });
  it("resolves empty account profiles instead of guessing they are unavailable", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(page([])).mockResolvedValueOnce(Response.json({ code: 200, user }));
    const result = await createPostsSource(fetcher)("example", undefined, new AbortController().signal);
    expect(result.posts).toHaveLength(0); expect(result.profile.username).toBe("example"); expect(result.cursor).toBeUndefined();
  });
  it("returns explicit errors for 404, rate limits, malformed pages and server failures", async () => {
    for (const response of [new Response(null, { status: 404 }), new Response(null, { status: 503 }), Response.json({ code: 429 }), new Response("not json"), Response.json({ code: 200, results: [] })]) {
      await expect(createPostsSource(vi.fn().mockResolvedValue(response))("example", undefined, new AbortController().signal)).rejects.toThrow();
    }
    const rate = createPostsSource(vi.fn().mockResolvedValue(new Response(null, { status: 429, headers: { "retry-after": "60" } })));
    await expect(rate("example", undefined, new AbortController().signal)).rejects.toMatchObject({ kind: "rate_limit", retryAt: expect.any(Number) });
  });
  it("preserves empty-page continuation and reports empty-account metadata", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(page([], "next")).mockResolvedValueOnce(Response.json({ code: 200, user: { ...user, statuses: 0, joined: "2022-11-24T00:00:00Z" } }));
    const result = await createPostsSource(fetcher)("example", undefined, new AbortController().signal);
    expect(result.cursor).toBe("next"); expect(result.profile.reportedPosts).toBe(0); expect(result.profile.joinedAt).toBe("2022-11-24T00:00:00.000Z");
  });
});

describe("durable full-post collection", () => {
  it("filters saved replies and quotes from API views and counts without deleting stored history", async () => {
    const source = vi.fn<FetchPostsPage>().mockResolvedValue({ profile, posts: [post("1"), post("2", { isReply: true }), post("3", { isQuote: true }), post("4", { hasMedia: true })], scanned: 4 });
    const { manager, store } = await setup(source);
    await manager.start("example"); await manager.pump();
    expect((await manager.get("example")).posts.map(p => p.id).sort()).toEqual(["1", "4"]);
    expect((await manager.list())[0].count).toBe(2);
    expect((await store.load()).accounts.example.posts).toHaveLength(4);
    manager.dispose();
    const reloaded = new PostsManager(store, source, undefined, false); managers.push(reloaded);
    expect((await reloaded.get("example")).posts.map(p => p.id).sort()).toEqual(["1", "4"]);
  });
  it("saves each page and cursor, merges metrics, and reopens without network or disk writes", async () => {
    const source = vi.fn<FetchPostsPage>().mockResolvedValueOnce({ profile, posts: [post("1"), post("1"), post("2", { username: "wrong" })], scanned: 3, cursor: "two" })
      .mockResolvedValueOnce({ profile, posts: [post("1", { likes: 30 }), post("3")], scanned: 2 });
    const { manager, store } = await setup(source);
    await manager.start("example"); await manager.pump();
    expect((await store.load()).accounts.example.cursor).toBe("two");
    expect((await manager.get("example")).posts).toHaveLength(1);
    await manager.pump(); expect(source.mock.calls[1][1]).toBe("two");
    const view = await manager.get("example"); expect(view.posts).toHaveLength(2); expect(view.posts.find(p => p.id === "1")?.likes).toBe(30); expect(view.canContinue).toBe(false);
    const writes = vi.spyOn(store, "save"); await manager.start("example"); expect(source).toHaveBeenCalledTimes(2); expect(writes).not.toHaveBeenCalled();
  });
  it("pauses at a bounded page count and resumes in a fresh manager", async () => {
    const source = vi.fn<FetchPostsPage>().mockResolvedValue({ profile, posts: [post("1")], scanned: 1, cursor: "two" });
    const { manager, store } = await setup(source, undefined, 1);
    await manager.start("example"); await manager.pump(); expect((await manager.get("example")).status).toBe("paused"); manager.dispose();
    const nextSource = vi.fn<FetchPostsPage>().mockResolvedValue({ profile, posts: [post("2")], scanned: 1 });
    const next = new PostsManager(store, nextSource, undefined, false); managers.push(next);
    await next.start("example", "continue"); await next.pump(); expect(nextSource.mock.calls[0][1]).toBe("two"); expect((await next.get("example")).posts).toHaveLength(2);
    await expect(next.start("example", "continue")).rejects.toThrow("no further pages");
  });
  it("refreshes recent metrics without losing older posts or the history cursor", async () => {
    const source = vi.fn<FetchPostsPage>().mockResolvedValueOnce({ profile, posts: [post("1"), post("2")], scanned: 2, cursor: "history" })
      .mockResolvedValueOnce({ profile, posts: [post("1", { likes: 100, views: null })], scanned: 1 });
    const { manager, store } = await setup(source, undefined, 1);
    await manager.start("example"); await manager.pump(); await manager.start("example", "refresh"); await manager.pump();
    const saved = (await store.load()).accounts.example;
    expect(saved.cursor).toBe("history"); expect(saved.posts).toHaveLength(2); expect(saved.posts.find(p => p.id === "1")).toMatchObject({ likes: 100, views: 100 });
    expect(source.mock.calls[1][1]).toBeUndefined();
  });
  it("stops a request without saving its late result", async () => {
    let finish!: (value: Awaited<ReturnType<FetchPostsPage>>) => void;
    const source = vi.fn<FetchPostsPage>().mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { manager } = await setup(source); await manager.start("example"); const pumping = manager.pump();
    await vi.waitFor(() => expect(source).toHaveBeenCalled()); await manager.stop("example");
    finish({ profile, posts: [post("1")], scanned: 1 }); await pumping;
    expect((await manager.get("example"))).toMatchObject({ status: "paused", posts: [] });
  });
  it("recovers interrupted running jobs and rejects identity changes", async () => {
    const { manager, store } = await setup(async () => ({ profile, posts: [], scanned: 0 }));
    await manager.start("example"); const state = await store.load(); state.accounts.example.status = "collecting"; state.accounts.example.profile = profile; await store.save(state);
    const recovered = new PostsManager(store, async () => ({ profile: { ...profile, id: "999" }, posts: [], scanned: 0 }), undefined, false); managers.push(recovered);
    expect((await recovered.get("example")).status).toBe("queued"); await recovered.pump(); expect((await recovered.get("example")).status).toBe("unavailable");
  });
  it("shares active jobs and schedules newer searches before long-running history", async () => {
    const source = vi.fn<FetchPostsPage>().mockImplementation(async username => ({ profile: { ...profile, username }, posts: [], scanned: 1, cursor: "next" }));
    const { manager } = await setup(source);
    const [a, b] = await Promise.all([manager.start("example"), manager.start("example")]); expect(a.revision).toBe(b.revision);
    await manager.pump(); await manager.start("second"); await manager.pump(); expect(source.mock.calls.map(c => c[0])).toEqual(["example", "second"]);
    expect((await manager.list()).length).toBe(2);
  });
  it("obeys global cooldown even after stop and restart, and caps retries", async () => {
    let now = Date.parse(stamp);
    const source = vi.fn<FetchPostsPage>().mockRejectedValue(new PostSourceError("rate_limit", "Cooling down", now + 3_600_000));
    const { manager } = await setup(source, () => now);
    await manager.start("example"); await manager.pump(); expect((await manager.get("example")).status).toBe("waiting");
    await manager.stop("example"); await manager.start("example", "continue"); await manager.pump(); expect(source).toHaveBeenCalledTimes(1);
    expect((await manager.get("example")).retryAt).toBe(now + 3_600_000);
    for (let i = 0; i < 4; i++) { now += 3_600_001; await manager.pump(); }
    expect((await manager.get("example")).status).toBe("failed");
  });
  it("retains saved tweets on an unavailable refresh or transient errors", async () => {
    const source = vi.fn<FetchPostsPage>().mockResolvedValueOnce({ profile, posts: [post("1")], scanned: 1 }).mockRejectedValueOnce(new PostSourceError("unavailable", "Unavailable"));
    const { manager } = await setup(source); await manager.start("example"); await manager.pump(); await manager.start("example", "refresh"); await manager.pump();
    expect((await manager.get("example"))).toMatchObject({ status: "unavailable", posts: [expect.objectContaining({ id: "1" })] });
  });
  it("detects repeated cursors and preserves corrupt or unwritable storage", async () => {
    const source = vi.fn<FetchPostsPage>().mockResolvedValue({ profile, posts: [post("1")], scanned: 1, cursor: "same" });
    const { manager, store } = await setup(source); await manager.start("example"); await manager.pump(); await manager.pump();
    expect((await manager.get("example")).message).toContain("repeated");
    vi.spyOn(store, "save").mockRejectedValueOnce(Error("disk full")); await expect(manager.start("example", "continue")).rejects.toThrow("could not be saved");
    expect((await manager.get("example")).status).toBe("failed"); expect((await store.load()).accounts.example.posts).toHaveLength(1);
    await writeFile(store.file, "not json"); await expect(new PostsStore(path.dirname(store.file)).load()).rejects.toThrow("original file was preserved"); expect(await readFile(store.file, "utf8")).toBe("not json");
  });
  it("handles prototype-like account names as ordinary usernames", async () => {
    const { manager } = await setup(async username => ({ profile: { ...profile, username }, posts: [], scanned: 0 }));
    await manager.start("constructor"); await manager.pump(); expect((await manager.get("constructor")).status).toBe("ready");
    await expect(manager.get("missing")).rejects.toThrow("Search this account");
  });
});
