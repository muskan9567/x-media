import "server-only";

import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import {
  ErrorRateLimitStrategy,
  Scraper,
  SearchMode,
  type Profile,
  type Tweet,
} from "@the-convocation/twitter-scraper";
import { z } from "zod";

import { ApiError } from "../api-response";

import type {
  ArchiveMediaItem,
  MediaArchiveResult,
} from "./media-archive";
import type { PostMedia, PostMediaType } from "./types";

const DEFAULT_MAX_POSTS = 10_000;
const DEFAULT_TIMEOUT_MS = 90_000;
const execFileAsync = promisify(execFile);

const workerResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(false), reason: z.string() }),
  z.object({
    ok: z.literal(true),
    profile: z.object({
      username: z.string().optional(),
      name: z.string().optional(),
      avatar: z.string().optional(),
    }),
    tweets: z.array(
      z.object({
        id: z.string(),
        username: z.string().optional(),
        text: z.string().optional(),
        createdAt: z.string().optional(),
        timestamp: z.number().optional(),
        permanentUrl: z.string().optional(),
        isRetweet: z.boolean().optional(),
        retweetedStatusId: z.string().optional(),
        photos: z.array(
          z.object({
            id: z.string(),
            url: z.string(),
            alt_text: z.string().optional(),
          }),
        ),
        videos: z.array(
          z.object({
            id: z.string(),
            preview: z.string(),
            url: z.string().optional(),
            type: z.enum(["video", "animated_gif"]).optional(),
          }),
        ),
      }),
    ),
    yielded: z.number().int().nonnegative(),
    stopReason: z.string().optional(),
  }),
]);

function positiveInteger(name: string, fallback: number, maximum: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new ApiError(`${name} must be a positive base-10 integer.`, 500);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new ApiError(`${name} must be between 1 and ${maximum}.`, 500);
  }
  return value;
}

function settings() {
  const authToken = process.env.X_SCRAPER_AUTH_TOKEN?.trim() || undefined;
  const csrfToken = process.env.X_SCRAPER_CT0?.trim() || undefined;
  if (Boolean(authToken) !== Boolean(csrfToken)) {
    throw new ApiError(
      "X_SCRAPER_AUTH_TOKEN and X_SCRAPER_CT0 must be configured together.",
      500,
    );
  }
  if (
    (authToken && /[\s;\u0000-\u001f\u007f]/.test(authToken)) ||
    (csrfToken && /[\s;\u0000-\u001f\u007f]/.test(csrfToken))
  ) {
    throw new ApiError("X scraper cookie values contain invalid characters.", 500);
  }
  return {
    authToken,
    csrfToken,
    maxPosts: positiveInteger("X_SCRAPER_MAX_POSTS", DEFAULT_MAX_POSTS, 50_000),
    timeoutMs: positiveInteger("X_SCRAPER_TIMEOUT_MS", DEFAULT_TIMEOUT_MS, 300_000),
  };
}

function archiveDates(items: ArchiveMediaItem[]) {
  if (items.length === 0) return {};
  return { newestAt: items[0].createdAt, oldestAt: items.at(-1)?.createdAt };
}

function createdAt(tweet: Tweet): string {
  if (tweet.timeParsed && !Number.isNaN(tweet.timeParsed.getTime())) {
    return tweet.timeParsed.toISOString();
  }
  if (tweet.timestamp && Number.isFinite(tweet.timestamp)) {
    return new Date(tweet.timestamp * 1_000).toISOString();
  }
  return new Date(0).toISOString();
}

function rawMediaType(tweet: Tweet, mediaId: string): PostMediaType | undefined {
  const type = tweet.__raw_UNSTABLE?.extended_entities?.media?.find(
    (media) => media.id_str === mediaId,
  )?.type;
  return type === "photo" || type === "video" || type === "animated_gif"
    ? type
    : undefined;
}

