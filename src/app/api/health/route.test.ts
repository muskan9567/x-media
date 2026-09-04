import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tracker/provider", () => ({
  getXProvider: vi.fn(),
}));

import { getXProvider } from "@/lib/tracker/provider";

import { GET } from "./route";

afterEach(() => {
  vi.mocked(getXProvider).mockReset();
});

describe("GET /api/health", () => {
  it("reports the active provider and current server time", async () => {
    vi.mocked(getXProvider).mockReturnValue({ mode: "mock" } as never);

    const earliestTimestamp = Date.now();
    const response = await GET();
    const latestTimestamp = Date.now();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      providerMode: "mock",
    });
    expect(Date.parse(body.timestamp)).toBeGreaterThanOrEqual(earliestTimestamp);
    expect(Date.parse(body.timestamp)).toBeLessThanOrEqual(latestTimestamp);
    expect(getXProvider).toHaveBeenCalledOnce();
  });

  it("returns a safe server error when provider configuration is invalid", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getXProvider).mockImplementation(() => {
      throw new Error("X_API_BASE_URL contains secret infrastructure details.");
    });

    const response = await GET();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Internal server error.",
    });
    expect(consoleError).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });
});
