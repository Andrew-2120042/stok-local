import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options })
          response = NextResponse.next({ request: { headers: request.headers } })
          response.cookies.set({ name, value, ...options })
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: '', ...options })
          response = NextResponse.next({ request: { headers: request.headers } })
          response.cookies.set({ name, value: '', ...options })
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  const { pathname } = request.nextUrl

  // ── Developer portal ────────────────────────────────────────────────────────
  const isDevDashboard =
    pathname.startsWith('/developers/dashboard') ||
    pathname.startsWith('/developers/keys') ||
    pathname.startsWith('/developers/usage') ||
    pathname.startsWith('/developers/webhooks')

  if (isDevDashboard && !user) {
    return NextResponse.redirect(new URL('/developers/login', request.url))
  }
  if (pathname === '/developers/login' && user) {
    return NextResponse.redirect(new URL('/developers/dashboard', request.url))
  }

  // ── Seller portal ───────────────────────────────────────────────────────────
  // Protect everything under /sellers except the public auth pages. Whether a
  // seller *record* exists (→ /sellers/signup) is checked by the dashboard
  // server component, which can call the API; middleware only gates on session.
  const isSellerPublic = pathname === '/sellers/login' || pathname === '/sellers/signup'
  const isSellerArea = pathname.startsWith('/sellers/')

  if (isSellerArea && !isSellerPublic && !user) {
    return NextResponse.redirect(new URL('/sellers/login', request.url))
  }
  if (pathname === '/sellers/login' && user) {
    return NextResponse.redirect(new URL('/sellers/dashboard', request.url))
  }

  return response
}

export const config = {
  matcher: ['/developers/:path*', '/sellers/:path*'],
}
