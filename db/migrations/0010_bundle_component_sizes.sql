-- Fix bundle_components size_options (were stored as [] due to seed.js bug)
UPDATE bundle_components SET size_options = '["X-Small","Small","Medium","Large","XL","XXL"]'
  WHERE bundle_product_id = (SELECT id FROM products WHERE slug = 'sparring-gear-set')
  AND component_name = 'Headgear';

UPDATE bundle_components SET size_options = '["Child Small","Child Medium","Child Large","Adult Small","Adult Medium","Adult Large","Adult X-Large","Adult XX-Large"]'
  WHERE bundle_product_id = (SELECT id FROM products WHERE slug = 'sparring-gear-set')
  AND component_name = 'Hand gear';

UPDATE bundle_components SET size_options = '["Child XS","Child S","Child M","Child L","Adult S","Adult M","Adult L","Adult XL","Adult XXL"]'
  WHERE bundle_product_id = (SELECT id FROM products WHERE slug = 'sparring-gear-set')
  AND component_name = 'Foot gear (kicks)';

UPDATE bundle_components SET size_options = '["Child","Short","Medium","Long","Extra-Long"]'
  WHERE bundle_product_id = (SELECT id FROM products WHERE slug = 'sparring-gear-set')
  AND component_name = 'Shin guards';

UPDATE bundle_components SET size_options = '["Youth","Adult"]'
  WHERE bundle_product_id = (SELECT id FROM products WHERE slug = 'sparring-gear-set')
  AND component_name = 'Mouthguard / case';
