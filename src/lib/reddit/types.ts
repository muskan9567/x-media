export type Meme = {
  id: string; title: string; subreddit: string; permalink: string; created: number | null;
  score: number | null; tier: string; qualityScore: number; tags: string[];
  favorite: boolean; reviewStatus: string; thumbnailUrl: string; originalUrl: string;
  analysis?: { visibleText?: string; joke?: string };
};
export type MemeList = { memes: Meme[]; total?: number; nextCursor?: string | null; batchId?: string; newAvailable?: number; seenIds?: string[] };
export type RedditStats = {
  total: number; stored: number; saved: number; pendingReview: number; refreshing: boolean;
  sources: string[]; lastRefreshError?: string; lastRefresh?: string;
  jobs: { id: string; state?: string; error?: string; lastSuccess?: number }[];
  vision: { available: boolean; mode: string; spending: { daily: number; monthly: number; imagesToday: number } };
};
export type RedditSettings = { tvSeconds: number; diskCacheMB: number; visionEnabled: boolean; visionInfluence: boolean; dailyBudget: number; monthlyBudget: number; dailyImages: number; discordEnabled: boolean };
