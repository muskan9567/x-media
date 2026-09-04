import "server-only";

import { randomUUID } from "node:crypto";

import { ApiError } from "../api-response";

import { buildActivity } from "./activity";
import { analyzeState } from "./analyzer";
import { trackerConfig } from "./config";
import { getXProvider } from "./provider";
import {
  VIRAL_SCORE_THRESHOLD,
} from "./scoring";
import {
  dataFilePath,
  readTrackerState,
  updateTrackerState,
} from "./store";
import type {
  AddAccountInput,
  NicheSummary,
  ProviderAccount,
  ProviderMode,
  ProviderTweet,
  SyncFailure,
  SyncOutcome,
  SyncRunReport,
  TrackerDataMode,
  TrackerSnapshot,
  TrackerState,
  TrackedAccount,
  TrackedTweet,
  TweetMetrics,
  UpdateAccountInput,
  UpdateTweetInput,
} from "./types";

const DAY_MS = 24 * 60 * 60 * 1_000;

function normalizeUsername(username: string): string {
  const normalized = username.trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9_]{1,15}$/.test(normalized)) {
    throw new ApiError(
      "Enter a valid X username using 1–15 letters, numbers, or underscores.",
      422,
    );
  }
  return normalized;
}

function cleanNiches(niches: string[] | undefined): string[] {
  return Array.from(
    new Set(
      (niches ?? [])
        .map((niche) => niche.trim())
        .filter((niche) => niche.length >= 2 && niche.length <= 36),
    ),
  ).slice(0, 6);
}

function metricsEqual(a: TweetMetrics, b: TweetMetrics): boolean {
  return (
    a.likeCount === b.likeCount &&
    a.repostCount === b.repostCount &&
    a.replyCount === b.replyCount &&
    a.quoteCount === b.quoteCount &&
    a.bookmarkCount === b.bookmarkCount &&
    a.viewCount === b.viewCount
  );
}

function assertProviderSource(
  source: { source: ProviderMode },
  expected: ProviderMode,
): void {
  if (source.source !== expected) {
    throw new ApiError("The data provider returned mismatched provenance.", 502);
  }
}

function accountFromProvider(
  source: ProviderAccount,
  current: TrackedAccount | undefined,
  now: string,
  manualNiches: string[],
): TrackedAccount {
  return {
    ...source,
    source: current?.source ?? source.source,
    xUserId: current?.xUserId ?? source.xUserId,
    id: current?.id ?? `account-${source.xUserId}-${randomUUID()}`,
    active: current?.active ?? true,
    manualNiches,
    inferredNiches: current?.inferredNiches ?? [],
    nicheConfidence: current?.nicheConfidence ?? {},
    addedAt: current?.addedAt ?? now,
    lastSyncedAt: now,
    syncStatus: "ready",
    syncError: undefined,
  };
}

function tweetFromProvider(
  source: ProviderTweet,
  account: TrackedAccount,
  observedAt: string,
  current?: TrackedTweet,
): TrackedTweet {
  const nextSnapshot = { observedAt, metrics: source.metrics };
  const snapshots = current
    ? metricsEqual(current.metrics, source.metrics)
      ? current.snapshots
      : [...current.snapshots, nextSnapshot].slice(-24)
    : [nextSnapshot];

  return {
    ...source,
    source: current?.source ?? source.source,
    id: current?.id ?? source.id,
    createdAt: current?.createdAt ?? source.createdAt,
    conversationId: source.conversationId ?? current?.conversationId,
    possiblySensitive:
      source.possiblySensitive ?? current?.possiblySensitive ?? false,
    replySettings: source.replySettings ?? current?.replySettings,
    media: source.media ?? current?.media ?? [],
    accountId: account.id,
    authorUsername: account.username,
    authorDisplayName: account.displayName,
    authorProfileImageUrl: account.profileImageUrl,
    authorFollowersCount: account.followersCount,
    url: `https://x.com/${account.username}/status/${source.id}`,
    niches: current?.niches ?? [],
    snapshots,
    viralityScore: current?.viralityScore ?? 0,
    replyScore: current?.replyScore ?? 0,
    confidence: current?.confidence ?? 0,
    stage: current?.stage ?? "baseline",
    scoreReasons: current?.scoreReasons ?? [],
    replyReasons: current?.replyReasons ?? [],
    riskFlags: current?.riskFlags ?? [],
    workflowStatus: current?.workflowStatus ?? "new",
    firstSeenAt: current?.firstSeenAt ?? observedAt,
    lastSeenAt: observedAt,
  };
}

