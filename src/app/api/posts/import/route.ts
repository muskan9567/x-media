import { ApiError } from "@/lib/api-response";
import { postsErrorResponse } from "@/lib/posts/api-response";
import { archiveImportSchema, MAX_ARCHIVE_BYTES } from "@/lib/posts/archive-import";
import { getPostsService } from "@/lib/posts/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const url = new URL(request.url), origin = request.headers.get("origin");
    const host = request.headers.get("host") || url.host;
    if (origin && origin !== `${url.protocol}//${host}` || request.headers.get("sec-fetch-site") === "cross-site") throw new ApiError("Import from X Media on this computer.", 403);
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new ApiError("Expected an archive JSON file.", 415);
    // Bound the stream before buffering; Content-Length is not trusted.
    const reader = request.body?.getReader();
    if (!reader) throw new ApiError("The archive is empty.", 400);
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > MAX_ARCHIVE_BYTES * 2) { await reader.cancel(); throw new ApiError("The archive is too large. Import a smaller batch of tweet files.", 413); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    let json: unknown;
    try { json = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new ApiError("Invalid archive JSON. No tweets were imported.", 400); }
    const archive = archiveImportSchema.safeParse(json);
    if (!archive.success) throw new ApiError("Invalid tweet archive or account identity. No tweets were imported.", 422);
    return Response.json(await (await getPostsService()).importArchive(archive.data), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return postsErrorResponse(error); }
}
