-- Phase 5, Part 4 — returns with Shopify-style reverse pickup (seller arranges
-- courier pickup from the buyer's home; buyer never ships anything).
-- Refund is recorded only (refund_amount); actual Stripe refund deferred — see STRIPE_TODO.md.

CREATE TABLE IF NOT EXISTS returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id),
  seller_id uuid NOT NULL REFERENCES sellers(id),
  reason text NOT NULL CHECK (reason IN (
    'wrong_product', 'damaged', 'not_as_described',
    'changed_mind', 'defective', 'other'
  )),
  description text,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN (
    'requested', 'approved', 'rejected',
    'pickup_scheduled', 'picked_up',
    'received', 'refunded'
  )),
  pickup_carrier text,
  pickup_tracking_number text,
  pickup_date timestamptz,
  pickup_address jsonb,
  refund_amount numeric(10,2),
  stripe_refund_id text,
  seller_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS returns_order_id_idx ON returns(order_id);
CREATE INDEX IF NOT EXISTS returns_seller_id_idx ON returns(seller_id);

-- Per-seller return policy.
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS return_policy jsonb
  DEFAULT '{"window_days": 30, "accepts_returns": true, "return_shipping_paid_by": "seller_if_defective"}'::jsonb;

-- A returned order's earnings are cancelled (seller is not paid for it).
ALTER TABLE seller_earnings DROP CONSTRAINT IF EXISTS seller_earnings_status_check;
ALTER TABLE seller_earnings ADD CONSTRAINT seller_earnings_status_check
  CHECK (status IN ('pending', 'paid', 'cancelled'));
