export const prerender = false;
import type { APIContext } from 'astro';
import { injectPdfBookmarks, parseToc } from '../../../lib/pdf-bookmarks';

function authed(cookies: APIContext['cookies']) {
  return cookies.get('kk_admin_session')?.value === 'authenticated';
}

export async function GET({ cookies, locals }: APIContext) {
  if (!authed(cookies)) return json({ error: 'Unauthorized' }, 401);
  const env = (locals as any).runtime?.env;
  if (!env?.DB) return json({ error: 'DB not available' }, 503);
  const result = await env.DB.prepare(
    'SELECT * FROM instructor_resources ORDER BY category, sort_order, created_at DESC'
  ).all();
  return json(result.results ?? []);
}
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function POST({ request, cookies, locals }: APIContext) {
  if (!authed(cookies)) return json({ error: 'Unauthorized' }, 401);

  const env = (locals as any).runtime?.env;
  if (!env?.DB) return json({ error: 'DB not available' }, 503);

  const fd = await request.formData();
  const type = fd.get('type')?.toString() ?? '';
  const title = fd.get('title')?.toString().trim() ?? '';
  const category = fd.get('category')?.toString().trim() || 'General';
  const description = fd.get('description')?.toString().trim() ?? '';
  const url = fd.get('url')?.toString().trim() || null;
  const content = fd.get('content')?.toString().trim() || null;
  const toc = fd.get('toc')?.toString().trim() || null;
  const file = fd.get('file') as File | null;

  if (!type || !title) return json({ error: 'Type and title are required' }, 400);

  let r2Key: string | null = null;
  let filename: string | null = null;

  if (file && file.size > 0) {
    if (!env.IMAGES) return json({ error: 'File storage not configured' }, 503);
    filename = file.name;
    r2Key = `instructor/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    await env.IMAGES.put(r2Key, file.stream(), {
      httpMetadata: { contentType: file.type || 'application/octet-stream' },
    });

    // Inject PDF bookmarks immediately if a TOC was submitted with the upload
    const isPdf = (file.type === 'application/pdf') || file.name.toLowerCase().endsWith('.pdf');
    if (isPdf && toc && env.IMAGES) {
      await injectPdfBookmarks(env.IMAGES, r2Key, parseToc(toc)).catch(() => {});
    }
  }

  const row = await env.DB.prepare(
    `INSERT INTO instructor_resources (title, description, type, category, url, r2_key, filename, content, toc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING id`
  ).bind(title, description, type, category, url, r2Key, filename, content, toc).first();

  return json({ ok: true, id: (row as any)?.id });
}