export function pruneExpiredTweets(
  state: TrackerState,
  now: Date,
  retentionDays = trackerConfig.retentionDays,
): TrackerState {
  const cutoff = now.getTime() - retentionDays * DAY_MS;
  const tweets = state.tweets.filter(
    (tweet) => new Date(tweet.createdAt).getTime() >= cutoff,
  );
  return tweets.length === state.tweets.length ? state : { ...state, tweets };
}

function buildNicheSummaries(state: TrackerState): NicheSummary[] {
  const map = new Map<
    string,
    { accountIds: Set<string>; tweets: TrackedTweet[] }
  >();

  for (const account of state.accounts.filter((candidate) => candidate.active)) {
    const names = [...account.manualNiches, ...account.inferredNiches];
    for (const name of names) {
      const entry = map.get(name) ?? { accountIds: new Set(), tweets: [] };
      entry.accountIds.add(account.id);
      map.set(name, entry);
    }
  }

  for (const tweet of state.tweets) {
    for (const name of tweet.niches) {
      const entry = map.get(name) ?? { accountIds: new Set(), tweets: [] };
      entry.accountIds.add(tweet.accountId);
      entry.tweets.push(tweet);
      map.set(name, entry);
    }
  }

  return Array.from(map.entries())
    .map(([name, entry]) => ({
      name,
      accounts: entry.accountIds.size,
      tweets: entry.tweets.length,
      viralTweets: entry.tweets.filter(
        (tweet) => tweet.viralityScore >= VIRAL_SCORE_THRESHOLD,
      ).length,
      averageVirality: entry.tweets.length
        ? Math.round(
            entry.tweets.reduce(
              (sum, tweet) => sum + tweet.viralityScore,
              0,
            ) / entry.tweets.length,
          )
        : 0,
    }))
    .sort(
      (a, b) =>
        b.viralTweets - a.viralTweets ||
        b.averageVirality - a.averageVirality ||
        a.name.localeCompare(b.name),
    );
}

function dataModeFor(state: TrackerState): TrackerDataMode {
  const sources = new Set<ProviderMode>([
    ...state.accounts.map((account) => account.source),
    ...state.tweets.map((tweet) => tweet.source),
  ]);
  if (sources.size === 0) return "empty";
  if (sources.size > 1) return "mixed";
  return sources.has("mock") ? "mock" : "x";
}

