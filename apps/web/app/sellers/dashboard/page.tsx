import { redirect } from 'next/navigation'
import { createClient } from '../../../lib/supabase/server'

async function apiGet(pathname: string, userId: string) {
  const res = await fetch(`${process.env.API_BASE_URL}${pathname}`, {
    headers: { 'x-supabase-user-id': userId, 'x-internal-secret': process.env.INTERNAL_API_SECRET ?? '' },
    cache: 'no-store',
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

const inr = (n: number) => '₹' + Number(n).toLocaleString('en-IN')

export default async function SellerDashboardPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sellers/login')

  const me = await apiGet('/portal/sellers/me', user.id)
  if (me.status === 404) redirect('/sellers/signup')

  const seller = me.body.seller
  const { body: statsBody } = await apiGet('/portal/sellers/me/stats', user.id)
  const stats = statsBody.stats ?? {}

  return (
    <div style={{ padding: 32, maxWidth: 1000, margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a' }}>Welcome back, {seller?.name}</h1>
        {seller?.status === 'suspended' && (
          <span style={{ background: '#fef2f2', color: '#dc2626', padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600 }}>Suspended</span>
        )}
      </div>
      <div style={{ color: '#64748b', fontSize: 14, marginBottom: 24 }}>
        Trust Score: <strong style={{ color: '#0F6E56' }}>{stats.trust_score ?? '—'}/100</strong>
        {'  ·  '}Quality Score: <strong style={{ color: '#0F6E56' }}>{stats.quality_score ?? '—'}/100</strong>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16, marginBottom: 28 }}>
        <Stat label="Orders this month" value={String(stats.month_orders ?? 0)} />
        <Stat label="Revenue (90%)" value={inr(stats.month_revenue ?? 0)} />
        <Stat label="Returns this month" value={String(stats.month_returns ?? 0)} />
        <Stat label="Total earned" value={inr(stats.total_earned ?? 0)} accent />
        <Stat label="Pending payout" value={inr(stats.pending_payout ?? 0)} />
        <Stat label="Products" value={String(stats.product_count ?? 0)} />
        <Stat label="Avg quality score" value={`${stats.quality_score ?? 50}/100`} />
        <Stat label="Below 40 (needs attention)" value={String(stats.products_below_40 ?? 0)} warn={(stats.products_below_40 ?? 0) > 0} />
      </div>

      {(stats.products_below_40 ?? 0) > 0 && (
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '12px 16px', fontSize: 13, color: '#92400e', marginBottom: 16 }}>
          {stats.products_below_40} product(s) have a quality score below 40. High return rates lower the score — review these in <strong>Products</strong>.
        </div>
      )}

      <div style={{ background: '#f1f5f9', borderRadius: 8, padding: '14px 16px', fontSize: 13, color: '#475569' }}>
        Product management, orders, returns and payouts are added in the next steps.
        Payouts currently show your <strong>earnings ledger</strong> — actual bank transfers arrive in a later phase.
      </div>
    </div>
  )
}

function Stat({ label, value, accent, warn }: { label: string; value: string; accent?: boolean; warn?: boolean }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 16 }}>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: warn ? '#b45309' : accent ? '#0F6E56' : '#0f172a' }}>{value}</div>
    </div>
  )
}
