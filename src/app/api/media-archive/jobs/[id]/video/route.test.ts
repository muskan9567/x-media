import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/tracker/archive-jobs", () => ({ getArchiveJobs: async () => mocks }));
import { GET } from "./route";
const context = { params: Promise.resolve({ id: "saved-job" }) };
const request = (query = "?item=video-1", range?: string) => new Request(`http://localhost/api/media-archive/jobs/saved-job/video${query}`, { headers: range ? { Range: range } : {} });
const media = (url = "https://video.twimg.com/example.mp4") => ({ id: "video-1", media: { type: "video", variants: [{ url, contentType: "video/mp4", bitRate: 1000 }] } });
beforeEach(() => {
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.get.mockReset().mockResolvedValue({ result: { items: [media()] } });
  mocks.fetch.mockReset().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 206, headers: { "Content-Type": "video/mp4", "Content-Length": "3", "Content-Range": "bytes 0-2/10", "Accept-Ranges": "bytes" } }));
});
afterEach(() => vi.unstubAllGlobals());
describe("saved video streaming", () => {
  it("streams partial bytes and preserves seek headers without forwarding cookies", async () => {
    const response = await GET(request("?item=video-1", "bytes=0-2"), context);
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 0-2/10");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
    expect(mocks.fetch).toHaveBeenCalledWith("https://video.twimg.com/example.mp4", expect.objectContaining({ headers: { Range: "bytes=0-2" }, redirect: "error" }));
  });
  it("rejects unknown attachments, arbitrary hosts and malformed ranges before fetching", async () => {
    expect((await GET(request(""), context)).status).toBe(422);
    expect((await GET(request("?item=missing&url=http://localhost"), context)).status).toBe(404);
    expect((await GET(request("?item=video-1", "bytes=0-1,3-4"), context)).status).toBe(416);
    mocks.get.mockResolvedValue({ result: { items: [media("http://localhost/private.mp4")] } });
    expect((await GET(request(), context)).status).toBe(422);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("handles expired links, non-video responses, bad ranges, and network failures", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response("html", { headers: { "Content-Type": "text/html" } }));
    expect((await GET(request(), context)).status).toBe(502);
    mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 416, headers: { "Content-Range": "bytes */10" } }));
    expect((await GET(request("?item=video-1", "bytes=100-"), context)).headers.get("content-range")).toBe("bytes */10");
    mocks.fetch.mockRejectedValueOnce(new TypeError("network unavailable"));
    expect((await GET(request(), context)).status).toBe(502);
  });
  it("supports full responses and reports missing playable variants", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(new Uint8Array([1]), { headers: { "Content-Type": "video/mp4" } }));
    expect((await GET(request(), context)).status).toBe(200);
    mocks.get.mockResolvedValueOnce({ result: { items: [{ id: "video-1", media: { type: "video", variants: [] } }] } });
    expect((await GET(request(), context)).status).toBe(404);
  });
});
