const TAXONOMY: Record<string, string[]> = {
  "AI & Tech": [
    "ai",
    "artificial intelligence",
    "llm",
    "model",
    "agent",
    "machine learning",
    "automation",
    "open source",
    "software",
    "tech",
  ],
  Engineering: [
    "developer",
    "engineering",
    "code",
    "coding",
    "typescript",
    "javascript",
    "python",
    "api",
    "database",
    "devtools",
  ],
  "Startups & SaaS": [
    "startup",
    "saas",
    "founder",
    "bootstrapped",
    "indie hacker",
    "mrr",
    "product market fit",
    "venture",
    "launch",
  ],
  "Marketing & Growth": [
    "marketing",
    "growth",
    "seo",
    "distribution",
    "brand",
    "audience",
    "conversion",
    "copywriting",
    "content strategy",
  ],
  "Creator Economy": [
    "creator",
    "newsletter",
    "youtube",
    "podcast",
    "personal brand",
    "community",
    "monetize",
    "followers",
    "subscribers",
  ],
  "Product & Design": [
    "product",
    "design",
    "ux",
    "ui",
    "figma",
    "prototype",
    "user research",
    "design system",
    "product management",
  ],
  "Finance & Investing": [
    "finance",
    "investing",
    "investor",
    "markets",
    "stocks",
    "portfolio",
    "economy",
    "revenue",
    "fundraising",
  ],
  "Crypto & Web3": [
    "crypto",
    "bitcoin",
    "ethereum",
    "web3",
    "blockchain",
    "defi",
    "token",
    "onchain",
  ],
  "Productivity & Work": [
    "productivity",
    "focus",
    "remote work",
    "leadership",
    "career",
    "management",
    "habits",
    "workflow",
    "time management",
  ],
  "E-commerce": [
    "ecommerce",
    "e-commerce",
    "shopify",
    "d2c",
    "retail",
    "store",
    "customer acquisition",
    "merch",
  ],
};

const WORD_BOUNDARY_PATTERN = /[a-z0-9]/i;

function countOccurrences(haystack: string, keyword: string): number {
  let count = 0;
  let cursor = 0;

  while (cursor < haystack.length) {
    const index = haystack.indexOf(keyword, cursor);
    if (index === -1) break;

    const before = index === 0 ? "" : haystack[index - 1];
    const afterIndex = index + keyword.length;
    const after = afterIndex >= haystack.length ? "" : haystack[afterIndex];
    const boundedBefore = !before || !WORD_BOUNDARY_PATTERN.test(before);
    const boundedAfter = !after || !WORD_BOUNDARY_PATTERN.test(after);

    if (boundedBefore && boundedAfter) count += 1;
    cursor = afterIndex;
  }

  return count;
}

export interface InferredNiche {
  name: string;
  confidence: number;
}

export function inferNiches(
  text: string,
  manualNiches: string[] = [],
  limit = 3,
): InferredNiche[] {
  const normalized = text.toLowerCase();
  const scored = Object.entries(TAXONOMY).map(([name, keywords]) => {
    const hits = keywords.reduce((total, keyword) => {
      const occurrences = countOccurrences(normalized, keyword);
      const specificity = keyword.includes(" ") ? 1.6 : 1;
      return total + occurrences * specificity;
    }, 0);

    return { name, hits };
  })
    .filter(({ hits }) => hits > 0)
    .sort((a, b) => b.hits - a.hits || a.name.localeCompare(b.name));

  const maxHits = scored[0]?.hits ?? 1;
  const inferred = scored.slice(0, limit).map(({ name, hits }) => ({
    name,
    confidence: Math.round(Math.min(96, 48 + (hits / maxHits) * 42)),
  }));

  const manual = manualNiches
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({ name, confidence: 100 }));

  return [...manual, ...inferred]
    .filter(
      (niche, index, niches) =>
        niches.findIndex(
          (candidate) =>
            candidate.name.toLowerCase() === niche.name.toLowerCase(),
        ) === index,
    )
    .slice(0, Math.max(limit, manual.length));
}

export function listAvailableNiches(): string[] {
  return Object.keys(TAXONOMY);
}
