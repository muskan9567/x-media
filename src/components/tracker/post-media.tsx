"use client";

/* eslint-disable @next/next/no-img-element -- X media URLs are dynamic provider data. */

import {
  ImageIcon,
  PlayIcon,
  RefreshCwIcon,
  VideoIcon,
} from "lucide-react";

import type { PostMedia as PostMediaItem } from "@/lib/tracker/types";
import { cn } from "@/lib/utils";

interface PostMediaProps {
  media: readonly PostMediaItem[];
  className?: string;
  detail?: boolean;
  onPlaybackError?: () => void;
  videoUrlOverride?: string;
}

function bestVideoUrl(item: PostMediaItem): string | undefined {
  return [...item.variants]
    .filter(
      (variant) =>
        variant.contentType === "video/mp4" ||
        /\.mp4(?:$|\?)/i.test(variant.url),
    )
    .sort((a, b) => (b.bitRate ?? 0) - (a.bitRate ?? 0))[0]?.url;
}

function formatDuration(durationMs: number | undefined): string | undefined {
  if (durationMs === undefined) return undefined;
  const totalSeconds = Math.max(0, Math.round(durationMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function MediaBadge({ item }: { item: PostMediaItem }) {
  const duration = formatDuration(item.durationMs);
  const Icon =
    item.type === "photo"
      ? ImageIcon
      : item.type === "animated_gif"
        ? RefreshCwIcon
        : VideoIcon;
  const label =
    item.type === "animated_gif"
      ? "GIF"
      : item.type === "video"
        ? duration ?? "Video"
        : "Photo";

  return (
    <span className="pointer-events-none absolute right-2 bottom-2 inline-flex items-center gap-1 rounded-md border border-white/15 bg-black/72 px-2 py-1 text-[11px] font-medium text-white shadow-sm backdrop-blur-sm">
      <Icon className="size-3" aria-hidden />
      {label}
    </span>
  );
}

function MediaItem({
  item,
  detail,
  featured,
  onPlaybackError,
  videoUrlOverride,
}: {
  item: PostMediaItem;
  detail: boolean;
  featured: boolean;
  onPlaybackError?: () => void;
  videoUrlOverride?: string;
}) {
  const videoUrl = videoUrlOverride ?? bestVideoUrl(item);
  const alt = item.altText?.trim() || `${item.type.replace("_", " ")} attached to this post`;
  const mediaClassName = cn(
    "h-full w-full bg-black object-contain",
    detail ? "max-h-[34rem] min-h-48" : "max-h-80 min-h-36",
  );

  return (
    <div
      className={cn(
        "relative min-w-0 overflow-hidden bg-black",
        featured && "sm:row-span-2",
      )}
      style={
        item.width && item.height && !featured
          ? { aspectRatio: `${item.width} / ${item.height}` }
          : undefined
      }
    >
      {item.type === "photo" && item.url ? (
        <img
          src={item.url}
          alt={alt}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className={mediaClassName}
        />
      ) : videoUrl ? (
        <video
          onError={onPlaybackError}
          className={mediaClassName}
          controls={item.type === "video"}
          autoPlay={item.type === "animated_gif"}
          loop={item.type === "animated_gif"}
          muted
          playsInline
          preload="metadata"
          poster={item.previewImageUrl}
          aria-label={alt}
        >
          <source src={videoUrl} type="video/mp4" onError={onPlaybackError} />
          Your browser cannot play this media.
        </video>
      ) : item.previewImageUrl ? (
        <>
          <img
            src={item.previewImageUrl}
            alt={alt}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            className={mediaClassName}
          />
          <span className="pointer-events-none absolute inset-0 grid place-items-center">
            <span className="grid size-11 place-items-center rounded-full bg-black/65 text-white shadow-md backdrop-blur-sm">
              <PlayIcon className="ml-0.5 size-5 fill-current" aria-hidden />
            </span>
          </span>
        </>
      ) : (
        <div className="grid min-h-40 place-items-center bg-muted px-6 text-center text-xs text-muted-foreground">
          This attachment is available on X but has no displayable preview.
        </div>
      )}
      <MediaBadge item={item} />
    </div>
  );
}

export function PostMedia({
  media,
  className,
  detail = false,
  onPlaybackError,
  videoUrlOverride,
}: PostMediaProps) {
  if (media.length === 0) return null;

  return (
    <div
      className={cn(
        "grid overflow-hidden rounded-xl border bg-black shadow-xs",
        media.length === 1
          ? "grid-cols-1"
          : media.length === 2
            ? "grid-cols-2"
            : media.length === 4
              ? "grid-cols-2"
              : "grid-cols-2 sm:grid-cols-3",
        className,
      )}
      aria-label={`${media.length} media attachment${media.length === 1 ? "" : "s"}`}
    >
      {media.map((item, index) => (
        <MediaItem
          key={item.mediaKey}
          item={item}
          detail={detail}
          featured={media.length === 3 && index === 0}
          onPlaybackError={onPlaybackError}
          videoUrlOverride={videoUrlOverride}
        />
      ))}
    </div>
  );
}
