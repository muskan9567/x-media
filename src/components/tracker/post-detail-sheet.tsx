"use client";

import {
  ArrowUpRightIcon,
  BookmarkIcon,
  CheckCircle2Icon,
  CheckIcon,
  Clock3Icon,
  HeartIcon,
  MessageCircleIcon,
  QuoteIcon,
  Repeat2Icon,
  ShieldAlertIcon,
  SparklesIcon,
  TrendingUpIcon,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Progress,
  ProgressLabel,
} from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { TrackedTweet, TweetWorkflowStatus } from "@/lib/tracker/types";

import {
  absoluteTime,
  compactNumber,
  scoreTone,
  stageLabel,
} from "./format";
import { PostMedia } from "./post-media";
import { SignalShader } from "./signal-shader";

interface PostDetailSheetProps {
  tweet: TrackedTweet | null;
  open: boolean;
  busy?: boolean;
  finalFocus?: () => HTMLElement | null;
  onOpenChange: (open: boolean) => void;
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

function ScoreMeter({ label, value }: { label: string; value: number }) {
  return (
    <Progress value={value} aria-label={`${label}: ${value} out of 100`}>
      <ProgressLabel>{label}</ProgressLabel>
      <span className="ml-auto text-sm text-muted-foreground tabular-nums">
        {value}/100
      </span>
    </Progress>
  );
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
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </div>
      <p className="mt-1 text-lg font-semibold">{compactNumber(value)}</p>
    </div>
  );
}

