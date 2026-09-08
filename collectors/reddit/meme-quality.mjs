import { hasAiCodingTopic, matchingAiCodingTopics, topicText as normalizeTopicText } from "./topic-filter.mjs";

const MEME_SUBREDDIT_WEIGHTS = new Map([
  ["programmerhumor", 26],
  ["programmermemes", 26],
  ["codingmemes", 26],
  ["memes", 22],
  ["dankmemes", 22],
  ["me_irl", 22],
  ["adviceanimals", 22],
  ["wholesomememes", 22],
  ["memeeconomy", 22],
  ["historymemes", 22],
  ["starterpacks", 22],
  ["prequelmemes", 22],
]);

const MEME_FLAIR_RE = /\b(meme|memes|humou?r|funny|comedy|shitpost|satire)\b/i;
const STRONG_HUMOR_RE = /\b(meme|memes|shitpost|starter\s*pack|pov|expectation\s*(?:vs\.?|versus)\s*reality|two\s+minutes?\s+later|2\s+minutes?\s+later)\b/i;
const REACTION_HUMOR_RE = /\b(when (?:you|i|we|your|claude|chatgpt|gpt|ai|copilot|gemini|codex)|me (?:when|trying|after|using|with|vs\.?|versus)|literally (?:me|everyone|us)|be like|in a nutshell|how .{0,45} feels?|(?:\w[\w +.-]{1,35})\s+(?:vs\.?|versus)\s+(?:\w[\w +.-]{1,35}))\b/i;
const LIGHT_HUMOR_RE = /\b(funny|humou?r|joke|lol|lmao|roast|struggle|pain|cardio|gaslight(?:er|ing)?|goofy|bingo|strikes back)\b/i;

const EDITORIAL_RE = /\b(announce[ds]?|announcement|available now|release[ds]?|launch(?:es|ed)?|new model|benchmark|leaderboard|scorecard|paper|research|study|pricing|price drop|discount|free for|usage limit|rate limit|context window|parameters?|token(?:s| limit)?|api|roadmap|changelog|incident|outage)\b/i;
const HELP_RE = /\b(anyone (?:know|notice|help)|can (?:anyone|someone) help|how (?:do|can|to) (?:i|you|we)|what is|why (?:does|is|did)|issue|error|bug|fix|troubleshoot|strategy|best (?:strategy|skills?|setup|model)|recommend(?:ation|ations)?)\b/i;
const PROMO_RE = /\b((?:i|we) (?:built|made|created|launched)|my (?:app|project|tool|plugin|extension|startup)|open[ -]?source (?:tool|kit|project|app)|check out (?:my|our)|github (?:repo|repository)|repository link|directory of|subscribe|newsletter|course|tutorial|guide)\b/i;
const CHAT_LOG_RE = /\b(i (?:told|asked|prompted) (?:my )?(?:chatgpt|gpt|claude|gemini|grok)|(?:chatgpt|gpt|claude|gemini|grok) (?:said|told me|responded|answered))\b/i;
const VAGUE_RE = /^(?:thoughts|help|question|look|wow|this|bro|interesting|impressive|amazing|finally)[!?.\s]*$/i;
const MIN_QUALITY_SCORE = 54;

export function tierForScore(score) {
  return score >= 78 ? "S" : score >= 66 ? "A" : "B";
}

function normalizedText(post) {
  return normalizeTopicText(`${post.title ?? ""}\n${post.selftext ?? post.text ?? ""}\n${post.flair ?? ""}`);
}

export function hasAiTopic(post) {
  return hasAiCodingTopic(`${normalizedText(post)}\n${post.subreddit ?? ""}`);
}

function engagementPoints(score) {
  if (!Number.isFinite(score) || score <= 0) return 0;
  return Math.min(18, Math.round(Math.log10(score + 1) * 6));
}

function commentPoints(comments) {
  if (!Number.isFinite(comments) || comments <= 0) return 0;
  return Math.min(6, Math.round(Math.log10(comments + 1) * 2.5));
}

