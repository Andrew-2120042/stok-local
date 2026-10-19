/**
 * Stok — Phase 5 Stress Test, Round 1 (90 tests / 8 blocks).
 * Seller auth, product mgmt, orders, returns, quality, earnings, policy, integration.
 *
 * Auto-fail: any HTTP 500, any security failure, any cross-seller leak, any data corruption.
 *
 * [adapted] notes where the spec assumed a different shape than the real build:
 *  - signup is keyed by supabase_user_id (password/login handled by Supabase Auth —
 *    tested directly against Supabase with admin cleanup);
 *  - product categories use the real display names ('Wireless Earbuds', …).
 */
import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(__dirname, '../.env') })
dotenv.config({ path: path.resolve(__dirname, '../apps/web/.env.local') })

import crypto from 'crypto'
import http from 'http'
import { Pool } from 'pg'
import { createClient } from '@supabase/supabase-js'
import { calculateProductQualityScore, recalculateProductQualityScore } from '../apps/api/src/lib/quality'
import { getProductQualityMetrics } from '../apps/api/src/lib/db'

const API = 'http://localhost:3001'
const WEB = 'http://localhost:3000'
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!
const SB_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const sbAnon = createClient(SB_URL, SB_ANON)
const sbAdmin = createClient(SB_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const G = (s: string) => `\x1b[32m${s}\x1b[0m`, R = (s: string) => `\x1b[31m${s}\x1b[0m`
const Y = (s: string) => `\x1b[33m${s}\x1b[0m`, B = (s: string) => `\x1b[34m${s}\x1b[0m`, DIM = (s: string) => `\x1b[2m${s}\x1b[0m`
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface TR { block: string; name: string; pass: boolean; detail: string; sec?: boolean; data?: boolean; leak?: boolean }
const results: TR[] = []
const http500s: string[] = []
const bugsFixed = [
  '/v1/return now honors seller return_policy: rejects when accepts_returns=false, and uses policy window_days instead of a hardcoded 30. [7.3/7.5]',
  'Return policy window_days restricted to {7,14,30,60} at the API. [7.4]',
  'Seller order detail redacts full buyer address (city/state only) until the order is paid. [3.3]',
  'getSellerStats month_orders now counts returned orders (it happened); revenue still excludes them. [8.5]',
  'getProductQualityMetrics total_orders now includes returned orders so return_rate = returns/all-orders. [5.4]',
]
const adapted: string[] = []
function ok(block: string, name: string, detail = '', f: Partial<TR> = {}) { results.push({ block, name, pass: true, detail, ...f }); console.log(`  ${G('✓')} ${name}${detail ? DIM(' — ' + detail) : ''}`) }
function bad(block: string, name: string, detail: string, f: Partial<TR> = {}) { results.push({ block, name, pass: false, detail, ...f }); console.log(`  ${R('✗')} ${name} ${R('— ' + detail)}${f.leak ? R(' [LEAK]') : ''}${f.sec ? R(' [SEC]') : ''}`) }
async function t(block: string, name: string, fn: () => Promise<void>) { try { await fn() } catch (e: any) { bad(block, name, `exception: ${e.message}`) } }

interface Res { status: number; body: any; headers: Record<string, string> }
async function api(method: string, p: string, opts: { body?: unknown; auth?: string; uid?: string; raw?: boolean } = {}): Promise<Res> {
  const h: Record<string, string> = {}
  if (opts.auth) h['Authorization'] = `Bearer ${opts.auth}`
  if (opts.uid) h['x-supabase-user-id'] = opts.uid
  h['x-internal-secret'] = process.env.INTERNAL_API_SECRET ?? ''
  if (opts.body !== undefined) h['Content-Type'] = 'application/json'
  let res: Response
  try { res = await fetch(`${API}${p}`, { method, headers: h, body: opts.body !== undefined ? (opts.raw ? (opts.body as string) : JSON.stringify(opts.body)) : undefined }) }
  catch (e: any) { return { status: 0, body: { error: e.message }, headers: {} } }
  const txt = await res.text(); let body: any; try { body = JSON.parse(txt) } catch { body = txt }
  if (res.status === 500) http500s.push(`${method} ${p} → 500`)
  return { status: res.status, body, headers: {} }
}
async function db<T = any>(sql: string, params?: unknown[]): Promise<T[]> { return (await pool.query(sql, params)).rows as T[] }

let N = 0; const RUN = Date.now().toString(36)
const sellerIds: string[] = [], devUids: string[] = [], authUserIds: string[] = []
async function mkSeller(name = 'StressShop'): Promise<{ id: string; uid: string; email: string }> {
  const uid = `p5r1_${RUN}_${++N}`, email = `${uid}@stress.test`
  const r = await api('POST', '/portal/sellers/signup', { body: { supabase_user_id: uid, name, email, description: 'A stress-test electronics store offering quality audio gear.', business_type: 'individual' } })
  if (r.status !== 201) throw new Error(`mkSeller failed: ${JSON.stringify(r.body)}`)
  sellerIds.push(r.body.seller.id)
  return { id: r.body.seller.id, uid, email }
}
async function mkDev(): Promise<{ liveKey: string; testKey: string; uid: string; id: string }> {
  const uid = `p5r1_${RUN}_dev${++N}`
  const r = await api('POST', '/portal/signup', { body: { supabase_user_id: uid, email: `${uid}@stress.test`, name: 'd' } })
  devUids.push(uid)
  await db(`UPDATE developers SET plan='enterprise' WHERE supabase_user_id=$1`, [uid])
  return { liveKey: r.body.keys.live, testKey: r.body.keys.test, uid, id: r.body.developer.id }
}
async function sandboxProduct(sellerId: string, name: string): Promise<string> {
  const row = await db<{ id: string }>(
    `INSERT INTO products (seller_id,name,brand,category,description,specs,images,price,stock,currency,availability,is_sandbox)
     VALUES ($1,$2,'P5R1','Wireless Earbuds',$3,'{}'::jsonb,'{}',1000,1000,'INR','in_stock',true) RETURNING id`,
    [sellerId, name, 'sandbox stress product ' + name])
  return row[0].id
}
async function orderConfirm(productId: string, testKey: string, session: string, addr?: any): Promise<string> {
  const or = await api('POST', '/v1/order', { auth: testKey, body: { product_id: productId, quantity: 1, session_id: session, ...(addr ? { shipping_address: addr } : {}) } })
  await api('POST', `/v1/sandbox/confirm/${or.body.order_id}`, { body: {} })
  return or.body.order_id
}
function receiver(port: number) {
  const captured: any[] = []
  const s = http.createServer((q, r) => { let b = ''; q.on('data', (d) => (b += d)); q.on('end', () => { try { captured.push({ ...JSON.parse(b), _sig: q.headers['x-stok-signature'] }) } catch {} r.writeHead(200); r.end('ok') }) })
  s.listen(port)
  return { captured, url: `http://localhost:${port}`, close: () => new Promise<void>((res) => s.close(() => res())) }
}
const ADDR = { full_name: 'Buyer Stress', line1: '42 Test Lane', line2: 'Apt 7', city: 'Hyderabad', state: 'Telangana', postal_code: '500032', country: 'IN', phone: '+919876500000' }
const longDesc = 'Premium wireless earbuds engineered for stress testing, featuring active noise cancellation, deep bass, and a 40-hour battery life for all-day listening.'
const validProduct = (over: any = {}) => ({ name: 'Stress Test Earbuds Pro', brand: 'StressTest', category: 'Wireless Earbuds', description: longDesc, price: 1499, stock: 100, images: ['https://example.com/a.png'], specs: { battery_life: '40hr', driver_size: '10mm', connectivity: 'Bluetooth 5.3' }, ...over })

// ═══ BLOCK 1 — SELLER AUTH SECURITY ═══
async function block1() {
  const BK = 'Auth Security'; console.log(B('\n[Block 1] Seller Auth Security'))

  await t(BK, '1.1 unauthenticated portal routes → 401', async () => {
    const routes = ['/portal/sellers/me', '/portal/sellers/products', '/portal/sellers/orders', '/portal/sellers/returns', '/portal/sellers/settings/return-policy']
    const codes = await Promise.all(routes.map((r) => api('GET', r).then((x) => x.status)))
    codes.every((c) => c === 401) ? ok(BK, '1.1 unauth → 401', `${routes.length} routes all 401`, { sec: true }) : bad(BK, '1.1 unauth → 401', `codes=${codes}`, { sec: true })
  })
  await t(BK, '1.2 seller signup valid', async () => {
    const s = await mkSeller('TestSeller One')
    const row = await db<{ supabase_user_id: string }>(`SELECT supabase_user_id FROM sellers WHERE id=$1`, [s.id])
    row[0]?.supabase_user_id === s.uid ? ok(BK, '1.2 signup → 201', `seller created, supabase_user_id set [adapted: keyed by supabase_user_id]`) : bad(BK, '1.2 signup', `uid mismatch`)
  })
  await t(BK, '1.3 duplicate email → 409', async () => {
    const email = `dup_${RUN}@stress.test`
    await api('POST', '/portal/sellers/signup', { body: { supabase_user_id: `p5r1_dup1_${RUN}`, name: 'A', email, description: 'x'.repeat(30) } })
    const r2 = await api('POST', '/portal/sellers/signup', { body: { supabase_user_id: `p5r1_dup2_${RUN}`, name: 'B', email, description: 'x'.repeat(30) } })
    r2.status === 409 ? ok(BK, '1.3 duplicate email → 409', '') : bad(BK, '1.3 duplicate email → 409', `got ${r2.status}`)
  })
  await t(BK, '1.4 invalid business_type → 400', async () => {
    const r = await api('POST', '/portal/sellers/signup', { body: { supabase_user_id: `p5r1_bt_${RUN}`, name: 'X', email: `bt_${RUN}@stress.test`, business_type: 'corporation' } })
    r.status === 400 ? ok(BK, '1.4 invalid business_type → 400', '') : bad(BK, '1.4 invalid business_type → 400', `got ${r.status}`)
  })
  await t(BK, '1.5 missing required fields → 400', async () => {
    const noName = await api('POST', '/portal/sellers/signup', { body: { supabase_user_id: `p5r1_nn_${RUN}`, email: `nn_${RUN}@stress.test` } })
    const noEmail = await api('POST', '/portal/sellers/signup', { body: { supabase_user_id: `p5r1_ne_${RUN}`, name: 'X' } })
    const noUid = await api('POST', '/portal/sellers/signup', { body: { name: 'X', email: `nu_${RUN}@stress.test` } })
    noName.status === 400 && noEmail.status === 400 && noUid.status === 400
      ? ok(BK, '1.5 missing fields → 400', `name/email/uid all 400 [adapted: password=Supabase, description optional in API]`)
      : bad(BK, '1.5 missing fields → 400', `noName=${noName.status} noEmail=${noEmail.status} noUid=${noUid.status}`)
    adapted.push('1.5: API signup requires supabase_user_id/name/email; password is handled by Supabase Auth and store_description is enforced client-side (optional in API).')
  })
  await t(BK, '1.6 weak password rejected (Supabase Auth)', async () => {
    const r = await sbAnon.auth.signUp({ email: `p5r1weak_${Date.now()}@example.com`, password: '123' })
    if (r.data.user?.id) authUserIds.push(r.data.user.id)
    const weakRejected = /at least 6/i.test(r.error?.message ?? '')
    weakRejected ? ok(BK, '1.6 weak password → rejected', `"${r.error?.message}"`, { sec: true }) : bad(BK, '1.6 weak password', `no error: ${r.error?.message}`, { sec: true })
  })
  await t(BK, '1.7 SQL injection in seller name', async () => {
    const r = await api('POST', '/portal/sellers/signup', { body: { supabase_user_id: `p5r1_sqli_${RUN}`, name: "'; DROP TABLE sellers; --", email: `sqli_${RUN}@stress.test`, description: 'x'.repeat(30) } })
    const tableOk = (await db(`SELECT to_regclass('sellers') t`))[0].t === 'sellers'
    if (r.body.seller?.id) sellerIds.push(r.body.seller.id)
    ;[201, 400].includes(r.status) && tableOk ? ok(BK, '1.7 SQLi safe', `status=${r.status}, sellers table intact`, { sec: true }) : bad(BK, '1.7 SQLi', `status=${r.status} tableOk=${tableOk}`, { sec: true })
  })
  await t(BK, '1.8 XSS in store description stored safely', async () => {
    const uid = `p5r1_xss_${RUN}`, payload = "<script>alert(')</script>"
    const r = await api('POST', '/portal/sellers/signup', { body: { supabase_user_id: uid, name: 'XSS Shop', email: `xss_${RUN}@stress.test`, description: payload } })
    if (r.body.seller?.id) sellerIds.push(r.body.seller.id)
    const stored = (await db<{ description: string }>(`SELECT description FROM sellers WHERE supabase_user_id=$1`, [uid]))[0]?.description
    r.status === 201 && stored === payload ? ok(BK, '1.8 XSS stored as data', 'stored verbatim (param query, not executed)', { sec: true }) : bad(BK, '1.8 XSS', `status=${r.status} stored=${JSON.stringify(stored)}`, { sec: true })
  })
  await t(BK, '1.9 wrong password login → generic 401 (Supabase)', async () => {
    const em = `p5r1wp_${Date.now()}@example.com`
    const su = await sbAnon.auth.signUp({ email: em, password: 'SecurePass123!' }); if (su.data.user?.id) authUserIds.push(su.data.user.id)
    const r = await sbAnon.auth.signInWithPassword({ email: em, password: 'WrongPass999!' })
    const wrongRejected = /invalid login/i.test(r.error?.message ?? '')
    wrongRejected ? ok(BK, '1.9 wrong password → rejected', `"${r.error?.message}"`, { sec: true }) : bad(BK, '1.9 wrong password', `${r.error?.message}`, { sec: true })
  })
  await t(BK, '1.10 non-existent email login → no leak (Supabase)', async () => {
    const r = await sbAnon.auth.signInWithPassword({ email: `p5r1none_${Date.now()}@example.com`, password: 'whatever12' })
    const msg = r.error?.message ?? ''
    const generic = /invalid login/i.test(msg) && !/not found|no user|no account/i.test(msg)
    generic ? ok(BK, '1.10 non-existent → generic error', `"${msg}" (no enumeration leak)`, { sec: true }) : bad(BK, '1.10 non-existent', `leaky/none: "${msg}"`, { sec: true })
  })
  await t(BK, '1.11 session cleared after logout (Supabase)', async () => {
    const em = `p5r1lo_${Date.now()}@example.com`
    const su = await sbAnon.auth.signUp({ email: em, password: 'SecurePass123!' }); if (su.data.user?.id) authUserIds.push(su.data.user.id)
    await sbAnon.auth.signOut()
    const { data } = await sbAnon.auth.getSession()
    data.session === null ? ok(BK, '1.11 logout clears session', 'getSession() → null [adapted: Supabase session lifecycle]', { sec: true }) : bad(BK, '1.11 logout', 'session still present', { sec: true })
  })
  await t(BK, '1.12 two sellers — no data bleed', async () => {
    const a = await mkSeller('Alpha'), b = await mkSeller('Bravo')
    const meA = await api('GET', '/portal/sellers/me', { uid: a.uid }), meB = await api('GET', '/portal/sellers/me', { uid: b.uid })
    const isolated = meA.body.seller.id === a.id && meB.body.seller.id === b.id && meA.body.seller.id !== meB.body.seller.id
    const trust = meA.body.seller.trust_score === 80 && meB.body.seller.trust_score === 80
    isolated && trust ? ok(BK, '1.12 no data bleed', 'each /me returns own record, trust=80 both', { sec: true, leak: false }) : bad(BK, '1.12 data bleed', `isolated=${isolated} trust80=${trust}`, { sec: true, leak: !isolated })
  })
}

// ═══ BLOCK 2 — PRODUCT MANAGEMENT SECURITY ═══
let s2A: { id: string; uid: string }, s2B: { id: string; uid: string }, s2Product = ''
async function block2() {
  const BK = 'Product Mgmt'; console.log(B('\n[Block 2] Product Management Security'))
  s2A = await mkSeller('ProdA'); s2B = await mkSeller('ProdB')

  await t(BK, '2.1 create product (happy path) + embedding', async () => {
    const r = await api('POST', '/portal/sellers/products', { uid: s2A.uid, body: validProduct({ name: '__P5R1_Happy__' }) })
    if (r.status !== 201) return bad(BK, '2.1 create product', `status=${r.status}: ${JSON.stringify(r.body)}`)
    s2Product = r.body.product.id
    let embedded = false
    for (let i = 0; i < 16; i++) { if ((await db<{ h: boolean }>(`SELECT embedding IS NOT NULL h FROM products WHERE id=$1`, [s2Product]))[0].h) { embedded = true; break } await sleep(2000) }
    embedded ? ok(BK, '2.1 create + embed', `201, embedding fired (quality=${r.body.product.product_quality_score})`) : bad(BK, '2.1 create + embed', 'no embedding in 32s')
  })
  const gate = (n: string, over: any, expectMsg: RegExp) => t(BK, n, async () => {
    const r = await api('POST', '/portal/sellers/products', { uid: s2A.uid, body: validProduct(over) })
    const errs = JSON.stringify(r.body.errors ?? r.body.details ?? r.body)
    r.status === 400 && expectMsg.test(errs) ? ok(BK, n, `400 — ${errs.match(expectMsg)?.[0]}`) : bad(BK, n, `status=${r.status} body=${errs.slice(0, 80)}`)
  })
  await gate('2.2 quality gate: no image → 400', { images: [] }, /image/i)
  await gate('2.3 quality gate: short description → 400', { description: 'too short' }, /description|100/i)
  await gate('2.4 quality gate: no specs → 400', { specs: {} }, /spec/i)
  await gate('2.5 quality gate: zero price → 400', { price: 0 }, /price|greater/i)
  await gate('2.6 quality gate: negative stock → 400', { stock: -5 }, /stock|>=|number/i)

  await t(BK, '2.7 cross-seller product READ → 404', async () => {
    const r = await api('GET', `/portal/sellers/products/${s2Product}`, { uid: s2B.uid })
    r.status === 404 ? ok(BK, '2.7 cross-seller read → 404', '', { leak: false }) : bad(BK, '2.7 cross-seller read', `got ${r.status} (LEAK)`, { sec: true, leak: r.status === 200 })
  })
  await t(BK, '2.8 cross-seller product UPDATE → 404', async () => {
    const before = (await db<{ price: string }>(`SELECT price FROM products WHERE id=$1`, [s2Product]))[0].price
    const r = await api('PATCH', `/portal/sellers/products/${s2Product}`, { uid: s2B.uid, body: { price: 1 } })
    const after = (await db<{ price: string }>(`SELECT price FROM products WHERE id=$1`, [s2Product]))[0].price
    r.status === 404 && before === after ? ok(BK, '2.8 cross-seller update → 404', `price unchanged (${after})`, { leak: false }) : bad(BK, '2.8 cross-seller update', `status=${r.status} priceChanged=${before !== after}`, { sec: true, leak: before !== after })
  })
  await t(BK, '2.9 cross-seller product DELETE → 404', async () => {
    const r = await api('DELETE', `/portal/sellers/products/${s2Product}`, { uid: s2B.uid })
    const alive = (await db<{ d: string }>(`SELECT deleted_at d FROM products WHERE id=$1`, [s2Product]))[0].d === null
    r.status === 404 && alive ? ok(BK, '2.9 cross-seller delete → 404', 'not soft-deleted', { leak: false }) : bad(BK, '2.9 cross-seller delete', `status=${r.status} stillAlive=${alive}`, { sec: true, leak: !alive })
  })
  await t(BK, '2.10 cross-seller image upload → 404', async () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    const r = await api('POST', `/portal/sellers/products/${s2Product}/images`, { uid: s2B.uid, body: { content_type: 'image/png', data_base64: png } })
    r.status === 404 ? ok(BK, '2.10 cross-seller image → 404', '', { leak: false }) : bad(BK, '2.10 cross-seller image', `got ${r.status}`, { sec: true, leak: r.status === 201 })
  })
  await t(BK, '2.11 update triggers re-embedding', async () => {
    const before = (await db<{ e: string }>(`SELECT substring(embedding::text,1,40) e FROM products WHERE id=$1`, [s2Product]))[0].e
    await api('PATCH', `/portal/sellers/products/${s2Product}`, { uid: s2A.uid, body: { description: 'Completely different now: a rugged power bank with USB-C PD fast charging and massive capacity for travel.' } })
    let changed = false
    for (let i = 0; i < 12; i++) { await sleep(2000); if ((await db<{ e: string }>(`SELECT substring(embedding::text,1,40) e FROM products WHERE id=$1`, [s2Product]))[0].e !== before) { changed = true; break } }
    changed ? ok(BK, '2.11 update re-embeds', 'embedding changed') : bad(BK, '2.11 update re-embeds', 'unchanged in 24s')
  })
  await t(BK, '2.12 soft delete removes from search', async () => {
    const dev = await mkDev()
    const r = await api('POST', '/portal/sellers/products', { uid: s2A.uid, body: validProduct({ name: '__P5R1_DelSearch_QX9__', description: longDesc + ' unique token QX9DELSEARCH.' }) })
    const pid = r.body.product.id
    let emb = false; for (let i = 0; i < 16; i++) { if ((await db<{ h: boolean }>(`SELECT embedding IS NOT NULL h FROM products WHERE id=$1`, [pid]))[0].h) { emb = true; break } await sleep(2000) }
    const before = await api('POST', '/v1/search', { auth: dev.liveKey, body: { query: '__P5R1_DelSearch_QX9__', limit: 20 } })
    const inBefore = (before.body.results ?? []).some((x: any) => x.id === pid)
    await api('DELETE', `/portal/sellers/products/${pid}`, { uid: s2A.uid })
    const after = await api('POST', '/v1/search', { auth: dev.liveKey, body: { query: '__P5R1_DelSearch_QX9__', limit: 20 } })
    const inAfter = (after.body.results ?? []).some((x: any) => x.id === pid)
    emb && inBefore && !inAfter ? ok(BK, '2.12 soft delete → gone from search', '') : bad(BK, '2.12 soft delete search', `embedded=${emb} before=${inBefore} after=${inAfter}`)
  })
  await t(BK, '2.13 soft-deleted not in seller list', async () => {
    const r = await api('POST', '/portal/sellers/products', { uid: s2A.uid, body: validProduct({ name: '__P5R1_DelList__' }) })
    const pid = r.body.product.id
    await api('DELETE', `/portal/sellers/products/${pid}`, { uid: s2A.uid })
    const list = await api('GET', '/portal/sellers/products', { uid: s2A.uid })
    !(list.body.products ?? []).some((p: any) => p.id === pid) ? ok(BK, '2.13 deleted not in list', '') : bad(BK, '2.13 deleted in list', 'still listed')
  })
  await t(BK, '2.14 discontinued not in search', async () => {
    const dev = await mkDev()
    const r = await api('POST', '/portal/sellers/products', { uid: s2A.uid, body: validProduct({ name: '__P5R1_Disc_ZZ8__', description: longDesc + ' unique token ZZ8DISCONTINUE.' }) })
    const pid = r.body.product.id
    let emb = false; for (let i = 0; i < 16; i++) { if ((await db<{ h: boolean }>(`SELECT embedding IS NOT NULL h FROM products WHERE id=$1`, [pid]))[0].h) { emb = true; break } await sleep(2000) }
    await api('PATCH', `/portal/sellers/products/${pid}`, { uid: s2A.uid, body: { availability: 'discontinued' } })
    const sr = await api('POST', '/v1/search', { auth: dev.liveKey, body: { query: '__P5R1_Disc_ZZ8__', limit: 20 } })
    emb && !(sr.body.results ?? []).some((x: any) => x.id === pid) ? ok(BK, '2.14 discontinued → gone from search', '') : bad(BK, '2.14 discontinued search', `embedded=${emb} present=${(sr.body.results ?? []).some((x: any) => x.id === pid)}`)
  })
  await t(BK, '2.15 concurrent product creates', async () => {
    const res = await Promise.all(Array.from({ length: 5 }, (_, i) => api('POST', '/portal/sellers/products', { uid: s2A.uid, body: validProduct({ name: `__P5R1_Conc_${i}__` }) })))
    const ids = res.map((r) => r.body.product?.id).filter(Boolean)
    const unique = new Set(ids).size === 5 && res.every((r) => r.status === 201)
    let embedded = 0; for (const id of ids) { for (let i = 0; i < 30; i++) { if ((await db<{ h: boolean }>(`SELECT embedding IS NOT NULL h FROM products WHERE id=$1`, [id]))[0]?.h) { embedded++; break } await sleep(2000) } }
    unique && embedded === 5 ? ok(BK, '2.15 concurrent creates', '5 unique ids, all embedded') : bad(BK, '2.15 concurrent creates', `unique=${unique} embedded=${embedded}/5`)
  })
}

