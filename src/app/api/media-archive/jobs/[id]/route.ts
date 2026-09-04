import { z } from "zod";
import { apiErrorResponse } from "@/lib/api-response";
import { getArchiveJobs } from "@/lib/tracker/archive-jobs";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("cancel") }).strict(),
  z.object({ action: z.literal("retry") }).strict(),
  z.object({ action: z.literal("repair"), postId: z.string().regex(/^\d+$/) }).strict(),
]);
export async function GET(_request: Request, context: Context) {
  try { return Response.json(await (await getArchiveJobs()).get((await context.params).id), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return apiErrorResponse(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const body = actionSchema.parse(await request.json());
    const manager = await getArchiveJobs();
    return Response.json(body.action === "cancel" ? await manager.cancel(id) : body.action === "retry" ? await manager.retry(id) : await manager.repair(id, body.postId));
  } catch (error) { return apiErrorResponse(error); }
}
