# Stok

**A product marketplace built for AI agents to shop on.** Agents search the catalog and place orders through an API. A human then pays on a hosted checkout page. Sellers list products and fulfil orders through a web portal.

> Formerly "AgentMart". That is why the directory and the `sk_*_am_` API-key prefix still say `am`.

For the full design history, edge cases, test ledger and debugging notes, see [`projectdetails.md`](./projectdetails.md). Deferred payments work is tracked in [`STRIPE_TODO.md`](./STRIPE_TODO.md).

---

## How a sale works

```
 AI agent                       Stok API (:3001)                  Human / Seller (Next.js :3000)
 ────────                       ────────────────                  ──────────────────────────────
 POST /v1/search  ───────────▶  hybrid vector + keyword search
                                ranked results  ◀─────────────
 POST /v1/order   ───────────▶  order (pending_payment, 15 min)
                                + checkout_url  ◀─────────────
 hands checkout_url to human ─────────────────────────────────▶  /checkout/:id  (Stripe card form)
                                Stripe webhook ◀──────────────── pays
                                order → paid, stock decremented,
                                seller_earnings row, email,
                                order.confirmed webhook ────────▶ developer's webhook URL
                                                                 /sellers/dashboard: process → ship
                                order.shipped webhook ──────────▶ developer's webhook URL
 POST /v1/return  ───────────▶  return state machine ──────────▶ seller approves → pickup → received
```

Each kind of user signs in a different way. These must never be mixed:

| Actor | Auth | Routes |
|---|---|---|
| Agent / developer (programmatic) | `Authorization: Bearer sk_live_am_…` or `sk_test_am_…` | `/v1/*` |
| Developer (managing keys/webhooks in the browser) | Supabase Auth session → Next.js proxy sets `x-supabase-user-id` | `/portal/*` |
| Seller | Supabase Auth session → Next.js proxy sets `x-supabase-user-id` | `/portal/sellers/*` |

The browser never calls the API directly for portal actions. The route handlers under `apps/web/app/api/portal/**` check the Supabase session on the server, then forward the request to the API with two headers:

- `x-supabase-user-id`: the signed-in user
- `x-internal-secret`: the shared `INTERNAL_API_SECRET`

The API rejects any `/portal/*` request without the correct secret, so nobody who reaches port 3001 directly can pretend to be a seller or developer. In production, the API refuses to start without the secret.

Signup is a special case. It happens right after `supabase.auth.signUp`, when there may not be a session yet. So before creating a seller or developer record, the signup proxy checks that the claimed user ID is either the current session or a real Supabase user with the same email who signed up in the last 15 minutes.

---

## Repository layout

npm workspaces monorepo (root package name `stok`).

```
apps/
  api/            Fastify + TypeScript API — the core (port 3001)
    src/index.ts        server setup, global auth preHandler, error/latency hooks, expired-order sweeper
    src/middleware/     API-key auth (sha256 lookup + short-TTL cache)
    src/routes/         search, order, sandbox, webhooks (Stripe), returns,
                        portal (developer), seller-{portal,products,orders,returns}
    src/lib/            db (all SQL), search scoring, embeddings, trust, quality,
                        ratelimit, keys, storage, email (Resend), developer-webhooks
  web/            Next.js 14 App Router (port 3000)
    app/checkout/       hosted checkout (live Stripe + sandbox), success, expired
    app/developers/     developer portal: login, dashboard, keys, usage, webhooks
    app/sellers/        seller portal: signup/login, products, orders, returns, payouts, settings
    app/api/portal/     server-side proxies to the API (session → x-supabase-user-id)
    middleware.ts       redirects unauthenticated users away from portal pages
  mcp/            MCP server on Cloudflare Workers (built, not deployed)
packages/
  types/          shared TS types (@stok/types)
supabase/
  migrations/     00001–00022 SQL migrations (applied automatically by `supabase start`)
  functions/      generate-embedding edge function (called by a DB trigger)
  migrate.ts      runs every migration in order against a hosted DB (idempotent)
  seed.ts         seeds 2 sellers + 50 real products
scripts/          sandbox seeding, verification, stress tests, diagnostics
```

