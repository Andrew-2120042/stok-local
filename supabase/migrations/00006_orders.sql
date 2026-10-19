create table orders (
  id uuid primary key default gen_random_uuid(),
  developer_id uuid references developers(id),
  session_id text not null,
  product_id uuid not null references products(id),
  seller_id uuid not null references sellers(id),
  quantity integer not null default 1,
  unit_price numeric(10,2) not null,
  total_price numeric(10,2) not null,
  currency text not null default 'INR',
  status text not null default 'pending_payment' check (
    status in ('pending_payment', 'paid', 'processing', 'shipped', 'delivered', 'cancelled', 'returned')
  ),
  checkout_url text,
  stripe_payment_intent_id text,
  shipping_address jsonb,
  tracking_number text,
  carrier text,
  estimated_delivery date,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);
