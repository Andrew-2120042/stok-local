import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg'
import { clearAuthCache } from './authcache'
import type { SemanticResult, KeywordResult, ProductWithSeller, HybridResult } from '../types/search'
import type { ProductForOrder, OrderWithDetails, CreateOrderData } from '../types/order'
import type { Order, Webhook, Developer, ApiKey, DeveloperPlan, Seller, Product } from '@stok/types'

let pool: Pool | null = null

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    })
    // An idle client dropped by the server (DB restart, `supabase db reset`)
    // emits 'error' on the pool; unhandled, that would crash the process. The
    // pool discards the dead client and opens a new one on the next query.
    pool.on('error', (err) => console.error('Postgres pool: idle client error —', err.message))
  }
  return pool
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  return getPool().query<T>(sql, params)
}

export async function getClient(): Promise<PoolClient> {
  return getPool().connect()
}

export async function transaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getClient()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}

// Single-query hybrid search: semantic + keyword + RRF in one DB round-trip.
// Returns merged candidates with rrf_score and semantic_score pre-computed.
export async function searchHybrid(
  embedding: number[],
  queryText: string,
  minSemanticScore: number,
  limit: number,
  isSandbox = false
): Promise<HybridResult[]> {
  const vectorLiteral = `[${embedding.join(',')}]`
  const { rows } = await query<HybridResult>(
    `WITH semantic AS (
       SELECT
         p.id,
         1 - (p.embedding <=> $1::vector) AS semantic_score,
         ROW_NUMBER() OVER (ORDER BY p.embedding <=> $1::vector) AS sem_rank
       FROM products p
       -- Out-of-stock products stay searchable (agents need to know they exist;
       -- is_purchasable will be false). 'discontinued' and soft-deleted are hidden.
       WHERE p.availability <> 'discontinued'
         AND p.deleted_at IS NULL
         AND p.embedding IS NOT NULL
         AND p.is_sandbox = $5
         AND p.seller_id IN (SELECT id FROM sellers WHERE status = 'active')
       ORDER BY p.embedding <=> $1::vector
       LIMIT 50
     ),
     keyword AS (
       SELECT
         p.id,
         ROW_NUMBER() OVER (ORDER BY ts_rank_cd(p.search_vector, q) DESC) AS kw_rank
       FROM products p,
         websearch_to_tsquery('english', $2) q
       WHERE p.search_vector @@ q
         AND p.availability <> 'discontinued'
         AND p.deleted_at IS NULL
         AND p.is_sandbox = $5
         AND p.seller_id IN (SELECT id FROM sellers WHERE status = 'active')
       LIMIT 50
     ),
     -- If the best semantic match exceeds the threshold the query is on-topic;
     -- include all candidates. Otherwise return nothing (out-of-domain query).
     query_valid AS (
       SELECT MAX(semantic_score) >= $3 AS is_valid FROM semantic
     ),
     rrf AS (
       SELECT
         COALESCE(s.id, k.id) AS id,
         COALESCE(s.semantic_score, 0)            AS semantic_score,
         COALESCE(1.0 / (60 + s.sem_rank), 0)
           + COALESCE(1.0 / (60 + k.kw_rank), 0) AS rrf_score,
         (k.id IS NOT NULL)                        AS in_keyword
       FROM semantic s
       FULL OUTER JOIN keyword k ON k.id = s.id
       WHERE (SELECT is_valid FROM query_valid)
     )
     SELECT
       p.id,
       p.name,
       p.brand,
       p.category,
       p.price,
       p.currency,
       p.images,
       p.availability,
       p.stock,
       p.specs,
       p.product_quality_score,
       sl.name            AS seller_name,
       sl.trust_score     AS seller_trust_score,
       r.rrf_score,
       r.semantic_score,
       r.in_keyword
     FROM rrf r
     JOIN products p  ON p.id = r.id
     JOIN sellers sl  ON sl.id = p.seller_id
     ORDER BY r.rrf_score DESC
     LIMIT $4`,
    [vectorLiteral, queryText, minSemanticScore, limit, isSandbox]
  )
  return rows
}

export async function searchSemantic(embedding: number[], limit: number): Promise<SemanticResult[]> {
  const vectorLiteral = `[${embedding.join(',')}]`
  const { rows } = await query<SemanticResult>(
    `SELECT
       p.id,
       p.name,
       p.brand,
       p.category,
       p.price,
       p.currency,
       p.images,
       p.availability,
       p.stock,
       p.specs,
       s.name AS seller_name,
       s.trust_score AS seller_trust_score,
       1 - (p.embedding <=> $1::vector) AS semantic_score,
       ROW_NUMBER() OVER (ORDER BY p.embedding <=> $1::vector) AS semantic_rank
     FROM products p
     JOIN sellers s ON s.id = p.seller_id
     WHERE p.availability = 'in_stock'
       AND p.stock > 0
       AND p.embedding IS NOT NULL
     ORDER BY p.embedding <=> $1::vector
     LIMIT $2`,
    [vectorLiteral, limit]
  )
  return rows
}

export async function searchKeyword(queryText: string, limit: number): Promise<KeywordResult[]> {
  const { rows } = await query<KeywordResult>(
    `SELECT
       p.id,
       ts_rank_cd(p.search_vector, q.query) AS keyword_score,
       ROW_NUMBER() OVER (ORDER BY ts_rank_cd(p.search_vector, q.query) DESC) AS keyword_rank
     FROM products p,
       websearch_to_tsquery('english', $1) AS q(query)
     WHERE p.search_vector @@ q.query
       AND p.availability = 'in_stock'
       AND p.stock > 0
     ORDER BY keyword_score DESC
     LIMIT $2`,
    [queryText, limit]
  )
  return rows
}

