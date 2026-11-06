import { AuthShell } from '@/components/auth/auth-shell';
import { ResetPasswordForm } from '@/components/auth/forms';
export const metadata = { title: 'Choose a new password', robots: { index: false, follow: false }, referrer: 'no-referrer' as const };
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  return <AuthShell title="A fresh start." description="Choose a strong password that you haven’t used for another account."><ResetPasswordForm token={typeof token === 'string' ? token : undefined} /></AuthShell>;
}
