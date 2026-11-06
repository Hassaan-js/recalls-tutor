import Link from 'next/link';
import { AuthShell } from '@/components/auth/auth-shell';
import { VerificationForm } from '@/components/auth/forms';
import { getCurrentActor } from '@/lib/auth/session';
export const metadata = { title: 'Verify your email' };
export default async function VerifyEmailPage() {
  const actor = await getCurrentActor();
  return <AuthShell title="Check your inbox." description="Verify your email address to finish setting up your account.">{actor?.emailVerified ? <><p className="auth-message">Your email is verified.</p><Link className="auth-submit" href="/dashboard">Continue to dashboard →</Link></> : <><VerificationForm /><p className="auth-switch"><Link href="/sign-in">Back to sign in</Link></p></>}</AuthShell>;
}
