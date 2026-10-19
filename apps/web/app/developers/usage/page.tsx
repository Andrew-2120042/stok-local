import { createClient } from '../../../lib/supabase/server'
import { redirect } from 'next/navigation'
import UsageChart from './UsageChart'

export default async function UsagePage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/developers/login')

  const res = await fetch(`${process.env.API_BASE_URL}/portal/usage?days=30`, {
    headers: { 'x-supabase-user-id': user.id, 'x-internal-secret': process.env.INTERNAL_API_SECRET ?? '' },
    cache: 'no-store',
  })
  const { usage, top_queries } = await res.json()

  const totalSearches = (usage as any[]).reduce((s: number, d: any) => s + (d.search_count ?? 0), 0)

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 28 }}>Usage — last 30 days</h1>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 32 }}>
        <div style={{ background: '#fff', borderRadius: 10, padding: '20px 24px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>Total searches</div>
          <div style={{ fontSize: 32, fontWeight: 700 }}>{totalSearches.toLocaleString()}</div>
        </div>
        <div style={{ background: '#fff', borderRadius: 10, padding: '20px 24px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>Active days</div>
          <div style={{ fontSize: 32, fontWeight: 700 }}>{(usage as any[]).length}</div>
        </div>
      </div>

      <div style={{ background: '#fff', borderRadius: 10, padding: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 20 }}>Searches per day</h2>
        {usage.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 14, padding: 40 }}>No data yet — make your first API call!</div>
        ) : (
          <UsageChart data={usage} />
        )}
      </div>

      {top_queries?.length > 0 && (
        <div style={{ background: '#fff', borderRadius: 10, padding: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Top queries</h2>
          <div>
            {top_queries.map((q: any, i: number) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: i < top_queries.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                <span style={{ fontSize: 14 }}>{q.query}</span>
                <span style={{ fontSize: 13, color: '#64748b', fontWeight: 600 }}>{q.count}×</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
