import { z } from "zod";
import { mediaUrlSchema } from "@/lib/tracker/archive-job-types";
import { handleSchema, postSchema, profileSchema, type Post } from "./types";
import { PostSourceError, type FetchPostsPage } from "./source";

const earliest = "2006-03-21T00:00:00.000Z";
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const safeUrl = (value: unknown) => { const result = mediaUrlSchema.safeParse(value); return result.success ? result.data : undefined; };
const object = z.record(z.string(), z.unknown());
const cursorSchema = z.object({ version: z.literal(1), username: handleSchema, authorId: z.string(), from: z.string().datetime(), through: z.string().datetime(), token: z.string().min(1).max(16000) });
const userSchema = z.object({ id: z.string().regex(/^\d+$/), username: z.string(), name: z.string(), description: z.string().optional(), created_at: z.string().datetime().optional(), protected: z.boolean().optional(), profile_image_url: z.string().optional(), public_metrics: object.optional() });
const rowSchema = z.object({ id: z.string().regex(/^\d+$/), author_id: z.string(), text: z.string(), created_at: z.string().datetime(), public_metrics: object.optional(),
  note_post: z.object({ text: z.string() }).optional(), note_tweet: z.object({ text: z.string() }).optional(),
  referenced_posts: z.array(z.object({ type: z.string(), id: z.string() })).optional(), referenced_tweets: z.array(z.object({ type: z.string(), id: z.string() })).optional(),
  in_reply_to_user_id: z.string().optional(), attachments: z.object({ media_keys: z.array(z.string()).optional(), poll_ids: z.array(z.string()).optional() }).optional(),
});
const pageSchema = z.object({ data: z.array(rowSchema).optional().default([]), includes: z.object({ media: z.array(object).optional() }).optional(), errors: z.array(object).optional(), meta: z.object({ result_count: z.number().int().nonnegative(), next_token: z.string().min(1).optional() }) });

function onlyUnavailableExpansions(page: z.infer<typeof pageSchema>): boolean {
  const posts = new Set(page.data.map(post => post.id));
  const references = new Set(page.data.flatMap(post => (post.referenced_posts || post.referenced_tweets || []).map(ref => ref.id)));
  const replies = new Set(page.data.map(post => post.in_reply_to_user_id).filter(Boolean));
  const authors = new Set(page.data.map(post => post.author_id));
  const media = new Set(page.data.flatMap(post => post.attachments?.media_keys || []));
  return (page.errors || []).every(error => {
    if (typeof error.type !== "string" || !/\/(resource-not-found|not-authorized-for-resource)$/.test(error.type) || typeof error.resource_id !== "string") return false;
    const id = error.resource_id;
    if (error.resource_type === "tweet" || error.resource_type === "post") return references.has(id) && !posts.has(id);
    if (error.resource_type === "user") return replies.has(id) && !authors.has(id);
    return error.resource_type === "media" && media.has(id);
  });
}

function parseMedia(raw: Record<string, unknown>): Post["media"][number] | undefined {
  const type = raw.type;
  if (type !== "photo" && type !== "video" && type !== "animated_gif" || typeof raw.media_key !== "string") return;
  const url = safeUrl(raw.url), previewImageUrl = safeUrl(raw.preview_image_url);
  const variants = (Array.isArray(raw.variants) ? raw.variants : []).flatMap(item => {
    const parsed = object.safeParse(item); if (!parsed.success) return [];
    const variant = parsed.data, url = safeUrl(variant.url);
    return url && (variant.content_type === "video/mp4" || /\.mp4(?:\?|$)/i.test(url)) ? [{ url, contentType: "video/mp4", bitRate: count(variant.bit_rate) ?? undefined }] : [];
  });
  if (type === "photo" ? !url : !previewImageUrl && !variants.length) return;
  return { type, mediaKey: raw.media_key, url, previewImageUrl, variants, altText: typeof raw.alt_text === "string" ? raw.alt_text : undefined, width: count(raw.width) ?? undefined, height: count(raw.height) ?? undefined };
}

