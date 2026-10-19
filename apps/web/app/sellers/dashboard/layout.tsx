import { redirect } from 'next/navigation'
import { createClient } from '../../../lib/supabase/server'
import SellerNav from './SellerNav'

export default async function SellerDashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sellers/login')

  const me = await fetch(`${process.env.API_BASE_URL}/portal/sellers/me`, {
    headers: { 'x-supabase-user-id': user.id, 'x-internal-secret': process.env.INTERNAL_API_SECRET ?? '' }, cache: 'no-store',
  })
  if (me.status === 404) redirect('/sellers/signup')
  const seller = (await me.json().catch(() => ({}))).seller ?? {}

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: 'system-ui, sans-serif', background: '#f8fafc' }}>
      {/* Sidebar */}
      <aside style={{ width: 220, background: '#0F1117', color: '#fff', display: 'flex', flexDirection: 'column', padding: 16 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#fff', padding: '6px 14px 18px' }}>
          Stok <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 500 }}>sellers</span>
        </div>
        <SellerNav />
      </aside>

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* Top bar */}
        <header style={{
          height: 60, borderBottom: '1px solid #e2e8f0', background: '#fff', display: 'flex',
          alignItems: 'center', justifyContent: 'flex-end', padding: '0 28px', gap: 12,
        }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{seller.name ?? 'Seller'}</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>{seller.email}</div>
          </div>
          {seller.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={seller.logo_url} alt="logo" style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover' }} />
          ) : (
            <div style={{ width: 36, height: 36, borderRadius: 8, background: '#0F6E56', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>
              {(seller.name ?? 'S').charAt(0).toUpperCase()}
            </div>
          )}
        </header>

        <main style={{ flex: 1 }}>{children}</main>
      </div>
    </div>
  )
}
