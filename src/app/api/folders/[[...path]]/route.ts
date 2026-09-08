import { foldersRequest } from "@/lib/folders/api";
import { getFolders } from "@/lib/folders/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path?: string[] }> };
async function handle(request: Request, context: Context) { return foldersRequest(request, (await context.params).path ?? [], getFolders()); }
export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
