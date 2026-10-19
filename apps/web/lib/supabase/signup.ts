import { createClient as createAdminClient } from '@supabase/supabase-js'
import { createClient } from './server'

// Seller/developer records are created right after supabase.auth.signUp, which
// may not yield a session yet (email confirmation). So the browser sends the new
// user's id — trust it only if it matches the current session, or else is a real
// auth user with the same email created within the last few minutes.
const SIGNUP_WINDOW_MS = 15 * 60 * 1000

export async function verifySignupUser(userId: unknown, email: unknown): Promise<boolean> {
  if (typeof userId !== 'string' || typeof email !== 'string') return false

  const { data: { user: sessionUser } } = await createClient().auth.getUser()
  if (sessionUser) return sessionUser.id === userId

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
  const { data, error } = await admin.auth.admin.getUserById(userId)
  if (error || !data.user) return false

  const sameEmail = data.user.email?.toLowerCase() === email.trim().toLowerCase()
  const isNew = Date.now() - new Date(data.user.created_at).getTime() < SIGNUP_WINDOW_MS
  return sameEmail && isNew
}
