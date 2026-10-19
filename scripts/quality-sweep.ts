import 'dotenv/config'
import path from 'path'
import dotenv from 'dotenv'
dotenv.config({ path: path.resolve(__dirname, '../.env') })

const API = 'http://localhost:3001/v1/search'

const queries = [
  'noise cancelling buds',
  'anker charger',
  'fast charging cable type c',
  'powerbank 20000mah',
  'phone case for samsung',
  'earphones below 1000',
  'best earbuds',
  'gym workout audio',
  'wireless earbuds for gym under 2000 rupees',
  'boAt earphones',
  'something for my morning run',
  'refrigerator',
]

async function search(query: string) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  return res.json() as any
}

async function run() {
  // warm cache
  for (const q of queries) await search(q)
  console.log('Cache warmed.\n')

  for (const query of queries) {
    const d = await search(query)
    const top3 = d.results?.slice(0, 3).map((r: any) =>
      `${r.brand} ${r.name.slice(0, 28)} ₹${r.price}`
    ) ?? []
    console.log(`[${d.latency_ms}ms / ${d.total_results} results] "${query}"`)
    top3.forEach((t: string) => console.log(`  → ${t}`))
    if (d.results?.length === 0) console.log('  → (no results)')
    console.log()
  }
}

run().catch(e => { console.error(e.message); process.exit(1) })