---

## Tech stack

- **API:** Fastify 4, Zod, `pg` (pool of 10), run with `tsx watch` in dev.
- **Web:** Next.js 14 (App Router), `@supabase/ssr`, Stripe Elements, Recharts.
- **Database:** Supabase Postgres with **pgvector** (HNSW index) and **tsvector** (GIN index) for full-text search.
- **Embeddings:** 1536 dimensions. A built-in local embedding is the default and needs no API key. OpenAI `text-embedding-3-small` is optional.
- **Payments:** Stripe PaymentIntents. This is optional: sandbox keys run the full order flow without Stripe. Stripe Connect is deferred, so seller payouts are only recorded in a ledger and no money is actually transferred to sellers yet.
- **Email:** Resend. Optional: if no key is set, emails are skipped.
- **Storage:** Supabase Storage bucket `product-images`.
- **MCP:** Cloudflare Workers with the `agents` and `@modelcontextprotocol/sdk` packages.

---

## Getting started

Everything runs on your machine. **You don't need any accounts or API keys**: no Supabase project, no OpenAI and no Stripe.

### Prerequisites
- Node 20+
- Docker, running (Docker Desktop, OrbStack or colima). The local Supabase stack runs in containers.

### Setup (one command)
```bash
npm install
npm run setup
```

`npm run setup`:

1. Starts a local Supabase stack with `supabase start`. This gives you Postgres with pgvector, logins, file storage and Studio. All migrations and the `product-images` bucket are applied automatically. The first run downloads the Docker images, which takes a few minutes.
2. Writes `.env` and `apps/web/.env.local` with the local URLs and keys and a fresh `INTERNAL_API_SECRET`. Any existing files that point somewhere else are backed up first.
3. Seeds the catalog: 2 sellers, 50 products and 20 `[TEST]` sandbox products.

It is safe to run again.

### Run
```bash
npm run dev:api     # http://localhost:3001  (GET /health)
npm run dev:web     # http://localhost:3000
```

| Local service | URL |
|---|---|
| Web app (checkout, developer and seller portals) | http://localhost:3000 |
| API | http://localhost:3001 |
| Supabase Studio (browse the database) | http://127.0.0.1:54323 |
| Local email inbox | http://127.0.0.1:54324 |

Other database commands: `npm run db:stop` stops the containers. `npm run db:reset` wipes the database and re-seeds it.

### Try it end to end
1. Open http://localhost:3000/developers/login and sign up with any email, for example `dev@example.com`. You'll be shown a live key and a **test key** (`sk_test_am_…`).
2. Search with the test key:
   ```bash
   curl -s localhost:3001/v1/search -H "Authorization: Bearer sk_test_am_..." \
     -H "Content-Type: application/json" -d '{"query":"bluetooth speaker","limit":3}'
   ```
3. Order one of the results. Copy its `id`:
   ```bash
   curl -s localhost:3001/v1/order -H "Authorization: Bearer sk_test_am_..." \
     -H "Content-Type: application/json" -d '{"product_id":"<id>","quantity":1}'
   ```
4. Open the returned `checkout_url` and click **pay**. That's a simulated payment. The order becomes `paid`, the stock goes down, and a seller earnings row and webhooks are created.
5. Sign up as a seller at http://localhost:3000/sellers/signup to list products, process and ship orders, and handle returns.

The seeded products all belong to the two built-in sellers. A seller you sign up starts with an empty catalog, and new products you add are searchable straight away with a **live** key. To test ordering one of them without Stripe, add the product directly in Studio with `is_sandbox = true`.

### Optional services
Every optional service is switched off unless you add its key to `.env`:

| Feature | How to enable |
|---|---|
| OpenAI embeddings (better meaning-based search) | Set `EMBEDDING_PROVIDER=openai` and `OPENAI_API_KEY`. Run `npx tsx scripts/set-trigger-config.ts`, deploy the `generate-embedding` edge function, then run `npm run reembed` |
| Real card checkout for live keys | Set `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` with Stripe test keys. Then run `stripe listen --forward-to localhost:3001/v1/webhooks/stripe` and set `STRIPE_WEBHOOK_SECRET` to the secret it prints. Without Stripe, live-key orders return `503 PAYMENTS_NOT_CONFIGURED` |
| Order emails | Set `RESEND_API_KEY` |

**How the local embeddings work.** Each word, and each three-letter chunk of each word, is hashed into one of 1536 positions in a vector. Postgres does this in a trigger when a product is saved, using `local_embedding()` from migration `00022`. The API uses exactly the same algorithm for search queries. It catches similar wording ("earbud" ≈ "earbuds") rather than real meaning, and keyword search plus ranking fills the rest of the gap. OpenAI embeddings give better meaning-based results.

### Using a hosted Supabase project instead
Fill in `.env` and `apps/web/.env.local` by hand, using `.env.example` as the template. Then run `npm run db:migrate`, `npm run db:bucket`, `npm run seed` and `npm run seed:sandbox`.

### Production-style run
```bash
npm run typecheck   # type-check api, web, mcp and shared types
npm run build       # type-check the API + build the Next.js app
npm run start:api   # API (runs the TypeScript source with tsx, NODE_ENV=production)
npm run start:web   # Next.js production server
```

API keys are shown once and stored only as sha256 hashes.

---

## Agent API (`/v1`)

All `/v1/*` routes need `Authorization: Bearer <key>`, except the ones marked *public*.

| Method | Path | Notes |
|---|---|---|
| `POST` | `/v1/search` | `{ query, limit?, session_id?, filters?: { min_price, max_price, category, availability } }` |
| `POST` | `/v1/order` | `{ product_id, quantity (1–10), session_id?, shipping_address? }` → `{ order_id, checkout_url, expires_in: 900, summary }`. Retrying with the same `(session_id, product_id)` while the order is still pending returns the same order (`idempotent: true`) |
| `GET` | `/v1/order/:id` | *Public*, because the checkout page reads it. If you send a key, you get 404 for another developer's order |
| `PATCH` | `/v1/order/:id/details` | *Public*. The checkout form uses it to set `buyer_email` / `shipping_address` while payment is pending |
| `POST` | `/v1/return` | Order must be shipped or later and inside the seller's return window |
| `GET` | `/v1/return/:id` | Owner only |
| `POST` | `/v1/sandbox/confirm/:orderId` | *Public*. Simulates payment for sandbox orders. Live keys get 403 |
| `POST` | `/v1/webhooks/stripe` | Stripe HMAC-verified |

Every response carries an `X-Response-Time` header. Every error is JSON in the shape `{ error, message }`.

```bash
curl -s localhost:3001/v1/search \
  -H "Authorization: Bearer sk_test_am_..." -H "Content-Type: application/json" \
  -d '{"query":"wireless earbuds under 2000 better than boat","limit":5}'
```

### Rate limits (per developer, per day)
| Plan | Searches | Orders |
|---|---|---|
| free | 100 | 10 |
| starter | 1,000 | 100 |
| pro | 10,000 | 1,000 |
| enterprise | unlimited | unlimited |

Search responses include the `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset` headers. Going over the order limit returns 429. Limits are counted **in memory** (`lib/ratelimit.ts`). They reset when the process restarts and are not shared between API instances.

### Sandbox
A `sk_test_am_` key only sees `is_sandbox = true` products, and a live key only sees real ones. Sandbox orders get a mock PaymentIntent (`pi_test_mock_…`) and a `checkout_url` under `/checkout/sandbox/:id`. The "pay" button there calls the sandbox confirm endpoint, which runs the same post-payment steps as a real payment: stock, earnings, webhooks and quality score.

