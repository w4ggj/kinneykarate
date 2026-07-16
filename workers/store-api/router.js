/** Minimal URL router for Workers — no dependencies. */
export class Router {
  constructor() { this.routes = []; }

  add(method, pattern, handler) {
    const keys = [];
    const re = new RegExp(
      '^' + pattern.replace(/:([^/]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$'
    );
    this.routes.push({ method, re, keys, handler });
  }

  get(p, h) { this.add('GET', p, h); }
  post(p, h) { this.add('POST', p, h); }
  put(p, h) { this.add('PUT', p, h); }
  delete(p, h) { this.add('DELETE', p, h); }

  async handle(request, env, ctx) {
    const url = new URL(request.url);
    for (const { method, re, keys, handler } of this.routes) {
      if (request.method !== method) continue;
      const m = url.pathname.match(re);
      if (!m) continue;
      const params = Object.fromEntries(keys.map((k, i) => [k, m[i + 1]]));
      try {
        return await handler(request, env, params, ctx);
      } catch (e) {
        console.error(e);
        return new Response(JSON.stringify({ error: 'Internal server error' }), {
          status: 500, headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    });
  }
}