export async function getProductsByIds(ids: string[]): Promise<ProductWithSeller[]> {
  if (ids.length === 0) return []
  const { rows } = await query<ProductWithSeller>(
    `SELECT
       p.id,
       p.name,
       p.brand,
       p.category,
       p.price,
       p.currency,
       p.images,
       p.availability,
       p.stock,
       p.specs,
       s.name AS seller_name,
       s.trust_score AS seller_trust_score
     FROM products p
     JOIN sellers s ON s.id = p.seller_id
     WHERE p.id = ANY($1::uuid[])`,
    [ids]
  )
  return rows
}

export async function logSearch(params: {
  session_id: string | null
  query: string
  result_count: number
  top_result_id: string | null
  latency_ms: number
  developer_id?: string
}): Promise<void> {
  await query(
    `INSERT INTO searches (session_id, query, result_count, top_result_id, latency_ms, developer_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [params.session_id, params.query, params.result_count, params.top_result_id, params.latency_ms, params.developer_id ?? null]
  )
}

// ─── Order methods ────────────────────────────────────────────────────────────

export async function getProductWithSeller(productId: string): Promise<ProductForOrder | null> {
  const { rows } = await query<ProductForOrder>(
    `SELECT
       p.id, p.seller_id, p.name, p.brand, p.category, p.price, p.currency,
       p.images, p.availability, p.stock, p.specs, p.is_sandbox,
       s.name            AS seller_name,
       s.email           AS seller_email,
       s.trust_score     AS seller_trust_score,
       s.stripe_account_id AS seller_stripe_account_id
     FROM products p
     JOIN sellers s ON s.id = p.seller_id
     WHERE p.id = $1
       AND p.deleted_at IS NULL
       AND s.status = 'active'`,
    [productId]
  )
  return rows[0] ?? null
}

// Idempotent: at most one pending_payment order can exist per (session_id,
// product_id) — enforced by the partial unique index orders_pending_session_product_idx.
// On a conflicting concurrent insert the existing pending order is returned with
// created=false, so an agent retrying POST /v1/order never creates duplicates.
export async function createOrder(
  data: CreateOrderData
): Promise<{ order: Order; created: boolean }> {
  const { rows } = await query<Order>(
    `INSERT INTO orders (
       session_id, product_id, seller_id, developer_id, quantity, unit_price, total_price,
       currency, status, stripe_payment_intent_id, shipping_address,
       expires_at, buyer_email, is_sandbox
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (session_id, product_id) WHERE status = 'pending_payment' DO NOTHING
     RETURNING *`,
    [
      data.session_id,
      data.product_id,
      data.seller_id,
      data.developer_id ?? null,
      data.quantity,
      data.unit_price,
      data.total_price,
      data.currency,
      data.status,
      data.stripe_payment_intent_id,
      data.shipping_address ? JSON.stringify(data.shipping_address) : null,
      data.expires_at,
      data.buyer_email ?? null,
      data.is_sandbox ?? false,
    ]
  )
  if (rows[0]) return { order: rows[0], created: true }

  // Lost the race — another request already created the pending order.
  const existing = await getPendingOrder(data.session_id, data.product_id)
  if (!existing) throw new Error('createOrder: conflict but no existing pending order found')
  return { order: existing, created: false }
}

// Returns the live (non-expired) pending_payment order for a session+product, if any.
export async function getPendingOrder(
  sessionId: string,
  productId: string
): Promise<Order | null> {
  const { rows } = await query<Order>(
    `SELECT * FROM orders
     WHERE session_id = $1 AND product_id = $2 AND status = 'pending_payment'
       AND (expires_at IS NULL OR expires_at > now())
     ORDER BY created_at ASC
     LIMIT 1`,
    [sessionId, productId]
  )
  return rows[0] ?? null
}

// Atomically transition an order pending_payment → paid. Returns true only for
// the caller that won the race; concurrent/duplicate confirmations get false and
// must NOT decrement stock again. Closes the TOCTOU window between read and write.
export async function markOrderPaidIfPending(
  orderId: string,
  extra?: Record<string, unknown>
): Promise<boolean> {
  const setClauses = ["status = 'paid'", 'updated_at = now()']
  const params: unknown[] = [orderId]
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      params.push(value)
      setClauses.push(`${key} = $${params.length}`)
    }
  }
  const { rowCount } = await query(
    `UPDATE orders SET ${setClauses.join(', ')} WHERE id = $1 AND status = 'pending_payment'`,
    params
  )
  return rowCount === 1
}

export async function createOrderEvent(data: {
  order_id: string
  event_type: string
  payload: object
}): Promise<void> {
  await query(
    `INSERT INTO order_events (order_id, event_type, payload)
     VALUES ($1, $2, $3)`,
    [data.order_id, data.event_type, JSON.stringify(data.payload)]
  )
}

export async function getOrderById(orderId: string): Promise<OrderWithDetails | null> {
  const { rows } = await query<OrderWithDetails>(
    `SELECT
       o.id, o.session_id, o.product_id, o.seller_id, o.developer_id, o.quantity,
       o.unit_price, o.total_price, o.currency, o.status,
       o.stripe_payment_intent_id, o.shipping_address, o.tracking_number,
       o.carrier, o.estimated_delivery, o.expires_at, o.buyer_email, o.is_sandbox,
       o.created_at, o.updated_at,
       p.name            AS product_name,
       p.images[1]       AS product_image,
       p.brand           AS product_brand,
       p.product_quality_score AS product_quality_score,
       s.name            AS seller_name,
       s.email           AS seller_email,
       s.trust_score     AS seller_trust_score
     FROM orders o
     JOIN products p ON p.id = o.product_id
     JOIN sellers s  ON s.id = o.seller_id
     WHERE o.id = $1`,
    [orderId]
  )
  return rows[0] ?? null
}

export async function getOrderByPaymentIntentId(paymentIntentId: string): Promise<Order | null> {
  const { rows } = await query<Order>(
    `SELECT * FROM orders WHERE stripe_payment_intent_id = $1`,
    [paymentIntentId]
  )
  return rows[0] ?? null
}

export async function updateOrderStatus(
  orderId: string,
  status: string,
  extra?: Record<string, unknown>
): Promise<void> {
  const setClauses = ['status = $2', 'updated_at = now()']
  const params: unknown[] = [orderId, status]

  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      params.push(value)
      setClauses.push(`${key} = $${params.length}`)
    }
  }

  await query(
    `UPDATE orders SET ${setClauses.join(', ')} WHERE id = $1`,
    params
  )
}

export async function updateOrderDetails(
  orderId: string,
  data: { buyer_email?: string; shipping_address?: Record<string, string> }
): Promise<void> {
  if (data.buyer_email !== undefined) {
    await query(`UPDATE orders SET buyer_email = $1, updated_at = now() WHERE id = $2`, [
      data.buyer_email,
      orderId,
    ])
  }
  if (data.shipping_address !== undefined) {
    await query(
      `UPDATE orders SET shipping_address = $1, updated_at = now() WHERE id = $2`,
      [JSON.stringify(data.shipping_address), orderId]
    )
  }
}

export async function decrementStock(productId: string, quantity: number): Promise<void> {
  await query(
    `UPDATE products SET stock = GREATEST(0, stock - $2), updated_at = now() WHERE id = $1`,
    [productId, quantity]
  )
}

// Atomically decrement stock only if enough is available. Returns false when the
// product would oversell (stock < quantity) — the caller must then NOT fulfil
// the order. Availability is left to the seller (intent); stock is the gate, and
// is never allowed to go negative.
export async function decrementStockIfAvailable(productId: string, quantity: number): Promise<boolean> {
  const { rowCount } = await query(
    `UPDATE products SET stock = stock - $2, updated_at = now()
     WHERE id = $1 AND stock >= $2`,
    [productId, quantity]
  )
  return rowCount === 1
}

export async function cancelExpiredOrders(): Promise<void> {
  await query(
    `UPDATE orders
     SET status     = 'cancelled',
         updated_at = now()
     WHERE status = 'pending_payment'
       AND expires_at < now()`
  )
}

export async function getWebhooksForEvent(eventType: string): Promise<Webhook[]> {
  const { rows } = await query<Webhook>(
    `SELECT * FROM webhooks WHERE is_active = true AND $1 = ANY(events)`,
    [eventType]
  )
  return rows
}

// Webhooks are scoped to the developer who owns the order — an event for one
// developer's order is never delivered to another developer (privacy).
export async function getWebhooksForEventAndDeveloper(eventType: string, developerId: string): Promise<Webhook[]> {
  const { rows } = await query<Webhook>(
    `SELECT * FROM webhooks WHERE is_active = true AND $1 = ANY(events) AND developer_id = $2`,
    [eventType, developerId]
  )
  return rows
}

// ─── Auth & developer methods ─────────────────────────────────────────────────

export interface ApiKeyWithPlan {
  id: string
  developer_id: string
  is_sandbox: boolean
  plan: DeveloperPlan
}

export async function getApiKeyByHash(hash: string): Promise<ApiKeyWithPlan | null> {
  const { rows } = await query<ApiKeyWithPlan>(
    `SELECT ak.id, ak.developer_id, ak.is_sandbox, d.plan
     FROM api_keys ak
     JOIN developers d ON d.id = ak.developer_id
     WHERE ak.key_hash = $1`,
    [hash]
  )
  return rows[0] ?? null
}

export async function updateApiKeyLastUsed(apiKeyId: string): Promise<void> {
  await query(`UPDATE api_keys SET last_used_at = now() WHERE id = $1`, [apiKeyId])
}

export async function createDeveloper(data: {
  name: string
  email: string
  plan?: DeveloperPlan
  supabase_user_id?: string
}): Promise<Developer> {
  const { rows } = await query<Developer>(
    `INSERT INTO developers (name, email, plan, supabase_user_id)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [data.name, data.email, data.plan ?? 'free', data.supabase_user_id ?? null]
  )
  return rows[0]
}

export async function getDeveloperBySupabaseId(supabaseUserId: string): Promise<Developer | null> {
  const { rows } = await query<Developer>(
    `SELECT * FROM developers WHERE supabase_user_id = $1`,
    [supabaseUserId]
  )
  return rows[0] ?? null
}

export async function getDeveloperById(id: string): Promise<Developer | null> {
  const { rows } = await query<Developer>(
    `SELECT * FROM developers WHERE id = $1`,
    [id]
  )
  return rows[0] ?? null
}

export async function createApiKey(data: {
  developer_id: string
  key_hash: string
  key_prefix: string
  is_sandbox: boolean
  name: string
}): Promise<ApiKey> {
  const { rows } = await query<ApiKey>(
    `INSERT INTO api_keys (developer_id, key_hash, key_prefix, is_sandbox, name)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [data.developer_id, data.key_hash, data.key_prefix, data.is_sandbox, data.name]
  )
  return rows[0]
}

export async function getDeveloperApiKeys(developerId: string): Promise<ApiKey[]> {
  const { rows } = await query<ApiKey>(
    `SELECT * FROM api_keys WHERE developer_id = $1 ORDER BY created_at ASC`,
    [developerId]
  )
  return rows
}

export async function revokeApiKey(apiKeyId: string, developerId: string): Promise<void> {
  await query(
    `DELETE FROM api_keys WHERE id = $1 AND developer_id = $2`,
    [apiKeyId, developerId]
  )
  // Drop cached auth so the deleted key can never be served from cache.
  clearAuthCache()
}

// ─── Usage methods ────────────────────────────────────────────────────────────

export interface DailyUsage {
  date: string
  search_count: number
  order_count: number
  avg_latency_ms: number
}

export interface TopQuery {
  query: string
  count: number
}

export async function getDeveloperUsage(developerId: string, days: number): Promise<DailyUsage[]> {
  const { rows } = await query<DailyUsage>(
    `SELECT
       date_trunc('day', created_at)::date::text AS date,
       COUNT(*)::int                             AS search_count,
       0::int                                    AS order_count,
       ROUND(AVG(latency_ms))::int               AS avg_latency_ms
     FROM searches
     WHERE developer_id = $1
       AND created_at > now() - ($2 || ' days')::interval
     GROUP BY 1
     ORDER BY 1 DESC`,
    [developerId, days]
  )
  return rows
}

export async function getDeveloperTopQueries(developerId: string, days: number): Promise<TopQuery[]> {
  const { rows } = await query<TopQuery>(
    `SELECT query, COUNT(*)::int AS count
     FROM searches
     WHERE developer_id = $1
       AND created_at > now() - ($2 || ' days')::interval
     GROUP BY query
     ORDER BY count DESC
     LIMIT 10`,
    [developerId, days]
  )
  return rows
}

export async function getDeveloperTodaySearchCount(developerId: string): Promise<number> {
  const { rows } = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM searches
     WHERE developer_id = $1 AND created_at >= date_trunc('day', now())`,
    [developerId]
  )
  return rows[0]?.count ?? 0
}

export async function getDeveloperTodayOrderCount(developerId: string): Promise<number> {
  const { rows } = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM orders
     WHERE developer_id = $1 AND created_at >= date_trunc('day', now())`,
    [developerId]
  )
  return rows[0]?.count ?? 0
}

// ─── Webhook portal methods ───────────────────────────────────────────────────

export async function createWebhook(data: {
  developer_id: string
  url: string
  events: string[]
  secret: string
}): Promise<Webhook> {
  const { rows } = await query<Webhook>(
    `INSERT INTO webhooks (developer_id, url, events, secret)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [data.developer_id, data.url, data.events, data.secret]
  )
  return rows[0]
}

