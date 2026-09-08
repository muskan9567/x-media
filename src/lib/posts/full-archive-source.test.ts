import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFullArchiveSource } from "./full-archive-source";
import { PostsConnection } from "./connection";
import { PostsManager } from "./manager";
import { PostsStore } from "./store";
import { PostSourceError, type FetchPostsPage } from "./source";
import { type Post, type PostProfile } from "./types";

const now = Date.parse("2026-09-07T12:00:00.000Z"), joinedAt = "2009-04-21T06:49:15.000Z";
const profile: PostProfile = { id: "123", username: "example", name: "Example", bio: "", followers: 1, joinedAt, reportedPosts: 10144 };
const user = () => Response.json({ data: { id: profile.id, username: profile.username, name: profile.name, created_at: joinedAt, public_metrics: { followers_count: 1, post_count: 10144 } } });
const raw = (id = "1", extra = {}) => ({ id, author_id: "123", text: "Short post", created_at: "2010-01-01T00:00:00.000Z", public_metrics: { like_count: 55, repost_count: 3, reply_count: 1 }, ...extra });
const page = (data: unknown[], token?: string, extra = {}) => Response.json({ data, meta: { result_count: data.length, next_token: token }, ...extra });
const signal = () => new AbortController().signal;
const token = async () => "test-token-never-print";
const managers: PostsManager[] = [];
afterEach(() => { managers.splice(0).forEach(manager => manager.dispose()); vi.restoreAllMocks(); });
async function setup(source: FetchPostsPage, kind: "full_archive" | "timeline" = "full_archive", budget = 50) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "posts-full-history-"));
  const store = new PostsStore(directory), manager = new PostsManager(store, source, () => now, false, budget, kind);
  managers.push(manager); await manager.init(); return { directory, store, manager };
}
const post = (id: string): Post => ({ id, authorId: "123", username: "example", text: `Post ${id}`, createdAt: new Date(Date.parse(joinedAt) + Number(id) * 864000).toISOString(), fetchedAt: new Date(now).toISOString(), likes: 1, reposts: 0, replies: 0, views: null, isReply: false, isQuote: false, hasMedia: false, characterCount: 8, media: [] });
const window = { from: joinedAt, through: new Date(now - 30000).toISOString() };

