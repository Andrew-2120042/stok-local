export const metadata = {
  title: 'Stok',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', background: '#f7f7f7' }}>
        {children}
      </body>
    </html>
  )
}
