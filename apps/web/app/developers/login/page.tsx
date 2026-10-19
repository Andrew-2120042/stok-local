import AuthForm from './AuthForm'

export default function LoginPage() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <div style={{ width: 400, padding: 32, background: '#fff', borderRadius: 12, boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
        <div style={{ marginBottom: 28, textAlign: 'center' }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#0F6E56' }}>Stok</div>
          <div style={{ fontSize: 14, color: '#64748b', marginTop: 6 }}>Developer Portal</div>
        </div>
        <AuthForm />
      </div>
    </div>
  )
}
