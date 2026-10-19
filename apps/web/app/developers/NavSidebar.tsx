'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '../../lib/supabase/client'

const links = [
  { href: '/developers/dashboard', label: 'Dashboard' },
  { href: '/developers/keys', label: 'API Keys' },
  { href: '/developers/usage', label: 'Usage' },
  { href: '/developers/webhooks', label: 'Webhooks' },
]

export default function NavSidebar() {
  const pathname = usePathname()
  const router = useRouter()

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/developers/login')
  }

  return (
    <div style={{ width: 220, background: '#1e293b', color: '#fff', display: 'flex', flexDirection: 'column', padding: '24px 0' }}>
      <div style={{ padding: '0 20px 24px', borderBottom: '1px solid #334155' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#34d399' }}>Stok</div>
        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>Developer Portal</div>
      </div>
      <nav style={{ flex: 1, padding: '16px 12px' }}>
        {links.map((link) => {
          const active = pathname.startsWith(link.href)
          return (
            <Link
              key={link.href}
              href={link.href}
              style={{
                display: 'block',
                padding: '9px 12px',
                borderRadius: 7,
                fontSize: 14,
                fontWeight: active ? 600 : 400,
                color: active ? '#34d399' : '#cbd5e1',
                background: active ? 'rgba(52,211,153,0.12)' : 'transparent',
                textDecoration: 'none',
                marginBottom: 4,
              }}
            >
              {link.label}
            </Link>
          )
        })}
      </nav>
      <div style={{ padding: '0 12px' }}>
        <button
          onClick={signOut}
          style={{ width: '100%', padding: '9px 12px', borderRadius: 7, background: 'none', border: '1px solid #334155', color: '#94a3b8', fontSize: 14, cursor: 'pointer', textAlign: 'left' }}
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
