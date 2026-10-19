import type { OrderWithDetails } from '../types/order'

function getResend() {
  const { Resend } = require('resend')
  return new Resend(process.env.RESEND_API_KEY)
}

function formatAddress(addr: Record<string, string> | null): string {
  if (!addr) return 'Address not provided'
  const parts = [addr.full_name, addr.line1, addr.line2, addr.city, addr.state, addr.postal_code]
  return parts.filter(Boolean).join(', ')
}

export async function sendOrderConfirmedEmail(order: OrderWithDetails): Promise<void> {
  if (!process.env.RESEND_API_KEY || !order.buyer_email) return

  const resend = getResend()
  await resend.emails.send({
    from: process.env.EMAIL_FROM ?? 'orders@resend.dev',
    to: order.buyer_email,
    subject: `Order confirmed — ${order.product_name}`,
    html: `
      <h2>Your order is confirmed</h2>
      <p>Order #${order.id.slice(0, 8).toUpperCase()}</p>
      <p><strong>${order.product_name}</strong></p>
      <p>Quantity: ${order.quantity}</p>
      <p>Total: ₹${Number(order.total_price).toFixed(2)}</p>
      <p>Estimated delivery: ${order.estimated_delivery ?? '3-5 days'}</p>
    `,
  })
}

// Generic sender — guards on config; never throws into the caller.
async function send(to: string | null | undefined, subject: string, html: string): Promise<void> {
  if (!process.env.RESEND_API_KEY || !to) return
  try {
    await getResend().emails.send({ from: process.env.EMAIL_FROM ?? 'orders@resend.dev', to, subject, html })
  } catch { /* email is best-effort */ }
}

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
const inr = (n: number) => '₹' + Number(n).toFixed(2)

export async function sendReturnRequestedSellerEmail(sellerEmail: string, p: { order_id: string; product_name: string; reason: string; description?: string | null }) {
  await send(sellerEmail, `New return request — ${p.product_name}`, `
    <h2>A buyer requested a return</h2>
    <p>Order #${p.order_id.slice(0, 8).toUpperCase()} — <strong>${p.product_name}</strong></p>
    <p>Reason: ${p.reason.replace(/_/g, ' ')}</p>
    ${p.description ? `<p>Details: ${p.description}</p>` : ''}
    <p>Review and approve or reject this return in your seller dashboard.</p>`)
}

export async function sendReturnApprovedEmail(buyerEmail: string | null, p: { product_name: string }) {
  await send(buyerEmail, `Return approved — ${p.product_name}`, `
    <h2>Your return has been approved</h2>
    <p>We are arranging a courier to pick up <strong>${p.product_name}</strong> from your address.
    You will receive pickup details shortly.</p>
    <p>Please keep the item packaged and ready.</p>`)
}

export async function sendReturnRejectedEmail(buyerEmail: string | null, p: { product_name: string; seller_notes: string }) {
  await send(buyerEmail, `Return request declined — ${p.product_name}`, `
    <h2>Your return request was declined</h2>
    <p><strong>${p.product_name}</strong></p>
    <p>Reason: ${p.seller_notes}</p>`)
}

export async function sendReturnPickupScheduledEmail(buyerEmail: string | null, p: { product_name: string; carrier: string; pickup_date: string; tracking_number: string; address: Record<string, string> | null }) {
  const a = p.address ?? {}
  await send(buyerEmail, `Return pickup scheduled — ${p.product_name}`, `
    <h2>Your return pickup has been scheduled</h2>
    <p><strong>Carrier:</strong> ${p.carrier}</p>
    <p><strong>Pickup date:</strong> ${fmtDate(p.pickup_date)}</p>
    <p><strong>Tracking:</strong> ${p.tracking_number}</p>
    <p>Please keep the package ready at your door. The courier will collect it from your address:</p>
    <p>${[a.line1, a.city].filter(Boolean).join(', ')}</p>`)
}

export async function sendReturnPickedUpEmail(buyerEmail: string | null, p: { product_name: string; carrier: string; tracking_number: string }) {
  await send(buyerEmail, `Return picked up — ${p.product_name}`, `
    <h2>Your package has been picked up by ${p.carrier}</h2>
    <p>We will process your refund once we inspect the item.</p>
    <p><strong>Tracking:</strong> ${p.tracking_number}</p>`)
}

export async function sendReturnReceivedEmail(buyerEmail: string | null, p: { product_name: string; refund_amount: number }) {
  await send(buyerEmail, `Return received — refund on the way`, `
    <h2>We have received your returned item</h2>
    <p><strong>${p.product_name}</strong></p>
    <p>Your refund of <strong>${inr(p.refund_amount)}</strong> will be processed within 5-7 business days.</p>`)
}

export async function sendSellerSuspendedEmail(sellerEmail: string) {
  await send(sellerEmail, `Your Stok store has been suspended`, `
    <h2>Your store has been suspended</h2>
    <p>Your store has been temporarily suspended due to a high rate of returns. Your products
    are no longer visible to buyers. Please contact support to resolve this.</p>`)
}

export async function sendOrderShippedEmail(order: OrderWithDetails): Promise<void> {
  if (!process.env.RESEND_API_KEY || !order.buyer_email) return

  const resend = getResend()
  const eta = order.estimated_delivery
    ? new Date(order.estimated_delivery).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : 'soon'
  await resend.emails.send({
    from: process.env.EMAIL_FROM ?? 'orders@resend.dev',
    to: order.buyer_email,
    subject: `Your order has shipped — ${order.product_name}`,
    html: `
      <h2>Your order is on the way 📦</h2>
      <p>Order #${order.id.slice(0, 8).toUpperCase()}</p>
      ${order.product_image ? `<img src="${order.product_image}" alt="" width="120" style="border-radius:8px" />` : ''}
      <p><strong>${order.product_name}</strong> × ${order.quantity}</p>
      <p><strong>Tracking number:</strong> ${order.tracking_number ?? '—'}</p>
      <p><strong>Carrier:</strong> ${order.carrier ?? '—'}</p>
      <p><strong>Estimated delivery:</strong> ${eta}</p>
      <p style="color:#475569;font-size:13px">Track your package on the carrier's website using the tracking number above.</p>
    `,
  })
}

export async function sendSellerNewOrderEmail(order: OrderWithDetails): Promise<void> {
  if (!process.env.RESEND_API_KEY) return

  const resend = getResend()
  await resend.emails.send({
    from: process.env.EMAIL_FROM ?? 'orders@resend.dev',
    to: order.seller_email,
    subject: `New order — ${order.product_name}`,
    html: `
      <h2>You have a new order</h2>
      <p>Order #${order.id.slice(0, 8).toUpperCase()}</p>
      <p><strong>${order.product_name}</strong> × ${order.quantity}</p>
      <p>Ship to: ${formatAddress(order.shipping_address)}</p>
      <p>Your payout: ₹${Math.round(Number(order.total_price) * 0.9)}</p>
      <p>Please fulfill within 24 hours.</p>
    `,
  })
}
