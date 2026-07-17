-- Delete inventory rows for duplicate variants first (FK constraint)
DELETE FROM inventory
  WHERE variant_id IN (
    SELECT id FROM variants
    WHERE product_id = (SELECT id FROM products WHERE slug = 'uniform')
    AND id NOT IN (
      SELECT MIN(id) FROM variants
      WHERE product_id = (SELECT id FROM products WHERE slug = 'uniform')
      GROUP BY size, color
    )
  );

-- Now remove the duplicate variant rows
DELETE FROM variants
  WHERE product_id = (SELECT id FROM products WHERE slug = 'uniform')
  AND id NOT IN (
    SELECT MIN(id) FROM variants
    WHERE product_id = (SELECT id FROM products WHERE slug = 'uniform')
    GROUP BY size, color
  );

-- Fix barcode on 0000
UPDATE variants SET barcode = 'UniformSize0000'
  WHERE product_id = (SELECT id FROM products WHERE slug = 'uniform') AND size = '0000';
