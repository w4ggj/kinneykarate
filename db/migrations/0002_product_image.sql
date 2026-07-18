-- Migration 0002: add image column to products
ALTER TABLE products ADD COLUMN image TEXT;