export function PostDetailSheet({
  tweet,
  open,
  busy = false,
  finalFocus,
  onOpenChange,
  onStatus,
}: PostDetailSheetProps) {
  const saved = tweet?.workflowStatus === "saved";
  const responded = tweet?.workflowStatus === "responded";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="w-full gap-0 overflow-hidden p-0 data-[side=right]:sm:max-w-xl"
        finalFocus={finalFocus}
      >
        {tweet && (
          <>
            <SheetHeader className="relative min-h-36 overflow-hidden border-b p-5 pr-14">
              {open && <SignalShader />}
              <div className="relative z-10 flex items-center gap-3">
                <Avatar className="size-10 border bg-background/70 backdrop-blur-sm">
                  <AvatarImage
                    src={tweet.authorProfileImageUrl}
                    alt=""
                    referrerPolicy="no-referrer"
                  />
                  <AvatarFallback>{initials(tweet.authorDisplayName)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <SheetTitle className="truncate text-lg">
                    {tweet.authorDisplayName}
                  </SheetTitle>
                  <SheetDescription>
                    @{tweet.authorUsername} · {absoluteTime(tweet.createdAt)}
                  </SheetDescription>
                </div>
              </div>
              <div className="relative z-10 mt-4 flex flex-wrap gap-2">
                <Badge variant="outline" className={scoreTone(tweet.viralityScore)}>
                  <TrendingUpIcon data-icon="inline-start" aria-hidden />
                  {stageLabel(tweet.stage)} · {tweet.viralityScore}
                </Badge>
                <Badge variant="outline" className={scoreTone(tweet.replyScore)}>
                  <SparklesIcon data-icon="inline-start" aria-hidden />
                  Reply fit · {tweet.replyScore}
                </Badge>
                <Badge variant="secondary">
                  <Clock3Icon data-icon="inline-start" aria-hidden />
                  {tweet.confidence}% confidence
                </Badge>
              </div>
            </SheetHeader>

            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-6 p-5">
                <section aria-labelledby="post-copy-heading">
                  <h2 className="sr-only" id="post-copy-heading">
                    Post content
                  </h2>
                  <p className="[overflow-wrap:anywhere] text-base leading-7 text-foreground/90">
                    {tweet.text}
                  </p>
                  <PostMedia
                    media={tweet.media ?? []}
                    className="mt-4"
                    detail
                  />
                  <div className="mt-3 flex flex-wrap gap-2">
                    {tweet.niches.map((niche) => (
                      <Badge key={niche} variant="secondary">
                        {niche}
                      </Badge>
                    ))}
                  </div>
                </section>

                <section className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Post metrics">
                  <Metric
                    icon={HeartIcon}
                    label="Likes"
                    value={tweet.metrics.likeCount}
                  />
                  <Metric
                    icon={Repeat2Icon}
                    label="Reposts"
                    value={tweet.metrics.repostCount}
                  />
                  <Metric
                    icon={MessageCircleIcon}
                    label="Replies"
                    value={tweet.metrics.replyCount}
                  />
                  <Metric
                    icon={QuoteIcon}
                    label="Quotes"
                    value={tweet.metrics.quoteCount}
                  />
                </section>

                <Separator />

                <section className="space-y-4" aria-labelledby="scores-heading">
                  <div>
                    <h2 className="font-medium" id="scores-heading">
                      Signal scores
                    </h2>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Account-normalized velocity, audience-relative engagement,
                      freshness, niche match, and conversation openness.
                    </p>
                  </div>
                  <ScoreMeter label="Virality" value={tweet.viralityScore} />
                  <ScoreMeter label="Reply opportunity" value={tweet.replyScore} />
                </section>

                <section className="grid gap-4 sm:grid-cols-2" aria-label="Score explanations">
                  <div className="rounded-xl border bg-muted/20 p-4">
                    <h3 className="flex items-center gap-2 font-medium">
                      <TrendingUpIcon className="size-4" aria-hidden />
                      Why it is moving
                    </h3>
                    <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                      {tweet.scoreReasons.map((reason) => (
                        <li key={reason} className="flex gap-2">
                          <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
                          <span>{reason}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-xl border bg-muted/20 p-4">
                    <h3 className="flex items-center gap-2 font-medium">
                      <SparklesIcon className="size-4" aria-hidden />
                      Why it fits
                    </h3>
                    <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                      {tweet.replyReasons.length ? (
                        tweet.replyReasons.map((reason) => (
                          <li key={reason} className="flex gap-2">
                            <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-blue-600" aria-hidden />
                            <span>{reason}</span>
                          </li>
                        ))
                      ) : (
                        <li>Not enough relevance or timing evidence yet.</li>
                      )}
                    </ul>
                  </div>
                </section>

                {tweet.riskFlags.length > 0 && (
                  <section className="rounded-xl border border-destructive/25 bg-destructive/5 p-4" aria-labelledby="risk-heading">
                    <h3 className="flex items-center gap-2 font-medium text-destructive" id="risk-heading">
                      <ShieldAlertIcon className="size-4" aria-hidden />
                      Review before responding
                    </h3>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                      {tweet.riskFlags.map((flag) => (
                        <li key={flag}>{flag}</li>
                      ))}
                    </ul>
                  </section>
                )}

                {tweet.source === "mock" && (
                  <p className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 text-xs leading-5 text-muted-foreground">
                    This is a demo post. Reply shortcuts are unavailable; replies
                    always remain manual.
                  </p>
                )}
              </div>
            </ScrollArea>

            <SheetFooter className="border-t bg-background/95 p-4 backdrop-blur-sm sm:flex-row sm:items-center">
              <Button
                type="button"
                variant={saved ? "secondary" : "outline"}
                aria-pressed={saved}
                disabled={busy}
                onClick={() => onStatus(tweet, saved ? "new" : "saved")}
              >
                <BookmarkIcon data-icon="inline-start" aria-hidden className={saved ? "fill-current" : ""} />
                {saved ? "Saved" : "Save"}
              </Button>
              <div className="flex-1" />
              <Button
                type="button"
                variant={responded ? "secondary" : "outline"}
                aria-pressed={responded}
                disabled={busy}
                onClick={() =>
                  onStatus(tweet, responded ? "new" : "responded")
                }
              >
                <CheckIcon data-icon="inline-start" aria-hidden />
                {responded ? "Marked responded" : "Mark responded"}
              </Button>
              {tweet.source === "x" && tweet.riskFlags.length === 0 && (
                <Button
                  render={
                    <a
                      href={`https://x.com/intent/post?in_reply_to=${encodeURIComponent(tweet.id)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    />
                  }
                >
                  Reply on X
                  <ArrowUpRightIcon data-icon="inline-end" aria-hidden />
                </Button>
              )}
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
