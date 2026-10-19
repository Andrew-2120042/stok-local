// End-to-end smoke test against a running local stack (npm run dev:api + dev:web).
// Walks the real flows — developer signup, search, sandbox order + payment,
// seller signup + product listing — then deletes everything it created.
//
//   npm run smoke
import 'dotenv/config'
import { Pool } from 'pg'
import { createClient } from '@supabase/supabase-js'

const API = process.env.API_BASE_URL ?? 'http://localhost:3001'
const WEB = process.env.CHECKOUT_BASE_URL ?? 'http://localhost:3000'
const SECRET = process.env.INTERNAL_API_SECRET ?? ''
const url = process.env.DATABASE_URL ?? ''
const pool = new Pool({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } })
const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false } })

let passed = 0
let failed = 0
function check(name: string, ok: boolean, detail = '') {
  ok ? passed++ : failed++
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  — ${detail}` : ''}`)
}

async function call(method: string, path: string, opts: { key?: string; body?: unknown; headers?: Record<string, string>; base?: string } = {}) {
  const headers: Record<string, string> = { ...opts.headers }
  if (opts.key) headers.Authorization = `Bearer ${opts.key}`
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${opts.base ?? API}${path}`, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined, redirect: 'manual' })
  const text = await res.text()
  let json: any = null
  try { json = JSON.parse(text) } catch { /* HTML page */ }
  return { status: res.status, json, text }
}

const created = { authUsers: [] as string[], developerIds: [] as string[], sellerIds: [] as string[], orderIds: [] as string[], productIds: [] as string[] }

async function run() {
  const stamp = Date.now()
  const health = await call('GET', '/health').catch(() => null)
  if (health?.status !== 200) {
    console.error(`❌ API not reachable at ${API}. Start it with: npm run dev:api`)
    process.exit(1)
  }

  // ── Developer signup (through the Next.js proxy, as the browser does) ──────
  const devEmail = `smoke-dev-${stamp}@example.com`
  const { data: devAuth, error: devErr } = await anon.auth.signUp({ email: devEmail, password: 'smoke-test-pw-123' })
  check('developer Supabase signup', !devErr && !!devAuth.user, devErr?.message)
  if (!devAuth.user) return
  created.authUsers.push(devAuth.user.id)

  const forged = await call('POST', '/api/portal/signup', { base: WEB, body: { supabase_user_id: crypto.randomUUID(), email: devEmail, name: 'Forged' } })
  check('signup with a forged user id is rejected', forged.status === 401, `status ${forged.status}`)

  const signup = await call('POST', '/api/portal/signup', { base: WEB, body: { supabase_user_id: devAuth.user.id, email: devEmail, name: 'Smoke Dev' } })
  check('developer signup returns live + test keys', signup.status === 201 && !!signup.json?.keys?.test, `status ${signup.status}`)
  if (signup.status !== 201) return
  created.developerIds.push(signup.json.developer.id)
  const testKey: string = signup.json.keys.test
  const liveKey: string = signup.json.keys.live

  // ── Portal routes are not callable without the internal secret ────────────
  const noSecret = await call('GET', '/portal/me', { headers: { 'x-supabase-user-id': devAuth.user.id } })
  check('portal route without internal secret → 401', noSecret.status === 401, `status ${noSecret.status}`)

  // ── Search ────────────────────────────────────────────────────────────────
  const liveSearch = await call('POST', '/v1/search', { key: liveKey, body: { query: 'wireless earbuds under 2000', limit: 5 } })
  const liveResults = liveSearch.json?.results ?? []
  check('live search returns real catalog', liveSearch.status === 200 && liveResults.length > 0, `${liveResults.length} results, top: ${liveResults[0]?.name}`)
  check('price filter respected', liveResults.every((r: any) => r.price <= 2000))

  const sbSearch = await call('POST', '/v1/search', { key: testKey, body: { query: 'bluetooth speaker', limit: 3 } })
  const sbTop = sbSearch.json?.results?.[0]
  check('sandbox search returns only [TEST] products', sbSearch.status === 200 && sbSearch.json.results.every((r: any) => r.name.startsWith('[TEST]')), `top: ${sbTop?.name}`)

  // ── Sandbox order → checkout page → simulated payment ─────────────────────
  if (!sbTop) return
  const { rows: [before] } = await pool.query<{ stock: number }>('SELECT stock FROM products WHERE id = $1', [sbTop.id])
  const order = await call('POST', '/v1/order', { key: testKey, body: { product_id: sbTop.id, quantity: 1, session_id: `smoke-${stamp}` } })
  check('sandbox order created', order.status === 201 && !!order.json?.checkout_url, `status ${order.status}`)
  if (order.status !== 201) return
  created.orderIds.push(order.json.order_id)

  const page = await call('GET', new URL(order.json.checkout_url).pathname, { base: WEB })
  check('sandbox checkout page renders', page.status === 200 && page.text.includes('SANDBOX MODE'), `status ${page.status}`)

  const pay = await call('POST', `/v1/sandbox/confirm/${order.json.order_id}`, { body: {} })
  check('simulated payment succeeds', pay.status === 200 && pay.json?.status === 'paid', `status ${pay.status}`)

  const status = await call('GET', `/v1/order/${order.json.order_id}`, { key: testKey })
  check('order is paid', status.json?.status === 'paid')
  const { rows: [after] } = await pool.query<{ stock: number }>('SELECT stock FROM products WHERE id = $1', [sbTop.id])
  check('stock decremented', after.stock === before.stock - 1, `${before.stock} → ${after.stock}`)
  const { rows: earnings } = await pool.query('SELECT gross_amount, platform_fee, seller_amount FROM seller_earnings WHERE order_id = $1', [order.json.order_id])
  const e = earnings[0]
  check('seller earning recorded (10% fee)', !!e && Number(e.platform_fee) + Number(e.seller_amount) === Number(e.gross_amount), e ? `${e.gross_amount} = ${e.platform_fee} + ${e.seller_amount}` : 'missing')

  const liveOrder = await call('POST', '/v1/order', { key: liveKey, body: { product_id: liveResults[0].id, quantity: 1 } })
  const stripeOn = !!process.env.STRIPE_SECRET_KEY
  check(stripeOn ? 'live order creates Stripe checkout' : 'live order without Stripe → clear 503',
    stripeOn ? liveOrder.status === 201 : liveOrder.status === 503 && liveOrder.json?.code === 'PAYMENTS_NOT_CONFIGURED', `status ${liveOrder.status}`)
  if (liveOrder.json?.order_id) created.orderIds.push(liveOrder.json.order_id)

  // ── Seller signup + product listing ───────────────────────────────────────
  const sellerEmail = `smoke-seller-${stamp}@example.com`
  const { data: sAuth } = await anon.auth.signUp({ email: sellerEmail, password: 'smoke-test-pw-123' })
  if (!sAuth.user) { check('seller Supabase signup', false); return }
  created.authUsers.push(sAuth.user.id)
  const sSignup = await call('POST', '/api/portal/sellers/signup', { base: WEB, body: { supabase_user_id: sAuth.user.id, name: `Smoke Store ${stamp}`, email: sellerEmail, business_type: 'individual' } })
  check('seller signup', sSignup.status === 201, `status ${sSignup.status}`)
  if (sSignup.status !== 201) return
  created.sellerIds.push(sSignup.json.seller.id)

  const sellerHeaders = { 'x-supabase-user-id': sAuth.user.id, 'x-internal-secret': SECRET }
  const name = `Auralis Smoke${stamp} Earbuds`
  const product = await call('POST', '/portal/sellers/products', {
    headers: sellerHeaders,
    body: {
      name, brand: 'Auralis', category: 'Wireless Earbuds', price: 1499, stock: 25,
      description: 'Smoke-test earbuds with active noise cancellation, 30 hour battery life, Bluetooth 5.3 and a pocketable charging case for everyday listening.',
      specs: { battery: '30h', bluetooth: '5.3' }, images: ['https://example.com/earbuds.jpg'],
    },
  })
  check('seller lists a product', product.status === 201, `status ${product.status}`)
  if (product.status !== 201) return
  created.productIds.push(product.json.product.id)
  check('product response excludes internal embedding', !('embedding' in product.json.product))

  const found = await call('POST', '/v1/search', { key: liveKey, body: { query: `Auralis Smoke${stamp} earbuds`, limit: 3 } })
  check('new product is searchable immediately', found.json?.results?.[0]?.id === product.json.product.id, `top: ${found.json?.results?.[0]?.name}`)
}

async function cleanup() {
  const q = (sql: string, p: unknown[]) => pool.query(sql, p).catch((e) => console.warn('cleanup:', e.message))
  if (created.orderIds.length) {
    const { rows } = await pool.query<{ product_id: string; quantity: number; status: string }>('SELECT product_id, quantity, status FROM orders WHERE id = ANY($1)', [created.orderIds])
    for (const o of rows) if (o.status === 'paid') await q('UPDATE products SET stock = stock + $2 WHERE id = $1', [o.product_id, o.quantity])
    await q('DELETE FROM seller_earnings WHERE order_id = ANY($1)', [created.orderIds])
    await q('DELETE FROM order_events WHERE order_id = ANY($1)', [created.orderIds])
    await q('DELETE FROM orders WHERE id = ANY($1)', [created.orderIds])
  }
  await new Promise((r) => setTimeout(r, 600)) // let fire-and-forget search logs land
  if (created.developerIds.length) {
    await q('DELETE FROM searches WHERE developer_id = ANY($1)', [created.developerIds])
    await q('DELETE FROM webhooks WHERE developer_id = ANY($1)', [created.developerIds])
    await q('DELETE FROM api_keys WHERE developer_id = ANY($1)', [created.developerIds])
    await q('DELETE FROM developers WHERE id = ANY($1)', [created.developerIds])
  }
  if (created.productIds.length) {
    await q('UPDATE searches SET top_result_id = NULL WHERE top_result_id = ANY($1)', [created.productIds])
    await q('DELETE FROM products WHERE id = ANY($1)', [created.productIds])
  }
  if (created.sellerIds.length) await q('DELETE FROM sellers WHERE id = ANY($1)', [created.sellerIds])
  for (const id of created.authUsers) await admin.auth.admin.deleteUser(id).catch(() => {})
  await pool.end()
}

run()
  .catch((err) => { failed++; console.error('✗ unexpected error:', err.message) })
  .finally(async () => {
    await cleanup()
    console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`)
    process.exit(failed === 0 ? 0 : 1)
  })
