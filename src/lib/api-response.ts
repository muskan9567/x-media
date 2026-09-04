import { ZodError } from "zod";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function apiErrorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return Response.json({ error: error.message }, { status: error.status });
  }

  if (error instanceof ZodError) {
    return Response.json({ error: "Invalid request." }, { status: 422 });
  }

  console.error("Unexpected API error:", error);
  return Response.json({ error: "Internal server error." }, { status: 500 });
}
