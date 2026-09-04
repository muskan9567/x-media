import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tracker/service", () => ({
  removeTrackedAccount: vi.fn(),
  updateTrackedAccount: vi.fn(),
}));

import { updateTrackedAccount } from "@/lib/tracker/service";

import { PATCH } from "./route";

function request(body: unknown): Request {
  return new Request("http://localhost/api/accounts/account-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const context = {
  params: Promise.resolve({ id: "account-1" }),
} as RouteContext<"/api/accounts/[id]">;

afterEach(() => {
  vi.mocked(updateTrackedAccount).mockReset();
});

describe("PATCH /api/accounts/:id", () => {
  it.each([
    { active: true, xUserId: "different" },
    { active: true, username: "different" },
    { active: true, id: "different" },
  ])("rejects immutable identity input %#", async (body) => {
    const response = await PATCH(request(body), context);

    expect(response.status).toBe(422);
    expect(updateTrackedAccount).not.toHaveBeenCalled();
  });

  it("accepts supported mutable fields", async () => {
    vi.mocked(updateTrackedAccount).mockResolvedValue({} as never);

    const response = await PATCH(
      request({ active: false, manualNiches: [" AI "] }),
      context,
    );

    expect(response.status).toBe(200);
    expect(updateTrackedAccount).toHaveBeenCalledWith("account-1", {
      active: false,
      manualNiches: ["AI"],
    });
  });
});
