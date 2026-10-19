create table searches (
  id uuid primary key default gen_random_uuid(),
  developer_id uuid references developers(id),
  session_id text,
  query text not null,
  result_count integer,
  top_result_id uuid references products(id),
  latency_ms integer,
  created_at timestamptz not null default now()
);
