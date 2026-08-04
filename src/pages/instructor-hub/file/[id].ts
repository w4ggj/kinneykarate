export const prerender = false;
import type { APIContext } from 'astro';

export async function GET({ params, cookies, locals }: APIContext) {
  if (cookies.get('kk_instructor_session')?.value !== 'authenticated') {
    return new Response('Unauthorized', { status: 401 });
  }

  const env = (locals as any).runtime?.env;
  const id = params.id;
  if (!env?.DB || !id) return new Response('Not found', { status: 404 });

  const row: any = await env.DB.prepare(
    'SELECT r2_key, filename, type FROM instructor_resources WHERE id = ? AND active = 1'
  ).bind(id).first();

  if (!row?.r2_key) return new Response('Not found', { status: 404 });

  if (!env.IMAGES) return new Response('Storage not configured', { status: 503 });

  const obj = await env.IMAGES.get(row.r2_key);
  if (!obj) return new Response('File not found', { status: 404 });

  const contentType = obj.httpMetadata?.contentType ?? 'application/octet-stream';
  const disposition = row.filename
    ? `attachment; filename="${row.filename}"`
    : 'attachment';

  return new Response(obj.body as BodyInit, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': disposition,
    },
  });
}
