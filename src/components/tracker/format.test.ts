import { describe, expect, it } from "vitest";

import {
  absoluteTime,
  compactNumber,
  preciseNumber,
  relativeTime,
  scoreTone,
  stageLabel,
} from "./format";

describe("tracker formatting", () => {
  it("formats relative time against an explicit deterministic reference", () => {
    const reference = new Date("2026-08-23T12:00:00.000Z").getTime();

    expect(relativeTime("2026-08-23T11:00:00.000Z", reference)).toBe(
      "1 hour ago",
    );
    expect(relativeTime("2026-08-23T14:00:00.000Z", reference)).toBe(
      "in 2 hours",
    );
  });

  it("formats absolute post timestamps in explicit UTC", () => {
    expect(absoluteTime("2026-08-23T03:07:00.000Z")).toBe(
      "Aug 23, 2026 · 3:07 AM UTC",
    );
    expect(absoluteTime("2026-08-23T15:17:00.000Z")).toBe(
      "Aug 23, 2026 · 3:17 PM UTC",
    );
    expect(absoluteTime("invalid")).toBe("Unknown time");
  });

  it("formats compact and precise counts", () => {
    expect(compactNumber(999)).toBe("999");
    expect(compactNumber(12_345)).toBe("12.3K");
    expect(preciseNumber(12_345)).toBe("12,345");
  });

  it("maps stages and score bands to their display treatments", () => {
    expect(stageLabel("baseline")).toBe("Baseline");
    expect(stageLabel("emerging")).toBe("Emerging");
    expect(stageLabel("rising")).toBe("Rising");
    expect(stageLabel("viral")).toBe("Viral");
    expect(stageLabel("cooling")).toBe("Cooling");

    expect(scoreTone(82)).toContain("emerald");
    expect(scoreTone(68)).toContain("amber");
    expect(scoreTone(55)).toContain("blue");
    expect(scoreTone(54)).toContain("muted");
  });
});
