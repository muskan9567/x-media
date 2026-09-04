import { z } from "zod";

import { apiErrorResponse } from "@/lib/api-response";
import { fetchMediaArchive } from "@/lib/tracker/media-archive";

export const runtime = "nodejs";

const archiveRequestSchema = z
  .object({
    username: z.string().trim().min(1).max(16),
  })
  .strict();

export async function POST(request: Request) {
  try {
    const input = archiveRequestSchema.parse(await request.json());
    return Response.json(await fetchMediaArchive(input.username));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
