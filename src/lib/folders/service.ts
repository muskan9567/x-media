import "server-only";
import path from "node:path";
import { ApiError } from "@/lib/api-response";
import { getArchiveJobs } from "@/lib/tracker/archive-jobs";
import { getRedditService } from "@/lib/reddit/service";
import type { Meme } from "@/lib/reddit/types";
import { mediaKey, type FolderMedia, type MediaReference } from "./types";
import { FolderStore, type ResolvedMedia } from "./store";

export async function resolveFolderMedia(reference: MediaReference): Promise<ResolvedMedia> {
  const key = mediaKey(reference), addedAt = new Date().toISOString();
  if (reference.source === "x") {
    const view = await (await getArchiveJobs()).get(reference.jobId);
    const archive = view.result?.items.find(item => item.id === reference.id);
    if (!archive) throw new ApiError("This X attachment is no longer in the saved collection.", 404);
    return { item: { key, reference, title: archive.postText || `Media from @${view.result!.username}`, creator: `@${view.result!.username}`, postUrl: archive.postUrl, type: archive.media.type, previewUrl: archive.media.previewImageUrl || archive.media.url || "", archive, addedAt } };
  }
  const { origin } = await getRedditService();
  const response = await fetch(`${origin}/api/memes/${encodeURIComponent(reference.id)}`, { signal: AbortSignal.timeout(30_000), cache: "no-store" });
  if (!response.ok) throw new ApiError("This Reddit meme is unavailable. Refresh your collection and try again.", 404);
  const result = await response.json();
  const meme: Meme = result.meme ?? result;
  const original = await fetch(`${origin}/api/images/${encodeURIComponent(reference.id)}`, { signal: AbortSignal.timeout(60_000) });
  const mime = original.headers.get("content-type")?.split(";")[0];
  if (!original.ok || !mime || !["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"].includes(mime)) throw new ApiError("The original image could not be saved. Try again in a moment.", 502);
  const bytes = new Uint8Array(await original.arrayBuffer());
  if (!bytes.length) throw new ApiError("The original image is empty. Try another meme.", 502);
  return { item: { key, reference, title: meme.title, creator: `r/${meme.subreddit}`, postUrl: meme.permalink, type: "photo", previewUrl: `/api/folders/assets/${encodeURIComponent(key)}`, addedAt, asset: { file: `${"0".repeat(64)}.bin`, mime: mime as NonNullable<FolderMedia["asset"]>["mime"] } }, bytes };
}
const shared = globalThis as typeof globalThis & { xMediaFolders?: FolderStore };
export function getFolders() {
  return shared.xMediaFolders ??= new FolderStore(process.env.MEDIA_FOLDERS_DIR || path.join(process.cwd(), ".data", "folders"), resolveFolderMedia);
}
