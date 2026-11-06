import { AuthShell } from '@/components/auth/auth-shell';
import { SignInForm } from '@/components/auth/forms';
import { googleEnabled } from '@/lib/auth/providers';
// Read at request time, so turning Google sign-in on or off needs no rebuild.
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sign in' };
export default function SignInPage() { return <AuthShell title="Welcome back." description="Sign in to continue your preparation and pick up where you left off."><SignInForm google={googleEnabled()} /></AuthShell>; }
