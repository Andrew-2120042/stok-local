import { NextRequest, NextResponse } from 'next/server'
import { verifySignupUser } from '../../../../../lib/supabase/signup'

// Called right after Supabase signup to create the seller record.
export async function POST(request: NextRequest) {
  const body = await request.json()
  if (!(await verifySignupUser(body?.supabase_user_id, body?.email))) {
    return NextResponse.json({ error: 'Unauthorized', message: 'Signup user could not be verified' }, { status: 401 })
  }
  const res = await fetch(`${process.env.API_BASE_URL}/portal/sellers/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_API_SECRET ?? '' },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  return NextResponse.json(json, { status: res.status })
}
