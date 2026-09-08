"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { activeAccount, handleSchema, type AccountSummary, type PostsView } from "@/lib/posts/types";
import { postsJson, postsRequest } from "./posts-request";

const selectionKey = "x-media.posts.last-account";
export function usePosts() {
  const [username, setUsername] = useState("");
  const [view, setView] = useState<PostsView | null>(null);
  const [saved, setSaved] = useState<AccountSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const generation = useRef(0), controller = useRef<AbortController | null>(null), latest = useRef<PostsView | null>(null);
  const accept = useCallback((next: PostsView) => {
    if (latest.current?.username === next.username && latest.current.revision > next.revision) return;
    latest.current = next; setView(next);
    setSaved(previous => [{ username: next.username, name: next.profile?.name || next.username, count: next.posts.length, status: next.status, fetchedAt: next.fetchedAt }, ...previous.filter(a => a.username !== next.username)]);
  }, []);
  const search = useCallback(async (value: string, action: "open" | "continue" | "refresh" | "collect" | "stop" = "open") => {
    const parsed = handleSchema.safeParse(value);
    if (!parsed.success) { setError("Enter a username, @handle, or X profile link (1–15 letters, numbers, or underscores)."); return; }
    const current = ++generation.current;
    controller.current?.abort(); const requestController = new AbortController(); controller.current = requestController;
    setLoading(true); setError(""); setConnectionError("");
    if (latest.current?.username !== parsed.data) { latest.current = null; setView(null); }
    try {
      const response = await postsRequest("/api/posts", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: parsed.data, action }), signal: requestController.signal });
      const result = await postsJson(response);
      if (!response.ok) throw new Error(result.error || "Could not open this account. Try again.");
      if (current !== generation.current) return;
      accept(result); setUsername(parsed.data);
      try { localStorage.setItem(selectionKey, parsed.data); } catch { /* Storage may be disabled. */ }
      const url = new URL(window.location.href); url.searchParams.set("user", parsed.data); window.history.replaceState(null, "", url);
    } catch (failure) {
      if (current === generation.current && !requestController.signal.aborted) setError(failure instanceof Error ? failure.message : "Could not connect. Try again.");
    } finally { if (current === generation.current) setLoading(false); }
  }, [accept]);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined, attempts = 0;
    const bootstrapController = new AbortController();
    const startGeneration = generation.current;
    const restore = async () => {
      try {
        const response = await postsRequest("/api/posts", { cache: "no-store", signal: bootstrapController.signal });
        const data = await postsJson(response);
        if (!response.ok) throw new Error(data.error || "Could not load saved accounts.");
        if (disposed || generation.current !== startGeneration) return;
        setSaved(data.accounts);
        setConnectionError("");
        let last = new URL(window.location.href).searchParams.get("user");
        if (!last) { try { last = localStorage.getItem(selectionKey); } catch { /* Optional. */ } }
        if (last && handleSchema.safeParse(last).success) await search(last);
      } catch (failure) {
        if (!disposed && generation.current === startGeneration) {
          setConnectionError(failure instanceof Error ? failure.message : "Could not load saved accounts.");
          timer = setTimeout(() => void restore(), Math.min(1500 * 2 ** attempts++, 15_000));
        }
      }
    };
    void restore();
    return () => { disposed = true; clearTimeout(timer); bootstrapController.abort(); controller.current?.abort(); };
  }, [search]);
  const selected = view?.username;
  useEffect(() => {
    if (!selected) return;
    const pollingController = new AbortController(); let timer: ReturnType<typeof setTimeout>; let etag = "";
    const poll = async () => {
      const current = generation.current;
      try {
        const response = await postsRequest(`/api/posts?username=${encodeURIComponent(selected)}`, {
          cache: "no-store", signal: pollingController.signal, headers: etag ? { "If-None-Match": etag } : {},
        });
        if (response.status !== 304) {
          const result = await postsJson(response);
          if (!response.ok) throw new Error(result.error || "Could not update collection progress.");
          if (current === generation.current && !pollingController.signal.aborted) { etag = response.headers.get("etag") || ""; accept(result); }
        }
        if (current === generation.current && !pollingController.signal.aborted) setConnectionError("");
      } catch (failure) {
        if (!pollingController.signal.aborted && current === generation.current) setConnectionError(failure instanceof Error ? failure.message : "Connection interrupted. Reconnecting…");
      } finally {
        if (!pollingController.signal.aborted) timer = setTimeout(() => void poll(), latest.current && activeAccount(latest.current) ? 1500 : 10_000);
      }
    };
    timer = setTimeout(() => void poll(), 500);
    return () => { pollingController.abort(); clearTimeout(timer); };
  }, [selected, accept]);
  return { username, setUsername, view, saved, loading, error, connectionError, search };
}
