export const prerender = false;
import type { APIContext } from 'astro';
import { checkAdminAuth, unauthorizedResponse } from '../../../../lib/adminAuth';

const CATEGORIES = [
  'Automotive','Business Support & Supplies','Computers & Electronics',
  'Construction & Contractors','Education','Entertainment','Food & Dining',
  'Health & Medicine','Home & Garden','Legal & Financial',
  'Manufacturing, Wholesale, Distribution','Merchants (Retail)',
  'Miscellaneous','Personal Care & Services','Real Estate','Sports',
  'Technology & Software','Travel & Transportation',
];

export async function GET({ locals, cookies }: APIContext) {
  if (!checkAdminAuth(locals, cookies)) return unauthorizedResponse();
  const env = (locals as any).runtime?.env;
  if (!env?.DB) return err('No DB', 503);
  const rows = (await env.DB.prepare(
    `SELECT id, business_name, owner_name, category, description, phone, email, website, city, zip, approved, created_at
     FROM business_listings ORDER BY created_at DESC`
  ).all()).results;
  return json(rows);
}

export async function PUT({ request, locals, cookies }: APIContext) {
  if (!checkAdminAuth(locals, cookies)) return unauthorizedResponse();
  const env = (locals as any).runtime?.env;
  if (!env?.DB) return err('No DB', 503);
  const body = await request.json() as any;
  const { id, business_name, owner_name, category, description, phone, email, website, city, zip, approved } = body;
  if (!id) return err('Missing id');
  if (category && !CATEGORIES.includes(category)) return err('Invalid category');
  await env.DB.prepare(
    `UPDATE business_listings SET business_name=?, owner_name=?, category=?, description=?, phone=?, email=?, website=?, city=?, zip=?, approved=? WHERE id=?`
  ).bind(
    (business_name??'').trim(), (owner_name??'').trim(), category,
    (description??'').trim(), (phone??'').trim(), (email??'').trim(),
    (website??'').trim(), (city??'').trim(), (zip??'').trim(),
    approved ? 1 : 0, id
  ).run();
  return json({ ok: true });
}

export async function DELETE({ request, locals, cookies }: APIContext) {
  if (!checkAdminAuth(locals, cookies)) return unauthorizedResponse();
  const env = (locals as any).runtime?.env;
  if (!env?.DB) return err('No DB', 503);
  const { id } = await request.json() as any;
  if (!id) return err('Missing id');
  await env.DB.prepare(`DELETE FROM business_listings WHERE id=?`).bind(id).run();
  return json({ ok: true });
}

function json(d: any) { return new Response(JSON.stringify(d), { headers: { 'Content-Type': 'application/json' } }); }
function err(msg: string, status = 400) { return new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json' } }); }
