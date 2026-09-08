import { proxyReddit } from "@/lib/reddit/proxy";
import { getRedditService } from "@/lib/reddit/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return proxyReddit(request, (await context.params).path, getRedditService);
}
export { handle as GET, handle as POST, handle as PATCH };
