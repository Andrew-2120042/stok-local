'use client'
import { PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  orderId: string
  unitPrice: number
  quantity: number
  prefillAddress: Record<string, string> | null
}

export function PaymentForm({ orderId, unitPrice, quantity, prefillAddress }: Props) {
  const stripe = useStripe()
  const elements = useElements()
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState(prefillAddress?.full_name ?? '')
  const [line1, setLine1] = useState(prefillAddress?.line1 ?? '')
  const [line2, setLine2] = useState(prefillAddress?.line2 ?? '')
  const [city, setCity] = useState(prefillAddress?.city ?? '')
  const [state, setState] = useState(prefillAddress?.state ?? '')
  const [postalCode, setPostalCode] = useState(prefillAddress?.postal_code ?? '')
  const [phone, setPhone] = useState(prefillAddress?.phone ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const totalPrice = unitPrice * quantity
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001'

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return

    setLoading(true)
    setError(null)

    try {
      // Save buyer details before payment so webhook has the data
      await fetch(`${apiBase}/v1/order/${orderId}/details`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          buyer_email: email,
          shipping_address: {
            full_name: fullName,
            line1,
            line2: line2 || undefined,
            city,
            state,
            postal_code: postalCode,
            phone: phone || undefined,
            country: 'IN',
          },
        }),
      })

      // Confirm payment — `redirect: 'if_required'` lets us handle success inline
      // (avoids a full-page redirect for cards that don't need 3DS)
      const { error: stripeError, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/checkout/success?order_id=${orderId}`,
          receipt_email: email,
        },
        redirect: 'if_required',
      })

      if (stripeError) {
        setError(stripeError.message ?? 'Payment failed. Please try again.')
      } else if (paymentIntent?.status === 'succeeded') {
        router.push(`/checkout/success?order_id=${orderId}`)
      }
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {/* Contact */}
      <label style={styles.label}>Email for confirmation</label>
      <input
        type="email"
        required
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={styles.input}
      />

      {/* Delivery address */}
      <label style={styles.label}>Delivery address</label>
      <input
        required
        placeholder="Full name"
        value={fullName}
        onChange={(e) => setFullName(e.target.value)}
        style={styles.input}
      />
      <input
        required
        placeholder="Address line 1"
        value={line1}
        onChange={(e) => setLine1(e.target.value)}
        style={styles.input}
      />
      <input
        placeholder="Address line 2 (optional)"
        value={line2}
        onChange={(e) => setLine2(e.target.value)}
        style={styles.input}
      />
      <div style={styles.row}>
        <input
          required
          placeholder="City"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          style={{ ...styles.input, flex: 1 }}
        />
        <input
          required
          placeholder="State"
          value={state}
          onChange={(e) => setState(e.target.value)}
          style={{ ...styles.input, flex: 1 }}
        />
      </div>
      <div style={styles.row}>
        <input
          required
          placeholder="PIN code"
          value={postalCode}
          onChange={(e) => setPostalCode(e.target.value)}
          style={{ ...styles.input, flex: 1 }}
        />
        <input
          placeholder="Phone (optional)"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          style={{ ...styles.input, flex: 1 }}
        />
      </div>

      {/* Stripe payment element */}
      <div style={styles.stripeWrapper}>
        <PaymentElement options={{ layout: 'tabs' }} />
      </div>

      {/* Error */}
      {error && <p style={styles.error}>{error}</p>}

      {/* CTA */}
      <button type="submit" disabled={loading || !stripe} style={styles.button}>
        {loading ? 'Processing…' : `Confirm & Pay $${totalPrice.toLocaleString('en-US')}`}
      </button>

      <p style={styles.secureNote}>🔒 Secured by Stripe · Payments never stored on our servers</p>
    </form>
  )
}

const styles: Record<string, React.CSSProperties> = {
  label: {
    display: 'block',
    fontSize: '13px',
    fontWeight: 500,
    color: '#444',
    marginBottom: '6px',
    marginTop: '14px',
  },
  input: {
    display: 'block',
    width: '100%',
    padding: '10px 12px',
    border: '1px solid #ddd',
    borderRadius: '8px',
    fontSize: '14px',
    color: '#111',
    background: '#fafafa',
    boxSizing: 'border-box',
    marginBottom: '8px',
    outline: 'none',
  },
  row: {
    display: 'flex',
    gap: '8px',
  },
  stripeWrapper: {
    marginTop: '20px',
    marginBottom: '16px',
  },
  error: {
    color: '#c0392b',
    fontSize: '13px',
    margin: '0 0 12px',
    padding: '10px 12px',
    background: '#fdf2f2',
    borderRadius: '8px',
    border: '1px solid #f5c6c6',
  },
  button: {
    display: 'block',
    width: '100%',
    padding: '14px',
    background: '#0F6E56',
    color: '#fff',
    border: 'none',
    borderRadius: '10px',
    fontSize: '16px',
    fontWeight: 700,
    cursor: 'pointer',
    marginTop: '4px',
    transition: 'opacity 0.15s',
  },
  secureNote: {
    textAlign: 'center',
    fontSize: '11px',
    color: '#aaa',
    marginTop: '12px',
    marginBottom: 0,
  },
}
