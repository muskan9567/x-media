import { apiErrorResponse } from "@/lib/api-response";
import { getArchiveJobs } from "@/lib/tracker/archive-jobs";
import { isActiveJob } from "@/lib/tracker/archive-job-types";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const manager = await getArchiveJobs();
    await manager.get(id); // Validate before sending streaming headers.
    const encoder = new TextEncoder();
    let cleanup = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false, sending = false, pending = false, previous = "";
        let unsubscribe = () => {};
        const close = () => {
          if (closed) return;
          closed = true; unsubscribe(); clearInterval(heartbeat);
          request.signal.removeEventListener("abort", close);
          try { controller.close(); } catch { /* The reader may already have cancelled. */ }
        };
        cleanup = close;
        const publish = async () => {
          if (closed) return;
          pending = true;
          if (sending) return;
          sending = true;
          try {
            while (pending && !closed) {
              pending = false;
              const view = await manager.get(id);
              if (closed) return;
              // Checkpoint-only writes don't require resending an unchanged gallery.
              const signature = JSON.stringify([view.job.status, view.job.message, view.job.postsScanned, view.job.newItems,
                view.job.retryAt, view.collectedAt, view.result.displayName, view.result.profileImageUrl]);
              if (signature !== previous) {
                if ((controller.desiredSize ?? 0) <= 0) { close(); return; } // Reconnect for the latest snapshot; never buffer unlimited galleries.
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(view)}\n\n`));
                previous = signature;
              }
              if (!isActiveJob(view.job)) close();
            }
          } catch { close(); }
          finally { sending = false; }
        };
        unsubscribe = manager.subscribe(() => { void publish(); });
        const heartbeat = setInterval(() => {
          if (!closed && (controller.desiredSize ?? 0) > 0) controller.enqueue(encoder.encode(": keepalive\n\n"));
        }, 15000);
        heartbeat.unref();
        request.signal.addEventListener("abort", close, { once: true });
        if (request.signal.aborted) close(); else void publish();
      },
      cancel() { cleanup(); },
    });
    return new Response(stream, { headers: {
      "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no", "Content-Encoding": "identity",
    } });
  } catch (error) { return apiErrorResponse(error); }
}
