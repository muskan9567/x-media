import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tracker/service", () => ({
  addTrackedAccount: vi.fn(),
}));

import { addTrackedAccount } from "@/lib/tracker/service";

import { POST } from "./route";

function request(body: unknown): Request {
  return new Request("http://localhost/api/accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.mocked(addTrackedAccount).mockReset();
});

describe("POST /api/accounts", () => {
  it("rejects client-supplied identity fields", async () => {
    const response = await POST(
      request({ username: "validuser", xUserId: "attacker-chosen" }),
    );

    expect(response.status).toBe(422);
    expect(addTrackedAccount).not.toHaveBeenCalled();
  });

  it("passes only the supported account input", async () => {
    vi.mocked(addTrackedAccount).mockResolvedValue({} as never);

    const response = await POST(
      request({ username: " validuser ", niches: [" AI "] }),
    );

    expect(response.status).toBe(201);
    expect(addTrackedAccount).toHaveBeenCalledWith({
      username: "validuser",
      niches: ["AI"],
    });
  });
});
