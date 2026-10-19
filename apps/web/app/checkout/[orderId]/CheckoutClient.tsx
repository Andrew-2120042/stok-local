'use client'
import { Elements } from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'
import { PaymentForm } from './PaymentForm'
import type { OrderStatusResponse } from '../../../types/checkout'

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!)

const trustBadgeColor = (score: number) =>
  score >= 85 ? '#1a7f4b' : score >= 65 ? '#c87d00' : '#c0392b'

export function CheckoutClient({ order }: { order: OrderStatusResponse }) {
  const { product, seller, stripe_client_secret, order_id } = order
  const totalPrice = product.unit_price * product.quantity

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        {/* Product image */}
        {product.image && (
          <img
            src={product.image}
            alt={product.name}
            style={styles.productImage}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        )}

        {/* Product info */}
        <div style={styles.section}>
          <p style={styles.brand}>{product.brand}</p>
          <h1 style={styles.productName}>{product.name}</h1>

          {/* Seller badge */}
          <div style={styles.sellerRow}>
            <span style={styles.sellerName}>Sold by {seller.name}</span>
            <span style={{ ...styles.trustBadge, background: trustBadgeColor(seller.trust_score) }}>
              ★ {seller.trust_score}% trusted
            </span>
          </div>

          {/* Price */}
          <div style={styles.priceRow}>
            <span style={styles.price}>${totalPrice.toLocaleString('en-US')}</span>
            {product.quantity > 1 && (
              <span style={styles.priceBreak}>${product.unit_price.toLocaleString('en-US')} × {product.quantity}</span>
            )}
          </div>

          {/* Meta */}
          <div style={styles.metaRow}>
            <span style={styles.metaItem}>📦 Qty: {product.quantity}</span>
            <span style={styles.metaItem}>🚚 Arrives in 2–3 days</span>
            <span style={styles.metaItem}>↩ 7-day returns</span>
          </div>
        </div>

        {/* Divider */}
        <div style={styles.divider} />

        {/* Payment form */}
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Delivery & Payment</h2>
          <Elements
            stripe={stripePromise}
            options={{
              clientSecret: stripe_client_secret!,
              appearance: {
                theme: 'stripe',
                variables: { colorPrimary: '#0F6E56', borderRadius: '8px' },
              },
            }}
          >
            <PaymentForm
              orderId={order_id}
              unitPrice={product.unit_price}
              quantity={product.quantity}
              prefillAddress={order.shipping_address}
            />
          </Elements>
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'flex-start',
    padding: '24px 16px',
    background: '#f7f7f7',
  },
  card: {
    background: '#fff',
    borderRadius: '16px',
    boxShadow: '0 2px 16px rgba(0,0,0,0.10)',
    maxWidth: '480px',
    width: '100%',
    overflow: 'hidden',
  },
  productImage: {
    width: '100%',
    height: '280px',
    objectFit: 'cover',
    display: 'block',
  },
  section: {
    padding: '20px 24px',
  },
  brand: {
    margin: '0 0 4px',
    fontSize: '13px',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  productName: {
    margin: '0 0 12px',
    fontSize: '20px',
    fontWeight: 700,
    color: '#111',
    lineHeight: 1.3,
  },
  sellerRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '14px',
  },
  sellerName: {
    fontSize: '13px',
    color: '#555',
  },
  trustBadge: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#fff',
    padding: '2px 8px',
    borderRadius: '12px',
  },
  priceRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '10px',
    marginBottom: '12px',
  },
  price: {
    fontSize: '28px',
    fontWeight: 700,
    color: '#0F6E56',
  },
  priceBreak: {
    fontSize: '14px',
    color: '#888',
  },
  metaRow: {
    display: 'flex',
    gap: '16px',
    flexWrap: 'wrap',
  },
  metaItem: {
    fontSize: '13px',
    color: '#555',
  },
  divider: {
    height: '1px',
    background: '#f0f0f0',
    margin: '0 24px',
  },
  sectionTitle: {
    margin: '0 0 16px',
    fontSize: '16px',
    fontWeight: 600,
    color: '#111',
  },
}
