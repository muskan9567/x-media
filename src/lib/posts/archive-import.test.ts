import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { archiveImportSchema, parseArchiveFiles } from "./archive-import";
import { PostsManager } from "./manager";
import { PostsStore } from "./store";
import type { FetchPostsPage } from "./source";

const now = "2026-09-08T12:00:00.000Z";
const account = { name: "account.js", text: 'window.YTD.account.part0 = [{"account":{"accountId":"123","username":"Example","accountDisplayName":"Example","email":"private@example.test"}}];' };
const tweet = (changes = {}) => ({ id_str: "2099999999999999999", full_text: "Build &amp; learn 👩‍💻", created_at: "Mon Jan 02 12:00:00 +0000 2023", favorite_count: "42", retweet_count: "3", ...changes });
const file = (rows = [tweet()], name = "tweets.js") => ({ name, text: `window.YTD.tweets.part0 = ${JSON.stringify(rows.map(tweet => ({ tweet })))};` });
const parsed = () => parseArchiveFiles([account, file()], now);
const managers: PostsManager[] = [];
afterEach(() => { managers.splice(0).forEach(manager => manager.dispose()); });
async function setup(source = vi.fn<FetchPostsPage>().mockResolvedValue({ profile: parsed().profile, posts: parsed().posts, scanned: 1 })) {
  const store = new PostsStore(await mkdtemp(path.join(os.tmpdir(), "x-media-free-posts-")));
  const manager = new PostsManager(store, source, () => Date.parse(now), false); managers.push(manager);
  return { store, manager, source };
}

describe("free archive import", () => {
  it("reads X assignments as data, preserves string IDs, and strips personal account details", () => {
    const result = parsed();
    expect(result.profile).toMatchObject({ id: "123", username: "example" });
    expect(JSON.stringify(result)).not.toContain("private@example.test");
    expect(result.posts[0]).toMatchObject({ id: "2099999999999999999", text: "Build & learn 👩‍💻", likes: 42, reposts: 3, views: null, replies: null, characterCount: 15 });
  });
  it("merges multipart data, deduplicates, excludes reposts, and identifies replies and quote links", () => {
    const result = parseArchiveFiles([account, file([tweet(), tweet({ id_str: "2", full_text: "RT @someone: repost" }), tweet({ id_str: "3", in_reply_to_status_id_str: "1" })]),
      file([tweet(), tweet({ id_str: "4", entities: { urls: [{ expanded_url: "https://x.com/other/status/2" }] } })], "tweets-part1.js")], now);
    expect(result.posts.map(post => post.id)).toEqual(["2099999999999999999", "3", "4"]);
    expect(result.posts[1].isReply).toBe(true); expect(result.posts[2].isQuote).toBe(true);
  });
  it("keeps supported media and excludes unsafe URLs", () => {
    const result = parseArchiveFiles([account, file([tweet({ extended_entities: { media: [
      { type: "photo", media_url_https: "https://pbs.twimg.com/image.jpg" },
      { type: "video", media_url_https: "https://pbs.twimg.com/preview.jpg", video_info: { variants: [{ url: "https://video.twimg.com/movie.mp4", content_type: "video/mp4" }] } },
      { type: "photo", media_url_https: "http://127.0.0.1/private" },
    ] } })])], now);
    expect(result.posts[0].media).toHaveLength(2); expect(result.posts[0].hasMedia).toBe(true);
  });
  it("roundtrips exports and rejects mixed account identities", () => {
    const archive = parsed(); expect(parseArchiveFiles([{ name: "example-tweets.json", text: JSON.stringify(archive) }])).toEqual(archive);
    archive.posts[0].authorId = "456"; expect(archiveImportSchema.safeParse(archive).success).toBe(false);
  });
  it("rejects missing account data, invalid rows, unsafe IDs, and executable content", () => {
    expect(() => parseArchiveFiles([file()])).toThrow("account.js");
    for (const rows of [[tweet({ created_at: "bad" })], [tweet({ id_str: 2099999999999999999 })]]) expect(() => parseArchiveFiles([account, file(rows)])).toThrow();
    expect(() => parseArchiveFiles([account, { name: "tweets.js", text: 'window.YTD.tweets.part0 = []; throw Error("executed")' }])).toThrow("could not read");
    expect(() => parseArchiveFiles([account, file(), { name: "direct-messages.js", text: "[]" }])).toThrow("only account.js");
  });
  it("imports offline, preserves existing metrics, deduplicates repeated imports, and persists", async () => {
    const { manager, store, source } = await setup(); const archive = parsed();
    const first = await manager.importArchive(archive); expect(source).not.toHaveBeenCalled(); expect(first.historyComplete).toBe(false);
    archive.posts[0].likes = 1;
    const again = await manager.importArchive(archive);
    expect(again.posts).toHaveLength(1); expect(again.posts[0].likes).toBe(42); expect(again.message).toContain("0 new tweets");
    const reloaded = new PostsManager(store, source, Date.now, false); managers.push(reloaded);
    expect((await reloaded.get("example")).posts).toEqual(first.posts);
  });
  it("rejects import during collection and rejects an account-ID collision without modifying storage", async () => {
    const { manager, store } = await setup(); await manager.start("example");
    await expect(manager.importArchive(parsed())).rejects.toThrow("Stop collection");
    await manager.pump(); const before = await store.load();
    const wrong = parsed(); wrong.profile.id = "456"; wrong.posts[0].authorId = "456";
    await expect(manager.importArchive(wrong)).rejects.toThrow("different account ID");
    expect(await store.load()).toEqual(before);
  });
  it("reopens an empty imported archive without starting network collection", async () => {
    const { manager, source } = await setup();
    const archive = parsed(); archive.posts = [];
    await manager.importArchive(archive);
    expect((await manager.start("example")).status).toBe("ready");
    await manager.pump();
    expect(source).not.toHaveBeenCalled();
  });
  it("migrates paid jobs without reusing their cursors or losing saved tweets", async () => {
    const { manager, store, source } = await setup(); await manager.importArchive(parsed()); manager.dispose();
    const state = await store.load(); Object.assign(state.accounts.example, { source: "full_archive", cursor: "paid-cursor", refreshCursor: "paid-refresh", status: "failed", historyComplete: true, exhausted: true, pages: 90 }); await store.save(state);
    const free = new PostsManager(store, source, () => Date.parse(now), false); managers.push(free);
    const migrated = await free.get("example"); expect(migrated).toMatchObject({ source: "timeline", status: "paused", historyComplete: false, pages: 0, canContinue: true }); expect(migrated.posts).toHaveLength(1);
    await free.start("example", "continue"); await free.pump(); expect(source.mock.calls[0][1]).toBeUndefined();
  });
});
