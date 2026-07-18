-- Remove all duplicate uniform variants (keep lowest id per size+color combo)
DELETE FROM variants
  WHERE product_id = (SELECT id FROM products WHERE slug = 'uniform')
  AND id NOT IN (
    SELECT MIN(id) FROM variants
    WHERE product_id = (SELECT id FROM products WHERE slug = 'uniform')
    GROUP BY size, color
  );

-- Fix barcode on 0000 (was accidentally prefixed with "Barcode")
UPDATE variants SET barcode = 'UniformSize0000'
  WHERE product_id = (SELECT id FROM products WHERE slug = 'uniform') AND size = '0000';
