export async function postsRequest(input: string, init: RequestInit = {}): Promise<Response> {
  const signal = init.signal
    ? AbortSignal.any([init.signal, AbortSignal.timeout(20_000)])
    : AbortSignal.timeout(20_000);
  try {
    return await fetch(input, { ...init, signal });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new Error("Cannot reach X Media. Open X Media from its desktop shortcut, then try again.");
  }
}

export async function postsJson(response: Response) {
  try { return await response.json(); }
  catch { throw new Error("X Media returned an incomplete response. Try again after the app has finished starting."); }
}
