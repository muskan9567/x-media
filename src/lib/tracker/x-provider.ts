import "server-only";

import { z } from "zod";

import { ApiError } from "../api-response";

import type {
  PostMedia,
  ProviderAccount,
  ProviderTweet,
  TweetMetrics,
  XDataProvider,
} from "./types";

const userMetricsSchema = z
  .object({
    followers_count: z.number().nonnegative(),
    following_count: z.number().nonnegative(),
    post_count: z.number().nonnegative().optional(),
    tweet_count: z.number().nonnegative().optional(),
  })
  .refine(
    (metrics) =>
      metrics.post_count !== undefined || metrics.tweet_count !== undefined,
    "Expected post_count in public_metrics.",
  );

const userSchema = z.object({
  data: z.object({
    id: z.string(),
    username: z.string(),
    name: z.string(),
    description: z.string().optional().default(""),
    profile_image_url: z.string().optional(),
    verified: z.boolean().optional().default(false),
    public_metrics: userMetricsSchema,
  }),
});

const postMetricsSchema = z
  .object({
    repost_count: z.number().nonnegative().optional(),
    retweet_count: z.number().nonnegative().optional(),
    reply_count: z.number().nonnegative(),
    like_count: z.number().nonnegative(),
    quote_count: z.number().nonnegative(),
    bookmark_count: z.number().nonnegative(),
    impression_count: z.number().nonnegative().optional(),
  })
  .refine(
    (metrics) =>
      metrics.repost_count !== undefined || metrics.retweet_count !== undefined,
    "Expected repost_count in public_metrics.",
  );

const postSchema = z.object({
  id: z.string(),
  text: z.string(),
  note_post: z.object({ text: z.string() }).optional(),
  note_tweet: z.object({ text: z.string() }).optional(),
  created_at: z.string(),
  lang: z.string().optional(),
  conversation_id: z.string().optional(),
  possibly_sensitive: z.boolean().optional().default(false),
  reply_settings: z
    .enum(["everyone", "mentionedUsers", "following"])
    .optional(),
  attachments: z
    .object({ media_keys: z.array(z.string()).optional().default([]) })
    .optional(),
  public_metrics: postMetricsSchema,
});

const mediaSchema = z.object({
  media_key: z.string(),
  type: z.enum(["photo", "video", "animated_gif"]),
  url: z.string().url().optional(),
  preview_image_url: z.string().url().optional(),
  alt_text: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  duration_ms: z.number().int().nonnegative().optional(),
  variants: z
    .array(
      z.object({
        url: z.string().url(),
        content_type: z.string().optional(),
        bit_rate: z.number().int().nonnegative().optional(),
      }),
    )
    .optional()
    .default([]),
});

const postsResponseSchema = z.object({
  data: z.array(postSchema).optional().default([]),
  includes: z
    .object({ media: z.array(mediaSchema).optional().default([]) })
    .optional()
    .default({ media: [] }),
});

const xErrorItemSchema = z
  .object({
    code: z.union([z.string(), z.number()]).optional(),
    title: z.string().optional(),
    message: z.string().optional(),
    detail: z.string().optional(),
  })
  .passthrough();

const xErrorSchema = z
  .object({
    code: z.union([z.string(), z.number()]).optional(),
    title: z.string().optional(),
    message: z.string().optional(),
    detail: z.string().optional(),
    errors: z.array(xErrorItemSchema).optional(),
  })
  .passthrough();

function normalizeUsername(username: string): string {
  return username.trim().replace(/^@/, "").toLowerCase();
}

function configuredBaseUrl(): string {
  const rawValue = process.env.X_API_BASE_URL?.trim() || "https://api.x.com/2";
  let url: URL;
  try {
    url = new URL(rawValue);
  } catch {
    throw new Error("X_API_BASE_URL must be a valid absolute URL.");
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      "X_API_BASE_URL cannot contain credentials, a query string, or a fragment.",
    );
  }

  const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  const isSecure = url.protocol === "https:";
  const isLoopbackDevelopment =
    url.protocol === "http:" && loopbackHosts.has(url.hostname);
  if (!isSecure && !isLoopbackDevelopment) {
    throw new Error(
      "X_API_BASE_URL must use HTTPS unless it targets a loopback development server.",
    );
  }

  return url.toString().replace(/\/+$/, "");
}

function accountFromResponse(
  response: z.infer<typeof userSchema>,
): ProviderAccount {
  const metrics = response.data.public_metrics;
  const postCount = metrics.post_count ?? metrics.tweet_count;
  if (postCount === undefined) {
    throw new ApiError("X API omitted the account post count.", 502);
  }

  return {
    source: "x",
    xUserId: response.data.id,
    username: response.data.username.toLowerCase(),
    displayName: response.data.name,
    bio: response.data.description,
    profileImageUrl: response.data.profile_image_url,
    followersCount: metrics.followers_count,
    followingCount: metrics.following_count,
    tweetCount: postCount,
    verified: response.data.verified,
  };
}

function addUserFields(url: URL): void {
  url.searchParams.set(
    "user.fields",
    "description,profile_image_url,public_metrics,verified",
  );
}

