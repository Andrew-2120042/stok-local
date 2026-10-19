import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '../../../../../lib/supabase/server'

export async function GET(request: NextRequest) {
  const { data: { user } } = await createClient().auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const res = await fetch(`${process.env.API_BASE_URL}/portal/sellers/orders${request.nextUrl.search}`, {
    headers: { 'x-supabase-user-id': user.id, 'x-internal-secret': process.env.INTERNAL_API_SECRET ?? '' }, cache: 'no-store',
  })
  return NextResponse.json(await res.json(), { status: res.status })
}
