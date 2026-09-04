import { formatDistanceStrict } from "date-fns";

import type { ViralityStage } from "@/lib/tracker/types";

const compactFormatter = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const integerFormatter = new Intl.NumberFormat("en", {
  maximumFractionDigits: 0,
});

export function compactNumber(value: number): string {
  return Math.abs(value) >= 1_000
    ? compactFormatter.format(value)
    : integerFormatter.format(value);
}

export function preciseNumber(value: number): string {
  return integerFormatter.format(value);
}

export function relativeTime(
  value: string,
  referenceTimestamp: number,
): string {
  return formatDistanceStrict(new Date(value), new Date(referenceTimestamp), {
    addSuffix: true,
  });
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function absoluteTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown time";
  const hour = date.getUTCHours();
  const displayHour = hour % 12 || 12;
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const period = hour >= 12 ? "PM" : "AM";
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()} · ${displayHour}:${minutes} ${period} UTC`;
}

export function stageLabel(stage: ViralityStage): string {
  return {
    baseline: "Baseline",
    emerging: "Emerging",
    rising: "Rising",
    viral: "Viral",
    cooling: "Cooling",
  }[stage];
}

export function scoreTone(score: number): string {
  if (score >= 82) {
    return "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  }
  if (score >= 68) {
    return "border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-300";
  }
  if (score >= 55) {
    return "border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300";
  }
  return "border-border bg-muted/60 text-muted-foreground";
}
