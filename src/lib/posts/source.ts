import { z } from "zod";
import { mediaUrlSchema } from "@/lib/tracker/archive-job-types";
import { type Post, type PostProfile, handleSchema } from "./types";

const userSchema = z.object({
  id: z.string().regex(/^\d+$/), screen_name: z.string(), name: z.string().optional(), description: z.string().optional(),
  avatar_url: z.string().nullish(), followers: z.number().nullish(), protected: z.boolean().optional(),
  statuses: z.number().int().nonnegative().optional(), joined: z.string().optional(),
}).passthrough();
const rawSchema = z.object({
  type: z.literal("status"), id: z.string().regex(/^\d+$/), text: z.string(), author: userSchema,
  created_timestamp: z.number().optional(), created_at: z.string().optional(),
  likes: z.number().nullish(), reposts: z.number().nullish(), replies: z.number().nullish(), views: z.number().nullish(),
  replying_to: z.unknown().optional(), quote: z.unknown().optional(), reposted_by: z.unknown().optional(),
  media: z.object({ all: z.array(z.record(z.string(), z.unknown())).optional() }).nullish(),
}).passthrough();
export class PostSourceError extends Error {
  constructor(readonly kind: "unavailable" | "rate_limit" | "upstream" | "access", message: string, readonly retryAt?: number) { super(message); }
}
const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const safeUrl = (value: unknown) => { const parsed = mediaUrlSchema.safeParse(value); return parsed.success ? parsed.data : undefined; };
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
export function parseProfile(raw: unknown, username: string): PostProfile {
  const user = userSchema.parse(raw);
  if (user.protected || user.screen_name.toLowerCase() !== username) throw new PostSourceError("unavailable", "This account is not available publicly. Check the username or try again later.");
  const joined = Date.parse(user.joined || "");
  return { id: user.id, username, name: user.name || username, bio: user.description || "", avatar: safeUrl(user.avatar_url), followers: count(user.followers),
    ...(user.statuses !== undefined ? { reportedPosts: user.statuses } : {}),
    ...(Number.isFinite(joined) ? { joinedAt: new Date(joined).toISOString() } : {}) };
}
export function parsePost(raw: unknown, profile: PostProfile, now: string): Post | null {
  const parsed = rawSchema.safeParse(raw);
  if (!parsed.success) return null;
  const post = parsed.data;
  if (post.author.id !== profile.id || post.author.screen_name.toLowerCase() !== profile.username || post.author.protected || post.reposted_by) return null;
  const time = typeof post.created_timestamp === "number" ? post.created_timestamp * 1000 : Date.parse(post.created_at || "");
  if (!Number.isFinite(time)) return null;
  const rawMedia = post.media?.all || [];
  const media: Post["media"] = rawMedia.flatMap((item, index) => {
    const type = item.type === "gif" ? "animated_gif" : item.type;
    if (type !== "photo" && type !== "video" && type !== "animated_gif") return [];
    const url = safeUrl(item.url), previewImageUrl = safeUrl(item.thumbnail_url);
    const variants = (Array.isArray(item.formats) ? item.formats : []).flatMap((format: Record<string, unknown>) => {
      const candidate = safeUrl(format?.url);
      return candidate && /\.mp4(?:\?|$)/i.test(candidate) ? [{ url: candidate, contentType: "video/mp4", bitRate: count(format.bitrate) ?? undefined }] : [];
    });
    if (type !== "photo" && url && /\.mp4(?:\?|$)/i.test(url) && !variants.some(v => v.url === url)) variants.push({ url, contentType: "video/mp4", bitRate: undefined });
    if (type === "photo" ? !url : !previewImageUrl && !variants.length) return [];
    return [{ type, mediaKey: typeof item.id === "string" ? item.id : `${post.id}-${index}`, url: type === "photo" ? url : undefined,
      previewImageUrl, altText: typeof item.alt_text === "string" ? item.alt_text : undefined,
      width: count(item.width) ?? undefined, height: count(item.height) ?? undefined, variants }];
  });
  return { id: post.id, authorId: profile.id, username: profile.username, text: post.text,
    createdAt: new Date(time).toISOString(), fetchedAt: now,
    likes: count(post.likes), reposts: count(post.reposts), replies: count(post.replies), views: count(post.views),
    isReply: !!post.replying_to, isQuote: !!post.quote, hasMedia: rawMedia.length > 0,
    characterCount: [...segmenter.segment(post.text.trim())].length, media };
}
export interface PostsPage { profile: PostProfile; posts: Post[]; scanned: number; cursor?: string; archiveWindow?: { from: string; through: string } }
export type FetchPostsPage = (username: string, cursor: string | undefined, signal: AbortSignal, profile?: PostProfile, options?: { from?: string }) => Promise<PostsPage>;
export function createPostsSource(fetcher: typeof fetch = fetch): FetchPostsPage {
  const get = async (path: string, signal: AbortSignal) => {
    const response = await fetcher(`https://api.fxtwitter.com/2/${path}`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]), redirect: "error", cache: "no-store",
      headers: { Accept: "application/json", "User-Agent": "X Media/0.1 (public post collection)" },
    });
    if (response.status === 429) {
      const after = response.headers.get("retry-after");
      const time = after ? (/^\d+$/.test(after) ? Date.now() + Number(after) * 1000 : Date.parse(after)) : 0;
      throw new PostSourceError("rate_limit", "The post source is limiting requests. Your saved tweets are available.", Number.isFinite(time) ? time : undefined);
    }
    if (response.status === 404) throw new PostSourceError("unavailable", "This account is unavailable from the public source. Check the username or try again later.");
    if (!response.ok) throw new PostSourceError("upstream", "The post source could not finish this request.");
    const body = await response.text();
    if (body.length > 8_000_000) throw new PostSourceError("upstream", "The post source returned too much data.");
    const data = z.object({ code: z.number() }).passthrough().parse(JSON.parse(body));
    if (data.code !== 200) throw new PostSourceError(data.code === 404 ? "unavailable" : data.code === 429 ? "rate_limit" : "upstream", "The public post source is temporarily unavailable.");
    return data;
  };
  return async (input, cursor, signal, knownProfile) => {
    const username = handleSchema.parse(input);
    const query = new URLSearchParams({ count: "100", with_replies: "1" });
    if (cursor) query.set("cursor", cursor);
    const data = await get(`profile/${username}/statuses?${query}`, signal);
    const page = z.object({ results: z.array(z.unknown()), cursor: z.object({ bottom: z.string().max(8192).nullable() }) }).parse(data);
    const author = page.results.map(p => rawSchema.safeParse(p)).find(p => p.success && !p.data.reposted_by && p.data.author.screen_name.toLowerCase() === username);
    const profile = author?.success ? { ...knownProfile, ...parseProfile(author.data.author, username) } : knownProfile ?? parseProfile((await get(`profile/${username}`, signal)).user, username);
    if (knownProfile && knownProfile.id !== profile.id) throw new PostSourceError("unavailable", "This username now belongs to a different account. Its saved tweets were preserved.");
    const now = new Date().toISOString();
    return { profile, posts: page.results.flatMap(raw => { const post = parsePost(raw, profile, now); return post ? [post] : []; }), scanned: page.results.length,
      cursor: page.cursor.bottom || undefined };
  };
}
