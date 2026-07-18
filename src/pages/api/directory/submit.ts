export const prerender = false;
import type { APIContext } from 'astro';

const CATEGORIES = [
  'Automotive','Business Support & Supplies','Computers & Electronics',
  'Construction & Contractors','Education','Entertainment','Food & Dining',
  'Health & Medicine','Home & Garden','Legal & Financial',
  'Manufacturing, Wholesale, Distribution','Merchants (Retail)',
  'Miscellaneous','Personal Care & Services','Real Estate','Sports',
  'Travel & Transportation',
];

export async function POST({ request, locals }: APIContext) {
  const env = (locals as any).runtime?.env;
  if (!env?.DB) return err('Service unavailable', 503);

  let body: any;
  try { body = await request.json(); } catch { return err('Invalid request'); }

  const { business_name, owner_name, category, description, phone, email, website, city, zip } = body ?? {};

  if (!business_name?.trim()) return err('Business name is required');
  if (!owner_name?.trim()) return err('Owner name is required');
  if (!CATEGORIES.includes(category)) return err('Invalid category');
  if (!description?.trim()) return err('Description is required');

  await env.DB.prepare(`
    INSERT INTO business_listings (business_name, owner_name, category, description, phone, email, website, city, zip)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    business_name.trim(), owner_name.trim(), category,
    description.trim(),
    (phone ?? '').trim(), (email ?? '').trim(), (website ?? '').trim(),
    (city ?? '').trim(), (zip ?? '').trim(),
  ).run();

  // Email notification to Joe via Resend (best-effort)
  if (env.RESEND_API_KEY) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'noreply@kinneykarate.com',
          to: 'jleone0@gmail.com',
          subject: `New directory listing: ${business_name.trim()}`,
          text: `New business listing submitted for review:\n\nBusiness: ${business_name.trim()}\nOwner: ${owner_name.trim()}\nCategory: ${category}\nCity: ${(city ?? '').trim()}\nPhone: ${(phone ?? '').trim()}\nEmail: ${(email ?? '').trim()}\nWebsite: ${(website ?? '').trim()}\n\nDescription:\n${description.trim()}\n\nApprove at: https://kinneykarate.com/admin`,
        }),
      });
    } catch {}
  }

  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
}

function err(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json' } });
}
