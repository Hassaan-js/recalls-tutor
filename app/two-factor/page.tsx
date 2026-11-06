import { AuthShell } from '@/components/auth/auth-shell';
import { TwoFactorForm } from '@/components/auth/forms';
export const metadata = { title: 'Verify your sign in' };
export default function TwoFactorPage() { return <AuthShell title="One more step." description="Confirm it’s you to securely continue to your account."><TwoFactorForm /></AuthShell>; }
