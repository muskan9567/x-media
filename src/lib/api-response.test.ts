import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { ApiError, apiErrorResponse } from "./api-response";

describe("apiErrorResponse", () => {
  it.each([
    [404, "Tracked account not found."],
    [409, "Tracked account is paused."],
    [422, "Select at least one account."],
    [503, "X is temporarily unavailable."],
  ] as const)("preserves an intentional %i response", async (status, message) => {
    const response = apiErrorResponse(new ApiError(message, status));

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error: message });
  });

  it("returns a safe 422 for structured request validation failures", async () => {
    const validationError = z.object({ name: z.string().min(1) }).safeParse({
      name: "",
    });
    if (validationError.success) throw new Error("Expected validation to fail.");

    const response = apiErrorResponse(validationError.error);

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: "Invalid request." });
  });

  it("returns a generic 500 without exposing unexpected error details", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error(
      "State file not found: C:\\private\\tracker-state.json",
    );
    const response = apiErrorResponse(error);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Internal server error.",
    });
    expect(consoleError).toHaveBeenCalledWith("Unexpected API error:", error);
    consoleError.mockRestore();
  });
});
