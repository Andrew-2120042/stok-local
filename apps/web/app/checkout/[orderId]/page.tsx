import { redirect } from 'next/navigation'
import { CheckoutClient } from './CheckoutClient'
import type { OrderStatusResponse } from '../../../types/checkout'

export default async function CheckoutPage({
  params,
}: {
  params: { orderId: string }
}) {
  let order: OrderStatusResponse | null = null

  try {
    const res = await fetch(
      `${process.env.API_BASE_URL ?? 'http://localhost:3001'}/v1/order/${params.orderId}`,
      { cache: 'no-store' }
    )
    if (res.ok) order = await res.json()
  } catch {
    // API unreachable — fall through to redirect
  }

  if (!order || order.status !== 'pending_payment' || !order.stripe_client_secret) {
    redirect('/checkout/expired')
  }

  // Time-based expiry: the background cancel job only runs periodically, so the
  // checkout page must also honor expires_at directly to avoid serving a payment
  // form for an order that has already lapsed.
  if (order.expires_at && new Date(order.expires_at).getTime() < Date.now()) {
    redirect('/checkout/expired')
  }

  // Live stock check: if the product shows as unavailable, redirect to expired
  if (!order.product) {
    redirect('/checkout/expired')
  }

  return <CheckoutClient order={order} />
}
