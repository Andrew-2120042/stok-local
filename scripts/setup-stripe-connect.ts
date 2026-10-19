import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(__dirname, '../.env') })
import Stripe from 'stripe'
import { Pool } from 'pg'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' as any })
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

async function run() {
  // Create one test Express connected account for both sellers to share during Phase 3 testing
  console.log('Creating Stripe test Express connected account...')
  const account = await stripe.accounts.create({
    type: 'express',
    country: 'IN',
    email: 'test.seller@stok.com',
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    settings: {
      payouts: { schedule: { interval: 'manual' } },
    },
  } as any)

  console.log(`✓ Created account: ${account.id}`)

  // Update all sellers with this test account
  const { rowCount } = await pool.query(
    `UPDATE sellers SET stripe_account_id = $1 WHERE stripe_account_id IS NULL`,
    [account.id]
  )
  console.log(`✓ Updated ${rowCount} sellers with stripe_account_id = ${account.id}`)

  const { rows } = await pool.query('SELECT id, name, stripe_account_id FROM sellers')
  rows.forEach((r: any) => {
    console.log(`  "${r.name}" → ${r.stripe_account_id}`)
  })

  await pool.end()
}

run().catch((e) => { console.error(e.message); process.exit(1) })
