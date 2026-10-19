import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(__dirname, '../.env') })
import { Pool } from 'pg'

async function run() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const { rows } = await pool.query('SELECT id, name, email, stripe_account_id FROM sellers')
  console.log('Sellers:')
  rows.forEach((r: any) => {
    console.log(`  id=${r.id}  name="${r.name}"  stripe_account_id=${r.stripe_account_id ?? 'NULL'}`)
  })
  await pool.end()
}

run().catch((e) => { console.error(e.message); process.exit(1) })