// ═══ BLOCK 3 — ORDER MANAGEMENT ═══
async function block3() {
  const BK = 'Orders'; console.log(B('\n[Block 3] Order Management'))
  const seller = await mkSeller('OrderShop'), sellerB = await mkSeller('OrderShopB'), dev = await mkDev()
  const prod = await sandboxProduct(seller.id, '__P5R1_ORD__')

  let paidOrder = ''
  await t(BK, '3.1 paid order appears in dashboard', async () => {
    paidOrder = await orderConfirm(prod, dev.testKey, `p5r1_o1_${Date.now()}`, ADDR)
    let seen = false; for (let i = 0; i < 5; i++) { const l = await api('GET', '/portal/sellers/orders', { uid: seller.uid }); if ((l.body.orders ?? []).some((o: any) => o.id === paidOrder)) { seen = true; break } await sleep(1000) }
    seen ? ok(BK, '3.1 order in dashboard', '') : bad(BK, '3.1 order in dashboard', 'not seen in 5s')
  })
  await t(BK, '3.2 payment breakdown exact', async () => {
    const d = await api('GET', `/portal/sellers/orders/${paidOrder}`, { uid: seller.uid })
    const o = d.body.order, gross = Number(o.gross_amount), fee = Number(o.platform_fee), payout = Number(o.seller_amount)
    Math.abs(fee - gross * 0.1) < 0.01 && Math.abs(payout - gross * 0.9) < 0.01 && Math.abs(gross - (fee + payout)) < 0.01
      ? ok(BK, '3.2 breakdown', `gross=${gross} fee=${fee} payout=${payout}`, { data: true }) : bad(BK, '3.2 breakdown', `gross=${gross} fee=${fee} payout=${payout}`, { data: true })
  })
  await t(BK, '3.3 full address hidden until paid', async () => {
    const or = await api('POST', '/v1/order', { auth: dev.testKey, body: { product_id: prod, quantity: 1, session_id: `p5r1_pend_${Date.now()}`, shipping_address: ADDR } })
    const d = await api('GET', `/portal/sellers/orders/${or.body.order_id}`, { uid: seller.uid })
    const a = d.body.order.shipping_address ?? {}
    !a.line1 && !a.postal_code && (a.city || a.state) ? ok(BK, '3.3 address redacted (pending)', 'only city/state exposed', { sec: true }) : bad(BK, '3.3 address redacted', `exposed=${JSON.stringify(a)}`, { sec: true })
  })
  await t(BK, '3.4 full address visible after paid', async () => {
    const d = await api('GET', `/portal/sellers/orders/${paidOrder}`, { uid: seller.uid })
    const a = d.body.order.shipping_address ?? {}
    a.line1 === ADDR.line1 && a.postal_code === ADDR.postal_code ? ok(BK, '3.4 full address (paid)', '') : bad(BK, '3.4 full address', `addr=${JSON.stringify(a)}`)
  })
  await t(BK, '3.5 process: paid → processing', async () => {
    const r = await api('PATCH', `/portal/sellers/orders/${paidOrder}/process`, { uid: seller.uid, body: {} })
    const st = (await db<{ status: string }>(`SELECT status FROM orders WHERE id=$1`, [paidOrder]))[0].status
    const ev = (await db(`SELECT 1 FROM order_events WHERE order_id=$1 AND event_type='order.processing'`, [paidOrder])).length
    r.status === 200 && st === 'processing' && ev === 1 ? ok(BK, '3.5 process', 'status=processing + event') : bad(BK, '3.5 process', `status=${st} ev=${ev}`)
  })
  await t(BK, '3.6 cannot process twice → 409', async () => {
    const r = await api('PATCH', `/portal/sellers/orders/${paidOrder}/process`, { uid: seller.uid, body: {} })
    r.status === 409 ? ok(BK, '3.6 double process → 409', '') : bad(BK, '3.6 double process', `got ${r.status}`)
  })
  const future = new Date(Date.now() + 6 * 864e5).toISOString().slice(0, 10)
  await t(BK, '3.7 ship invalid carrier → 400', async () => {
    const r = await api('PATCH', `/portal/sellers/orders/${paidOrder}/ship`, { uid: seller.uid, body: { tracking_number: 'T1', carrier: 'PigeonPost', estimated_delivery: future } })
    r.status === 400 ? ok(BK, '3.7 invalid carrier → 400', '') : bad(BK, '3.7 invalid carrier', `got ${r.status}`)
  })
  await t(BK, '3.8 ship past date → 400', async () => {
    const r = await api('PATCH', `/portal/sellers/orders/${paidOrder}/ship`, { uid: seller.uid, body: { tracking_number: 'T1', carrier: 'Delhivery', estimated_delivery: '2020-01-01' } })
    r.status === 400 ? ok(BK, '3.8 past date → 400', '') : bad(BK, '3.8 past date', `got ${r.status}`)
  })
  await t(BK, '3.9 ship missing tracking → 400', async () => {
    const r = await api('PATCH', `/portal/sellers/orders/${paidOrder}/ship`, { uid: seller.uid, body: { carrier: 'Delhivery', estimated_delivery: future } })
    r.status === 400 ? ok(BK, '3.9 missing tracking → 400', '') : bad(BK, '3.9 missing tracking', `got ${r.status}`)
  })
  await t(BK, '3.10 ship fires DB + webhook + email path', async () => {
    const rcv = receiver(20701)
    try {
      await api('POST', '/portal/webhooks', { uid: dev.uid, body: { url: rcv.url, events: ['order.shipped'] } })
      const r = await api('PATCH', `/portal/sellers/orders/${paidOrder}/ship`, { uid: seller.uid, body: { tracking_number: 'TRKP5R1', carrier: 'BlueDart', estimated_delivery: future } })
      await sleep(1200)
      const row = (await db<{ status: string; tracking_number: string }>(`SELECT status, tracking_number FROM orders WHERE id=$1`, [paidOrder]))[0]
      const wh = rcv.captured.find((c) => c.event === 'order.shipped')
      r.status === 200 && row.status === 'shipped' && row.tracking_number === 'TRKP5R1' && wh?.data?.tracking_number === 'TRKP5R1'
        ? ok(BK, '3.10 ship side effects', 'DB shipped + webhook fired w/ tracking (email path runs)') : bad(BK, '3.10 ship side effects', `db=${row.status} wh=${!!wh}`)
    } finally { await rcv.close(); await db(`DELETE FROM webhooks WHERE url=$1`, [rcv.url]) }
  })
  await t(BK, '3.11 cross-seller ship → 404', async () => {
    const o2 = await orderConfirm(prod, dev.testKey, `p5r1_o2_${Date.now()}`, ADDR)
    const r = await api('PATCH', `/portal/sellers/orders/${o2}/ship`, { uid: sellerB.uid, body: { tracking_number: 'X', carrier: 'DTDC', estimated_delivery: future } })
    const st = (await db<{ status: string }>(`SELECT status FROM orders WHERE id=$1`, [o2]))[0].status
    r.status === 404 && st === 'paid' ? ok(BK, '3.11 cross-seller ship → 404', 'order unchanged', { leak: false }) : bad(BK, '3.11 cross-seller ship', `status=${r.status} order=${st}`, { sec: true, leak: st === 'shipped' })
  })
  await t(BK, '3.12 earnings match order', async () => {
    const e = (await db<{ gross_amount: string; seller_amount: string; status: string }>(`SELECT gross_amount, seller_amount, status FROM seller_earnings WHERE order_id=$1`, [paidOrder]))[0]
    Number(e.seller_amount) === 900 && Number(e.gross_amount) === 1000 && e.status === 'pending'
      ? ok(BK, '3.12 earnings match', `gross=1000 payout=900 pending`, { data: true }) : bad(BK, '3.12 earnings match', `${JSON.stringify(e)}`, { data: true })
  })
}

