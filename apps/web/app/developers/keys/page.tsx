import { createClient } from '../../../lib/supabase/server'
import { redirect } from 'next/navigation'
import KeysClient from './KeysClient'

export default async function KeysPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/developers/login')

  const res = await fetch(`${process.env.API_BASE_URL}/portal/keys`, {
    headers: { 'x-supabase-user-id': user.id, 'x-internal-secret': process.env.INTERNAL_API_SECRET ?? '' },
    cache: 'no-store',
  })
  const { keys } = await res.json()

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>API Keys</h1>
      <p style={{ fontSize: 14, color: '#64748b', marginBottom: 28 }}>
        Live keys charge real money. Test keys use sandbox products — no charge.
      </p>
      <KeysClient initialKeys={keys} />
    </div>
  )
}
