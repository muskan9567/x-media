"use client";

/* THESIS: Search one public account, then inspect its saved writing through four fast views.
 * OWN-WORLD: X Media's warm neutral surfaces, Geist, compact blue actions, and readable rows.
 * STORY: Find an account, watch tweets arrive, select a category, inspect or copy a useful post.
 * FIRST VIEWPORT: Shared header; title and username search; saved accounts; compact profile and controls; category tabs and text-first results.
 * FORM: User-specified search and category flow, inherited established design system; code-led extension, no visual-world seed.
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDownWideNarrowIcon, ArrowRightIcon, ArrowUpIcon, Clock3Icon, FlameIcon, LoaderCircleIcon, PauseIcon, RefreshCwIcon, SearchIcon, SlidersHorizontalIcon, ZapIcon } from "lucide-react";
import { MediaHeader } from "@/components/tracker/media-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { activeAccount, defaultFilters, selectPosts, type PostCategory, type PostFilters } from "@/lib/posts/types";
import { PostCard, formatCount, postDate } from "./post-card";
import { usePosts } from "./use-posts";
import { PostsConnection } from "./posts-connection";
import "./posts.css";

const categories = [
  { id: "popular", label: "Most popular", icon: FlameIcon },
  { id: "recent", label: "Recent", icon: Clock3Icon },
  { id: "oldest", label: "Oldest", icon: ArrowUpIcon },
  { id: "short", label: "Short bangers", icon: ZapIcon },
] as const;
const descriptions: Record<PostCategory, string> = {
  popular: "The biggest hits among this account's original tweets.", recent: "Newest original tweets first.",
  oldest: "Earliest saved tweets first. Archive progress is shown above.", short: "Short, standalone text tweets with likes. Replies, quotes, and media stay out.",
};
function Results({ view, loading, search }: Pick<ReturnType<typeof usePosts>, "view" | "loading" | "search">) {
  const [filters, setFilters] = useState<PostFilters>(defaultFilters);
  const [limit, setLimit] = useState(30), [advanced, setAdvanced] = useState(false);
  const posts = useMemo(() => selectPosts(view?.posts || [], filters), [view?.posts, filters]);
  function update(next: Partial<PostFilters>) { setFilters(previous => ({ ...previous, ...next })); setLimit(30); }
  if (!view) return null;
  const active = activeAccount(view), profile = view.profile;
  const hasFilters = filters.keyword || filters.days || filters.minLikes || filters.maxLength !== 140;
  const dateRange = view.posts.length ? `${postDate(view.posts.at(-1)!.createdAt)} – ${postDate(view.posts[0].createdAt)}` : "";
  return <>
    <section className="posts-profile" aria-label="Account and collection">
      <div className="flex min-w-0 items-center gap-3">
        {profile?.avatar ?
          // eslint-disable-next-line @next/next/no-img-element
          <img className="size-12 shrink-0 rounded-full border object-cover" src={profile.avatar} alt="" /> :
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full border bg-muted text-lg font-semibold" aria-hidden>{view.username[0].toUpperCase()}</span>}
        <div className="min-w-0"><h2 className="break-words text-lg font-semibold tracking-tight">{profile?.name || `@${view.username}`}</h2>
          <p className="text-sm text-muted-foreground">@{view.username}{profile?.followers != null && <> · {formatCount(profile.followers)} followers</>}</p></div>
      </div>
      {profile?.bio && <p className="posts-bio">{profile.bio}</p>}
      <div className="posts-collection-meta">
        <p><strong>{view.posts.length.toLocaleString()}</strong> original tweets{dateRange && <span className="block pt-1 text-xs text-muted-foreground">{dateRange}</span>}</p>
        <div className="flex flex-wrap gap-2">
          {active ? <Button variant="outline" disabled={loading} onClick={() => void search(view.username, "stop")}><PauseIcon aria-hidden />Stop collection</Button> : <>
            {view.canContinue && <Button variant="outline" disabled={loading} onClick={() => void search(view.username, "continue")}><ArrowDownWideNarrowIcon aria-hidden />{view.pages ? "Continue older posts" : "Collect tweets"}</Button>}
            <Button variant="outline" disabled={loading} onClick={() => void search(view.username, "refresh")}><RefreshCwIcon aria-hidden />Refresh latest</Button>
          </>}
          {profile && view.posts.length > 0 && <a className="posts-export" href={`/api/posts/export?username=${encodeURIComponent(view.username)}`} download>Export JSON</a>}
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Available public tweets · No API charges. Full account history is not guaranteed.{view.importedAt && <> Archive imported {postDate(view.importedAt)}.</>}{profile?.reportedPosts != null && <> The source reports {profile.reportedPosts.toLocaleString()} total posts for this account, including reposts.</>}</p>
      <div className={`posts-progress ${view.status === "failed" || view.status === "unavailable" ? "text-destructive" : "text-muted-foreground"}`} role="status" aria-live="polite">
        {active && <LoaderCircleIcon className="size-3.5 shrink-0 motion-safe:animate-spin" aria-hidden />}
        <span>{view.message}{view.retryAt && <> Retry after {new Date(view.retryAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.</>}</span>
      </div>
    </section>
    <section aria-label="Collected tweets" className="posts-results">
      <div className="posts-categories" role="group" aria-label="Tweet category">
        {categories.map(({ id, label, icon: Icon }) => <button type="button" key={id} onClick={() => update({ category: id })} aria-pressed={filters.category === id} className="posts-category"><Icon aria-hidden /><span>{label}</span></button>)}
      </div>
      <div className="posts-filter-row">
        <label className="posts-keyword"><SearchIcon className="size-4 text-muted-foreground" aria-hidden /><input type="search" aria-label="Search within tweets" placeholder="Search within these tweets…" value={filters.keyword} onChange={e => update({ keyword: e.target.value })} /></label>
        <label className="posts-control"><span>Period</span><select aria-label="Date range" value={filters.days} onChange={e => update({ days: Number(e.target.value) })}><option value={0}>All collected</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value={365}>Last year</option></select></label>
        <Button aria-label="Filters" variant={advanced ? "secondary" : "outline"} onClick={() => setAdvanced(!advanced)} aria-expanded={advanced} aria-controls="post-extra-filters"><SlidersHorizontalIcon aria-hidden />Filters{hasFilters ? <span className="size-1.5 rounded-full bg-primary" aria-label="Filters applied" /> : null}</Button>
      </div>
      {(filters.category === "short" || filters.category === "popular") && <div className="posts-ranking-controls">
        {filters.category === "short" ? <label className="posts-control"><span>Maximum length</span><select aria-label="Maximum tweet length" value={filters.maxLength} onChange={e => update({ maxLength: Number(e.target.value) })}><option value={80}>80 characters</option><option value={140}>140 characters</option><option value={280}>280 characters</option></select></label> :
          <label className="posts-control"><span>Rank by</span><select aria-label="Popularity metric" value={filters.metric} onChange={e => update({ metric: e.target.value as PostFilters["metric"] })}><option value="likes">Likes</option><option value="reposts">Reposts</option><option value="views">Views</option></select></label>}
        <label className="posts-control"><span>Minimum likes</span><input aria-label="Minimum likes" type="number" min={0} max={1000000000} step={1} value={filters.minLikes} onChange={e => update({ minLikes: Math.max(0, Math.min(1e9, Number(e.target.value) || 0)) })} /></label>
      </div>}
      {advanced && <div id="post-extra-filters" className="posts-extra-filters">
        <p className="text-sm text-muted-foreground">Original tweets only. Replies, reposts, and quote posts are excluded.</p>
        {filters.category !== "short" && filters.category !== "popular" && <label className="posts-control"><span>Minimum likes</span><input aria-label="Minimum likes" type="number" min={0} value={filters.minLikes} onChange={e => update({ minLikes: Math.max(0, Math.min(1e9, Number(e.target.value) || 0)) })} /></label>}
        <Button variant="ghost" onClick={() => { setFilters({ ...defaultFilters, category: filters.category }); setLimit(30); }}>Reset filters</Button>
      </div>}
      <div className="posts-results-heading"><div><h3 className="font-semibold">{categories.find(c => c.id === filters.category)!.label}<span className="ml-2 text-sm font-normal text-muted-foreground">{posts.length.toLocaleString()}</span></h3><p className="mt-1 text-xs text-muted-foreground">{descriptions[filters.category]}</p></div>
        <span className="hidden text-xs text-muted-foreground sm:inline">{view.fetchedAt ? `Updated ${postDate(view.fetchedAt)}` : "Waiting for results"}</span>
      </div>
      {posts.length ? <div className="posts-list">{posts.slice(0, limit).map((post, index) => <PostCard key={post.id} post={post} rank={index + 1} short={filters.category === "short"} />)}</div> :
        <div className="posts-empty-results">
          {active && !view.posts.length ? <><LoaderCircleIcon className="mx-auto mb-4 size-6 motion-safe:animate-spin text-primary" aria-hidden /><h3>Collecting the first tweets…</h3><p>You can switch categories while the timeline loads.</p></> : view.posts.length ? <><SearchIcon className="mx-auto mb-4 size-6 text-muted-foreground" aria-hidden /><h3>No tweets match this view</h3><p>{filters.category === "short" ? "Try a longer maximum length, fewer required likes, or collect more history." : "Try another keyword, date range, or minimum likes."}</p>{hasFilters ? <Button className="mt-4" variant="outline" onClick={() => { setFilters({ ...defaultFilters, category: filters.category }); setLimit(30); }}>Clear filters</Button> : null}</> : <><h3>{view.status === "unavailable" ? "This account is unavailable" : view.status === "failed" ? "Collection could not finish" : "No original tweets collected yet"}</h3><p>{view.status === "unavailable" ? "Check the username, search another account, or try again later." : "Only standalone tweets appear here. Replies, reposts, and quote posts are excluded. Try collecting more tweets."}</p></>}
        </div>}
      {posts.length > limit && <div className="py-6 text-center"><Button variant="outline" onClick={() => setLimit(previous => previous + 30)}>Show 30 more<span className="text-muted-foreground">({(posts.length - limit).toLocaleString()} remaining)</span></Button></div>}
      {!!posts.length && <p className="posts-coverage">Rankings cover {view.posts.length.toLocaleString()} original tweets by this account. Replies, reposts, and quote posts are excluded. Counts reflect when each tweet was fetched.</p>}
    </section>
  </>;
}

export function PostsExplorer() {
  const state = usePosts();
  return <div className="posts-page"><MediaHeader source="posts" />
    <main className="posts-shell">
      <div className="posts-intro"><div><h1>Find their best tweets.</h1><p>Original tweets by this account. No replies, reposts, or quote posts.</p></div><span className="posts-local-note">Your searches stay saved here.</span></div>
      <form className="posts-search" onSubmit={event => { event.preventDefault(); void state.search(state.username); }}>
        <div className="relative min-w-0 flex-1"><span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-muted-foreground" aria-hidden>@</span><Input className="h-12 pl-10 text-base" aria-label="X username or profile link" placeholder="Username or X profile link" value={state.username} onChange={e => state.setUsername(e.target.value)} autoComplete="off" spellCheck={false} maxLength={300} /></div>
        <Button type="submit" className="h-12 px-5" disabled={!state.username.trim() || state.loading}>{state.loading ? <LoaderCircleIcon className="motion-safe:animate-spin" aria-hidden /> : <SearchIcon aria-hidden />}<span>Find tweets</span></Button>
      </form>
      <PostsConnection onImported={async username => { await state.search(username); }} />
      {(state.error || state.connectionError) && <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm" role="alert"><p className="text-destructive">{state.error || `${state.connectionError} Reconnecting automatically.${state.view?.posts.length ? " Your displayed tweets are still available." : ""}`}</p><Button variant="outline" size="sm" onClick={() => window.location.reload()}><RefreshCwIcon aria-hidden />Reconnect</Button></div>}
      {!!state.saved.length && <nav aria-label="Saved tweet accounts" className="posts-saved"><span>Saved</span>{state.saved.map(account => <button type="button" key={account.username} aria-current={state.view?.username === account.username ? "true" : undefined} onClick={() => { state.setUsername(account.username); void state.search(account.username); }}>@{account.username}<span>{account.count.toLocaleString()}</span></button>)}</nav>}
      {state.view ? <Results key={state.view.username} view={state.view} loading={state.loading} search={state.search} /> : state.loading ? <div className="posts-start"><LoaderCircleIcon className="mx-auto mb-4 size-7 text-primary motion-safe:animate-spin" aria-hidden /><h2>Opening this timeline…</h2><p>Results will appear as each page is collected.</p></div> :
        <div className="posts-start"><div className="posts-start-mark"><SearchIcon aria-hidden /></div><h2>One account. Every angle.</h2><p>Enter a public username to find its available tweets.<br className="hidden sm:block" /> Search, rank, and copy them here, or import an archive.</p><div className="posts-start-categories">{categories.map(({ id, label, icon: Icon }) => <span key={id}><Icon aria-hidden />{label}</span>)}</div><p className="posts-start-footnote">Free public collection · Saved on this computer</p><Link href="/" className="mt-4 inline-flex items-center gap-1 text-xs text-primary underline underline-offset-4">Looking for photos and videos?<ArrowRightIcon className="size-3" aria-hidden /></Link></div>}
    </main>
  </div>;
}
