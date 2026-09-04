import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tracker/service", () => ({
  syncTrackedAccounts: vi.fn(),
}));

import { syncTrackedAccounts } from "@/lib/tracker/service";
import type { SyncRunReport } from "@/lib/tracker/types";

import { POST } from "./route";

function report(outcome: SyncRunReport["outcome"]): SyncRunReport {
  return {
    snapshot: {
      providerMode: "x",
      dataMode: "empty",
      containsDemoData: false,
      demoMode: false,
      summary: {
        trackedAccounts: 0,
        viralNow: 0,
        replyReady: 0,
        totalAudience: 0,
        averageVirality: 0,
      },
      niches: [],
      activity: [],
      accounts: [],
      tweets: [],
    },
    outcome,
    attempted: outcome === "noop" ? 0 : 1,
    succeeded: outcome === "success" ? 1 : 0,
    failed: outcome === "failed" ? 1 : 0,
    skipped: 0,
    failures:
      outcome === "failed"
        ? [{ accountId: "account-1", username: "one", message: "failed" }]
        : [],
  };
}

function request(body?: string): Request {
  return new Request("http://localhost/api/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

afterEach(() => {
  vi.mocked(syncTrackedAccounts).mockReset();
});

describe("POST /api/sync", () => {
  it("returns 400 for malformed JSON without invoking synchronization", async () => {
    const response = await POST(request("{"));

    expect(response.status).toBe(400);
    expect(syncTrackedAccounts).not.toHaveBeenCalled();
  });

  it.each([
    ["empty selection", { accountIds: [] }],
    ["blank account", { accountIds: ["   "] }],
    ["duplicate selection", { accountIds: ["a", "a"] }],
    ["unknown property", { accountId: ["a"] }],
  ])("returns 422 for %s", async (_name, body) => {
    const response = await POST(request(JSON.stringify(body)));

    expect(response.status).toBe(422);
    expect(syncTrackedAccounts).not.toHaveBeenCalled();
  });

  it("treats an empty body or object as an all-active sync", async () => {
    vi.mocked(syncTrackedAccounts).mockResolvedValue(report("noop"));

    const emptyResponse = await POST(request());
    const objectResponse = await POST(request("{}"));

    expect(emptyResponse.status).toBe(200);
    expect(objectResponse.status).toBe(200);
    expect(syncTrackedAccounts).toHaveBeenNthCalledWith(1, undefined);
    expect(syncTrackedAccounts).toHaveBeenNthCalledWith(2, undefined);
  });

  it("passes a valid explicit selection unchanged", async () => {
    vi.mocked(syncTrackedAccounts).mockResolvedValue(report("success"));

    const response = await POST(
      request(JSON.stringify({ accountIds: [" account-1 "] })),
    );

    expect(response.status).toBe(200);
    expect(syncTrackedAccounts).toHaveBeenCalledWith(["account-1"]);
  });

  it("returns a non-2xx response with the persisted report when all fail", async () => {
    vi.mocked(syncTrackedAccounts).mockResolvedValue(report("failed"));

    const response = await POST(request("{}"));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toMatchObject({
      outcome: "failed",
      attempted: 1,
      succeeded: 0,
      failed: 1,
      snapshot: { accounts: [] },
    });
  });
});
