import { z } from "zod";

import { ApiError, apiErrorResponse } from "@/lib/api-response";
import { trackerConfig } from "@/lib/tracker/config";
import { syncTrackedAccounts } from "@/lib/tracker/service";

export const runtime = "nodejs";

const syncSchema = z
  .object({
    accountIds: z
      .array(z.string().trim().min(1))
      .min(1)
      .max(trackerConfig.maxTrackedAccounts)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "Account IDs must be unique.",
      })
      .optional(),
  })
  .strict();

async function parseBody(request: Request): Promise<unknown> {
  const raw = await request.text();
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ApiError("Request body must be valid JSON.", 400);
  }
}

export async function POST(request: Request) {
  try {
    const input = syncSchema.parse(await parseBody(request));
    const report = await syncTrackedAccounts(input.accountIds);
    if (report.outcome === "failed") {
      return Response.json(
        {
          error: `All ${report.failed} attempted account syncs failed.`,
          ...report,
        },
        { status: 502 },
      );
    }
    return Response.json(report);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
