import 'dotenv/config'
import path from 'path'
import dotenv from 'dotenv'
dotenv.config({ path: path.resolve(__dirname, '../.env') })

import OpenAI from 'openai'
import { Pool } from 'pg'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "") ? false : { rejectUnauthorized: false } })

async function topScore(query: string) {
  const res = await openai.embeddings.create({ model: 'text-embedding-3-small', input: query, dimensions: 1536 })
  const vec = `[${res.data[0].embedding.join(',')}]`
  const { rows } = await pool.query(
    `SELECT name, category, 1 - (embedding <=> $1::vector) AS score
     FROM products WHERE embedding IS NOT NULL
     ORDER BY embedding <=> $1::vector LIMIT 3`,
    [vec]
  )
  console.log(`\nQuery: "${query}"`)
  rows.forEach((r: any) => console.log(`  ${r.score.toFixed(4)} — ${r.name} (${r.category})`))
  return rows[0]?.score
}

async function run() {
  const queries = [
    'something for my morning run',
    'gym workout audio',
    'refrigerator',
    'laptop',
    'wireless earbuds',
  ]
  for (const q of queries) await topScore(q)
  await pool.end()
}

run().catch(e => { console.error(e.message); process.exit(1) })