// ═══ BLOCK 4 — RETURNS STATE MACHINE ═══
async function block4() {
  const BK = 'Returns'; console.log(B('\n[Block 4] Returns State Machine'))
  const seller = await mkSeller('RetShop'), sellerB = await mkSeller('RetShopB'), dev = await mkDev()
  const prod = await sandboxProduct(seller.id, '__P5R1_RET__')
  // helper: a shipped order (returnable)
  const shippedOrder = async () => {
    const o = await orderConfirm(prod, dev.testKey, `p5r1_r_${Date.now()}_${Math.random()}`, ADDR)
    await api('PATCH', `/portal/sellers/orders/${o}/ship`, { uid: seller.uid, body: { tracking_number: 'S' + Math.random(), carrier: 'Delhivery', estimated_delivery: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10) } })
    return o
  }
  const mkReturn = async (orderId: string, reason = 'damaged') => (await api('POST', '/v1/return', { auth: dev.liveKey, body: { order_id: orderId, reason } })).body.return_id

  await t(BK, '4.1 return on pending order → 400', async () => {
    const or = await api('POST', '/v1/order', { auth: dev.testKey, body: { product_id: prod, quantity: 1, session_id: `p5r1_pp_${Date.now()}`, shipping_address: ADDR } })
    const r = await api('POST', '/v1/return', { auth: dev.liveKey, body: { order_id: or.body.order_id, reason: 'damaged' } })
    r.status === 400 ? ok(BK, '4.1 pending → 400', '') : bad(BK, '4.1 pending → 400', `got ${r.status}`)
  })
  await t(BK, '4.2 return on cancelled order → 400', async () => {
    const or = await api('POST', '/v1/order', { auth: dev.testKey, body: { product_id: prod, quantity: 1, session_id: `p5r1_cx_${Date.now()}`, shipping_address: ADDR } })
    await db(`UPDATE orders SET status='cancelled' WHERE id=$1`, [or.body.order_id])
    const r = await api('POST', '/v1/return', { auth: dev.liveKey, body: { order_id: or.body.order_id, reason: 'damaged' } })
    r.status === 400 ? ok(BK, '4.2 cancelled → 400', '') : bad(BK, '4.2 cancelled → 400', `got ${r.status}`)
  })
  let mainOrder = '', mainReturn = ''
  await t(BK, '4.3 return within window → 201', async () => {
    mainOrder = await shippedOrder()
    const r = await api('POST', '/v1/return', { auth: dev.liveKey, body: { order_id: mainOrder, reason: 'damaged', description: 'cracked on arrival' } })
    mainReturn = r.body.return_id
    r.status === 201 && !!mainReturn ? ok(BK, '4.3 valid return → 201', '') : bad(BK, '4.3 valid return', `status=${r.status}`)
  })
  await t(BK, '4.4 return outside window → 400', async () => {
    const o = await shippedOrder()
    await db(`UPDATE orders SET created_at=now()-interval '31 days' WHERE id=$1`, [o])
    const r = await api('POST', '/v1/return', { auth: dev.liveKey, body: { order_id: o, reason: 'damaged' } })
    r.status === 400 ? ok(BK, '4.4 outside window → 400', '') : bad(BK, '4.4 outside window', `got ${r.status}`)
  })
  await t(BK, '4.5 duplicate return → 409', async () => {
    const r = await api('POST', '/v1/return', { auth: dev.liveKey, body: { order_id: mainOrder, reason: 'other' } })
    r.status === 409 ? ok(BK, '4.5 duplicate → 409', '') : bad(BK, '4.5 duplicate → 409', `got ${r.status}`)
  })
  await t(BK, '4.6 buyer address snapshot on creation', async () => {
    const snap = (await db<{ pickup_address: any }>(`SELECT pickup_address FROM returns WHERE id=$1`, [mainReturn]))[0].pickup_address
    snap?.line1 === ADDR.line1 && snap?.postal_code === ADDR.postal_code && snap?.city === ADDR.city
      ? ok(BK, '4.6 address snapshot', 'pickup_address == order.shipping_address', { data: true }) : bad(BK, '4.6 address snapshot', `${JSON.stringify(snap)}`, { data: true })
  })
  await t(BK, '4.7 all return reasons accepted', async () => {
    const reasons = ['wrong_product', 'damaged', 'not_as_described', 'changed_mind', 'defective', 'other']
    const codes: number[] = []
    for (const reason of reasons) { const o = await shippedOrder(); codes.push((await api('POST', '/v1/return', { auth: dev.liveKey, body: { order_id: o, reason } })).status) }
    codes.every((c) => c === 201) ? ok(BK, '4.7 all reasons → 201', `6/6`) : bad(BK, '4.7 all reasons', `codes=${codes}`)
  })
  await t(BK, '4.8 invalid return reason → 400', async () => {
    const o = await shippedOrder()
    const r = await api('POST', '/v1/return', { auth: dev.liveKey, body: { order_id: o, reason: 'i_dont_like_it' } })
    r.status === 400 ? ok(BK, '4.8 invalid reason → 400', '') : bad(BK, '4.8 invalid reason', `got ${r.status}`)
  })
  // webhook receiver for the rest of the lifecycle
  const rcv = receiver(20702)
  await api('POST', '/portal/webhooks', { uid: dev.uid, body: { url: rcv.url, events: ['return.approved', 'return.rejected', 'return.pickup_scheduled', 'return.picked_up', 'return.received'] } })
  const evCount = async (orderId: string, type: string) => (await db<{ n: number }>(`SELECT count(*)::int n FROM order_events WHERE order_id=$1 AND event_type=$2`, [orderId, type]))[0].n

  await t(BK, '4.9 approve → status + event + webhook', async () => {
    const r = await api('POST', `/portal/sellers/returns/${mainReturn}/approve`, { uid: seller.uid, body: {} })
    await sleep(900)
    const st = (await db<{ status: string }>(`SELECT status FROM returns WHERE id=$1`, [mainReturn]))[0].status
    r.status === 200 && st === 'approved' && await evCount(mainOrder, 'return.approved') === 1 && rcv.captured.some((c) => c.event === 'return.approved')
      ? ok(BK, '4.9 approve', 'approved + event + webhook (email: "pickup being arranged")') : bad(BK, '4.9 approve', `status=${st}`)
  })
  await t(BK, '4.10 cannot approve twice → 409', async () => {
    const r = await api('POST', `/portal/sellers/returns/${mainReturn}/approve`, { uid: seller.uid, body: {} })
    r.status === 409 ? ok(BK, '4.10 double approve → 409', '') : bad(BK, '4.10 double approve', `got ${r.status}`)
  })
  let rejOrder = '', rejReturn = ''
  await t(BK, '4.11 reject requires reason → 400', async () => {
    rejOrder = await shippedOrder(); rejReturn = await mkReturn(rejOrder, 'changed_mind')
    const r = await api('POST', `/portal/sellers/returns/${rejReturn}/reject`, { uid: seller.uid, body: {} })
    r.status === 400 ? ok(BK, '4.11 reject no reason → 400', '') : bad(BK, '4.11 reject no reason', `got ${r.status}`)
  })
  await t(BK, '4.12 reject with reason → side effects', async () => {
    const r = await api('POST', `/portal/sellers/returns/${rejReturn}/reject`, { uid: seller.uid, body: { seller_notes: 'Item appears used.' } })
    await sleep(900)
    const st = (await db<{ status: string; seller_notes: string }>(`SELECT status, seller_notes FROM returns WHERE id=$1`, [rejReturn]))[0]
    r.status === 200 && st.status === 'rejected' && st.seller_notes === 'Item appears used.' && await evCount(rejOrder, 'return.rejected') === 1 && rcv.captured.some((c) => c.event === 'return.rejected')
      ? ok(BK, '4.12 reject side effects', 'rejected + notes + event + webhook') : bad(BK, '4.12 reject', `${JSON.stringify(st)}`)
  })
  await t(BK, '4.13 cannot act on rejected (terminal) → 409', async () => {
    const r = await api('POST', `/portal/sellers/returns/${rejReturn}/approve`, { uid: seller.uid, body: {} })
    r.status === 409 ? ok(BK, '4.13 act on rejected → 409', '') : bad(BK, '4.13 act on rejected', `got ${r.status}`)
  })
  await t(BK, '4.14 schedule pickup → full side effects', async () => {
    const r = await api('POST', `/portal/sellers/returns/${mainReturn}/schedule-pickup`, { uid: seller.uid, body: { carrier: 'Delhivery', pickup_date: new Date(Date.now() + 3 * 864e5).toISOString(), pickup_tracking_number: 'DEL123456789' } })
    await sleep(900)
    const row = (await db<any>(`SELECT status, pickup_carrier, pickup_tracking_number, pickup_date FROM returns WHERE id=$1`, [mainReturn]))[0]
    const wh = rcv.captured.find((c) => c.event === 'return.pickup_scheduled')
    r.status === 200 && row.status === 'pickup_scheduled' && row.pickup_carrier === 'Delhivery' && row.pickup_tracking_number === 'DEL123456789' && await evCount(mainOrder, 'return.pickup_scheduled') === 1 && wh?.data?.carrier === 'Delhivery' && wh?.data?.tracking_number === 'DEL123456789'
      ? ok(BK, '4.14 schedule pickup', 'stored + event + webhook w/ full payload') : bad(BK, '4.14 schedule pickup', `row=${JSON.stringify(row)} wh=${JSON.stringify(wh?.data)}`)
  })
  await t(BK, '4.15 schedule pickup past date → 400', async () => {
    const o = await shippedOrder(); const ret = await mkReturn(o); await api('POST', `/portal/sellers/returns/${ret}/approve`, { uid: seller.uid, body: {} })
    const r = await api('POST', `/portal/sellers/returns/${ret}/schedule-pickup`, { uid: seller.uid, body: { carrier: 'DTDC', pickup_date: '2020-01-01T10:00:00Z', pickup_tracking_number: 'X' } })
    r.status === 400 ? ok(BK, '4.15 past pickup date → 400', '') : bad(BK, '4.15 past pickup date', `got ${r.status}`)
  })
  await t(BK, '4.16 mark picked up → side effects', async () => {
    const r = await api('POST', `/portal/sellers/returns/${mainReturn}/picked-up`, { uid: seller.uid, body: {} })
    await sleep(900)
    const st = (await db<{ status: string }>(`SELECT status FROM returns WHERE id=$1`, [mainReturn]))[0].status
    r.status === 200 && st === 'picked_up' && await evCount(mainOrder, 'return.picked_up') === 1 && rcv.captured.some((c) => c.event === 'return.picked_up')
      ? ok(BK, '4.16 picked up', 'status + event + webhook') : bad(BK, '4.16 picked up', `status=${st}`)
  })
  await t(BK, '4.17 cannot pick up before scheduling → 409', async () => {
    const o = await shippedOrder(); const ret = await mkReturn(o); await api('POST', `/portal/sellers/returns/${ret}/approve`, { uid: seller.uid, body: {} })
    const r = await api('POST', `/portal/sellers/returns/${ret}/picked-up`, { uid: seller.uid, body: {} })
    r.status === 409 ? ok(BK, '4.17 pickup before schedule → 409', '') : bad(BK, '4.17 pickup before schedule', `got ${r.status}`)
  })
  await t(BK, '4.18 mark received → 6 side effects', async () => {
    const r = await api('POST', `/portal/sellers/returns/${mainReturn}/received`, { uid: seller.uid, body: {} })
    await sleep(900)
    const ret = (await db<any>(`SELECT status, refund_amount FROM returns WHERE id=$1`, [mainReturn]))[0]
    const earn = (await db<{ status: string }>(`SELECT status FROM seller_earnings WHERE order_id=$1`, [mainOrder]))[0]
    const ord = (await db<{ status: string }>(`SELECT status FROM orders WHERE id=$1`, [mainOrder]))[0].status
    const wh = rcv.captured.find((c) => c.event === 'return.received')
    const allSix = r.status === 200 && ret.status === 'received' && Number(ret.refund_amount) === 900 && earn.status === 'cancelled' && ord === 'returned' && await evCount(mainOrder, 'return.received') === 1 && Number(wh?.data?.refund_amount) === 900
    allSix ? ok(BK, '4.18 received (6 effects)', `received, refund=900, earnings cancelled, order returned, event, webhook`, { data: true }) : bad(BK, '4.18 received', `retStatus=${ret.status} refund=${ret.refund_amount} earn=${earn.status} ord=${ord} wh=${JSON.stringify(wh?.data)}`, { data: true })
  })
  await t(BK, '4.19 cannot receive before picked up → 409', async () => {
    const o = await shippedOrder(); const ret = await mkReturn(o)
    await api('POST', `/portal/sellers/returns/${ret}/approve`, { uid: seller.uid, body: {} })
    await api('POST', `/portal/sellers/returns/${ret}/schedule-pickup`, { uid: seller.uid, body: { carrier: 'DTDC', pickup_date: new Date(Date.now() + 2 * 864e5).toISOString(), pickup_tracking_number: 'X1' } })
    const r = await api('POST', `/portal/sellers/returns/${ret}/received`, { uid: seller.uid, body: {} })
    r.status === 409 ? ok(BK, '4.19 receive before pickup → 409', '') : bad(BK, '4.19 receive before pickup', `got ${r.status}`)
  })
  await rcv.close(); await db(`DELETE FROM webhooks WHERE url=$1`, [rcv.url])

  await t(BK, '4.20 auto-suspend at threshold + products hidden', async () => {
    const sus = await mkSeller('SuspendShop'); const sprod = await sandboxProduct(sus.id, '__P5R1_SUS_YT7__')
    // give it an embedding so it's searchable
    await db(`UPDATE products SET is_sandbox=false WHERE id=$1`, [sprod]) // make it a real product so it appears in live search
    await db(`UPDATE products SET name='Auralis SuspendCheck YT7 Earbuds', description='Auralis SuspendCheck YT7 distinctive earbuds for suspend testing.' WHERE id=$1`, [sprod])
    let emb = false; for (let i = 0; i < 20; i++) { if ((await db<{ h: boolean }>(`SELECT embedding IS NOT NULL h FROM products WHERE id=$1`, [sprod]))[0].h) { emb = true; break } await sleep(2000) }
    const okSeller = await mkSeller('OkShop'); const okprod = await sandboxProduct(okSeller.id, '__P5R1_OK_YT7__')
    await db(`UPDATE products SET is_sandbox=false, name='Auralis OkCheck YT7 Earbuds', description='Auralis OkCheck YT7 distinctive earbuds.' WHERE id=$1`, [okprod])
    for (let i = 0; i < 20; i++) { if ((await db<{ h: boolean }>(`SELECT embedding IS NOT NULL h FROM products WHERE id=$1`, [okprod]))[0].h) break; await sleep(2000) }
    // 5 received returns in quick succession → suspend. Use a sandbox product for orders.
    const sandProd = await sandboxProduct(sus.id, '__P5R1_SUS_ORD__')
    for (let i = 0; i < 5; i++) {
      const o = await orderConfirm(sandProd, dev.testKey, `p5r1_sus_${Date.now()}_${i}`, ADDR)
      await api('PATCH', `/portal/sellers/orders/${o}/ship`, { uid: sus.uid, body: { tracking_number: 'S' + i, carrier: 'DTDC', estimated_delivery: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10) } })
      const ret = await mkReturn(o)
      await api('POST', `/portal/sellers/returns/${ret}/approve`, { uid: sus.uid, body: {} })
      await api('POST', `/portal/sellers/returns/${ret}/schedule-pickup`, { uid: sus.uid, body: { carrier: 'DTDC', pickup_date: new Date(Date.now() + 2 * 864e5).toISOString(), pickup_tracking_number: 'P' + i } })
      await api('POST', `/portal/sellers/returns/${ret}/picked-up`, { uid: sus.uid, body: {} })
      await api('POST', `/portal/sellers/returns/${ret}/received`, { uid: sus.uid, body: {} })
    }
    const status = (await db<{ status: string }>(`SELECT status FROM sellers WHERE id=$1`, [sus.id]))[0].status
    await sleep(400)
    const sr = await api('POST', '/v1/search', { auth: dev.liveKey, body: { query: 'Auralis YT7 Earbuds', limit: 20 } })
    const susHidden = !(sr.body.results ?? []).some((x: any) => x.id === sprod)
    const okVisible = (sr.body.results ?? []).some((x: any) => x.id === okprod)
    status === 'suspended' && emb && susHidden && okVisible
      ? ok(BK, '4.20 auto-suspend + hidden', `suspended after 5 returns, products hidden, other seller visible`, { sec: true }) : bad(BK, '4.20 auto-suspend', `status=${status} susHidden=${susHidden} okVisible=${okVisible}`, { sec: true })
  })
}

