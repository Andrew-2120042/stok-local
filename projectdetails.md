# Stok — Complete Project Reference (`projectdetails.md`)

> **Purpose:** This is the single source of truth for the Stok project. If you are a new Claude session, read this top-to-bottom before touching anything. It captures the architecture, every subsystem, all business logic, the financial/security models, every edge case discovered through six brutal stress-test rounds, and the bugs that were found and fixed. Last updated 2026-06-30.

---

## 0. TL;DR / Current Status

**Stok** (formerly "AgentMart") is an **agent-native product marketplace** — Amazon rebuilt so the *buyers are AI agents*, not humans. Agents search via an API, place orders, and a hosted checkout collects payment from the human principal. Sellers list products through a web portal.

- **Phases 1–5 are COMPLETE and production-readiness CERTIFIED.**
- Stress-test history (all passed, see §15 for the full ledger): Phase 4 (63/63), Full-System Phases 1–4 (78/79), Round 3 (81/81), Phase 5 R1 (90/90), Phase 5 R2 (69/69), Mega 1 = P5 R3 adversarial + Full-System R1 (96/96), Mega 2 = Full-System R2+R3 (88/88, "🏁 PRODUCTION READINESS CERTIFIED"). Plus per-phase verification (Phase 4 12/12; Phase 5 parts 16/16, 17/17, 30/30, 14/14).
- **Catalog invariant:** exactly **50 real products + 20 sandbox products + 2 real sellers**. Every test must restore this. Embeddings: 0 null, all 1536-dim.
- **Standing user rule:** **NEVER `git push` until the user explicitly says so.** All work stays local. (Repo is not even a git repo at the working dir per environment.)
- Renamed AgentMart→Stok everywhere EXCEPT the `sk_*_am_` API-key suffix (intentionally kept — `am` ≠ agentmart).

---

## 1. Repository Layout

Working dir: `/Users/andrewwilson/my projects/amazon/agentmart/` (directory name unchanged after rename).

Monorepo (npm workspaces, root `package.json` name = `stok`):

```
apps/
  api/        Fastify API (TypeScript, tsx). The core. Port 3001.
  web/        Next.js 14 app-router. Port 3000. Seller portal + dev portal + hosted checkout.
  mcp/        Cloudflare Workers MCP server (built, NOT deployed).
packages/
  types/      Shared TS types (@stok/types).
supabase/
  migrations/ 00001–00021 SQL migrations (see §4).
  functions/  Edge function `generate-embedding` (called by the embedding trigger).
  seed.ts     Seeds the 50 real products + 2 sellers.
scripts/
  seed-sandbox.ts          Seeds the 20 [TEST] sandbox products.
  stress-test-*.ts         All stress tests (phase4, full, 3, p5-r1, p5-r2, mega1, mega2).
  test-trigger.ts, test-trust.ts
STRIPE_TODO.md             Deferred Stripe Connect / Razorpay / deployment work.
projectdetails.md          (this file)
```

**Run commands** (root):
- `npm run dev:api` → `tsx watch src/index.ts` in apps/api (port 3001).
- `npm run dev:web` → Next dev (port 3000).
- `npm run seed` → reseed real catalog.
- Stress tests: `npx tsx scripts/stress-test-<name>.ts` (run from repo root).

---

## 2. The Big Picture / Mental Model

Three distinct **identities**, three distinct **auth mechanisms** — keep them separate:

| Actor | Who | Auth | Hits |
|---|---|---|---|
| **Developer / Agent** | AI agent builder | **API key** `sk_live_am_…` / `sk_test_am_…` (Bearer) | `/v1/*` |
| **Seller** | merchant | **Supabase Auth session** → Next.js verifies JWT → sets `x-supabase-user-id` header | `/portal/sellers/*` |
| **Developer (portal)** | same builder, managing keys/webhooks | Supabase session → `x-supabase-user-id` | `/portal/*` (non-seller) |

**Golden rule:** API-key auth ≠ seller session ≠ developer session. A valid API key must NOT access seller routes (401); a seller session must NOT call `/v1/*` without a key (401). This separation is explicitly tested.

**Flow of a sale:** Agent `POST /v1/search` → picks a result → `POST /v1/order` (gets `checkout_url`, 15-min expiry) → human opens checkout URL, pays via Stripe (or sandbox confirm) → webhook marks order paid, stock decremented, `seller_earnings` row created, `order.confirmed` webhook fires to the owning developer → seller sees the order in their dashboard → seller `process` → `ship` (tracking) → `order.shipped` webhook → optionally a return lifecycle.

---

## 3. Tech Stack & External Services

