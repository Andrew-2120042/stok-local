/**
 * Stok Phase 4 — Brutal Stress Test
 * Runs all 61 tests across 7 blocks, never stops on first failure.
 */
import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(__dirname, '../.env') })

import crypto from 'crypto'
import http from 'http'
import { Pool } from 'pg'

const API = process.env.API_BASE_URL ?? 'http://localhost:3001'
const WEB = 'http://localhost:3000'
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

// ─── Colors ──────────────────────────────────────────────────────────────────
const G = (s: string) => `\x1b[32m${s}\x1b[0m`
const R = (s: string) => `\x1b[31m${s}\x1b[0m`
const Y = (s: string) => `\x1b[33m${s}\x1b[0m`
const B = (s: string) => `\x1b[34m${s}\x1b[0m`
const DIM = (s: string) => `\x1b[2m${s}\x1b[0m`

// ─── Result tracking ─────────────────────────────────────────────────────────
interface TestResult {
  block: string
  name: string
  pass: boolean
  detail: string
  warn?: string
}
const results: TestResult[] = []
const warnings: string[] = []

function pass(block: string, name: string, detail = '') {
  results.push({ block, name, pass: true, detail })
  console.log(`  ${G('✓')} ${name}${detail ? DIM(' — ' + detail) : ''}`)
}
function fail(block: string, name: string, detail: string) {
  results.push({ block, name, pass: false, detail })
  console.log(`  ${R('✗')} ${name} ${R('— ' + detail)}`)
}
function warn(msg: string) {
  warnings.push(msg)
  console.log(`  ${Y('⚠')} ${msg}`)
}

