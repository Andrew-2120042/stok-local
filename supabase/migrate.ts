import 'dotenv/config'
import { Pool } from 'pg'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "") ? false : { rejectUnauthorized: false } })

async function migrate() {
  const client = await pool.connect()
  try {
    const migrationsDir = join(__dirname, 'migrations')
    const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()

    console.log(`Running ${files.length} migrations...\n`)

    for (const file of files) {
      const sql = readFileSync(join(migrationsDir, file), 'utf8')
      console.log(`  Running ${file}...`)
      try {
        await client.query(sql)
        console.log(`  ✓ ${file}`)
      } catch (err: any) {
        // Ignore "already exists" errors so migrate is idempotent
        if (err.message?.includes('already exists')) {
          console.log(`  ~ ${file} (already exists, skipped)`)
        } else {
          throw err
        }
      }
    }

    console.log('\n✅ All migrations complete.')
  } finally {
    client.release()
    await pool.end()
  }
}

migrate().catch(err => {
  console.error('Migration failed:', err.message)
  process.exit(1)
})
