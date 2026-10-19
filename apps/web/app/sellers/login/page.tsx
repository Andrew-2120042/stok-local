import SellerAuthForm from '../SellerAuthForm'
import { AuthShell } from '../AuthShell'

export default function SellerLoginPage() {
  return <AuthShell subtitle="Seller Portal"><SellerAuthForm initialMode="login" /></AuthShell>
}