describe("official full-archive search", () => {
  it("requests all dates, 500 results, current field names, replies and media, then resumes a frozen query", async () => {
    let clock = now;
    const fetcher = vi.fn().mockResolvedValueOnce(user()).mockResolvedValueOnce(page([raw("1", { note_post: { text: "Full long-form text" }, referenced_posts: [{ type: "replied_to", id: "8" }], attachments: { media_keys: ["photo"] } })], "next-page", { includes: { media: [{ media_key: "photo", type: "photo", url: "https://pbs.twimg.com/a.jpg" }] } })).mockResolvedValueOnce(page([raw("2")]));
    const source = createFullArchiveSource(token, fetcher, () => clock), first = await source("example", undefined, signal());
    expect(first.posts[0]).toMatchObject({ text: "Full long-form text", likes: 55, isReply: true, hasMedia: true, media: [{ type: "photo" }] });
    const query = new URL(fetcher.mock.calls[1][0]);
    expect(query.pathname).toBe("/2/tweets/search/all"); expect(query.searchParams.get("query")).toBe("from:example -is:retweet");
    expect(query.searchParams.get("start_time")).toBe(joinedAt); expect(query.searchParams.get("max_results")).toBe("500");
    expect(query.searchParams.get("post.fields")).toContain("note_post"); expect(query.searchParams.get("expansions")).toContain("referenced_posts");
    expect(fetcher.mock.calls[1][1]).toMatchObject({ redirect: "error", headers: { Authorization: "Bearer test-token-never-print" } });
    clock += 86400000;
    const last = await source("example", first.cursor, signal(), first.profile);
    const resumed = new URL(fetcher.mock.calls[2][0]);
    expect(resumed.searchParams.get("end_time")).toBe(query.searchParams.get("end_time")); expect(resumed.searchParams.get("next_token")).toBe("next-page");
    expect(last.cursor).toBeUndefined(); expect(last.archiveWindow).toEqual(first.archiveWindow); expect(last.posts[0].id).toBe("2");
  });
  it("follows empty pages that still carry continuation, and refuses incomplete or malformed pages", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(user()).mockResolvedValueOnce(page([], "empty-next"));
    const first = await createFullArchiveSource(token, fetcher, () => now)("example", undefined, signal()); expect(first.posts).toEqual([]); expect(first.cursor).toBeTruthy();
    for (const body of [{ data: [raw()], meta: { result_count: 2 } }, { data: [{}], meta: { result_count: 1 } }, { data: [raw()], meta: { result_count: 1 }, errors: [{ detail: "Partial response" }] }, {}]) {
      await expect(createFullArchiveSource(token, vi.fn().mockResolvedValue(Response.json(body)))("example", first.cursor, signal(), profile)).rejects.toThrow();
    }
  });
  it("reports missing credentials, rejected tokens, credits, forbidden access and rate limits explicitly", async () => {
    const missing = vi.fn(); await expect(createFullArchiveSource(async () => undefined, missing)("example", undefined, signal())).rejects.toMatchObject({ kind: "access" }); expect(missing).not.toHaveBeenCalled();
    for (const status of [401, 402, 403, 404, 429, 500]) {
      const source = createFullArchiveSource(token, vi.fn().mockResolvedValue(new Response(null, { status, headers: { "x-rate-limit-reset": String(now / 1000 + 100) } })), () => now);
      await expect(source("example", undefined, signal())).rejects.toMatchObject({ kind: status === 429 ? "rate_limit" : status === 404 ? "unavailable" : status === 500 ? "upstream" : "access" });
    }
  });
  it("saves intact posts when only a proven expansion is unavailable, while rejecting missing main results", async () => {
    const rows = [raw("1", { referenced_posts: [{ type: "quoted", id: "22" }], in_reply_to_user_id: "44", attachments: { media_keys: ["m-1"] } })];
    const errors = [{ resource_type: "tweet", resource_id: "22" }, { resource_type: "user", resource_id: "44" }, { resource_type: "media", resource_id: "m-1" }].map(error => ({ ...error, type: "https://api.x.com/2/problems/resource-not-found" }));
    const first = await createFullArchiveSource(token, vi.fn().mockResolvedValueOnce(user()).mockResolvedValueOnce(page(rows, "next", { errors })))("example", undefined, signal());
    expect(first.posts).toHaveLength(1); expect(first.posts[0]).toMatchObject({ isQuote: true, isReply: true, hasMedia: true }); expect(first.cursor).toBeTruthy();
    for (const error of [{ ...errors[0], resource_id: "1" }, { ...errors[0], resource_id: "999" }, { ...errors[1], resource_id: "123" }, { ...errors[0], type: "https://api.x.com/2/problems/usage-capped" }]) {
      await expect(createFullArchiveSource(token, vi.fn().mockResolvedValue(page(rows, undefined, { errors: [error] })))("example", first.cursor, signal(), profile)).rejects.toMatchObject({ kind: "upstream" });
    }
  });
  it("keeps identity strict and rejects foreign or damaged checkpoints", async () => {
    const source = createFullArchiveSource(token, vi.fn().mockResolvedValue(user()), () => now);
    await expect(source("example", "old-fxtwitter-cursor", signal())).rejects.toMatchObject({ kind: "access" });
    await expect(source("example", undefined, signal(), { ...profile, id: "999" })).rejects.toMatchObject({ kind: "unavailable" });
    const fetcher = vi.fn().mockResolvedValueOnce(user()).mockResolvedValueOnce(page([raw("1", { author_id: "999" })]));
    await expect(createFullArchiveSource(token, fetcher)("example", undefined, signal())).rejects.toMatchObject({ kind: "unavailable" });
    const first = await createFullArchiveSource(token, vi.fn().mockResolvedValueOnce(user()).mockResolvedValueOnce(page([], "next")))("example", undefined, signal());
    await expect(source("other", first.cursor, signal(), profile)).rejects.toMatchObject({ kind: "unavailable" });
  });
  it("normalizes old response aliases and supported video while excluding reposts and unsafe media", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(user()).mockResolvedValueOnce(page([
      raw("1", { referenced_tweets: [{ type: "retweeted", id: "20" }] }),
      raw("2", { note_tweet: { text: "Legacy full text" }, referenced_tweets: [{ type: "quoted", id: "21" }], public_metrics: { retweet_count: 8 }, attachments: { media_keys: ["video", "unsafe", "audio"] } }),
      raw("3", { attachments: { poll_ids: ["poll"] } }),
    ], undefined, { includes: { media: [
      { media_key: "video", type: "video", preview_image_url: "https://pbs.twimg.com/a.jpg", variants: [{ url: "https://video.twimg.com/a.mp4", content_type: "video/mp4", bit_rate: 100 }, { url: "http://127.0.0.1/secret.mp4" }] },
      { media_key: "unsafe", type: "photo", url: "https://evil.test/a.jpg" }, { media_key: "audio", type: "audio" },
    ] } }));
    const result = await createFullArchiveSource(token, fetcher)("example", undefined, signal());
    expect(result.posts).toHaveLength(2); expect(result.posts[0]).toMatchObject({ text: "Legacy full text", isQuote: true, reposts: 8, media: [{ variants: [{ url: "https://video.twimg.com/a.mp4" }] }] });
    expect(result.posts[1].hasMedia).toBe(true);
  });
});

