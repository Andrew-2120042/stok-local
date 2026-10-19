import { createClient } from '../../../lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function DashboardPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/developers/login')

  const res = await fetch(`${process.env.API_BASE_URL}/portal/me`, {
    headers: { 'x-supabase-user-id': user.id, 'x-internal-secret': process.env.INTERNAL_API_SECRET ?? '' },
    cache: 'no-store',
  })

  if (!res.ok) redirect('/developers/login')
  const { developer } = await res.json()

  const planColors: Record<string, string> = {
    free: '#64748b',
    starter: '#0F6E56',
    pro: '#7c3aed',
    enterprise: '#dc2626',
  }

  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Welcome, {developer.name}</h1>
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, color: '#64748b' }}>{developer.email}</span>
          <span style={{
            fontSize: 11,
            fontWeight: 700,
            padding: '2px 10px',
            borderRadius: 20,
            background: planColors[developer.plan] ?? '#64748b',
            color: '#fff',
            textTransform: 'uppercase',
          }}>{developer.plan}</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20, marginBottom: 36 }}>
        {[
          { label: 'Plan', value: developer.plan.charAt(0).toUpperCase() + developer.plan.slice(1) },
          { label: 'Account created', value: new Date(developer.created_at).toLocaleDateString() },
          { label: 'Status', value: 'Active' },
        ].map(({ label, value }) => (
          <div key={label} style={{ background: '#fff', borderRadius: 10, padding: '20px 24px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>{label}</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
          </div>
        ))}
      </div>

      <div style={{ background: '#fff', borderRadius: 10, padding: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Quick Start</h2>
        <pre style={{ background: '#1e293b', color: '#34d399', borderRadius: 8, padding: 20, fontSize: 13, overflow: 'auto', margin: 0 }}>{`curl -X POST https://api.stok.dev/v1/search \\
  -H "Authorization: Bearer sk_live_am_..." \\
  -H "Content-Type: application/json" \\
  -d '{"query": "wireless headphones under $100"}'`}</pre>
      </div>

      <div style={{ background: '#fff', borderRadius: 10, padding: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Rate Limits</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
              {['Plan', 'Searches/day', 'Orders/day'].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '8px 0', color: '#64748b', fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              ['Free', '100', '10'],
              ['Starter', '1,000', '100'],
              ['Pro', '10,000', '1,000'],
              ['Enterprise', 'Unlimited', 'Unlimited'],
            ].map(([plan, s, o]) => (
              <tr key={plan} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '10px 0', fontWeight: plan === developer.plan.charAt(0).toUpperCase() + developer.plan.slice(1) ? 700 : 400 }}>{plan}</td>
                <td style={{ padding: '10px 0' }}>{s}</td>
                <td style={{ padding: '10px 0' }}>{o}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
