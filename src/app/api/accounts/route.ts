import { z } from "zod";

import { apiErrorResponse } from "@/lib/api-response";
import { addTrackedAccount } from "@/lib/tracker/service";

export const runtime = "nodejs";

const addAccountSchema = z
  .object({
    username: z.string().trim().min(1).max(32),
    niches: z.array(z.string().trim().min(2).max(36)).max(6).optional(),
  })
  .strict();

export async function POST(request: Request) {
  try {
    const input = addAccountSchema.parse(await request.json());
    return Response.json(await addTrackedAccount(input), { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
