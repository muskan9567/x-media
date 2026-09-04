"use client";

import {
  ActivityIcon,
  ArrowRightIcon,
  AtSignIcon,
  BotIcon,
  FlameIcon,
  GaugeIcon,
  InfoIcon,
  ImagesIcon,
  LoaderCircleIcon,
  MenuIcon,
  MessageSquareReplyIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  UsersRoundIcon,
  XIcon,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { ThemeToggle } from "@/components/theme-toggle";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  buildActivity,
  type ActivityRange,
} from "@/lib/tracker/activity";
import { VIRAL_SCORE_THRESHOLD } from "@/lib/tracker/scoring";
import type {
  SyncRunReport,
  TrackerSnapshot,
  TrackedAccount,
  TrackedTweet,
  TweetWorkflowStatus,
  ViralityStage,
} from "@/lib/tracker/types";
import { cn } from "@/lib/utils";

import { AccountTable } from "./account-table";
import { AddAccountDialog } from "./add-account-dialog";
import { compactNumber, relativeTime } from "./format";
import { PostDetailSheet } from "./post-detail-sheet";
import { PostRow } from "./post-row";
import {
  DashboardView,
  TrackerSidebar,
} from "./tracker-sidebar";

const ActivityChart = dynamic(
  () => import("./activity-chart").then((module) => module.ActivityChart),
  {
    ssr: false,
    loading: () => <Skeleton className="h-64 w-full rounded-lg" />,
  },
);

type StageFilter = "all" | ViralityStage;

const DATE_RANGE_COPY: Record<
  ActivityRange,
  { badge: string; description: string }
> = {
  "24h": { badge: "24-hour view", description: "the last 24 hours" },
  "7d": { badge: "7-day view", description: "the last 7 days" },
  "30d": { badge: "30-day view", description: "the last 30 days" },
  all: { badge: "All retained", description: "all retained posts" },
};

const VIEW_COPY: Record<DashboardView, { title: string; description: string }> = {
  overview: {
    title: "Signal overview",
    description: "See what is accelerating, why it matters, and where to join in.",
  },
  feed: {
    title: "Viral feed",
    description: "Account-normalized posts ranked by velocity and momentum.",
  },
  media: {
    title: "Media library",
    description: "Every photo, video, and GIF attached to the posts you have collected.",
  },
  replies: {
    title: "Reply queue",
    description: "Fresh, relevant conversations worth a thoughtful manual response.",
  },
  accounts: {
    title: "Account watchlist",
    description: "Manage monitored accounts, inferred niches, and sync status.",
  },
};

async function requestSnapshot(
  url: string,
  init?: RequestInit,
): Promise<TrackerSnapshot> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String(body.error)
        : "The request could not be completed.";
    throw new Error(message);
  }
  return body as TrackerSnapshot;
}

function cutoffFor(range: ActivityRange, reference: number): number | null {
  const hour = 60 * 60 * 1_000;
  if (range === "24h") return reference - 24 * hour;
  if (range === "all") return null;

  const cutoff = new Date(reference);
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (range === "7d" ? 6 : 29));
  return cutoff.getTime();
}

const VIEW_LIST_HEADING_ID: Record<DashboardView, string> = {
  overview: "top-opportunities-heading",
  feed: "ranked-posts-heading",
  media: "media-library-heading",
  replies: "reply-queue-heading",
  accounts: "tracked-accounts-heading",
};

function findTweetFocusTarget(tweetId: string): HTMLElement | null {
  const rows = document.querySelectorAll<HTMLElement>("[data-tweet-id]");
  for (const row of rows) {
    if (
      row.dataset.tweetId === tweetId &&
      row.getClientRects().length > 0
    ) {
      return row.querySelector<HTMLElement>("[data-post-focus]");
    }
  }
  return null;
}

interface TweetFocusFallback {
  tweetId: string;
  adjacentTweetIds: string[];
  headingIds: string[];
  preferOriginal: boolean;
}

function captureTweetFocusFallback(
  tweetId: string,
  defaultHeadingId: string,
): TweetFocusFallback {
  const rows = Array.from(
    document.querySelectorAll<HTMLElement>("[data-tweet-id]"),
  ).filter((row) => row.getClientRects().length > 0);
  const rowIndex = rows.findIndex((row) => row.dataset.tweetId === tweetId);
  const row = rowIndex >= 0 ? rows[rowIndex] : null;
  const sectionHeadingId = row
    ?.closest<HTMLElement>("section[aria-labelledby]")
    ?.getAttribute("aria-labelledby");
  const adjacentTweetIds = [rows[rowIndex + 1], rows[rowIndex - 1]]
    .map((candidate) => candidate?.dataset.tweetId)
    .filter((candidate): candidate is string => Boolean(candidate));

  return {
    tweetId,
    adjacentTweetIds,
    headingIds: Array.from(
      new Set([sectionHeadingId, defaultHeadingId].filter(Boolean) as string[]),
    ),
    preferOriginal: true,
  };
}

function focusFallbackAfterStatusChange(
  fallback: TweetFocusFallback,
  view: DashboardView,
  workflowStatus: TweetWorkflowStatus,
): TweetFocusFallback {
  const movesOrRemovesOpener =
    workflowStatus === "dismissed" ||
    view === "replies" ||
    (view === "overview" && workflowStatus === "responded");

  return movesOrRemovesOpener
    ? { ...fallback, preferOriginal: false }
    : fallback;
}