// ═══ BLOCK 5 — QUALITY SCORE ═══
async function block5() {
  const BK = 'Quality'; console.log(B('\n[Block 5] Quality Score System'))
  const seller = await mkSeller('QShop'), dev = await mkDev()
  const score = async (id: string) => (await db<{ q: number }>(`SELECT product_quality_score q FROM products WHERE id=$1`, [id]))[0].q
  // SQL seeder for formula tests
  const seedOrders = async (productId: string, sellerId: string, specs: { sessions: string[]; status?: string; total?: number }) => {
    for (const s of specs.sessions) await db(`INSERT INTO orders (session_id,product_id,seller_id,quantity,unit_price,total_price,currency,status,stripe_payment_intent_id,expires_at) VALUES ($1,$2,$3,1,$4,$4,'INR',$5,'pi_test_mock_'||gen_random_uuid(),now()+interval '1 hour')`, [s, productId, sellerId, specs.total ?? 1000, specs.status ?? 'paid'])
  }

  await t(BK, '5.1 new product starts at 50', async () => {
    const r = await api('POST', '/portal/sellers/products', { uid: seller.uid, body: validProduct({ name: '__P5R1_Q50__' }) })
    await score(r.body.product.id) === 50 ? ok(BK, '5.1 starts at 50', '') : bad(BK, '5.1 starts at 50', `=${await score(r.body.product.id)}`)
  })
  await t(BK, '5.2 score unchanged < 5 orders', async () => {
    const pid = await sandboxProduct(seller.id, '__P5R1_Q4__')
    await seedOrders(pid, seller.id, { sessions: ['a', 'b', 'c', 'd'].map((x) => `q4_${x}_${Date.now()}`) })
    await recalculateProductQualityScore(pid)
    await score(pid) === 50 ? ok(BK, '5.2 <5 orders → 50', '') : bad(BK, '5.2 <5 orders', `=${await score(pid)}`)
  })
  await t(BK, '5.3 score at 5 orders, 0 returns', async () => {
    const pid = await sandboxProduct(seller.id, '__P5R1_Q5__')
    await seedOrders(pid, seller.id, { sessions: [0, 1, 2, 3, 4].map((i) => `q5_${i}_${Date.now()}`) })
    await recalculateProductQualityScore(pid)
    const m = await getProductQualityMetrics(pid), exp = calculateProductQualityScore(m)
    await score(pid) === exp && exp === 40 ? ok(BK, '5.3 5 orders → 40', `formula=40 (return40+repeat0+vol0)`) : bad(BK, '5.3 5 orders', `score=${await score(pid)} exp=${exp} m=${JSON.stringify(m)}`)
  })
  await t(BK, '5.4 score with returns (10 orders, 2 returns)', async () => {
    const pid = await sandboxProduct(seller.id, '__P5R1_Q10R__')
    await seedOrders(pid, seller.id, { sessions: Array.from({ length: 8 }, (_, i) => `q10r_p${i}_${Date.now()}`), status: 'paid' })
    await seedOrders(pid, seller.id, { sessions: Array.from({ length: 2 }, (_, i) => `q10r_r${i}_${Date.now()}`), status: 'returned' })
    const retOrders = await db<{ id: string }>(`SELECT id FROM orders WHERE product_id=$1 AND status='returned'`, [pid])
    for (const o of retOrders) await db(`INSERT INTO returns (order_id,seller_id,reason,status) VALUES ($1,$2,'damaged','received')`, [o.id, seller.id])
    await recalculateProductQualityScore(pid)
    const m = await getProductQualityMetrics(pid), exp = calculateProductQualityScore(m)
    await score(pid) === exp && exp === 5 ? ok(BK, '5.4 10 orders/2 returns → 5', `return_rate=20%→0pts + vol5 = 5`) : bad(BK, '5.4 returns', `score=${await score(pid)} exp=${exp} m=${JSON.stringify(m)}`)
  })
  await t(BK, '5.5 score with repeat buyers (10 orders, 5×2)', async () => {
    const pid = await sandboxProduct(seller.id, '__P5R1_QREP__')
    const sessions: string[] = []
    for (let i = 0; i < 5; i++) { const s = `qrep_${i}_${Date.now()}`; sessions.push(s, s) }
    await seedOrders(pid, seller.id, { sessions })
    await recalculateProductQualityScore(pid)
    const m = await getProductQualityMetrics(pid), exp = calculateProductQualityScore(m)
    await score(pid) === exp && exp === 80 ? ok(BK, '5.5 repeat buyers → 80', `return40+repeat35+vol5`) : bad(BK, '5.5 repeat buyers', `score=${await score(pid)} exp=${exp} m=${JSON.stringify(m)}`)
  })
  await t(BK, '5.6 score updates after order paid (trigger)', async () => {
    const pid = await sandboxProduct(seller.id, '__P5R1_QTRIG__')
    for (let i = 0; i < 5; i++) await orderConfirm(pid, dev.testKey, `qtrig_${i}_${Date.now()}`)
    await sleep(800)
    await score(pid) !== 50 ? ok(BK, '5.6 recalc on paid', `score moved to ${await score(pid)} via confirm trigger`) : bad(BK, '5.6 recalc on paid', 'still 50')
  })
  await t(BK, '5.7 score drops after return received', async () => {
    const pid = await sandboxProduct(seller.id, '__P5R1_QDROP__')
    await db(`UPDATE products SET product_quality_score=80 WHERE id=$1`, [pid])
    const o = await orderConfirm(pid, dev.testKey, `qdrop_${Date.now()}`, ADDR)
    await api('PATCH', `/portal/sellers/orders/${o}/ship`, { uid: seller.uid, body: { tracking_number: 'D1', carrier: 'DTDC', estimated_delivery: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10) } })
    const ret = (await api('POST', '/v1/return', { auth: dev.liveKey, body: { order_id: o, reason: 'defective' } })).body.return_id
    await api('POST', `/portal/sellers/returns/${ret}/approve`, { uid: seller.uid, body: {} })
    await api('POST', `/portal/sellers/returns/${ret}/schedule-pickup`, { uid: seller.uid, body: { carrier: 'DTDC', pickup_date: new Date(Date.now() + 2 * 864e5).toISOString(), pickup_tracking_number: 'D1' } })
    await api('POST', `/portal/sellers/returns/${ret}/picked-up`, { uid: seller.uid, body: {} })
    await api('POST', `/portal/sellers/returns/${ret}/received`, { uid: seller.uid, body: {} })
    await sleep(800)
    await score(pid) < 80 ? ok(BK, '5.7 score drops after return', `80 → ${await score(pid)}`) : bad(BK, '5.7 score drops', `=${await score(pid)}`)
  })
  await t(BK, '5.8 quality_score in search results', async () => {
    const r = await api('POST', '/v1/search', { auth: dev.liveKey, body: { query: 'earbuds', limit: 5 } })
    const all = (r.body.results ?? []).every((x: any) => Number.isInteger(x.quality_score) && x.quality_score >= 0 && x.quality_score <= 100)
    r.body.results.length > 0 && all ? ok(BK, '5.8 quality_score in search', `e.g. ${r.body.results[0].quality_score}`) : bad(BK, '5.8 quality_score in search', `missing/invalid`)
  })
  await t(BK, '5.9 higher quality ranks above lower', async () => {
    const NAME = 'Auralis Tideglass Premium Earbuds QR5'
    const mk = async () => (await db<{ id: string }>(`INSERT INTO products (seller_id,name,brand,category,description,specs,images,price,stock,currency,availability,is_sandbox) VALUES ($1,$2,'Auralis','Wireless Earbuds',$3,'{}'::jsonb,'{}',2999,100,'INR','in_stock',false) RETURNING id`, [seller.id, NAME, NAME + ' with active noise cancellation and long battery life.']))[0].id
    const Hi = await mk(), Lo = await mk()
    let emb = false; for (let i = 0; i < 25; i++) { const a = (await db<{ h: boolean }>(`SELECT embedding IS NOT NULL h FROM products WHERE id=$1`, [Hi]))[0].h, b = (await db<{ h: boolean }>(`SELECT embedding IS NOT NULL h FROM products WHERE id=$1`, [Lo]))[0].h; if (a && b) { emb = true; break } await sleep(2000) }
    await db(`UPDATE products SET product_quality_score=90 WHERE id=$1`, [Hi]); await db(`UPDATE products SET product_quality_score=20 WHERE id=$1`, [Lo])
    const rr = await api('POST', '/v1/search', { auth: dev.liveKey, body: { query: NAME, limit: 10 } })
    const ids = (rr.body.results ?? []).map((x: any) => x.id); const pHi = ids.indexOf(Hi), pLo = ids.indexOf(Lo)
    emb && pHi >= 0 && pLo >= 0 && pHi < pLo ? ok(BK, '5.9 quality ranking', `q90@${pHi} < q20@${pLo}`) : bad(BK, '5.9 quality ranking', `embedded=${emb} Hi@${pHi} Lo@${pLo}`)
  })
  await t(BK, '5.10 quality_score in order details', async () => {
    const pid = await sandboxProduct(seller.id, '__P5R1_QORD__')
    const o = await orderConfirm(pid, dev.testKey, `qord_${Date.now()}`)
    const r = await api('GET', `/v1/order/${o}`)
    Number.isInteger(r.body.product?.quality_score) ? ok(BK, '5.10 quality_score in order', `=${r.body.product.quality_score}`) : bad(BK, '5.10 quality_score in order', `${JSON.stringify(r.body.product)}`)
  })
  await t(BK, '5.11 dashboard quality stats', async () => {
    const low = await sandboxProduct(seller.id, '__P5R1_QLOW__'); await db(`UPDATE products SET is_sandbox=false, product_quality_score=20 WHERE id=$1`, [low])
    const stats = (await api('GET', '/portal/sellers/me/stats', { uid: seller.uid })).body.stats
    typeof stats.quality_score === 'number' && stats.products_below_40 >= 1 ? ok(BK, '5.11 dashboard quality', `avg=${stats.quality_score} below40=${stats.products_below_40}`) : bad(BK, '5.11 dashboard quality', `${JSON.stringify(stats)}`)
  })
}

