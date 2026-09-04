import { afterEach, describe, expect, it, vi } from "vitest";
import { resolvePostMedia } from "./archive-media-resolver";
import { archiveItemSchema } from "./archive-job-types";
const item = archiveItemSchema.parse({ id: "1:2", postId: "1", postUrl: "https://x.com/example/status/1", postText: "", createdAt: "2026-09-01T00:00:00.000Z", media: { type: "video", mediaKey: "2", variants: [] } });
afterEach(() => vi.unstubAllGlobals());
describe("public video repair", () => {
  it("resolves owned media through syndication with MP4 variants", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ id_str: "1", user: { screen_name: "example" }, mediaDetails: [{ id_str: "2", type: "video", video_info: { variants: [{ url: "https://video.twimg.com/new.mp4", content_type: "video/mp4", bitrate: 100 }] } }] })));
    expect((await resolvePostMedia("example", "1", [item]))[0].media.variants[0].url).toContain("new.mp4");
  });
  it("falls back to FxTwitter after an upstream failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("limited", { status: 429 })).mockResolvedValueOnce(Response.json({ tweet: { id: "1", author: { screen_name: "example" }, media: { all: [{ type: "video", url: "https://video.twimg.com/fallback.mp4" }] } } })));
    expect((await resolvePostMedia("example", "1", [item]))[0].media.variants).toHaveLength(1);
  });
  it("never substitutes a different author's post or an unsafe video URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ id_str: "1", user: { screen_name: "other" }, mediaDetails: [] }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await resolvePostMedia("example", "1", [item])).toEqual([]); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("handles unavailable sources without changing saved metadata", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await resolvePostMedia("example", "1", [item])).toEqual([]);
    expect(await resolvePostMedia("../bad", "1", [item])).toEqual([]);
  });
});
