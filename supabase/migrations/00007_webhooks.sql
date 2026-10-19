create table webhooks (
  id uuid primary key default gen_random_uuid(),
  developer_id uuid not null references developers(id) on delete cascade,
  url text not null,
  events text[] not null default '{}',
  secret text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
