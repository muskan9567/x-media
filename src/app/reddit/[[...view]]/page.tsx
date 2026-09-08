import { RedditExplorer } from "@/components/reddit/reddit-explorer";
import { notFound } from "next/navigation";
export const runtime = "nodejs";
export const metadata = { title: "Reddit memes" };

export default async function RedditPage({ params }: { params: Promise<{ view?: string[] }> }) {
  const { view } = await params;
  const selected = view?.[0] || "explore";
  if ((view?.length || 0) > 1 || !["explore", "picks", "saved", "review", "tv", "settings"].includes(selected)) notFound();
  return <main><RedditExplorer key={selected} view={selected} /></main>;
}
