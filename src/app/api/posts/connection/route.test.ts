import { describe, expect, it } from "vitest";
import { GET, POST } from "./route";

describe("free Posts connection", () => {
  it("reports a ready free source without reading any credentials", async () => {
    const response = await GET();
    expect(await response.json()).toEqual({ configured: true, source: "timeline", free: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("retires the paid token form for stale clients", async () => {
    const response = await POST(); expect(response.status).toBe(410);
    expect((await response.json()).error).toContain("free public collection");
  });
});
