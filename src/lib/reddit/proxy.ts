type Service = { origin: string };

const routes = /^(?:memes(?:\/[a-z0-9]+)?|picks|stats|status|health|settings|feed|history|refresh|events|undo|(?:feedback|reviews|seen|images|download)\/[a-z0-9]+)$/i;

export async function proxyReddit(request: Request, segments: string[], service: () => Promise<Service>): Promise<Response> {
  const endpoint = segments.join("/");
  if (!routes.test(endpoint)) return Response.json({ error: "Not found" }, { status: 404 });
  const url = new URL(request.url);
  // Next's production request URL can use localhost while the browser uses 127.0.0.1.
  // Validate the actual incoming Host before comparing its origin.
  url.host = request.headers.get("host") || url.host;
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    return Response.json({ error: "Local access only" }, { status: 403 });
  }
  const origin = request.headers.get("origin");
  if (!["GET", "HEAD"].includes(request.method) && ((origin && origin !== url.origin) || request.headers.get("sec-fetch-site") === "cross-site")) {
    return Response.json({ error: "Origin mismatch" }, { status: 403 });
  }
  try {
    const body = ["GET", "HEAD"].includes(request.method) ? undefined : await request.text();
    if (body && body.length > 16384) return Response.json({ error: "Request too large" }, { status: 413 });
    const backend = await service();
    const route = endpoint.startsWith("download/") ? `/${endpoint}` : `/api/${endpoint}`;
    const response = await fetch(`${backend.origin}${route}${url.search}`, {
      method: request.method, body, signal: request.signal, cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: request.headers.get("accept") || "application/json" },
    });
    const headers = new Headers({ "X-Content-Type-Options": "nosniff" });
    for (const key of ["content-type", "content-disposition", "cache-control"]) {
      const value = response.headers.get(key); if (value) headers.set(key, value);
    }
    if (endpoint === "events") headers.set("X-Accel-Buffering", "no");
    return new Response(response.body, { status: response.status, headers });
  } catch {
    return Response.json({ error: "The Reddit collector is unavailable. Retry in a moment; your saved collection is preserved." }, { status: 503 });
  }
}
