import { redirect } from 'next/navigation'
import SandboxPayButton from './SandboxPayButton'

export default async function SandboxCheckoutPage({ params }: { params: { orderId: string } }) {
  const res = await fetch(`${process.env.API_BASE_URL}/v1/order/${params.orderId}`, {
    cache: 'no-store',
  })

  // Sandbox checkout doesn't go through auth middleware (it's the UI)
  // We fetch directly via internal fetch
  const order = res.ok ? await res.json() : null

  if (!order || (order.status !== 'pending_payment' && order.status !== 'paid')) {
    redirect('/checkout/expired')
  }

  const paid = order.status === 'paid'

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ width: 440, background: '#fff', borderRadius: 14, boxShadow: '0 4px 24px rgba(0,0,0,0.08)', padding: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <div style={{ background: '#fef3c7', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 700, color: '#d97706' }}>
            SANDBOX MODE
          </div>
          <div style={{ fontSize: 13, color: '#64748b' }}>No real money charged</div>
        </div>

        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>
          {paid ? 'Sandbox Order Paid!' : 'Simulate Payment'}
        </h1>

        <div style={{ background: '#f8fafc', borderRadius: 10, padding: 16, marginBottom: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{order.product?.name}</div>
          <div style={{ fontSize: 13, color: '#64748b' }}>
            Qty: {order.product?.quantity} · ${order.product?.total_price?.toFixed(2)} USD
          </div>
          <div style={{ fontSize: 13, color: '#64748b' }}>Seller: {order.seller?.name}</div>
        </div>

        {paid ? (
          <div style={{ textAlign: 'center', color: '#16a34a', fontWeight: 600, fontSize: 16, padding: '16px 0' }}>
            ✓ Payment simulated — order #{params.orderId.slice(0, 8).toUpperCase()}
          </div>
        ) : (
          <SandboxPayButton orderId={params.orderId} />
        )}
      </div>
    </div>
  )
}
