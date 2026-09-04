import { inferNiches } from "./taxonomy";
import { scoreTweet } from "./scoring";
import type { TrackerState, TrackedTweet } from "./types";

export function analyzeState(
  state: TrackerState,
  now = new Date(),
): TrackerState {
  const accounts = state.accounts.map((account) => {
    const authoredText = state.tweets
      .filter((tweet) => tweet.accountId === account.id)
      .map((tweet) => tweet.text)
      .join("\n");
    const niches = inferNiches(
      `${account.bio}\n${authoredText}`,
      account.manualNiches,
      3,
    );

    return {
      ...account,
      inferredNiches: niches
        .filter(
          (niche) =>
            !account.manualNiches.some(
              (manual) => manual.toLowerCase() === niche.name.toLowerCase(),
            ),
        )
        .map((niche) => niche.name),
      nicheConfidence: Object.fromEntries(
        niches.map((niche) => [niche.name, niche.confidence]),
      ),
    };
  });

  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const enrichedTweets: TrackedTweet[] = state.tweets.map((tweet) => {
    const account = accountsById.get(tweet.accountId);
    if (!account) return tweet;

    const inferred = inferNiches(tweet.text, account.manualNiches, 3).map(
      (niche) => niche.name,
    );
    const niches = inferred.length
      ? inferred
      : [...account.manualNiches, ...account.inferredNiches].slice(0, 3);

    return { ...tweet, niches };
  });

  const targetNiches = Array.from(
    new Set(
      accounts
        .filter((account) => account.active)
        .flatMap((account) => [
          ...account.manualNiches,
          ...account.inferredNiches,
        ]),
    ),
  );

  const tweets = enrichedTweets.map((tweet) => {
    const account = accountsById.get(tweet.accountId);
    if (!account) return tweet;
    const scoring = scoreTweet(
      tweet,
      account,
      enrichedTweets,
      targetNiches,
      now,
    );
    return { ...tweet, ...scoring };
  });

  return { ...state, accounts, tweets };
}