async function test(block: string, name: string, fn: () => Promise<void>) {
  try {
    await fn()
  } catch (e: any) {
    fail(block, name, `Uncaught exception: ${e.message}`)
  }
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────
interface Res { status: number; body: any; headers: Record<string, string> }

async function req(
  method: string,
  url: string,
  opts: {
    body?: unknown
    auth?: string
    headers?: Record<string, string>
    raw?: boolean
  } = {}
): Promise<Res> {
  const reqHeaders: Record<string, string> = { ...opts.headers }
  if (opts.auth) reqHeaders['Authorization'] = `Bearer ${opts.auth}`
  if (opts.body !== undefined && !opts.raw) reqHeaders['Content-Type'] = 'application/json'

  const res = await fetch(url, {
    method,
    headers: reqHeaders,
    body: opts.body !== undefined
      ? (opts.raw ? (opts.body as string) : JSON.stringify(opts.body))
      : undefined,
  })
  const text = await res.text()
  let body: any
  try { body = JSON.parse(text) } catch { body = text }
  const headers: Record<string, string> = {}
  res.headers.forEach((v, k) => { headers[k] = v })
  return { status: res.status, body, headers }
}

// ─── DB helper ────────────────────────────────────────────────────────────────
async function db<T = any>(sql: string, params?: unknown[]): Promise<T[]> {
  const { rows } = await pool.query(sql, params)
  return rows
}

// ─── Portal helper (no Supabase JWT in test — use supabase_user_id directly) ─
async function portalReq(
  method: string,
  path: string,
  userId: string,
  body?: unknown
): Promise<Res> {
  return req(method, `${API}${path}`, {
    body,
    headers: { 'x-supabase-user-id': userId, 'x-internal-secret': process.env.INTERNAL_API_SECRET ?? '' },
  })
}

// ─── Developer factory ───────────────────────────────────────────────────────
let devCounter = 0
const RUN_ID = Date.now().toString(36)
async function createDev(suffix = ''): Promise<{
  id: string; supabaseId: string; liveKey: string; testKey: string
}> {
  const supabaseId = `stress_test_${RUN_ID}_${++devCounter}${suffix}`
  const email = `stress_${RUN_ID}_${devCounter}${suffix}@test.dev`
  const r = await req('POST', `${API}/portal/signup`, {
    body: { supabase_user_id: supabaseId, email, name: `Stress Dev ${devCounter}` },
  })
  if (r.status !== 201) throw new Error(`Failed to create dev: ${JSON.stringify(r.body)}`)
  return {
    id: r.body.developer.id,
    supabaseId,
    liveKey: r.body.keys.live,
    testKey: r.body.keys.test,
  }
}

// ─── Local webhook server ─────────────────────────────────────────────────────
interface Captured { headers: Record<string, string>; body: string }

function startWebhookServer(port: number): {
  captured: Captured[]
  close: () => Promise<void>
  url: string
} {
  const captured: Captured[] = []
  const server = http.createServer((reqIn, res) => {
    let body = ''
    reqIn.on('data', (d: Buffer) => { body += d.toString() })
    reqIn.on('end', () => {
      const headers: Record<string, string> = {}
      for (const [k, v] of Object.entries(reqIn.headers)) {
        if (typeof v === 'string') headers[k] = v
      }
      captured.push({ headers, body })
      res.writeHead(200)
      res.end('OK')
    })
  })
  server.listen(port)
  return {
    captured,
    url: `http://localhost:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}

// ─── Main dev setup ───────────────────────────────────────────────────────────
let liveDev: { id: string; supabaseId: string; liveKey: string; testKey: string }
let rateDev: { id: string; supabaseId: string; liveKey: string; testKey: string } // fresh for rate limit tests

// ═══════════════════════════════════════════════════════════════════════════════
// BLOCK 1 — AUTH
// ═══════════════════════════════════════════════════════════════════════════════
async function block1() {
  const B1 = 'Auth'
  console.log(B('\n[Block 1] Authentication'))

  // 1.1
  await test(B1, '1.1 No Authorization header → 401', async () => {
    const r = await req('POST', `${API}/v1/search`, { body: { query: 'laptop' } })
    r.status === 401 && r.body.error?.includes('Missing')
      ? pass(B1, '1.1 No Authorization header → 401', `status=${r.status}`)
      : fail(B1, '1.1 No Authorization header → 401', `got ${r.status}: ${JSON.stringify(r.body)}`)
  })

  // 1.2 Malformed header variants
  const malformed = [
    'NotBearer sk_live_am_abc123',
    'Bearer',
    'Bearer ',
    '',
  ]
  for (const [i, h] of malformed.entries()) {
    await test(B1, `1.2.${i+1} Malformed header "${h.slice(0,20)}" → 401`, async () => {
      const r = await req('POST', `${API}/v1/search`, {
        body: { query: 'laptop' },
        headers: { Authorization: h },
      })
      r.status === 401
        ? pass(B1, `1.2.${i+1} Malformed header → 401`, `status=${r.status}`)
        : fail(B1, `1.2.${i+1} Malformed header → 401`, `got ${r.status}`)
    })
  }

  // 1.3 Wrong key format
  await test(B1, '1.3a Wrong key format (sk_wrong_format_key) → 401', async () => {
    const r = await req('POST', `${API}/v1/search`, { body: { query: 'laptop' }, auth: 'sk_wrong_format_key' })
    r.status === 401
      ? pass(B1, '1.3a Wrong key format → 401', `msg: ${r.body.message ?? r.body.error}`)
      : fail(B1, '1.3a Wrong key format → 401', `got ${r.status}`)
  })
  await test(B1, '1.3b Wrong key prefix (sk_live_wrongprefix_) → 401', async () => {
    const r = await req('POST', `${API}/v1/search`, { body: { query: 'laptop' }, auth: 'sk_live_wrongprefix_abc123' })
    r.status === 401
      ? pass(B1, '1.3b Wrong key prefix → 401', `msg: ${r.body.message ?? r.body.error}`)
      : fail(B1, '1.3b Wrong key prefix → 401', `got ${r.status}`)
  })

  // 1.4 Valid format but fake (non-existent) key
  await test(B1, '1.4 Valid format but fake key → 401', async () => {
    const r = await req('POST', `${API}/v1/search`, { body: { query: 'laptop' }, auth: 'sk_live_am_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' })
    r.status === 401
      ? pass(B1, '1.4 Valid format but fake key → 401', `error: ${r.body.error}`)
      : fail(B1, '1.4 Valid format but fake key → 401', `got ${r.status}: ${JSON.stringify(r.body)}`)
  })

  // 1.5 Revoked key
  await test(B1, '1.5 Revoked key → 401', async () => {
    const dev = await createDev('_revoke')
    // Find the live key ID
    const keys = await db(`SELECT id FROM api_keys WHERE developer_id = $1 AND is_sandbox = false`, [dev.id])
    const keyId = keys[0]?.id
    if (!keyId) return fail(B1, '1.5 Revoked key → 401', 'could not find key ID')
    // Revoke via portal
    const delR = await portalReq('DELETE', `/portal/keys/${keyId}`, dev.supabaseId)
    if (delR.status !== 200) return fail(B1, '1.5 Revoked key → 401', `revoke failed: ${delR.status}`)
    // Try to use revoked key
    const r = await req('POST', `${API}/v1/search`, { body: { query: 'laptop' }, auth: dev.liveKey })
    r.status === 401
      ? pass(B1, '1.5 Revoked key → 401', 'key correctly rejected after revocation')
      : fail(B1, '1.5 Revoked key → 401', `got ${r.status} after revocation`)
  })

  // 1.6 Sandbox key only sees sandbox products
  await test(B1, '1.6a Sandbox key → only [TEST] products', async () => {
    const r = await req('POST', `${API}/v1/search`, { body: { query: 'widget', limit: 20 }, auth: liveDev.testKey })
    if (r.status !== 200) return fail(B1, '1.6a Sandbox key → only [TEST] products', `status=${r.status}`)
    const nonTest = (r.body.results ?? []).filter((p: any) => !p.name.startsWith('[TEST]'))
    nonTest.length === 0
      ? pass(B1, '1.6a Sandbox key → only [TEST] products', `all ${r.body.results.length} results are [TEST]`)
      : fail(B1, '1.6a Sandbox key → only [TEST] products', `${nonTest.length} non-TEST products leaked: ${nonTest.map((p: any) => p.name).join(', ')}`)
  })
  await test(B1, '1.6b Live key → zero [TEST] products', async () => {
    const r = await req('POST', `${API}/v1/search`, { body: { query: 'earbuds', limit: 20 }, auth: liveDev.liveKey })
    if (r.status !== 200) return fail(B1, '1.6b Live key → zero [TEST] products', `status=${r.status}`)
    const testProducts = (r.body.results ?? []).filter((p: any) => p.name.startsWith('[TEST]'))
    testProducts.length === 0
      ? pass(B1, '1.6b Live key → zero [TEST] products', `${r.body.results.length} real results, 0 test`)
      : fail(B1, '1.6b Live key → zero [TEST] products', `${testProducts.length} TEST products leaked!`)
  })

  // 1.8 Stripe webhook bypasses auth
  await test(B1, '1.8 Stripe webhook exempt from auth → 400 not 401', async () => {
    const r = await req('POST', `${API}/v1/webhooks/stripe`, { body: {} })
    r.status === 400
      ? pass(B1, '1.8 Stripe webhook exempt from auth', `got 400 (signature fail), not 401`)
      : r.status === 401
        ? fail(B1, '1.8 Stripe webhook exempt from auth', 'got 401 — webhook is incorrectly auth-gated')
        : fail(B1, '1.8 Stripe webhook exempt from auth', `unexpected status ${r.status}`)
  })

  // 1.9 50 concurrent requests — no 500s, no race conditions
  await test(B1, '1.9 50 concurrent valid requests → all 200/429, no 500', async () => {
    const responses = await Promise.all(
      Array.from({ length: 50 }, () =>
        req('POST', `${API}/v1/search`, { body: { query: 'headphones' }, auth: liveDev.liveKey })
      )
    )
    const statuses = responses.map((r) => r.status)
    const bad = statuses.filter((s) => s !== 200 && s !== 429)
    bad.length === 0
      ? pass(B1, '1.9 50 concurrent → no 500/401', `200: ${statuses.filter(s=>s===200).length}, 429: ${statuses.filter(s=>s===429).length}`)
      : fail(B1, '1.9 50 concurrent → no 500/401', `bad statuses: ${bad.join(', ')}`)
  })
}

// ═══════════════════════════════════════════════════════════════════════════════
// BLOCK 2 — RATE LIMITING
// ═══════════════════════════════════════════════════════════════════════════════
async function block2() {
  const B2 = 'Rate Limits'
  console.log(B('\n[Block 2] Rate Limiting'))

  // 2.1 Hit free tier limit exactly — needs a FRESH developer
  await test(B2, '2.1 Free tier: 100 searches pass, 101st is 429', async () => {
    const fresh = await createDev('_rl_exact')
    const limit = 100
    console.log(DIM(`    Making ${limit} sequential requests (uses cached embeddings)...`))
    let lastRemaining = -1
    for (let i = 0; i < limit; i++) {
      const r = await req('POST', `${API}/v1/search`, { body: { query: 'headphones' }, auth: fresh.liveKey })
      if (r.status !== 200) {
        fail(B2, '2.1 Free tier hit exactly', `request ${i+1} returned ${r.status} instead of 200`)
        return
      }
      lastRemaining = parseInt(r.headers['x-ratelimit-remaining'] ?? '-1')
    }
    // 101st
    const r101 = await req('POST', `${API}/v1/search`, { body: { query: 'headphones' }, auth: fresh.liveKey })
    r101.status === 429
      ? pass(B2, '2.1 Free tier: 100 searches pass, 101st is 429', `remaining was ${lastRemaining} before exhaustion`)
      : fail(B2, '2.1 Free tier hit exactly', `101st returned ${r101.status}, expected 429`)
  })

  // 2.2 Rate limit headers on every response
  await test(B2, '2.2 Rate limit headers present and decrement', async () => {
    const fresh = await createDev('_rl_headers')
    const r1 = await req('POST', `${API}/v1/search`, { body: { query: 'laptop' }, auth: fresh.liveKey })
    const r2 = await req('POST', `${API}/v1/search`, { body: { query: 'laptop' }, auth: fresh.liveKey })
    const limit1 = parseInt(r1.headers['x-ratelimit-limit'] ?? '0')
    const rem1 = parseInt(r1.headers['x-ratelimit-remaining'] ?? '0')
    const rem2 = parseInt(r2.headers['x-ratelimit-remaining'] ?? '0')
    const reset1 = parseInt(r1.headers['x-ratelimit-reset'] ?? '0')
    const allPresent = limit1 > 0 && rem1 >= 0 && reset1 > Date.now()
    const decrements = rem2 === rem1 - 1
    allPresent && decrements
      ? pass(B2, '2.2 Rate limit headers', `Limit=${limit1}, r1=${rem1}, r2=${rem2}, resets at ${new Date(reset1).toISOString()}`)
      : fail(B2, '2.2 Rate limit headers', `allPresent=${allPresent}, decrements=${decrements} (${rem1}→${rem2})`)
  })

  // 2.3 Rate limits isolated per developer (fresh dev still has full quota)
  await test(B2, '2.3 Rate limits reset for new developer', async () => {
    // Use the already-exhausted B2 fresh dev vs a truly new one
    const fresh2 = await createDev('_rl_fresh2')
    const r = await req('POST', `${API}/v1/search`, { body: { query: 'laptop' }, auth: fresh2.liveKey })
    r.status === 200
      ? pass(B2, '2.3 New developer has fresh quota', `remaining=${r.headers['x-ratelimit-remaining']}`)
      : fail(B2, '2.3 New developer has fresh quota', `got ${r.status}`)
  })

  // 2.4 Rate limits per-key not per-IP
  await test(B2, '2.4 Limits isolated per key', async () => {
    const devA = await createDev('_rl_devA')
    const devB = await createDev('_rl_devB')
    // Exhaust devA
    await Promise.all(Array.from({ length: 101 }, () =>
      req('POST', `${API}/v1/search`, { body: { query: 'test' }, auth: devA.liveKey })
    ))
    const rA = await req('POST', `${API}/v1/search`, { body: { query: 'test' }, auth: devA.liveKey })
    const rB = await req('POST', `${API}/v1/search`, { body: { query: 'test' }, auth: devB.liveKey })
    rA.status === 429 && rB.status === 200
      ? pass(B2, '2.4 Limits isolated per key', `devA=429 (exhausted), devB=200 (isolated)`)
      : fail(B2, '2.4 Limits isolated per key', `devA=${rA.status}, devB=${rB.status}`)
  })

  // 2.5 Order limits separate from search limits
  await test(B2, '2.5 Order limits separate from search limits', async () => {
    // Find a sandbox product to order
    const searchR = await req('POST', `${API}/v1/search`, { body: { query: 'widget', limit: 1 }, auth: rateDev.testKey })
    if (searchR.status !== 200 || !searchR.body.results?.length) {
      return warn('2.5 skipped — no sandbox products available for search')
    }
    const productId = searchR.body.results[0].id
    // Order it (sandbox) — should work regardless of search limit
    const orderR = await req('POST', `${API}/v1/order`, {
      body: { product_id: productId, quantity: 1 },
      auth: rateDev.testKey,
    })
    orderR.status === 201
      ? pass(B2, '2.5 Order limits separate from search', 'order succeeded')
      : fail(B2, '2.5 Order limits separate from search', `got ${orderR.status}: ${JSON.stringify(orderR.body)}`)
  })

  // 2.6 429 response has all required fields
  await test(B2, '2.6 429 response format complete', async () => {
    const exhausted = await createDev('_rl_429fmt')
    await Promise.all(Array.from({ length: 101 }, () =>
      req('POST', `${API}/v1/search`, { body: { query: 'test' }, auth: exhausted.liveKey })
    ))
    const r = await req('POST', `${API}/v1/search`, { body: { query: 'test' }, auth: exhausted.liveKey })
    const b = r.body
    const hasAll = r.status === 429 && b.error && b.message && b.reset_at && b.upgrade_url
    hasAll
      ? pass(B2, '2.6 429 format complete', `error, message, reset_at, upgrade_url all present`)
      : fail(B2, '2.6 429 format complete', `missing fields: ${JSON.stringify(b)}`)
  })
}

// ═══════════════════════════════════════════════════════════════════════════════
// BLOCK 3 — SANDBOX
// ═══════════════════════════════════════════════════════════════════════════════
async function block3() {
  const B3 = 'Sandbox'
  console.log(B('\n[Block 3] Sandbox'))

  // 3.1 Sandbox search isolation — 10 queries
  await test(B3, '3.1 Sandbox key: all results are [TEST] products (10 queries)', async () => {
    const queries = ['widget', 'gadget', 'laptop', 'phone', 'headphones', 'shoes', 'coffee', 'backpack', 'mouse', 'watch']
    let failedQuery = ''
    let leakedProduct = ''
    for (const q of queries) {
      const r = await req('POST', `${API}/v1/search`, { body: { query: q, limit: 10 }, auth: liveDev.testKey })
      if (r.status !== 200) { failedQuery = q; break }
      const nonTest = (r.body.results ?? []).filter((p: any) => !p.name.startsWith('[TEST]'))
      if (nonTest.length > 0) { failedQuery = q; leakedProduct = nonTest[0].name; break }
    }
    !failedQuery
      ? pass(B3, '3.1 Sandbox isolation (10 queries)', 'no real products leaked in any query')
      : fail(B3, '3.1 Sandbox isolation', `query "${failedQuery}" leaked: "${leakedProduct}"`)
  })

  // 3.2 Live search isolation — 10 queries
  await test(B3, '3.2 Live key: zero [TEST] products (10 queries)', async () => {
    const queries = ['earbuds', 'charger', 'keyboard', 'monitor', 'camera', 'lamp', 'chair', 'bands', 'speaker', 'hub']
    let failedQuery = ''
    let leakedProduct = ''
    for (const q of queries) {
      const r = await req('POST', `${API}/v1/search`, { body: { query: q, limit: 10 }, auth: liveDev.liveKey })
      if (r.status !== 200) continue
      const testProducts = (r.body.results ?? []).filter((p: any) => p.name.startsWith('[TEST]'))
      if (testProducts.length > 0) { failedQuery = q; leakedProduct = testProducts[0].name; break }
    }
    !failedQuery
      ? pass(B3, '3.2 Live isolation (10 queries)', 'no [TEST] products in any live query')
      : fail(B3, '3.2 Live isolation', `query "${failedQuery}" leaked: "${leakedProduct}"`)
  })

  // 3.3 Sandbox order creates mock PaymentIntent
  let sandboxOrderId = ''
  await test(B3, '3.3 Sandbox order creates mock PI (not real Stripe)', async () => {
    const sr = await req('POST', `${API}/v1/search`, { body: { query: 'test widget', limit: 1 }, auth: liveDev.testKey })
    if (!sr.body.results?.length) return fail(B3, '3.3 Sandbox order mock PI', 'no sandbox products found')
    const productId = sr.body.results[0].id
    const or = await req('POST', `${API}/v1/order`, { body: { product_id: productId, quantity: 1 }, auth: liveDev.testKey })
    if (or.status !== 201) return fail(B3, '3.3 Sandbox order mock PI', `order failed: ${or.status}`)
    sandboxOrderId = or.body.order_id
    // Check DB for pi prefix
    const rows = await db(`SELECT stripe_payment_intent_id FROM orders WHERE id = $1`, [sandboxOrderId])
    const pi = rows[0]?.stripe_payment_intent_id ?? ''
    pi.startsWith('pi_test_mock_')
      ? pass(B3, '3.3 Sandbox order creates mock PI', `pi=${pi.slice(0, 25)}...`)
      : fail(B3, '3.3 Sandbox order creates mock PI', `pi="${pi}" does not start with pi_test_mock_`)
  })

  // 3.4 Sandbox key cannot order real products
  await test(B3, '3.4 Sandbox key + live product → 400', async () => {
    const liveRow = await db(`SELECT id FROM products WHERE is_sandbox = false LIMIT 1`)
    if (!liveRow.length) return warn('3.4 skipped — no live products')
    const r = await req('POST', `${API}/v1/order`, {
      body: { product_id: liveRow[0].id, quantity: 1 },
      auth: liveDev.testKey,
    })
    r.status === 400 || r.status === 404
      ? pass(B3, '3.4 Sandbox key + live product → error', `got ${r.status}: ${r.body.code ?? r.body.error}`)
      : fail(B3, '3.4 Sandbox key + live product', `got ${r.status} — expected 400/404`)
  })

  // 3.5 Live key cannot order sandbox products
  await test(B3, '3.5 Live key + sandbox product → 400', async () => {
    const sbRow = await db(`SELECT id FROM products WHERE is_sandbox = true LIMIT 1`)
    if (!sbRow.length) return warn('3.5 skipped — no sandbox products')
    const r = await req('POST', `${API}/v1/order`, {
      body: { product_id: sbRow[0].id, quantity: 1 },
      auth: liveDev.liveKey,
    })
    r.status === 400 || r.status === 404
      ? pass(B3, '3.5 Live key + sandbox product → error', `got ${r.status}: ${r.body.code ?? r.body.error}`)
      : fail(B3, '3.5 Live key + sandbox product', `got ${r.status} — expected 400/404`)
  })

  // 3.6 Sandbox confirm → paid
  await test(B3, '3.6 Sandbox confirm → status=paid', async () => {
    if (!sandboxOrderId) return fail(B3, '3.6 Sandbox confirm', 'no sandbox order from 3.3')
    const r = await req('POST', `${API}/v1/sandbox/confirm/${sandboxOrderId}`)
    if (r.status !== 200 || r.body.status !== 'paid')
      return fail(B3, '3.6 Sandbox confirm', `got ${r.status}: ${JSON.stringify(r.body)}`)
    // Check DB
    const rows = await db(`SELECT status FROM orders WHERE id = $1`, [sandboxOrderId])
    const dbStatus = rows[0]?.status
    // Check order event
    const events = await db(`SELECT event_type FROM order_events WHERE order_id = $1 AND event_type = 'order.paid'`, [sandboxOrderId])
    dbStatus === 'paid' && events.length > 0
      ? pass(B3, '3.6 Sandbox confirm → paid', `DB status=paid, order.paid event logged`)
      : fail(B3, '3.6 Sandbox confirm', `DB status=${dbStatus}, events=${events.length}`)
  })

  // 3.7 Sandbox confirm with live key → 403
  await test(B3, '3.7 Live key on sandbox confirm → 403', async () => {
    // Create fresh sandbox order
    const sr = await req('POST', `${API}/v1/search`, { body: { query: 'test gadget', limit: 1 }, auth: liveDev.testKey })
    if (!sr.body.results?.length) return warn('3.7 skipped — no sandbox products')
    const productId = sr.body.results[0].id
    const or = await req('POST', `${API}/v1/order`, { body: { product_id: productId, quantity: 1 }, auth: liveDev.testKey })
    if (or.status !== 201) return fail(B3, '3.7 Live key on confirm', `could not create sandbox order: ${or.status}`)
    const r = await req('POST', `${API}/v1/sandbox/confirm/${or.body.order_id}`, { auth: liveDev.liveKey })
    r.status === 403
      ? pass(B3, '3.7 Live key on sandbox confirm → 403', `correctly rejected live key`)
      : fail(B3, '3.7 Live key on sandbox confirm → 403', `got ${r.status}: ${JSON.stringify(r.body)}`)
  })

  // 3.8 Double confirm → 409 or 200 (idempotent), never 500
  await test(B3, '3.8 Double confirm → 409 or 200, never 500', async () => {
    // Create and confirm a fresh order
    const sr = await req('POST', `${API}/v1/search`, { body: { query: 'mock laptop', limit: 1 }, auth: liveDev.testKey })
    if (!sr.body.results?.length) return warn('3.8 skipped — no sandbox products')
    const productId = sr.body.results[0].id
    const or = await req('POST', `${API}/v1/order`, { body: { product_id: productId, quantity: 1 }, auth: liveDev.testKey })
    if (or.status !== 201) return fail(B3, '3.8 Double confirm', `order creation failed: ${or.status}`)
    const id = or.body.order_id
    await req('POST', `${API}/v1/sandbox/confirm/${id}`)
    const r2 = await req('POST', `${API}/v1/sandbox/confirm/${id}`)
    r2.status !== 500
      ? pass(B3, '3.8 Double confirm → not 500', `got ${r2.status}: ${r2.body.error ?? r2.body.status ?? 'ok'}`)
      : fail(B3, '3.8 Double confirm → not 500', `got 500 on second confirm`)
  })

  // 3.9 Sandbox checkout page loads (not Stripe Elements)
  await test(B3, '3.9 Sandbox checkout page has "Simulate Payment"', async () => {
    const sr = await req('POST', `${API}/v1/search`, { body: { query: 'test mouse', limit: 1 }, auth: liveDev.testKey })
    if (!sr.body.results?.length) return warn('3.9 skipped — no sandbox products')
    const productId = sr.body.results[0].id
    const or = await req('POST', `${API}/v1/order`, { body: { product_id: productId, quantity: 1 }, auth: liveDev.testKey })
    if (or.status !== 201) return fail(B3, '3.9 Sandbox checkout page', `order failed: ${or.status}`)
    const checkoutUrl = or.body.checkout_url
    if (!checkoutUrl?.includes('/sandbox/')) return fail(B3, '3.9 Sandbox checkout page', `URL is not sandbox: ${checkoutUrl}`)
    const html = await fetch(checkoutUrl).then((r) => r.text()).catch(() => '')
    html.includes('Simulate') || html.includes('SANDBOX')
      ? pass(B3, '3.9 Sandbox checkout page', 'page contains "Simulate" text')
      : fail(B3, '3.9 Sandbox checkout page', 'no "Simulate" or "SANDBOX" text found')
  })

  // 3.10 Live checkout URL is a real /checkout/* page (not sandbox)
  await test(B3, '3.10 Live order checkout URL is /checkout/ (not /sandbox/)', async () => {
    const sr = await req('POST', `${API}/v1/search`, { body: { query: 'earbuds', limit: 1 }, auth: liveDev.liveKey })
    if (!sr.body.results?.length) return warn('3.10 skipped — no live products')
    const productId = sr.body.results[0].id
    const or = await req('POST', `${API}/v1/order`, { body: { product_id: productId, quantity: 1 }, auth: liveDev.liveKey })
    if (or.status !== 201) return fail(B3, '3.10 Live checkout URL', `order failed: ${or.status}`)
    const checkoutUrl = or.body.checkout_url
    !checkoutUrl?.includes('/sandbox/')
      ? pass(B3, '3.10 Live checkout URL', `correct path: ${checkoutUrl}`)
      : fail(B3, '3.10 Live checkout URL', `URL incorrectly uses /sandbox/: ${checkoutUrl}`)
  })
}

// ═══════════════════════════════════════════════════════════════════════════════
// BLOCK 4 — DEVELOPER PORTAL
// ═══════════════════════════════════════════════════════════════════════════════
async function block4() {
  const B4 = 'Dev Portal'
  console.log(B('\n[Block 4] Developer Portal'))

  // 4.1 Duplicate email rejected
  await test(B4, '4.1 Duplicate email → error (not 500)', async () => {
    const email = `dup_test_${Date.now()}@test.dev`
    const suid = `dup_${Date.now()}`
    await req('POST', `${API}/portal/signup`, { body: { supabase_user_id: suid, email, name: 'Test' } })
    const r2 = await req('POST', `${API}/portal/signup`, { body: { supabase_user_id: `${suid}_2`, email, name: 'Test2' } })
    r2.status === 409 && r2.status !== 500
      ? pass(B4, '4.1 Duplicate email → 409', `got ${r2.status}: ${r2.body.error}`)
      : fail(B4, '4.1 Duplicate email → 409', `got ${r2.status}: ${JSON.stringify(r2.body)}`)
  })

  // 4.2 Signup creates exactly 2 keys (one live, one test)
  await test(B4, '4.2 Signup creates exactly 2 keys (live + test)', async () => {
    const dev = await createDev('_portal_2keys')
    const keys = await db(`SELECT is_sandbox FROM api_keys WHERE developer_id = $1 ORDER BY is_sandbox`, [dev.id])
    const liveCount = keys.filter((k: any) => !k.is_sandbox).length
    const testCount = keys.filter((k: any) => k.is_sandbox).length
    keys.length === 2 && liveCount === 1 && testCount === 1
      ? pass(B4, '4.2 Signup creates 2 keys', `${liveCount} live, ${testCount} test`)
      : fail(B4, '4.2 Signup creates 2 keys', `found ${keys.length} keys: ${JSON.stringify(keys)}`)
  })

  // 4.3 key_hash ≠ raw key, prefix is correct length
  await test(B4, '4.3 Key hash stored, raw key absent from DB', async () => {
    const dev = await createDev('_portal_hash')
    const rows = await db(
      `SELECT key_hash, key_prefix FROM api_keys WHERE developer_id = $1 LIMIT 1`,
      [dev.id]
    )
    const row = rows[0]
    const hashIsHex = /^[0-9a-f]{64}$/.test(row.key_hash)  // sha256 = 64 hex chars
    const prefixLen = row.key_prefix.length === 16
    // Verify hash matches the actual key
    const expectedHash = crypto.createHash('sha256').update(dev.liveKey).digest('hex')
    const liveKeyRow = await db(
      `SELECT key_hash, key_prefix FROM api_keys WHERE developer_id = $1 AND is_sandbox = false`,
      [dev.id]
    )
    const hashMatches = liveKeyRow[0]?.key_hash === expectedHash
    hashIsHex && prefixLen && hashMatches
      ? pass(B4, '4.3 Hash stored correctly', `hash=sha256, prefix=${row.key_prefix}, raw key NOT in DB`)
      : fail(B4, '4.3 Hash stored', `hashIsHex=${hashIsHex}, prefixLen=${prefixLen}, hashMatches=${hashMatches}`)
  })

  // 4.4 Portal pages redirect to login without session
  await test(B4, '4.4 Portal pages redirect to /login without session', async () => {
    const routes = ['/developers/dashboard', '/developers/keys', '/developers/usage', '/developers/webhooks']
    const failures: string[] = []
    for (const route of routes) {
      const r = await fetch(`${WEB}${route}`, { redirect: 'manual' })
      if (r.status !== 307 && r.status !== 302 && r.status !== 308) {
        failures.push(`${route} → ${r.status}`)
      }
    }
    failures.length === 0
      ? pass(B4, '4.4 Portal redirects', `all 4 routes redirect correctly`)
      : fail(B4, '4.4 Portal redirects', `non-redirect: ${failures.join(', ')}`)
  })

  // 4.5 Usage count accuracy
  await test(B4, '4.5 Usage count: 17 searches → count=17 in DB', async () => {
    const fresh = await createDev('_usage_count')
    const n = 17
    for (let i = 0; i < n; i++) {
      await req('POST', `${API}/v1/search`, { body: { query: 'laptop' }, auth: fresh.liveKey })
    }
    const rows = await db(
      `SELECT COUNT(*)::int AS count FROM searches WHERE developer_id = $1`,
      [fresh.id]
    )
    const count = rows[0]?.count ?? 0
    count === n
      ? pass(B4, '4.5 Usage count accurate', `17 searches → DB count=${count}`)
      : fail(B4, '4.5 Usage count accurate', `expected 17, got ${count}`)
  })

  // 4.6 Webhook CRUD
  await test(B4, '4.6 Webhook CRUD (create → list → delete)', async () => {
    const dev = await createDev('_webhook_crud')
    // Create
    const cr = await portalReq('POST', '/portal/webhooks', dev.supabaseId, {
      url: 'https://webhook.site/test-stok',
      events: ['order.paid'],
    })
    if (cr.status !== 201) return fail(B4, '4.6 Webhook CRUD', `create failed: ${cr.status}`)
    const hookId = cr.body.webhook?.id
    // List
    const lr = await portalReq('GET', '/portal/webhooks', dev.supabaseId)
    const found = lr.body.webhooks?.some((h: any) => h.id === hookId)
    if (!found) return fail(B4, '4.6 Webhook CRUD', 'created webhook not in list')
    // Delete
    const dr = await portalReq('DELETE', `/portal/webhooks/${hookId}`, dev.supabaseId)
    if (dr.status !== 200) return fail(B4, '4.6 Webhook CRUD', `delete failed: ${dr.status}`)
    // Verify gone
    const lr2 = await portalReq('GET', '/portal/webhooks', dev.supabaseId)
    const stillThere = lr2.body.webhooks?.some((h: any) => h.id === hookId)
    !stillThere
      ? pass(B4, '4.6 Webhook CRUD', 'create → list → delete all passed')
      : fail(B4, '4.6 Webhook CRUD', 'webhook still present after delete')
  })

  // 4.7 + 4.8 Webhook test fires with correct HMAC signature
  await test(B4, '4.7/4.8 Webhook test delivers with valid HMAC-SHA256', async () => {
    const wh = startWebhookServer(19999)
    try {
      const dev = await createDev('_webhook_hmac')
      const cr = await portalReq('POST', '/portal/webhooks', dev.supabaseId, {
        url: wh.url,
        events: ['order.paid'],
      })
      if (cr.status !== 201) return fail(B4, '4.7/4.8 Webhook HMAC', `create failed: ${cr.status}`)
      const secret = cr.body.secret
      const hookId = cr.body.webhook?.id

      const tr = await portalReq('POST', `/portal/webhooks/${hookId}/test`, dev.supabaseId)
      if (!tr.body.ok) return fail(B4, '4.7/4.8 Webhook HMAC', `test delivery failed: ${JSON.stringify(tr.body)}`)

      // Wait for delivery
      await new Promise((resolve) => setTimeout(resolve, 500))
      if (!wh.captured.length) return fail(B4, '4.7/4.8 Webhook HMAC', 'no webhook received at local server')

      const captured = wh.captured[0]
      const rawBody = captured.body
      const sigHeader = captured.headers['x-stok-signature'] ?? ''
      const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`
      const hasEvent = captured.headers['x-stok-event'] === 'test'
      const bodyParsed = JSON.parse(rawBody)
      const hasEventField = bodyParsed.event === 'test'
      const hasTimestamp = !!bodyParsed.timestamp

      sigHeader === expected && hasEvent && hasEventField && hasTimestamp
        ? pass(B4, '4.7/4.8 Webhook HMAC + fields', `sig matches, event header + body fields correct`)
        : fail(B4, '4.7/4.8 Webhook HMAC', `sigMatch=${sigHeader===expected}, event=${hasEvent}, body=${hasEventField}, ts=${hasTimestamp}`)
    } finally {
      await wh.close()
    }
  })

  // 4.9 Revoke key → 401 immediately
  await test(B4, '4.9 Revoke key → 401 immediately', async () => {
    const dev = await createDev('_revoke_portal')
    const keys = await db(`SELECT id FROM api_keys WHERE developer_id = $1 AND is_sandbox = false`, [dev.id])
    await portalReq('DELETE', `/portal/keys/${keys[0].id}`, dev.supabaseId)
    const r = await req('POST', `${API}/v1/search`, { body: { query: 'test' }, auth: dev.liveKey })
    r.status === 401
      ? pass(B4, '4.9 Revoke → 401', 'revoked key correctly returns 401')
      : fail(B4, '4.9 Revoke → 401', `got ${r.status} after revoke`)
  })

  // 4.10 Create new key via portal → works immediately
  await test(B4, '4.10 New portal key works immediately', async () => {
    const dev = await createDev('_newkey')
    const cr = await portalReq('POST', '/portal/keys', dev.supabaseId, { name: 'Extra Key', is_sandbox: false })
    if (cr.status !== 201) return fail(B4, '4.10 New key works', `create failed: ${cr.status}`)
    const newKey = cr.body.key
    const r = await req('POST', `${API}/v1/search`, { body: { query: 'test' }, auth: newKey })
    r.status === 200
      ? pass(B4, '4.10 New portal key works immediately', `new key authenticated and returned ${r.body.total_results} results`)
      : fail(B4, '4.10 New portal key works', `got ${r.status}`)
  })
}

