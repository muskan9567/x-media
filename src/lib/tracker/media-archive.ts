import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { ApiError } from "../api-response";

import { fetchFreeMediaArchive } from "./free-media-archive";
import type { PostMedia } from "./types";

const FREE_ARCHIVE_CACHE_MS = 60 * 60 * 1_000;
const FREE_ARCHIVE_STALE_MS = 7 * 24 * 60 * 60 * 1_000;
const freeArchiveCache = new Map<
  string,
  { fetchedAt: number; result: MediaArchiveResult }
>();
const pendingFreeArchives = new Map<string, Promise<MediaArchiveResult>>();

export interface ArchiveMediaItem {
  id: string;
  postId: string;
  postUrl: string;
  postText: string;
  createdAt: string;
  media: PostMedia;
}

export interface MediaArchiveResult {
  mode: "scraper" | "x";
  access: "guest" | "cookie" | "official";
  complete: boolean;
  username: string;
  displayName: string;
  profileImageUrl?: string;
  items: ArchiveMediaItem[];
  postsScanned: number;
  pagesFetched: number;
  newestAt?: string;
  oldestAt?: string;
  warning?: string;
}

const cachedPostMediaSchema = z.object({
  mediaKey: z.string(),
  type: z.enum(["photo", "video", "animated_gif"]),
  url: z.string().optional(),
  previewImageUrl: z.string().optional(),
  altText: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  durationMs: z.number().optional(),
  variants: z.array(
    z.object({
      url: z.string(),
      contentType: z.string().optional(),
      bitRate: z.number().optional(),
    }),
  ),
});

const durableCacheSchema = z.object({
  fetchedAt: z.number().int().nonnegative(),
  result: z.object({
    mode: z.literal("scraper"),
    access: z.enum(["guest", "cookie"]),
    complete: z.boolean(),
    username: z.string(),
    displayName: z.string(),
    profileImageUrl: z.string().optional(),
    items: z.array(
      z.object({
        id: z.string(),
        postId: z.string(),
        postUrl: z.string(),
        postText: z.string(),
        createdAt: z.string(),
        media: cachedPostMediaSchema,
      }),
    ),
    postsScanned: z.number().int().nonnegative(),
    pagesFetched: z.number().int().nonnegative(),
    newestAt: z.string().optional(),
    oldestAt: z.string().optional(),
    warning: z.string().optional(),
  }),
});

const usernamePattern = /^[A-Za-z0-9_]{1,15}$/;

const userResponseSchema = z.object({
  data: z.object({
    id: z.string(),
    username: z.string(),
    name: z.string(),
    profile_image_url: z.string().optional(),
  }),
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

const archivePageSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string(),
        text: z.string(),
        note_tweet: z.object({ text: z.string() }).optional(),
        note_post: z.object({ text: z.string() }).optional(),
        created_at: z.string(),
        attachments: z
          .object({ media_keys: z.array(z.string()).optional().default([]) })
          .optional(),
      }),
    )
    .optional()
    .default([]),
  includes: z
    .object({ media: z.array(mediaSchema).optional().default([]) })
    .optional()
    .default({ media: [] }),
  meta: z
    .object({ next_token: z.string().optional(), result_count: z.number().optional() })
    .optional()
    .default({}),
});

const xErrorSchema = z
  .object({
    title: z.string().optional(),
    detail: z.string().optional(),
    message: z.string().optional(),
    errors: z
      .array(
        z.object({
          title: z.string().optional(),
          detail: z.string().optional(),
          message: z.string().optional(),
        }),
      )
      .optional(),
  })
  .passthrough();

function normalizeUsername(input: string): string {
  const username = input.trim().replace(/^@/, "");
  if (!usernamePattern.test(username)) {
    throw new ApiError(
      "Enter a valid X username using 1–15 letters, numbers, or underscores.",
      422,
    );
  }
  return username.toLowerCase();
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
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && loopbackHosts.has(url.hostname))
  ) {
    throw new Error(
      "X_API_BASE_URL must use HTTPS unless it targets a loopback development server.",
    );
  }

  return url.toString().replace(/\/+$/, "");
}

function xErrorDetail(body: unknown): string | undefined {
  const parsed = xErrorSchema.safeParse(body);
  if (!parsed.success) return undefined;
  return (
    parsed.data.errors?.[0]?.detail ??
    parsed.data.errors?.[0]?.message ??
    parsed.data.errors?.[0]?.title ??
    parsed.data.detail ??
    parsed.data.message ??
    parsed.data.title
  );
}

function upstreamStatus(status: number): number {
  if (status === 404 || status === 429) return status;
  if (status >= 500) return 503;
  return 502;
}

