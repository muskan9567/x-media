"use client";

import {
  PlayIcon,
  AtSignIcon,
  ImagesIcon,
  ArchiveIcon,
  LayoutDashboardIcon,
  ListFilterIcon,
  MessageSquareReplyIcon,
  PlusIcon,
  RadioIcon,
  UsersRoundIcon,
} from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { NicheSummary } from "@/lib/tracker/types";
import { cn } from "@/lib/utils";

export type DashboardView = "overview" | "feed" | "media" | "replies" | "accounts";

interface TrackerSidebarProps {
  view: DashboardView;
  demoMode: boolean;
  viralCount: number;
  mediaCount: number;
  replyCount: number;
  accountCount: number;
  niches: NicheSummary[];
  selectedNiche: string;
  onView: (view: DashboardView) => void;
  onNicheSelect: (niche: string) => void;
  onAddAccount: () => void;
}

const NAV_ITEMS: Array<{
  value: DashboardView;
  label: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}> = [
  { value: "overview", label: "Overview", icon: LayoutDashboardIcon },
  { value: "feed", label: "Viral feed", icon: ListFilterIcon },
  { value: "media", label: "Media library", icon: ImagesIcon },
  { value: "replies", label: "Reply queue", icon: MessageSquareReplyIcon },
  { value: "accounts", label: "Watchlist", icon: UsersRoundIcon },
];

export function TrackerSidebar({
  view,
  demoMode,
  viralCount,
  mediaCount,
  replyCount,
  accountCount,
  niches,
  selectedNiche,
  onView,
  onNicheSelect,
  onAddAccount,
}: TrackerSidebarProps) {
  const counts: Partial<Record<DashboardView, number>> = {
    feed: viralCount,
    media: mediaCount,
    replies: replyCount,
    accounts: accountCount,
  };

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-16 items-center gap-3 border-b px-4">
        <div className="relative flex size-9 items-center justify-center overflow-hidden rounded-xl border border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-300">
          <PlayIcon className="relative z-10 size-5" aria-hidden />
          <div
            aria-hidden
            className="absolute inset-0 bg-[radial-gradient(circle_at_85%_10%,rgba(27,175,122,0.34),transparent_58%)]"
          />
        </div>
        <div className="min-w-0">
          <p className="truncate font-semibold tracking-tight">X Media</p>
          <p className="truncate text-xs text-muted-foreground">X virality tracker</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <nav aria-label="Primary navigation">
          <p className="px-2 pb-2 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
            Workspace
          </p>
          <div className="space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = view === item.value;
              const count = counts[item.value];
              return (
                <Button
                  key={item.value}
                  type="button"
                  variant="ghost"
                  className={cn(
                    "h-9 w-full justify-start px-2.5 text-muted-foreground",
                    active &&
                      "bg-sidebar-accent text-sidebar-accent-foreground shadow-xs",
                  )}
                  aria-current={active ? "page" : undefined}
                  onClick={() => onView(item.value)}
                >
                  <Icon data-icon="inline-start" aria-hidden />
                  {item.label}
                  {count !== undefined && (
                    <Badge
                      variant={active ? "default" : "secondary"}
                      className="ml-auto min-w-6 justify-center px-1.5 tabular-nums"
                    >
                      {count}
                    </Badge>
                  )}
                </Button>
              );
            })}
          </div>
        </nav>

        <div className="my-4 border-t" />

        <section aria-labelledby="sidebar-niches-heading">
          <div className="flex items-center justify-between px-2 pb-2">
            <p
              id="sidebar-niches-heading"
              className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase"
            >
              Watched niches
            </p>
            <RadioIcon className="size-3.5 text-muted-foreground" aria-hidden />
          </div>
          <div className="space-y-0.5">
            {niches.slice(0, 6).map((niche, index) => {
              const selected =
                selectedNiche.toLowerCase() === niche.name.toLowerCase();
              return (
                <button
                  type="button"
                  key={niche.name}
                  aria-pressed={selected}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                    selected &&
                      "bg-sidebar-accent text-sidebar-accent-foreground shadow-xs",
                  )}
                  onClick={() => onNicheSelect(niche.name)}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      index === 0
                        ? "bg-blue-500"
                        : index === 1
                          ? "bg-orange-500"
                          : "bg-emerald-500",
                    )}
                  />
                  <span className="truncate">{niche.name}</span>
                  <span className="ml-auto tabular-nums">{niche.tweets}</span>
                </button>
              );
            })}
          </div>
        </section>
      </div>

      <div className="space-y-3 border-t p-3">
        <Button
          variant="outline"
          className="w-full"
          nativeButton={false}
          render={<Link href="/" />}
        >
          <ArchiveIcon data-icon="inline-start" aria-hidden />
          Search media archive
        </Button>
        <div className="rounded-xl border bg-background/50 p-3">
          <div className="flex items-center gap-2 text-xs font-medium">
            <span
              aria-hidden
              className={cn(
                "size-2 rounded-full",
                demoMode ? "bg-amber-500" : "bg-blue-500",
              )}
            />
            {demoMode ? "Demo data active" : "X API configured"}
          </div>
          <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
            {demoMode
              ? "Explore every workflow before adding API access."
              : "Public posts sync through your server-side token."}
          </p>
        </div>
        <Button type="button" className="w-full" onClick={onAddAccount}>
          <PlusIcon data-icon="inline-start" aria-hidden />
          Track account
        </Button>
        <p className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground">
          <AtSignIcon className="size-3" aria-hidden />
          Local data · manual replies only
        </p>
      </div>
    </div>
  );
}
