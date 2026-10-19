// One-command local setup: starts the local Supabase stack (Docker), writes
// .env + apps/web/.env.local pointing at it, and seeds the catalog.
// No personal accounts or API keys needed. Safe to re-run.
//
//   npm run setup
import { execSync } from 'child_process'
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { randomBytes } from 'crypto'
import path from 'path'

const ROOT = path.resolve(__dirname, '..')
const ROOT_ENV = path.join(ROOT, '.env')
const WEB_ENV = path.join(ROOT, 'apps/web/.env.local')

// Run a command and capture its stdout.
function capture(cmd: string): string {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' })
}

// Run a command, streaming its output to the terminal.
function sh(cmd: string): void {
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' })
}

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/)
    if (m) out[m[1]] = m[2]
  }
  return out
}

// Re-running keeps values the user added to a local config (e.g. their own
// Stripe test keys). A file that pointed at a different Supabase project is
// backed up and replaced with a fresh local config — its third-party keys are
// not carried over, so the local stack never silently uses someone's accounts.
function writeEnv(file: string, values: Record<string, string>, localKeys: string[]) {
  let existing: Record<string, string> = {}
  if (existsSync(file)) {
    existing = parseEnv(readFileSync(file, 'utf8'))
    const pointsElsewhere = localKeys.some((k) => existing[k] && existing[k] !== values[k])
    if (pointsElsewhere) {
      const backup = `${file}.backup-${Date.now()}`
      copyFileSync(file, backup)
      console.log(`  backed up previous ${path.relative(ROOT, file)} → ${path.relative(ROOT, backup)}`)
      existing = {}
    }
  }
  const merged: Record<string, string> = {}
  for (const [k, v] of Object.entries(values)) {
    merged[k] = localKeys.includes(k) ? v : (existing[k] || v)
  }
  writeFileSync(file, Object.entries(merged).map(([k, v]) => `${k}=${v}`).join('\n') + '\n')
  console.log(`  wrote ${path.relative(ROOT, file)}`)
}

function main() {
  try {
    capture('docker info')
  } catch {
    console.error('❌ Docker is not running. Start Docker Desktop (or colima) and re-run `npm run setup`.')
    process.exit(1)
  }

  console.log('▶ Starting local Supabase (first run downloads Docker images, ~5 min)...')
  sh('npx supabase start')

  const status = parseEnv(capture('npx supabase status -o env'))
  const apiUrl = status.API_URL
  const dbUrl = status.DB_URL
  const anonKey = status.ANON_KEY || status.PUBLISHABLE_KEY
  const serviceKey = status.SERVICE_ROLE_KEY || status.SECRET_KEY
  if (!apiUrl || !dbUrl || !anonKey || !serviceKey) {
    console.error('❌ Could not read local Supabase settings from `supabase status`.')
    process.exit(1)
  }

  const existingSecret = existsSync(ROOT_ENV) ? parseEnv(readFileSync(ROOT_ENV, 'utf8')).INTERNAL_API_SECRET : ''
  const internalSecret = existingSecret || randomBytes(32).toString('hex')

  console.log('\n▶ Writing environment files...')
  const localRoot = {
    DATABASE_URL: dbUrl,
    SUPABASE_URL: apiUrl,
    SUPABASE_ANON_KEY: anonKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceKey,
    STORAGE_BUCKET: 'product-images',
    STORAGE_URL: `${apiUrl}/storage/v1/object/public`,
    EMBEDDING_PROVIDER: 'local',
  }
  writeEnv(ROOT_ENV, {
    ...localRoot,
    INTERNAL_API_SECRET: internalSecret,
    OPENAI_API_KEY: '',
    STRIPE_SECRET_KEY: '',
    STRIPE_PUBLISHABLE_KEY: '',
    STRIPE_WEBHOOK_SECRET: '',
    STRIPE_PLATFORM_FEE_PERCENT: '10',
    STRIPE_REQUIRE_CONNECT: 'false',
    RESEND_API_KEY: '',
    EMAIL_FROM: 'onboarding@resend.dev',
    NODE_ENV: 'development',
    API_PORT: '3001',
    CHECKOUT_BASE_URL: 'http://localhost:3000',
    API_BASE_URL: 'http://localhost:3001',
  }, Object.keys(localRoot))

  const localWeb = {
    NEXT_PUBLIC_SUPABASE_URL: apiUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceKey,
    INTERNAL_API_SECRET: internalSecret,
  }
  writeEnv(WEB_ENV, {
    ...localWeb,
    NEXT_PUBLIC_API_BASE_URL: 'http://localhost:3001',
    API_BASE_URL: 'http://localhost:3001',
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: '',
  }, Object.keys(localWeb))

  console.log('\n▶ Seeding catalog (2 sellers, 50 products, 20 sandbox products)...')
  sh('npm run seed --silent')
  sh('npm run seed:sandbox --silent')

  console.log(`
✅ Local setup complete.

  npm run dev:api     → http://localhost:3001/health
  npm run dev:web     → http://localhost:3000

  Supabase Studio (browse the DB):  ${status.STUDIO_URL || 'http://127.0.0.1:54323'}
  Local email inbox:                ${status.INBUCKET_URL || status.MAILPIT_URL || 'http://127.0.0.1:54324'}
`)
}

main()