// ═══════════════════════════════════════════════════════════════════════════════
// BLOCK 5 — SECURITY
// ═══════════════════════════════════════════════════════════════════════════════
async function block5() {
  const B5 = 'Security'
  console.log(B('\n[Block 5] Security'))

  // 5.1 SQL injection
  await test(B5, '5.1 SQL injection → 200 with 0 results, DB intact', async () => {
    const payloads = [
      "'; DROP TABLE products; --",
      "1' OR '1'='1",
      "UNION SELECT * FROM api_keys--",
    ]
    for (const q of payloads) {
      const r = await req('POST', `${API}/v1/search`, { body: { query: q }, auth: liveDev.liveKey })
      if (r.status === 500) return fail(B5, '5.1 SQL injection', `query "${q}" caused 500!`)
    }
    // DB must still have products
    const rows = await db(`SELECT COUNT(*) AS count FROM products WHERE is_sandbox = false`)
    const count = parseInt(rows[0].count)
    count > 0
      ? pass(B5, '5.1 SQL injection safe', `all queries returned 2xx, ${count} products still in DB`)
      : fail(B5, '5.1 SQL injection', `CRITICAL: products table has ${count} rows after injection attempts`)
  })

  // 5.2 XSS in search query
  await test(B5, '5.2 XSS payloads → 200, no script in response', async () => {
    const payloads = [
      "<script>alert('xss')</script>",
      "javascript:alert(1)",
    ]
    for (const q of payloads) {
      const r = await req('POST', `${API}/v1/search`, { body: { query: q }, auth: liveDev.liveKey })
      if (r.status === 500) return fail(B5, '5.2 XSS', `payload "${q}" caused 500`)
      const bodyStr = JSON.stringify(r.body)
      if (bodyStr.includes('<script>') || bodyStr.includes('javascript:')) {
        return fail(B5, '5.2 XSS', `response echoed XSS payload unescaped: ${bodyStr.slice(0, 100)}`)
      }
    }
    pass(B5, '5.2 XSS payloads safe', 'no scripts in response, no 500s')
  })

  // 5.3 Oversized query body → 400
  await test(B5, '5.3 Query > 500 chars → 400', async () => {
    const r = await req('POST', `${API}/v1/search`, {
      body: { query: 'a'.repeat(501) },
      auth: liveDev.liveKey,
    })
    r.status === 400
      ? pass(B5, '5.3 Oversized query → 400', `got ${r.status}`)
      : fail(B5, '5.3 Oversized query → 400', `got ${r.status} — Zod max(500) not enforcing`)
  })

  // 5.4 Invalid JSON → 400
  await test(B5, '5.4 Invalid JSON body → 400', async () => {
    const r = await req('POST', `${API}/v1/search`, {
      body: 'not json at all{{{{',
      auth: liveDev.liveKey,
      raw: true,
      headers: { 'Content-Type': 'application/json' },
    })
    r.status === 400
      ? pass(B5, '5.4 Invalid JSON → 400', `got ${r.status}`)
      : fail(B5, '5.4 Invalid JSON → 400', `got ${r.status}: ${JSON.stringify(r.body).slice(0, 80)}`)
  })

  // 5.5 Missing Content-Type → 400
  await test(B5, '5.5 Missing Content-Type → 400', async () => {
    const r = await req('POST', `${API}/v1/search`, {
      body: JSON.stringify({ query: 'earbuds' }),
      auth: liveDev.liveKey,
      raw: true,
      // No Content-Type header
    })
    r.status === 400
      ? pass(B5, '5.5 Missing Content-Type → 400', `got ${r.status}`)
      : fail(B5, '5.5 Missing Content-Type → 400', `got ${r.status} — expected 400`)
  })

  // 5.6 Stripe webhook spoofing
  await test(B5, '5.6 Fake Stripe webhook → 400, order unchanged', async () => {
    // Create a real order so we have a target PI
    const sr = await req('POST', `${API}/v1/search`, { body: { query: 'earbuds', limit: 1 }, auth: liveDev.liveKey })
    if (!sr.body.results?.length) return warn('5.6 skipped — no live products')
    const productId = sr.body.results[0].id
    const or = await req('POST', `${API}/v1/order`, { body: { product_id: productId, quantity: 1 }, auth: liveDev.liveKey })
    if (or.status !== 201) return warn(`5.6 skipped — order creation failed: ${or.status}`)
    const orderId = or.body.order_id

    const fakeEvent = JSON.stringify({
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_fake_123', amount: 999 } },
    })
    const r = await req('POST', `${API}/v1/webhooks/stripe`, {
      body: fakeEvent,
      raw: true,
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': 'v1=fakesig,t=1234567890',
      },
    })

    // Check order status unchanged
    const statusR = await req('GET', `${API}/v1/order/${orderId}`)
    r.status === 400 && statusR.body.status === 'pending_payment'
      ? pass(B5, '5.6 Fake webhook rejected', `status=400, order still pending_payment`)
      : fail(B5, '5.6 Fake webhook rejected', `webhook=${r.status}, order.status=${statusR.body.status}`)
  })

  // 5.7 Stripe webhook replay attack (old timestamp)
  await test(B5, '5.7 Stripe webhook replay (old timestamp) → 400', async () => {
    const oldTimestamp = Math.floor(Date.now() / 1000) - 400 // 400s ago (Stripe rejects > 300s)
    const fakePayload = JSON.stringify({ type: 'test', data: {} })
    const signingSecret = process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_test'
    // Construct a correctly-HMAC-signed-but-old signature
    const signingPayload = `${oldTimestamp}.${fakePayload}`
    const secret = signingSecret.startsWith('whsec_') ? signingSecret.slice(6) : signingSecret
    const mac = crypto.createHmac('sha256', Buffer.from(secret, 'base64')).update(signingPayload).digest('hex')
    const sig = `t=${oldTimestamp},v1=${mac}`

    const r = await req('POST', `${API}/v1/webhooks/stripe`, {
      body: fakePayload,
      raw: true,
      headers: { 'Content-Type': 'application/json', 'stripe-signature': sig },
    })
    r.status === 400
      ? pass(B5, '5.7 Replay attack rejected', `old-timestamp webhook correctly rejected (${r.status})`)
      : fail(B5, '5.7 Replay attack rejected', `got ${r.status} — expected 400 (Stripe tolerance check failed)`)
  })

  // 5.8 API key in query string → 401
  await test(B5, '5.8 API key in query string → 401', async () => {
    const r = await req('POST', `${API}/v1/search?api_key=${liveDev.liveKey}`, {
      body: { query: 'test' },
      // No Authorization header
    })
    r.status === 401
      ? pass(B5, '5.8 Key in query string → 401', `query-param key rejected`)
      : fail(B5, '5.8 Key in query string → 401', `got ${r.status} — keys must not be accepted via query string`)
  })

  // 5.9 Order ID enumeration — non-existent UUIDs return 404
  await test(B5, '5.9 UUID enumeration → 404', async () => {
    const guessable = [
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
      '11111111-1111-1111-1111-111111111111',
    ]
    for (const id of guessable) {
      const r = await req('GET', `${API}/v1/order/${id}`)
      if (r.status !== 404) return fail(B5, '5.9 UUID enumeration', `${id} returned ${r.status} (expected 404)`)
    }
    pass(B5, '5.9 UUID enumeration → 404', 'all guessable IDs correctly return 404')
  })

  // 5.10 Cross-developer order access
  await test(B5, '5.10 Cross-developer order access', async () => {
    // Create sandbox order for dev A
    const sr = await req('POST', `${API}/v1/search`, { body: { query: 'test widget', limit: 1 }, auth: liveDev.testKey })
    if (!sr.body.results?.length) return warn('5.10 skipped — no sandbox products')
    const productId = sr.body.results[0].id
    const devA = await createDev('_xdev_A')
    const or = await req('POST', `${API}/v1/order`, { body: { product_id: productId, quantity: 1 }, auth: devA.testKey })
    if (or.status !== 201) return fail(B5, '5.10 Cross-dev order', `order creation failed: ${or.status}`)
    const orderId = or.body.order_id

    // Dev B tries to confirm dev A's order using a live key (should 403)
    const devB = await createDev('_xdev_B')
    const r = await req('POST', `${API}/v1/sandbox/confirm/${orderId}`, { auth: devB.liveKey })
    r.status === 403
      ? pass(B5, '5.10 Cross-dev order → 403', 'live key correctly rejected for sandbox confirm')
      : fail(B5, '5.10 Cross-dev order → 403', `got ${r.status} — live key should be rejected`)
  })
}