export async function getDeveloperWebhooks(developerId: string): Promise<Webhook[]> {
  const { rows } = await query<Webhook>(
    `SELECT * FROM webhooks WHERE developer_id = $1 ORDER BY created_at DESC`,
    [developerId]
  )
  return rows
}

export async function deleteWebhook(webhookId: string, developerId: string): Promise<void> {
  await query(
    `DELETE FROM webhooks WHERE id = $1 AND developer_id = $2`,
    [webhookId, developerId]
  )
}

// Record the outcome of the most recent delivery attempt (status 0 = network
// failure/timeout). Surfaced to developers via GET /portal/webhooks.
export async function recordWebhookDelivery(webhookId: string, status: number): Promise<void> {
  await query(`UPDATE webhooks SET last_delivered_at = now(), last_delivery_status = $2 WHERE id = $1`, [webhookId, status])
}

// ─── Seller management (Phase 5) ──────────────────────────────────────────────

export interface CreateSellerData {
  name: string
  email: string
  supabase_user_id: string
  phone?: string | null
  business_type?: string | null
  gst_number?: string | null
  description?: string | null
  address?: Record<string, unknown> | null
}

export async function createSeller(data: CreateSellerData): Promise<Seller> {
  const { rows } = await query<Seller>(
    `INSERT INTO sellers (name, email, supabase_user_id, phone, business_type, gst_number, description, address, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active')
     RETURNING *`,
    [
      data.name,
      data.email.toLowerCase(),
      data.supabase_user_id,
      data.phone ?? null,
      data.business_type ?? 'individual',
      data.gst_number ?? null,
      data.description ?? null,
      data.address ? JSON.stringify(data.address) : null,
    ]
  )
  return rows[0]
}

