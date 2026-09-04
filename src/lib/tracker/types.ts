export type ProviderMode = "mock" | "x";
export type TrackerDataMode = "empty" | "mock" | "x" | "mixed";
export type ReplySettings = "everyone" | "mentionedUsers" | "following";

export type TweetWorkflowStatus = "new" | "saved" | "responded" | "dismissed";

export type ViralityStage =
  | "baseline"
  | "emerging"
  | "rising"
  | "viral"
  | "cooling";

export interface TweetMetrics {
  likeCount: number;
  repostCount: number;
  replyCount: number;
  quoteCount: number;
  bookmarkCount: number;
  viewCount?: number;
}

export interface MetricSnapshot {
  observedAt: string;
  metrics: TweetMetrics;
}

export type PostMediaType = "photo" | "video" | "animated_gif";

export interface PostMediaVariant {
  url: string;
  contentType?: string;
  bitRate?: number;
}

export interface PostMedia {
  mediaKey: string;
  type: PostMediaType;
  url?: string;
  previewImageUrl?: string;
  altText?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  variants: PostMediaVariant[];
}

export interface ProviderAccount {
  source: ProviderMode;
  xUserId: string;
  username: string;
  displayName: string;
  bio: string;
  profileImageUrl?: string;
  followersCount: number;
  followingCount: number;
  tweetCount: number;
  verified: boolean;
}

export interface ProviderTweet {
  source: ProviderMode;
  id: string;
  text: string;
  createdAt: string;
  language?: string;
  conversationId?: string;
  possiblySensitive?: boolean;
  replySettings?: ReplySettings;
  media?: PostMedia[];
  metrics: TweetMetrics;
}

export interface TrackedAccount extends ProviderAccount {
  id: string;
  active: boolean;
  manualNiches: string[];
  inferredNiches: string[];
  nicheConfidence: Record<string, number>;
  addedAt: string;
  lastSyncedAt?: string;
  syncStatus: "ready" | "syncing" | "error";
  syncError?: string;
}

export interface TrackedTweet extends ProviderTweet {
  accountId: string;
  authorUsername: string;
  authorDisplayName: string;
  authorProfileImageUrl?: string;
  authorFollowersCount: number;
  url: string;
  niches: string[];
  snapshots: MetricSnapshot[];
  viralityScore: number;
  replyScore: number;
  confidence: number;
  stage: ViralityStage;
  scoreReasons: string[];
  replyReasons: string[];
  riskFlags: string[];
  workflowStatus: TweetWorkflowStatus;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface TrackerState {
  version: 2;
  accounts: TrackedAccount[];
  tweets: TrackedTweet[];
  createdAt: string;
  lastSyncedAt?: string;
}

export interface NicheSummary {
  name: string;
  accounts: number;
  tweets: number;
  viralTweets: number;
  averageVirality: number;
}

export interface ActivityPoint {
  date: string;
  label: string;
  engagement: number;
  opportunities: number;
}

export interface DashboardSummary {
  trackedAccounts: number;
  viralNow: number;
  replyReady: number;
  totalAudience: number;
  averageVirality: number;
  lastSyncedAt?: string;
}

export interface TrackerSnapshot {
  providerMode: ProviderMode;
  dataMode: TrackerDataMode;
  containsDemoData: boolean;
  demoMode: boolean;
  summary: DashboardSummary;
  niches: NicheSummary[];
  activity: ActivityPoint[];
  accounts: TrackedAccount[];
  tweets: TrackedTweet[];
}

export type SyncOutcome = "success" | "partial" | "noop" | "failed";

export interface SyncFailure {
  accountId: string;
  username: string;
  message: string;
}

export interface SyncRunReport {
  snapshot: TrackerSnapshot;
  outcome: SyncOutcome;
  attempted: number;
  succeeded: number;
  failed: number;
  skipped: number;
  failures: SyncFailure[];
}

export interface AddAccountInput {
  username: string;
  niches?: string[];
}

export interface UpdateAccountInput {
  active?: boolean;
  manualNiches?: string[];
}

export interface UpdateTweetInput {
  workflowStatus: TweetWorkflowStatus;
}

export interface XDataProvider {
  readonly mode: ProviderMode;
  resolveAccount(username: string): Promise<ProviderAccount>;
  refreshAccount(account: ProviderAccount): Promise<ProviderAccount>;
  fetchRecentTweets(account: ProviderAccount): Promise<ProviderTweet[]>;
}
