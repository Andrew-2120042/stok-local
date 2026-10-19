-- Idempotent order creation: at most one pending_payment order may exist per
-- (session_id, product_id). This lets an agent safely retry POST /v1/order
-- (including under concurrency) without ever producing duplicate orders.

-- First collapse any pre-existing duplicate pending orders (keep the earliest,
-- cancel the rest) so the unique index can be built.
with ranked as (
  select id,
         row_number() over (
           partition by session_id, product_id order by created_at asc
         ) as rn
  from orders
  where status = 'pending_payment'
)
update orders o
set status = 'cancelled', updated_at = now()
from ranked r
where o.id = r.id and r.rn > 1;

create unique index if not exists orders_pending_session_product_idx
  on orders (session_id, product_id)
  where status = 'pending_payment';
