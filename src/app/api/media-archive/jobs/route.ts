import { z } from "zod";
import { apiErrorResponse } from "@/lib/api-response";
import { getArchiveJobs } from "@/lib/tracker/archive-jobs";
import { usernameSchema } from "@/lib/tracker/archive-job-types";
export const runtime = "nodejs";
const schema = z.object({ username: usernameSchema, refresh: z.boolean().optional() }).strict();
export async function GET() {
  try { return Response.json(await (await getArchiveJobs()).list(), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return apiErrorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    return Response.json(await (await getArchiveJobs()).create(body.username, body.refresh), { status: 202 });
  } catch (error) { return apiErrorResponse(error); }
}
