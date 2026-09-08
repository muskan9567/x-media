import { z } from "zod";
import { handleSchema, postSchema, profileSchema, type Post } from "./types";
import { mediaUrlSchema } from "@/lib/tracker/archive-job-types";

export const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
export const archiveImportSchema = z.object({
  format: z.literal("x-media-posts"), version: z.literal(1),
  profile: profileSchema.extend({ username: handleSchema }), posts: z.array(postSchema).max(100_000),
}).superRefine((value, ctx) => {
  if (value.posts.some(post => post.authorId !== value.profile.id || post.username !== value.profile.username)) {
    ctx.addIssue({ code: "custom", message: "Every tweet must belong to the archive account." });
  }
});
export type ArchiveImport = z.infer<typeof archiveImportSchema>;
export interface ArchiveFile { name: string; text: string }
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
const id = z.string().regex(/^\d+$/);
const nativeTweet = z.object({
  id_str: id, full_text: z.string(), created_at: z.string(),
  favorite_count: z.union([z.string().regex(/^\d+$/), z.number().nonnegative()]).nullish(),
  retweet_count: z.union([z.string().regex(/^\d+$/), z.number().nonnegative()]).nullish(),
  in_reply_to_status_id_str: z.string().nullish(), quoted_status_id_str: z.string().nullish(),
  is_quote_status: z.boolean().optional(),
  entities: z.object({ media: z.array(z.record(z.string(), z.unknown())).optional(),
    urls: z.array(z.object({ expanded_url: z.string().optional() })).optional() }).optional(),
  extended_entities: z.object({ media: z.array(z.record(z.string(), z.unknown())).optional() }).optional(),
});
function jsonFile(file: ArchiveFile): unknown {
  // X's data files wrap JSON in a single assignment. Never execute uploaded JavaScript.
  const text = file.text.replace(/^\uFEFF/, "").trim().replace(/^window\.YTD\.(?:tweets?|account)\.part\d+\s*=\s*/, "").replace(/;\s*$/, "");
  try { return JSON.parse(text); }
  catch { throw Error(`${file.name}: could not read archive data. Select account.js and tweets.js from the extracted X archive, or an X Media JSON export.`); }
}
const count = (value: unknown) => value == null ? null : Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const safeUrl = (value: unknown) => { const parsed = mediaUrlSchema.safeParse(value); return parsed.success ? parsed.data : undefined; };
function decodeText(text: string) {
  const entities: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };
  return text.replace(/&(?:amp|lt|gt|quot|#39);/g, entity => entities[entity]);
}

export function parseArchiveFiles(files: ArchiveFile[], now = new Date().toISOString()): ArchiveImport {
  if (!files.length || files.length > 32) throw Error("Select up to 32 archive data files.");
  if (files.reduce((size, file) => size + new TextEncoder().encode(file.text).length, 0) > MAX_ARCHIVE_BYTES) throw Error("Select up to 25 MB of archive data at a time. Include account.js with each batch.");
  const parsed = files.map(file => ({ name: file.name, data: jsonFile(file) }));
  if (parsed.length === 1 && !Array.isArray(parsed[0].data)) {
    const result = archiveImportSchema.safeParse(parsed[0].data);
    if (!result.success) throw Error("This is not a valid X Media tweet export. For an X archive, select account.js together with tweets.js.");
    return result.data;
  }
  const accountFile = parsed.find(file => /^account\.(?:js|json)$/i.test(file.name));
  const account = z.array(z.object({ account: z.object({
    accountId: id, username: handleSchema, accountDisplayName: z.string().optional(), createdAt: z.string().optional(),
  }) })).length(1).safeParse(accountFile?.data);
  if (!account.success) throw Error("Include data/account.js so each tweet is attached to the correct account. No sign-in or internet access is needed.");
  const owner = account.data[0].account;
  const profile = profileSchema.parse({ id: owner.accountId, username: owner.username, name: owner.accountDisplayName || owner.username, bio: "", followers: null });
  const tweetFiles = parsed.filter(file => /^(?:tweets?|tweets?-part\d+)\.(?:js|json)$/i.test(file.name));
  if (!tweetFiles.length) throw Error("Select data/tweets.js (and any tweets-part files) together with data/account.js.");
  if (parsed.length !== tweetFiles.length + 1) throw Error("Select only account.js and tweet data files. Other archive files are not needed.");
  const posts = new Map<string, Post>();
  for (const file of tweetFiles) {
    const rows = z.array(z.object({ tweet: nativeTweet })).safeParse(file.data);
    if (!rows.success) throw Error(`${file.name}: invalid tweet data. No tweets were imported.`);
    for (const { tweet } of rows.data) {
      if (/^RT @/i.test(tweet.full_text)) continue;
      const timestamp = Date.parse(tweet.created_at);
      if (!Number.isFinite(timestamp)) throw Error(`${file.name}: a tweet has an invalid date. No tweets were imported.`);
      const text = decodeText(tweet.full_text);
      const rawMedia = tweet.extended_entities?.media || tweet.entities?.media || [];
      const media: Post["media"] = rawMedia.flatMap((item, index) => {
        const type = item.type === "video" || item.type === "animated_gif" ? item.type : "photo";
        const url = safeUrl(item.media_url_https);
        const info = z.object({ variants: z.array(z.object({ url: z.string(), content_type: z.string(), bitrate: z.number().optional() })).optional() }).safeParse(item.video_info);
        const variants = info.success ? (info.data.variants || []).flatMap(v => {
          const link = safeUrl(v.url);
          return link && v.content_type === "video/mp4" ? [{ url: link, contentType: "video/mp4", bitRate: v.bitrate }] : [];
        }) : [];
        if (!url && !variants.length) return [];
        return [{ type, mediaKey: typeof item.id_str === "string" ? item.id_str : `${tweet.id_str}-${index}`,
          url: type === "photo" ? url : undefined, previewImageUrl: type !== "photo" ? url : undefined, variants }];
      });
      posts.set(tweet.id_str, {
        id: tweet.id_str, authorId: profile.id, username: profile.username, text,
        createdAt: new Date(timestamp).toISOString(), fetchedAt: now,
        likes: count(tweet.favorite_count), reposts: count(tweet.retweet_count), replies: null, views: null,
        isReply: !!tweet.in_reply_to_status_id_str,
        isQuote: !!tweet.is_quote_status || !!tweet.quoted_status_id_str || !!tweet.entities?.urls?.some(link => /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[^/]+\/status\/\d+/i.test(link.expanded_url || "")),
        hasMedia: rawMedia.length > 0, characterCount: [...segmenter.segment(text.trim())].length, media,
      });
    }
  }
  return archiveImportSchema.parse({ format: "x-media-posts", version: 1, profile, posts: [...posts.values()] });
}
