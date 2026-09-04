import { describe, expect, it } from "vitest";

import { inferNiches, listAvailableNiches } from "./taxonomy";

describe("inferNiches", () => {
  it("ranks repeated and specific keyword matches", () => {
    const result = inferNiches(
      "A SaaS founder shares a startup launch, MRR lessons, and product market fit research.",
    );

    expect(result[0].name).toBe("Startups & SaaS");
    expect(result[0].confidence).toBeGreaterThanOrEqual(80);
    expect(result.map((item) => item.name)).toContain("Product & Design");
  });

  it("keeps manual niches first with full confidence and deduplicates labels", () => {
    const result = inferNiches(
      "AI agents and software automation for engineering teams.",
      ["Developer Tools", "ai & tech", "Developer Tools"],
      3,
    );

    expect(result.slice(0, 2)).toEqual([
      { name: "Developer Tools", confidence: 100 },
      { name: "ai & tech", confidence: 100 },
    ]);
    expect(
      result.filter((item) => item.name.toLowerCase() === "ai & tech"),
    ).toHaveLength(1);
    expect(
      result.filter((item) => item.name === "Developer Tools"),
    ).toHaveLength(1);
  });

  it("uses word boundaries so short keywords do not match inside words", () => {
    const result = inferNiches(
      "We are training teams to maintain reliable retail operations.",
    );

    expect(result.map((item) => item.name)).not.toContain("AI & Tech");
  });

  it("returns an empty list when there is no taxonomy or manual match", () => {
    expect(inferNiches("Ceramic glazing notes from a weekend workshop.")).toEqual(
      [],
    );
  });
});

describe("listAvailableNiches", () => {
  it("exposes the stable built-in taxonomy", () => {
    expect(listAvailableNiches()).toEqual(
      expect.arrayContaining([
        "AI & Tech",
        "Engineering",
        "Startups & SaaS",
        "Marketing & Growth",
        "Product & Design",
      ]),
    );
  });
});
