-- Set barcodes on existing white uniform variants
UPDATE variants SET barcode = 'BarcodeUniformSize0000'
  WHERE product_id = (SELECT id FROM products WHERE slug = 'uniform') AND size = '0000';
UPDATE variants SET barcode = 'UniformSize000'
  WHERE product_id = (SELECT id FROM products WHERE slug = 'uniform') AND size = '000';
UPDATE variants SET barcode = 'UniformSize00'
  WHERE product_id = (SELECT id FROM products WHERE slug = 'uniform') AND size = '00';
UPDATE variants SET barcode = 'UniformSize0'
  WHERE product_id = (SELECT id FROM products WHERE slug = 'uniform') AND size = '0';
UPDATE variants SET barcode = 'UniformSize1'
  WHERE product_id = (SELECT id FROM products WHERE slug = 'uniform') AND size = '1';
UPDATE variants SET barcode = 'UniformSize2'
  WHERE product_id = (SELECT id FROM products WHERE slug = 'uniform') AND size = '2';
UPDATE variants SET barcode = 'UniformSize3'
  WHERE product_id = (SELECT id FROM products WHERE slug = 'uniform') AND size = '3' AND color = 'White';
UPDATE variants SET barcode = 'UniformSize4'
  WHERE product_id = (SELECT id FROM products WHERE slug = 'uniform') AND size = '4' AND color = 'White';
UPDATE variants SET barcode = 'UniformSize5'
  WHERE product_id = (SELECT id FROM products WHERE slug = 'uniform') AND size = '5' AND color = 'White';
UPDATE variants SET barcode = 'UniformSize6'
  WHERE product_id = (SELECT id FROM products WHERE slug = 'uniform') AND size = '6';
UPDATE variants SET barcode = 'UniformSize7'
  WHERE product_id = (SELECT id FROM products WHERE slug = 'uniform') AND size = '7';

-- Insert size 0000 (White) — not in original catalog
INSERT INTO variants (product_id, barcode, size, color, price_cents, active)
  SELECT id, 'BarcodeUniformSize0000', '0000', 'White', 4000, 1 FROM products WHERE slug = 'uniform';

-- Insert colored variants (special order, no online price)
INSERT INTO variants (product_id, barcode, size, color, price_cents, active)
  SELECT id, 'UniformSize3Black', '3', 'Black', NULL, 1 FROM products WHERE slug = 'uniform';
INSERT INTO variants (product_id, barcode, size, color, price_cents, active)
  SELECT id, 'UniformSize3Blue', '3', 'Blue', NULL, 1 FROM products WHERE slug = 'uniform';
INSERT INTO variants (product_id, barcode, size, color, price_cents, active)
  SELECT id, 'UniformSize3Red', '3', 'Red', NULL, 1 FROM products WHERE slug = 'uniform';
INSERT INTO variants (product_id, barcode, size, color, price_cents, active)
  SELECT id, 'UniformSize4Black', '4', 'Black', NULL, 1 FROM products WHERE slug = 'uniform';
INSERT INTO variants (product_id, barcode, size, color, price_cents, active)
  SELECT id, 'UniformSize4Blue', '4', 'Blue', NULL, 1 FROM products WHERE slug = 'uniform';
INSERT INTO variants (product_id, barcode, size, color, price_cents, active)
  SELECT id, 'UniformSize4Red', '4', 'Red', NULL, 1 FROM products WHERE slug = 'uniform';
INSERT INTO variants (product_id, barcode, size, color, price_cents, active)
  SELECT id, 'UniformSize5Red', '5', 'Red', NULL, 1 FROM products WHERE slug = 'uniform';