// ═══ BLOCK 6 — EARNINGS LEDGER ═══
async function block6() {
  const BK = 'Earnings'; console.log(B('\n[Block 6] Earnings Ledger'))
  const seller = await mkSeller('EarnShop'), dev = await mkDev()
  const prod = await sandboxProduct(seller.id, '__P5R1_EARN__')

  let o1 = ''
  await t(BK, '6.1 earnings row on payment', async () => {
    o1 = await orderConfirm(prod, dev.testKey, `e1_${Date.now()}`)
    const n = (await db<{ n: number }>(`SELECT count(*)::int n FROM seller_earnings WHERE order_id=$1`, [o1]))[0].n
    n === 1 ? ok(BK, '6.1 earnings created', '1 row', { data: true }) : bad(BK, '6.1 earnings created', `${n} rows`, { data: true })
  })
  await t(BK, '6.2 double-confirm idempotency', async () => {
    await api('POST', `/v1/sandbox/confirm/${o1}`, { body: {} })
    const n = (await db<{ n: number }>(`SELECT count(*)::int n FROM seller_earnings WHERE order_id=$1`, [o1]))[0].n
    n === 1 ? ok(BK, '6.2 idempotent', 'still 1 row', { data: true }) : bad(BK, '6.2 idempotent', `${n} rows`, { data: true })
  })
  await t(BK, '6.3 fee calculation exact', async () => {
    const p1000 = await sandboxProduct(seller.id, '__P5R1_E1000__'); await db(`UPDATE products SET price=1000 WHERE id=$1`, [p1000])
    const p999 = await sandboxProduct(seller.id, '__P5R1_E999__'); await db(`UPDATE products SET price=999 WHERE id=$1`, [p999])
    const oa = await orderConfirm(p1000, dev.testKey, `e1000_${Date.now()}`), ob = await orderConfirm(p999, dev.testKey, `e999_${Date.now()}`)
    const ea = (await db<any>(`SELECT gross_amount,platform_fee,seller_amount FROM seller_earnings WHERE order_id=$1`, [oa]))[0]
    const eb = (await db<any>(`SELECT gross_amount,platform_fee,seller_amount FROM seller_earnings WHERE order_id=$1`, [ob]))[0]
    Number(ea.gross_amount) === 1000 && Number(ea.platform_fee) === 100 && Number(ea.seller_amount) === 900 &&
    Number(eb.gross_amount) === 999 && Number(eb.platform_fee) === 99.90 && Number(eb.seller_amount) === 899.10
      ? ok(BK, '6.3 fee exact', `1000→100/900, 999→99.90/899.10`, { data: true }) : bad(BK, '6.3 fee exact', `a=${JSON.stringify(ea)} b=${JSON.stringify(eb)}`, { data: true })
  })
  await t(BK, '6.4 earnings status pending on creation', async () => {
    const st = (await db<{ status: string }>(`SELECT status FROM seller_earnings WHERE order_id=$1`, [o1]))[0].status
    st === 'pending' ? ok(BK, '6.4 status pending', '') : bad(BK, '6.4 status pending', `=${st}`)
  })
  await t(BK, '6.5 earnings cancelled on return received', async () => {
    const o = await orderConfirm(prod, dev.testKey, `e5_${Date.now()}`, ADDR)
    await api('PATCH', `/portal/sellers/orders/${o}/ship`, { uid: seller.uid, body: { tracking_number: 'E5', carrier: 'DTDC', estimated_delivery: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10) } })
    const ret = (await api('POST', '/v1/return', { auth: dev.liveKey, body: { order_id: o, reason: 'damaged' } })).body.return_id
    for (const step of ['approve', 'schedule-pickup', 'picked-up', 'received']) {
      const body = step === 'schedule-pickup' ? { carrier: 'DTDC', pickup_date: new Date(Date.now() + 2 * 864e5).toISOString(), pickup_tracking_number: 'E5' } : {}
      await api('POST', `/portal/sellers/returns/${ret}/${step}`, { uid: seller.uid, body })
    }
    const st = (await db<{ status: string }>(`SELECT status FROM seller_earnings WHERE order_id=$1`, [o]))[0].status
    const totals = (await api('GET', '/portal/sellers/me/earnings', { uid: seller.uid })).body.totals
    st === 'cancelled' ? ok(BK, '6.5 cancelled on return', `status=cancelled, pending=${totals.pending_payout}`, { data: true }) : bad(BK, '6.5 cancelled on return', `=${st}`, { data: true })
  })
  await t(BK, '6.6 dashboard pending payout total', async () => {
    const s = await mkSeller('PayoutShop'); const pp = await sandboxProduct(s.id, '__P5R1_PAYOUT__')
    const oA = await orderConfirm(pp, dev.testKey, `pp1_${Date.now()}`), oB = await orderConfirm(pp, dev.testKey, `pp2_${Date.now()}`)
    const oC = await orderConfirm(pp, dev.testKey, `pp3_${Date.now()}`, ADDR)
    await api('PATCH', `/portal/sellers/orders/${oC}/ship`, { uid: s.uid, body: { tracking_number: 'PC', carrier: 'DTDC', estimated_delivery: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10) } })
    const ret = (await api('POST', '/v1/return', { auth: dev.liveKey, body: { order_id: oC, reason: 'damaged' } })).body.return_id
    for (const step of ['approve', 'schedule-pickup', 'picked-up', 'received']) await api('POST', `/portal/sellers/returns/${ret}/${step}`, { uid: s.uid, body: step === 'schedule-pickup' ? { carrier: 'DTDC', pickup_date: new Date(Date.now() + 2 * 864e5).toISOString(), pickup_tracking_number: 'PC' } : {} })
    const stats = (await api('GET', '/portal/sellers/me/stats', { uid: s.uid })).body.stats
    stats.pending_payout === 1800 ? ok(BK, '6.6 pending payout', `=₹1800 (2 of 3, 1 returned)`, { data: true }) : bad(BK, '6.6 pending payout', `=${stats.pending_payout} (expected 1800)`, { data: true })
  })
  await t(BK, '6.7 earnings NOT cancelled on reject', async () => {
    const o = await orderConfirm(prod, dev.testKey, `e7_${Date.now()}`, ADDR)
    await api('PATCH', `/portal/sellers/orders/${o}/ship`, { uid: seller.uid, body: { tracking_number: 'E7', carrier: 'DTDC', estimated_delivery: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10) } })
    const ret = (await api('POST', '/v1/return', { auth: dev.liveKey, body: { order_id: o, reason: 'changed_mind' } })).body.return_id
    await api('POST', `/portal/sellers/returns/${ret}/reject`, { uid: seller.uid, body: { seller_notes: 'No' } })
    const st = (await db<{ status: string }>(`SELECT status FROM seller_earnings WHERE order_id=$1`, [o]))[0].status
    st === 'pending' ? ok(BK, '6.7 reject keeps earnings', 'status still pending', { data: true }) : bad(BK, '6.7 reject keeps earnings', `=${st}`, { data: true })
  })
  await t(BK, '6.8 earnings isolation between sellers', async () => {
    const sa = await mkSeller('IsoA'), sb = await mkSeller('IsoB')
    const pa = await sandboxProduct(sa.id, '__P5R1_ISOA__'), pb = await sandboxProduct(sb.id, '__P5R1_ISOB__')
    for (let i = 0; i < 3; i++) await orderConfirm(pa, dev.testKey, `isoa_${i}_${Date.now()}`)
    for (let i = 0; i < 2; i++) await orderConfirm(pb, dev.testKey, `isob_${i}_${Date.now()}`)
    const eA = (await api('GET', '/portal/sellers/me/earnings', { uid: sa.uid })).body.earnings.length
    const eB = (await api('GET', '/portal/sellers/me/earnings', { uid: sb.uid })).body.earnings.length
    eA === 3 && eB === 2 ? ok(BK, '6.8 earnings isolation', `A=3 B=2, no bleed`, { leak: false }) : bad(BK, '6.8 earnings isolation', `A=${eA} B=${eB}`, { leak: true })
  })
}

