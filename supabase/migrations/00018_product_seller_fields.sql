-- Phase 5, Part 2/5 product fields.
-- deleted_at: soft delete (keeps the row so orders still reference it, but the
--   product disappears from the seller's list and from search).
-- product_quality_score: the column the dashboard/search reference. The
--   calculation + recalc logic lands in Part 5; default 50 until then.

ALTER TABLE products ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE products ADD COLUMN IF NOT EXISTS product_quality_score integer NOT NULL DEFAULT 50;

CREATE INDEX IF NOT EXISTS products_seller_active_idx ON products(seller_id) WHERE deleted_at IS NULL;
