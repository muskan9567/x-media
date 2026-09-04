import { timingSafeEqual } from "node:crypto";

import { apiErrorResponse } from "@/lib/api-response";
import { syncTrackedAccounts } from "@/lib/tracker/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function secretsMatch(received: string, expected: string): boolean {
  const receivedBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);
  return (
    receivedBytes.length === expectedBytes.length &&
    timingSafeEqual(receivedBytes, expectedBytes)
  );
}

export function HEAD() {
  return new Response(null, {
    status: 405,
    headers: { Allow: "GET" },
  });
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return Response.json(
      { error: "CRON_SECRET is not configured." },
      { status: 503 },
    );
  }

  const authorization = request.headers.get("authorization") ?? "";
  const received = /^Bearer[ \t]+(.+)$/i.exec(authorization)?.[1] ?? "";
  if (!secretsMatch(received, secret)) {
    return Response.json(
      { error: "Unauthorized." },
      {
        status: 401,
        headers: { "WWW-Authenticate": "Bearer" },
      },
    );
  }

  try {
    const report = await syncTrackedAccounts();
    const body = {
      ok: report.outcome !== "failed",
      outcome: report.outcome,
      syncedAt: report.snapshot.summary.lastSyncedAt,
      attempted: report.attempted,
      succeeded: report.succeeded,
      failed: report.failed,
      skipped: report.skipped,
      failures: report.failures,
    };
    return Response.json(body, {
      status: report.outcome === "failed" ? 502 : 200,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