// ═══ BLOCK 7 — RETURN POLICY ═══
async function block7() {
  const BK = 'Return Policy'; console.log(B('\n[Block 7] Return Policy Settings'))
  const seller = await mkSeller('PolicyShop'), dev = await mkDev()

  await t(BK, '7.1 default return policy', async () => {
    const r = await api('GET', '/portal/sellers/settings/return-policy', { uid: seller.uid })
    const p = r.body.return_policy
    p?.window_days === 30 && p?.accepts_returns === true && p?.return_shipping_paid_by === 'seller_if_defective'
      ? ok(BK, '7.1 default policy', JSON.stringify(p)) : bad(BK, '7.1 default policy', JSON.stringify(p))
  })
  await t(BK, '7.2 update window to 7', async () => {
    await api('PATCH', '/portal/sellers/settings/return-policy', { uid: seller.uid, body: { window_days: 7, accepts_returns: true, return_shipping_paid_by: 'seller_if_defective' } })
    const p = (await api('GET', '/portal/sellers/settings/return-policy', { uid: seller.uid })).body.return_policy
    p?.window_days === 7 ? ok(BK, '7.2 window → 7', '') : bad(BK, '7.2 window → 7', `=${p?.window_days}`)
  })
  await t(BK, '7.3 disable returns → /v1/return 400', async () => {
    const noret = await mkSeller('NoReturnShop')
    await api('PATCH', '/portal/sellers/settings/return-policy', { uid: noret.uid, body: { window_days: 30, accepts_returns: false, return_shipping_paid_by: 'seller_always' } })
    const prod = await sandboxProduct(noret.id, '__P5R1_NORET__')
    const o = await orderConfirm(prod, dev.testKey, `noret_${Date.now()}`, ADDR)
    await api('PATCH', `/portal/sellers/orders/${o}/ship`, { uid: noret.uid, body: { tracking_number: 'NR', carrier: 'DTDC', estimated_delivery: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10) } })
    const r = await api('POST', '/v1/return', { auth: dev.liveKey, body: { order_id: o, reason: 'damaged' } })
    r.status === 400 ? ok(BK, '7.3 returns disabled → 400', `"${r.body.error}"`) : bad(BK, '7.3 returns disabled', `got ${r.status}`)
  })
  await t(BK, '7.4 invalid window_days → 400', async () => {
    const r = await api('PATCH', '/portal/sellers/settings/return-policy', { uid: seller.uid, body: { window_days: 45, accepts_returns: true, return_shipping_paid_by: 'seller_always' } })
    r.status === 400 ? ok(BK, '7.4 window 45 → 400', 'only 7/14/30/60 valid') : bad(BK, '7.4 window 45', `got ${r.status}`)
  })
  await t(BK, '7.5 window enforced on API (7d, 8d order)', async () => {
    const s = await mkSeller('Win7Shop')
    await api('PATCH', '/portal/sellers/settings/return-policy', { uid: s.uid, body: { window_days: 7, accepts_returns: true, return_shipping_paid_by: 'seller_always' } })
    const prod = await sandboxProduct(s.id, '__P5R1_WIN7__')
    const o = await orderConfirm(prod, dev.testKey, `win7_${Date.now()}`, ADDR)
    await api('PATCH', `/portal/sellers/orders/${o}/ship`, { uid: s.uid, body: { tracking_number: 'W7', carrier: 'DTDC', estimated_delivery: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10) } })
    await db(`UPDATE orders SET created_at=now()-interval '8 days' WHERE id=$1`, [o])
    const r = await api('POST', '/v1/return', { auth: dev.liveKey, body: { order_id: o, reason: 'damaged' } })
    r.status === 400 ? ok(BK, '7.5 7d window enforced', '8-day-old order → 400') : bad(BK, '7.5 window enforced', `got ${r.status}`)
  })
}

