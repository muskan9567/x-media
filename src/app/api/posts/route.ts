import { z } from "zod";
import { ApiError } from "@/lib/api-response";
import { postsErrorResponse } from "@/lib/posts/api-response";
import { getPostsService } from "@/lib/posts/service";
import { handleSchema } from "@/lib/posts/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
export async function GET(request: Request) {
  try {
    const service = await getPostsService();
    const url = new URL(request.url), username = url.searchParams.get("username");
    if (!username) return Response.json({ accounts: await service.list() }, { headers });
    const view = await service.get(username);
    const etag = `"original-${view.revision}-${view.status}-${view.retryAt || 0}"`;
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { ...headers, ETag: etag } });
    return Response.json(view, { headers: { ...headers, ETag: etag } });
  } catch (error) { return postsErrorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    const requestUrl = new URL(request.url);
    const host = request.headers.get("host") || requestUrl.host;
    if (origin && origin !== `${requestUrl.protocol}//${host}`) throw new ApiError("This action must be made from X Media.", 403);
    const body = await request.text();
    if (body.length > 2048) throw new ApiError("Request is too large.", 413);
    let json: unknown;
    try { json = JSON.parse(body); } catch { throw new ApiError("Invalid request.", 400); }
    const input = z.object({ username: handleSchema, action: z.enum(["open", "continue", "refresh", "collect", "stop"]).default("open") }).parse(json);
    const service = await getPostsService();
    const view = input.action === "stop" ? await service.stop(input.username) : await service.start(input.username, input.action);
    return Response.json(view, { headers });
  } catch (error) { return postsErrorResponse(error); }
}