/** No timeline fallback: success means this archive-search page was validated and saved. */
export function createFullArchiveSource(getToken: () => Promise<string | undefined>, fetcher: typeof fetch = fetch, now = Date.now): FetchPostsPage {
  async function get(path: string, token: string, signal: AbortSignal): Promise<unknown> {
    const response = await fetcher(`https://api.x.com/2/${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]), redirect: "error", cache: "no-store",
    });
    if (response.status === 429) {
      await response.body?.cancel();
      const reset = Number(response.headers.get("x-rate-limit-reset")) * 1000;
      const retry = Number(response.headers.get("retry-after")) * 1000 + now();
      throw new PostSourceError("rate_limit", "X API rate limit reached. Saved progress will resume automatically.", Math.max(Number.isFinite(reset) ? reset : 0, Number.isFinite(retry) ? retry : 0));
    }
    if ([401, 402, 403].includes(response.status)) {
      await response.body?.cancel();
      throw new PostSourceError("access", response.status === 401 ? "X rejected the API token. Update the connection, then resume collection." : response.status === 402 ? "X API credits are exhausted. Add credits in the X Developer Console, then resume collection." : "This X API app does not have access to this request. Enable full-archive search and check its credits, then resume collection.");
    }
    if (response.status === 404) { await response.body?.cancel(); throw new PostSourceError("unavailable", "X could not find this public account."); }
    if (!response.ok) { await response.body?.cancel(); throw new PostSourceError("upstream", `X archive search returned HTTP ${response.status}. This page was not skipped.`); }
    const body = await response.text();
    if (body.length > 16_000_000) throw new PostSourceError("upstream", "X returned an oversized archive page. This page was not skipped.");
    const data = object.parse(JSON.parse(body));
    if (path.startsWith("users/") && Array.isArray(data.errors) && data.errors.length) throw new PostSourceError("unavailable", "X could not resolve this public account.");
    return data;
  }
  return async (input, cursor, signal, knownProfile, options) => {
    const username = handleSchema.parse(input), token = await getToken();
    if (!token) throw new PostSourceError("access", "Connect an X API app with full-archive access and credits to collect this account's full history.");
    let checkpoint: z.infer<typeof cursorSchema> | undefined;
    if (cursor) {
      try { checkpoint = cursorSchema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))); }
      catch { throw new PostSourceError("access", "The saved archive checkpoint is invalid. Saved tweets were preserved."); }
      if (checkpoint.username !== username || knownProfile && checkpoint.authorId !== knownProfile.id) throw new PostSourceError("unavailable", "The archive checkpoint belongs to another account. Saved tweets were preserved.");
    }
    let profile = knownProfile;
    if (!checkpoint || !profile) {
      const query = new URLSearchParams({ "user.fields": "created_at,description,profile_image_url,protected,public_metrics" });
      const user = userSchema.parse(object.parse(await get(`users/by/username/${username}?${query}`, token, signal)).data);
      if (user.protected || user.username.toLowerCase() !== username || knownProfile && user.id !== knownProfile.id || checkpoint && checkpoint.authorId !== user.id) throw new PostSourceError("unavailable", "This account is protected or its identity changed. Saved tweets were preserved.");
      profile = profileSchema.parse({ id: user.id, username, name: user.name, bio: user.description || "", avatar: safeUrl(user.profile_image_url), followers: count(user.public_metrics?.followers_count), joinedAt: user.created_at, reportedPosts: count(user.public_metrics?.post_count ?? user.public_metrics?.tweet_count) ?? undefined });
    }
    const origin = profile.joinedAt && profile.joinedAt > earliest ? profile.joinedAt : earliest;
    const from = checkpoint?.from || (options?.from && options.from > origin ? z.string().datetime().parse(options.from) : origin);
    const through = checkpoint?.through || new Date(Math.floor((now() - 30_000) / 1000) * 1000).toISOString();
    const query = new URLSearchParams({ query: `from:${username} -is:retweet`, start_time: from, end_time: through, max_results: "500", sort_order: "recency",
      "post.fields": "created_at,public_metrics,attachments,note_post",
      expansions: "author_id,in_reply_to_user_id,referenced_posts,attachments.media_keys",
      "media.fields": "media_key,type,url,preview_image_url,alt_text,width,height,variants",
    });
    if (checkpoint) query.set("next_token", checkpoint.token);
    const page = pageSchema.parse(await get(`tweets/search/all?${query}`, token, signal));
    if (page.meta.result_count !== page.data.length) throw new PostSourceError("upstream", "X returned an incomplete archive page. This page was not skipped.");
    // Missing quoted/replied-to resources must not discard their intact parent posts.
    // Every tolerated error must refer to an expansion identified by a returned row.
    if (!onlyUnavailableExpansions(page)) throw new PostSourceError("upstream", "X returned errors with this archive page. It was not marked complete or skipped.");
    const media = new Map((page.includes?.media || []).map(item => [item.media_key, item]));
    const fetchedAt = new Date(now()).toISOString();
    const posts = page.data.flatMap(raw => {
      if (raw.author_id !== profile.id) throw new PostSourceError("unavailable", "X returned posts from another author. Collection stopped to protect the saved history.");
      const references = raw.referenced_posts || raw.referenced_tweets || [];
      if (references.some(item => item.type === "retweeted" || item.type === "reposted")) return [];
      const text = raw.note_post?.text || raw.note_tweet?.text || raw.text;
      const metrics = raw.public_metrics || {};
      return [postSchema.parse({ id: raw.id, authorId: raw.author_id, username, text, createdAt: raw.created_at, fetchedAt,
        likes: count(metrics.like_count), reposts: count(metrics.repost_count ?? metrics.retweet_count), replies: count(metrics.reply_count), views: count(metrics.impression_count),
        isReply: !!raw.in_reply_to_user_id || references.some(item => item.type === "replied_to"), isQuote: references.some(item => item.type === "quoted"),
        hasMedia: !!(raw.attachments?.media_keys?.length || raw.attachments?.poll_ids?.length), characterCount: [...segmenter.segment(text.trim())].length,
        media: (raw.attachments?.media_keys || []).flatMap(key => { const item = media.get(key); const parsed = item && parseMedia(item); return parsed ? [parsed] : []; }),
      })];
    });
    return { profile, posts, scanned: page.data.length, archiveWindow: { from, through },
      cursor: page.meta.next_token ? Buffer.from(JSON.stringify({ version: 1, username, authorId: profile.id, from, through, token: page.meta.next_token })).toString("base64url") : undefined };
  };
}
