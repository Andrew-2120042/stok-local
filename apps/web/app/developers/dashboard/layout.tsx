import type { ReactNode } from 'react'
import NavSidebar from '../NavSidebar'

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <NavSidebar />
      <main style={{ flex: 1, padding: '32px 40px', overflow: 'auto' }}>
        {children}
      </main>
    </div>
  )
}
