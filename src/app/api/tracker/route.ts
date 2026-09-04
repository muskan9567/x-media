import { apiErrorResponse } from "@/lib/api-response";
import { getTrackerSnapshot } from "@/lib/tracker/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await getTrackerSnapshot());
  } catch (error) {
    return apiErrorResponse(error);
  }
}
