-- Seller authentication + onboarding (Phase 5, Part 1).
-- sellers.stripe_account_id and sellers.updated_at already exist (00002), so
-- they are intentionally not re-added here.

ALTER TABLE sellers ADD COLUMN IF NOT EXISTS supabase_user_id text UNIQUE;
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS stripe_onboarding_complete boolean NOT NULL DEFAULT false;
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS business_type text DEFAULT 'individual'
  CHECK (business_type IN ('individual', 'company'));
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS gst_number text;
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS address jsonb;
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS logo_url text;
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS description text;

CREATE INDEX IF NOT EXISTS sellers_supabase_user_id_idx ON sellers(supabase_user_id);
