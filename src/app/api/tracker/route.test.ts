import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tracker/service", () => ({
  getTrackerSnapshot: vi.fn(),
}));

import { ApiError } from "@/lib/api-response";
import { getTrackerSnapshot } from "@/lib/tracker/service";
import type { TrackerSnapshot } from "@/lib/tracker/types";

import { GET } from "./route";

const snapshot: TrackerSnapshot = {
  providerMode: "mock",
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
};

afterEach(() => {
  vi.mocked(getTrackerSnapshot).mockReset();
});

describe("GET /api/tracker", () => {
  it("returns the current tracker snapshot", async () => {
    vi.mocked(getTrackerSnapshot).mockResolvedValue(snapshot);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(snapshot);
    expect(getTrackerSnapshot).toHaveBeenCalledOnce();
  });

  it("preserves intentional service errors", async () => {
    vi.mocked(getTrackerSnapshot).mockRejectedValue(
      new ApiError("Tracker is unavailable.", 503),
    );

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Tracker is unavailable.",
    });
  });
});
