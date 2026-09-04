import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { OfficialXProvider } from "./x-provider";
import type { ProviderAccount } from "./types";

function jsonResponse(
  body: unknown,
  init: ResponseInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("OfficialXProvider", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>());
    process.env.X_API_BASE_URL = "https://api.example.test/2/";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.X_API_BASE_URL;
  });

  it("resolves an account through the official user endpoint", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: {
          id: "42",
          username: "SignalDesk",
          name: "Signal Desk",
          description: "AI and product research",
          profile_image_url: "https://images.example.test/avatar.jpg",
          verified: true,
          public_metrics: {
            followers_count: 12_345,
            following_count: 321,
            post_count: 987,
          },
        },
      }),
    );

    const provider = new OfficialXProvider("secret-token");
    const result = await provider.resolveAccount("@SignalDesk");

    expect(result).toEqual({
      source: "x",
      xUserId: "42",
      username: "signaldesk",
      displayName: "Signal Desk",
      bio: "AI and product research",
      profileImageUrl: "https://images.example.test/avatar.jpg",
      followersCount: 12_345,
      followingCount: 321,
      tweetCount: 987,
      verified: true,
    });

    const [requestUrl, requestInit] = fetchMock.mock.calls[0];
    const url = new URL(String(requestUrl));
    expect(url.origin + url.pathname).toBe(
      "https://api.example.test/2/users/by/username/signaldesk",
    );
    expect(url.searchParams.get("user.fields")).toContain("public_metrics");
    expect(requestInit?.headers).toMatchObject({
      Authorization: "Bearer secret-token",
    });
    expect(requestInit?.cache).toBe("no-store");
  });

  it("refreshes an account by immutable user ID and accepts a renamed handle", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: {
          id: "42",
          username: "RenamedDesk",
          name: "Renamed Desk",
          description: "Updated profile",
          verified: false,
          public_metrics: {
            followers_count: 20_000,
            following_count: 400,
            post_count: 1_200,
          },
        },
      }),
    );
    const provider = new OfficialXProvider("secret-token");
    const existing: ProviderAccount = {
      source: "x",
      xUserId: "42",
      username: "oldhandle",
      displayName: "Old name",
      bio: "",
      followersCount: 100,
      followingCount: 10,
      tweetCount: 20,
      verified: false,
    };

    const refreshed = await provider.refreshAccount(existing);

    expect(refreshed).toMatchObject({
      xUserId: "42",
      username: "renameddesk",
      displayName: "Renamed Desk",
    });
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe(
      "https://api.example.test/2/users/42",
    );
  });

  it("maps recent post metrics and requests only original posts", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [
          {
            id: "post-1",
            text: "A useful product insight…",
            note_post: { text: "A useful product insight with the full context" },
            created_at: "2026-08-23T10:00:00.000Z",
            lang: "en",
            conversation_id: "conversation-1",
            possibly_sensitive: false,
            reply_settings: "mentionedUsers",
            attachments: {
              media_keys: ["3_photo", "7_video"],
            },
            public_metrics: {
              repost_count: 12,
              reply_count: 7,
              like_count: 90,
              quote_count: 3,
              bookmark_count: 8,
              impression_count: 5_000,
            },
          },
        ],
        includes: {
          media: [
            {
              media_key: "7_video",
              type: "video",
              preview_image_url: "https://images.example.test/video.jpg",
              width: 1920,
              height: 1080,
              duration_ms: 42_000,
              variants: [
                {
                  url: "https://video.example.test/high.mp4",
                  content_type: "video/mp4",
                  bit_rate: 2_000_000,
                },
              ],
            },
            {
              media_key: "3_photo",
              type: "photo",
              url: "https://images.example.test/photo.jpg",
              alt_text: "A dashboard on a laptop",
              width: 1200,
              height: 800,
            },
          ],
        },
      }),
    );

    const account: ProviderAccount = {
      source: "x",
      xUserId: "42",
      username: "signaldesk",
      displayName: "Signal Desk",
      bio: "",
      followersCount: 100,
      followingCount: 10,
      tweetCount: 20,
      verified: false,
    };
    const provider = new OfficialXProvider("secret-token");
    const result = await provider.fetchRecentTweets(account);

    expect(result).toEqual([
      {
        source: "x",
        id: "post-1",
        text: "A useful product insight with the full context",
        createdAt: "2026-08-23T10:00:00.000Z",
        language: "en",
        conversationId: "conversation-1",
        possiblySensitive: false,
        replySettings: "mentionedUsers",
        media: [
          {
            mediaKey: "3_photo",
            type: "photo",
            url: "https://images.example.test/photo.jpg",
            previewImageUrl: undefined,
            altText: "A dashboard on a laptop",
            width: 1200,
            height: 800,
            durationMs: undefined,
            variants: [],
          },
          {
            mediaKey: "7_video",
            type: "video",
            url: undefined,
            previewImageUrl: "https://images.example.test/video.jpg",
            altText: undefined,
            width: 1920,
            height: 1080,
            durationMs: 42_000,
            variants: [
              {
                url: "https://video.example.test/high.mp4",
                contentType: "video/mp4",
                bitRate: 2_000_000,
              },
            ],
          },
        ],
        metrics: {
          likeCount: 90,
          repostCount: 12,
          replyCount: 7,
          quoteCount: 3,
          bookmarkCount: 8,
          viewCount: 5_000,
        },
      },
    ]);

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe("/2/users/42/tweets");
    expect(url.searchParams.get("max_results")).toBe("100");
    expect(url.searchParams.get("exclude")).toBe("retweets,replies");
    expect(url.searchParams.get("post.fields")).toContain("public_metrics");
    expect(url.searchParams.get("post.fields")).toContain("reply_settings");
    expect(url.searchParams.get("post.fields")).toContain("note_post");
    expect(url.searchParams.get("post.fields")).toContain("attachments");
    expect(url.searchParams.get("expansions")).toBe("attachments.media_keys");
    expect(url.searchParams.get("media.fields")).toContain("variants");
  });

  it("surfaces structured API errors and rate-limit reset time", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { title: "Too Many Requests", detail: "Project quota exhausted" },
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "x-rate-limit-reset": "1787486400",
          },
        },
      ),
    );

    const provider = new OfficialXProvider("secret-token");

    await expect(provider.resolveAccount("signaldesk")).rejects.toThrow(
      /429.*Project quota exhausted.*Rate limit resets at/i,
    );
  });

  it("rejects partial successful responses instead of persisting false zeros", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        data: [
          {
            id: "post-1",
            text: "Partial post",
            created_at: "2026-08-23T10:00:00.000Z",
            public_metrics: {
              repost_count: 1,
              reply_count: 1,
              like_count: 1,
              quote_count: 1,
              bookmark_count: 1,
            },
          },
        ],
        errors: [{ code: "resource-not-found", message: "One post failed" }],
      }),
    );
    const provider = new OfficialXProvider("secret-token");
    const account: ProviderAccount = {
      source: "x",
      xUserId: "42",
      username: "signaldesk",
      displayName: "Signal Desk",
      bio: "",
      followersCount: 100,
      followingCount: 10,
      tweetCount: 20,
      verified: false,
    };

    await expect(provider.fetchRecentTweets(account)).rejects.toMatchObject({
      message: expect.stringMatching(/partial response.*One post failed/i),
      status: 502,
    });
  });

  it("rejects posts that omit requested public metrics", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        data: [
          {
            id: "post-1",
            text: "Metrics unavailable",
            created_at: "2026-08-23T10:00:00.000Z",
          },
        ],
      }),
    );
    const provider = new OfficialXProvider("secret-token");
    const account: ProviderAccount = {
      source: "x",
      xUserId: "42",
      username: "signaldesk",
      displayName: "Signal Desk",
      bio: "",
      followersCount: 100,
      followingCount: 10,
      tweetCount: 20,
      verified: false,
    };

    await expect(provider.fetchRecentTweets(account)).rejects.toMatchObject({
      message: expect.stringMatching(/unexpected response/i),
      status: 502,
    });
  });

  it("preserves documented top-level messages and upstream status mapping", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(
        { code: "upstream-failure", message: "X is temporarily unavailable" },
        { status: 500 },
      ),
    );
    const provider = new OfficialXProvider("secret-token");

    await expect(provider.resolveAccount("signaldesk")).rejects.toMatchObject({
      message: expect.stringMatching(/X is temporarily unavailable/i),
      status: 503,
    });
  });

  it.each([
    ["malformed", "not a URL"],
    ["plaintext remote", "http://api.example.test/2"],
    ["embedded credentials", "https://user:pass@api.example.test/2"],
    ["query parameters", "https://api.example.test/2?token=value"],
    ["fragments", "https://api.example.test/2#fragment"],
  ])("rejects a %s X API base URL", (_label, baseUrl) => {
    process.env.X_API_BASE_URL = baseUrl;

    expect(() => new OfficialXProvider("secret-token")).toThrow(
      /X_API_BASE_URL/,
    );
  });

  it("allows plaintext only for an explicit loopback development endpoint", () => {
    process.env.X_API_BASE_URL = "http://127.0.0.1:8787/2/";

    expect(() => new OfficialXProvider("secret-token")).not.toThrow();
  });

  it("rejects an unexpected successful response shape", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ data: null }));
    const provider = new OfficialXProvider("secret-token");

    await expect(provider.resolveAccount("signaldesk")).rejects.toThrow(
      /unexpected response/i,
    );
  });
});
