-- Migration 0001: initial schema

CREATE TABLE products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('simple','bundle')),
  fulfillment_type TEXT NOT NULL CHECK (fulfillment_type IN ('stocked','made_to_order')),
  special_order INTEGER NOT NULL DEFAULT 0,
  allow_backorders INTEGER,            -- NULL = inherit global; 0/1 = per-product override
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  sku TEXT,
  barcode TEXT,
  size TEXT,
  color TEXT,
  price_cents INTEGER,                 -- NULL = special order (instructor quotes)
  image_key TEXT,                      -- R2 object key
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE bundle_components (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bundle_product_id INTEGER NOT NULL REFERENCES products(id),
  component_name TEXT NOT NULL,        -- e.g. 'Headgear', 'Hand pads'
  size_options TEXT NOT NULL,          -- JSON array
  required INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE inventory (
  variant_id INTEGER PRIMARY KEY REFERENCES variants(id),
  on_hand INTEGER NOT NULL DEFAULT 0,
  low_stock_threshold INTEGER NOT NULL DEFAULT 2
);

CREATE TABLE inventory_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  variant_id INTEGER NOT NULL REFERENCES variants(id),
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('received','in_person_sale','online_order','correction','shrinkage')),
  source TEXT NOT NULL CHECK (source IN ('scan','online_webhook','manual')),
  order_id TEXT,
  staff TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE orders (
  id TEXT PRIMARY KEY,                 -- uuid
  stripe_session_id TEXT UNIQUE,
  stripe_payment_intent TEXT,
  student_name TEXT NOT NULL,
  location TEXT NOT NULL,
  instructor_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  subtotal_cents INTEGER NOT NULL,
  surcharge_cents INTEGER NOT NULL DEFAULT 0,
  tax_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid','in_production','ready','picked_up','canceled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders(id),
  product_id INTEGER NOT NULL,
  variant_id INTEGER,
  name_snapshot TEXT NOT NULL,
  size TEXT,
  color TEXT,
  unit_price_cents INTEGER NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  fulfillment_type TEXT NOT NULL,
  backordered INTEGER NOT NULL DEFAULT 0,
  produce_by TEXT                      -- ISO date for made-to-order + backorder lines
);

CREATE TABLE order_item_components (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_item_id INTEGER NOT NULL REFERENCES order_items(id),
  component_name TEXT NOT NULL,
  chosen_size TEXT NOT NULL
);

CREATE TABLE settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- singleton
  allow_backorders INTEGER NOT NULL DEFAULT 1,
  announcement_text TEXT,
  announcement_on INTEGER NOT NULL DEFAULT 0
);

INSERT INTO settings (id, allow_backorders, announcement_on) VALUES (1, 1, 0);

-- Indexes
CREATE INDEX idx_variants_product ON variants(product_id);
CREATE INDEX idx_bundle_components_product ON bundle_components(bundle_product_id);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_inventory_movements_variant ON inventory_movements(variant_id);
CREATE INDEX idx_inventory_movements_created ON inventory_movements(created_at);
