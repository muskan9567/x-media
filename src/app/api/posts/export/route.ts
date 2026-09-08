import { ApiError } from "@/lib/api-response";
import { postsErrorResponse } from "@/lib/posts/api-response";
import { getPostsService } from "@/lib/posts/service";
import { handleSchema } from "@/lib/posts/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const username = handleSchema.parse(new URL(request.url).searchParams.get("username"));
    const view = await (await getPostsService()).get(username);
    if (!view.profile) throw new ApiError("Collect tweets or import an archive before exporting this account.", 409);
    return Response.json({ format: "x-media-posts", version: 1, profile: view.profile, posts: view.posts }, {
      headers: { "Cache-Control": "no-store", "Content-Disposition": `attachment; filename="${username}-tweets.json"` },
    });
  } catch (error) { return postsErrorResponse(error); }
}
