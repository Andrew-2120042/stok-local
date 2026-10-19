import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(__dirname, '../.env') })
import { Pool } from 'pg'

const API = 'http://localhost:3001'
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function post(url: string, body: unknown) {
  const res = await fetch(`${API}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}

async function get(url: string) {
  const res = await fetch(`${API}${url}`)
  return { status: res.status, json: await res.json().catch(() => null) }
}

// ─── Result tracking ──────────────────────────────────────────────────────────

interface SearchSummary {
  query: string
  resultCount: number
  topResult: string
  latencyMs: number
  passed: boolean
  failReason?: string
}

interface EdgeSummary {
  label: string
  passed: boolean
  detail: string
}

const searchSummaries: SearchSummary[] = []
const edgeSummaries: EdgeSummary[] = []

function pass(label: string, detail: string) {
  edgeSummaries.push({ label, passed: true, detail })
}

function fail(label: string, detail: string) {
  edgeSummaries.push({ label, passed: false, detail })
}

// ─── Phase 1: Searches ────────────────────────────────────────────────────────

interface SearchQuery {
  query: string
  maxPrice?: number
  check: (results: any[]) => { ok: boolean; reason?: string }
}

const searches: SearchQuery[] = [
  {
    query: 'wireless earbuds for gym under 2000 rupees',
    maxPrice: 2000,
    check: (results) => {
      const allAudio = results.every((r: any) =>
        ['Wireless Earbuds', 'Wired Earphones'].includes(r.category)
      )
      const allUnder = results.every((r: any) => r.price <= 2000)
      const allPurchasable = results.every((r: any) => r.is_purchasable)
      if (!allAudio) return { ok: false, reason: 'non-audio results in top 3' }
      if (!allUnder) return { ok: false, reason: 'results over ₹2000' }
      if (!allPurchasable) return { ok: false, reason: 'not all is_purchasable' }
      return { ok: true }
    },
  },
  {
    query: 'fast charging cable type c',
    check: (results) => {
      const cableOrCharger = results.every((r: any) =>
        ['Charging Cables', 'Phone Chargers'].includes(r.category)
      )
      const allPurchasable = results.every((r: any) => r.is_purchasable)
      if (!cableOrCharger) return { ok: false, reason: 'non-cable results in top 3' }
      if (!allPurchasable) return { ok: false, reason: 'not all is_purchasable' }
      return { ok: true }
    },
  },
  {
    query: 'something for long office calls',
    check: (results) => {
      const allAudio = results.every((r: any) =>
        ['Wireless Earbuds', 'Wired Earphones'].includes(r.category)
      )
      const allPurchasable = results.every((r: any) => r.is_purchasable)
      if (!allAudio) return { ok: false, reason: 'non-audio results in top 3' }
      if (!allPurchasable) return { ok: false, reason: 'not all is_purchasable' }
      return { ok: true }
    },
  },
  {
    query: 'best noise cancelling buds',
    check: (results) => {
      const allAudio = results.every((r: any) =>
        ['Wireless Earbuds', 'Wired Earphones'].includes(r.category)
      )
      const allPurchasable = results.every((r: any) => r.is_purchasable)
      if (!allAudio) return { ok: false, reason: 'non-audio results in top 3' }
      if (!allPurchasable) return { ok: false, reason: 'not all is_purchasable' }
      return { ok: true }
    },
  },
  {
    query: 'portable battery for travel under 3000',
    maxPrice: 3000,
    check: (results) => {
      const allBanks = results.every((r: any) =>
        ['Power Banks', 'Phone Chargers'].includes(r.category)
      )
      const allUnder = results.every((r: any) => r.price <= 3000)
      const allPurchasable = results.every((r: any) => r.is_purchasable)
      if (!allBanks) return { ok: false, reason: 'non-battery results in top 3' }
      if (!allUnder) return { ok: false, reason: 'results over ₹3000' }
      if (!allPurchasable) return { ok: false, reason: 'not all is_purchasable' }
      return { ok: true }
    },
  },
]

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n' + '═'.repeat(68))
  console.log('  STOK — AGENT SIMULATION')
  console.log('═'.repeat(68))

  // ── Phase 1: Run all searches ────────────────────────────────────────────
  console.log('\n▶  PHASE 1 — SEARCH QUERIES\n')

  let gymProductId: string | null = null

  for (const s of searches) {
    const { status, json } = await post('/v1/search', {
      query: s.query,
      session_id: 'agent_sim_001',
      limit: 10,
    })

    const results = json?.results ?? []
    const top3 = results.slice(0, 3)
    const { ok, reason } = s.check(top3)

    console.log(`  Query: "${s.query}"`)
    console.log(`  Latency: ${json?.latency_ms}ms  Results: ${json?.total_results}`)

    top3.forEach((r: any, i: number) => {
      const budgetFlag = s.maxPrice && r.price > s.maxPrice ? ' ⚠ OVER BUDGET' : ''
      console.log(
        `    #${i + 1} [${r.relevance_score.toFixed(2)}] ${r.brand} ${r.name.slice(0, 32).padEnd(32)} ₹${String(r.price).padStart(5)}  ${r.category}${budgetFlag}`
      )
    })

    console.log(`  ${ok ? '✅ PASS' : `❌ FAIL — ${reason}`}\n`)

    searchSummaries.push({
      query: s.query,
      resultCount: json?.total_results ?? 0,
      topResult: top3[0] ? `${top3[0].brand} ${top3[0].name.slice(0, 28)}` : '—',
      latencyMs: json?.latency_ms ?? 0,
      passed: ok,
      failReason: reason,
    })

    // Save top gym result for order test
    if (s.query.includes('gym') && top3[0]) {
      gymProductId = top3[0].id
    }
  }

  // ── Phase 2: Order flow ──────────────────────────────────────────────────
  console.log('▶  PHASE 2 — ORDER FLOW\n')

  if (!gymProductId) {
    console.log('  ❌ No gym product found — skipping order tests\n')
  } else {
    // Step 1: Create order
    const orderRes = await post('/v1/order', {
      product_id: gymProductId,
      quantity: 1,
      session_id: 'agent_sim_001',
    })

    const orderId = orderRes.json?.order_id
    const checkoutUrl = orderRes.json?.checkout_url
    const expiresIn = orderRes.json?.expires_in

    const orderCreated =
      orderRes.status === 201 && !!orderId && !!checkoutUrl && expiresIn === 900

    console.log(`  POST /v1/order`)
    console.log(`    status=${orderRes.status}  order_id=${orderId}`)
    console.log(`    checkout_url=${checkoutUrl}`)
    console.log(`    expires_in=${expiresIn}`)
    console.log(`  ${orderCreated ? '✅ PASS' : '❌ FAIL'}\n`)

    // Step 2: Poll status
    if (orderId) {
      const pollRes = await get(`/v1/order/${orderId}`)
      const isPending = pollRes.json?.status === 'pending_payment'
      const hasSecret = !!pollRes.json?.stripe_client_secret
      const hasExpiry = !!pollRes.json?.expires_at

      console.log(`  GET /v1/order/${orderId}`)
      console.log(`    status=${pollRes.json?.status}  has_client_secret=${hasSecret}  has_expires_at=${hasExpiry}`)
      console.log(`  ${isPending && hasSecret && hasExpiry ? '✅ PASS' : '❌ FAIL'}\n`)

      edgeSummaries.push({
        label: 'Order creation returns checkout_url + expires_in=900',
        passed: orderCreated,
        detail: `status=${orderRes.status} order_id=${orderId?.slice(0, 8)}`,
      })
      edgeSummaries.push({
        label: 'GET order returns pending_payment + client_secret',
        passed: isPending && hasSecret && hasExpiry,
        detail: `status=${pollRes.json?.status}`,
      })
    }
  }

  // ── Phase 3: Edge cases ──────────────────────────────────────────────────
  console.log('▶  PHASE 3 — EDGE CASES\n')

  // Edge 1: Out-of-domain query
  const fridgeRes = await post('/v1/search', { query: 'refrigerator', session_id: 'agent_sim_edge' })
  const fridgeOk = fridgeRes.status === 200 && fridgeRes.json?.total_results === 0
  console.log(`  E1 "refrigerator" → ${fridgeRes.json?.total_results} results`)
  console.log(`  ${fridgeOk ? '✅ PASS — correctly returns 0 results' : '❌ FAIL'}\n`)
  pass_or_fail('E1: Out-of-domain query returns 0 results', fridgeOk, `total_results=${fridgeRes.json?.total_results}`)

  // Edge 2: Empty query string
  const emptyRes = await post('/v1/search', { query: '', session_id: 'agent_sim_edge' })
  const emptyOk = emptyRes.status === 400
  console.log(`  E2 empty query "" → HTTP ${emptyRes.status}`)
  console.log(`  ${emptyOk ? '✅ PASS — correctly rejects with 400' : '❌ FAIL'}\n`)
  pass_or_fail('E2: Empty query returns 400', emptyOk, `status=${emptyRes.status}`)

  // Edge 3: Fake product_id in order
  const fakeOrderRes = await post('/v1/order', {
    product_id: '00000000-0000-0000-0000-000000000000',
    quantity: 1,
  })
  const fakeOk = fakeOrderRes.status === 404
  console.log(`  E3 POST /v1/order with fake product_id → HTTP ${fakeOrderRes.status}`)
  console.log(`  ${fakeOk ? '✅ PASS — correctly returns 404' : '❌ FAIL'}\n`)
  pass_or_fail('E3: Fake product_id returns 404', fakeOk, `status=${fakeOrderRes.status}`)

  // Edge 4: Out of stock
  if (gymProductId) {
    await pool.query(
      `UPDATE products SET stock = 0, availability = 'out_of_stock' WHERE id = $1`,
      [gymProductId]
    )
    const oosRes = await post('/v1/order', { product_id: gymProductId, quantity: 1 })
    await pool.query(
      `UPDATE products SET stock = 100, availability = 'in_stock' WHERE id = $1`,
      [gymProductId]
    )
    const oosOk = oosRes.status === 409 && oosRes.json?.code === 'OUT_OF_STOCK'
    console.log(`  E4 POST /v1/order (out of stock) → HTTP ${oosRes.status} code=${oosRes.json?.code}`)
    console.log(`  ${oosOk ? '✅ PASS — correctly returns 409 OUT_OF_STOCK' : '❌ FAIL'}\n`)
    pass_or_fail('E4: Out-of-stock returns 409 OUT_OF_STOCK', oosOk, `status=${oosRes.status} code=${oosRes.json?.code}`)
  }

  // ── Summary table ────────────────────────────────────────────────────────
  console.log('═'.repeat(68))
  console.log('  SEARCH SUMMARY')
  console.log('─'.repeat(68))
  console.log(
    '  ' +
    'Query'.padEnd(42) +
    'Results'.padEnd(10) +
    'Latency'.padEnd(10) +
    'Status'
  )
  console.log('  ' + '─'.repeat(64))

  for (const s of searchSummaries) {
    const status = s.passed ? '✅' : `❌ ${s.failReason}`
    console.log(
      '  ' +
      s.query.slice(0, 40).padEnd(42) +
      String(s.resultCount).padEnd(10) +
      `${s.latencyMs}ms`.padEnd(10) +
      status
    )
  }

  console.log('\n' + '═'.repeat(68))
  console.log('  EDGE CASE SUMMARY')
  console.log('─'.repeat(68))

  for (const e of edgeSummaries) {
    console.log(`  ${e.passed ? '✅' : '❌'} ${e.label}`)
    console.log(`     ${e.detail}`)
  }

  const allSearchesPassed = searchSummaries.every((s) => s.passed)
  const allEdgesPassed = edgeSummaries.every((e) => e.passed)
  const allPassed = allSearchesPassed && allEdgesPassed

  console.log('\n' + '═'.repeat(68))
  console.log(`  OVERALL: ${allPassed ? '✅  ALL PASSED' : '❌  SOME FAILED'}`)
  console.log('═'.repeat(68) + '\n')

  await pool.end()
  process.exit(allPassed ? 0 : 1)
}

function pass_or_fail(label: string, ok: boolean, detail: string) {
  edgeSummaries.push({ label, passed: ok, detail })
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
