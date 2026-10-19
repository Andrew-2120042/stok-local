-- Phase 5, Part 5 — product quality score.
-- NOTE: the column was already added in 00018_product_seller_fields.sql; this is
-- idempotent (IF NOT EXISTS) and documents the column's purpose here. Quality
-- metrics are computed on demand via getProductQualityMetrics (no materialized
-- view — keeps the score exact and avoids refresh staleness).
ALTER TABLE products ADD COLUMN IF NOT EXISTS product_quality_score integer NOT NULL DEFAULT 50;

CREATE INDEX IF NOT EXISTS products_quality_score_idx ON products(product_quality_score);