describe("unbounded history lifecycle", () => {
  it("collects 3,500 unique posts beyond timeline limits and the configured page budget, then marks the searched period complete", async () => {
    const source = vi.fn<FetchPostsPage>().mockImplementation(async (_username, cursor) => {
      const index = Number(cursor || 0);
      return { profile, posts: Array.from({ length: 500 }, (_, offset) => post(String(index * 500 + offset + 1))), scanned: 500, cursor: index < 6 ? String(index + 1) : undefined, archiveWindow: window };
    });
    const { manager } = await setup(source, "full_archive", 2); await manager.start("example");
    for (let i = 0; i < 7; i++) { await manager.pump(); if (i < 6) expect((await manager.get("example")).status).toBe("queued"); }
    const result = await manager.get("example"); expect(result.posts).toHaveLength(3500); expect(result).toMatchObject({ historyComplete: true, status: "ready", canContinue: false, archiveFrom: joinedAt });
  }, 20000);
  it("continues automatically past page 50 and retains resume progress across a fresh manager", async () => {
    const source = vi.fn<FetchPostsPage>().mockImplementation(async (_name, cursor) => ({ profile, posts: [post(cursor || "1")], scanned: 1, cursor: String(Number(cursor || 1) + 1), archiveWindow: window }));
    const { manager, store } = await setup(source); await manager.start("example");
    for (let i = 0; i < 51; i++) await manager.pump();
    expect((await manager.get("example"))).toMatchObject({ runPages: 51, status: "queued", historyComplete: false }); manager.dispose();
    const nextSource = vi.fn<FetchPostsPage>().mockResolvedValue({ profile, posts: [post("52")], scanned: 1, archiveWindow: window });
    const recovered = new PostsManager(store, nextSource, () => now, false, 50, "full_archive"); managers.push(recovered);
    await recovered.pump(); expect(nextSource.mock.calls[0][1]).toBe("52"); expect((await recovered.get("example"))).toMatchObject({ historyComplete: true, status: "ready" });
  }, 20000);
  it("upgrades a stopped partial timeline without reusing its cursor or deleting saved posts", async () => {
    const { manager, store } = await setup(async () => ({ profile, posts: [post("1")], scanned: 1, cursor: "fx-cursor" }), "timeline", 1);
    await manager.start("example"); await manager.pump(); manager.dispose();
    const source = vi.fn<FetchPostsPage>().mockResolvedValue({ profile, posts: [post("2")], scanned: 1, archiveWindow: window });
    const next = new PostsManager(store, source, () => now, false, 50, "full_archive"); managers.push(next);
    await next.start("example"); expect(source).not.toHaveBeenCalled(); expect((await next.get("example")).canContinue).toBe(true);
    await next.start("example", "collect"); await next.pump(); expect(source.mock.calls[0][1]).toBeUndefined(); expect((await next.get("example")).posts).toHaveLength(2);
  });
  it("follows more than five refresh pages before advancing the completed coverage date", async () => {
    const source = vi.fn<FetchPostsPage>().mockResolvedValueOnce({ profile, posts: [post("1")], scanned: 1, archiveWindow: window });
    const { manager } = await setup(source); await manager.start("example"); await manager.pump();
    const through = "2026-09-09T00:00:00.000Z";
    source.mockImplementation(async (_name, cursor) => { const index = Number(cursor || 0); return { profile, posts: [post(String(index + 2))], scanned: 1, cursor: index < 5 ? String(index + 1) : undefined, archiveWindow: { ...window, through } }; });
    await manager.start("example", "refresh");
    for (let i = 0; i < 5; i++) await manager.pump();
    expect((await manager.get("example"))).toMatchObject({ status: "queued", archiveThrough: window.through });
    await manager.pump(); expect((await manager.get("example"))).toMatchObject({ status: "ready", archiveThrough: through });
  });
  it("stops immediately on access failure, preserves checkpoints, and retries the same page after connection recovery", async () => {
    const source = vi.fn<FetchPostsPage>().mockResolvedValueOnce({ profile, posts: [post("1")], scanned: 1, cursor: "two", archiveWindow: window }).mockRejectedValueOnce(new PostSourceError("access", "Add credits"));
    const { manager, store } = await setup(source); await manager.start("example"); await manager.pump(); await manager.pump();
    expect((await manager.get("example"))).toMatchObject({ status: "failed", retries: 0, historyComplete: false }); expect((await store.load()).accounts.example.cursor).toBe("two");
    source.mockResolvedValueOnce({ profile, posts: [post("2")], scanned: 1, archiveWindow: window });
    await manager.start("example", "continue"); await manager.pump(); expect(source.mock.calls[2][1]).toBe("two"); expect((await manager.get("example")).historyComplete).toBe(true);
  });
  it("keeps repeated pages incomplete and advances coverage only after an entire refresh is saved", async () => {
    const source = vi.fn<FetchPostsPage>().mockResolvedValue({ profile, posts: [post("1")], scanned: 1, cursor: "same", archiveWindow: window });
    const { manager } = await setup(source); await manager.start("example"); await manager.pump(); await manager.pump(); expect((await manager.get("example"))).toMatchObject({ status: "paused", historyComplete: false });
    source.mockResolvedValueOnce({ profile, posts: [post("2")], scanned: 1, archiveWindow: window }); await manager.start("example", "continue"); await manager.pump();
    source.mockResolvedValueOnce({ profile, posts: [post("3")], scanned: 1, cursor: "refresh-next", archiveWindow: { ...window, through: "2026-09-08T00:00:00.000Z" } }); await manager.start("example", "refresh"); await manager.pump();
    expect((await manager.get("example"))).toMatchObject({ historyComplete: true, archiveThrough: window.through });
    expect(source.mock.calls.at(-1)?.[4]?.from).toBe(new Date(Date.parse(window.through) - 7 * 86400000).toISOString());
    source.mockResolvedValueOnce({ profile, posts: [post("4")], scanned: 1, archiveWindow: { ...window, through: "2026-09-08T00:00:00.000Z" } }); await manager.pump();
    expect((await manager.get("example"))).toMatchObject({ historyComplete: true, archiveThrough: "2026-09-08T00:00:00.000Z" });
  });
});

describe("local archive API connection", () => {
  it("stores a token atomically and returns only configuration status", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "posts-connection-")), connection = new PostsConnection(directory, () => undefined);
    expect(await connection.status()).toEqual({ configured: false, source: "full_archive" });
    const secret = "local-test-token-not-real"; const status = await connection.save(secret);
    expect(JSON.stringify(status)).not.toContain(secret); expect(await new PostsConnection(directory).token()).toBe(secret);
    await expect(connection.save("bad\ntoken")).rejects.toThrow(); expect(await connection.token()).toBe(secret);
    await writeFile(connection.file, "broken"); await expect(connection.token()).rejects.toThrow("could not be read"); expect(await readFile(connection.file, "utf8")).toBe("broken");
    await connection.save(secret); expect(await connection.token()).toBe(secret);
  });
  it("uses a dedicated environment token only when no local token was saved", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "posts-connection-env-")), connection = new PostsConnection(directory, () => "environment-test-token");
    expect(await connection.token()).toBe("environment-test-token"); await connection.save("local-test-replacement"); expect(await connection.token()).toBe("local-test-replacement");
  });
});