export async function getSellerBySupabaseId(supabaseUserId: string): Promise<Seller | null> {
  const { rows } = await query<Seller>(`SELECT * FROM sellers WHERE supabase_user_id = $1`, [supabaseUserId])
  return rows[0] ?? null
}

export async function getSellerById(sellerId: string): Promise<Seller | null> {
  const { rows } = await query<Seller>(`SELECT * FROM sellers WHERE id = $1`, [sellerId])
  return rows[0] ?? null
}

// Columns a seller is allowed to update on their own record (whitelist — never
// interpolate arbitrary keys into SQL).
const SELLER_UPDATABLE = new Set([
  'name', 'phone', 'business_type', 'gst_number', 'description', 'address',
  'logo_url', 'stripe_account_id', 'stripe_onboarding_complete', 'status',
])

export async function updateSeller(sellerId: string, data: Record<string, unknown>): Promise<void> {
  const sets: string[] = ['updated_at = now()']
  const params: unknown[] = [sellerId]
  for (const [key, value] of Object.entries(data)) {
    if (!SELLER_UPDATABLE.has(key)) continue
    params.push(key === 'address' && value && typeof value === 'object' ? JSON.stringify(value) : value)
    sets.push(`${key} = $${params.length}`)
  }
  if (sets.length === 1) return // nothing updatable
  await query(`UPDATE sellers SET ${sets.join(', ')} WHERE id = $1`, params)
}

