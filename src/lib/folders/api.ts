import { z } from "zod";
import { ApiError, apiErrorResponse } from "@/lib/api-response";
import { folderNameSchema, mediaReferenceSchema } from "./types";
import type { FolderStore } from "./store";

export async function foldersRequest(request: Request, segments: string[], store: FolderStore) {
  try {
    const url = new URL(request.url); url.host = request.headers.get("host") || url.host;
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new ApiError("Folders are available on this computer only.", 403);
    const write = request.method !== "GET";
    if (request.headers.get("sec-fetch-site") === "cross-site" || (request.headers.get("origin") && request.headers.get("origin") !== url.origin)) throw new ApiError("Open X Media on this computer to use folders.", 403);
    async function body() {
      if (Number(request.headers.get("content-length")) > 16384) throw new ApiError("Request is too large.", 413);
      const text = await request.text(); if (text.length > 16384) throw new ApiError("Request is too large.", 413);
      try { return JSON.parse(text); } catch { throw new ApiError("Invalid request.", 422); }
    }
    let result: unknown;
    if (!segments.length && request.method === "GET") result = await store.list(url.searchParams.get("itemKey") ?? undefined);
    else if (!segments.length && request.method === "POST") result = await store.create(z.object({ name: folderNameSchema }).strict().parse(await body()).name);
    else if (segments.length === 1 && segments[0] === "memberships" && request.method === "PUT") {
      const data = z.object({ media: mediaReferenceSchema, folderIds: z.array(z.string().uuid()).max(1000) }).strict().parse(await body());
      result = await store.place(data.media, data.folderIds);
    } else if (segments.length === 2 && segments[0] === "assets" && !write) {
      const asset = await store.asset(segments[1]);
      const extension = asset.mime.split("/")[1];
      return new Response(new Uint8Array(asset.bytes), { headers: { "Content-Type": asset.mime, "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff", ...(url.searchParams.has("download") ? { "Content-Disposition": `attachment; filename="meme.${extension}"` } : {}) } });
    } else if (segments.length === 1) {
      const id = z.string().uuid().parse(segments[0]);
      if (!write) result = await store.detail(id);
      else if (request.method === "PATCH") result = await store.rename(id, z.object({ name: folderNameSchema }).strict().parse(await body()).name);
      else if (request.method === "DELETE") { await store.delete(id); result = { ok: true }; }
      else throw new ApiError("Method not allowed.", 405);
    } else if (segments.length === 3 && segments[1] === "items" && request.method === "DELETE") {
      await store.remove(z.string().uuid().parse(segments[0]), segments[2]); result = { ok: true };
    } else throw new ApiError("Folder endpoint not found.", 404);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
