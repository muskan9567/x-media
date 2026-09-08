import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const service = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/posts/service", () => ({ getPostsService: async () => service }));
import { GET } from "./route";
const videoUrl = "https://video.twimg.com/test.mp4";
const media = { mediaKey: "video-1", type: "video", variants: [{ url: videoUrl, contentType: "video/mp4", bitRate: 300 }, { url: "https://video.twimg.com/low.mp4", contentType: "video/mp4", bitRate: 100 }] };
const request = (query = "username=example&post=123&media=video-1", range?: string) => new Request(`http://localhost/api/posts/video?${query}`, { headers: range ? { Range: range } : {} });
beforeEach(() => { vi.resetAllMocks(); service.get.mockResolvedValue({ posts: [{ id: "123", media: [media] }] }); });
afterEach(() => vi.unstubAllGlobals());
describe("saved tweet video playback", () => {
  it("streams only a saved MP4 and forwards byte ranges for seeking", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("movie", { status: 206, headers: { "Content-Type": "video/mp4", "Content-Range": "bytes 0-4/90", "Content-Length": "5", "Accept-Ranges": "bytes" } })); vi.stubGlobal("fetch", fetcher);
    const response = await GET(request(undefined, "bytes=0-4"));
    expect(response.status).toBe(206); expect(await response.text()).toBe("movie"); expect(response.headers.get("content-range")).toBe("bytes 0-4/90");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff"); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(fetcher).toHaveBeenCalledWith(videoUrl, expect.objectContaining({ headers: { Range: "bytes=0-4" }, redirect: "error" }));
  });
  it("rejects malformed selections, ranges, unknown attachments and arbitrary URLs", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    expect((await GET(request("username=../bad&post=123&media=video-1"))).status).toBe(422);
    expect((await GET(request("username=example&url=https://evil.test"))).status).toBe(422);
    expect((await GET(request(undefined, "bytes=0-1,2-3"))).status).toBe(416);
    expect((await GET(request("username=example&post=321&media=video-1"))).status).toBe(404);
    service.get.mockResolvedValue({ posts: [{ id: "123", media: [{ ...media, type: "photo" }] }] });
    expect((await GET(request())).status).toBe(404);
    service.get.mockResolvedValue({ posts: [{ id: "123", media: [{ ...media, variants: [{ url: "https://evil.test/a.mp4", contentType: "video/mp4" }] }] }] });
    expect((await GET(request())).status).toBe(422); expect(fetcher).not.toHaveBeenCalled();
  });
  it("propagates unsatisfiable ranges and rejects expired or non-video responses", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 416, headers: { "Content-Range": "bytes */90" } })).mockResolvedValueOnce(new Response("denied", { status: 403 })).mockResolvedValueOnce(new Response("html", { headers: { "Content-Type": "text/html" } })); vi.stubGlobal("fetch", fetcher);
    const range = await GET(request(undefined, "bytes=100-")); expect(range.status).toBe(416); expect(range.headers.get("content-range")).toBe("bytes */90");
    expect((await GET(request())).status).toBe(502); expect((await GET(request())).status).toBe(502);
  });
  it("handles network failures and missing playable links", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network")));
    expect((await GET(request())).status).toBe(502);
    service.get.mockResolvedValue({ posts: [{ id: "123", media: [{ ...media, variants: [] }] }] }); expect((await GET(request())).status).toBe(404);
    service.get.mockRejectedValue(Object.assign(new Error("Account not found"), { name: "ApiError", status: 404 })); expect((await GET(request())).status).toBe(404);
  });
});
