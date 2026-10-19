create table developers (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  name text not null,
  plan text not null default 'free' check (plan in ('free', 'starter', 'pro', 'enterprise')),
  created_at timestamptz not null default now()
);
