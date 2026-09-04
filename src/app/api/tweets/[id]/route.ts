import { z } from "zod";

import { apiErrorResponse } from "@/lib/api-response";
import { updateTweetWorkflow } from "@/lib/tracker/service";

export const runtime = "nodejs";

const updateTweetSchema = z.object({
  workflowStatus: z.enum(["new", "saved", "responded", "dismissed"]),
});

export async function PATCH(
  request: Request,
  context: RouteContext<"/api/tweets/[id]">,
) {
  try {
    const { id } = await context.params;
    const input = updateTweetSchema.parse(await request.json());
    return Response.json(await updateTweetWorkflow(id, input));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
