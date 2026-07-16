export const prerender = false;

export async function GET({ params, locals }: { params: any; locals: any }) {
  const env = (locals as any).runtime?.env;
  if (!env?.DB) return new Response(JSON.stringify({ error: 'No DB' }), { status: 500 });

  const product = await env.DB.prepare(
    'SELECT * FROM products WHERE slug = ? AND active = 1'
  ).bind(params.slug).first();

  if (!product) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });

  const variants = (await env.DB.prepare(
    'SELECT * FROM variants WHERE product_id = ? AND active = 1'
  ).bind((product as any).id).all()).results;

  return new Response(JSON.stringify({ product, variants }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
