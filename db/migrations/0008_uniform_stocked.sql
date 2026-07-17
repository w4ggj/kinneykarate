UPDATE products SET fulfillment_type = 'stocked' WHERE slug = 'uniform';

-- Add inventory rows for uniform variants that don't have one yet
INSERT OR IGNORE INTO inventory (variant_id, on_hand)
  SELECT v.id, 0 FROM variants v
  JOIN products p ON p.id = v.product_id
  WHERE p.slug = 'uniform' AND v.active = 1;