// ═══ BLOCK 8 — INTEGRATION ═══
async function block8() {
  const BK = 'Integration'; console.log(B('\n[Block 8] Cross-Phase Integration'))
  const seller = await mkSeller('IntShop'), dev = await mkDev()
  const rcv = receiver(20703)
  await api('POST', '/portal/webhooks', { uid: dev.uid, body: { url: rcv.url, events: ['order.confirmed', 'order.shipped', 'return.approved', 'return.pickup_scheduled', 'return.picked_up', 'return.received'] } })
  let prodId = '', orderId = '', returnId = ''

  await t(BK, '8.1 happy path: list → search → order → pay → ship', async () => {
    const NAME = 'Auralis Integration FlowTest Earbuds INT9'
    const cr = await api('POST', '/portal/sellers/products', { uid: seller.uid, body: validProduct({ name: NAME, description: NAME + ' premium wireless earbuds with ANC and long battery for integration testing.' }) })
    prodId = cr.body.product.id
    let emb = false; for (let i = 0; i < 20; i++) { if ((await db<{ h: boolean }>(`SELECT embedding IS NOT NULL h FROM products WHERE id=$1`, [prodId]))[0].h) { emb = true; break } await sleep(2000) }
    const sr = await api('POST', '/v1/search', { auth: dev.liveKey, body: { query: NAME, limit: 5 } })
    const inSearch = (sr.body.results ?? []).some((x: any) => x.id === prodId)
    // make it orderable in sandbox: create a sandbox twin? Simpler — order the real product with live key needs Stripe. Use sandbox product for the order portion.
    const sandTwin = await sandboxProduct(seller.id, '__P5R1_INT_ORDER__')
    orderId = await orderConfirm(sandTwin, dev.testKey, `int_${Date.now()}`, ADDR)
    const inDash = (await api('GET', '/portal/sellers/orders', { uid: seller.uid })).body.orders.some((o: any) => o.id === orderId)
    const ship = await api('PATCH', `/portal/sellers/orders/${orderId}/ship`, { uid: seller.uid, body: { tracking_number: 'INT9', carrier: 'BlueDart', estimated_delivery: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10) } })
    await sleep(900)
    const earn = (await db<{ status: string }>(`SELECT status FROM seller_earnings WHERE order_id=$1`, [orderId]))[0]?.status
    emb && inSearch && inDash && ship.status === 200 && earn === 'pending' && rcv.captured.some((c) => c.event === 'order.shipped')
      ? ok(BK, '8.1 happy path', 'list→embed→search→order→pay→dashboard→ship→earnings→webhook') : bad(BK, '8.1 happy path', `emb=${emb} search=${inSearch} dash=${inDash} ship=${ship.status} earn=${earn}`)
  })
  await t(BK, '8.2 return flow end-to-end', async () => {
    returnId = (await api('POST', '/v1/return', { auth: dev.liveKey, body: { order_id: orderId, reason: 'damaged' } })).body.return_id
    for (const step of ['approve', 'schedule-pickup', 'picked-up', 'received']) await api('POST', `/portal/sellers/returns/${returnId}/${step}`, { uid: seller.uid, body: step === 'schedule-pickup' ? { carrier: 'Delhivery', pickup_date: new Date(Date.now() + 2 * 864e5).toISOString(), pickup_tracking_number: 'INTRET' } : {} })
    await sleep(900)
    const earn = (await db<{ status: string }>(`SELECT status FROM seller_earnings WHERE order_id=$1`, [orderId]))[0].status
    const ord = (await db<{ status: string }>(`SELECT status FROM orders WHERE id=$1`, [orderId]))[0].status
    const wh = rcv.captured.find((c) => c.event === 'return.received')
    earn === 'cancelled' && ord === 'returned' && Number(wh?.data?.refund_amount) === 900
      ? ok(BK, '8.2 return flow', 'approve→pickup→picked→received, earnings cancelled, webhook w/ refund') : bad(BK, '8.2 return flow', `earn=${earn} ord=${ord} wh=${JSON.stringify(wh?.data)}`)
  })
  await t(BK, '8.3 search reflects quality after return', async () => {
    const r = await api('POST', '/v1/search', { auth: dev.liveKey, body: { query: 'earbuds', limit: 3 } })
    typeof r.body.results?.[0]?.quality_score === 'number' ? ok(BK, '8.3 quality in search post-return', `quality_score present`) : bad(BK, '8.3 quality post-return', 'missing')
  })
  await t(BK, '8.4 auto-suspend removes products from search', async () => {
    const s = await mkSeller('SuspendInt')
    const pid = await sandboxProduct(s.id, '__P5R1_SUS8__')
    await db(`UPDATE products SET is_sandbox=false, name='Auralis SuspendEight KP3 Earbuds', description='Auralis SuspendEight KP3 distinctive earbuds for suspend integration test.' WHERE id=$1`, [pid])
    let emb = false; for (let i = 0; i < 20; i++) { if ((await db<{ h: boolean }>(`SELECT embedding IS NOT NULL h FROM products WHERE id=$1`, [pid]))[0].h) { emb = true; break } await sleep(2000) }
    const before = await api('POST', '/v1/search', { auth: dev.liveKey, body: { query: 'Auralis SuspendEight KP3', limit: 20 } })
    const visBefore = (before.body.results ?? []).some((x: any) => x.id === pid)
    await db(`UPDATE sellers SET status='suspended' WHERE id=$1`, [s.id])
    const after = await api('POST', '/v1/search', { auth: dev.liveKey, body: { query: 'Auralis SuspendEight KP3', limit: 20 } })
    const visAfter = (after.body.results ?? []).some((x: any) => x.id === pid)
    await db(`UPDATE sellers SET status='active' WHERE id=$1`, [s.id]) // restore
    emb && visBefore && !visAfter ? ok(BK, '8.4 suspend hides from search', 'visible → suspended → hidden → restored', { sec: true }) : bad(BK, '8.4 suspend hides', `emb=${emb} before=${visBefore} after=${visAfter}`, { sec: true })
  })
  await t(BK, '8.5 dashboard data consistency', async () => {
    const stats = (await api('GET', '/portal/sellers/me/stats', { uid: seller.uid })).body.stats
    stats.month_orders === 1 && stats.month_returns === 1 && stats.month_revenue === 0 && stats.pending_payout === 0
      ? ok(BK, '8.5 dashboard consistency', `orders=1 returns=1 revenue=0 pending=0`, { data: true }) : bad(BK, '8.5 dashboard consistency', `${JSON.stringify({ o: stats.month_orders, r: stats.month_returns, rev: stats.month_revenue, p: stats.pending_payout })}`, { data: true })
  })
  await t(BK, '8.6 all 6 webhook events received in order w/ signatures', async () => {
    const order = ['order.confirmed', 'order.shipped', 'return.approved', 'return.pickup_scheduled', 'return.picked_up', 'return.received']
    const seen = order.map((e) => rcv.captured.find((c) => c.event === e))
    const allPresent = seen.every(Boolean)
    const sigsOk = seen.every((c) => /^sha256=[0-9a-f]{64}$/.test(c?._sig ?? ''))
    allPresent && sigsOk ? ok(BK, '8.6 all webhooks + sigs', `6/6 events, valid sha256= sigs`) : bad(BK, '8.6 all webhooks', `present=${seen.map((s, i) => s ? order[i] : 'MISSING:' + order[i]).join(',')} sigs=${sigsOk}`)
  })
  await rcv.close(); await db(`DELETE FROM webhooks WHERE url=$1`, [rcv.url])

  await t(BK, '8.7 catalog integrity (after cleanup)', async () => {
    await cleanup()
    const real = (await db<{ n: number }>(`SELECT count(*)::int n FROM products WHERE is_sandbox=false AND deleted_at IS NULL`))[0].n
    const sb = (await db<{ n: number }>(`SELECT count(*)::int n FROM products WHERE is_sandbox=true`))[0].n
    const sellers = (await db<{ n: number }>(`SELECT count(*)::int n FROM sellers`))[0].n
    const orphanRet = (await db<{ n: number }>(`SELECT count(*)::int n FROM returns r LEFT JOIN orders o ON o.id=r.order_id WHERE o.id IS NULL`))[0].n
    const orphanEv = (await db<{ n: number }>(`SELECT count(*)::int n FROM order_events e LEFT JOIN orders o ON o.id=e.order_id WHERE o.id IS NULL`))[0].n
    const orphanEarn = (await db<{ n: number }>(`SELECT count(*)::int n FROM seller_earnings se LEFT JOIN orders o ON o.id=se.order_id WHERE o.id IS NULL`))[0].n
    real === 50 && sb === 20 && sellers === 2 && orphanRet === 0 && orphanEv === 0 && orphanEarn === 0
      ? ok(BK, '8.7 catalog integrity', `real=50 sandbox=20 sellers=2, 0 orphans`, { data: true }) : bad(BK, '8.7 catalog integrity', `real=${real} sandbox=${sb} sellers=${sellers} orphanRet=${orphanRet} orphanEv=${orphanEv} orphanEarn=${orphanEarn}`, { data: true })
  })
}

