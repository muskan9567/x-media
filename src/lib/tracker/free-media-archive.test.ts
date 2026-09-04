import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const scraperMocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  getTweets: vi.fn(),
  fetchSearchTweets: vi.fn(),
  setCookies: vi.fn(),
  isLoggedIn: vi.fn(),
}));
const workerMocks = vi.hoisted(() => ({ exec: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("node:util", () => ({ promisify: () => workerMocks.exec }));
vi.mock("@the-convocation/twitter-scraper", () => ({
  ErrorRateLimitStrategy: class ErrorRateLimitStrategy {},
  SearchMode: { Latest: 1 },
  Scraper: class Scraper {
    getProfile = scraperMocks.getProfile;
    getTweets = scraperMocks.getTweets;
    fetchSearchTweets = scraperMocks.fetchSearchTweets;
    setCookies = scraperMocks.setCookies;
    isLoggedIn = scraperMocks.isLoggedIn;
  },
}));

import { fetchFreeMediaArchive } from "./free-media-archive";

beforeEach(() => {
  vi.stubEnv("X_SCRAPER_AUTH_TOKEN", "");
  vi.stubEnv("X_SCRAPER_CT0", "");
  vi.stubEnv("X_SCRAPER_MAX_POSTS", "");
  vi.stubEnv("X_SCRAPER_TIMEOUT_MS", "");
  scraperMocks.getProfile.mockReset().mockResolvedValue({
    username: "Example",
    name: "Example Creator",
    avatar: "https://images.example.test/avatar.jpg",
  });
  scraperMocks.getTweets.mockReset();
  scraperMocks.fetchSearchTweets.mockReset();
  scraperMocks.setCookies.mockReset().mockResolvedValue(undefined);
  scraperMocks.isLoggedIn.mockReset().mockResolvedValue(true);
  workerMocks.exec.mockReset().mockResolvedValue({
    stdout: JSON.stringify({
      ok: true,
      profile: {
        username: "Example",
        name: "Example Creator",
        avatar: "https://images.example.test/avatar.jpg",
      },
      tweets: [],
      yielded: 0,
    }),
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("fetchFreeMediaArchive", () => {
  it.each(["-1", "0", "50001", "1.5", "9007199254740993"])("rejects invalid post limits: %s", async (value) => {
    vi.stubEnv("X_SCRAPER_MAX_POSTS", value);
    await expect(fetchFreeMediaArchive("example")).rejects.toThrow();
    expect(workerMocks.exec).not.toHaveBeenCalled();
  });
  it.each(["bad;cookie", "bad cookie"])("rejects malformed legacy credentials", async (value) => {
    vi.stubEnv("X_SCRAPER_AUTH_TOKEN", value); vi.stubEnv("X_SCRAPER_CT0", "csrf");
    await expect(fetchFreeMediaArchive("example")).rejects.toThrow("invalid characters");
  });
  it.each(["rate_limit", "protected", "upstream"])("reports worker refusal: %s", async (reason) => {
    workerMocks.exec.mockResolvedValue({ stdout: JSON.stringify({ ok: false, reason }) });
    await expect(fetchFreeMediaArchive("example")).rejects.toThrow("Could not collect");
  });
  it.each(["not-json", '{"wrong":true}'])("rejects malformed worker output", async (stdout) => {
    workerMocks.exec.mockResolvedValue({ stdout });
    await expect(fetchFreeMediaArchive("example")).rejects.toThrow("invalid response");
  });
  it.each(["rate limit 429", "protected", "deadline", "offline"])("reports subprocess failures: %s", async (message) => {
    workerMocks.exec.mockRejectedValue(new Error(message));
    await expect(fetchFreeMediaArchive("example")).rejects.toThrow("Could not collect");
  });
  it("rejects expired legacy sessions and handles profile lookup failure", async () => {
    vi.stubEnv("X_SCRAPER_AUTH_TOKEN", "auth"); vi.stubEnv("X_SCRAPER_CT0", "csrf");
    scraperMocks.isLoggedIn.mockResolvedValue(false);
    await expect(fetchFreeMediaArchive("example")).rejects.toThrow("no longer logged in");
    scraperMocks.isLoggedIn.mockResolvedValue(true); scraperMocks.getProfile.mockRejectedValue(new Error("offline"));
    await expect(fetchFreeMediaArchive("example")).rejects.toThrow("Could not load");
  });
  it("stops repeated authenticated cursors, ignores duplicates and excludes other authors", async () => {
    vi.stubEnv("X_SCRAPER_AUTH_TOKEN", "auth"); vi.stubEnv("X_SCRAPER_CT0", "csrf");
    const post = { id: "p", username: "example", text: "video", timeParsed: new Date("2025-01-01"), photos: [], videos: [{ id: "m", preview: "https://pbs.twimg.com/m.jpg" }] };
    scraperMocks.fetchSearchTweets.mockResolvedValue({ tweets: [post, post, { ...post, id: "foreign", username: "other" }, { ...post, id: "rt", isRetweet: true }], next: "same" });
    const result = await fetchFreeMediaArchive("example");
    expect(result.items).toHaveLength(1); expect(result.warning).toContain("repeated search cursor");
    expect(result.items[0].media.variants).toEqual([]);
  });
  it("preserves earlier authenticated batches and fails explicitly before any results", async () => {
    vi.stubEnv("X_SCRAPER_AUTH_TOKEN", "auth"); vi.stubEnv("X_SCRAPER_CT0", "csrf");
    scraperMocks.fetchSearchTweets.mockRejectedValue(new Error("rate limit"));
    await expect(fetchFreeMediaArchive("example")).rejects.toThrow("Could not collect");
    scraperMocks.fetchSearchTweets.mockResolvedValueOnce({ tweets: [{ id: "p", username: "example", text: "", timestamp: 100, photos: [{ id: "photo", url: "https://pbs.twimg.com/p.jpg" }], videos: [] }], next: "next" });
    const result = await fetchFreeMediaArchive("example"); expect(result.items).toHaveLength(1); expect(result.warning).toContain("rate-limited");
  });
  it("collects and sorts every attachment returned by the public timeline", async () => {
    workerMocks.exec.mockResolvedValue({
      stdout: JSON.stringify({
        ok: true,
        profile: {
          username: "Example",
          name: "Example Creator",
          avatar: "https://images.example.test/avatar.jpg",
        },
        yielded: 2,
        tweets: [
        {
          id: "older",
          username: "Example",
          text: "photo and gif",
          createdAt: "2020-01-01T00:00:00.000Z",
          permanentUrl: "https://x.com/Example/status/older",
          photos: [{ id: "photo-1", url: "https://images.example.test/1.jpg" }],
          videos: [
            {
              id: "gif-1",
              preview: "https://images.example.test/gif.jpg",
              url: "https://video.example.test/gif.mp4",
              type: "animated_gif",
            },
          ],
        },
        {
          id: "newer",
          username: "example",
          text: "video",
          timestamp: 1_767_225_600,
          photos: [],
          videos: [
            {
              id: "video-1",
              preview: "https://images.example.test/video.jpg",
              url: "https://video.example.test/video.mp4",
            },
          ],
        },
        ],
      }),
    });

    const result = await fetchFreeMediaArchive("example");

    expect(result).toMatchObject({
      mode: "scraper",
      access: "guest",
      complete: false,
      username: "example",
      postsScanned: 2,
      pagesFetched: 1,
    });
    expect(result.items.map((item) => item.id)).toEqual([
      "newer:video-1",
      "older:photo-1",
      "older:gif-1",
    ]);
    expect(result.items.at(-1)?.media.type).toBe("animated_gif");
    expect(result.warning).toContain("Free public X preview");
  });

  it("uses authenticated search pages when both server-side cookies exist", async () => {
    vi.stubEnv("X_SCRAPER_AUTH_TOKEN", "auth-secret");
    vi.stubEnv("X_SCRAPER_CT0", "csrf-secret");
    scraperMocks.fetchSearchTweets.mockResolvedValue({
      tweets: [
        {
          id: "post-1",
          username: "example",
          text: "photo",
          timeParsed: new Date("2025-01-01T00:00:00.000Z"),
          photos: [{ id: "photo-1", url: "https://images.example.test/1.jpg" }],
          videos: [],
        },
      ],
    });

    const result = await fetchFreeMediaArchive("example");

    expect(scraperMocks.setCookies).toHaveBeenCalledWith([
      "auth_token=auth-secret; Domain=.x.com; Path=/; Secure",
      "ct0=csrf-secret; Domain=.x.com; Path=/; Secure",
    ]);
    expect(scraperMocks.fetchSearchTweets).toHaveBeenCalledWith(
      "from:example filter:media -filter:retweets",
      100,
      1,
      undefined,
    );
    expect(result.access).toBe("cookie");
    expect(JSON.stringify(result)).not.toContain("auth-secret");
    expect(result.warning).toContain("cannot prove");
  });

  it("keeps media collected before a later public-timeline failure", async () => {
    workerMocks.exec.mockResolvedValue({
      stdout: JSON.stringify({
        ok: true,
        profile: { username: "example", name: "Example Creator" },
        yielded: 1,
        stopReason: "X rate-limited the collector after returning partial results",
        tweets: [{
          id: "post-1",
          username: "example",
          text: "photo",
          createdAt: "2025-01-01T00:00:00.000Z",
          photos: [{ id: "photo-1", url: "https://images.example.test/1.jpg" }],
          videos: [],
        }],
      }),
    });

    const result = await fetchFreeMediaArchive("example");

    expect(result.items).toHaveLength(1);
    expect(result.postsScanned).toBe(1);
    expect(result.warning).toContain("rate-limited");
  });

  it("rejects incomplete cookie configuration before making a request", async () => {
    vi.stubEnv("X_SCRAPER_AUTH_TOKEN", "auth-secret");
    vi.stubEnv("X_SCRAPER_CT0", "");

    await expect(fetchFreeMediaArchive("example")).rejects.toThrow(
      "must be configured together",
    );
    expect(scraperMocks.getProfile).not.toHaveBeenCalled();
  });
});
