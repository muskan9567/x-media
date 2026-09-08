"use client";

import { useState } from "react";
import { CheckCircle2Icon, LoaderCircleIcon, UploadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MAX_ARCHIVE_BYTES, parseArchiveFiles } from "@/lib/posts/archive-import";

export function PostsConnection({ onImported }: { onImported: (username: string) => Promise<void> }) {
  const [expanded, setExpanded] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  async function importFiles() {
    if (busy || !files.length) return;
    setBusy(true); setError(""); setNotice("");
    try {
      if (files.length > 32 || files.reduce((sum, file) => sum + file.size, 0) > MAX_ARCHIVE_BYTES) throw Error("Select up to 32 files totaling 25 MB. Include account.js with each batch.");
      const archive = parseArchiveFiles(await Promise.all(files.map(async file => ({ name: file.name, text: await file.text() }))));
      const response = await fetch("/api/posts/import", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(archive), signal: AbortSignal.timeout(90_000) });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "Could not import this archive. Your saved tweets are kept.");
      setNotice(`Archive saved for @${data.username}. ${data.posts.length.toLocaleString()} original tweets available.`);
      await onImported(data.username);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not read these archive files."); }
    finally { setBusy(false); }
  }
  return <section className="posts-free-tools" aria-label="Free collection and archive import">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-sm font-medium"><CheckCircle2Icon className="size-4 text-primary" aria-hidden />Free to use. No API key needed.</div>
      <Button variant="outline" size="sm" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-controls="posts-import"><UploadIcon aria-hidden />{expanded ? "Close import" : "Import archive"}</Button>
    </div>
    <p className="mt-2 text-sm text-muted-foreground">Find tweets shows original public posts by this account. Older posts may be missing. Import an X archive to add history for free.</p>
    {expanded && <form id="posts-import" className="posts-import" onSubmit={event => { event.preventDefault(); void importFiles(); }}>
      <p className="text-sm text-muted-foreground">For your own account, <a href="https://x.com/settings/download_your_data" target="_blank" rel="noreferrer" className="text-primary underline underline-offset-4">download your X archive</a> and unzip it. Select <strong>account.js</strong> and <strong>tweets.js</strong> together from its <strong>data</strong> folder, including any tweets-part files. You can also select an X Media JSON export.</p>
      <label htmlFor="posts-archive-files" className="mt-3 block text-sm font-medium">Archive data files</label>
      <input id="posts-archive-files" className="posts-file-input" type="file" accept=".js,.json" multiple disabled={busy} aria-describedby="posts-import-help" onChange={event => { setFiles(Array.from(event.target.files || [])); setError(""); setNotice(""); }} />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p id="posts-import-help" className="text-xs text-muted-foreground">Up to 25 MB per batch. Saved on this computer. Existing tweets are kept.</p>
        <Button type="submit" disabled={busy || !files.length}>{busy ? <LoaderCircleIcon className="motion-safe:animate-spin" aria-hidden /> : <UploadIcon aria-hidden />}{busy ? "Importing…" : "Import selected files"}</Button>
      </div>
    </form>}
    {notice && <p className="mt-3 text-sm" role="status">{notice}</p>}
    {error && <p className="mt-3 text-sm text-destructive" role="alert">{error}</p>}
  </section>;
}