---

## How search ranks results

The code is in `apps/api/src/lib/search.ts`, `routes/search.ts` and `searchHybrid` in `lib/db.ts`.

1. **Two rankings.** The query is embedded (cached for 60s in memory) and compared against product embeddings using pgvector cosine distance. Separately, Postgres full-text search ranks products by keyword match.
2. **Merge them with Reciprocal Rank Fusion.** Each product scores `Σ 1/(60 + rank)` across both lists.
3. **Read intent from the query:**
   - price (`under 2000`, `between 500 and 1000`)
   - category keywords (earbuds, charger, cable, power bank, case …)
   - brand mentions, either positive ("boAt earbuds") or negative ("better than boAt", "alternative to Noise")
4. **Adjust the merged score:**
   - seller trust: up to +10%
   - product quality: ±15%, neutral at 50
   - category match ×1.15, mismatch ×0.5
   - brand ×1.4 if wanted, ×0.2 if the query asked for alternatives
   - over budget ×0.3 (moved down, not removed)
5. **Hard filters:**
   - Always excluded: discontinued products, soft-deleted products, products from suspended sellers, and products from the other environment (sandbox vs live).
   - Explicit `filters.min_price`, `max_price` and `category` are strict. `category` is normalised, so `wireless_earbuds` matches `Wireless Earbuds`.

Each result includes `relevance_score`, `is_purchasable` (in stock and stock > 0), `delivery_eta` (based on seller trust), a short `specs_summary`, and the seller's name and trust score. Seller contact details and other private data are never returned.

---

## Orders, money and returns

- **Order states:** `pending_payment → paid → processing → shipped → delivered`, plus `cancelled` and `returned`. A pending order expires after 15 minutes. A sweeper cancels expired orders every 5 minutes.
- **No overselling.** Stock is only reserved when the order is paid, using `UPDATE … SET stock = stock - qty WHERE stock >= qty`. Marking an order paid is also atomic (`WHERE status = 'pending_payment'`), so duplicate confirmations do nothing. If two buyers pay for the last unit, the losing sandbox payment is cancelled with `409 OUT_OF_STOCK`.
- **Earnings ledger.** Each paid order writes one `seller_earnings` row (`UNIQUE(order_id)`). The platform fee is `STRIPE_PLATFORM_FEE_PERCENT` (10%) and the seller's share is the rest, so the two always add up exactly to the order total. The row's status starts as `pending` and becomes `cancelled` when a return is received. Payouts (`→ paid`) are not built yet.
- **Returns (reverse pickup):** `requested → approved → pickup_scheduled → picked_up → received`, or `rejected`. Each seller has a return policy (`accepts_returns`, and `window_days` ∈ {7, 14, 30, 60}). When a return reaches `received`:
  - the refund amount is recorded
  - the seller's earning is cancelled
  - the order becomes `returned`
  - the product's quality score is recalculated
  - if the seller's return rate gets too high (5 or more recent returns received, or more than 20%), the seller is **automatically suspended**
- **Quality score** (`lib/quality.ts`): new products start at 50. Once a product has 5 or more orders, its score is recalculated from three parts:
  - return rate: up to 40 points
  - repeat purchases: up to 35 points
  - order volume: up to 25 points
- **Trust score** (`lib/trust.ts`): new sellers start at 80. It is recalculated after real paid orders.

---

## Developer webhooks

Developers register a URL in the portal, along with the events they want:

- `order.confirmed`
- `order.shipped`
- `return.approved`, `return.rejected`, `return.pickup_scheduled`, `return.picked_up`, `return.received`

Events go **only to the developer whose key placed the order**.

