import {
  addDays,
  addHours,
  addMonths,
  addQuarters,
  addWeeks,
  differenceInCalendarDays,
  format,
  startOfDay,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  subDays,
  subHours,
} from "date-fns";

import { weightedEngagement } from "./scoring";
import type { ActivityPoint, TrackedTweet } from "./types";

export type ActivityRange = "24h" | "7d" | "30d" | "all";

interface ActivityBucket {
  start: Date;
  end: Date;
  date: string;
  label: string;
}

interface TimedTweet {
  tweet: TrackedTweet;
  timestamp: number;
}

function fixedDayBuckets(
  reference: Date,
  days: number,
  labelPattern: string,
): ActivityBucket[] {
  return Array.from({ length: days }, (_, index) => {
    const start = startOfDay(subDays(reference, days - 1 - index));
    return {
      start,
      end: addDays(start, 1),
      date: format(start, "yyyy-MM-dd"),
      label: format(start, labelPattern),
    };
  });
}

function hourlyBuckets(reference: Date): ActivityBucket[] {
  const rangeStart = subHours(reference, 24);

  return Array.from({ length: 24 }, (_, index) => {
    const start = addHours(rangeStart, index);
    return {
      start,
      end: addHours(start, 1),
      date: format(start, "yyyy-MM-dd HH:mm xxx"),
      label: format(start, "h:mm a"),
    };
  });
}

function calendarBuckets(
  firstBucket: Date,
  reference: Date,
  advance: (date: Date) => Date,
  labelPattern: string,
): ActivityBucket[] {
  const buckets: ActivityBucket[] = [];
  let start = firstBucket;

  while (start.getTime() <= reference.getTime()) {
    const end = advance(start);
    buckets.push({
      start,
      end,
      date: format(start, "yyyy-MM-dd"),
      label: format(start, labelPattern),
    });
    start = end;
  }

  return buckets;
}

function allRetainedBuckets(
  tweets: TimedTweet[],
  reference: Date,
): ActivityBucket[] {
  const earliestTimestamp = Math.min(
    reference.getTime(),
    ...tweets.map(({ timestamp }) => timestamp),
  );
  const earliest = new Date(earliestTimestamp);
  const retainedDays =
    differenceInCalendarDays(startOfDay(reference), startOfDay(earliest)) + 1;

  if (retainedDays <= 45) {
    return calendarBuckets(
      startOfDay(earliest),
      reference,
      (date) => addDays(date, 1),
      "MMM d",
    );
  }

  if (retainedDays <= 210) {
    return calendarBuckets(
      startOfWeek(earliest, { weekStartsOn: 1 }),
      reference,
      (date) => addWeeks(date, 1),
      "MMM d",
    );
  }

  if (retainedDays <= 1_095) {
    return calendarBuckets(
      startOfMonth(earliest),
      reference,
      (date) => addMonths(date, 1),
      "MMM yy",
    );
  }

  return calendarBuckets(
    startOfQuarter(earliest),
    reference,
    (date) => addQuarters(date, 1),
    "QQQ yyyy",
  );
}

export function buildActivity(
  tweets: TrackedTweet[],
  reference: Date,
  range: ActivityRange = "7d",
): ActivityPoint[] {
  const timedTweets = tweets.flatMap<TimedTweet>((tweet) => {
    const timestamp = new Date(tweet.createdAt).getTime();
    return Number.isFinite(timestamp) ? [{ tweet, timestamp }] : [];
  });

  const buckets =
    range === "24h"
      ? hourlyBuckets(reference)
      : range === "7d"
        ? fixedDayBuckets(reference, 7, "EEE")
        : range === "30d"
          ? fixedDayBuckets(reference, 30, "MMM d")
          : allRetainedBuckets(timedTweets, reference);

  return buckets.map((bucket) => {
    const bucketTweets = timedTweets.filter(
      ({ timestamp }) =>
        timestamp >= bucket.start.getTime() && timestamp < bucket.end.getTime(),
    );

    return {
      date: bucket.date,
      label: bucket.label,
      engagement: Math.round(
        bucketTweets.reduce(
          (sum, { tweet }) => sum + weightedEngagement(tweet.metrics),
          0,
        ),
      ),
      opportunities: bucketTweets.filter(
        ({ tweet }) => tweet.replyScore >= 68 && tweet.riskFlags.length === 0,
      ).length,
    };
  });
}