function mediaItems(tweet: Tweet, username: string): ArchiveMediaItem[] {
  if (!tweet.id) return [];
  const common = {
    postId: tweet.id,
    postUrl: tweet.permanentUrl ?? `https://x.com/${username}/status/${tweet.id}`,
    postText: tweet.text ?? "",
    createdAt: createdAt(tweet),
  };
  const photos = tweet.photos.map((photo) => {
    const media: PostMedia = {
      mediaKey: photo.id,
      type: "photo",
      url: photo.url,
      altText: photo.alt_text,
      variants: [],
    };
    return { ...common, id: `${tweet.id}:${photo.id}`, media };
  });
  const videos = tweet.videos.map((video) => {
    const media: PostMedia = {
      mediaKey: video.id,
      type: rawMediaType(tweet, video.id) ?? "video",
      previewImageUrl: video.preview,
      variants: video.url
        ? [{ url: video.url, contentType: "video/mp4" }]
        : [],
    };
    return { ...common, id: `${tweet.id}:${video.id}`, media };
  });
  return [...photos, ...videos];
}

function publicError(error: unknown): string {
  if (error instanceof Error) {
    if (/rate.?limit|\b429\b/i.test(error.message)) {
      return "X rate-limited the free collector";
    }
    if (/private|protected/i.test(error.message)) return "the account is protected";
    if (/deadline/i.test(error.message)) return "the configured time limit was reached";
  }
  return "X stopped or changed its public timeline response";
}

