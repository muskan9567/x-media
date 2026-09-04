import { describe, expect, it } from "vitest";

import { parsePositiveInteger } from "./config";

describe("parsePositiveInteger", () => {
  it.each([undefined, "", "   "])(
    "uses the default for an unset or blank value (%s)",
    (value) => {
      expect(parsePositiveInteger("LIMIT", value, 25, 100)).toBe(25);
    },
  );

  it("accepts strict positive base-10 integers", () => {
    expect(parsePositiveInteger("LIMIT", " 42 ", 25, 100)).toBe(42);
    expect(parsePositiveInteger("LIMIT", "100", 25, 100)).toBe(100);
  });

  it.each([
    "0",
    "-1",
    "1.5",
    "NaN",
    "Infinity",
    "1e2",
    "0x10",
    "abc",
    "9007199254740992",
  ])("rejects an unsafe value (%s)", (value) => {
    expect(() => parsePositiveInteger("LIMIT", value, 25, 100)).toThrow(
      /LIMIT must/,
    );
  });

  it("rejects values above the operational maximum", () => {
    expect(() => parsePositiveInteger("LIMIT", "101", 25, 100)).toThrow(
      "LIMIT must be between 1 and 100.",
    );
  });
});