export interface SellerStats {
  trust_score: number
  quality_score: number
  product_count: number
  month_orders: number
  month_revenue: number // seller payout (90% of gross)
  month_returns: number
  total_earned: number
  pending_payout: number
  products_below_40: number
}

export async function getSellerStats(sellerId: string): Promise<SellerStats> {
  const feePct = Number(process.env.STRIPE_PLATFORM_FEE_PERCENT ?? 10)
  const payoutRate = (100 - feePct) / 100

  // Run all independent reads in parallel — keeps the dashboard fast under
  // data volume (one round trip instead of ~6 sequential).
  const [sellerRow, productsRow, ordersRow, returnsRow, earningTotals] = await Promise.all([
    query<{ trust_score: number }>(`SELECT trust_score FROM sellers WHERE id = $1`, [sellerId]),
    query<{ product_count: number; quality_score: number; products_below_40: number }>(
      `SELECT count(*)::int product_count,
              COALESCE(round(avg(product_quality_score)), 50)::int quality_score,
              COUNT(*) FILTER (WHERE product_quality_score < 40)::int products_below_40
       FROM products WHERE seller_id = $1 AND is_sandbox = false AND deleted_at IS NULL`, [sellerId]),
    // month_orders counts every order actually placed this month (incl. returned —
    // it still happened); gross/revenue excludes returned.
    query<{ month_orders: number; gross: number }>(
      `SELECT
         count(*) FILTER (WHERE status IN ('paid','processing','shipped','delivered','returned'))::int AS month_orders,
         COALESCE(sum(total_price) FILTER (WHERE status IN ('paid','processing','shipped','delivered')), 0)::numeric AS gross
       FROM orders WHERE seller_id = $1 AND created_at >= date_trunc('month', now())`, [sellerId]),
    query<{ n: number }>(`SELECT count(*)::int n FROM returns WHERE seller_id = $1 AND created_at >= date_trunc('month', now())`, [sellerId]),
    getSellerEarningsTotals(sellerId),
  ])

  return {
    trust_score: sellerRow.rows[0]?.trust_score ?? 0,
    quality_score: productsRow.rows[0].quality_score,
    product_count: productsRow.rows[0].product_count,
    products_below_40: productsRow.rows[0].products_below_40,
    month_orders: ordersRow.rows[0].month_orders,
    month_revenue: Math.round(Number(ordersRow.rows[0].gross) * payoutRate),
    month_returns: returnsRow.rows[0]?.n ?? 0,
    total_earned: earningTotals.total_earned,
    pending_payout: earningTotals.pending_payout,
  }
}

// ─── Seller earnings ledger (Phase 5 — substitute for Connect payouts) ─────────

export interface SellerEarning {
  id: string
  seller_id: string
  order_id: string
  gross_amount: number
  platform_fee: number
  seller_amount: number
  status: 'pending' | 'paid'
  created_at: string
}

// Record what a seller is owed for a paid order. Idempotent: a duplicate payment
// event (e.g. Stripe retry) for the same order is ignored via ON CONFLICT.
export async function createSellerEarning(params: {
  seller_id: string
  order_id: string
  gross_amount: number
}): Promise<void> {
  const feePct = Number(process.env.STRIPE_PLATFORM_FEE_PERCENT ?? 10)
  const platformFee = Math.round(params.gross_amount * (feePct / 100) * 100) / 100
  const sellerAmount = Math.round((params.gross_amount - platformFee) * 100) / 100
  await query(
    `INSERT INTO seller_earnings (seller_id, order_id, gross_amount, platform_fee, seller_amount, status)
     VALUES ($1, $2, $3, $4, $5, 'pending')
     ON CONFLICT (order_id) DO NOTHING`,
    [params.seller_id, params.order_id, params.gross_amount, platformFee, sellerAmount]
  )
}

export async function getSellerEarnings(sellerId: string, limit = 100, offset = 0): Promise<{ earnings: SellerEarning[]; has_more: boolean; total: number }> {
  const { rows } = await query<SellerEarning>(
    `SELECT e.*, o.session_id, p.name AS product_name
     FROM seller_earnings e
     JOIN orders o ON o.id = e.order_id
     JOIN products p ON p.id = o.product_id
     WHERE e.seller_id = $1
     ORDER BY e.created_at DESC
     LIMIT $2 OFFSET $3`,
    [sellerId, limit + 1, offset]
  )
  const has_more = rows.length > limit
  const total = (await query<{ n: number }>(`SELECT count(*)::int n FROM seller_earnings WHERE seller_id = $1`, [sellerId])).rows[0].n
  return { earnings: rows.slice(0, limit), has_more, total }
}

export async function getSellerEarningsTotals(sellerId: string): Promise<{
  total_earned: number
  pending_payout: number
  paid_out: number
}> {
  const { rows } = await query<{ total_earned: number; pending_payout: number; paid_out: number }>(
    `SELECT
       COALESCE(sum(seller_amount), 0)::numeric AS total_earned,
       COALESCE(sum(seller_amount) FILTER (WHERE status = 'pending'), 0)::numeric AS pending_payout,
       COALESCE(sum(seller_amount) FILTER (WHERE status = 'paid'), 0)::numeric AS paid_out
     FROM seller_earnings WHERE seller_id = $1`,
    [sellerId]
  )
  return {
    total_earned: Number(rows[0].total_earned),
    pending_payout: Number(rows[0].pending_payout),
    paid_out: Number(rows[0].paid_out),
  }
}

// ─── Seller product management (Phase 5, Part 2) ──────────────────────────────

export interface ProductFilters {
  availability?: 'in_stock' | 'out_of_stock' | 'discontinued'
  sort?: 'price' | 'stock' | 'quality_score' | 'created_at'
  order?: 'asc' | 'desc'
}