function resolveTweetFocusTarget(
  fallback: TweetFocusFallback,
): HTMLElement | null {
  const tweetIds = fallback.preferOriginal
    ? [fallback.tweetId, ...fallback.adjacentTweetIds]
    : fallback.adjacentTweetIds;

  for (const tweetId of tweetIds) {
    const focusTarget = findTweetFocusTarget(tweetId);
    if (focusTarget?.isConnected) return focusTarget;
  }

  for (const headingId of fallback.headingIds) {
    const heading = document.getElementById(headingId);
    if (heading?.isConnected && heading.getClientRects().length > 0) {
      return heading;
    }
  }

  return null;
}

function restoreTweetFocus(fallback: TweetFocusFallback) {
  const tryRestore = (retryAfterSheetExit: boolean) => {
    const currentFocus = document.activeElement;
    if (
      currentFocus instanceof HTMLElement &&
      currentFocus !== document.body &&
      currentFocus.isConnected
    ) {
      if (
        retryAfterSheetExit &&
        currentFocus.closest('[data-slot="sheet-content"]')
      ) {
        window.setTimeout(() => tryRestore(false), 250);
      }
      return;
    }

    resolveTweetFocusTarget(fallback)?.focus();
  };

  requestAnimationFrame(() => {
    requestAnimationFrame(() => tryRestore(true));
  });
}

function updateBusySet(
  current: ReadonlySet<string>,
  id: string,
  busy: boolean,
): ReadonlySet<string> {
  const next = new Set(current);
  if (busy) next.add(id);
  else next.delete(id);
  return next;
}

function latestSnapshotTimestamp(snapshot: TrackerSnapshot): number {
  const timestamps = [
    snapshot.summary.lastSyncedAt,
    ...snapshot.accounts.map((account) => account.lastSyncedAt),
    ...snapshot.tweets.map((tweet) => tweet.lastSeenAt),
  ]
    .map((value) => (value ? Date.parse(value) : Number.NaN))
    .filter(Number.isFinite);

  return timestamps.length > 0 ? Math.max(...timestamps) : 0;
}

function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed bg-muted/15 px-6 text-center">
      <div className="flex size-10 items-center justify-center rounded-xl border bg-background text-muted-foreground">
        <SearchIcon className="size-5" aria-hidden />
      </div>
      <h3 className="mt-4 font-medium">{title}</h3>
      <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">
        {description}
      </p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

function StatCard({
  label,
  value,
  note,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  note: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  accent: string;
}) {
  return (
    <Card className="gap-3 overflow-hidden py-4 shadow-xs">
      <CardContent className="px-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
          </div>
          <div className={cn("flex size-9 items-center justify-center rounded-xl border", accent)}>
            <Icon className="size-4" aria-hidden />
          </div>
        </div>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">{note}</p>
      </CardContent>
    </Card>
  );
}

