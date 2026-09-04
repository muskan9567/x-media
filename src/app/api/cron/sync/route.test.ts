import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tracker/service", () => ({
  syncTrackedAccounts: vi.fn(),
}));

import { syncTrackedAccounts } from "@/lib/tracker/service";
import type { SyncRunReport } from "@/lib/tracker/types";

import { GET, HEAD } from "./route";

const originalSecret = process.env.CRON_SECRET;

function report(outcome: SyncRunReport["outcome"]): SyncRunReport {
  return {
    snapshot: {
      providerMode: "x",
      dataMode: "x",
      containsDemoData: false,
      demoMode: false,
      summary: {
        trackedAccounts: 2,
        viralNow: 0,
        replyReady: 0,
        totalAudience: 1_000,
        averageVirality: 50,
        lastSyncedAt: "2026-08-23T12:00:00.000Z",
      },
      niches: [],
      activity: [],
      accounts: [],
      tweets: [],
    },
    outcome,
    attempted: 2,
    succeeded: outcome === "failed" ? 0 : 1,
    failed:
      outcome === "failed" ? 2 : outcome === "partial" ? 1 : 0,
    skipped: 0,
    failures: [],
  };
}

function request(secret = "cron-test", scheme = "Bearer"): Request {
  return new Request("http://localhost/api/cron/sync", {
    headers: { Authorization: `${scheme} ${secret}` },
  });
}

beforeEach(() => {
  process.env.CRON_SECRET = "cron-test";
});

afterEach(() => {
  vi.mocked(syncTrackedAccounts).mockReset();
  if (originalSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalSecret;
});

describe("GET /api/cron/sync", () => {
  it("rejects an invalid secret before synchronization", async () => {
    const response = await GET(request("wrong"));

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect(syncTrackedAccounts).not.toHaveBeenCalled();
  });

  it("accepts a case-insensitive bearer scheme", async () => {
    vi.mocked(syncTrackedAccounts).mockResolvedValue(report("success"));

    const response = await GET(request("cron-test", "bEaReR"));

    expect(response.status).toBe(200);
    expect(syncTrackedAccounts).toHaveBeenCalledOnce();
  });

  it("handles HEAD without triggering synchronization", async () => {
    const response = HEAD();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
    await expect(response.text()).resolves.toBe("");
    expect(syncTrackedAccounts).not.toHaveBeenCalled();
  });

  it("reports partial counts as a distinguishable success", async () => {
    vi.mocked(syncTrackedAccounts).mockResolvedValue(report("partial"));

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      outcome: "partial",
      attempted: 2,
      succeeded: 1,
      failed: 1,
    });
  });

  it("returns 502 and ok false when every account fails", async () => {
    vi.mocked(syncTrackedAccounts).mockResolvedValue(report("failed"));

    const response = await GET(request());

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      outcome: "failed",
      attempted: 2,
      succeeded: 0,
      failed: 2,
    });
  });
});
