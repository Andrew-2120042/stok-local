create table api_keys (
  id uuid primary key default gen_random_uuid(),
  developer_id uuid not null references developers(id) on delete cascade,
  key_hash text unique not null,
  key_prefix text not null,
  name text not null default 'Default',
  last_used_at timestamptz,
  is_sandbox boolean not null default false,
  created_at timestamptz not null default now()
);