function toSnapshot(state: TrackerState, now: Date): TrackerSnapshot {
  const provider = getXProvider();
  const activeAccountIds = new Set(
    state.accounts.filter((account) => account.active).map((account) => account.id),
  );
  const visibleTweets = state.tweets
    .filter(
      (tweet) =>
        activeAccountIds.has(tweet.accountId) &&
        tweet.workflowStatus !== "dismissed",
    )
    .sort(
      (a, b) =>
        Math.max(b.viralityScore, b.replyScore) -
          Math.max(a.viralityScore, a.replyScore) ||
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  const activeAccounts = state.accounts.filter((account) => account.active);
  const dataMode = dataModeFor(state);

  return {
    providerMode: provider.mode,
    dataMode,
    containsDemoData: dataMode === "mock" || dataMode === "mixed",
    demoMode: provider.mode === "mock",
    summary: {
      trackedAccounts: activeAccounts.length,
      viralNow: visibleTweets.filter(
        (tweet) => tweet.viralityScore >= VIRAL_SCORE_THRESHOLD,
      ).length,
      replyReady: visibleTweets.filter(
        (tweet) =>
          tweet.replyScore >= 68 &&
          tweet.riskFlags.length === 0 &&
          tweet.workflowStatus !== "responded",
      ).length,
      totalAudience: activeAccounts.reduce(
        (sum, account) => sum + account.followersCount,
        0,
      ),
      averageVirality: visibleTweets.length
        ? Math.round(
            visibleTweets.reduce(
              (sum, tweet) => sum + tweet.viralityScore,
              0,
            ) / visibleTweets.length,
          )
        : 0,
      lastSyncedAt: state.lastSyncedAt,
    },
    niches: buildNicheSummaries({ ...state, tweets: visibleTweets }),
    activity: buildActivity(visibleTweets, now),
    accounts: [...state.accounts].sort((a, b) =>
      a.displayName.localeCompare(b.displayName),
    ),
    tweets: visibleTweets,
  };
}

export async function getTrackerSnapshot(): Promise<TrackerSnapshot> {
  const now = new Date();
  return updateTrackerState((state) => {
    const pruned = pruneExpiredTweets(state, now);
    const analyzed = analyzeState(pruned, now);
    return [pruned === state ? state : analyzed, toSnapshot(analyzed, now)];
  });
}

function assertWatchlistCapacity(state: TrackerState): void {
  if (state.accounts.length >= trackerConfig.maxTrackedAccounts) {
    throw new ApiError(
      `The watchlist limit is ${trackerConfig.maxTrackedAccounts} accounts.`,
      409,
    );
  }
}

function assertAccountAvailable(
  state: TrackerState,
  usernames: string[],
  xUserId?: string,
): void {
  const normalizedUsernames = new Set(
    usernames.map((username) => username.toLowerCase()),
  );
  const conflict = state.accounts.find(
    (account) =>
      normalizedUsernames.has(account.username.toLowerCase()) ||
      (xUserId !== undefined &&
        (account.xUserId === xUserId || account.id === `account-${xUserId}`)),
  );
  if (conflict) {
    throw new ApiError(
      `@${conflict.username} is already in the watchlist.`,
      409,
    );
  }
}

function validateProviderTweets(
  tweets: ProviderTweet[],
  providerMode: ProviderMode,
): void {
  const ids = new Set<string>();
  for (const tweet of tweets) {
    assertProviderSource(tweet, providerMode);
    if (ids.has(tweet.id)) {
      throw new ApiError(`The provider returned duplicate post ${tweet.id}.`, 502);
    }
    ids.add(tweet.id);
  }
}

export async function addTrackedAccount(
  input: AddAccountInput,
): Promise<TrackerSnapshot> {
  const username = normalizeUsername(input.username);
  const manualNiches = cleanNiches(input.niches);
  const provider = getXProvider();

  const initialState = await readTrackerState();
  assertWatchlistCapacity(initialState);
  assertAccountAvailable(initialState, [username]);

  const providerAccount = await provider.resolveAccount(username);
  assertProviderSource(providerAccount, provider.mode);
  const canonicalUsername = normalizeUsername(providerAccount.username);

  const resolvedState = await readTrackerState();
  assertWatchlistCapacity(resolvedState);
  assertAccountAvailable(
    resolvedState,
    [username, canonicalUsername],
    providerAccount.xUserId,
  );

  const providerTweets = await provider.fetchRecentTweets(providerAccount);
  validateProviderTweets(providerTweets, provider.mode);
  const now = new Date();
  const observedAt = now.toISOString();

  return updateTrackerState((state) => {
    assertWatchlistCapacity(state);
    assertAccountAvailable(
      state,
      [username, canonicalUsername],
      providerAccount.xUserId,
    );

    const account = accountFromProvider(
      { ...providerAccount, username: canonicalUsername },
      undefined,
      observedAt,
      manualNiches,
    );
    const tweets = providerTweets.map((tweet) =>
      tweetFromProvider(tweet, account, observedAt),
    );
    const next = analyzeState(
      pruneExpiredTweets(
        {
          ...state,
          accounts: [...state.accounts, account],
          tweets: [...state.tweets, ...tweets],
          lastSyncedAt: observedAt,
        },
        now,
      ),
      now,
    );
    return [next, toSnapshot(next, now)];
  });
}

export async function updateTrackedAccount(
  accountId: string,
  input: UpdateAccountInput,
): Promise<TrackerSnapshot> {
  const now = new Date();
  return updateTrackerState((state) => {
    const existing = state.accounts.find((account) => account.id === accountId);
    if (!existing) throw new ApiError("Tracked account not found.", 404);

    const accounts = state.accounts.map((account) =>
      account.id === accountId
        ? {
            ...account,
            active: input.active ?? account.active,
            manualNiches:
              input.manualNiches === undefined
                ? account.manualNiches
                : cleanNiches(input.manualNiches),
          }
        : account,
    );
    const next = analyzeState(
      pruneExpiredTweets({ ...state, accounts }, now),
      now,
    );
    return [next, toSnapshot(next, now)];
  });
}

export async function removeTrackedAccount(
  accountId: string,
): Promise<TrackerSnapshot> {
  const now = new Date();
  return updateTrackerState((state) => {
    if (!state.accounts.some((account) => account.id === accountId)) {
      throw new ApiError("Tracked account not found.", 404);
    }
    const next = pruneExpiredTweets(
      {
        ...state,
        accounts: state.accounts.filter((account) => account.id !== accountId),
        tweets: state.tweets.filter((tweet) => tweet.accountId !== accountId),
      },
      now,
    );
    return [next, toSnapshot(analyzeState(next, now), now)];
  });
}

export async function updateTweetWorkflow(
  tweetId: string,
  input: UpdateTweetInput,
): Promise<TrackerSnapshot> {
  const now = new Date();
  return updateTrackerState((state) => {
    if (!state.tweets.some((tweet) => tweet.id === tweetId)) {
      throw new ApiError("Tracked post not found.", 404);
    }
    const next = pruneExpiredTweets(
      {
        ...state,
        tweets: state.tweets.map((tweet) =>
          tweet.id === tweetId
            ? { ...tweet, workflowStatus: input.workflowStatus }
            : tweet,
        ),
      },
      now,
    );
    return [next, toSnapshot(analyzeState(next, now), now)];
  });
}

type SyncFetchResult =
  | {
      ok: true;
      accountId: string;
      accountGeneration: string;
      resolved: ProviderAccount;
      tweets: ProviderTweet[];
    }
  | {
      ok: false;
      accountId: string;
      accountGeneration: string;
      username: string;
      message: string;
    };

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  operation: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await operation(items[index]);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, items.length) },
      () => worker(),
    ),
  );
  return results;
}

