import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./free-media-archive", () => ({
  fetchFreeMediaArchive: vi.fn(),
}));

import { fetchFreeMediaArchive } from "./free-media-archive";
import { fetchMediaArchive } from "./media-archive";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.mocked(fetchFreeMediaArchive).mockReset();
});

describe("fetchMediaArchive", () => {
  it.each(["bad", "http://remote.test", "https://secret@api.test", "https://api.test/?key=x"])("rejects unsafe legacy API base URLs: %s", async (url) => {
    vi.stubEnv("X_BEARER_TOKEN", "secret"); vi.stubEnv("X_API_BASE_URL", url);
    await expect(fetchMediaArchive("example")).rejects.toThrow();
  });
  it("rejects malformed usernames", async () => { await expect(fetchMediaArchive("../x")).rejects.toThrow("valid X username"); });
  it.each([401, 403, 404, 429, 500])("preserves upstream error information for status %s", async (status) => {
    vi.stubEnv("X_BEARER_TOKEN", "secret");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ errors: [{ detail: "upstream detail" }] }, status)));
    await expect(fetchMediaArchive("example")).rejects.toThrow("upstream detail");
  });
  it("handles network and malformed API responses", async () => {
    vi.stubEnv("X_BEARER_TOKEN", "secret");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(fetchMediaArchive("example")).rejects.toThrow("Could not reach");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ broken: true })));
    await expect(fetchMediaArchive("example")).rejects.toThrow("unexpected response");
  });
  it("stops repeated archive tokens without duplicating media", async () => {
    vi.stubEnv("X_BEARER_TOKEN", "secret");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ data: { id: "1", username: "example", name: "Example" } }))
      .mockImplementation(async () => jsonResponse({ data: [{ id: "p", text: "short", note_tweet: { text: "full" }, created_at: "2025-01-01T00:00:00.000Z", attachments: { media_keys: ["m", "missing"] } }], includes: { media: [{ media_key: "m", type: "photo", url: "https://pbs.twimg.com/p.jpg" }] }, meta: { next_token: "same" } })));
    const result = await fetchMediaArchive("example"); expect(result.items).toHaveLength(1); expect(result.items[0].postText).toBe("full"); expect(result.warning).toContain("repeated page token");
  });
  it("uses the free live collector when the official X API is not configured", async () => {
    vi.stubEnv("X_BEARER_TOKEN", "");
    vi.mocked(fetchFreeMediaArchive).mockResolvedValue({
      mode: "scraper",
      access: "guest",
      complete: false,
      username: "sample_creator",
      displayName: "Sample Creator",
      items: [],
      postsScanned: 0,
      pagesFetched: 0,
    });

    const result = await fetchMediaArchive("@sample_creator");

    expect(fetchFreeMediaArchive).toHaveBeenCalledWith("sample_creator");
    expect(result.mode).toBe("scraper");
  });

  it("reuses a recent free result instead of spending another X request", async () => {
    vi.stubEnv("X_BEARER_TOKEN", "");
    vi.mocked(fetchFreeMediaArchive).mockResolvedValue({
      mode: "scraper",
      access: "guest",
      complete: false,
      username: "cached_user",
      displayName: "Cached User",
      items: [],
      postsScanned: 0,
      pagesFetched: 0,
    });

    const first = await fetchMediaArchive("cached_user");
    const second = await fetchMediaArchive("@cached_user");

    expect(second).toBe(first);
    expect(fetchFreeMediaArchive).toHaveBeenCalledTimes(1);
  });

  it("paginates full-archive search and preserves every attachment", async () => {
    vi.stubEnv("X_BEARER_TOKEN", "secret");
    vi.stubEnv("X_API_BASE_URL", "https://api.example.test/2");
    const requests: URL[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      requests.push(url);
      if (url.pathname.endsWith("/users/by/username/example")) {
        return jsonResponse({
          data: {
            id: "user-1",
            username: "Example",
            name: "Example Creator",
            profile_image_url: "https://images.example.test/avatar.jpg",
          },
        });
      }
      if (!url.searchParams.has("pagination_token")) {
        return jsonResponse({
          data: [
            {
              id: "post-2",
              text: "two photos",
              created_at: "2026-08-03T12:00:00.000Z",
              attachments: { media_keys: ["photo-1", "photo-2"] },
            },
          ],
          includes: {
            media: [
              { media_key: "photo-1", type: "photo", url: "https://images.example.test/1.jpg" },
              { media_key: "photo-2", type: "photo", url: "https://images.example.test/2.jpg" },
            ],
          },
          meta: { next_token: "page-two" },
        });
      }
      return jsonResponse({
        data: [
          {
            id: "post-1",
            text: "a video",
            created_at: "2020-01-01T00:00:00.000Z",
            attachments: { media_keys: ["video-1"] },
          },
        ],
        includes: {
          media: [
            {
              media_key: "video-1",
              type: "video",
              preview_image_url: "https://images.example.test/video.jpg",
              variants: [
                {
                  url: "https://video.example.test/video.mp4",
                  content_type: "video/mp4",
                  bit_rate: 832000,
                },
              ],
            },
          ],
        },
        meta: {},
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchMediaArchive("example");

    expect(result.mode).toBe("x");
    expect(result.complete).toBe(true);
    expect(result.pagesFetched).toBe(2);
    expect(result.postsScanned).toBe(2);
    expect(result.items.map((item) => item.media.mediaKey)).toEqual([
      "photo-1",
      "photo-2",
      "video-1",
    ]);
    expect(result.items[2].media.variants[0]).toEqual({
      url: "https://video.example.test/video.mp4",
      contentType: "video/mp4",
      bitRate: 832000,
    });

    const searches = requests.filter((url) => url.pathname.endsWith("/tweets/search/all"));
    expect(searches).toHaveLength(2);
    expect(searches[0].searchParams.get("query")).toBe(
      "from:example has:media -is:retweet",
    );
    expect(searches[0].searchParams.get("max_results")).toBe("500");
    expect(searches[1].searchParams.get("pagination_token")).toBe("page-two");
  });

  it("keeps earlier pages and labels a later request failure as partial", async () => {
    vi.stubEnv("X_BEARER_TOKEN", "secret");
    vi.stubEnv("X_API_BASE_URL", "https://api.example.test/2");
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call += 1;
        if (call === 1) {
          return jsonResponse({
            data: { id: "1", username: "example", name: "Example" },
          });
        }
        if (call === 2) {
          return jsonResponse({
            data: [
              {
                id: "post-1",
                text: "photo",
                created_at: "2025-01-01T00:00:00.000Z",
                attachments: { media_keys: ["photo-1"] },
              },
            ],
            includes: {
              media: [
                { media_key: "photo-1", type: "photo", url: "https://images.example.test/1.jpg" },
              ],
            },
            meta: { next_token: "next" },
          });
        }
        return jsonResponse({ title: "Too Many Requests" }, 429);
      }),
    );

    const result = await fetchMediaArchive("example");

    expect(result.complete).toBe(false);
    expect(result.items).toHaveLength(1);
    expect(result.warning).toContain("stopped after 1 page");
  });
});
