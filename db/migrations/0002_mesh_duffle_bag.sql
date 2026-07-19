-- Add mesh duffle bag as a standalone Sparring gear product.
-- Safe to run against an existing DB — uses INSERT OR IGNORE on product,
-- then inserts variant and inventory only if the product was just created.

INSERT OR IGNORE INTO products (slug, name, description, category, kind, fulfillment_type, special_order, active, sort_order, image)
VALUES (
  'mesh-duffle-bag',
  'Mesh duffle bag',
  'Kinney Karate mesh duffle bag. Great for carrying your gear to and from class.',
  'Sparring gear',
  'simple',
  'stocked',
  0,
  1,
  7,
  '/meshdufflebag.jpg'
);

INSERT OR IGNORE INTO variants (product_id, price_cents, active)
SELECT id, 4000, 1 FROM products WHERE slug = 'mesh-duffle-bag';

INSERT OR IGNORE INTO inventory (variant_id, on_hand)
SELECT v.id, 0
FROM variants v
JOIN products p ON p.id = v.product_id
WHERE p.slug = 'mesh-duffle-bag';