function selectedAccounts(
  state: TrackerState,
  requestedAccountIds: string[] | undefined,
): TrackedAccount[] {
  if (requestedAccountIds === undefined) {
    return state.accounts.filter((account) => account.active);
  }
  if (requestedAccountIds.length === 0) {
    throw new ApiError("Select at least one account to sync.", 422);
  }

  const ids = requestedAccountIds.map((id) => id.trim());
  if (ids.some((id) => !id)) {
    throw new ApiError("Account IDs cannot be blank.", 422);
  }
  if (new Set(ids).size !== ids.length) {
    throw new ApiError("Account IDs must be unique.", 422);
  }

  const byId = new Map(state.accounts.map((account) => [account.id, account]));
  const missing = ids.find((id) => !byId.has(id));
  if (missing) throw new ApiError(`Tracked account ${missing} not found.`, 404);
  const inactive = ids.find((id) => !byId.get(id)?.active);
  if (inactive) {
    throw new ApiError(`Tracked account ${inactive} is paused.`, 409);
  }
  return ids.map((id) => byId.get(id) as TrackedAccount);
}

async function fetchAccount(
  current: TrackedAccount,
  provider: ReturnType<typeof getXProvider>,
): Promise<SyncFetchResult> {
  try {
    const resolved = await provider.refreshAccount(current);
    assertProviderSource(resolved, provider.mode);
    if (resolved.xUserId !== current.xUserId) {
      throw new Error(
        `Identity mismatch while refreshing @${current.username}.`,
      );
    }
    if (resolved.source !== current.source) {
      throw new Error(
        `Provider mismatch for @${current.username}; remove and re-add this account in the configured mode.`,
      );
    }
    const tweets = await provider.fetchRecentTweets(resolved);
    validateProviderTweets(tweets, provider.mode);
    return {
      ok: true,
      accountId: current.id,
      accountGeneration: current.addedAt,
      resolved,
      tweets,
    };
  } catch (error) {
    return {
      ok: false,
      accountId: current.id,
      accountGeneration: current.addedAt,
      username: current.username,
      message: error instanceof Error ? error.message : "Sync failed.",
    };
  }
}

function outcomeFor(
  attempted: number,
  succeeded: number,
  failed: number,
  skipped: number,
): SyncOutcome {
  if (attempted === 0 || (succeeded === 0 && failed === 0)) return "noop";
  if (succeeded === 0) return "failed";
  if (failed > 0 || skipped > 0) return "partial";
  return "success";
}