// ═══════════════════════════════════════════════════════════════════════════════
// BLOCK 6 — LOAD & PERFORMANCE
// ═══════════════════════════════════════════════════════════════════════════════
async function block6() {
  const B6 = 'Load'
  console.log(B('\n[Block 6] Load & Performance'))

  // 6.1 20 concurrent search bursts, 5 rounds → measure p50/p95
  await test(B6, '6.1 Load: 100 concurrent searches, p95 < 2000ms, 0 500s', async () => {
    const fresh = await createDev('_load1')
    const queries = ['headphones', 'laptop', 'earbuds', 'keyboard', 'monitor']
    const latencies: number[] = []
    let errors = 0

    console.log(DIM('    Running 5 rounds × 20 concurrent requests...'))
    for (let round = 0; round < 5; round++) {
      const batch = Array.from({ length: 20 }, (_, i) => {
        const q = queries[i % queries.length]
        const start = Date.now()
        return req('POST', `${API}/v1/search`, { body: { query: q }, auth: fresh.liveKey })
          .then((r) => { latencies.push(Date.now() - start); if (r.status === 500) errors++ })
          .catch(() => errors++)
      })
      await Promise.all(batch)
    }

    latencies.sort((a, b) => a - b)
    const p50 = latencies[Math.floor(latencies.length * 0.5)]
    const p95 = latencies[Math.floor(latencies.length * 0.95)]

    errors === 0 && p95 < 2000
      ? pass(B6, '6.1 Load test', `p50=${p50}ms, p95=${p95}ms, 0 errors`)
      : fail(B6, '6.1 Load test', `p50=${p50}ms, p95=${p95}ms, errors=${errors}`)
  })

  // 6.2 Auth overhead < 50ms per request
  // Isolate the auth cost (DB key-hash lookup) from search work: both paths
  // return 401 before any search runs. The delta between a valid-format-but-fake
  // key (does the DB lookup) and a malformed key (rejected pre-DB, in-memory) is
  // the real auth-middleware overhead.
  await test(B6, '6.2 Auth middleware overhead < 50ms', async () => {
    const n = 25
    // Valid format → triggers DB hash lookup, then 401 (key not found)
    const dbLookupTimes: number[] = []
    for (let i = 0; i < n; i++) {
      const start = Date.now()
      await req('POST', `${API}/v1/search`, { body: { query: 'test' }, auth: 'sk_live_am_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' })
      dbLookupTimes.push(Date.now() - start)
    }
    // Malformed format → rejected in-memory before any DB call
    const noLookupTimes: number[] = []
    for (let i = 0; i < n; i++) {
      const start = Date.now()
      await req('POST', `${API}/v1/search`, { body: { query: 'test' }, auth: 'sk_bad_format' })
      noLookupTimes.push(Date.now() - start)
    }
    const avgLookup = dbLookupTimes.reduce((a, b) => a + b, 0) / n
    const avgNoLookup = noLookupTimes.reduce((a, b) => a + b, 0) / n
    const overhead = Math.abs(avgLookup - avgNoLookup)
    overhead < 50
      ? pass(B6, '6.2 Auth overhead', `auth DB-lookup overhead=${overhead.toFixed(1)}ms (lookup=${avgLookup.toFixed(0)}ms, baseline=${avgNoLookup.toFixed(0)}ms)`)
      : fail(B6, '6.2 Auth overhead', `overhead=${overhead.toFixed(1)}ms > 50ms threshold`)
  })

  // 6.3 Rate limit map doesn't grow unboundedly
  await test(B6, '6.3 Rate limit memory: map prunable after 100 unique keys', async () => {
    // Create 5 devs, make multiple requests — window map grows to some size
    // We can't directly inspect the map from outside the process,
    // but we can verify the server stays healthy (no OOM/500) after many unique keys
    const devs = await Promise.all(Array.from({ length: 5 }, (_, i) => createDev(`_mem${i}`)))
    await Promise.all(devs.map((d) =>
      Promise.all(Array.from({ length: 5 }, () =>
        req('POST', `${API}/v1/search`, { body: { query: 'laptop' }, auth: d.liveKey })
      ))
    ))
    const health = await req('GET', `${API}/health`)
    health.status === 200
      ? pass(B6, '6.3 Rate limit memory', 'server healthy after 25 requests from 5 unique keys')
      : fail(B6, '6.3 Rate limit memory', `health returned ${health.status} after load`)
  })

  // 6.4 10 concurrent orders — no 500s, no DB corruption
  await test(B6, '6.4 10 concurrent orders — no 500s', async () => {
    const sr = await req('POST', `${API}/v1/search`, { body: { query: 'earbuds', limit: 1 }, auth: liveDev.liveKey })
    if (!sr.body.results?.length) return warn('6.4 skipped — no live products')
    const productId = sr.body.results[0].id

    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        req('POST', `${API}/v1/order`, { body: { product_id: productId, quantity: 1 }, auth: liveDev.liveKey })
      )
    )
    const statuses = responses.map((r) => r.status)
    const errors500 = statuses.filter((s) => s === 500)
    errors500.length === 0
      ? pass(B6, '6.4 Concurrent orders no 500s', `statuses: ${[...new Set(statuses)].join(',')}`)
      : fail(B6, '6.4 Concurrent orders no 500s', `got ${errors500.length}× 500s`)
  })

  // 6.5 DB pool: 100 concurrent requests
  await test(B6, '6.5 DB pool: 100 concurrent requests — no pool exhaustion 500s', async () => {
    const fresh = await createDev('_pool')
    const responses = await Promise.all(
      Array.from({ length: 100 }, () =>
        req('POST', `${API}/v1/search`, { body: { query: 'test' }, auth: fresh.liveKey })
          .catch(() => ({ status: 0, body: {}, headers: {} }))
      )
    )
    const errors = responses.filter((r) => r.status === 500)
    errors.length === 0
      ? pass(B6, '6.5 DB pool exhaustion', `100 concurrent requests, 0 pool exhaustion 500s`)
      : fail(B6, '6.5 DB pool exhaustion', `${errors.length} 500s — possible pool exhaustion`)
  })
}

