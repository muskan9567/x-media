"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { RedditSettings, RedditStats } from "@/lib/reddit/types";
import { redditApi, selectClass } from "./reddit-explorer";

export function RedditSettingsPanel({ stats }: { stats: RedditStats | null }) {
  const [settings, setSettings] = useState<RedditSettings | null>(null);
  const [validated, setValidated] = useState(false);
  const [available, setAvailable] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    redditApi<{ settings: RedditSettings; validated: boolean; vision: { available: boolean } }>("settings", undefined, "GET", abort.signal).then(data => {
      setSettings(data.settings); setValidated(data.validated); setAvailable(data.vision.available);
    }).catch(e => { if (!abort.signal.aborted) setError(e.message); });
    return () => abort.abort();
  }, []);
  return <div className="mx-auto mt-6 max-w-3xl space-y-8">
    <div><h2 className="text-lg font-semibold tracking-tight">Collection settings</h2><p className="mt-2 text-sm text-muted-foreground">Your collection, decisions, and viewing history stay on this computer. Collection refreshes every three minutes while X Media is running.</p></div>
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    {settings ? <form className="space-y-6" onSubmit={async event => {
      event.preventDefault(); setBusy(true); setError(""); setSaved(false);
      try { const data = await redditApi<{ settings: RedditSettings }>("settings", settings, "PATCH"); setSettings(data.settings); setSaved(true); }
      catch (e) { setError((e as Error).message); }
      finally { setBusy(false); }
    }}>
      <div className="grid gap-5 sm:grid-cols-2">{([
        ["tvSeconds", "TV interval (seconds)", 5, 30, 1], ["diskCacheMB", "Image cache (MB)", 64, 16384, 1],
        ["dailyBudget", "Daily analysis budget ($)", 0, 100, 0.01], ["monthlyBudget", "Monthly analysis budget ($)", 0, 1000, 0.01],
        ["dailyImages", "Maximum analyzed images per day", 1, 1000, 1],
      ] as const).map(([key, label, min, max, step]) => <label key={key} className="flex flex-col gap-2 text-sm">{label}<input type="number" className={selectClass} min={min} max={max} step={step} required value={settings[key]} onChange={event => { setSaved(false); setSettings({ ...settings, [key]: event.target.valueAsNumber }); }} /></label>)}</div>
      <div className="space-y-3 border-y py-5"><label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 size-4 accent-primary" checked={settings.visionEnabled} disabled={!available} onChange={event => { setSaved(false); setSettings({ ...settings, visionEnabled: event.target.checked }); }} /><span>Analyze meme images<p className="mt-1 text-xs leading-5 text-muted-foreground">{available ? "Sends public images and titles to OpenAI within the budgets above. Starts in shadow mode; feedback and taste stay local." : "Optional. Configure OPENAI_API_KEY in the local environment to enable image analysis. Collection works without it."}</p></span></label>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 size-4 accent-primary" checked={settings.visionInfluence} disabled={!validated} onChange={event => { setSaved(false); setSettings({ ...settings, visionInfluence: event.target.checked }); }} /><span>Use validated image scores in ranking<p className="mt-1 text-xs text-muted-foreground">{validated ? "Validation passed for the current analysis model." : "Available after a successful evaluation with human labels."}</p></span></label>
      </div>
      <div className="flex items-center gap-3"><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save settings"}</Button>{saved && <span className="text-sm text-muted-foreground" role="status">Settings saved</span>}</div>
    </form> : !error && <p className="text-sm text-muted-foreground">Loading settings…</p>}
    {stats && <section className="border-t pt-6"><h2 className="text-lg font-semibold tracking-tight">Collector health</h2><p className="mt-2 text-sm text-muted-foreground">{stats.refreshing ? "Collecting now" : "Ready"} · {stats.stored.toLocaleString()} posts collected · ${stats.vision.spending.daily.toFixed(2)} analysis today</p>{stats.lastRefreshError && <p className="mt-2 text-sm text-destructive">{stats.lastRefreshError}</p>}<ul className="mt-4 divide-y">{stats.jobs.map(job => <li key={job.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 text-sm"><span className="break-all">{job.id}</span><span className="text-muted-foreground">{job.state || "Waiting"}</span>{job.error && <p className="w-full text-xs text-destructive">{job.error}</p>}</li>)}</ul></section>}
  </div>;
}
