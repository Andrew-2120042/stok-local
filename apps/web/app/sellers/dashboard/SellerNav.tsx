'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '../../../lib/supabase/client'

const items = [
  { href: '/sellers/dashboard', label: 'Dashboard', exact: true },
  { href: '/sellers/dashboard/products', label: 'Products' },
  { href: '/sellers/dashboard/orders', label: 'Orders' },
  { href: '/sellers/dashboard/returns', label: 'Returns' },
  { href: '/sellers/dashboard/payouts', label: 'Payouts' },
  { href: '/sellers/dashboard/settings', label: 'Settings' },
]

export default function SellerNav() {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  const active = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(href + '/')

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/sellers/login')
  }

  return (
    <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
      {items.map((it) => {
        const on = active(it.href, it.exact)
        return (
          <Link key={it.href} href={it.href} style={{
            padding: '10px 14px', borderRadius: 8, fontSize: 14, fontWeight: on ? 600 : 500,
            color: on ? '#fff' : '#94a3b8', background: on ? '#0F6E56' : 'transparent', textDecoration: 'none',
          }}>
            {it.label}
          </Link>
        )
      })}
      <div style={{ flex: 1 }} />
      <button onClick={signOut} style={{
        marginTop: 'auto', padding: '10px 14px', borderRadius: 8, fontSize: 14, fontWeight: 500,
        color: '#94a3b8', background: 'transparent', border: 'none', textAlign: 'left', cursor: 'pointer',
      }}>
        Sign out
      </button>
    </nav>
  )
}
