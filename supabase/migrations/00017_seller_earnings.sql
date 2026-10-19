-- Seller earnings ledger (Phase 5). One row per paid order. Substitutes for
-- real Stripe Connect payouts (deferred — see STRIPE_TODO.md): the platform
-- collects the full payment and records what each seller is owed here.

CREATE TABLE IF NOT EXISTS seller_earnings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id     uuid NOT NULL REFERENCES sellers(id),
  order_id      uuid NOT NULL REFERENCES orders(id),
  gross_amount  numeric(10,2) NOT NULL,
  platform_fee  numeric(10,2) NOT NULL,
  seller_amount numeric(10,2) NOT NULL,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- One earnings row per order (idempotent inserts on duplicate payment events).
CREATE UNIQUE INDEX IF NOT EXISTS seller_earnings_order_id_idx ON seller_earnings(order_id);
CREATE INDEX IF NOT EXISTS seller_earnings_seller_id_idx ON seller_earnings(seller_id);