- **API:** Fastify + TypeScript, run via `tsx watch` (no build step in dev). `@fastify/cors` (permissive, `origin:true`), `@fastify/helmet`, `fastify-raw-body` (for Stripe signature).
- **Web:** Next.js 14 (app router), server components for checkout, route handlers under `app/api/portal/*` proxy to the API setting the `x-supabase-user-id` header.
- **DB:** Supabase Postgres + **pgvector** (HNSW index) + tsvector GIN (full-text). `pg` Pool (max 10).
- **Auth (humans):** Supabase Auth (email/password). Rejects `.test` email domains → tests use `@example.com` or `@stress.test` for sellers/devs (those are signup-record emails, not Supabase Auth).
- **Embeddings:** OpenAI `text-embedding-3-small` (1536-dim).
- **Payments:** Stripe (PaymentIntents + hosted checkout). **Stripe Connect is DEFERRED** — see §13.
- **Email:** Resend (`send()` guards on `RESEND_API_KEY` + recipient; never throws). Not externally verifiable in tests.
- **Storage:** Supabase Storage bucket `product-images` (public, 5MB limit, image/* mime). Created programmatically with the service-role key.
- **MCP:** Cloudflare Workers (apps/mcp) — built, not deployed.

**Env vars** (`.env` at root for API): `DATABASE_URL, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, STORAGE_BUCKET, STORAGE_URL, OPENAI_API_KEY, STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PLATFORM_FEE_PERCENT(=10), STRIPE_REQUIRE_CONNECT, RESEND_API_KEY, EMAIL_FROM, NODE_ENV, API_PORT, CHECKOUT_BASE_URL, API_BASE_URL`.
**Web** (`apps/web/.env.local`): `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, NEXT_PUBLIC_API_BASE_URL, API_BASE_URL, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY`.

> **DB is REMOTE Supabase.** Every query carries ~120–200ms network RTT from a dev machine. This dominates all latency numbers (see §12 performance). It is NOT a code defect; production would colocate API+DB.

---

## 4. Database Schema (migrations 00001–00021)

| # | Migration | What it adds |
|---|---|---|
| 00001 | enable_pgvector | `vector` extension |
| 00002 | sellers | sellers table |
| 00003 | products | products + embedding (vector 1536) + search_vector (tsvector) + HNSW + GIN |
| 00004 | developers | developers |
| 00005 | api_keys | api_keys (hashed) |
| 00006 | orders | orders |
| 00007 | webhooks | webhooks |
| 00008 | searches | search log |
| 00009–00011 | embedding_trigger (+v2, +timeout) | pg_net trigger → edge fn `generate-embedding` |
| 00012 | add_buyer_email | orders.buyer_email |
| 00013 | sandbox_flag | products.is_sandbox, orders.is_sandbox |
| 00014 | developer_supabase_id | developers.supabase_user_id |
| 00015 | order_idempotency | partial unique idx `orders_pending_session_product_idx` on (session_id, product_id) WHERE status='pending_payment' |
| 00016 | seller_auth | sellers += supabase_user_id, stripe_onboarding_complete, business_type CHECK(individual/company), gst_number, phone, address jsonb, logo_url, description |
| 00017 | seller_earnings | ledger table + UNIQUE(order_id) |
| 00018 | product_seller_fields | products.deleted_at (soft delete) + products.product_quality_score int default 50 |
| 00019 | returns | returns table + sellers.return_policy jsonb default + seller_earnings status CHECK allows 'cancelled' |
| 00020 | product_quality_score | idempotent re-add (already in 00018) + index |
| 00021 | webhook_delivery_log | webhooks.last_delivered_at, webhooks.last_delivery_status |

**Key tables & important columns:**

- **sellers**: id, name, email(unique), supabase_user_id, trust_score (default 80), status ('active'|'suspended'), business_type, gst_number, phone, address(jsonb), logo_url, description, return_policy(jsonb), stripe_account_id, created/updated_at.
- **products**: id, seller_id, name, brand, category, description, specs(jsonb), images(text[]), price(numeric 10,2), stock(int), currency, availability ('in_stock'|'out_of_stock'|'discontinued'), is_sandbox(bool), deleted_at, embedding(vector 1536), search_vector(tsvector), product_quality_score(int default 50), created/updated_at.
- **developers**: id, name, email(unique, lowercased), supabase_user_id, plan ('free'|'starter'|'pro'|'enterprise', default free).
- **api_keys**: id, developer_id, key_hash(sha256), key_prefix, is_sandbox, name, last_used_at, plan(joined).
- **orders**: id, session_id, product_id, **developer_id**, seller_id, quantity, unit_price, total_price, currency, status ('pending_payment'|'paid'|'processing'|'shipped'|'delivered'|'cancelled'|'returned'), stripe_payment_intent_id, shipping_address(jsonb), tracking_number, carrier, estimated_delivery, expires_at, buyer_email, is_sandbox, created/updated_at.
- **order_events**: id, order_id, event_type, payload(jsonb), created_at. (full audit trail)
- **seller_earnings**: id, seller_id, order_id(UNIQUE), gross_amount, platform_fee, seller_amount, status ('pending'|'paid'|'cancelled'), created_at.
- **returns**: id, order_id(UNIQUE), seller_id, reason, description, status ('requested'|'approved'|'rejected'|'pickup_scheduled'|'picked_up'|'received'|'refunded'), pickup_carrier, pickup_tracking_number, pickup_date, pickup_address(jsonb snapshot), seller_notes, refund_amount, created/updated_at.
- **webhooks**: id, developer_id, url, events(text[]), secret('whsec_am_…'), is_active(default true), last_delivered_at, last_delivery_status, created_at.
- **searches**: id, developer_id, session_id, query, result_count, top_result_id, latency_ms, created_at.

---

## 5. The 5 Phases

- **Phase 1 — Foundation:** schema, pgvector embeddings, seed data, trust-score engine.
- **Phase 2 — Search:** `POST /v1/search` hybrid semantic+keyword **RRF** search. 10 verification + 8 quality-audit queries pass.
- **Phase 3 — Checkout:** `POST /v1/order`, hosted checkout page, Stripe PaymentIntent, webhook confirmation, `GET /v1/order/:id`. Real payment verified end-to-end.
- **Phase 4 — Developer portal + MCP:** API-key auth, rate limiting, sandbox environment, dev portal UI, MCP server. (63/63 stress test.)
- **Phase 5 — Seller platform:** seller auth (Supabase), product CRUD, order management (process/ship), returns (Shopify-style reverse pickup), product quality score, earnings ledger. **Stripe Connect intentionally removed → replaced by `seller_earnings` ledger.**

---

## 6. API Surface

### 6.1 Agent API (`/v1/*`, API-key auth via global preHandler)
- `POST /v1/search` → 200, `{ results:[…], total_results }`. (see §7)
- `POST /v1/order` → 201, `{ order_id, checkout_url, expires_in:900, summary:{product_name,total_price,currency} }`.
- `GET /v1/order/:id` → 200 full order. **PUBLIC/keyless** (checkout page reads it) BUT **scoped to owner when a key is supplied** (returns 404 for another developer's order).
- `PATCH /v1/order/:id/details` → update buyer_email/shipping_address while pending. PUBLIC (checkout form).
- `POST /v1/return` → 201 `{ return_id, status:'requested', message }`. Scoped to the order's developer (404 otherwise). Enforces seller return policy + window.
- `GET /v1/return/:id` → 200. Scoped to owner (404 otherwise). Returns description + (if scheduled+) pickup fields nested AND flat.
- `POST /v1/sandbox/confirm/:orderId` → 200. **PUBLIC** (checkout UI), but **rejects live keys with 403**. Sandbox-orders only.
- `POST /v1/webhooks/stripe` → Stripe HMAC-verified. Forged signature → 400.

**preHandler exemptions** (no API key required): `/v1/webhooks/*`, `GET /v1/order/:id`, `PATCH /v1/order/:id/details`, `POST /v1/sandbox/confirm/*`. Everything else under `/v1/` requires `requireAuth`.

### 6.2 Developer portal (`/portal/*`, x-supabase-user-id auth)
- `POST /portal/signup` (creates dev + live+test keys; 409 on dup email, case-insensitive).
- `GET /portal/me`, `GET/POST /portal/keys`, `DELETE /portal/keys/:id`, `GET /portal/usage`.
- `GET/POST /portal/webhooks`, `DELETE /portal/webhooks/:id`, `POST /portal/webhooks/:id/test`.

### 6.3 Seller portal (`/portal/sellers/*`, x-supabase-user-id auth)
- `POST /portal/sellers/signup` (keyed by supabase_user_id; 409 dup email/dup uid; 400 invalid business_type/missing fields).
- `GET/PATCH /portal/sellers/me`, `GET /portal/sellers/me/stats`, `GET /portal/sellers/me/earnings`.
- `GET/POST /portal/sellers/products`, `GET/PATCH/DELETE /portal/sellers/products/:id`, `POST /portal/sellers/products/images`, `POST /portal/sellers/products/:id/images`.
- `GET /portal/sellers/orders`, `GET /portal/sellers/orders/:id`, `PATCH /portal/sellers/orders/:id/process`, `PATCH /portal/sellers/orders/:id/ship`.
- `GET /portal/sellers/returns`, `GET /portal/sellers/returns/:id`, `POST …/{approve,reject,schedule-pickup,picked-up,received}`.
- `GET /portal/sellers/settings/return-policy`, `PATCH …` (window_days ∈ {7,14,30,60}).
- `GET /portal/sellers/payouts` (paginated alias of earnings: `?limit&offset` → `{earnings, totals, has_more, total, limit, offset}`).

### 6.4 Cross-cutting (added in Mega 2)
- **Every 4xx/5xx** body is JSON `{ error: string, message: string }` (enforced by an `onSend` hook — never a naked string/HTML/stack trace).
- **`X-Response-Time`** header on every response (onSend hook).

---

## 7. Search Algorithm (`apps/api/src/lib/search.ts` + `routes/search.ts`)

**Hybrid: semantic (vector) + keyword (tsvector), combined with Reciprocal Rank Fusion.**

- `RRF_K = 60`. Fused score = Σ `1/(RRF_K + rank)` across the semantic ranking and keyword ranking.
- **Embedding:** OpenAI `text-embedding-3-small`. There is a query-embedding cache (warm queries skip the OpenAI call → fast).
- **Hard filters in BOTH CTEs:** `availability <> 'discontinued' AND deleted_at IS NULL AND seller_id IN (SELECT id FROM sellers WHERE status='active')`. So discontinued/deleted products and suspended sellers' products never appear.
- **finalScore multipliers** (applied to fused score):
  - Trust: `score += (sellerTrustScore/100) * score * 0.1` (±10% by trust).
  - Quality: `qualityMultiplier = ((productQualityScore - 50)/50) * 0.15` → ±15%, neutral at 50.
  - Category match boost: `score *= 1.15`; category mismatch penalty when a category was clearly specified.
  - **Brand signals:** "better than boAt" / "alternative to X" → **anti-brand** (suppress that brand from top results); positive brand mention → boost.
- **Explicit filters are HARD filters** (applied after scoring, before slice):
  - `filters.min_price` / `filters.max_price`.
  - `filters.category` — normalized: `lowercase + strip [\s_-]` so `wireless_earbuds` == `Wireless Earbuds`.
- **Result fields (15, all required by schema tests):** id, name, brand, category, price, currency, image (=images[0]), availability, delivery_eta (derived from seller trust), seller_name, seller_trust_score, relevance_score (score/maxScore rounded), is_purchasable (`availability==='in_stock' && stock>0`), specs_summary (buildSpecsSummary, truncates), quality_score.
- **No seller PII in results** — only seller_name + seller_trust_score. No email/phone/address/gst/bank.
- **Sandbox isolation:** sandbox (test) key → only `is_sandbox=true` products; live key → only `is_sandbox=false`. Enforced by the `is_sandbox` flag (the `[TEST]` name prefix is just a seeding convention).
- Search is logged to `searches` (fire-and-forget; eventually consistent — poll in tests).
- **Note:** with only 50 rows the Postgres planner may seq-scan instead of using HNSW/GIN — that's correct optimization for tiny tables; the indexes exist.

**Categories (display names):** Wireless Earbuds, Wired Earphones, plus headphones/speakers/chargers/cables/watches/etc. Always use the display form in queries; `filters.category` normalizes snake_case.

---

## 8. Quality Score & Trust Score

### 8.1 Product quality score (`apps/api/src/lib/quality.ts`)
- New product = **50**. `< 5 orders` → stays **50**.
- Else: `returnPoints = max(0, 40 - returnRate*4)` (0–40) + `repeatPoints = (repeatRate/100)*35` (0–35) + `volumePoints = min(25, floor(total/10)*5)` (0–25). **Range 0–100**, always clamped.
  - 5 orders / 0 returns → 40 (volume bonus starts at 10 orders). **The spec sometimes says "5 orders → >50" — that's wrong; the formula yields 40.**
  - 10 orders / 2 returns(received) → 5. 100% repeat (50 sessions ×2) → 100. 100 orders / 99 returns → 25 (never negative).
- `getProductQualityMetrics.total_orders` counts status IN (paid, processing, shipped, delivered, **returned**) → returnRate = returns / all-orders.
- Recalc triggers (fire-and-forget): sandbox confirm, Stripe webhook paid, seller-returns `received`, order repeat-purchase.

### 8.2 Seller trust score (`lib/trust.ts`)
- New seller = **80**. Recalculated on real paid orders. **Both seeded sellers are NOT both 80** — one was recalculated to **95** by a real payment. So "all sellers at 80" is FALSE; valid range 0–100.

---

## 9. Financial Model (the earnings ledger)

**No Stripe Connect.** Money split is recorded in `seller_earnings`, not transferred.

- Platform fee = `STRIPE_PLATFORM_FEE_PERCENT` (default **10%**). For gross G:
  - `platform_fee = round(G * 0.10 * 100)/100`, `seller_amount = round((G - fee) * 100)/100`. **`fee + seller == gross` exactly.**
  - Examples (all exact): ₹99→9.90/89.10, ₹999→99.90/899.10, ₹1000→100/900, ₹1299→129.90/1169.10, ₹999999.90→99999.99/899999.91.
- One earnings row **per paid order**, idempotent via `UNIQUE(order_id)` (createSellerEarning ON CONFLICT DO NOTHING). Double-confirm → still 1 row.
- Status `pending` on creation → `cancelled` when a return is **received** (NOT on reject) → (`paid` has no API yet; payouts deferred).
- `unit_price`/`total_price` are **snapshotted at order time** — editing the catalog price later does NOT change existing orders.
- Sandbox orders DO create earnings rows (the ledger has no sandbox flag) but they are scoped to their own (sandbox) order and never counted in live earnings (`o.is_sandbox=false` filters).
- `getSellerStats.month_revenue` = payout basis = 90% of non-returned gross. `month_orders` includes returned (it still happened); revenue excludes returned.

---

## 10. Orders, Stock & Returns

### 10.1 Stock / overselling (critical, fixed in P5 R2)
- Stock is reserved **atomically at payment** via `decrementStockIfAvailable(productId, qty)` = `UPDATE products SET stock = stock - qty WHERE id AND stock >= qty` → boolean.
- `decrementStock` no longer auto-flips availability. **Availability = seller intent; stock = the purchasable gate.** A sold-out product stays `in_stock` with stock 0 → `is_purchasable=false` in search.
- **Sandbox confirm reverts on oversell:** if `decrementStockIfAvailable` returns false after the order was marked paid, the order is set to `cancelled`, an `order.cancelled` event logged, and **409 OUT_OF_STOCK** returned. So N concurrent confirms on stock N → all N paid; on stock < N → exactly stock succeed, rest cancelled/409. Stock never goes negative.
- Order CREATION checks `availability==='in_stock' && stock>=qty` (non-atomic; the atomic guard is at payment).
- **`getProductWithSeller` (order creation) filters `deleted_at IS NULL AND s.status='active'`** — you cannot order a soft-deleted product or a suspended seller's product (404). (Fixed in Mega 2.)

### 10.2 Order lifecycle / events
`order.created → order.paid → order.processing → order.shipped` (+ `order.cancelled` on oversell/expiry). Direct `paid → shipped` IS allowed (ship accepts paid|processing). Double process/ship → 409. Ship validation: valid carrier, future estimated_delivery, tracking_number required.

### 10.3 Returns — Shopify-style reverse pickup (seller arranges courier; buyer ships nothing)
State machine (atomic transitions via `transitionReturn(id, sellerId, fromStatus, toStatus, extra)`):
`requested → approved → pickup_scheduled → picked_up → received` (+ `rejected` terminal).
- `POST /v1/return` (agent): requires order shipped+ and within policy window; respects `accepts_returns=false` (→400 RETURNS_DISABLED) and `window_days` (→400 RETURN_WINDOW_EXPIRED). Snapshots `pickup_address` = order.shipping_address. Catches concurrent UNIQUE(order_id) 23505 → 409 (not 500). `return.requested` order_event created.
- Seller transitions: approve / reject (requires `seller_notes`) / schedule-pickup (valid carrier, future pickup_date, tracking) / picked-up / received.
- **On `received` (6 side effects):** status→received, refund_amount set (= seller_amount, e.g. 900), `seller_earnings.status→cancelled`, `order.status→returned`, `return.received` event, webhook with refund_amount. Quality recalc fires.
- Each transition emits an order_event + a developer webhook (scoped to the owning developer).
- **Auto-suspend:** after a return is received, if recent_received ≥ 5 OR rate > 20% → `suspendSeller` → seller.status='suspended' → all their products vanish from search.
- No-body POSTs (process/approve/picked-up/received) — the **web proxy must send `body:'{}'`** (Fastify rejects an empty `application/json` body with 400).

---

## 11. Webhooks (developer-facing) — PRIVACY-SCOPED

**The single most important production fix (Mega 2):** webhooks are delivered **only to the developer who owns the order** — never broadcast to all subscribers.

- `fireDeveloperWebhook(eventType, payload, developerId)` → `getWebhooksForEventAndDeveloper(eventType, developerId)` (`WHERE is_active AND $1=ANY(events) AND developer_id=$2`).
- All 4 fire sites pass the order's developer_id: sandbox confirm + Stripe webhook (`order.developer_id`), seller ship + seller-returns emit (`getOrderDeveloperId(orderId)`).
- **Root cause that hid this for a while:** `getOrderById` (an enriched JOIN) had **omitted `o.developer_id`** → it was `undefined` → webhooks fired to nobody / ownership checks skipped. Fixed by adding `o.developer_id` to the SELECT.
- Events: `order.confirmed, order.shipped, return.approved, return.rejected, return.pickup_scheduled, return.picked_up, return.received`.
- **Signature:** `X-Stok-Signature: sha256=<64 hex>` = HMAC-SHA256(secret, body). Any body change invalidates it. Headers also include `X-Stok-Event`, `X-Stok-Event-Attempt`.
- **Delivery:** up to **3 attempts** (initial + 2), exponential backoff (1s, 2s). 5s fetch timeout (`AbortSignal.timeout(5000)`). Never throws / never blocks the main flow. Retries on non-2xx AND on timeout/network error.
- **Delivery log (00021):** `webhooks.last_delivered_at` + `last_delivery_status` (0 = network failure) recorded per attempt, surfaced in `GET /portal/webhooks`.
- Payload shape: `{ event, timestamp(ISO, fresh <10s), data:{…} }`.
- **No webhook count limit** per developer (documented; all stored, no 500). **URLs with embedded credentials** (`https://user:pass@…`) are rejected (400).

---

## 12. Security Model & Auth Details

- **API keys:** `sk_live_am_…` / `sk_test_am_…`. Stored as sha256 hash. `requireAuth` (middleware/auth.ts) checks Bearer prefix + key prefix → cache (`authcache.ts`, short TTL, caches negatives too) → DB. **Strict matching: no whitespace trimming** (leading/trailing space → 401). Case-sensitive. `resolveAuth(request)` is the non-failing variant (returns ctx | null) used for capability-URL endpoints.
- **Rate limits** (`lib/ratelimit.ts`, per developer per day): free 100 searches/10 orders; starter 1000/100; pro 10000/1000; enterprise unlimited (-1). Headers `X-RateLimit-Limit/Remaining/Reset`. **Cannot be bypassed** by header reformatting (lowercase bearer / extra space / null byte → 401 or client-refused, never 200).
- **Isolation guarantees (all tested, zero leaks):**
  - Cross-seller: every cross-seller product read/update/delete/image/ship/return → **404** with target unchanged. Choke point: ownership-scoped queries (`getSellerProductById(id, sellerId)` returns null if not owned).
  - Cross-developer: `GET /v1/order/:id` and `GET /v1/return/:id` with another dev's key → 404. Webhooks scoped to owner.
  - Sandbox ↔ live: sandbox orders never touch live products' stock or live earnings.
  - Seller impersonation via body `seller_id` → ignored (identity comes from the session, not the body).
- **Injection:** all inputs parameterized; SQLi/XSS payloads stored as **data** (tables intact, rendered escaped). Image upload validates **magic bytes** (PNG/JPEG/GIF/WEBP) + size ≤5MB; non-image-as-image → 400.
- **No stack traces / file paths / line numbers** in any error body (onSend + explicit handlers).
- **Supabase Auth:** weak passwords rejected (≥6 chars), wrong/nonexistent login → generic "Invalid login credentials" (no enumeration). Access JWTs are stateless (valid until exp); password change invalidates the credential, not the already-issued access token. **Tests use `admin.createUser` to avoid signUp rate limits**; clean up with `admin.deleteUser`.
- **CORS** is permissive (`origin:true`) — safe because API-key endpoints are server-to-server (CORS is browser-only) and the browser portal uses same-origin Next.js proxies.
- **Input caps that prevent 500s:** product `price ≤ 9,999,999.99` (numeric(10,2) overflow guard; ×max-qty 10 still fits), `images ≤ 5`, order `session_id ≤ 255` (btree row-size on the idempotency index), name ≤ 200, description ≤ 5000.
- **Image upload bodyLimit:** global Fastify limit is small (~1MB); the two image routes get a **route-level 10MB bodyLimit** (the 1MB default was 413-ing legitimate ~2MB photos).

---

## 13. Deferred Work (`STRIPE_TODO.md`)

All marked as TODO, intentionally not built:
- **Stripe Connect**: seller onboarding, payouts, transfer/split, refunds. (Replaced for now by the `seller_earnings` ledger — recording only, no money movement.)
- **Razorpay** integration.
- **Deployment**: Railway/Vercel/Cloudflare. (User chose "skip deployment entirely.")
- Payout execution: `seller_earnings.status pending → paid` has no API yet.
- Real refund money movement on return received (currently just records refund_amount + cancels the earning).

---

## 14. Sandbox Environment

- Test key `sk_test_am_…`. Search returns only `is_sandbox=true` products (the 20 `[TEST] …`).
- Orders created with a test key are `is_sandbox=true`; `checkout_url` → `/checkout/sandbox/[orderId]`; `stripe_payment_intent_id` = `pi_test_mock_<uuid>` (no real Stripe).
- `POST /v1/sandbox/confirm/:id` simulates payment (live keys → 403). The sandbox checkout page redirects cancelled/non-pending orders to `/checkout/expired` and renders a "Paid" state (no pay button) for paid orders.
- Tests almost always use sandbox orders to exercise the full lifecycle without real Stripe. **Sandbox products are NOT managed by the seller portal** (portal manages `is_sandbox=false` only) — so to edit/delete a sandbox product in a test, write to the DB directly.

---

## 15. Complete Test History — Every Phase, Every Result

> Pattern across all tests: build a comprehensive multi-block script, run, fix every REAL product bug, document any spec-vs-reality mismatch as `[adapted]`, clean ALL test data FK-safely, restore catalog to 50/20/2. Threshold 97%+. Auto-fail on any 500 / security failure / cross-seller leak / financial error / data corruption. **Never game tests.**

### 15.1 Per-phase verification (during build)
| Phase | Verification | Result |
|---|---|---|
| Phase 1 | Foundation (schema, embeddings, seed, trust engine) | built + verified |
| Phase 2 | Search: 10 verification queries + 8 quality-audit queries | all pass |
| Phase 3 | Checkout: real Stripe payment end-to-end | verified |
| Phase 4 | Dev portal + MCP: `scripts/verify-phase4.ts` | **12/12** |
| Phase 5 Part 1 | seller auth + earnings ledger | built + verified (ledger E2E) |
| Phase 5 Part 2 | product CRUD + storage + **isolation** | **16/16** (B→A product read/update/delete/image all 404) |
| Phase 5 Part 3 | order mgmt / ship / **webhook fires** | **17/17** (order.shipped webhook verified via local receiver) |
| Phase 5 Part 4 | returns reverse-pickup state machine | **30/30** (all 5 webhooks, address snapshot, auto-suspend) |
| Phase 5 Part 5 | product quality score | **14/14** (formula, recalc triggers, ranking) |

### 15.2 Stress tests (the full ledger — 7 suites, all passed)
| # | Script | Score | Scope |
|---|---|---|---|
| 1 | `stress-test-phase4.ts` | **63/63** | Phase 4: auth, rate limits, sandbox, dev portal, security, load, edge cases (7 blocks) |
| 2 | `stress-test-full.ts` | **78/79 (98.7%)** | Full-system Phases 1–4 (7 blocks: data integrity, search quality, agent sessions, auth/limits, security, consistency, performance). Only miss = GET-order <100ms (≈165ms, remote-DB RTT; not an auto-fail). |
| 3 | `stress-test-3.ts` | **81/81 (100%)** | 8 blocks, zero overlap: embedding pipeline/multilingual, search edge cases, order-flow edges, API-key internals, webhook system, portal/DX, resilience (incl. live `tsx watch` restart), business logic. |
| 4 | `stress-test-p5-r1.ts` | **90/90 (100%)** | Phase 5 R1: auth security, product mgmt, orders, returns, quality, earnings, return policy, integration (8 blocks). |
| 5 | `stress-test-p5-r2.ts` | **69/69 (100%)** | Phase 5 R2: race conditions, financial precision, edge cases, data consistency. |
| 6 | `stress-test-mega1.ts` | **96/96 (100%)** | Mega 1 = P5 R3 adversarial (48) + Full-System R1 (48). |
| 7 | `stress-test-mega2.ts` | **88/88 (100%)** | Mega 2 = Full-System R2 integration (34) + R3 production-readiness (54). **🏁 CERTIFIED.** |

(Pre-Phase-5 stress total ≈ 63+78+81 = **222/223** across suites 1–3.)

### 15.3 Real bugs fixed, by suite

**`stress-test-full.ts` (Phases 1–4):** order concurrency safety — `createOrder` idempotent per (session_id, product_id) while pending (partial unique index `00015` + ON CONFLICT DO NOTHING; route replays existing order, `idempotent:true`); `markOrderPaidIfPending` atomic `UPDATE … WHERE status='pending_payment'` so only the race-winner decrements stock + emits `order.paid` (closes the TOCTOU double-decrement window in both sandbox confirm and Stripe webhook); order create parallelizes reads + fires `order.created` fire-and-forget for <500ms.

**`stress-test-3.ts` (7 fixes):** (1) search visibility — `searchHybrid` filters `availability <> 'discontinued'` (out-of-stock stays searchable with `is_purchasable=false`; only discontinued hidden); (2) explicit `filters.min_price/max_price` are HARD constraints (impossible range → 0 results); (3) developer webhooks extracted to `lib/developer-webhooks.ts` (shared by Stripe + sandbox); (4) signature header standardized to `X-Stok-Signature: sha256=<hex>`; (5) sandbox confirm fires `order.confirmed` (webhooks testable without real Stripe); (6) signup email lowercased (case-insensitive dedupe → 409); (7) `ShippingAddressSchema` state/postal_code optional (address completed via PATCH). Also: webhook URL rejects non-http(s) schemes; checkout page redirects to `/checkout/expired` on `expires_at` passed.

**`stress-test-p5-r1.ts` (5 fixes):** (1) `/v1/return` enforces `return_policy.accepts_returns` (→400) + uses `policy.window_days` (was hardcoded 30); (2) `window_days` restricted to {7,14,30,60}; (3) seller order detail redacts full buyer address (city/state only) until paid; (4) `getSellerStats.month_orders` counts returned orders; (5) `getProductQualityMetrics.total_orders` includes 'returned'.

**`stress-test-p5-r2.ts` (7 fixes):** (1) **overselling prevented** (`decrementStockIfAvailable` + sandbox revert to cancelled/409); (2) `decrementStock` no longer auto-flips availability; (3) `filters.category` hard filter + normalization; (4) `/v1/return` concurrent 23505 → 409; (5) added paginated `GET /portal/sellers/payouts`; (6) `getSellerStats` parallelized (~330ms warm); (7) seller orders `?status=` accepts returned/cancelled/pending_payment.

**`stress-test-mega1.ts` (6 fixes):** (1) product price overflow → 500 (capped ≤9,999,999.99 + images ≤5); (2) image routes 10MB bodyLimit (1MB default 413-ed real photos); (3) image size ≤5MB + magic-byte validation; (4) order session_id capped 255 (btree); (5) webhook URL credentials rejected; (6) webhook delivery logging (00021).

**`stress-test-mega2.ts` (7 fixes):** (1+2) **`getOrderById` omitted `o.developer_id`** → fixed → enabled **webhook privacy scoping** (`getWebhooksForEventAndDeveloper`, all 4 fire sites pass developer_id) + order-read ownership; (3) `GET /v1/order/:id` scoped to owner when keyed (else 404), public keyless for checkout; (4) **`getProductWithSeller` filters `deleted_at IS NULL` + `status='active'`** (deleted/suspended products were orderable by direct ID); (5) `GET /v1/return` adds description + flat pickup fields; (6) onSend hook → all 4xx/5xx are `{error,message}` JSON; (7) `X-Response-Time` header.

### 15.4 Performance baselines (Mega 2, measured against REMOTE Supabase+OpenAI from dev machine)
Warm search **p50 167ms** (meets <200ms target even remotely). Cold p50 ~680ms, search p95 ~940ms, order create p95 ~1090ms, order get p95 ~315ms, dashboard stats ~404ms, webhook delivery ~1480ms. The non-warm numbers are network-RTT-bound; production colocation would meet the spec's aggressive targets. **Not a code defect.**

---

## 16. Gotchas / Hard-Won Lessons (read before debugging)

1. **`tsx watch` stale worker:** `pkill -f "tsx watch"` kills the WATCHER but not its spawned worker child (different command line `node … tsx/dist/loader…`). The old worker keeps :3001 bound and serves **stale code**, so your fix "doesn't work." Find the real listener with `lsof -ti :3001`, kill it, then restart `npx tsx watch src/index.ts` (background). Symptom: some changes (e.g. index.ts onSend) appear live while route/lib changes don't.
2. **Enriched JOIN selects:** `getOrderById` returns product_name/seller_name etc. via JOINs — if you need an `orders` column (like `developer_id`), it must be explicitly in the SELECT list. (This caused the webhook/ownership bug.)
3. **Leading regex at statement start** = division parse error. `/regex/.test(x) ? …` as a statement after a line ending in `)` is parsed as `prev / regex / .test` → "X is not defined". Assign to a `const` first.
4. **FK-safe cleanup ordering:** delete `api_keys` BEFORE `developers`; delete dependent rows (returns, order_events, seller_earnings) and null `searches.top_result_id`/`searches.developer_id` BEFORE orders/products/developers. **Also clean orders placed by test DEVELOPERS on seeded products** (e.g. sandbox-isolation tests order seeded sandbox products with a test dev key — those orders have a seeded seller_id and won't be caught by a seller-marker cleanup; clean by developer_id too).
5. **Fire-and-forget logging races cleanup:** search logging is async; deleting a developer immediately after searches → FK violation. Sleep ~600ms (or retry) before deleting.
6. **Empty `application/json` body → Fastify 400.** No-body seller POSTs need `body:'{}'` from the web proxy / `body:{}` from fetch.
7. **Supabase rejects `.test` email domains** in Auth. Use `@example.com` for Supabase Auth users; `@stress.test` is fine for the seller/developer signup *records* (not Auth). Use `admin.createUser` to dodge signUp rate limits in loops.
8. **Embeddings are async (~4s, pg_net → edge fn).** Poll `embedding IS NOT NULL` (up to ~30s) before asserting searchability. Distinctive product names (e.g. `Auralis <Token> Earbuds`) embed + search far more reliably than gibberish tokens.
9. **Remote DB latency** dominates everything; ~150ms/query. Parallelize independent reads with `Promise.all`. Don't expect sub-200ms for multi-round-trip endpoints from a dev machine.
10. **Quality formula vs prompts:** specs sometimes claim "5 orders → score >50"; the real formula gives 40 (volume bonus needs 10 orders). Trust the formula, note the discrepancy.
11. **Stress-test markers:** prefix every test seller/dev `supabase_user_id` (e.g. `p5r1_`, `mega2_`) and clean by `LIKE 'marker\_%'`. Verify final catalog = 50 real / 20 sandbox / 2 sellers, 0 orphans, 0 leftover marker rows.

---

## 17. How to Verify the System Quickly

```bash
# 1. Both servers (from repo root, separate terminals or background):
npm run dev:api   # :3001  (or: cd apps/api && npx tsx watch src/index.ts)
npm run dev:web   # :3000

# 2. Health:
curl -s http://localhost:3001/health        # {"status":"ok",...}

# 3. Catalog invariant (psql via DATABASE_URL or a tsx one-off):
#    real=50 (is_sandbox=false, deleted_at IS NULL), sandbox=20, sellers=2, null embeddings=0

# 4. Full regression (each restores catalog; run from repo root):
npx tsx scripts/stress-test-mega2.ts   # the production-readiness cert, 88/88
npx tsx scripts/stress-test-mega1.ts   # 96/96
# (p5-r1, p5-r2, phase4 also available)
```

A green run ends with `🏁 PRODUCTION READINESS: CERTIFIED` and `FINAL CATALOG STATE: 50 / 20 / 2 / 0 null / 0 orphans`.

---

## 18. Conventions for the Next Session

- **Do not `git push` until the user explicitly says so.** (Standing rule.)
- Match surrounding code style; the codebase favors terse, commented, single-responsibility functions.
- When a stress-test spec contradicts the real architecture, **adapt the test to reality and document it `[adapted]`** — do not change the product to match a flawed spec, and do not game the assertion.
- Always clean up test data and re-verify the 50/20/2 catalog before reporting done.
- Memory index for this project lives at `/Users/andrewwilson/.claude/projects/-Users-andrewwilson-my-projects-amazon/memory/` (`MEMORY.md` + `project_agentmart.md` + feedback notes). Keep it updated with milestones, not code structure.
```
```
