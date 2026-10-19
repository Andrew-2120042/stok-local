create table products (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references sellers(id) on delete cascade,
  name text not null,
  brand text not null,
  category text not null,
  description text not null,
  specs jsonb not null default '{}',
  images text[] not null default '{}',
  price numeric(10,2) not null,
  currency text not null default 'INR',
  stock integer not null default 0,
  availability text not null default 'in_stock' check (availability in ('in_stock', 'out_of_stock', 'discontinued')),
  embedding vector(1536),
  search_vector tsvector generated always as (
    to_tsvector('english', name || ' ' || brand || ' ' || description)
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- HNSW index for fast approximate nearest-neighbour vector search
create index products_embedding_idx on products
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- GIN index for full-text keyword search
create index products_search_vector_idx on products
  using gin (search_vector);

create index products_seller_id_idx on products(seller_id);
create index products_category_idx on products(category);
