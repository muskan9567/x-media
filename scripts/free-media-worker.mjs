const username = process.argv[2];
const maxPosts = Number(process.argv[3]);
const duplicateLimit = 40;

function publicError(error) {
  if (/rate.?limit|\b429\b/i.test(error?.message ?? "")) return "rate_limit";
  if (/private|protected/i.test(error?.message ?? "")) return "protected";
  return "upstream";
}

if (process.argv.includes("--stream")) {
  let input = '';
  for await (const chunk of process.stdin) { input += chunk; if (input.length > 1_000_000) throw new Error('Checkpoint too large'); }
  const checkpoint = input ? JSON.parse(input) : undefined;
  if (checkpoint && checkpoint.provider !== 'fxtwitter') {
    const { collectStream } = await import("./stream-media-worker.mjs");
    await collectStream(username, maxPosts, checkpoint);
  } else {
    const { collectFxMedia } = await import("./fx-media-worker.mjs");
    await collectFxMedia(username, maxPosts, checkpoint);
  }
} else {
try {
  const { ErrorRateLimitStrategy, Scraper } = await import("@the-convocation/twitter-scraper");
  const scraper = new Scraper({
    rateLimitStrategy: new ErrorRateLimitStrategy(),
  });
  const profile = await scraper.getProfile(username);
  const timeline = scraper.getTweets(username, maxPosts);
  const seen = new Set();
  const tweets = [];
  let yielded = 0;
  let duplicateStreak = 0;
  let stopReason;

  try {
    while (seen.size < maxPosts) {
      const next = await timeline.next();
      if (next.done) break;
      yielded += 1;
      const tweet = next.value;
      if (!tweet.id || seen.has(tweet.id)) {
        duplicateStreak += 1;
        if (duplicateStreak >= duplicateLimit) {
          stopReason = "X began repeating the same timeline page";
          await timeline.return(undefined);
          break;
        }
        continue;
      }
      duplicateStreak = 0;
      seen.add(tweet.id);
      tweets.push({
        id: tweet.id,
        username: tweet.username,
        text: tweet.text,
        createdAt: tweet.timeParsed?.toISOString(),
        timestamp: tweet.timestamp,
        permanentUrl: tweet.permanentUrl,
        isRetweet: tweet.isRetweet,
        retweetedStatusId: tweet.retweetedStatusId,
        photos: (tweet.photos ?? []).map((photo) => ({
          id: photo.id,
          url: photo.url,
          alt_text: photo.alt_text,
        })),
        videos: (tweet.videos ?? []).map((video) => ({
          id: video.id,
          preview: video.preview,
          url: video.url,
          type: tweet.__raw_UNSTABLE?.extended_entities?.media?.find(
            (media) => media.id_str === video.id,
          )?.type,
        })),
      });
    }
  } catch (error) {
    if (tweets.length === 0) throw error;
    stopReason =
      publicError(error) === "rate_limit"
        ? "X rate-limited the collector after returning partial results"
        : "X stopped the timeline after returning partial results";
  }

  process.stdout.write(
    JSON.stringify({
      ok: true,
      profile: {
        username: profile.username,
        name: profile.name,
        avatar: profile.avatar,
      },
      tweets,
      yielded,
      stopReason,
    }),
  );
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, reason: publicError(error) }));
}
}
