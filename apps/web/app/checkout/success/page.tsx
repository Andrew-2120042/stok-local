export default function SuccessPage({
  searchParams,
}: {
  searchParams: { order_id?: string }
}) {
  const orderId = searchParams.order_id
  const orderRef = orderId ? orderId.slice(0, 8).toUpperCase() : '—'

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.icon}>✓</div>
        <h1 style={styles.title}>Payment received</h1>
        <p style={styles.orderRef}>Order #{orderRef}</p>
        <p style={styles.body}>
          Your order is confirmed and the seller has been notified. You'll receive a
          confirmation email shortly. Estimated delivery in 2–3 days.
        </p>
        <div style={styles.divider} />
        <p style={styles.agentNote}>
          Your agent can poll order status using:<br />
          <code style={styles.code}>GET /v1/order/{orderId ?? '<order_id>'}</code>
        </p>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: '24px',
    background: '#f7f7f7',
  },
  card: {
    background: '#fff',
    borderRadius: '16px',
    boxShadow: '0 2px 16px rgba(0,0,0,0.10)',
    maxWidth: '420px',
    width: '100%',
    padding: '40px 32px',
    textAlign: 'center',
  },
  icon: {
    width: '64px',
    height: '64px',
    background: '#0F6E56',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '28px',
    color: '#fff',
    margin: '0 auto 16px',
  },
  title: {
    fontSize: '22px',
    fontWeight: 700,
    color: '#111',
    margin: '0 0 6px',
  },
  orderRef: {
    fontSize: '13px',
    color: '#888',
    margin: '0 0 16px',
    letterSpacing: '0.05em',
  },
  body: {
    fontSize: '14px',
    color: '#555',
    lineHeight: 1.6,
    margin: '0 0 24px',
  },
  divider: {
    height: '1px',
    background: '#f0f0f0',
    margin: '0 0 20px',
  },
  agentNote: {
    fontSize: '12px',
    color: '#888',
    margin: 0,
    lineHeight: 1.7,
  },
  code: {
    background: '#f4f4f4',
    padding: '2px 6px',
    borderRadius: '4px',
    fontFamily: 'monospace',
    fontSize: '11px',
    color: '#333',
    wordBreak: 'break-all',
  },
}
