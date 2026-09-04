import { z } from "zod";

import { apiErrorResponse } from "@/lib/api-response";
import {
  removeTrackedAccount,
  updateTrackedAccount,
} from "@/lib/tracker/service";

export const runtime = "nodejs";

const updateAccountSchema = z
  .object({
    active: z.boolean().optional(),
    manualNiches: z
      .array(z.string().trim().min(2).max(36))
      .max(6)
      .optional(),
  })
  .strict()
  .refine(
    (input) => input.active !== undefined || input.manualNiches !== undefined,
    "Provide at least one account field to update.",
  );

export async function PATCH(
  request: Request,
  context: RouteContext<"/api/accounts/[id]">,
) {
  try {
    const { id } = await context.params;
    const input = updateAccountSchema.parse(await request.json());
    return Response.json(await updateTrackedAccount(id, input));
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  context: RouteContext<"/api/accounts/[id]">,
) {
  try {
    const { id } = await context.params;
    return Response.json(await removeTrackedAccount(id));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