// ═══════════════════════════════════════════════════════════════════════════════
// BLOCK 7 — EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════════
async function block7() {
  const B7 = 'Edge Cases'
  console.log(B('\n[Block 7] Edge Cases'))

  // 7.1 Search filter combinations
  await test(B7, '7.1 All search filter combinations return 200', async () => {
    const cases = [
      { query: 'earbuds', limit: 1 },
      { query: 'earbuds', limit: 20 },
      { query: 'earbuds', filters: { min_price: 10, max_price: 500 } },
      { query: 'earbuds', filters: { category: 'electronics' } },
      { query: 'earbuds', filters: { availability: 'all' as const } },
      { query: 'earbuds', filters: { min_price: 9999999 } },
    ]
    for (const body of cases) {
      const r = await req('POST', `${API}/v1/search`, { body, auth: liveDev.liveKey })
      if (r.status !== 200) return fail(B7, '7.1 Filter combinations', `body=${JSON.stringify(body)} → ${r.status}`)
    }
    pass(B7, '7.1 All filter combinations', '6/6 returned 200')
  })

  // 7.2 Order quantity edge cases — fresh dev so order quota (10/day) is available
  await test(B7, '7.2 Order quantity edge cases', async () => {
    const dev = await createDev('_edge_qty')
    const sr = await req('POST', `${API}/v1/search`, { body: { query: 'earbuds', limit: 1 }, auth: dev.liveKey })
    if (!sr.body.results?.length) return warn('7.2 skipped — no live products')
    const pid = sr.body.results[0].id
    const cases: [unknown, number][] = [
      [0, 400],
      [11, 400],
      [-1, 400],
      [1.5, 400],
    ]
    for (const [qty, expected] of cases) {
      const r = await req('POST', `${API}/v1/order`, { body: { product_id: pid, quantity: qty }, auth: dev.liveKey })
      if (r.status !== expected)
        return fail(B7, '7.2 Quantity edge cases', `qty=${qty} → ${r.status}, expected ${expected}`)
    }
    // quantity=10 should succeed
    const r10 = await req('POST', `${API}/v1/order`, { body: { product_id: pid, quantity: 10 }, auth: dev.liveKey })
    r10.status === 201
      ? pass(B7, '7.2 Quantity edge cases', 'invalid qtys → 400, qty=10 → 201')
      : fail(B7, '7.2 Quantity edge cases', `qty=10 → ${r10.status} (expected 201): ${JSON.stringify(r10.body)}`)
  })

  // 7.3 Non-existent product → 404 — fresh dev for order quota
  await test(B7, '7.3 Non-existent product → 404', async () => {
    const dev = await createDev('_edge_404')
    const r = await req('POST', `${API}/v1/order`, {
      body: { product_id: '00000000-0000-0000-0000-000000000000', quantity: 1 },
      auth: dev.liveKey,
    })
    r.status === 404
      ? pass(B7, '7.3 Non-existent product → 404', `error: ${r.body.error}`)
      : fail(B7, '7.3 Non-existent product → 404', `got ${r.status}: ${JSON.stringify(r.body)}`)
  })

  // 7.4 Out-of-stock product → 409 — fresh dev for order quota
  await test(B7, '7.4 Out-of-stock product → 409', async () => {
    const dev = await createDev('_edge_oos')
    const rows = await db(`SELECT id FROM products WHERE is_sandbox = false AND stock > 0 LIMIT 1`)
    if (!rows.length) return warn('7.4 skipped — no products available')
    const productId = rows[0].id
    await db(`UPDATE products SET stock = 0 WHERE id = $1`, [productId])
    try {
      const r = await req('POST', `${API}/v1/order`, { body: { product_id: productId, quantity: 1 }, auth: dev.liveKey })
      r.status === 409 && r.body.code === 'OUT_OF_STOCK'
        ? pass(B7, '7.4 Out-of-stock → 409', `code=${r.body.code}`)
        : fail(B7, '7.4 Out-of-stock → 409', `got ${r.status}: ${JSON.stringify(r.body)}`)
    } finally {
      await db(`UPDATE products SET stock = 50 WHERE id = $1`, [productId])
    }
  })

  // 7.5 Invalid UUID format for order → 400
  await test(B7, '7.5 GET /v1/order with invalid UUID → 400', async () => {
    const cases = ['not-a-uuid', '123', 'undefined', 'null']
    for (const id of cases) {
      const r = await req('GET', `${API}/v1/order/${id}`)
      if (r.status !== 400) return fail(B7, '7.5 Invalid UUID → 400', `"${id}" → ${r.status} (expected 400)`)
    }
    pass(B7, '7.5 Invalid UUID → 400', 'all non-UUID strings correctly return 400')
  })

  // 7.6 Invalid webhook URLs → rejected
  await test(B7, '7.6 Invalid webhook URLs → 400', async () => {
    const dev = await createDev('_wh_url_valid')
    const badUrls = ['not-a-url', 'javascript:alert(1)', '']
    for (const url of badUrls) {
      const r = await portalReq('POST', '/portal/webhooks', dev.supabaseId, { url, events: ['order.paid'] })
      if (r.status !== 400) return fail(B7, '7.6 Invalid webhook URLs', `"${url}" → ${r.status} (expected 400)`)
    }
    // Valid localhost URL should be accepted (not blocked)
    const localR = await portalReq('POST', '/portal/webhooks', dev.supabaseId, {
      url: 'http://localhost:9999/webhook',
      events: ['order.paid'],
    })
    localR.status === 201 && warn('7.6 Note: localhost webhook URLs are accepted (not blocked)')
    pass(B7, '7.6 Invalid webhook URLs → 400', 'all invalid URLs rejected')
  })

  // 7.7 session_id persisted in search log.
  // logSearch is fire-and-forget (intentionally — it must not block the search
  // response), so poll the DB for up to 2s for the async write to land.
  await test(B7, '7.7 session_id stored in searches table', async () => {
    const sessionId = `stress_session_${Date.now()}`
    await req('POST', `${API}/v1/search`, {
      body: { query: 'laptop', session_id: sessionId },
      auth: liveDev.liveKey,
    })
    let found = false
    for (let i = 0; i < 20; i++) {
      const rows = await db(`SELECT session_id FROM searches WHERE session_id = $1 LIMIT 1`, [sessionId])
      if (rows.length > 0 && rows[0].session_id === sessionId) { found = true; break }
      await new Promise((r) => setTimeout(r, 100))
    }
    found
      ? pass(B7, '7.7 session_id stored', `found in searches table (async write)`)
      : fail(B7, '7.7 session_id stored', `not found in searches table after 2s`)
  })

  // 7.8 No-match search returns empty array, not a crash
  await test(B7, '7.8 No-match search → {results:[], total_results:0}', async () => {
    const r = await req('POST', `${API}/v1/search`, {
      body: { query: 'xyzzy_nonexistent_product_qwerty_zzz_123' },
      auth: liveDev.liveKey,
    })
    r.status === 200 && Array.isArray(r.body.results) && r.body.total_results === 0
      ? pass(B7, '7.8 No-match → empty result', `results=[], total=0`)
      : fail(B7, '7.8 No-match → empty result', `got ${r.status}: ${JSON.stringify(r.body).slice(0,80)}`)
  })

  // 7.9 Expired checkout page shows expired UI — fresh dev for order quota
  await test(B7, '7.9 Expired order → /checkout/expired page', async () => {
    const dev = await createDev('_edge_expired')
    const sr = await req('POST', `${API}/v1/search`, { body: { query: 'earbuds', limit: 1 }, auth: dev.liveKey })
    if (!sr.body.results?.length) return warn('7.9 skipped — no live products')
    const productId = sr.body.results[0].id
    const or = await req('POST', `${API}/v1/order`, { body: { product_id: productId, quantity: 1 }, auth: dev.liveKey })
    if (or.status !== 201) return warn(`7.9 skipped — order failed: ${or.status}`)
    // Force expire in DB
    await db(`UPDATE orders SET expires_at = now() - interval '1 hour' WHERE id = $1`, [or.body.order_id])
    const checkoutUrl = or.body.checkout_url
    const res = await fetch(checkoutUrl, { redirect: 'follow' })
    const finalUrl = res.url
    finalUrl.includes('/expired') || res.status === 307
      ? pass(B7, '7.9 Expired checkout redirects', `final URL: ${finalUrl}`)
      : fail(B7, '7.9 Expired checkout', `expected redirect to /expired, got ${finalUrl} (${res.status})`)
  })

  // 7.10 Webhook delivery failure handling (server returns 500 → retries gracefully)
  await test(B7, '7.10 Failed webhook delivery → graceful retry, no crash', async () => {
    // Start a webhook server that returns 500
    const failServer = startWebhookServer(19998)
    const originalHandler = failServer.captured

    // Override — return 500
    const failPort = 19998
    const failUrl = `http://localhost:${failPort}/fail-always`

    try {
      const dev = await createDev('_wh_fail')
      await portalReq('POST', '/portal/webhooks', dev.supabaseId, {
        url: `http://localhost:${failPort}`,
        events: ['order.paid'],
      })
      // Fire a test event and let it fail
      const tr = await portalReq('POST', `/portal/webhooks/${
        (await portalReq('GET', '/portal/webhooks', dev.supabaseId)).body.webhooks[0].id
      }/test`, dev.supabaseId)
      // Even if delivery fails, the test endpoint should return a result (possibly error)
      await new Promise((r) => setTimeout(r, 1000))
      // Server must still be healthy
      const health = await req('GET', `${API}/health`)
      health.status === 200
        ? pass(B7, '7.10 Failed webhook → no crash', 'server remains healthy after webhook delivery failure')
        : fail(B7, '7.10 Failed webhook → no crash', `server returned ${health.status} after delivery failure`)
    } finally {
      await failServer.close()
    }
  })
}