async function beforeDeadline<T>(promise: Promise<T>, remainingMs: number): Promise<T> {
  if (remainingMs <= 0) throw new Error("Archive deadline reached");
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Archive deadline reached")),
          remainingMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function addTweet(
  tweet: Tweet,
  username: string,
  seenPosts: Set<string>,
  seenItems: Set<string>,
  items: ArchiveMediaItem[],
): boolean {
  if (!tweet.id || seenPosts.has(tweet.id)) return false;
  seenPosts.add(tweet.id);
  if (
    tweet.retweetedStatusId ||
    tweet.isRetweet ||
    (tweet.username && tweet.username.toLowerCase() !== username)
  ) {
    return true;
  }
  for (const item of mediaItems(tweet, username)) {
    if (seenItems.has(item.id)) continue;
    seenItems.add(item.id);
    items.push(item);
  }
  return true;
}

function buildResult(
  profile: Profile,
  username: string,
  access: "guest" | "cookie",
  items: ArchiveMediaItem[],
  postsScanned: number,
  pagesFetched: number,
  reason?: string,
): MediaArchiveResult {
  items.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const warning =
    access === "cookie"
      ? `Free cookie-authenticated X search. X can omit or truncate results, so X Media cannot prove this is the complete lifetime archive${reason ? `; ${reason}` : "."}`
      : `Free public X preview. X may repeat, reorder, or truncate guest timelines, so older media can be missing${reason ? `; ${reason}` : ". Add X_SCRAPER_AUTH_TOKEN and X_SCRAPER_CT0 for a deeper local search."}`;
  return {
    mode: "scraper",
    access,
    complete: false,
    username: profile.username?.toLowerCase() || username,
    displayName: profile.name || profile.username || username,
    profileImageUrl: profile.avatar,
    items,
    postsScanned,
    pagesFetched,
    ...archiveDates(items),
    warning,
  };
}

async function fetchGuestArchive(
  username: string,
  maxPosts: number,
  timeoutMs: number,
): Promise<MediaArchiveResult> {
  let stdout: string;
  try {
    const execution = await execFileAsync(
      process.execPath,
      [
        path.join(process.cwd(), "scripts", "free-media-worker.mjs"),
        username,
        String(maxPosts),
      ],
      {
        cwd: process.cwd(),
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    stdout = execution.stdout;
  } catch (error) {
    throw new ApiError(
      `Could not collect @${username}'s timeline: ${publicError(error)}. Try again later.`,
      503,
    );
  }

  const parsedJson: unknown = (() => {
    try {
      return JSON.parse(stdout);
    } catch {
      return undefined;
    }
  })();
  const parsed = workerResultSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new ApiError("The free X collector returned an invalid response.", 503);
  }
  if (!parsed.data.ok) {
    const detail =
      parsed.data.reason === "rate_limit"
        ? "X rate-limited a fresh guest session"
        : parsed.data.reason === "protected"
          ? "the account is protected"
          : "X changed its public timeline response";
    throw new ApiError(
      `Could not collect @${username}'s timeline: ${detail}. Try again later.`,
      503,
    );
  }

  const profile: Profile = parsed.data.profile;
  const canonical = profile.username?.toLowerCase() || username;
  const seenPosts = new Set<string>();
  const seenItems = new Set<string>();
  const items: ArchiveMediaItem[] = [];
  for (const value of parsed.data.tweets) {
    const tweet: Tweet = {
      id: value.id,
      username: value.username,
      text: value.text,
      timeParsed: value.createdAt ? new Date(value.createdAt) : undefined,
      timestamp: value.timestamp,
      permanentUrl: value.permanentUrl,
      isRetweet: value.isRetweet,
      retweetedStatusId: value.retweetedStatusId,
      hashtags: [],
      mentions: [],
      photos: value.photos.map((photo) => ({
        ...photo,
        alt_text: photo.alt_text,
      })),
      thread: [],
      urls: [],
      videos: value.videos.map(({ id, preview, url }) => ({ id, preview, url })),
      __raw_UNSTABLE: {
        extended_entities: {
          media: value.videos.map((video) => ({
            id_str: video.id,
            type: video.type,
            ext_alt_text: undefined,
          })),
        },
      },
    };
    addTweet(tweet, canonical, seenPosts, seenItems, items);
  }
  return buildResult(
    profile,
    canonical,
    "guest",
    items,
    seenPosts.size,
    parsed.data.yielded === 0
      ? 0
      : Math.max(1, Math.ceil(parsed.data.yielded / 20)),
    parsed.data.stopReason,
  );
}

export async function fetchFreeMediaArchive(username: string): Promise<MediaArchiveResult> {
  const config = settings();
  const access = config.authToken ? "cookie" : "guest";
  if (access === "guest") {
    return fetchGuestArchive(username, config.maxPosts, config.timeoutMs);
  }
  const scraper = new Scraper({ rateLimitStrategy: new ErrorRateLimitStrategy() });
  if (config.authToken && config.csrfToken) {
    await scraper.setCookies([
      `auth_token=${config.authToken}; Domain=.x.com; Path=/; Secure`,
      `ct0=${config.csrfToken}; Domain=.x.com; Path=/; Secure`,
    ]);
    if (!(await scraper.isLoggedIn())) {
      throw new ApiError(
        "The configured X cookies are no longer logged in. Refresh both server-only cookie values.",
        401,
      );
    }
  }

  const startedAt = Date.now();
  const remaining = () => config.timeoutMs - (Date.now() - startedAt);
  let profile: Profile;
  try {
    profile = await beforeDeadline(scraper.getProfile(username), remaining());
  } catch (error) {
    throw new ApiError(`Could not load @${username} from X: ${publicError(error)}.`, 503);
  }

  const canonical = profile.username?.toLowerCase() || username;
  const seenPosts = new Set<string>();
  const seenItems = new Set<string>();
  const items: ArchiveMediaItem[] = [];
  let pagesFetched = 0;
  let stopReason: string | undefined;

  try {
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await beforeDeadline(
        scraper.fetchSearchTweets(
          `from:${canonical} filter:media -filter:retweets`,
          Math.min(100, config.maxPosts - seenPosts.size),
          SearchMode.Latest,
          cursor,
        ),
        remaining(),
      );
      pagesFetched += 1;
      for (const tweet of page.tweets) {
        addTweet(tweet, canonical, seenPosts, seenItems, items);
      }
      if (!page.next || seenPosts.size >= config.maxPosts) break;
      if (cursors.has(page.next)) {
        stopReason = "X returned a repeated search cursor";
        break;
      }
      cursors.add(page.next);
      cursor = page.next;
    } while (cursor);
  } catch (error) {
    stopReason = publicError(error);
    if (seenPosts.size === 0) {
      throw new ApiError(
        `Could not collect @${canonical}'s timeline: ${stopReason}. Try again later.`,
        503,
      );
    }
  }

  return buildResult(
    profile,
    canonical,
    access,
    items,
    seenPosts.size,
    pagesFetched,
    stopReason,
  );
}
