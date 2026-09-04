"use client";

import {
  BookmarkIcon,
  CheckIcon,
  EyeIcon,
  HeartIcon,
  MessageCircleIcon,
  QuoteIcon,
  Repeat2Icon,
  SparklesIcon,
  XIcon,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { TrackedTweet, TweetWorkflowStatus } from "@/lib/tracker/types";
import { cn } from "@/lib/utils";

import {
  compactNumber,
  relativeTime,
  scoreTone,
  stageLabel,
} from "./format";
import { PostMedia } from "./post-media";

interface PostRowProps {
  tweet: TrackedTweet;
  referenceTimestamp: number;
  busy?: boolean;
  compact?: boolean;
  onSelect: (tweet: TrackedTweet) => void;
  onStatus: (tweet: TrackedTweet, status: TweetWorkflowStatus) => void;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  value: number;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="sr-only">{label}: </span>
      <Icon className="size-3.5" aria-hidden />
      <span className="tabular-nums">{compactNumber(value)}</span>
    </span>
  );
}

export function PostRow({
  tweet,
  referenceTimestamp,
  busy = false,
  compact = false,
  onSelect,
  onStatus,
}: PostRowProps) {
  const saved = tweet.workflowStatus === "saved";
  const responded = tweet.workflowStatus === "responded";

  return (
    <article
      data-tweet-id={tweet.id}
      className={cn(
        "group rounded-xl border bg-card/80 p-4 shadow-xs transition-colors hover:border-foreground/15 hover:bg-card",
        compact && "p-3",
      )}
    >
      <div className="flex items-start gap-3">
        <Avatar className="mt-0.5 size-9 border">
          <AvatarImage
            src={tweet.authorProfileImageUrl}
            alt=""
            referrerPolicy="no-referrer"
          />
          <AvatarFallback>{initials(tweet.authorDisplayName)}</AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate font-medium">{tweet.authorDisplayName}</span>
            <span className="truncate text-xs text-muted-foreground">
              @{tweet.authorUsername}
            </span>
            <span aria-hidden className="text-muted-foreground/60">
              ·
            </span>
            <time
              dateTime={tweet.createdAt}
              className="text-xs text-muted-foreground"
            >
              {relativeTime(tweet.createdAt, referenceTimestamp)}
            </time>
          </div>

          <button
            type="button"
            className="mt-2 block w-full rounded-md [overflow-wrap:anywhere] text-left leading-6 text-foreground/90 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onSelect(tweet)}
          >
            {tweet.text}
          </button>

          <PostMedia media={tweet.media ?? []} className="mt-3" />

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={scoreTone(tweet.viralityScore)}>
              <SparklesIcon data-icon="inline-start" aria-hidden />
              {stageLabel(tweet.stage)} · {tweet.viralityScore}
            </Badge>
            <Badge variant="outline" className={scoreTone(tweet.replyScore)}>
              Reply fit · {tweet.replyScore}
            </Badge>
            {tweet.niches.slice(0, compact ? 1 : 2).map((niche) => (
              <Badge key={niche} variant="secondary">
                {niche}
              </Badge>
            ))}
            {saved && (
              <Badge variant="outline" className="text-blue-700 dark:text-blue-300">
                <BookmarkIcon
                  data-icon="inline-start"
                  className="fill-current"
                  aria-hidden
                />
                Saved
              </Badge>
            )}
            {responded && (
              <Badge variant="outline" className="text-emerald-700 dark:text-emerald-300">
                <CheckIcon data-icon="inline-start" aria-hidden />
                Responded
              </Badge>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-xs text-muted-foreground">
            <div className="flex flex-wrap items-center gap-4">
              <Metric
                icon={MessageCircleIcon}
                label="replies"
                value={tweet.metrics.replyCount}
              />
              <Metric
                icon={Repeat2Icon}
                label="reposts"
                value={tweet.metrics.repostCount}
              />
              <Metric
                icon={QuoteIcon}
                label="quotes"
                value={tweet.metrics.quoteCount}
              />
              <Metric
                icon={HeartIcon}
                label="likes"
                value={tweet.metrics.likeCount}
              />
            </div>

            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      size="icon-sm"
                      variant={saved ? "secondary" : "ghost"}
                      aria-label={saved ? "Remove from saved" : "Save opportunity"}
                      aria-pressed={saved}
                      disabled={busy}
                      onClick={() =>
                        onStatus(tweet, saved ? "new" : "saved")
                      }
                    />
                  }
                >
                  <BookmarkIcon aria-hidden className={saved ? "fill-current" : ""} />
                </TooltipTrigger>
                <TooltipContent>
                  {saved ? "Remove from saved" : "Save opportunity"}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Dismiss post"
                      disabled={busy}
                      onClick={() => onStatus(tweet, "dismissed")}
                    />
                  }
                >
                  <XIcon aria-hidden />
                </TooltipTrigger>
                <TooltipContent>Dismiss post</TooltipContent>
              </Tooltip>
              <Button
                data-post-focus
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onSelect(tweet)}
              >
                <EyeIcon data-icon="inline-start" aria-hidden />
                Details
              </Button>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
