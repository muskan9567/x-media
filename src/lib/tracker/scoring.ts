import type {
  MetricSnapshot,
  TrackedAccount,
  TrackedTweet,
  TweetMetrics,
  ViralityStage,
} from "./types";

const HOUR_MS = 60 * 60 * 1000;
export const VIRAL_SCORE_THRESHOLD = 82;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function robustZ(value: number, population: number[]): number {
  if (population.length < 3) return 0;
  const center = median(population);
  const deviations = population.map((item) => Math.abs(item - center));
  const mad = median(deviations) * 1.4826;

  if (mad > 0.0001) return (value - center) / mad;

  const variance =
    population.reduce((sum, item) => sum + (item - center) ** 2, 0) /
    population.length;
  const deviation = Math.sqrt(variance);
  if (deviation > 0.0001) return (value - center) / deviation;

  const delta = value - center;
  const equalityTolerance = Math.max(0.0001, Math.abs(center) * 0.000001);
  if (Math.abs(delta) <= equalityTolerance) return 0;
  return delta > 0 ? 5 : -3;
}

export function weightedEngagement(metrics: TweetMetrics): number {
  return (
    metrics.likeCount +
    metrics.repostCount * 2.2 +
    metrics.quoteCount * 1.8 +
    metrics.replyCount * 0.7 +
    metrics.bookmarkCount * 1.25
  );
}

export function hoursSince(createdAt: string, now = new Date()): number {
  const timestamp = new Date(createdAt).getTime();
  if (!Number.isFinite(timestamp)) return 24;
  return Math.max(0.25, (now.getTime() - timestamp) / HOUR_MS);
}

function comparableObservation(
  tweet: TrackedTweet,
  targetAgeHours: number,
  now: Date,
): { metrics: TweetMetrics; ageHours: number } {
  const createdAt = new Date(tweet.createdAt).getTime();
  const currentAge = hoursSince(tweet.createdAt, now);
  if (!Number.isFinite(createdAt)) {
    return { metrics: tweet.metrics, ageHours: currentAge };
  }

  const desiredAge = Math.min(targetAgeHours, currentAge);
  const observations: MetricSnapshot[] = [...tweet.snapshots];
  const lastSeenAt = new Date(tweet.lastSeenAt).getTime();
  observations.push({
    observedAt: Number.isFinite(lastSeenAt)
      ? tweet.lastSeenAt
      : new Date(createdAt + currentAge * HOUR_MS).toISOString(),
    metrics: tweet.metrics,
  });

  const candidates = observations
    .map((observation) => ({
      metrics: observation.metrics,
      ageHours: Math.max(
        0.25,
        (new Date(observation.observedAt).getTime() - createdAt) / HOUR_MS,
      ),
    }))
    .filter((observation) => Number.isFinite(observation.ageHours));

  return (
    candidates.sort(
      (a, b) =>
        Math.abs(a.ageHours - desiredAge) -
        Math.abs(b.ageHours - desiredAge),
    )[0] ?? { metrics: tweet.metrics, ageHours: currentAge }
  );
}

function momentumObservations(tweet: TrackedTweet): MetricSnapshot[] {
  const observations = [...tweet.snapshots].sort(
    (a, b) =>
      new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime(),
  );
  const lastSnapshotAt = observations.length
    ? new Date(observations[observations.length - 1].observedAt).getTime()
    : Number.NEGATIVE_INFINITY;
  const lastSeenAt = new Date(tweet.lastSeenAt).getTime();
  if (Number.isFinite(lastSeenAt) && lastSeenAt > lastSnapshotAt) {
    observations.push({ observedAt: tweet.lastSeenAt, metrics: tweet.metrics });
  }
  return observations;
}

function freshnessScore(ageHours: number, halfLifeHours: number): number {
  return Math.exp((-Math.LN2 * ageHours) / halfLifeHours);
}

