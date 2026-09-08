"use client";
/* eslint-disable @next/next/no-img-element -- Originals are served by the local collector. */
import { useCallback, useEffect, useState } from "react";
import { BookmarkIcon, MaximizeIcon, PauseIcon, PlayIcon, SkipForwardIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Meme, RedditSettings } from "@/lib/reddit/types";
import { redditApi, selectClass } from "./reddit-explorer";

export function RedditTV({ onOpen, onFeedback, busy, updates }: { onOpen: (meme: Meme) => void; onFeedback: (meme: Meme, action: string) => Promise<Meme | null>; busy: boolean; updates: Record<string, Meme> }) {
  const [queue, setQueue] = useState<Meme[]>([]);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [loaded, setLoaded] = useState("");
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [seconds, setSeconds] = useState(8);
  const [replay, setReplay] = useState(false);
  const playable = queue.map(meme => updates[meme.id] || meme).filter(meme => meme.reviewStatus !== "reject");
  const current = playable[index];

  const start = useCallback(async (includeSeen = false) => {
    setLoading(true); setError("");
    try {
      const data = await redditApi<{ memes: Meme[]; seenIds: string[]; tickMs: number }>("feed");
      const seen = new Set(data.seenIds);
      setQueue(includeSeen ? data.memes : data.memes.filter(meme => !seen.has(meme.id)));
      setIndex(0); setSeconds(data.tickMs / 1000); setReplay(includeSeen); setLoaded(""); setFailed(false);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const timer = setTimeout(() => void start(), 0); return () => clearTimeout(timer); }, [start]);
  useEffect(() => {
    const visibility = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, []);
  const next = useCallback(() => { setIndex(value => value + 1); setLoaded(""); setFailed(false); }, []);
  useEffect(() => {
    if (paused || hidden || !current || loaded !== current.id || failed) return;
    const timer = setTimeout(next, seconds * 1000); return () => clearTimeout(timer);
  }, [paused, hidden, loaded, current, failed, seconds, next]);

  return <div className="mt-5">
    {error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}
    {current ? <>
      <div className="relative flex min-h-72 items-center justify-center overflow-hidden rounded-xl border bg-muted">
        {failed ? <div className="p-8 text-center"><p>This image is unavailable.</p><Button className="mt-3" variant="outline" onClick={next}>Skip image</Button></div> : <img key={current.id} src={current.originalUrl} alt={current.title} className="max-h-[65dvh] w-full object-contain" onLoad={() => { setLoaded(current.id); void redditApi(`seen/${current.id}`, {}).catch(() => {}); }} onError={() => setFailed(true)} />}
      </div>
      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><h2 className="text-base font-medium">{current.title}</h2><p className="mt-1 text-sm text-muted-foreground">r/{current.subreddit} · {index + 1} of {queue.length}{replay ? " · Replay" : ""}</p></div>
        <div className="flex shrink-0 flex-wrap items-center gap-2"><Button variant="outline" aria-label={paused ? "Play TV" : "Pause TV"} onClick={() => setPaused(!paused)}>{paused ? <PlayIcon aria-hidden /> : <PauseIcon aria-hidden />}{paused ? "Play" : "Pause"}</Button><Button variant="outline" onClick={next}><SkipForwardIcon aria-hidden />Next</Button><Button variant="outline" onClick={() => { setPaused(true); onOpen(current); }}><MaximizeIcon aria-hidden />View</Button><Button variant={current.favorite ? "secondary" : "outline"} disabled={busy} onClick={async () => { const updated = await onFeedback(current, current.favorite ? "unfavorite" : "favorite"); if (updated) setQueue(rows => rows.map(meme => meme.id === updated.id ? updated : meme)); }}><BookmarkIcon aria-hidden />{current.favorite ? "Unsave" : "Save"}</Button></div>
      </div>
    </> : <div className="rounded-xl border border-dashed p-10 text-center"><h2 className="font-medium">{loading ? "Opening your channel…" : "You’re all caught up"}</h2><p className="mt-2 text-sm text-muted-foreground">{loading ? "Loading saved finds." : "Collect new memes or replay your kept collection."}</p><Button className="mt-4" variant="outline" disabled={loading} onClick={() => void start(true)}>Replay collection</Button></div>}
    <label className="mt-5 flex items-center gap-3 text-sm text-muted-foreground">Seconds per meme<select className={selectClass} value={seconds} onChange={async event => {
      const value = Number(event.target.value);
      try { await redditApi<{ settings: RedditSettings }>("settings", { tvSeconds: value }, "PATCH"); setSeconds(value); }
      catch (e) { setError((e as Error).message); }
    }}>{Array.from({ length: 26 }, (_, i) => i + 5).map(value => <option key={value}>{value}</option>)}</select></label>
  </div>;
}
