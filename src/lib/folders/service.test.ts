import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ get: vi.fn(), service: vi.fn() }));
vi.mock("@/lib/tracker/archive-jobs", () => ({ getArchiveJobs: async () => ({ get: mocks.get }) }));
vi.mock("@/lib/reddit/service", () => ({ getRedditService: mocks.service }));
import { resolveFolderMedia } from "./service";

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe("authoritative folder snapshots", () => {
  it("resolves X attachments from the saved job, retaining playback metadata", async () => {
    const archive = { id: "123:photo", postText: "A saved photo", postUrl: "https://x.com/example/status/123", media: { type: "photo", url: "https://pbs.twimg.com/media/photo.jpg" } };
    mocks.get.mockResolvedValue({ result: { username: "example", items: [archive] } });
    const result = await resolveFolderMedia({ source: "x", id: archive.id, jobId: "de565169-3319-46d1-8916-624e791846ff" });
    expect(result.item.archive).toEqual(archive); expect(result.item.creator).toBe("@example"); expect(result.item.previewUrl).toBe(archive.media.url); expect(result.bytes).toBeUndefined();
  });
  it("rejects X media missing from its saved collection", async () => {
    mocks.get.mockResolvedValue({ result: { items: [] } });
    await expect(resolveFolderMedia({ source: "x", id: "absent", jobId: "de565169-3319-46d1-8916-624e791846ff" })).rejects.toThrow("no longer");
  });
  it("copies the Reddit original through the trusted local service and keeps a stable folder URL", async () => {
    mocks.service.mockResolvedValue({ origin: "http://127.0.0.1:4100" });
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ meme: { title: "Meme", subreddit: "coding", permalink: "https://www.reddit.com/comments/abc123", originalUrl: "http://untrusted.example/image" } })).mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/webp" } }));
    vi.stubGlobal("fetch", fetcher);
    const result = await resolveFolderMedia({ source: "reddit", id: "abc123" });
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(["http://127.0.0.1:4100/api/memes/abc123", "http://127.0.0.1:4100/api/images/abc123"]);
    expect(result.item.previewUrl).toBe("/api/folders/assets/reddit%3Aabc123"); expect(result.item.asset?.mime).toBe("image/webp"); expect([...result.bytes!]).toEqual([1, 2, 3]);
  });
  it("does not save an unavailable Reddit record", async () => {
    mocks.service.mockResolvedValue({ origin: "http://127.0.0.1:4100" }); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));
    await expect(resolveFolderMedia({ source: "reddit", id: "gone" })).rejects.toThrow("unavailable");
  });
  it.each(["text/html", "image/svg+xml", "application/octet-stream"])("rejects non-image or active content: %s", async mime => {
    mocks.service.mockResolvedValue({ origin: "http://127.0.0.1:4100" }); vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ meme: {} })).mockResolvedValueOnce(new Response("unexpected", { headers: { "content-type": mime } })));
    await expect(resolveFolderMedia({ source: "reddit", id: "bad" })).rejects.toThrow("could not be saved");
  });
  it("rejects an empty original instead of recording a broken placement", async () => {
    mocks.service.mockResolvedValue({ origin: "http://127.0.0.1:4100" }); vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ meme: {} })).mockResolvedValueOnce(new Response(new Uint8Array(), { headers: { "content-type": "image/png" } })));
    await expect(resolveFolderMedia({ source: "reddit", id: "empty" })).rejects.toThrow("empty");
  });
});
