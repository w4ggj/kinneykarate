// Helpers shared by the student and staff sides of the worker.

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MEDIA_KEY_RE = /^submissions\/[0-9a-f-]{36}\.(jpg|mp4)$/;

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

export function redirect(location) {
  return new Response(null, { status: 302, headers: { Location: location } });
}

export function sbHeaders(env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };
}

// Streams an R2 media object, honoring Range requests so videos can seek.
export async function serveMediaObject(request, env, key, cacheControl) {
  const ext = MEDIA_KEY_RE.exec(key)[1];
  const obj = await env.MEDIA.get(key, { range: request.headers });
  if (!obj) return json({ error: "Not found" }, 404);

  const headers = new Headers({
    "Content-Type": ext === "mp4" ? "video/mp4" : "image/jpeg",
    "Accept-Ranges": "bytes",
    "Cache-Control": cacheControl,
  });
  if (obj.range && request.headers.has("Range")) {
    const { suffix } = obj.range;
    const offset = typeof suffix === "number" ? obj.size - suffix : obj.range.offset ?? 0;
    const length = typeof suffix === "number" ? suffix : obj.range.length ?? obj.size - offset;
    headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    headers.set("Content-Length", String(length));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set("Content-Length", String(obj.size));
  return new Response(obj.body, { headers });
}