async function performSync(
  requestedAccountIds?: string[],
): Promise<SyncRunReport> {
  const provider = getXProvider();
  const preparedAt = new Date();
  const targets = await updateTrackerState((state) => {
    const pruned = pruneExpiredTweets(state, preparedAt);
    const next = pruned === state ? state : analyzeState(pruned, preparedAt);
    return [next, selectedAccounts(next, requestedAccountIds)];
  });

  if (targets.length === 0) {
    return {
      snapshot: await getTrackerSnapshot(),
      outcome: "noop",
      attempted: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      failures: [],
    };
  }

  const fetched = await mapWithConcurrency(
    targets,
    trackerConfig.syncConcurrency,
    (account) => fetchAccount(account, provider),
  );
  const completedAt = new Date();
  const observedAt = completedAt.toISOString();

  return updateTrackerState((initialState) => {
    let state = pruneExpiredTweets(initialState, completedAt);
    let succeeded = 0;
    let failed = 0;
    let skipped = 0;
    const failures: SyncFailure[] = [];

    for (const result of fetched) {
      const current = state.accounts.find(
        (account) => account.id === result.accountId,
      );
      if (!current || current.addedAt !== result.accountGeneration) {
        skipped += 1;
        continue;
      }

      if (!result.ok) {
        failed += 1;
        failures.push({
          accountId: result.accountId,
          username: result.username,
          message: result.message,
        });
        state = {
          ...state,
          accounts: state.accounts.map((account) =>
            account.id === current.id
              ? { ...account, syncStatus: "error", syncError: result.message }
              : account,
          ),
        };
        continue;
      }

      if (
        current.xUserId !== result.resolved.xUserId ||
        current.source !== result.resolved.source
      ) {
        const message = `Identity changed while @${current.username} was syncing.`;
        failed += 1;
        failures.push({
          accountId: current.id,
          username: current.username,
          message,
        });
        state = {
          ...state,
          accounts: state.accounts.map((account) =>
            account.id === current.id
              ? { ...account, syncStatus: "error", syncError: message }
              : account,
          ),
        };
        continue;
      }

      const account = accountFromProvider(
        result.resolved,
        current,
        observedAt,
        current.manualNiches,
      );
      const existingTweets = new Map(
        state.tweets
          .filter(
            (tweet) =>
              tweet.accountId === current.id && tweet.source === account.source,
          )
          .map((tweet) => [tweet.id, tweet]),
      );
      const fetchedTweets = result.tweets.map((tweet) =>
        tweetFromProvider(
          tweet,
          account,
          observedAt,
          existingTweets.get(tweet.id),
        ),
      );
      const fetchedIds = new Set(fetchedTweets.map((tweet) => tweet.id));
      const hasCrossAccountConflict = fetchedTweets.some((tweet) =>
        state.tweets.some(
          (existing) =>
            existing.id === tweet.id && existing.accountId !== current.id,
        ),
      );
      if (hasCrossAccountConflict) {
        const message = `X returned a post already owned by another tracked account for @${current.username}.`;
        failed += 1;
        failures.push({
          accountId: current.id,
          username: current.username,
          message,
        });
        state = {
          ...state,
          accounts: state.accounts.map((candidate) =>
            candidate.id === current.id
              ? { ...candidate, syncStatus: "error", syncError: message }
              : candidate,
          ),
        };
        continue;
      }

      const retainedTweets = state.tweets
        .filter(
          (tweet) =>
            tweet.accountId !== current.id ||
            (tweet.source === account.source && !fetchedIds.has(tweet.id)),
        )
        .map((tweet) =>
          tweet.accountId === current.id
            ? {
                ...tweet,
                authorUsername: account.username,
                authorDisplayName: account.displayName,
                authorProfileImageUrl: account.profileImageUrl,
                authorFollowersCount: account.followersCount,
                url: `https://x.com/${account.username}/status/${tweet.id}`,
              }
            : tweet,
        );
      state = {
        ...state,
        accounts: state.accounts.map((candidate) =>
          candidate.id === current.id ? account : candidate,
        ),
        tweets: [...retainedTweets, ...fetchedTweets],
      };
      succeeded += 1;
    }

    const next = analyzeState(
      pruneExpiredTweets(
        succeeded > 0 ? { ...state, lastSyncedAt: observedAt } : state,
        completedAt,
      ),
      completedAt,
    );
    return [
      next,
      {
        snapshot: toSnapshot(next, completedAt),
        outcome: outcomeFor(targets.length, succeeded, failed, skipped),
        attempted: targets.length,
        succeeded,
        failed,
        skipped,
        failures,
      },
    ];
  });
}

const syncQueuesKey = Symbol.for(
  "x-virality-tracker.tracker-service.sync-queues",
);
const sharedProcessState = globalThis as Record<PropertyKey, unknown>;
const existingSyncQueues = sharedProcessState[syncQueuesKey];
const syncQueues =
  existingSyncQueues instanceof Map
    ? (existingSyncQueues as Map<string, Promise<void>>)
    : new Map<string, Promise<void>>();
sharedProcessState[syncQueuesKey] = syncQueues;

export function syncTrackedAccounts(
  requestedAccountIds?: string[],
): Promise<SyncRunReport> {
  const previous = syncQueues.get(dataFilePath) ?? Promise.resolve();
  const operation = previous.then(() => performSync(requestedAccountIds));
  syncQueues.set(
    dataFilePath,
    operation.then(
      () => undefined,
      () => undefined,
    ),
  );
  return operation;
}