- **Request headers:** `X-Stok-Event`, `X-Stok-Event-Attempt` and `X-Stok-Signature: sha256=<hex>`. The signature is an HMAC-SHA256 of the raw body using that webhook's `whsec_am_…` secret.
- **Body:** `{ event, timestamp, data }`.
- **Delivery:** up to 3 attempts, waiting 1s then 2s between them, with a 5-second timeout per attempt. Delivery runs in the background and never holds up the main request.
- The most recent delivery status is shown in the portal.

---

## MCP server (`apps/mcp`)

This wraps the agent API as MCP tools:

- `search_products`
- `create_order`
- `get_order_status`

It is served at `/mcp` on Cloudflare Workers.

```bash
cd apps/mcp
npx wrangler secret put STOK_API_KEY
npm run dev        # or: npm run deploy
```

`STOK_API_BASE` in `wrangler.toml` points to `https://api.stok.dev`. Change it to wherever your API is hosted.

---

## Scripts

Run these from the repo root with `npx tsx scripts/<name>.ts`. Shortcuts: `npm run verify` runs `verify-phase4.ts`, and `npm run test:stress` runs `stress-test-mega2.ts`.

| Script | Purpose |
|---|---|
| `setup-local.ts` (`npm run setup`) | start local Supabase, write the env files, seed the data |
| `smoke-test.ts` (`npm run smoke`) | 18 end-to-end checks against the running servers: signup, search, sandbox order and payment, seller listing. Cleans up after itself |
| `check-embeddings.ts` (`npm run check:embeddings`) | confirm the SQL and TypeScript local embeddings match |
| `reembed.ts` (`npm run reembed`) | recompute every product embedding after switching between local and OpenAI |
| `seed-sandbox.ts` | seed the 20 `[TEST]` sandbox products |
| `create-storage-bucket.ts` | create the `product-images` bucket |
| `verify-phase3.ts`, `verify-phase4.ts` | end-to-end checks for checkout, the developer portal and MCP |
| `agent-simulation.ts` | simulate an agent's search and order session |
| `quality-audit.ts`, `quality-sweep.ts`, `probe-similarity.ts` | check search quality |
| `test-trust.ts`, `test-trigger.ts`, `diagnose-trigger.ts`, `set-trigger-config.ts` | trust engine and embedding trigger tools |
| `stress-test-*.ts` | full regression suites. `stress-test-mega2.ts` is the latest production-readiness run (88/88) |

The stress tests run against the **real database**. They create test data and clean it up afterwards. When they finish, the catalog should be back to **50 real products, 20 sandbox products and 2 sellers**.

---

## Gotchas

- **Stale API process.** `pkill -f "tsx watch"` stops the watcher but can leave its worker process holding port 3001 and serving old code. Run `lsof -ti :3001 | xargs kill` before restarting.
- **POSTs with no body.** Fastify rejects a request that says it is JSON but has an empty body. Endpoints like process, approve, picked-up and received must be sent `'{}'`.
- **Docker has to be running** before `npm run setup` or `npm run db:start`. If ports 54321–54324 are already in use, run `npm run db:stop` or change them in `supabase/config.toml`.
- **Embedding timing depends on the mode.** In local mode, a product's embedding is written in the same transaction that saves it, so it's searchable straight away. In OpenAI mode it is generated asynchronously (about 4 seconds), so wait for `embedding IS NOT NULL`.
- **Don't run `npm run build` while `npm run dev:web` is running.** Both write to `apps/web/.next`, which breaks the dev server. If it happens, stop it, run `rm -rf apps/web/.next`, and start it again.
- **Two copies of the local embedding.** If you change `local_embedding()` in SQL, change `localEmbedding()` in `apps/api/src/lib/embeddings.ts` too, then run `npm run check:embeddings`.
- **Test email addresses.** Supabase Auth rejects `.test` email domains. Use `@example.com` for test users.

---

## Not built yet

These are listed in `STRIPE_TODO.md`:

- Stripe Connect: seller onboarding, splitting payments and paying out sellers
- Real refunds on returns
- Razorpay
- Production deployment
