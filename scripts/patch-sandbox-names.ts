import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(__dirname, '../.env') })
import { Pool } from 'pg'

async function run() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const client = await pool.connect()
  const { rowCount } = await client.query(`
    UPDATE products
    SET name = '[TEST] ' || name
    WHERE is_sandbox = true
      AND name NOT LIKE '[TEST]%'
  `)
  console.log(`Updated ${rowCount} sandbox products with [TEST] prefix`)
  client.release()
  await pool.end()
}

run().catch((e) => { console.error(e); process.exit(1) })