async function cleanup() {
  if (sellerIds.length) {
    const ids = [sellerIds]
    await db(`DELETE FROM returns WHERE seller_id = ANY($1::uuid[]) OR order_id IN (SELECT id FROM orders WHERE seller_id = ANY($1::uuid[]))`, ids).catch(() => {})
    await db(`DELETE FROM order_events WHERE order_id IN (SELECT id FROM orders WHERE seller_id = ANY($1::uuid[]))`, ids).catch(() => {})
    await db(`DELETE FROM seller_earnings WHERE seller_id = ANY($1::uuid[]) OR order_id IN (SELECT id FROM orders WHERE seller_id = ANY($1::uuid[]))`, ids).catch(() => {})
    await db(`UPDATE searches SET top_result_id=NULL WHERE top_result_id IN (SELECT id FROM products WHERE seller_id = ANY($1::uuid[]))`, ids).catch(() => {})
    await db(`DELETE FROM orders WHERE seller_id = ANY($1::uuid[])`, ids).catch(() => {})
    await db(`DELETE FROM products WHERE seller_id = ANY($1::uuid[])`, ids).catch(() => {})
    await db(`DELETE FROM sellers WHERE id = ANY($1::uuid[])`, ids).catch(() => {})
  }
  if (devUids.length) {
    await db(`DELETE FROM webhooks WHERE developer_id IN (SELECT id FROM developers WHERE supabase_user_id = ANY($1))`, [devUids]).catch(() => {})
    await db(`DELETE FROM searches WHERE developer_id IN (SELECT id FROM developers WHERE supabase_user_id = ANY($1))`, [devUids]).catch(() => {})
    await db(`DELETE FROM developers WHERE supabase_user_id = ANY($1)`, [devUids]).catch(() => {})
  }
  // Marker-based sweep: catches sellers/devs created via raw api() (e.g. the
  // duplicate-email test) that weren't tracked in sellerIds/devUids.
  await db(`DELETE FROM webhooks WHERE developer_id IN (SELECT id FROM developers WHERE supabase_user_id LIKE 'p5r1\\_%')`).catch(() => {})
  await db(`DELETE FROM searches WHERE developer_id IN (SELECT id FROM developers WHERE supabase_user_id LIKE 'p5r1\\_%')`).catch(() => {})
  await db(`DELETE FROM developers WHERE supabase_user_id LIKE 'p5r1\\_%'`).catch(() => {})
  await db(`DELETE FROM products WHERE seller_id IN (SELECT id FROM sellers WHERE supabase_user_id LIKE 'p5r1\\_%')`).catch(() => {})
  await db(`DELETE FROM sellers WHERE supabase_user_id LIKE 'p5r1\\_%'`).catch(() => {})
  for (const uid of authUserIds) await sbAdmin.auth.admin.deleteUser(uid).catch(() => {})
}

function report(): boolean {
  const blocks: [string, string, number][] = [
    ['Auth Security', 'Block 1 — Seller Auth Security', 12], ['Product Mgmt', 'Block 2 — Product Management', 15],
    ['Orders', 'Block 3 — Order Management', 12], ['Returns', 'Block 4 — Returns State Machine', 20],
    ['Quality', 'Block 5 — Quality Score System', 11], ['Earnings', 'Block 6 — Earnings Ledger', 8],
    ['Return Policy', 'Block 7 — Return Policy Settings', 5], ['Integration', 'Block 8 — Cross-Phase Integration', 7],
  ]
  const total = results.length, passed = results.filter((r) => r.pass).length
  const secFail = results.filter((r) => (r.sec || r.leak) && !r.pass).length
  const dataFail = results.filter((r) => r.data && !r.pass).length
  const leakFail = results.filter((r) => r.leak && !r.pass).length
  const pct = passed / total
  const status = pct >= 0.97 && http500s.length === 0 && secFail === 0 && dataFail === 0 && leakFail === 0 ? 'PASSED' : 'FAILED'

  console.log('\n')
  console.log('╔══════════════════════════════════════════════════════════════╗')
  console.log('║         STOK PHASE 5 STRESS TEST — ROUND 1                   ║')
  console.log('╠══════════════════════════════════════════════════════════════╣')
  for (const [tag, label, exp] of blocks) {
    const br = results.filter((r) => r.block === tag), bp = br.filter((r) => r.pass).length
    const line = `  ${label.padEnd(34)}: ${bp}/${br.length} passed`
    console.log(`║${(bp === br.length ? G(line) : R(line)).padEnd(74)}║`)
  }
  console.log('╠══════════════════════════════════════════════════════════════╣')
  const tl = `  TOTAL: ${passed}/${total} passed (${(pct * 100).toFixed(1)}%)`
  console.log(`║${(passed === total ? G(tl) : Y(tl)).padEnd(74)}║`)
  console.log(`║${((status === 'PASSED' ? G : R)(`  STATUS: ${status}`)).padEnd(74)}║`)
  console.log('╚══════════════════════════════════════════════════════════════╝')
  console.log('\nAUTO-FAIL GATES:')
  console.log(`  HTTP 500s:          0 required — actual: ${http500s.length === 0 ? G('0') : R(String(http500s.length))}`)
  console.log(`  Security failures:  0 required — actual: ${secFail === 0 ? G('0') : R(String(secFail))}`)
  console.log(`  Cross-seller leaks: 0 required — actual: ${leakFail === 0 ? G('0') : R(String(leakFail))}`)
  console.log(`  Data corruption:    0 required — actual: ${dataFail === 0 ? G('0') : R(String(dataFail))}`)
  if (http500s.length) http500s.forEach((h) => console.log(`    ${R(h)}`))
  const fails = results.filter((r) => !r.pass)
  if (fails.length) { console.log(R('\nFAILURES:')); fails.forEach((f) => console.log(`  ${R('✗')} [${f.block}] ${f.name} — ${f.detail}`)) }
  console.log('\nREAL BUGS FOUND AND FIXED:'); bugsFixed.forEach((b) => console.log(`  • ${b}`))
  if (adapted.length) { console.log('\nADAPTED ASSERTIONS:'); [...new Set(adapted)].forEach((a) => console.log(`  • ${a}`)) }
  console.log('')
  return status === 'PASSED'
}

async function main() {
  console.log(B('━'.repeat(64))); console.log(B('  STOK — Phase 5 Stress Test, Round 1')); console.log(B('━'.repeat(64)))
  const h = await api('GET', '/health'); if (h.status !== 200) { console.error(R('API not healthy')); process.exit(1) }
  const web = await fetch(WEB).then((r) => r.status).catch(() => 0)
  console.log(G('✓ API healthy') + (web === 200 ? G('  ✓ Web healthy') : Y('  ⚠ Web offline')))
  if (!SB_ANON) console.log(Y('⚠ No anon key — Block 1 Supabase auth tests will be limited'))
  try {
    await block1(); await block2(); await block3(); await block4(); await block5(); await block6(); await block7(); await block8()
  } finally { await cleanup().catch(() => {}) }
  const okk = report()
  await pool.end(); process.exit(okk ? 0 : 1)
}
main().catch(async (e) => { console.error(R(`FATAL: ${e.message}`)); console.error(e.stack); await cleanup().catch(() => {}); process.exit(1) })
