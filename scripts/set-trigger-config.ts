// Switches the database to OpenAI embeddings: the product trigger will call the
// generate-embedding edge function instead of computing local embeddings.
// Afterwards run `npm run reembed` so existing products use the same model.
import 'dotenv/config'
import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "") ? false : { rejectUnauthorized: false } })

async function run() {
  const client = await pool.connect()
  try {
    const functionsUrl = `${process.env.SUPABASE_URL}/functions/v1`
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

    await client.query(`ALTER DATABASE postgres SET "app.supabase_functions_url" = '${functionsUrl}'`)
    await client.query(`ALTER DATABASE postgres SET "app.service_role_key" = '${serviceKey}'`)
    await client.query(`ALTER DATABASE postgres SET "app.embedding_provider" = 'openai'`)

    console.log('✓ Set app.supabase_functions_url =', functionsUrl)
    console.log('✓ Set app.service_role_key = [redacted]')
    console.log('✓ Set app.embedding_provider = openai (set EMBEDDING_PROVIDER=openai for the API too)')
    console.log('\nTrigger config ready. New connections will pick these up automatically.')
  } finally {
    client.release()
    await pool.end()
  }
}

run().catch(err => { console.error(err.message); process.exit(1) })