async function xRequest<T>(
  url: URL,
  token: string,
  schema: z.ZodType<T>,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "X Media/0.1",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Network failure";
    throw new ApiError(`Could not reach the X API: ${reason}`, 503);
  }

  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const accessHint =
      response.status === 401 || response.status === 403
        ? " Full-Archive Search requires compatible X API access."
        : "";
    throw new ApiError(
      `X API request failed (${response.status}): ${xErrorDetail(body) ?? response.statusText}.${accessHint}`,
      upstreamStatus(response.status),
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

function mapMedia(item: z.infer<typeof mediaSchema>): PostMedia {
  return {
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
  };
}

function archiveDates(items: ArchiveMediaItem[]) {
  if (items.length === 0) return {};
  return {
    newestAt: items[0].createdAt,
    oldestAt: items[items.length - 1].createdAt,
  };
}

type DurableArchive = z.infer<typeof durableCacheSchema>;

function durableCacheFile(username: string): string {
  return path.join(
    process.cwd(),
    ".data",
    "media-archive-cache",
    `${username}.json`,
  );
}

async function readDurableArchive(
  username: string,
): Promise<DurableArchive | undefined> {
  if (process.env.NODE_ENV === "test") return undefined;
  try {
    const parsed: unknown = JSON.parse(
      await readFile(durableCacheFile(username), "utf8"),
    );
    const result = durableCacheSchema.safeParse(parsed);
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

async function writeDurableArchive(
  username: string,
  entry: { fetchedAt: number; result: MediaArchiveResult },
): Promise<void> {
  if (process.env.NODE_ENV === "test") return;
  try {
    const validated = durableCacheSchema.safeParse(entry);
    if (!validated.success) return;
    const file = durableCacheFile(username);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(validated.data), "utf8");
  } catch {
    // A cache write must never turn a successful live archive into an error.
  }
}

async function cachedFreeArchive(username: string): Promise<MediaArchiveResult> {
  const durable = await readDurableArchive(username);
  const cached = freeArchiveCache.get(username);
  if (cached && Date.now() - cached.fetchedAt < FREE_ARCHIVE_CACHE_MS) {
    return cached.result;
  }
  if (durable && Date.now() - durable.fetchedAt < FREE_ARCHIVE_CACHE_MS) {
    freeArchiveCache.set(username, durable);
    return durable.result;
  }
  const pending = pendingFreeArchives.get(username);
  if (pending) return pending;

  const request = fetchFreeMediaArchive(username)
    .then(async (result) => {
      const entry = { fetchedAt: Date.now(), result };
      freeArchiveCache.set(username, entry);
      await writeDurableArchive(username, entry);
      return result;
    })
    .catch((error: unknown) => {
      if (durable && Date.now() - durable.fetchedAt < FREE_ARCHIVE_STALE_MS) {
        const warning = [
          durable.result.warning,
          "Showing the last successful local copy because X blocked the refresh.",
        ]
          .filter(Boolean)
          .join(" ");
        return { ...durable.result, warning };
      }
      throw error;
    })
    .finally(() => pendingFreeArchives.delete(username));
  pendingFreeArchives.set(username, request);
  return request;
}

export async function fetchMediaArchive(
  usernameInput: string,
): Promise<MediaArchiveResult> {
  const username = normalizeUsername(usernameInput);
  const token = process.env.X_BEARER_TOKEN?.trim();
  if (!token) return cachedFreeArchive(username);

  const baseUrl = configuredBaseUrl();
  const userUrl = new URL(
    `${baseUrl}/users/by/username/${encodeURIComponent(username)}`,
  );
  userUrl.searchParams.set("user.fields", "profile_image_url");
  const account = await xRequest(userUrl, token, userResponseSchema);
  const canonicalUsername = account.data.username.toLowerCase();

  const items: ArchiveMediaItem[] = [];
  const seenItems = new Set<string>();
  const seenTokens = new Set<string>();
  let postsScanned = 0;
  let pagesFetched = 0;
  let paginationToken: string | undefined;
  let complete = true;
  let warning: string | undefined;

  do {
    const url = new URL(`${baseUrl}/tweets/search/all`);
    url.searchParams.set(
      "query",
      `from:${canonicalUsername} has:media -is:retweet`,
    );
    url.searchParams.set("max_results", "500");
    url.searchParams.set("tweet.fields", "attachments,created_at,note_tweet");
    url.searchParams.set("expansions", "attachments.media_keys");
    url.searchParams.set(
      "media.fields",
      "alt_text,duration_ms,height,media_key,preview_image_url,type,url,variants,width",
    );
    if (paginationToken) {
      url.searchParams.set("pagination_token", paginationToken);
    }

    let page: z.infer<typeof archivePageSchema>;
    try {
      page = await xRequest(url, token, archivePageSchema);
    } catch (error) {
      if (pagesFetched === 0) throw error;
      complete = false;
      warning =
        error instanceof Error
          ? `Archive stopped after ${pagesFetched} page${pagesFetched === 1 ? "" : "s"}: ${error.message}`
          : "Archive stopped before every page could be retrieved.";
      break;
    }

    pagesFetched += 1;
    postsScanned += page.data.length;
    const mediaByKey = new Map(
      page.includes.media.map((media) => [media.media_key, media]),
    );

    for (const post of page.data) {
      for (const mediaKey of post.attachments?.media_keys ?? []) {
        const media = mediaByKey.get(mediaKey);
        const itemId = `${post.id}:${mediaKey}`;
        if (!media || seenItems.has(itemId)) continue;
        seenItems.add(itemId);
        items.push({
          id: itemId,
          postId: post.id,
          postUrl: `https://x.com/${canonicalUsername}/status/${post.id}`,
          postText: post.note_post?.text ?? post.note_tweet?.text ?? post.text,
          createdAt: post.created_at,
          media: mapMedia(media),
        });
      }
    }

    const nextToken = page.meta.next_token;
    if (nextToken && seenTokens.has(nextToken)) {
      complete = false;
      warning = "X returned a repeated page token, so the archive stopped safely.";
      break;
    }
    if (nextToken) seenTokens.add(nextToken);
    paginationToken = nextToken;
  } while (paginationToken);

  items.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  return {
    mode: "x",
    access: "official",
    complete,
    username: canonicalUsername,
    displayName: account.data.name,
    profileImageUrl: account.data.profile_image_url,
    items,
    postsScanned,
    pagesFetched,
    ...archiveDates(items),
    warning,
  };
}