function upstreamStatus(status: number): number {
  if (status === 404 || status === 429) return status;
  if (status >= 500) return 503;
  return 502;
}

function errorDetail(body: unknown): string | undefined {
  const parsed = xErrorSchema.safeParse(body);
  if (!parsed.success) return undefined;
  const firstError = parsed.data.errors?.[0];
  return (
    firstError?.detail ??
    firstError?.message ??
    firstError?.title ??
    parsed.data.detail ??
    parsed.data.message ??
    parsed.data.title
  );
}

export class OfficialXProvider implements XDataProvider {
  readonly mode = "x" as const;
  private readonly baseUrl: string;

  constructor(private readonly bearerToken: string) {
    this.baseUrl = configuredBaseUrl();
  }

  private async request<T>(url: URL, schema: z.ZodType<T>): Promise<T> {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.bearerToken}`,
          "User-Agent": "XViralityTracker/0.1",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Network failure";
      throw new ApiError(`Could not reach the X API: ${reason}`, 503);
    }

    const body: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = errorDetail(body);
      const rateReset = Number(response.headers.get("x-rate-limit-reset"));
      const rateHint =
        response.status === 429 && Number.isFinite(rateReset) && rateReset > 0
          ? ` Rate limit resets at ${new Date(rateReset * 1_000).toISOString()}.`
          : "";
      throw new ApiError(
        `X API request failed (${response.status}): ${detail ?? response.statusText}.${rateHint}`,
        upstreamStatus(response.status),
      );
    }

    const envelope = xErrorSchema.safeParse(body);
    if (envelope.success && envelope.data.errors?.length) {
      throw new ApiError(
        `X API returned a partial response: ${errorDetail(body) ?? "One or more requested resources failed."}`,
        502,
      );
    }

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(
        `X API returned an unexpected response: ${parsed.error.message}`,
        502,
      );
    }

    return parsed.data;
  }

  async resolveAccount(usernameInput: string): Promise<ProviderAccount> {
    const username = normalizeUsername(usernameInput);
    const url = new URL(
      `${this.baseUrl}/users/by/username/${encodeURIComponent(username)}`,
    );
    addUserFields(url);

    return accountFromResponse(await this.request(url, userSchema));
  }

  async refreshAccount(account: ProviderAccount): Promise<ProviderAccount> {
    const url = new URL(
      `${this.baseUrl}/users/${encodeURIComponent(account.xUserId)}`,
    );
    addUserFields(url);

    const refreshed = accountFromResponse(await this.request(url, userSchema));
    if (refreshed.xUserId !== account.xUserId) {
      throw new ApiError("X API returned a mismatched account identity.", 502);
    }
    return refreshed;
  }

  async fetchRecentTweets(account: ProviderAccount): Promise<ProviderTweet[]> {
    const url = new URL(`${this.baseUrl}/users/${account.xUserId}/tweets`);
    url.searchParams.set("max_results", "100");
    url.searchParams.set("exclude", "retweets,replies");
    url.searchParams.set(
      "post.fields",
      "attachments,created_at,public_metrics,conversation_id,lang,possibly_sensitive,reply_settings,note_post",
    );
    url.searchParams.set("expansions", "attachments.media_keys");
    url.searchParams.set(
      "media.fields",
      "alt_text,duration_ms,height,media_key,preview_image_url,type,url,variants,width",
    );

    const response = await this.request(url, postsResponseSchema);
    const mediaByKey = new Map(
      response.includes.media.map((media) => [media.media_key, media]),
    );

    return response.data.map((post) => {
      const publicMetrics = post.public_metrics;
      const repostCount =
        publicMetrics.repost_count ?? publicMetrics.retweet_count;
      if (repostCount === undefined) {
        throw new ApiError("X API omitted the repost count.", 502);
      }
      const metrics: TweetMetrics = {
        likeCount: publicMetrics.like_count,
        repostCount,
        replyCount: publicMetrics.reply_count,
        quoteCount: publicMetrics.quote_count,
        bookmarkCount: publicMetrics.bookmark_count,
        viewCount: publicMetrics.impression_count,
      };
      const media: PostMedia[] = (post.attachments?.media_keys ?? []).flatMap(
        (mediaKey) => {
          const item = mediaByKey.get(mediaKey);
          if (!item) return [];
          return [
            {
              mediaKey: item.media_key,
              type: item.type,
              url: item.url,
              previewImageUrl: item.preview_image_url,
              altText: item.alt_text,
              width: item.width,
              height: item.height,
              durationMs: item.duration_ms,
              variants: item.variants.map((variant) => ({
                url: variant.url,
                contentType: variant.content_type,
                bitRate: variant.bit_rate,
              })),
            },
          ];
        },
      );

      return {
        source: "x",
        id: post.id,
        text: post.note_post?.text ?? post.note_tweet?.text ?? post.text,
        createdAt: post.created_at,
        language: post.lang,
        conversationId: post.conversation_id,
        possiblySensitive: post.possibly_sensitive,
        replySettings: post.reply_settings,
        media,
        metrics,
      };
    });
  }
}
