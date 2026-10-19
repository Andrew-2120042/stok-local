// Recomputes every product embedding with the current EMBEDDING_PROVIDER.
// Run after switching between local and OpenAI embeddings — query vectors and
// product vectors must come from the same model or semantic search is noise.
import 'dotenv/config'
import { Pool } from 'pg'
import { buildEmbeddingText, generateEmbedding, embeddingProvider } from '../apps/api/src/lib/embeddings'

const url = process.env.DATABASE_URL ?? ''
const pool = new Pool({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } })

async function run() {
  const { rows } = await pool.query(
    `SELECT id, name, brand, category, description, specs FROM products WHERE deleted_at IS NULL`
  )
  console.log(`Re-embedding ${rows.length} products with provider "${embeddingProvider()}"...`)
  for (const [i, p] of rows.entries()) {
    const embedding = await generateEmbedding(buildEmbeddingText(p))
    await pool.query(`UPDATE products SET embedding = $1::vector WHERE id = $2`, [JSON.stringify(embedding), p.id])
    if ((i + 1) % 10 === 0 || i + 1 === rows.length) console.log(`  ${i + 1}/${rows.length}`)
  }
  console.log('✅ Done')
  await pool.end()
}

run().catch((err) => { console.error(err.message); process.exit(1) })