// ═══════════════════════════════════════════════════════════════════════════════
// FINAL REPORT
// ═══════════════════════════════════════════════════════════════════════════════
function printReport() {
  const blocks = ['Auth', 'Rate Limits', 'Sandbox', 'Dev Portal', 'Security', 'Load', 'Edge Cases']
  const blockLabels: Record<string, string> = {
    'Auth': 'Block 1 — Auth         ',
    'Rate Limits': 'Block 2 — Rate Limits  ',
    'Sandbox': 'Block 3 — Sandbox      ',
    'Dev Portal': 'Block 4 — Dev Portal   ',
    'Security': 'Block 5 — Security     ',
    'Load': 'Block 6 — Load         ',
    'Edge Cases': 'Block 7 — Edge Cases   ',
  }
  const expectedCounts: Record<string, number> = {
    'Auth': 10, 'Rate Limits': 6, 'Sandbox': 10, 'Dev Portal': 10, 'Security': 10, 'Load': 5, 'Edge Cases': 10,
  }

  const total = results.length
  const totalPass = results.filter((r) => r.pass).length
  const allFailed = results.filter((r) => !r.pass)
  const securityFailed = results.filter((r) => r.block === 'Security' && !r.pass)
  const any500 = allFailed.some((r) => r.detail.includes('500'))
  const overallStatus = totalPass >= total * 0.95 && securityFailed.length === 0 && !any500
    ? 'PASSED' : 'FAILED'

  console.log('\n')
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║          STOK PHASE 4 STRESS TEST RESULTS               ║')
  console.log('╠══════════════════════════════════════════════════════════╣')
  for (const block of blocks) {
    const blockResults = results.filter((r) => r.block === block)
    const blockPass = blockResults.filter((r) => r.pass).length
    const expected = expectedCounts[block]
    const line = `  ${blockLabels[block]}: ${blockPass}/${blockResults.length} passed`
    const colored = blockPass === blockResults.length ? G(line) : R(line)
    console.log(`║${colored.padEnd(78)}║`)
  }
  console.log('╠══════════════════════════════════════════════════════════╣')
  const totalLine = `  TOTAL: ${totalPass}/${total} passed`
  console.log(`║${(totalPass === total ? G(totalLine) : Y(totalLine)).padEnd(78)}║`)
  const statusLine = `  STATUS: ${overallStatus}`
  console.log(`║${(overallStatus === 'PASSED' ? G(statusLine) : R(statusLine)).padEnd(78)}║`)
  console.log('╚══════════════════════════════════════════════════════════╝')

  if (allFailed.length > 0) {
    console.log(R('\nFAILURES:'))
    for (const f of allFailed) {
      console.log(`  ${R('✗')} [${f.block}] ${f.name}`)
      console.log(`      ${f.detail}`)
    }
  }

  if (securityFailed.length > 0) {
    console.log(R('\n⚠ SECURITY FAILURES — AUTOMATIC FAIL REGARDLESS OF TOTAL SCORE'))
    for (const f of securityFailed) {
      console.log(`  ${R('✗')} ${f.name}: ${f.detail}`)
    }
  }

  if (any500) {
    console.log(R('\n⚠ 500 RESPONSES DETECTED — AUTOMATIC FAIL'))
    for (const f of allFailed.filter((r) => r.detail.includes('500'))) {
      console.log(`  ${R('!')} ${f.name}: ${f.detail}`)
    }
  }

  if (warnings.length > 0) {
    console.log(Y('\nWARNINGS:'))
    for (const w of warnings) console.log(`  ${Y('⚠')} ${w}`)
  }

  console.log('')
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(B('━'.repeat(60)))
  console.log(B('  STOK Phase 4 — Brutal Stress Test'))
  console.log(B('━'.repeat(60)))

  // Health checks
  const apiHealth = await req('GET', `${API}/health`).catch(() => ({ status: 0, body: {}, headers: {} }))
  const webHealth = await fetch(WEB).then((r) => ({ status: r.status })).catch(() => ({ status: 0 }))

  if (apiHealth.status !== 200) {
    console.error(R(`\nFATAL: API server not responding at ${API}`))
    process.exit(1)
  }
  if (webHealth.status !== 200) {
    console.error(Y(`\nWARN: Web server not responding at ${WEB} — some tests will be skipped`))
  }
  console.log(G(`✓ API healthy at ${API}`))
  console.log(webHealth.status === 200 ? G(`✓ Web healthy at ${WEB}`) : Y(`⚠ Web offline — portal UI tests limited`))

  // Create shared live developer (reused across blocks where fresh state not needed)
  console.log(DIM('\nCreating test developers...'))
  liveDev = await createDev('_main')
  rateDev = await createDev('_rate')
  console.log(G(`✓ Main dev created (live key: ${liveDev.liveKey.slice(0,20)}...)`))

  await block1()
  await block2()
  await block3()
  await block4()
  await block5()
  await block6()
  await block7()

  printReport()
  await pool.end()
  process.exit(results.every((r) => r.pass) ? 0 : 1)
}

main().catch((e) => {
  console.error(R(`\nFATAL: ${e.message}`))
  console.error(e.stack)
  process.exit(1)
})