export function evaluateMeme(post) {
  const title = normalizeTopicText(post.title).trim();
  const text = normalizedText(post);
  const subreddit = String(post.subreddit ?? "").toLowerCase();
  const topicText = `${text}\n${subreddit}`;
  const flair = String(post.flair ?? "");
  const imageCount = Array.isArray(post.images)
    ? post.images.length
    : (post.imageUrl ? 1 : 0);
  const hasImage = imageCount > 0;
  const isGallery = post.isGallery === true;
  const matchedTerms = [...new Set([
    ...matchingAiCodingTopics(topicText),
  ])];
  const topicRelevant = matchedTerms.length > 0;
  const sourceWeight = MEME_SUBREDDIT_WEIGHTS.get(subreddit) ?? 0;
  const hasMemeFlair = MEME_FLAIR_RE.test(flair);
  const strongHumor = STRONG_HUMOR_RE.test(title);
  const reactionHumor = REACTION_HUMOR_RE.test(title) && (!/\b(?:vs\.?|versus)\b/.test(title) || hasMemeFlair || sourceWeight > 0);
  const lightHumor = LIGHT_HUMOR_RE.test(title);
  const camelCaseTitle = /[a-z][A-Z]/.test(post.title || "") && !/\s/.test(post.title || "");
  const isPromotional = PROMO_RE.test(title) || /\b(blog post|introducing|starting today|will get a .*ban)\b/i.test(title);
  const isPlainChatLog = CHAT_LOG_RE.test(title) && !reactionHumor && !strongHumor;
  const signals = [];
  const warnings = [];
  let qualityScore = 0;

  if (matchedTerms.length) {
    qualityScore += 10 + Math.min(6, (matchedTerms.length - 1) * 2);
    signals.push(`AI topic: ${matchedTerms.slice(0, 3).join(", ")}`);
  }
  if (hasImage) {
    qualityScore += 12;
    signals.push("image post");
  } else if (String(post.selftext ?? post.text ?? "").trim().length >= 40) {
    qualityScore += 5;
    signals.push("substantial text post");
  }
  if (sourceWeight) {
    qualityScore += sourceWeight;
    signals.push(`meme-focused source: r/${post.subreddit}`);
  }
  if (hasMemeFlair) {
    qualityScore += sourceWeight ? 12 : 26;
    signals.push(`meme flair: ${flair}`);
  }
  if (strongHumor) {
    qualityScore += 20;
    signals.push("strong meme phrasing");
  }
  if (reactionHumor) {
    qualityScore += 20;
    signals.push("reaction/punchline phrasing");
  }
  if (lightHumor) {
    qualityScore += 8;
    signals.push("humor wording");
  }
  if (camelCaseTitle) {
    qualityScore += 6;
    signals.push("meme-style caption title");
  }

  const upvotePoints = engagementPoints(post.score);
  const discussionPoints = commentPoints(post.numComments);
  qualityScore += upvotePoints + discussionPoints;
  if (upvotePoints) signals.push(`engagement +${upvotePoints}`);
  if (discussionPoints) signals.push(`discussion +${discussionPoints}`);
  if (Number.isFinite(post.upvoteRatio) && post.upvoteRatio >= 0.9) {
    qualityScore += 3;
    signals.push("high approval ratio");
  }

  if (EDITORIAL_RE.test(title)) {
    qualityScore -= (strongHumor || reactionHumor) ? 8 : 30;
    warnings.push("looks like news, benchmarks, or product information");
  }
  if (HELP_RE.test(title)) {
    qualityScore -= (strongHumor || reactionHumor) ? 4 : 24;
    warnings.push("looks like a question or support post");
  }
  if (isPromotional) {
    qualityScore -= 26;
    warnings.push("looks like self-promotion or a tutorial");
  }
  if (isPlainChatLog) {
    qualityScore -= 20;
    warnings.push("looks like a raw chatbot conversation rather than a reusable meme");
  }
  if (VAGUE_RE.test(title)) {
    qualityScore -= 18;
    warnings.push("title is too vague to establish a joke");
  }
  if (title.length > 130) {
    qualityScore -= 12;
    warnings.push("overlong explanatory title");
  }
  if (isGallery && imageCount > 1) {
    qualityScore -= 10;
    warnings.push("gallery posts are usually showcases, not single memes");
  }
  if (title.endsWith("?") && !reactionHumor && !strongHumor) {
    qualityScore -= 5;
    warnings.push("question-shaped title");
  }

  const hasIndependentHumor = Boolean(sourceWeight || strongHumor || reactionHumor || lightHumor || camelCaseTitle);
  const hasHumorEvidence = hasIndependentHumor || hasMemeFlair;
  if (!hasHumorEvidence) {
    qualityScore -= 20;
    warnings.push("no meme or punchline signal");
  }

  if (Number.isFinite(post.upvoteRatio) && post.upvoteRatio < 0.7) {
    qualityScore -= 18;
    warnings.push("low community approval");
  }
  // A new, untested image is not an S-tier keeper just because of its flair.
  if (!Number.isFinite(post.score) || post.score < 25) {
    qualityScore = Math.min(qualityScore, 65);
    warnings.push("not enough community votes yet");
  }
  qualityScore = Math.min(100, Math.max(0, Math.round(qualityScore)));
  const hasTrustedMemeSignal = hasIndependentHumor || (hasMemeFlair && qualityScore >= 66);
  if (hasMemeFlair && !hasIndependentHumor) {
    warnings.push("meme flair is the only humor signal");
  }
  const topicEligible = topicRelevant || (sourceWeight > 0 && hasImage);
  const minimumScore = MIN_QUALITY_SCORE;
  const isMeme = topicEligible
    && hasTrustedMemeSignal
    && qualityScore >= minimumScore
    && !isPromotional
    && !isPlainChatLog;
  const tier = tierForScore(qualityScore);

  return { qualityScore, tier, isMeme, topicRelevant, qualitySignals: signals, qualityWarnings: warnings };
}

export function applyAssetAssessment(meme, assessment) {
  if (!meme.imageUrl) return meme;
  const heuristicScore = meme.heuristicScore ?? meme.qualityScore ?? 0;
  const qualityScore = Math.min(100, Math.round(heuristicScore * 0.88 + assessment.assetQualityScore * 0.12));
  return {
    ...meme,
    heuristicScore,
    qualityScore,
    tier: tierForScore(qualityScore),
    isMeme: Boolean(meme.isMeme && assessment.usable),
    assetVerified: true,
    assetQualityScore: assessment.assetQualityScore,
    assetSignals: assessment.assetSignals,
    assetWarnings: assessment.assetWarnings,
    asset: assessment.asset,
    qualitySignals: [...new Set([...(meme.qualitySignals ?? []), ...assessment.assetSignals])],
    qualityWarnings: [...new Set([...(meme.qualityWarnings ?? []), ...assessment.assetWarnings])],
  };
}

export function compareMemes(a, b) {
  return Number(b.reviewStatus === "keep") - Number(a.reviewStatus === "keep")
    || (b.qualityScore ?? 0) - (a.qualityScore ?? 0)
    || (b.score ?? 0) - (a.score ?? 0)
    || String(b.created ?? "").localeCompare(String(a.created ?? ""));
}