export function TrackerDashboard({
  initialSnapshot,
  initialNow,
}: {
  initialSnapshot: TrackerSnapshot;
  initialNow: number;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [referenceTimestamp, setReferenceTimestamp] = useState(() =>
    Number.isFinite(initialNow) ? initialNow : 1_776_902_400_000,
  );
  const [view, setView] = useState<DashboardView>("overview");
  const [dateRange, setDateRange] = useState<ActivityRange>("7d");
  const [nicheFilter, setNicheFilter] = useState("all");
  const [stageFilter, setStageFilter] = useState<StageFilter>("all");
  const [search, setSearch] = useState("");
  const [isSyncing, setIsSyncing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [selectedTweetId, setSelectedTweetId] = useState<string | null>(null);
  const [busyTweetIds, setBusyTweetIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [busyAccountIds, setBusyAccountIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const syncInFlightRef = useRef(false);
  const snapshotRequestSequenceRef = useRef(0);
  const latestAppliedSnapshotSequenceRef = useRef(0);
  const activeMutationCountRef = useRef(0);
  const refreshInFlightRef = useRef(false);
  const refreshAbortRef = useRef<AbortController | null>(null);
  const detailFocusFallbackRef = useRef<TweetFocusFallback | null>(null);
  const selectedTweetIdRef = useRef<string | null>(null);

  const applyServerSnapshot = useCallback(
    (nextSnapshot: TrackerSnapshot, requestSequence: number) => {
      if (requestSequence <= latestAppliedSnapshotSequenceRef.current) {
        return false;
      }

      latestAppliedSnapshotSequenceRef.current = requestSequence;
      setSnapshot(nextSnapshot);
      setReferenceTimestamp((current) =>
        Math.max(current, Date.now(), latestSnapshotTimestamp(nextSnapshot)),
      );
      return true;
    },
    [],
  );

  const refreshSnapshot = useCallback(async () => {
    if (
      document.visibilityState === "hidden" ||
      refreshInFlightRef.current ||
      activeMutationCountRef.current > 0
    ) {
      return;
    }

    refreshInFlightRef.current = true;
    const controller = new AbortController();
    refreshAbortRef.current = controller;
    const requestSequence = ++snapshotRequestSequenceRef.current;

    try {
      const nextSnapshot = await requestSnapshot("/api/tracker", {
        cache: "no-store",
        signal: controller.signal,
      });
      applyServerSnapshot(nextSnapshot, requestSequence);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        console.error("Tracker snapshot refresh failed", error);
      }
    } finally {
      if (refreshAbortRef.current === controller) {
        refreshAbortRef.current = null;
        refreshInFlightRef.current = false;
      }
    }
  }, [applyServerSnapshot]);

  useEffect(() => {
    const handleFocus = () => void refreshSnapshot();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void refreshSnapshot();
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      refreshAbortRef.current?.abort();
    };
  }, [refreshSnapshot]);

  useEffect(() => {
    const desktopQuery = window.matchMedia("(min-width: 1024px)");
    const handleDesktopLayout = (event: MediaQueryListEvent) => {
      if (event.matches) setMobileNavOpen(false);
    };

    desktopQuery.addEventListener("change", handleDesktopLayout);
    return () => {
      desktopQuery.removeEventListener("change", handleDesktopLayout);
    };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setReferenceTimestamp(Date.now());
    }, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const referenceDate = new Date(referenceTimestamp);

  const cutoff = cutoffFor(dateRange, referenceTimestamp);
  const normalizedSearch = search.trim().toLowerCase();
  const filteredAccounts = snapshot.accounts.filter((account) => {
    const accountNiches = [
      ...account.manualNiches,
      ...account.inferredNiches,
    ];
    if (
      nicheFilter !== "all" &&
      !accountNiches.some(
        (niche) => niche.toLowerCase() === nicheFilter.toLowerCase(),
      )
    ) {
      return false;
    }
    if (
      normalizedSearch &&
      !`${account.displayName} ${account.username} ${account.bio} ${accountNiches.join(" ")}`
        .toLowerCase()
        .includes(normalizedSearch)
    ) {
      return false;
    }
    return true;
  });
  const filteredTweets = snapshot.tweets.filter((tweet) => {
    if (tweet.workflowStatus === "dismissed") return false;
    if (cutoff && new Date(tweet.createdAt).getTime() < cutoff) return false;
    if (
      nicheFilter !== "all" &&
      !tweet.niches.some(
        (niche) => niche.toLowerCase() === nicheFilter.toLowerCase(),
      )
    ) {
      return false;
    }
    if (stageFilter !== "all" && tweet.stage !== stageFilter) return false;
    if (
      normalizedSearch &&
      !`${tweet.text} ${tweet.authorDisplayName} ${tweet.authorUsername} ${tweet.niches.join(" ")}`
        .toLowerCase()
        .includes(normalizedSearch)
    ) {
      return false;
    }
    return true;
  });

  const viralTweets = filteredTweets.filter(
    (tweet) => tweet.viralityScore >= VIRAL_SCORE_THRESHOLD,
  );
  const mediaTweets = filteredTweets.filter(
    (tweet) => (tweet.media?.length ?? 0) > 0,
  );
  const mediaCount = mediaTweets.reduce(
    (total, tweet) => total + (tweet.media?.length ?? 0),
    0,
  );
  const replyTweets = filteredTweets
    .filter(
      (tweet) =>
        tweet.replyScore >= 68 &&
        tweet.riskFlags.length === 0 &&
        tweet.workflowStatus !== "responded",
    )
    .sort((a, b) => b.replyScore - a.replyScore);
  const savedTweets = filteredTweets
    .filter((tweet) => tweet.workflowStatus === "saved")
    .sort((a, b) => b.replyScore - a.replyScore);
  const readyTweets = replyTweets.filter(
    (tweet) => tweet.workflowStatus !== "saved",
  );
  const replyQueueCount = savedTweets.length + readyTweets.length;
  const activeAccounts = snapshot.accounts.filter((account) => account.active);
  const filteredAccountCount =
    nicheFilter === "all"
      ? activeAccounts.length
      : activeAccounts.filter((account) =>
          [...account.manualNiches, ...account.inferredNiches].some(
            (niche) => niche.toLowerCase() === nicheFilter.toLowerCase(),
          ),
        ).length;
  const averageVirality = filteredTweets.length
    ? Math.round(
        filteredTweets.reduce((sum, tweet) => sum + tweet.viralityScore, 0) /
          filteredTweets.length,
      )
    : 0;
  const filteredActivity = buildActivity(
    filteredTweets,
    referenceDate,
    dateRange,
  );
  const selectedTweet = selectedTweetId
    ? snapshot.tweets.find((tweet) => tweet.id === selectedTweetId) ?? null
    : null;
  const hasFilters =
    dateRange !== "7d" ||
    nicheFilter !== "all" ||
    stageFilter !== "all" ||
    Boolean(search.trim());
  const resultAnnouncement = useDeferredValue(
    view === "accounts"
      ? `${filteredAccounts.length} tracked ${filteredAccounts.length === 1 ? "account matches" : "accounts match"} the current filters.`
      : view === "media"
        ? `${mediaCount} ${mediaCount === 1 ? "media attachment matches" : "media attachments match"} the current filters.`
      : `${filteredTweets.length} ${filteredTweets.length === 1 ? "post matches" : "posts match"} the current filters.`,
  );

  function selectTweet(tweet: TrackedTweet) {
    detailFocusFallbackRef.current = captureTweetFocusFallback(
      tweet.id,
      VIEW_LIST_HEADING_ID[view],
    );
    selectedTweetIdRef.current = tweet.id;
    setSelectedTweetId(tweet.id);
  }

  function closeTweetDetail() {
    selectedTweetIdRef.current = null;
    setSelectedTweetId(null);
  }

  function changeView(nextView: DashboardView) {
    setView(nextView);
    setMobileNavOpen(false);
  }

  function clearFilters() {
    setDateRange("7d");
    setNicheFilter("all");
    setStageFilter("all");
    setSearch("");
  }

  function beginSnapshotMutation(): number {
    activeMutationCountRef.current += 1;

    const refreshController = refreshAbortRef.current;
    if (refreshController) {
      refreshAbortRef.current = null;
      refreshInFlightRef.current = false;
      refreshController.abort();
    }

    return ++snapshotRequestSequenceRef.current;
  }

  function finishSnapshotMutation() {
    activeMutationCountRef.current = Math.max(
      0,
      activeMutationCountRef.current - 1,
    );
    if (activeMutationCountRef.current === 0) {
      void refreshSnapshot();
    }
  }

  function markTweetBusy(tweetId: string, busy: boolean) {
    setBusyTweetIds((current) => updateBusySet(current, tweetId, busy));
  }

  function markAccountBusy(accountId: string, busy: boolean) {
    setBusyAccountIds((current) => updateBusySet(current, accountId, busy));
  }

  async function syncNow() {
    if (syncInFlightRef.current) return;
    syncInFlightRef.current = true;
    const requestSequence = beginSnapshotMutation();
    setIsSyncing(true);
    try {
      const response = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body: unknown = await response.json().catch(() => ({}));
      const report = body as Partial<SyncRunReport> & { error?: unknown };
      if (report.snapshot) {
        applyServerSnapshot(report.snapshot, requestSequence);
      }
      if (!response.ok) {
        throw new Error(
          typeof report.error === "string"
            ? report.error
            : "The watchlist could not be synced.",
        );
      }
      if (!report.snapshot || !report.outcome) {
        throw new Error("The sync response was incomplete.");
      }

      if (report.outcome === "partial") {
        toast.warning(
          `${report.succeeded ?? 0} synced; ${report.failed ?? 0} failed.`,
        );
      } else if (report.outcome === "noop") {
        toast.info("No active accounts needed syncing.");
      } else {
        toast.success(
          `${report.succeeded ?? 0} account${report.succeeded === 1 ? "" : "s"} synced and rescored.`,
        );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Sync failed.");
    } finally {
      finishSnapshotMutation();
      syncInFlightRef.current = false;
      setIsSyncing(false);
    }
  }

  async function addAccount(username: string, niches: string[]) {
    const requestSequence = beginSnapshotMutation();
    try {
      const next = await requestSnapshot("/api/accounts", {
        method: "POST",
        body: JSON.stringify({ username, niches }),
      });
      applyServerSnapshot(next, requestSequence);
      toast.success(`@${username.replace(/^@/, "")} added to the watchlist.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Account could not be added.");
      throw error;
    } finally {
      finishSnapshotMutation();
    }
  }

  async function updateTweetStatus(
    tweet: TrackedTweet,
    workflowStatus: TweetWorkflowStatus,
  ) {
    const focusFallback = focusFallbackAfterStatusChange(
      captureTweetFocusFallback(
        tweet.id,
        VIEW_LIST_HEADING_ID[view],
      ),
      view,
      workflowStatus,
    );
    const activeElement = document.activeElement;
    const focusedRow =
      activeElement instanceof HTMLElement
        ? activeElement.closest<HTMLElement>("[data-tweet-id]")
        : null;
    const shouldRestoreFocus = focusedRow?.dataset.tweetId === tweet.id;
    if (selectedTweetIdRef.current === tweet.id) {
      detailFocusFallbackRef.current = focusFallback;
    }

    const requestSequence = beginSnapshotMutation();
    markTweetBusy(tweet.id, true);
    try {
      const next = await requestSnapshot(`/api/tweets/${encodeURIComponent(tweet.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ workflowStatus }),
      });
      applyServerSnapshot(next, requestSequence);
      if (
        workflowStatus === "dismissed" &&
        selectedTweetIdRef.current === tweet.id
      ) {
        closeTweetDetail();
      }
      if (shouldRestoreFocus) restoreTweetFocus(focusFallback);
      const messages: Record<TweetWorkflowStatus, string> = {
        new: "Post returned to the active queue.",
        saved: "Opportunity saved.",
        responded: "Post marked as responded.",
        dismissed: "Post dismissed.",
      };
      toast.success(messages[workflowStatus]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Post could not be updated.");
    } finally {
      markTweetBusy(tweet.id, false);
      finishSnapshotMutation();
    }
  }

  async function toggleAccount(account: TrackedAccount, active: boolean) {
    const requestSequence = beginSnapshotMutation();
    markAccountBusy(account.id, true);
    try {
      const next = await requestSnapshot(
        `/api/accounts/${encodeURIComponent(account.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ active }),
        },
      );
      applyServerSnapshot(next, requestSequence);
      toast.success(`Tracking ${active ? "resumed" : "paused"} for @${account.username}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Account could not be updated.");
    } finally {
      markAccountBusy(account.id, false);
      finishSnapshotMutation();
    }
  }

  async function deleteAccount(account: TrackedAccount) {
    const requestSequence = beginSnapshotMutation();
    markAccountBusy(account.id, true);
    try {
      const next = await requestSnapshot(
        `/api/accounts/${encodeURIComponent(account.id)}`,
        { method: "DELETE" },
      );
      applyServerSnapshot(next, requestSequence);
      toast.success(`@${account.username} and its local snapshots were removed.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Account could not be removed.");
      throw error;
    } finally {
      markAccountBusy(account.id, false);
      finishSnapshotMutation();
    }
  }

  async function updateNiches(account: TrackedAccount, manualNiches: string[]) {
    const requestSequence = beginSnapshotMutation();
    markAccountBusy(account.id, true);
    try {
      const next = await requestSnapshot(
        `/api/accounts/${encodeURIComponent(account.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ manualNiches }),
        },
      );
      applyServerSnapshot(next, requestSequence);
      toast.success(`Priority niches updated for @${account.username}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Niches could not be updated.");
      throw error;
    } finally {
      markAccountBusy(account.id, false);
      finishSnapshotMutation();
    }
  }

  const sidebar = (
    <TrackerSidebar
      view={view}
      demoMode={snapshot.demoMode}
      viralCount={viralTweets.length}
      mediaCount={mediaCount}
      replyCount={replyQueueCount}
      accountCount={activeAccounts.length}
      niches={snapshot.niches}
      selectedNiche={nicheFilter}
      onView={changeView}
      onNicheSelect={(niche) => {
        setNicheFilter(niche);
        changeView("feed");
      }}
      onAddAccount={() => {
        setMobileNavOpen(false);
        setAddOpen(true);
      }}
    />
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r lg:block">
        {sidebar}
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b bg-background/88 backdrop-blur-xl">
          <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="lg:hidden"
              aria-label="Open navigation"
              onClick={() => setMobileNavOpen(true)}
            >
              <MenuIcon aria-hidden />
            </Button>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-base font-semibold sm:text-lg">
                {VIEW_COPY[view].title}
              </h1>
              <p className="hidden truncate text-xs text-muted-foreground sm:block">
                {VIEW_COPY[view].description}
              </p>
            </div>
            <div className="hidden items-center gap-2 text-xs text-muted-foreground md:flex">
              <span
                aria-hidden
                className={cn(
                  "size-2 rounded-full",
                  snapshot.providerMode === "mock"
                    ? "bg-amber-500"
                    : "bg-blue-500",
                )}
              />
              {snapshot.providerMode === "mock" ? "Demo provider" : "X API configured"}
            </div>
            <ThemeToggle />
            <Button
              type="button"
              variant="outline"
              aria-label={isSyncing ? "Syncing" : "Sync now"}
              aria-busy={isSyncing}
              onClick={() => void syncNow()}
              disabled={isSyncing}
            >
              {isSyncing ? (
                <LoaderCircleIcon
                  data-icon="inline-start"
                  className="animate-spin motion-reduce:animate-none"
                  aria-hidden
                />
              ) : (
                <RefreshCwIcon data-icon="inline-start" aria-hidden />
              )}
              <span className="hidden sm:inline">{isSyncing ? "Syncing" : "Sync now"}</span>
            </Button>
            <Button type="button" onClick={() => setAddOpen(true)} className="hidden sm:inline-flex">
              <PlusIcon data-icon="inline-start" aria-hidden />
              Track account
            </Button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {snapshot.demoMode && (
            <Alert className="mb-6 border-blue-500/20 bg-blue-500/5">
              <BotIcon aria-hidden />
              <AlertTitle>Explore with realistic demo signals</AlertTitle>
              <AlertDescription>
                Every interaction works locally. Add <code>X_BEARER_TOKEN</code> to
                switch this dashboard to official X API data. Replies stay manual.
              </AlertDescription>
            </Alert>
          )}
          {!snapshot.demoMode && snapshot.containsDemoData && (
            <Alert className="mb-6 border-amber-500/25 bg-amber-500/5">
              <InfoIcon aria-hidden />
              <AlertTitle>Demo records remain in this watchlist</AlertTitle>
              <AlertDescription>
                The X API is configured, but these records keep their demo label and
                cannot open reply shortcuts. Remove and re-add an account to track its
                live X identity.
              </AlertDescription>
            </Alert>
          )}

          <section aria-label="Dashboard filters" className="mb-6 flex flex-col gap-3 rounded-xl border bg-card/70 p-3 shadow-xs sm:flex-row sm:items-center">
            <span className="sr-only">Filter all dashboard results</span>
            <Select value={dateRange} onValueChange={(value) => setDateRange(value as ActivityRange)}>
              <SelectTrigger aria-label="Date range" className="w-full sm:w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start">
                <SelectItem value="24h">Last 24 hours</SelectItem>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="all">All retained</SelectItem>
              </SelectContent>
            </Select>

            <Select value={nicheFilter} onValueChange={(value) => setNicheFilter(value ?? "all")}>
              <SelectTrigger aria-label="Niche" className="w-full sm:w-48">
                <SelectValue placeholder="All niches" />
              </SelectTrigger>
              <SelectContent align="start">
                <SelectItem value="all">All niches</SelectItem>
                {snapshot.niches.map((niche) => (
                  <SelectItem key={niche.name} value={niche.name}>
                    {niche.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={stageFilter} onValueChange={(value) => setStageFilter(value as StageFilter)}>
              <SelectTrigger aria-label="Virality stage" className="w-full sm:w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start">
                <SelectItem value="all">All stages</SelectItem>
                <SelectItem value="viral">Viral</SelectItem>
                <SelectItem value="rising">Rising</SelectItem>
                <SelectItem value="emerging">Emerging</SelectItem>
                <SelectItem value="baseline">Baseline</SelectItem>
                <SelectItem value="cooling">Cooling</SelectItem>
              </SelectContent>
            </Select>

            <div className="relative min-w-0 flex-1">
              <SearchIcon
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search posts, people, or niches"
                aria-label="Search dashboard"
                className="pl-8"
              />
            </div>
            {hasFilters && (
              <Button type="button" variant="ghost" onClick={clearFilters}>
                <XIcon data-icon="inline-start" aria-hidden />
                Clear
              </Button>
            )}
            <output className="sr-only" aria-live="polite" aria-atomic="true">
              {resultAnnouncement}
            </output>
          </section>

          <section aria-label="Signal summary" className={cn("grid gap-3 sm:grid-cols-2 xl:grid-cols-4", isSyncing && "opacity-60")} aria-busy={isSyncing}>
            <StatCard
              label="Viral now"
              value={String(viralTweets.length)}
              note={`${averageVirality}/100 average virality in this slice`}
              icon={FlameIcon}
              accent="border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            />
            <StatCard
              label="Reply opportunities"
              value={String(replyTweets.length)}
              note="Relevant, fresh, and clear of risk flags"
              icon={MessageSquareReplyIcon}
              accent="border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-300"
            />
            <StatCard
              label="Selected audience"
              value={compactNumber(
                activeAccounts
                  .filter(
                    (account) =>
                      nicheFilter === "all" ||
                      [...account.manualNiches, ...account.inferredNiches].some(
                        (niche) => niche.toLowerCase() === nicheFilter.toLowerCase(),
                      ),
                  )
                  .reduce((sum, account) => sum + account.followersCount, 0),
              )}
              note={`Across ${filteredAccountCount} active account${filteredAccountCount === 1 ? "" : "s"}`}
              icon={UsersRoundIcon}
              accent="border-violet-500/20 bg-violet-500/10 text-violet-700 dark:text-violet-300"
            />
            <StatCard
              label="Posts analyzed"
              value={String(filteredTweets.length)}
              note={snapshot.summary.lastSyncedAt ? `Updated ${relativeTime(snapshot.summary.lastSyncedAt, referenceTimestamp)}` : "Waiting for first sync"}
              icon={GaugeIcon}
              accent="border-orange-500/20 bg-orange-500/10 text-orange-700 dark:text-orange-300"
            />
          </section>

          <Tabs
            value={view}
            onValueChange={(value) => setView(value as DashboardView)}
            className="mt-7"
          >
            <TabsList variant="line" className="w-full justify-start overflow-x-auto border-b pb-0">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="feed">Viral feed</TabsTrigger>
              <TabsTrigger value="media">
                Media
                <Badge variant="secondary" className="ml-1 px-1.5 tabular-nums">
                  {mediaCount}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="replies">
                Reply queue
                <Badge variant="secondary" className="ml-1 px-1.5 tabular-nums">
                  {replyQueueCount}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="accounts">Watchlist</TabsTrigger>
            </TabsList>

            <div className={cn("mt-5 transition-opacity", isSyncing && "opacity-55")}>
              <TabsContent value="overview" className="space-y-6">
                <div className="grid gap-4 xl:grid-cols-12">
                  <Card className="xl:col-span-8">
                    <CardHeader className="flex-row items-start justify-between gap-4">
                      <div>
                        <CardTitle>Engagement captured</CardTitle>
                        <CardDescription>
                          Weighted public engagement from posts in the current filter.
                        </CardDescription>
                      </div>
                      <Badge variant="outline">
                        {DATE_RANGE_COPY[dateRange].badge}
                      </Badge>
                    </CardHeader>
                    <CardContent>
                      <ActivityChart
                        data={filteredActivity}
                        rangeLabel={DATE_RANGE_COPY[dateRange].description}
                      />
                    </CardContent>
                  </Card>

                  <Card className="xl:col-span-4">
                    <CardHeader>
                      <CardTitle>Niche momentum</CardTitle>
                      <CardDescription>
                        Average post virality, ordered by active signal.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {snapshot.niches.slice(0, 6).map((niche) => (
                        <div key={niche.name}>
                          <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
                            <span className="truncate font-medium">{niche.name}</span>
                            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                              {niche.averageVirality}/100 · {niche.viralTweets} viral
                            </span>
                          </div>
                          <div
                            className="h-1.5 overflow-hidden rounded-full bg-blue-100 dark:bg-blue-950/60"
                            role="meter"
                            aria-label={`${niche.name} average virality`}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={niche.averageVirality}
                          >
                            <div
                              className="h-full rounded-full bg-blue-600 transition-[width] motion-reduce:transition-none dark:bg-blue-400"
                              style={{ width: `${niche.averageVirality}%` }}
                            />
                          </div>
                        </div>
                      ))}
                      {snapshot.niches.length === 0 && (
                        <p className="text-sm text-muted-foreground">
                          Add an account to begin inferring niches.
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </div>

                <section aria-labelledby="top-opportunities-heading">
                  <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <h2
                        id="top-opportunities-heading"
                        tabIndex={-1}
                        className="text-base font-semibold"
                      >
                        Top reply opportunities
                      </h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        High-fit conversations where timing still leaves room to be seen.
                      </p>
                    </div>
                    <Button type="button" variant="ghost" onClick={() => setView("replies")}>
                      View full queue
                      <ArrowRightIcon data-icon="inline-end" aria-hidden />
                    </Button>
                  </div>
                  {replyTweets.length ? (
                    <div className="grid gap-3 xl:grid-cols-2">
                      {replyTweets.slice(0, 4).map((tweet) => (
                        <PostRow
                          key={tweet.id}
                          tweet={tweet}
                          referenceTimestamp={referenceTimestamp}
                          compact
                          busy={busyTweetIds.has(tweet.id)}
                          onSelect={selectTweet}
                          onStatus={(item, status) => void updateTweetStatus(item, status)}
                        />
                      ))}
                    </div>
                  ) : (
                    <EmptyState
                      title="No reply opportunities in this slice"
                      description="Broaden the date, niche, or stage filters—or sync the watchlist for fresh signals."
                      action={hasFilters ? <Button onClick={clearFilters}>Clear filters</Button> : undefined}
                    />
                  )}
                </section>
              </TabsContent>

              <TabsContent value="feed">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2
                      id="ranked-posts-heading"
                      tabIndex={-1}
                      className="text-base font-semibold"
                    >
                      Ranked posts
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {filteredTweets.length} retained post{filteredTweets.length === 1 ? "" : "s"}, ordered by strongest current signal.
                    </p>
                  </div>
                  <Badge variant="outline">
                    <ActivityIcon data-icon="inline-start" aria-hidden />
                    Account-normalized
                  </Badge>
                </div>
                {filteredTweets.length ? (
                  <div className="space-y-3">
                    {filteredTweets.map((tweet) => (
                      <PostRow
                        key={tweet.id}
                        tweet={tweet}
                        referenceTimestamp={referenceTimestamp}
                        busy={busyTweetIds.has(tweet.id)}
                        onSelect={selectTweet}
                        onStatus={(item, status) => void updateTweetStatus(item, status)}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    title="No posts match these filters"
                    description="Clear one or more filters, or track another account to expand the signal pool."
                    action={
                      <div className="flex gap-2">
                        <Button variant="outline" onClick={clearFilters}>Clear filters</Button>
                        <Button onClick={() => setAddOpen(true)}>
                          <PlusIcon data-icon="inline-start" aria-hidden />
                          Track account
                        </Button>
                      </div>
                    }
                  />
                )}
              </TabsContent>

              <TabsContent value="media">
                <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h2
                      id="media-library-heading"
                      tabIndex={-1}
                      className="text-base font-semibold"
                    >
                      Collected media
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {mediaCount} attachment{mediaCount === 1 ? "" : "s"} across {mediaTweets.length} post{mediaTweets.length === 1 ? "" : "s"}. Nothing is collapsed or hidden.
                    </p>
                  </div>
                  <Badge variant="outline">
                    <ImagesIcon data-icon="inline-start" aria-hidden />
                    Photos, video, and GIFs
                  </Badge>
                </div>
                {mediaTweets.length ? (
                  <div className="space-y-4">
                    {mediaTweets.map((tweet) => (
                      <PostRow
                        key={tweet.id}
                        tweet={tweet}
                        referenceTimestamp={referenceTimestamp}
                        busy={busyTweetIds.has(tweet.id)}
                        onSelect={selectTweet}
                        onStatus={(item, status) => void updateTweetStatus(item, status)}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    title="No media in this slice"
                    description="Sync the watchlist or broaden your filters. X Media will keep every image, video, and GIF returned with collected posts."
                    action={hasFilters ? <Button onClick={clearFilters}>Clear filters</Button> : undefined}
                  />
                )}
              </TabsContent>

              <TabsContent value="replies">
                <div className="mb-4 rounded-xl border border-blue-500/20 bg-blue-500/5 p-4">
                  <div className="flex gap-3">
                    <InfoIcon className="mt-0.5 size-4 shrink-0 text-blue-600" aria-hidden />
                    <div>
                      <h2
                        id="reply-queue-heading"
                        tabIndex={-1}
                        className="font-medium"
                      >
                        A decision queue, not an auto-reply bot
                      </h2>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        Scores combine virality, niche fit, freshness, and conversation openness. Review context, write the response yourself, then open X.
                      </p>
                    </div>
                  </div>
                </div>
                {replyQueueCount ? (
                  <div className="space-y-8">
                    {savedTweets.length > 0 && (
                      <section aria-labelledby="saved-opportunities-heading">
                        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                          <div>
                            <h2
                              id="saved-opportunities-heading"
                              tabIndex={-1}
                              className="text-base font-semibold"
                            >
                              Saved for review
                            </h2>
                            <p className="mt-1 text-sm text-muted-foreground">
                              Opportunities you bookmarked, including posts outside
                              the automatic reply threshold.
                            </p>
                          </div>
                          <Badge variant="secondary" className="tabular-nums">
                            {savedTweets.length} saved
                          </Badge>
                        </div>
                        <div className="space-y-3">
                          {savedTweets.map((tweet) => (
                            <PostRow
                              key={tweet.id}
                              tweet={tweet}
                              referenceTimestamp={referenceTimestamp}
                              busy={busyTweetIds.has(tweet.id)}
                              onSelect={selectTweet}
                              onStatus={(item, status) =>
                                void updateTweetStatus(item, status)
                              }
                            />
                          ))}
                        </div>
                      </section>
                    )}

                    {readyTweets.length > 0 && (
                      <section aria-labelledby="ready-opportunities-heading">
                        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                          <div>
                            <h2
                              id="ready-opportunities-heading"
                              tabIndex={-1}
                              className="text-base font-semibold"
                            >
                              Ready now
                            </h2>
                            <p className="mt-1 text-sm text-muted-foreground">
                              Fresh opportunities currently clearing the relevance,
                              timing, and safety threshold.
                            </p>
                          </div>
                          <Badge variant="outline" className="tabular-nums">
                            {readyTweets.length} ready
                          </Badge>
                        </div>
                        <div className="space-y-3">
                          {readyTweets.map((tweet) => (
                            <PostRow
                              key={tweet.id}
                              tweet={tweet}
                              referenceTimestamp={referenceTimestamp}
                              busy={busyTweetIds.has(tweet.id)}
                              onSelect={selectTweet}
                              onStatus={(item, status) =>
                                void updateTweetStatus(item, status)
                              }
                            />
                          ))}
                        </div>
                      </section>
                    )}
                  </div>
                ) : (
                  <EmptyState
                    title="Reply queue is clear"
                    description="Nothing is saved or currently clears the relevance, freshness, and safety threshold in this filter."
                    action={
                      <Button
                        onClick={() => void syncNow()}
                        disabled={isSyncing}
                        aria-busy={isSyncing}
                      >
                        {isSyncing && (
                          <LoaderCircleIcon
                            data-icon="inline-start"
                            className="animate-spin motion-reduce:animate-none"
                            aria-hidden
                          />
                        )}
                        {isSyncing ? "Syncing" : "Sync for new signals"}
                      </Button>
                    }
                  />
                )}
              </TabsContent>

              <TabsContent value="accounts">
                <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h2
                      id="tracked-accounts-heading"
                      tabIndex={-1}
                      className="text-base font-semibold"
                    >
                      Tracked accounts
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Pause tracking, set priority niches, or remove locally stored account data.
                    </p>
                  </div>
                  <Button type="button" onClick={() => setAddOpen(true)}>
                    <PlusIcon data-icon="inline-start" aria-hidden />
                    Track account
                  </Button>
                </div>
                {snapshot.accounts.length ? (
                  filteredAccounts.length ? (
                    <AccountTable
                      accounts={filteredAccounts}
                      referenceTimestamp={referenceTimestamp}
                      busyAccountIds={busyAccountIds}
                      onToggle={toggleAccount}
                      onDelete={deleteAccount}
                      onUpdateNiches={updateNiches}
                    />
                  ) : (
                    <EmptyState
                      title="No accounts match these filters"
                      description="Clear the niche or search filter to see the rest of your watchlist."
                      action={<Button onClick={clearFilters}>Clear filters</Button>}
                    />
                  )
                ) : (
                  <EmptyState
                    title="Your watchlist is empty"
                    description="Add a public X account to infer its niche and establish an engagement baseline."
                    action={<Button onClick={() => setAddOpen(true)}><AtSignIcon data-icon="inline-start" aria-hidden />Track your first account</Button>}
                  />
                )}
              </TabsContent>
            </div>
          </Tabs>
        </main>
      </div>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="w-72 gap-0 p-0 sm:max-w-72">
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation</SheetTitle>
            <SheetDescription>Move between tracker views.</SheetDescription>
          </SheetHeader>
          {sidebar}
        </SheetContent>
      </Sheet>

      <AddAccountDialog
        open={addOpen}
        demoMode={snapshot.demoMode}
        trackedUsernames={snapshot.accounts.map((account) => account.username)}
        onOpenChange={setAddOpen}
        onAdd={addAccount}
      />

      <PostDetailSheet
        tweet={selectedTweet}
        open={Boolean(selectedTweet)}
        busy={Boolean(selectedTweet && busyTweetIds.has(selectedTweet.id))}
        finalFocus={() => {
          const fallback = detailFocusFallbackRef.current;
          return fallback ? resolveTweetFocusTarget(fallback) : null;
        }}
        onOpenChange={(open) => !open && closeTweetDetail()}
        onStatus={(tweet, status) => void updateTweetStatus(tweet, status)}
      />
    </div>
  );
}
