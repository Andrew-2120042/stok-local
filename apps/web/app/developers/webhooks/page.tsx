import { createClient } from '../../../lib/supabase/server'
import { redirect } from 'next/navigation'
import WebhooksClient from './WebhooksClient'

export default async function WebhooksPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/developers/login')

  const res = await fetch(`${process.env.API_BASE_URL}/portal/webhooks`, {
    headers: { 'x-supabase-user-id': user.id, 'x-internal-secret': process.env.INTERNAL_API_SECRET ?? '' },
    cache: 'no-store',
  })
  const { webhooks } = await res.json()

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Webhooks</h1>
      <p style={{ fontSize: 14, color: '#64748b', marginBottom: 28 }}>
        Receive events when orders are created, paid, shipped, or cancelled. Signed with HMAC-SHA256.
      </p>
      <WebhooksClient initialWebhooks={webhooks} />
    </div>
  )
}
