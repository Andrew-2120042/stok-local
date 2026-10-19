create table sellers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text unique not null,
  stripe_account_id text,
  trust_score integer not null default 80,
  fulfillment_rate numeric(5,2) not null default 100.00,
  dispute_rate numeric(5,2) not null default 0.00,
  avg_delivery_days numeric(4,1) not null default 3.0,
  status text not null default 'active' check (status in ('active', 'suspended', 'pending')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