function deriveRiskFlags(tweet: TrackedTweet): string[] {
  const flags: string[] = [];
  const normalized = tweet.text.toLowerCase();

  if (tweet.possiblySensitive) flags.push("Sensitive-content flag");
  if (tweet.source === "x") {
    if (tweet.replySettings === "mentionedUsers") {
      flags.push("Replies are limited to mentioned accounts");
    } else if (tweet.replySettings === "following") {
      flags.push("Replies are limited to accounts the author follows");
    } else if (tweet.replySettings === undefined) {
      flags.push("Reply eligibility was not provided by X");
    }
  }
  if (/\b(giveaway|airdrop|free money|dm me)\b/i.test(normalized)) {
    flags.push("Promotional or spam-like language");
  }
  if ((tweet.text.match(/https?:\/\//g) ?? []).length >= 3) {
    flags.push("Link-heavy post");
  }
  if (tweet.text.length > 30) {
    const letters = tweet.text.replace(/[^a-z]/gi, "");
    const uppercase = tweet.text.replace(/[^A-Z]/g, "");
    if (letters.length > 0 && uppercase.length / letters.length > 0.72) {
      flags.push("Mostly uppercase text");
    }
  }

  return flags;
}

function stageFor(
  viralityScore: number,
  ageHours: number,
  momentumSignal: number,
): ViralityStage {
  if (ageHours > 72 && momentumSignal <= 0) return "cooling";
  if (viralityScore >= VIRAL_SCORE_THRESHOLD) return "viral";
  if (viralityScore >= 68) return "rising";
  if (viralityScore >= 55 && ageHours <= 24) return "emerging";
  return "baseline";
}

export interface ScoringResult {
  viralityScore: number;
  replyScore: number;
  confidence: number;
  stage: ViralityStage;
  scoreReasons: string[];
  replyReasons: string[];
  riskFlags: string[];
}

export function scoreTweet(
  tweet: TrackedTweet,
  account: TrackedAccount,
  comparisonTweets: TrackedTweet[],
  targetNiches: string[],
  now = new Date(),
): ScoringResult {
  const ageHours = hoursSince(tweet.createdAt, now);
  const engagement = weightedEngagement(tweet.metrics);
  const velocity = engagement / ageHours;
  const engagementRate = engagement / Math.max(account.followersCount, 100);

  const eligibleComparisons = comparisonTweets.filter(
    (candidate) =>
      candidate.id !== tweet.id && candidate.accountId === account.id,
  );
  const baselinePool =
    eligibleComparisons.length >= 4 ? eligibleComparisons : [];

  const baselineObservations = baselinePool.map((candidate) => ({
    candidate,
    observation: comparableObservation(candidate, ageHours, now),
  }));
  const velocityPopulation = baselineObservations.map(({ observation }) =>
    Math.log1p(
      weightedEngagement(observation.metrics) / observation.ageHours,
    ),
  );
  const ratePopulation = baselineObservations.map(
    ({ candidate, observation }) =>
      Math.log1p(
        (weightedEngagement(observation.metrics) /
          Math.max(candidate.authorFollowersCount, 100)) *
          1_000,
      ),
  );

  const velocityZ = clamp(
    robustZ(Math.log1p(velocity), velocityPopulation),
    -3,
    5,
  );
  const rateZ = clamp(
    robustZ(Math.log1p(engagementRate * 1_000), ratePopulation),
    -3,
    5,
  );

  const snapshots = momentumObservations(tweet);
  let momentumSignal = 0;
  let momentumTrend: "accelerating" | "decelerating" | "flat" | null = null;
  if (snapshots.length >= 3) {
    const earlier = snapshots[snapshots.length - 3];
    const previous = snapshots[snapshots.length - 2];
    const latest = snapshots[snapshots.length - 1];
    const previousElapsed = Math.max(
      0.25,
      (new Date(previous.observedAt).getTime() -
        new Date(earlier.observedAt).getTime()) /
        HOUR_MS,
    );
    const recentElapsed = Math.max(
      0.25,
      (new Date(latest.observedAt).getTime() -
        new Date(previous.observedAt).getTime()) /
        HOUR_MS,
    );
    const previousVelocity =
      (weightedEngagement(previous.metrics) -
        weightedEngagement(earlier.metrics)) /
      previousElapsed;
    const recentVelocity =
      (weightedEngagement(latest.metrics) -
        weightedEngagement(previous.metrics)) /
      recentElapsed;
    const velocityChange = recentVelocity - previousVelocity;
    const equalityTolerance = Math.max(
      0.0001,
      Math.max(Math.abs(previousVelocity), Math.abs(recentVelocity)) * 0.000001,
    );

    if (Math.abs(velocityChange) <= equalityTolerance) {
      momentumTrend = "flat";
    } else {
      momentumTrend = velocityChange > 0 ? "accelerating" : "decelerating";
      const baselineVelocity = Math.max(
        1,
        median(
          baselineObservations.map(
            ({ observation }) =>
              weightedEngagement(observation.metrics) / observation.ageHours,
          ),
        ),
      );
      momentumSignal = clamp(
        Math.sign(velocityChange) *
          Math.log2(1 + Math.abs(velocityChange) / baselineVelocity),
        -2,
        3.5,
      );
    }
  }

  const reachSignal = clamp(Math.log10(engagement + 1) / 4.2, 0, 1);
  const freshness = freshnessScore(ageHours, 28);
  const historyConfidence = clamp(eligibleComparisons.length / 20, 0, 1);
  const snapshotConfidence = clamp((snapshots.length - 1) / 3, 0, 1);
  const confidence = clamp(
    0.42 + historyConfidence * 0.38 + snapshotConfidence * 0.2,
    0.42,
    1,
  );

  const rawVirality =
    46 +
    velocityZ * 12.5 +
    rateZ * 9.5 +
    momentumSignal * 7 +
    reachSignal * 11 +
    freshness * 4;
  const viralityScore = Math.round(
    clamp(50 + (rawVirality - 50) * (0.68 + confidence * 0.32), 0, 100),
  );

  const normalizedTargets = new Set(
    targetNiches.map((niche) => niche.toLowerCase()),
  );
  const overlapCount = tweet.niches.filter((niche) =>
    normalizedTargets.has(niche.toLowerCase()),
  ).length;
  const nicheRelevance = tweet.niches.length
    ? clamp(0.62 + overlapCount * 0.19, 0, 1)
    : 0.38;
  const conversationRatio =
    tweet.metrics.replyCount /
    Math.max(8, tweet.metrics.likeCount + tweet.metrics.repostCount);
  const questionBonus = /\?|what (?:do|would) you|thoughts\b/i.test(tweet.text)
    ? 0.18
    : 0;
  const repliesAreOpen =
    tweet.source === "mock" || tweet.replySettings === "everyone";
  const conversationOpenness = repliesAreOpen
    ? clamp(
        0.38 + Math.log1p(conversationRatio * 12) / 3 + questionBonus,
        0,
        1,
      )
    : 0;
  const replyFreshness = freshnessScore(ageHours, 14);
  const saturationPenalty =
    tweet.metrics.replyCount > 2_000 || engagement > 80_000 ? 10 : 0;
  const riskFlags = deriveRiskFlags(tweet);
  const riskPenalty = riskFlags.length * 12;

  const replyScore = Math.round(
    clamp(
      viralityScore * 0.38 +
        nicheRelevance * 27 +
        replyFreshness * 18 +
        conversationOpenness * 12 +
        confidence * 5 -
        saturationPenalty -
        riskPenalty,
      0,
      100,
    ),
  );

  const scoreReasons: string[] = [];
  if (velocityZ >= 1.5) {
    scoreReasons.push(
      `${velocityZ.toFixed(1)}× robust deviation above its engagement-velocity baseline`,
    );
  } else if (velocityZ > 0.35) {
    scoreReasons.push("Engagement velocity is above the current baseline");
  } else if (velocityZ < -0.35) {
    scoreReasons.push("Engagement velocity is below the current baseline");
  } else {
    scoreReasons.push("Engagement velocity is near the current baseline");
  }
  if (rateZ >= 1) {
    scoreReasons.push("Outperforming relative to the author’s audience size");
  }
  if (momentumTrend === "accelerating") {
    scoreReasons.push("Momentum accelerated across the latest two intervals");
  } else if (momentumTrend === "decelerating") {
    scoreReasons.push("Momentum decelerated across the latest two intervals");
  } else if (momentumTrend === "flat") {
    scoreReasons.push("Momentum held steady across the latest two intervals");
  }
  if (ageHours <= 8) scoreReasons.push("Still early in its distribution window");

  const replyReasons: string[] = [];
  if (overlapCount > 0) {
    replyReasons.push(
      `${overlapCount} tracked niche${overlapCount === 1 ? "" : "s"} matched`,
    );
  }
  if (replyFreshness >= 0.65) replyReasons.push("Fresh enough to join early");
  if (conversationOpenness >= 0.62) {
    replyReasons.push("Active, open conversation pattern");
  }
  if (saturationPenalty > 0) {
    replyReasons.push("Crowded thread reduces reply visibility");
  }

  return {
    viralityScore,
    replyScore,
    confidence: Math.round(confidence * 100),
    stage: stageFor(viralityScore, ageHours, momentumSignal),
    scoreReasons: scoreReasons.slice(0, 3),
    replyReasons: replyReasons.slice(0, 3),
    riskFlags,
  };
}
