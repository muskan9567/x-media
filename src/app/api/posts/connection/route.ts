export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
export async function GET() {
  return Response.json({ configured: true, source: "timeline", free: true }, { headers });
}
export async function POST() {
  return Response.json({ error: "Tweets now uses free public collection. No API connection is needed; reload the Tweets page." }, { status: 410, headers });
}
