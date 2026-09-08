import { apiErrorResponse } from "@/lib/api-response";

export function postsErrorResponse(error: unknown) {
  // Instrumentation and route bundles can contain different copies of ApiError.
  if (error instanceof Error && error.name === "ApiError" && "status" in error && typeof error.status === "number" && error.status >= 400 && error.status <= 599) {
    return Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
  }
  return apiErrorResponse(error);
}
