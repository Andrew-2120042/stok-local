import SellerAuthForm from '../SellerAuthForm'
import { AuthShell } from '../AuthShell'

export default function SellerSignupPage() {
  return <AuthShell subtitle="Become a seller"><SellerAuthForm initialMode="signup" /></AuthShell>
}
