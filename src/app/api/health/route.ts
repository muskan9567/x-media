import { apiErrorResponse } from "@/lib/api-response";
import { getXProvider } from "@/lib/tracker/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json({
      ok: true,
      providerMode: getXProvider().mode,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
