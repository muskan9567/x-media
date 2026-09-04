import { z } from "zod";
import { mediaUrlSchema, type ArchiveAccount } from "./archive-job-types";

const variantSchema = z.object({ url: z.string(), content_type: z.string().optional(), bitrate: z.number().optional() });
const syndicationSchema = z.object({
  id_str: z.string(), user: z.object({ screen_name: z.string() }),
  mediaDetails: z.array(z.object({ id_str: z.string().optional(), type: z.string(), media_url_https: z.string().optional(),
    video_info: z.object({ variants: z.array(variantSchema) }).optional() })).default([]),
});
const fxSchema = z.object({ tweet: z.object({ id: z.string(), author: z.object({ screen_name: z.string() }),
  media: z.object({ all: z.array(z.object({ type: z.string(), url: z.string(), thumbnail_url: z.string().optional() })) }).optional(),
}) });
type Items = ArchiveAccount["items"];
export async function resolvePostMedia(username: string, postId: string, items: Items, signal?: AbortSignal): Promise<Items> {
  if (!/^[a-z0-9_]{1,15}$/.test(username) || !/^\d+$/.test(postId)) return [];
  const fetchJson = async (url: string) => {
    const timeout = AbortSignal.timeout(12_000);
    const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout, redirect: "error", cache: "no-store" });
    if (!response.ok) throw new Error(`Media source returned ${response.status}`);
    const text = await response.text();
    if (text.length > 2_000_000) throw new Error("Media response too large");
    return JSON.parse(text) as unknown;
  };
  try {
    const data = syndicationSchema.parse(await fetchJson(`https://cdn.syndication.twimg.com/tweet-result?id=${postId}&token=0`));
    if (data.id_str !== postId || data.user.screen_name.toLowerCase() !== username) return [];
    const repaired = items.flatMap((item) => {
      const match = data.mediaDetails.find((media) => media.id_str === item.media.mediaKey);
      const variants = (match?.video_info?.variants || []).flatMap((v) => {
        const url = mediaUrlSchema.safeParse(v.url);
        return url.success && v.content_type === "video/mp4" ? [{ url: url.data, contentType: v.content_type, bitRate: v.bitrate }] : [];
      });
      return variants.length ? [{ ...item, media: { ...item.media, variants } }] : [];
    });
    if (repaired.length) return repaired;
  } catch { if (signal?.aborted) return []; }
  try {
    const data = fxSchema.parse(await fetchJson(`https://api.fxtwitter.com/${username}/status/${postId}`)).tweet;
    if (data.id !== postId || data.author.screen_name.toLowerCase() !== username) return [];
    const videos = (data.media?.all || []).filter((m) => ["video", "gif", "animated_gif"].includes(m.type));
    const originals = items.filter((item) => item.media.type !== "photo");
    // Do not guess attachment order when providers disagree about the number.
    if (videos.length !== originals.length) return [];
    return originals.flatMap((item, index) => {
      const url = mediaUrlSchema.safeParse(videos[index].url);
      return url.success && /\.mp4(?:\?|$)/.test(url.data) ? [{ ...item, media: { ...item.media, variants: [{ url: url.data, contentType: "video/mp4" }] } }] : [];
    });
  } catch { return []; }
}
