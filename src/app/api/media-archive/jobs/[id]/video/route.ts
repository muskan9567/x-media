import { ApiError, apiErrorResponse } from "@/lib/api-response";
import { getArchiveJobs } from "@/lib/tracker/archive-jobs";
import { mediaUrlSchema } from "@/lib/tracker/archive-job-types";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

// The caller selects a saved attachment, never an arbitrary upstream URL.
export async function GET(request: Request, context: Context) {
  try {
    const itemId = new URL(request.url).searchParams.get("item");
    if (!itemId) throw new ApiError("Select a saved video.", 422);
    const view = await (await getArchiveJobs()).get((await context.params).id);
    const item = view.result.items.find((media) => media.id === itemId);
    if (!item || item.media.type === "photo") throw new ApiError("Saved video not found.", 404);
    const variant = [...item.media.variants]
      .filter((v) => v.contentType === "video/mp4" || /\.mp4(?:$|\?)/i.test(v.url))
      .sort((a, b) => (b.bitRate ?? 0) - (a.bitRate ?? 0))[0];
    if (!variant) throw new ApiError("Refresh this video's link before playing it.", 404);
    const url = mediaUrlSchema.parse(variant.url);
    const range = request.headers.get("range");
    if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range)) throw new ApiError("Invalid video range.", 416);
    const upstream = await fetch(url, {
      headers: range ? { Range: range } : {},
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(120_000)]),
      redirect: "error", cache: "no-store",
    });
    if (upstream.status === 416) {
      await upstream.body?.cancel();
      return new Response(null, { status: 416, headers: { "Content-Range": upstream.headers.get("content-range") || "bytes */*" } });
    }
    if (![200, 206].includes(upstream.status) || !upstream.headers.get("content-type")?.startsWith("video/mp4")) {
      await upstream.body?.cancel();
      throw new ApiError("This video is temporarily unavailable. Refresh its link or try again later.", 502);
    }
    const headers = new Headers({ "Content-Type": "video/mp4", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
    for (const name of ["content-length", "content-range", "accept-ranges"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    return apiErrorResponse(error instanceof TypeError || (error instanceof DOMException) ? new ApiError("Could not load the video. Try refreshing its link.", 502) : error);
  }
}
