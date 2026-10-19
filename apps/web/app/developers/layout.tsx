import type { ReactNode } from 'react'

export const metadata = { title: 'Stok Developer Portal' }

export default function DevelopersLayout({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: 'system-ui, sans-serif' }}>
      {children}
    </div>
  )
}
