import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tracker/media-archive", () => ({
  fetchMediaArchive: vi.fn(),
}));

import { fetchMediaArchive } from "@/lib/tracker/media-archive";

import { POST } from "./route";

function request(body: unknown): Request {
  return new Request("http://localhost/api/media-archive", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.mocked(fetchMediaArchive).mockReset();
});

describe("POST /api/media-archive", () => {
  it("rejects unsupported request fields", async () => {
    const response = await POST(request({ username: "example", token: "client-secret" }));

    expect(response.status).toBe(422);
    expect(fetchMediaArchive).not.toHaveBeenCalled();
  });

  it("starts an archive search for the supplied username", async () => {
    vi.mocked(fetchMediaArchive).mockResolvedValue({} as never);

    const response = await POST(request({ username: " @Example " }));

    expect(response.status).toBe(200);
    expect(fetchMediaArchive).toHaveBeenCalledWith("@Example");
  });
});
