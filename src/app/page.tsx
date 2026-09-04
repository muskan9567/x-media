import { MediaArchiveExplorer } from "@/components/tracker/media-archive-explorer";

export const runtime = "nodejs";

export default function Home() {
  return <main><MediaArchiveExplorer /></main>;
}