const PRODUCT_SORT_COLUMNS: Record<string, string> = {
  price: 'price',
  stock: 'stock',
  quality_score: 'product_quality_score',
  created_at: 'created_at',
}

// Every products column except the internal search fields (embedding is ~1536
// floats per row; search_vector is a tsvector) — keeps seller responses small.
const SELLER_PRODUCT_COLUMNS = `id, seller_id, name, brand, category, description, specs, images, price,
  currency, stock, availability, is_sandbox, deleted_at, product_quality_score, created_at, updated_at`

export async function getSellerProducts(sellerId: string, filters: ProductFilters = {}): Promise<Product[]> {
  const params: unknown[] = [sellerId]
  let where = `seller_id = $1 AND is_sandbox = false AND deleted_at IS NULL`
  if (filters.availability) {
    params.push(filters.availability)
    where += ` AND availability = $${params.length}`
  }
  const sortCol = PRODUCT_SORT_COLUMNS[filters.sort ?? 'created_at'] ?? 'created_at'
  const sortDir = filters.order === 'asc' ? 'ASC' : 'DESC'
  const { rows } = await query<Product>(
    `SELECT ${SELLER_PRODUCT_COLUMNS} FROM products WHERE ${where} ORDER BY ${sortCol} ${sortDir}`,
    params
  )
  return rows
}

// Always ownership-scoped — returns null if the product isn't this seller's.
export async function getSellerProductById(productId: string, sellerId: string): Promise<Product | null> {
  const { rows } = await query<Product>(
    `SELECT ${SELLER_PRODUCT_COLUMNS} FROM products WHERE id = $1 AND seller_id = $2 AND deleted_at IS NULL`,
    [productId, sellerId]
  )
  return rows[0] ?? null
}

export interface CreateProductData {
  seller_id: string
  name: string
  brand: string
  category: string
  description: string
  specs: Record<string, unknown>
  images: string[]
  price: number
  stock: number
  currency?: string
  availability?: string
}

export async function createProduct(data: CreateProductData): Promise<Product> {
  const { rows } = await query<Product>(
    `INSERT INTO products (seller_id, name, brand, category, description, specs, images, price, stock, currency, availability, is_sandbox)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,false)
     RETURNING ${SELLER_PRODUCT_COLUMNS}`,
    [
      data.seller_id, data.name, data.brand, data.category, data.description,
      JSON.stringify(data.specs), data.images, data.price, data.stock,
      data.currency ?? 'INR', data.availability ?? 'in_stock',
    ]
  )
  return rows[0]
}

const PRODUCT_UPDATABLE = new Set(['name', 'brand', 'category', 'description', 'specs', 'images', 'price', 'stock', 'availability'])

// Caller MUST verify ownership first (via getSellerProductById). sellerId is
// passed again as a WHERE guard so an update can never touch another seller's row.
export async function updateProduct(productId: string, sellerId: string, data: Record<string, unknown>): Promise<void> {
  const sets: string[] = ['updated_at = now()']
  const params: unknown[] = [productId, sellerId]
  for (const [key, value] of Object.entries(data)) {
    if (!PRODUCT_UPDATABLE.has(key)) continue
    params.push(key === 'specs' && value && typeof value === 'object' ? JSON.stringify(value) : value)
    sets.push(`${key} = $${params.length}${key === 'specs' ? '::jsonb' : ''}`)
  }
  if (sets.length === 1) return
  await query(`UPDATE products SET ${sets.join(', ')} WHERE id = $1 AND seller_id = $2`, params)
}

// Update just the quality score (used by Part 5 recalculation; bypasses the
// updatable whitelist intentionally).
export async function setProductQualityScore(productId: string, score: number): Promise<void> {
  await query(`UPDATE products SET product_quality_score = $2 WHERE id = $1`, [productId, score])
}

export async function softDeleteProduct(productId: string, sellerId: string): Promise<boolean> {
  const { rowCount } = await query(
    `UPDATE products SET deleted_at = now(), updated_at = now()
     WHERE id = $1 AND seller_id = $2 AND deleted_at IS NULL`,
    [productId, sellerId]
  )
  return rowCount === 1
}

export async function appendProductImage(productId: string, sellerId: string, url: string): Promise<boolean> {
  const { rowCount } = await query(
    `UPDATE products SET images = array_append(images, $3), updated_at = now()
     WHERE id = $1 AND seller_id = $2 AND deleted_at IS NULL`,
    [productId, sellerId, url]
  )
  return rowCount === 1
}

// ─── Seller order management (Phase 5, Part 3) ────────────────────────────────

export interface SellerOrderFilters {
  status?: 'paid' | 'processing' | 'shipped' | 'delivered'
  sort?: 'newest' | 'oldest'
  limit?: number
  offset?: number
}

