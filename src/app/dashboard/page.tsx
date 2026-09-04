import type { Metadata } from "next";

import { TrackerDashboard } from "@/components/tracker/tracker-dashboard";
import { getTrackerSnapshot } from "@/lib/tracker/service";

export const metadata: Metadata = { title: "Dashboard" };
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const snapshot = await getTrackerSnapshot();
  // Serialize the request timestamp so hydration uses the same value.
  // eslint-disable-next-line react-hooks/purity
  const initialNow = Date.now();
  return <TrackerDashboard initialSnapshot={snapshot} initialNow={initialNow} />;
}
