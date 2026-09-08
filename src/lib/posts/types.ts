import { z } from "zod";
import { archiveItemSchema, mediaUrlSchema } from "@/lib/tracker/archive-job-types";

export function normalizeHandle(input: string): string {
  let value = input.trim();
  if (/^(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\//i.test(value)) {
    try {
      const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
      if (url.username || url.password || !["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(url.hostname.toLowerCase())) return "";
      const segments = url.pathname.split("/").filter(Boolean);
      if (segments.length !== 1) return "";
      value = segments[0];
    } catch { return ""; }
  }
  return value.replace(/^@/, "").toLowerCase();
}
export const handleSchema = z.string().max(300).transform(normalizeHandle).pipe(z.string().regex(/^[a-z0-9_]{1,15}$/, "Enter an X username or profile link."));
const count = z.number().finite().nonnegative().nullable();
export const postSchema = z.object({
  id: z.string().regex(/^\d+$/), authorId: z.string().regex(/^\d+$/), username: z.string(),
  text: z.string(), createdAt: z.string().datetime(), fetchedAt: z.string().datetime(),
  likes: count, reposts: count, replies: count, views: count,
  isReply: z.boolean(), isQuote: z.boolean(), hasMedia: z.boolean(), characterCount: z.number().int().nonnegative(),
  media: z.array(archiveItemSchema.shape.media),
});
export type Post = z.infer<typeof postSchema>;
// Reposts are rejected by the source/import parsers. All browsing surfaces
// show only the author's standalone posts, including original media posts.
export const isOriginalPost = (post: Post) => !post.isReply && !post.isQuote;
export const profileSchema = z.object({
  id: z.string().regex(/^\d+$/), username: z.string(), name: z.string(), bio: z.string(),
  avatar: mediaUrlSchema.optional(), followers: count,
  joinedAt: z.string().datetime().optional(), reportedPosts: z.number().nonnegative().optional(),
});
export type PostProfile = z.infer<typeof profileSchema>;
export const accountSchema = z.object({
  username: z.string().regex(/^[a-z0-9_]{1,15}$/), profile: profileSchema.optional(), posts: z.array(postSchema),
  status: z.enum(["queued", "collecting", "waiting", "paused", "ready", "unavailable", "failed"]),
  message: z.string(), revision: z.number().int(), runId: z.string(), mode: z.enum(["history", "refresh"]),
  cursor: z.string().optional(), refreshCursor: z.string().optional(), exhausted: z.boolean(),
  recentCursors: z.array(z.string()), pages: z.number().int(), scanned: z.number().int(), runPages: z.number().int(),
  retries: z.number().int(), retryAt: z.number().optional(), updatedAt: z.string(), fetchedAt: z.string().optional(),
  source: z.enum(["timeline", "full_archive"]).default("timeline"), historyComplete: z.boolean().default(false),
  archiveFrom: z.string().datetime().optional(), archiveThrough: z.string().datetime().optional(),
  importedAt: z.string().datetime().optional(), importedCount: z.number().int().nonnegative().optional(),
});
export type PostAccount = z.infer<typeof accountSchema>;
export const stateSchema = z.object({ version: z.literal(1), cooldownUntil: z.number(), accounts: z.record(z.string(), accountSchema) });
export type PostState = z.infer<typeof stateSchema>;
export const activeAccount = (account: Pick<PostAccount, "status">) => ["queued", "collecting", "waiting"].includes(account.status);
export type AccountSummary = Pick<PostAccount, "username" | "status" | "fetchedAt"> & { name: string; count: number };
export type PostsView = Omit<PostAccount, "cursor" | "refreshCursor" | "recentCursors" | "runId"> & { canContinue: boolean };
export type PostCategory = "popular" | "recent" | "oldest" | "short";
export type PopularityMetric = "likes" | "reposts" | "views";
export interface PostFilters {
  category: PostCategory; metric: PopularityMetric; keyword: string; days: number; minLikes: number;
  maxLength: number;
}
export const defaultFilters: PostFilters = {
  category: "popular", metric: "likes", keyword: "", days: 0, minLikes: 0, maxLength: 140,
};

export function selectPosts(posts: Post[], filters: PostFilters, now = Date.now()): Post[] {
  const keyword = filters.keyword.trim().toLocaleLowerCase();
  const short = filters.category === "short";
  const filtered = posts.filter(post => {
    if (!isOriginalPost(post)) return false;
    if (keyword && !post.text.toLocaleLowerCase().includes(keyword)) return false;
    if (filters.days && Date.parse(post.createdAt) < now - filters.days * 86_400_000) return false;
    const minimum = short ? Math.max(1, filters.minLikes) : filters.minLikes;
    if (minimum > 0 && (post.likes === null || post.likes < minimum)) return false;
    if (short && (post.isQuote || post.hasMedia || !post.text.trim() || post.characterCount > filters.maxLength)) return false;
    return true;
  });
  return filtered.sort((a, b) => {
    const date = b.createdAt.localeCompare(a.createdAt);
    if (filters.category === "recent") return date || b.id.localeCompare(a.id);
    if (filters.category === "oldest") return -date || a.id.localeCompare(b.id);
    const metric = short ? "likes" : filters.metric;
    return (b[metric] ?? -1) - (a[metric] ?? -1) || date || b.id.localeCompare(a.id);
  });
}
