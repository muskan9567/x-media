"use client";
/* eslint-disable @next/next/no-img-element -- Saved Reddit originals and public X previews use the existing media pipeline. */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon, ArrowUpRightIcon, DownloadIcon, FolderIcon, FolderPlusIcon, PencilIcon, RefreshCwIcon, SearchIcon, Trash2Icon, XIcon } from "lucide-react";
import { MediaHeader } from "@/components/tracker/media-header";
import { PostMedia } from "@/components/tracker/post-media";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import type { FolderDetail, FolderList, FolderMedia, FolderSummary } from "@/lib/folders/types";
import { FolderPicker, foldersApi } from "./folder-picker";

function Preview({ item }: { item: FolderMedia }) {
  const [failed, setFailed] = useState(false);
  return failed || !item.previewUrl ? <span className="grid size-full place-items-center text-sm text-muted-foreground">Preview unavailable</span> : <img src={item.previewUrl} alt={item.title} loading="lazy" decoding="async" referrerPolicy="no-referrer" className={`size-full ${item.reference.source === "reddit" ? "object-contain" : "object-cover"}`} onError={() => setFailed(true)} />;
}
function FolderViewer({ item, onSaved }: { item: FolderMedia; onSaved: () => void }) {
  const [attempt, setAttempt] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const reference = item.reference;
  async function repair() {
    if (reference.source !== "x" || !item.archive) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/media-archive/jobs/${reference.jobId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "repair", postId: item.archive.postId }) });
      if (!response.ok) throw new Error((await response.json()).error || "Could not refresh this video.");
      setAttempt(value => value + 1);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <>
    <SheetHeader className="pr-14"><SheetTitle className="break-words">{item.title}</SheetTitle><SheetDescription>{item.creator} · {reference.source === "reddit" ? "Reddit" : "X"}</SheetDescription></SheetHeader>
    <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-5">
      {reference.source === "x" && item.archive ? <PostMedia key={attempt} media={[item.archive.media]} detail videoUrlOverride={item.type !== "photo" ? `/api/media-archive/jobs/${reference.jobId}/video?item=${encodeURIComponent(reference.id)}&attempt=${attempt}` : undefined} onPlaybackError={() => setError("This video could not play. Refresh its link or open the original post.")} /> : <img src={item.previewUrl} alt={item.title} className="max-h-[65dvh] w-full rounded-xl bg-muted object-contain" onError={() => setError("This image is unavailable. Open the original post.")} />}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <FolderPicker media={reference} onSaved={onSaved} />
        {item.type !== "photo" && <Button variant="outline" disabled={busy} onClick={() => void repair()}><RefreshCwIcon className={busy ? "animate-spin" : ""} aria-hidden />{busy ? "Refreshing…" : "Refresh video link"}</Button>}
        {reference.source === "reddit" && <Button variant="outline" nativeButton={false} role="link" render={<a href={`${item.previewUrl}?download=1`} download />}><DownloadIcon aria-hidden />Download original</Button>}
        <Button variant="outline" nativeButton={false} role="link" render={<a href={item.postUrl} target="_blank" rel="noopener noreferrer" />}>Open original post<ArrowUpRightIcon aria-hidden /></Button>
      </div>
      {error && <p className="mt-4 text-sm text-destructive" role="alert">{error}</p>}
    </div>
  </>;
}

