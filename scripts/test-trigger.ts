import 'dotenv/config'
import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "") ? false : { rejectUnauthorized: false } })

async function run() {
  const client = await pool.connect()
  try {
    // Get a real seller id to satisfy the FK
    const { rows: sellers } = await client.query<{ id: string }>('SELECT id FROM sellers LIMIT 1')
    const sellerId = sellers[0].id

    // Insert a product with NO embedding — trigger should populate it
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO products (seller_id, name, brand, category, description, specs, images, price, stock)
       VALUES ($1, 'Trigger Test Earbuds', 'TestBrand', 'Wireless Earbuds',
               'A test product inserted to verify the DB trigger fires and calls the edge function.',
               '{"driver_size": "10mm", "battery": "20h"}', '{}', 999, 10)
       RETURNING id`,
      [sellerId]
    )
    const productId = rows[0].id
    console.log(`✓ Inserted test product: ${productId}`)
    console.log('  embedding = NULL at insert time (expected)')
    console.log('\nWaiting 15 seconds for the trigger → edge function → embedding write...\n')

    await new Promise(r => setTimeout(r, 15000))

    const { rows: check } = await client.query<{ name: string; has_embedding: boolean; dims: number | null }>(
      `SELECT name,
              embedding IS NOT NULL AS has_embedding,
              array_length(embedding::real[], 1) AS dims
       FROM products WHERE id = $1`,
      [productId]
    )

    const row = check[0]
    const pass = row.has_embedding && row.dims === 1536

    console.log(`Product: ${row.name}`)
    console.log(`Embedding present: ${row.has_embedding}`)
    console.log(`Dimensions: ${row.dims ?? 'N/A'}`)
    console.log()
    console.log(pass
      ? '✅ Test 4 passed — trigger fires, edge function runs, embedding written back.'
      : '❌ Test 4 failed — embedding still null after 6s. Check edge function logs in Supabase dashboard.')

    // Clean up test row
    await client.query('DELETE FROM products WHERE id = $1', [productId])
    console.log('\n(Test product cleaned up)')
  } finally {
    client.release()
    await pool.end()
  }
}

run().catch(err => { console.error('Test failed:', err.message); process.exit(1) })
