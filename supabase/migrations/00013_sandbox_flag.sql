alter table products add column if not exists is_sandbox boolean not null default false;
alter table orders   add column if not exists is_sandbox boolean not null default false;

create index if not exists products_is_sandbox_idx on products(is_sandbox);
create index if not exists orders_is_sandbox_idx   on orders(is_sandbox);
