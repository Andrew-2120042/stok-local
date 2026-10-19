// Checks that the SQL local_embedding() (migration 00022, used by the product
// trigger) and the TypeScript localEmbedding() (used for search queries) produce
// identical vectors. If they drift, semantic search silently degrades.
import 'dotenv/config'
import { Pool } from 'pg'
import { localEmbedding, buildEmbeddingText } from '../apps/api/src/lib/embeddings'

const url = process.env.DATABASE_URL ?? ''
const pool = new Pool({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } })
const TOLERANCE = 1e-6

const maxDiff = (a: number[], b: number[]) => Math.max(...a.map((x, i) => Math.abs(x - b[i])))

async function run() {
  let failures = 0

  // 1. The SQL function vs TypeScript on tricky inputs.
  const samples = ['Hello World', 'boAt Airdopes 141 — ₹1,299!!', '', 'a', 'USB-C 65W GaN charger', 'ÉCOUTEURS sans-fil']
  for (const s of samples) {
    const { rows: [r] } = await pool.query<{ e: string }>('SELECT local_embedding($1)::text AS e', [s])
    const d = maxDiff(JSON.parse(r.e), localEmbedding(s))
    if (d > TOLERANCE) failures++
    console.log(`${d > TOLERANCE ? '✗' : '✓'} ${JSON.stringify(s)}  max diff ${d.toExponential(2)}`)
  }

  // 2. Embeddings written by the trigger vs TypeScript on the same product text.
  //    (Only meaningful in local mode, where the trigger computes them.)
  const { rows } = await pool.query(
    `SELECT name, brand, category, description, specs, embedding::text AS e
       FROM products WHERE is_sandbox AND embedding IS NOT NULL`
  )
  let worst = 0
  for (const p of rows) worst = Math.max(worst, maxDiff(JSON.parse(p.e), localEmbedding(buildEmbeddingText(p))))
  if (worst > TOLERANCE) failures++
  console.log(`${worst > TOLERANCE ? '✗' : '✓'} trigger-built embeddings of ${rows.length} products  max diff ${worst.toExponential(2)}`)

  await pool.end()
  if (failures) {
    console.error(`\n❌ ${failures} mismatch(es) — SQL and TypeScript embeddings have drifted`)
    process.exit(1)
  }
  console.log('\n✅ SQL and TypeScript local embeddings match')
}

run().catch((err) => { console.error(err.message); process.exit(1) })
