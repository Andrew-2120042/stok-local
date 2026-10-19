export default function ExpiredPage() {
  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.icon}>⏱</div>
        <h1 style={styles.title}>This checkout link has expired</h1>
        <p style={styles.body}>
          Checkout links are valid for 15 minutes. Go back to your agent and search again to
          get a new link.
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
    maxWidth: '400px',
    width: '100%',
    padding: '40px 32px',
    textAlign: 'center',
  },
  icon: {
    fontSize: '48px',
    marginBottom: '16px',
  },
  title: {
    fontSize: '20px',
    fontWeight: 700,
    color: '#111',
    margin: '0 0 12px',
  },
  body: {
    fontSize: '14px',
    color: '#555',
    lineHeight: 1.6,
    margin: 0,
  },
}