export function FoldersExplorer({ folderId }: { folderId?: string }) {
  const router = useRouter();
  const [folders, setFolders] = useState<FolderSummary[]>([]), [detail, setDetail] = useState<FolderDetail | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [query, setQuery] = useState(""), [source, setSource] = useState("all"), [limit, setLimit] = useState(60);
  const [dialog, setDialog] = useState<"create" | "rename" | "delete" | null>(null), [name, setName] = useState(""), [dialogError, setDialogError] = useState("");
  const [selected, setSelected] = useState<FolderMedia | null>(null), [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      if (folderId) setDetail(await foldersApi<FolderDetail>(`/${folderId}`));
      else setFolders((await foldersApi<FolderList>()).folders);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [folderId]);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);
  function openDialog(value: typeof dialog) { setDialog(value); setName(value === "rename" ? detail?.folder.name ?? "" : ""); setDialogError(""); }
  async function submit() {
    setBusy(true); setDialogError("");
    try {
      if (dialog === "delete") { await foldersApi(`/${folderId}`, "DELETE"); router.push("/folders"); return; }
      const folder = await foldersApi<FolderSummary>(dialog === "rename" ? `/${folderId}` : "", dialog === "rename" ? "PATCH" : "POST", { name });
      setDialog(null); setNotice(dialog === "rename" ? "Folder renamed." : `Created ${folder.name}.`); await load();
    } catch (e) { setDialogError((e as Error).message); } finally { setBusy(false); }
  }
  async function remove(item: FolderMedia) {
    setBusy(true); setError("");
    try { await foldersApi(`/${folderId}/items/${encodeURIComponent(item.key)}`, "DELETE"); setNotice("Removed from this folder."); await load(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const items = (detail?.items ?? []).filter(item => (source === "all" || item.reference.source === source) && `${item.title} ${item.creator}`.toLowerCase().includes(query.trim().toLowerCase()));
  const matchingFolders = folders.filter(folder => folder.name.toLowerCase().includes(query.trim().toLowerCase()));
  function saved() { setNotice("Folder placements saved."); void load(); }
  return <div className="min-h-screen bg-background">
    <MediaHeader source="folders" />
    <main className="mx-auto max-w-7xl px-4 pt-10 pb-16 sm:px-6 sm:pt-14 lg:px-8">
      {folderId && <Button className="mb-5" variant="ghost" size="sm" nativeButton={false} role="link" render={<Link href="/folders" />}><ArrowLeftIcon aria-hidden />All folders</Button>}
      <div className="flex flex-col items-start justify-between gap-4 border-b pb-6 sm:flex-row">
        <div className="min-w-0 flex-1"><h1 className="break-words text-3xl font-semibold tracking-tight sm:text-4xl">{folderId ? detail?.folder.name ?? "Folder" : "Your folders"}</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">{folderId ? "Your collected media, ready when you need it." : "Keep X media and Reddit memes organized together."}</p></div>
        <div className="flex shrink-0 flex-wrap gap-2">{folderId ? <><Button variant="outline" disabled={!detail || loading} onClick={() => openDialog("rename")}><PencilIcon aria-hidden />Rename</Button><Button variant="ghost" disabled={!detail || loading} onClick={() => openDialog("delete")}><Trash2Icon aria-hidden />Delete</Button></> : <Button onClick={() => openDialog("create")}><FolderPlusIcon aria-hidden />New folder</Button>}</div>
      </div>
      {notice && <div className="mt-4 flex items-center gap-2 text-sm" role="status">{notice}<Button variant="ghost" size="icon-sm" aria-label="Dismiss notification" onClick={() => setNotice("")}><XIcon aria-hidden /></Button></div>}
      {error && <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 p-4 text-sm text-destructive" role="alert">{error}<Button variant="outline" onClick={() => void load()}>Retry</Button></div>}
      <div className="mt-6 flex flex-wrap items-center gap-2" role="search" aria-label={folderId ? "Search folder media" : "Search folders"}>
        <InputGroup className="h-9 w-full bg-card sm:w-80"><InputGroupAddon><SearchIcon aria-hidden /></InputGroupAddon><InputGroupInput value={query} onChange={event => { setQuery(event.target.value); setLimit(60); }} aria-label={folderId ? "Search folder media" : "Search folders"} placeholder={folderId ? "Search titles or creators" : "Search folders"} /></InputGroup>
        {folderId && <select aria-label="Media source" className="h-9 rounded-lg border border-input bg-card px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring" value={source} onChange={event => { setSource(event.target.value); setLimit(60); }}><option value="all">All sources</option><option value="x">X</option><option value="reddit">Reddit</option></select>}
        <span className="text-sm text-muted-foreground sm:ml-auto" role="status">{loading ? "Loading…" : folderId ? `${items.length} ${items.length === 1 ? "item" : "items"}` : `${matchingFolders.length} ${matchingFolders.length === 1 ? "folder" : "folders"}`}</span>
      </div>
      {folderId ? <>
        {items.length > 0 && <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{items.slice(0, limit).map(item => <article key={item.key} className="overflow-hidden rounded-xl border bg-card shadow-xs">
          <button type="button" onClick={() => setSelected(item)} aria-label={`View ${item.title}`} className="relative block aspect-[4/3] w-full overflow-hidden bg-muted text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"><Preview item={item} /><span className="absolute right-2 bottom-2 rounded-md border border-white/15 bg-black/75 px-2 py-1 text-xs text-white">{item.type === "photo" ? "Photo" : item.type === "video" ? "Video" : "GIF"}</span></button>
          <div className="space-y-2 p-3"><p className="line-clamp-2 min-h-10 text-sm leading-5">{item.title}</p><p className="truncate text-xs text-muted-foreground">{item.creator} · {item.reference.source === "reddit" ? "Reddit" : "X"}</p><div className="flex items-center justify-between gap-2"><FolderPicker media={item.reference} onSaved={saved} /><Button variant="ghost" size="icon-sm" aria-label={`Remove ${item.title} from this folder`} disabled={busy} onClick={() => void remove(item)}><XIcon aria-hidden /></Button></div></div>
        </article>)}</div>}
        {items.length > limit && <div className="mt-8 text-center"><Button variant="outline" onClick={() => setLimit(value => value + 60)}>Load more</Button></div>}
      </> : matchingFolders.length > 0 && <div className="mt-5 divide-y rounded-xl border bg-card">{matchingFolders.map(folder => <Link key={folder.id} href={`/folders/${folder.id}`} className="flex items-center gap-4 px-4 py-5 first:rounded-t-xl last:rounded-b-xl hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"><FolderIcon className="size-6 shrink-0 text-blue-600 dark:text-blue-400" aria-hidden /><span className="min-w-0 flex-1 break-words font-medium">{folder.name}</span><span className="shrink-0 text-sm tabular-nums text-muted-foreground">{folder.count} {folder.count === 1 ? "item" : "items"}</span></Link>)}</div>}
      {!loading && !error && (folderId ? !items.length : !matchingFolders.length) && <div className="mt-6 rounded-xl border border-dashed px-5 py-14 text-center"><FolderIcon className="mx-auto size-8 text-muted-foreground" aria-hidden /><h2 className="mt-4 font-medium">{query || source !== "all" ? "No matches found" : folderId ? "This folder is ready for media" : "A place for every collection"}</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">{query || source !== "all" ? "Try another search or clear your filters." : "Use the Folders button on any X attachment or Reddit meme to place it here."}</p><div className="mt-5 flex flex-wrap justify-center gap-2">{query || source !== "all" ? <Button variant="outline" onClick={() => { setQuery(""); setSource("all"); }}>Clear filters</Button> : <><Button variant="outline" nativeButton={false} role="link" render={<Link href="/" />}>Browse X media</Button><Button variant="outline" nativeButton={false} role="link" render={<Link href="/reddit" />}>Browse Reddit</Button></>}</div></div>}
    </main>
    <Dialog open={dialog !== null} onOpenChange={open => { if (!open && !busy) setDialog(null); }}><DialogContent>
      <DialogHeader className="pr-8"><DialogTitle>{dialog === "delete" ? "Delete this folder?" : dialog === "rename" ? "Rename folder" : "New folder"}</DialogTitle><DialogDescription>{dialog === "delete" ? "This removes the folder. Your source media and other folders are kept." : "Give this collection a name that is easy to find later."}</DialogDescription></DialogHeader>
      <form onSubmit={event => { event.preventDefault(); void submit(); }} className="space-y-4">
        {dialog !== "delete" && <label className="block space-y-2 text-sm"><span>Folder name</span><Input autoFocus className="h-9" value={name} onChange={event => setName(event.target.value)} maxLength={80} required disabled={busy} placeholder="e.g. Coding memes" /></label>}
        {dialogError && <p role="alert" className="text-sm text-destructive">{dialogError}</p>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setDialog(null)}>Cancel</Button><Button type="submit" variant={dialog === "delete" ? "destructive" : "default"} disabled={busy || (dialog !== "delete" && !name.trim())}>{busy ? "Saving…" : dialog === "delete" ? "Delete folder" : dialog === "rename" ? "Save name" : "Create folder"}</Button></DialogFooter>
      </form>
    </DialogContent></Dialog>
    <Sheet open={selected !== null} onOpenChange={open => { if (!open) setSelected(null); }}><SheetContent className="overflow-hidden data-[side=right]:w-full data-[side=right]:sm:max-w-3xl">{selected && <FolderViewer key={selected.key} item={selected} onSaved={saved} />}</SheetContent></Sheet>
  </div>;
}
