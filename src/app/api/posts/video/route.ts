import { ApiError } from "@/lib/api-response";
import { postsErrorResponse } from "@/lib/posts/api-response";
import { getPostsService } from "@/lib/posts/service";
import { handleSchema } from "@/lib/posts/types";
import { mediaUrlSchema } from "@/lib/tracker/archive-job-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Select only an attachment already held in the local collection, never a caller URL.
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const username = handleSchema.parse(params.get("username"));
    const postId = params.get("post"), mediaKey = params.get("media");
    if (!postId || !/^\d+$/.test(postId) || !mediaKey) throw new ApiError("Select a saved video.", 422);
    const range = request.headers.get("range");
    if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range)) throw new ApiError("Invalid video range.", 416);
    const view = await (await getPostsService()).get(username);
    const media = view.posts.find(post => post.id === postId)?.media.find(item => item.mediaKey === mediaKey);
    if (!media || media.type === "photo") throw new ApiError("Saved video not found.", 404);
    const variant = [...media.variants]
      .filter(item => item.contentType === "video/mp4" || /\.mp4(?:$|\?)/i.test(item.url))
      .sort((a, b) => (b.bitRate ?? 0) - (a.bitRate ?? 0))[0];
    if (!variant) throw new ApiError("This video has no playable link. Open the tweet on X.", 404);
    const url = mediaUrlSchema.parse(variant.url);
    const upstream = await fetch(url, {
      headers: range ? { Range: range } : {},
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(120_000)]),
      redirect: "error", cache: "no-store",
    });
    if (upstream.status === 416) {
      await upstream.body?.cancel();
      return new Response(null, { status: 416, headers: { "Content-Range": upstream.headers.get("content-range") || "bytes */*", "Cache-Control": "no-store" } });
    }
    if (![200, 206].includes(upstream.status) || !upstream.headers.get("content-type")?.startsWith("video/mp4")) {
      await upstream.body?.cancel();
      throw new ApiError("This video is temporarily unavailable. Try again or open the tweet on X.", 502);
    }
    const headers = new Headers({ "Content-Type": "video/mp4", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
    for (const name of ["content-length", "content-range", "accept-ranges"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    return postsErrorResponse(error instanceof TypeError || error instanceof DOMException ? new ApiError("Could not load the video. Try again or open the tweet on X.", 502) : error);
  }
}