// Seller-scoped order list. seller_amount comes from the earnings ledger (NOT
// gross); buyer address is reduced to city/state only at the list level.
export async function getSellerOrders(sellerId: string, filters: SellerOrderFilters = {}): Promise<any[]> {
  const params: unknown[] = [sellerId]
  let where = `o.seller_id = $1`
  if (filters.status) { params.push(filters.status); where += ` AND o.status = $${params.length}` }
  const dir = filters.sort === 'oldest' ? 'ASC' : 'DESC'
  const limit = Math.min(100, filters.limit ?? 20)
  const offset = Math.max(0, filters.offset ?? 0)
  params.push(limit, offset)
  const { rows } = await query(
    `SELECT
       o.id, o.status, o.quantity, o.total_price, o.currency, o.created_at,
       p.name AS product_name, p.images[1] AS product_image,
       o.shipping_address->>'city' AS buyer_city,
       o.shipping_address->>'state' AS buyer_state,
       COALESCE(e.seller_amount, round(o.total_price * 0.9, 2)) AS seller_amount
     FROM orders o
     JOIN products p ON p.id = o.product_id
     LEFT JOIN seller_earnings e ON e.order_id = o.id
     WHERE ${where}
     ORDER BY o.created_at ${dir}
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  )
  return rows
}

export async function countSellerOrders(sellerId: string, status?: string): Promise<number> {
  const params: unknown[] = [sellerId]
  let where = `seller_id = $1`
  if (status) { params.push(status); where += ` AND status = $${params.length}` }
  const { rows } = await query<{ n: number }>(`SELECT count(*)::int n FROM orders WHERE ${where}`, params)
  return rows[0].n
}

// Full order detail, ownership-scoped (null if not this seller's). Includes
// product specs/images, full buyer address, and the payment breakdown.
export async function getSellerOrderById(orderId: string, sellerId: string): Promise<any | null> {
  const { rows } = await query(
    `SELECT
       o.id, o.session_id, o.product_id, o.seller_id, o.quantity, o.unit_price,
       o.total_price, o.currency, o.status, o.shipping_address, o.buyer_email,
       o.tracking_number, o.carrier, o.estimated_delivery, o.created_at, o.updated_at,
       p.name AS product_name, p.brand AS product_brand, p.images AS product_images,
       p.specs AS product_specs,
       e.gross_amount, e.platform_fee, e.seller_amount, e.status AS payout_status
     FROM orders o
     JOIN products p ON p.id = o.product_id
     LEFT JOIN seller_earnings e ON e.order_id = o.id
     WHERE o.id = $1 AND o.seller_id = $2`,
    [orderId, sellerId]
  )
  return rows[0] ?? null
}

export async function getOrderEvents(orderId: string): Promise<{ event_type: string; payload: any; created_at: string }[]> {
  const { rows } = await query<{ event_type: string; payload: any; created_at: string }>(
    `SELECT event_type, payload, created_at FROM order_events WHERE order_id = $1 ORDER BY created_at ASC`,
    [orderId]
  )
  return rows
}

// Atomic paid → processing (only the seller's order, only from 'paid').
export async function processSellerOrder(orderId: string, sellerId: string): Promise<boolean> {
  const { rowCount } = await query(
    `UPDATE orders SET status = 'processing', updated_at = now()
     WHERE id = $1 AND seller_id = $2 AND status = 'paid'`,
    [orderId, sellerId]
  )
  return rowCount === 1
}

// Atomic (paid|processing) → shipped with tracking. Returns true only for the
// seller's order in a shippable state.
export async function shipSellerOrder(
  orderId: string,
  sellerId: string,
  data: { tracking_number: string; carrier: string; estimated_delivery: string }
): Promise<boolean> {
  const { rowCount } = await query(
    `UPDATE orders
     SET status = 'shipped', tracking_number = $3, carrier = $4, estimated_delivery = $5, updated_at = now()
     WHERE id = $1 AND seller_id = $2 AND status IN ('paid', 'processing')`,
    [orderId, sellerId, data.tracking_number, data.carrier, data.estimated_delivery]
  )
  return rowCount === 1
}

export async function getOrderDeveloperId(orderId: string): Promise<string | null> {
  const { rows } = await query<{ developer_id: string | null }>(`SELECT developer_id FROM orders WHERE id = $1`, [orderId])
  return rows[0]?.developer_id ?? null
}

// ─── Returns (Phase 5, Part 4) ────────────────────────────────────────────────

export interface ReturnRow {
  id: string
  order_id: string
  seller_id: string
  reason: string
  description: string | null
  status: string
  pickup_carrier: string | null
  pickup_tracking_number: string | null
  pickup_date: string | null
  pickup_address: Record<string, string> | null
  refund_amount: number | null
  stripe_refund_id: string | null
  seller_notes: string | null
  created_at: string
  updated_at: string
}

export async function getReturnByOrderId(orderId: string): Promise<ReturnRow | null> {
  const { rows } = await query<ReturnRow>(`SELECT * FROM returns WHERE order_id = $1`, [orderId])
  return rows[0] ?? null
}

export async function createReturn(data: {
  order_id: string
  seller_id: string
  reason: string
  description?: string | null
  pickup_address: Record<string, string> | null
}): Promise<ReturnRow> {
  const { rows } = await query<ReturnRow>(
    `INSERT INTO returns (order_id, seller_id, reason, description, pickup_address, status)
     VALUES ($1, $2, $3, $4, $5, 'requested')
     RETURNING *`,
    [data.order_id, data.seller_id, data.reason, data.description ?? null, data.pickup_address ? JSON.stringify(data.pickup_address) : null]
  )
  return rows[0]
}

// Plain fetch by id (agent endpoint scopes via the order's developer_id).
export async function getReturnById(returnId: string): Promise<ReturnRow | null> {
  const { rows } = await query<ReturnRow>(`SELECT * FROM returns WHERE id = $1`, [returnId])
  return rows[0] ?? null
}

// Ownership-scoped (seller portal). Null if not this seller's return.
export async function getSellerReturnById(returnId: string, sellerId: string): Promise<any | null> {
  const { rows } = await query(
    `SELECT r.*, o.session_id, p.name AS product_name, p.images[1] AS product_image
     FROM returns r
     JOIN orders o ON o.id = r.order_id
     JOIN products p ON p.id = o.product_id
     WHERE r.id = $1 AND r.seller_id = $2`,
    [returnId, sellerId]
  )
  return rows[0] ?? null
}

export async function getSellerReturns(sellerId: string, status?: string): Promise<any[]> {
  const params: unknown[] = [sellerId]
  let where = `r.seller_id = $1`
  if (status) { params.push(status); where += ` AND r.status = $${params.length}` }
  const { rows } = await query(
    `SELECT r.id, r.order_id, r.reason, r.status, r.refund_amount, r.created_at,
            p.name AS product_name
     FROM returns r
     JOIN orders o ON o.id = r.order_id
     JOIN products p ON p.id = o.product_id
     WHERE ${where}
     ORDER BY r.created_at DESC`,
    params
  )
  return rows
}

const RETURN_EXTRA = new Set(['pickup_carrier', 'pickup_tracking_number', 'pickup_date', 'seller_notes', 'refund_amount', 'stripe_refund_id'])

// Atomic, ownership-scoped status transition. Returns the updated row only if the
// return belonged to this seller AND was in `fromStatus` (guards illegal jumps).
export async function transitionReturn(
  returnId: string,
  sellerId: string,
  fromStatus: string,
  toStatus: string,
  extra: Record<string, unknown> = {}
): Promise<ReturnRow | null> {
  const sets = ['status = $4', 'updated_at = now()']
  const params: unknown[] = [returnId, sellerId, fromStatus, toStatus]
  for (const [k, v] of Object.entries(extra)) {
    if (!RETURN_EXTRA.has(k)) continue
    params.push(v)
    sets.push(`${k} = $${params.length}`)
  }
  const { rows } = await query<ReturnRow>(
    `UPDATE returns SET ${sets.join(', ')} WHERE id = $1 AND seller_id = $2 AND status = $3 RETURNING *`,
    params
  )
  return rows[0] ?? null
}

export async function cancelEarningForOrder(orderId: string): Promise<void> {
  await query(`UPDATE seller_earnings SET status = 'cancelled' WHERE order_id = $1`, [orderId])
}

export async function getEarningAmountForOrder(orderId: string): Promise<number | null> {
  const { rows } = await query<{ seller_amount: number }>(`SELECT seller_amount FROM seller_earnings WHERE order_id = $1`, [orderId])
  return rows[0] ? Number(rows[0].seller_amount) : null
}

export async function markOrderReturned(orderId: string): Promise<void> {
  await query(`UPDATE orders SET status = 'returned', updated_at = now() WHERE id = $1`, [orderId])
}

// Auto-suspend inputs.
export async function countRecentReceivedReturns(sellerId: string, days: number): Promise<number> {
  const { rows } = await query<{ n: number }>(
    `SELECT count(*)::int n FROM returns
     WHERE seller_id = $1 AND status IN ('received', 'refunded')
       AND updated_at >= now() - ($2 || ' days')::interval`,
    [sellerId, String(days)]
  )
  return rows[0].n
}

export async function countSellerTotalOrders(sellerId: string): Promise<number> {
  const { rows } = await query<{ n: number }>(
    `SELECT count(*)::int n FROM orders WHERE seller_id = $1 AND status IN ('paid','processing','shipped','delivered','returned')`,
    [sellerId]
  )
  return rows[0].n
}

export async function suspendSeller(sellerId: string): Promise<void> {
  await query(`UPDATE sellers SET status = 'suspended', updated_at = now() WHERE id = $1`, [sellerId])
}

// Return policy
export async function getReturnPolicy(sellerId: string): Promise<any> {
  const { rows } = await query<{ return_policy: any }>(`SELECT return_policy FROM sellers WHERE id = $1`, [sellerId])
  return rows[0]?.return_policy ?? null
}

export async function updateReturnPolicy(sellerId: string, policy: Record<string, unknown>): Promise<void> {
  await query(`UPDATE sellers SET return_policy = $2::jsonb, updated_at = now() WHERE id = $1`, [sellerId, JSON.stringify(policy)])
}

// ─── Product quality metrics (Phase 5, Part 5) ────────────────────────────────

export interface QualityMetrics {
  total_orders: number
  return_count: number
  total_buyers: number
  repeat_buyers: number
}

export async function getProductQualityMetrics(productId: string): Promise<QualityMetrics> {
  const { rows } = await query<{ total_orders: number; return_count: number; total_buyers: number; repeat_buyers: number }>(
    `SELECT
       -- total_orders = every order that actually completed (incl. returned), so
       -- return_rate = return_count / total_orders is a fraction of all orders.
       COUNT(DISTINCT o.id) FILTER (WHERE o.status IN ('paid','processing','shipped','delivered','returned')) AS total_orders,
       COUNT(DISTINCT r.id) FILTER (WHERE r.status = 'received')                          AS return_count,
       COUNT(DISTINCT o.session_id)                                                       AS total_buyers,
       COUNT(DISTINCT o.session_id) FILTER (
         WHERE (SELECT COUNT(*) FROM orders o2 WHERE o2.product_id = o.product_id AND o2.session_id = o.session_id) > 1
       )                                                                                  AS repeat_buyers
     FROM orders o
     LEFT JOIN returns r ON r.order_id = o.id
     WHERE o.product_id = $1`,
    [productId]
  )
  const m = rows[0]
  return {
    total_orders: Number(m.total_orders),
    return_count: Number(m.return_count),
    total_buyers: Number(m.total_buyers),
    repeat_buyers: Number(m.repeat_buyers),
  }
}

// True if this (session, product) pair has more than one order (repeat purchase).
export async function isRepeatPurchase(sessionId: string, productId: string): Promise<boolean> {
  const { rows } = await query<{ n: number }>(
    `SELECT count(*)::int n FROM orders WHERE session_id = $1 AND product_id = $2`,
    [sessionId, productId]
  )
  return rows[0].n > 1
}
