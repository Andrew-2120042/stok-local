-- Webhook delivery visibility for developers (last attempt time + HTTP status).
ALTER TABLE webhooks ADD COLUMN IF NOT EXISTS last_delivered_at timestamptz;
ALTER TABLE webhooks ADD COLUMN IF NOT EXISTS last_delivery_status integer;
