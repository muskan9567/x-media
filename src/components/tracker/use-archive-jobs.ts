"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { isActiveJob, type ArchiveJob, type ArchiveJobView } from "@/lib/tracker/archive-job-types";
type Saved = { username: string; count: number };
async function request<T>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { method: body ? "POST" : "GET", cache: "no-store", signal,
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "The local archive could not respond. Try again.");
  return data as T;
}
export function useArchiveJobs() {
  const [username, setUsername] = useState("");
  const [view, setView] = useState<ArchiveJobView | null>(null);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const recent = useRef(new Map<string, ArchiveJobView>());
  const active = view ? isActiveJob(view.job) : false;
  const remember = useCallback((next: ArchiveJobView) => {
    recent.current.delete(next.job.username);
    if (!isActiveJob(next.job) && next.result.items.length && next.result.items.length <= 5000) {
      recent.current.set(next.job.username, next);
      while (recent.current.size > 5 || [...recent.current.values()].reduce((sum, entry) => sum + entry.result.items.length, 0) > 5000) {
        recent.current.delete(recent.current.keys().next().value!);
      }
    }
    setView(next);
    setSaved((previous) => [...previous.filter((a) => a.username !== next.job.username), ...(next.result.items.length ? [{ username: next.job.username, count: next.result.items.length }] : [])]);
    try { localStorage.setItem("signaldesk.archive.job", next.job.id); } catch { /* Optional storage. */ }
  }, []);
  useEffect(() => {
    const controller = new AbortController(); const current = generation.current;
    void (async () => {
      try {
        let id: string | null = null;
        try { id = localStorage.getItem("signaldesk.archive.job"); } catch { /* Optional. */ }
        const [list, restored] = await Promise.all([
          request<{ accounts: Saved[]; jobs: ArchiveJob[]; storageError?: string }>("/api/media-archive/jobs", undefined, controller.signal),
          id ? request<ArchiveJobView>(`/api/media-archive/jobs/${id}`, undefined, controller.signal).catch(() => null) : null,
        ]);
        if (current !== generation.current) return;
        setSaved(list.accounts);
        if (list.storageError) setError(list.storageError);
        if (restored) { remember(restored); setUsername(restored.job.username); }
        else {
          id = list.jobs.find(isActiveJob)?.id ?? null;
          if (id) {
            const fallback = await request<ArchiveJobView>(`/api/media-archive/jobs/${id}`, undefined, controller.signal);
            if (current === generation.current && !controller.signal.aborted) { remember(fallback); setUsername(fallback.job.username); }
          }
        }
      } catch { if (!controller.signal.aborted && current === generation.current) setError("Could not connect to the local archive. Retry your search when the server is available."); }
    })();
    return () => controller.abort();
  }, [remember]);
  const jobId = view?.job.id;
  useEffect(() => {
    if (!jobId || !active || loading) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    let version = 0, polling = false;
    const stream = typeof EventSource === "undefined" ? null : new EventSource(`/api/media-archive/jobs/${jobId}/events`);
    const current = generation.current;
    const poll = async () => {
      if (polling || controller.signal.aborted) return;
      polling = true; const started = version;
      try {
        const next = await request<ArchiveJobView>(`/api/media-archive/jobs/${jobId}`, undefined, controller.signal);
        if (current !== generation.current || controller.signal.aborted || started !== version) return;
        remember(next); setError(null);
      } catch { if (!controller.signal.aborted && current === generation.current) setError("Connection interrupted. Your saved media remains here; reconnecting automatically."); }
      finally {
        polling = false;
        if (!controller.signal.aborted) { clearTimeout(timer); timer = setTimeout(poll, stream?.readyState === 1 ? 15000 : 2000); }
      }
    };
    if (stream) {
      stream.onmessage = (event) => {
        if (current !== generation.current || controller.signal.aborted) return;
        try {
          const next = JSON.parse(event.data) as ArchiveJobView;
          if (next.job.id !== jobId) return;
          version++; remember(next); setError(null);
          clearTimeout(timer); timer = setTimeout(poll, 15000);
        } catch { clearTimeout(timer); timer = setTimeout(poll, 500); }
      };
      stream.onerror = () => { clearTimeout(timer); timer = setTimeout(poll, 500); };
    }
    timer = setTimeout(poll, stream ? 15000 : 500);
    return () => { controller.abort(); clearTimeout(timer); stream?.close(); };
  }, [jobId, active, loading, remember]);
  async function collect(input: string, refresh = false) {
    const normalized = input.trim().replace(/^@/, "").toLowerCase();
    if (!/^[a-z0-9_]{1,15}$/.test(normalized)) { setError("Enter a valid X username using 1–15 letters, numbers, or underscores."); return; }
    const current = ++generation.current;
    const cached = !refresh ? recent.current.get(normalized) : undefined;
    setLoading(!cached); setError(null); setUsername(normalized);
    if (cached) remember({ ...cached, source: "saved", job: { ...cached.job, newItems: 0, message: "Showing your saved collection. Refresh to look for more public media." } });
    try {
      const next = await request<ArchiveJobView>("/api/media-archive/jobs", { username: normalized, refresh });
      if (current === generation.current) remember(next);
    } catch (caught) { if (current === generation.current) setError(caught instanceof Error ? caught.message : "Could not connect. Your previous collection is still available."); }
    finally { if (current === generation.current) setLoading(false); }
  }
  async function action(action: "cancel" | "retry" | "repair", postId?: string) {
    if (!view) return;
    const current = generation.current;
    const next = await request<ArchiveJobView>(`/api/media-archive/jobs/${view.job.id}`, { action, ...(postId ? { postId } : {}) });
    if (current === generation.current) remember(next);
  }
  return { username, setUsername, view, saved, error, setError, loading, active, collect, action };
}
