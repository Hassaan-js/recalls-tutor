import { AuthShell } from '@/components/auth/auth-shell';
import { ForgotPasswordForm } from '@/components/auth/forms';
export const metadata = { title: 'Reset your password' };
export default function ForgotPasswordPage() { return <AuthShell title="Let’s get you back in." description="Enter the email address you use for Recalls Tutor. We’ll help you reset your password."><ForgotPasswordForm /></AuthShell>; }
