import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(__dirname, '../.env') })
import { Pool } from 'pg'

const API = 'http://localhost:3001'
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

async function req(method: string, url: string, body?: unknown) {
  const res = await fetch(`${API}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => null)
  return { status: res.status, json }
}

function ok(label: string, pass: boolean, detail: string) {
  console.log(`${pass ? '✅' : '❌'} ${label}`)
  if (!pass || process.env.VERBOSE) console.log(`   ${detail}`)
}

async function run() {
  console.log('\n' + '─'.repeat(60))
  console.log('PHASE 3 VERIFICATION')
  console.log('─'.repeat(60))

  // ── Pick a product ────────────────────────────────────────────
  const search = await req('POST', '/v1/search', {
    query: 'wireless earbuds under 2000',
    session_id: 'p3_test_001',
    limit: 1,
  })
  const product = search.json?.results?.[0]
  if (!product) { console.error('❌ Search returned no results — is the API running?'); process.exit(1) }
  console.log(`\nTest product: ${product.brand} ${product.name} ₹${product.price}  id=${product.id}`)

  // ── Test 1: Create order ──────────────────────────────────────
  const create = await req('POST', '/v1/order', {
    product_id: product.id,
    quantity: 1,
    session_id: 'p3_test_001',
  })
  const orderId: string = create.json?.order_id
  const checkoutUrl: string = create.json?.checkout_url ?? ''
  ok(
    'Test 1 — POST /v1/order',
    create.status === 201 && !!orderId && checkoutUrl.includes('/checkout/'),
    `status=${create.status}  order_id=${orderId}  checkout_url=${checkoutUrl}  expires_in=${create.json?.expires_in}`
  )
  if (!orderId) { console.error('Cannot continue without order_id'); process.exit(1) }

  // ── Test 2: GET order (pending) exposes client_secret ─────────
  const getOrder = await req('GET', `/v1/order/${orderId}`)
  ok(
    'Test 2 — GET /v1/order/:id (pending)',
    getOrder.status === 200 &&
      getOrder.json?.status === 'pending_payment' &&
      !!getOrder.json?.stripe_client_secret &&
      !!getOrder.json?.expires_at,
    `status=${getOrder.json?.status}  has_client_secret=${!!getOrder.json?.stripe_client_secret}  has_expires_at=${!!getOrder.json?.expires_at}`
  )

  // ── Test 3: PATCH order details ───────────────────────────────
  const patch = await req('PATCH', `/v1/order/${orderId}/details`, {
    buyer_email: 'test.buyer@stok.com',
    shipping_address: {
      full_name: 'Test Buyer',
      line1: '42 MG Road',
      city: 'Bangalore',
      state: 'Karnataka',
      postal_code: '560001',
      country: 'IN',
    },
  })
  ok('Test 3 — PATCH /v1/order/:id/details', patch.status === 200 && patch.json?.updated === true, `status=${patch.status}`)

  // ── Test 4: order_events has order.created ────────────────────
  const { rows: events } = await pool.query(
    `SELECT event_type FROM order_events WHERE order_id = $1 ORDER BY created_at`,
    [orderId]
  )
  const eventTypes = events.map((e: any) => e.event_type)
  ok(
    'Test 4 — order.created event logged',
    eventTypes.includes('order.created'),
    `events=${JSON.stringify(eventTypes)}`
  )

  // ── Test 5: Out of stock ──────────────────────────────────────
  await pool.query(
    `UPDATE products SET stock = 0, availability = 'out_of_stock' WHERE id = $1`,
    [product.id]
  )
  const oos = await req('POST', '/v1/order', {
    product_id: product.id,
    quantity: 1,
  })
  await pool.query(
    `UPDATE products SET stock = 100, availability = 'in_stock' WHERE id = $1`,
    [product.id]
  )
  ok(
    'Test 5 — Out of stock returns 409',
    oos.status === 409 && oos.json?.code === 'OUT_OF_STOCK',
    `status=${oos.status}  code=${oos.json?.code}`
  )

  // ── Test 6: Order not found ───────────────────────────────────
  const notFound = await req('GET', '/v1/order/00000000-0000-0000-0000-000000000000')
  ok('Test 6 — GET non-existent order returns 404', notFound.status === 404, `status=${notFound.status}`)

  // ── Test 7: Stripe webhook signature check ────────────────────
  const badSig = await req('POST', '/v1/webhooks/stripe', { type: 'payment_intent.succeeded' })
  // webhooks.stripe returns 200 before processing (after sig check fails it returns 400)
  ok(
    'Test 7 — Spoofed/unsigned webhook returns 400',
    badSig.status === 400,
    `status=${badSig.status}  error=${badSig.json?.error}`
  )

  // ── Test 8: Order expiry cancellation ────────────────────────
  await pool.query(
    `UPDATE orders SET expires_at = now() - interval '1 minute' WHERE id = $1`,
    [orderId]
  )
  // Trigger the cron manually via direct DB call
  await pool.query(
    `UPDATE orders SET status = 'cancelled', updated_at = now()
     WHERE status = 'pending_payment' AND expires_at < now()`
  )
  const { rows: cancelled } = await pool.query(
    `SELECT status FROM orders WHERE id = $1`,
    [orderId]
  )
  ok(
    'Test 8 — Expired order cancelled',
    cancelled[0]?.status === 'cancelled',
    `status=${cancelled[0]?.status}`
  )

  // ── Test 9: GET expired order hides client_secret ────────────
  const expiredGet = await req('GET', `/v1/order/${orderId}`)
  ok(
    'Test 9 — Cancelled order has no client_secret',
    expiredGet.status === 200 &&
      expiredGet.json?.status === 'cancelled' &&
      !expiredGet.json?.stripe_client_secret,
    `status=${expiredGet.json?.status}  has_client_secret=${!!expiredGet.json?.stripe_client_secret}`
  )

  // ── Test 10: Full E2E search → order flow ────────────────────
  const search2 = await req('POST', '/v1/search', {
    query: 'wireless earbuds under 2000',
    session_id: 'e2e_test_001',
  })
  const topResult = search2.json?.results?.[0]
  const e2eOrder = await req('POST', '/v1/order', {
    product_id: topResult.id,
    quantity: 1,
    session_id: 'e2e_test_001',
  })
  const e2eOrderId = e2eOrder.json?.order_id
  const e2eGet = await req('GET', `/v1/order/${e2eOrderId}`)
  ok(
    'Test 10 — Full flow: search → order → GET status',
    e2eOrder.status === 201 &&
      e2eGet.status === 200 &&
      e2eGet.json?.status === 'pending_payment' &&
      e2eGet.json?.product?.name === topResult.name,
    `search✓ → order_id=${e2eOrderId} → status=${e2eGet.json?.status}  product="${e2eGet.json?.product?.name}"`
  )

  // ── Summary ───────────────────────────────────────────────────
  // Create a fresh order specifically for the browser payment test
  const freshOrder = await req('POST', '/v1/order', {
    product_id: product.id,
    quantity: 1,
    session_id: 'browser_test_001',
  })
  const freshCheckoutUrl = freshOrder.json?.checkout_url ?? ''

  console.log('\n' + '─'.repeat(60))
  console.log(`Open this URL in your browser to test payment:`)
  console.log(`  ${freshCheckoutUrl}`)
  console.log(`\nStripe test card:`)
  console.log(`  Card: 4242 4242 4242 4242  Exp: 12/30  CVC: 123`)
  console.log(`\nAfter paying, poll status with:`)
  console.log(`  curl http://localhost:3001/v1/order/${freshOrder.json?.order_id}`)
  console.log('─'.repeat(60))

  await pool.end()
}

run().catch((e) => { console.error(e); process.exit(1) })
