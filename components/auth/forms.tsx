'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { authClient } from '@/lib/auth/client';

type ApiResult = { error: { message?: string; code?: string } | null };
function requireSuccess(result: ApiResult) {
  if (result.error) throw new Error(result.error.message || 'We could not complete that request. Please try again.');
}
function useRequest() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(action: () => Promise<void>) {
    setError(''); setBusy(true);
    try { await action(); } catch (error) { setError(error instanceof Error ? error.message : 'Unable to connect. Please try again.'); } finally { setBusy(false); }
  }
  return { busy, error, run };
}
function Message({ error, success }: { error?: string; success?: string }) {
  return <>{error && <p className="auth-message auth-error" role="alert">{error}</p>}{success && <p className="auth-message" role="status">{success}</p>}</>;
}
function Submit({ busy, children }: { busy: boolean; children: React.ReactNode }) {
  return <button className="auth-submit" type="submit" disabled={busy}>{busy ? 'Please wait…' : children}<span aria-hidden="true">→</span></button>;
}
function fields(event: FormEvent<HTMLFormElement>) { event.preventDefault(); return new FormData(event.currentTarget); }
function value(data: FormData, name: string) { return String(data.get(name) || ''); }
function EmailField({ initial = '' }: { initial?: string }) { return <label className="auth-field">Email address<input name="email" type="email" autoComplete="email" required maxLength={254} defaultValue={initial} /></label>; }
function PasswordField({ fresh = false }: { fresh?: boolean }) { return <label className="auth-field">{fresh ? 'Choose a password' : 'Password'}<input name="password" type="password" autoComplete={fresh ? 'new-password' : 'current-password'} required minLength={fresh ? 12 : undefined} maxLength={128} />{fresh && <span className="auth-hint">Use at least 12 characters.</span>}</label>; }

// AUTH-1: Google accounts arrive with a verified email, so they can buy and practise straight away.
function GoogleButton({ label }: { label: string }) {
  const { busy, error, run } = useRequest();
  return <><button className="auth-google" type="button" disabled={busy} onClick={() => void run(async () => {
    const next = new URLSearchParams(window.location.search).get('next');
    requireSuccess(await authClient.signIn.social({ provider: 'google', callbackURL: next && /^\/[a-z0-9/#?=&_-]*$/i.test(next) && !next.startsWith('//') ? next : '/dashboard' }));
  })}><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.6 13.3l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.1 5.3-4.6 7l7.3 5.6c4.3-3.9 7-9.7 7-17.1z"/><path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.6 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.3-5.6c-2 1.4-4.7 2.3-8.6 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>{busy ? 'Opening Google…' : label}</button><Message error={error} /><p className="auth-or"><span>or use your email</span></p></>;
}
export function SignInForm({ google = false }: { google?: boolean }) {
  const { busy, error, run } = useRequest();
  return <>{google && <GoogleButton label="Continue with Google" />}<form method="post" onSubmit={event => { const data = fields(event); void run(async () => {
    const result = await authClient.signIn.email({ email: value(data, 'email').trim(), password: value(data, 'password'), callbackURL: '/dashboard' });
    requireSuccess(result);
    // Return to the page that asked for sign-in (e.g. the plan being bought); only same-site paths are allowed.
    const next = new URLSearchParams(window.location.search).get('next');
    const target = next && /^\/[a-z0-9/#?=&_-]*$/i.test(next) && !next.startsWith('//') ? next : '/dashboard';
    window.location.assign(result.data && 'twoFactorRedirect' in result.data && result.data.twoFactorRedirect ? '/two-factor' : target);
  }); }}><EmailField /><PasswordField /><Link className="auth-inline-link auth-forgot" href="/forgot-password">Forgot your password?</Link><Message error={error} /><Submit busy={busy}>Sign in</Submit></form><p className="auth-switch">New here? <Link href="/sign-up">Create an account</Link></p><p className="auth-small">Still waiting to verify your email? <Link href="/verify-email">Send a new link</Link></p></>;
}

export function SignUpForm({ google = false }: { google?: boolean }) {
  const { busy, error, run } = useRequest();
  const [email, setEmail] = useState('');
  if (email) return <><p className="auth-message" role="status">Check your inbox at <strong>{email}</strong>. Open the verification link before signing in.</p><VerificationForm initialEmail={email} /><p className="auth-switch"><Link href="/sign-in">Back to sign in</Link></p></>;
  return <>{google && <GoogleButton label="Sign up with Google" />}<form method="post" onSubmit={event => { const data = fields(event); void run(async () => {
    const address = value(data, 'email').trim();
    requireSuccess(await authClient.signUp.email({ name: value(data, 'name').trim(), email: address, password: value(data, 'password'), callbackURL: '/dashboard' }));
    setEmail(address);
  }); }}><label className="auth-field">Full name<input name="name" autoComplete="name" required maxLength={100} pattern=".*\S.*" /></label><EmailField /><PasswordField fresh /><p className="auth-small">We’ll send a link to verify your email. Creating an account does not purchase an exam plan.</p><Message error={error} /><Submit busy={busy}>Create account</Submit></form><p className="auth-switch">Already have an account? <Link href="/sign-in">Sign in</Link></p></>;
}

export function ForgotPasswordForm() {
  const { busy, error, run } = useRequest();
  const [sent, setSent] = useState(false);
  return <><form method="post" onSubmit={event => { const data = fields(event); void run(async () => {
    requireSuccess(await authClient.requestPasswordReset({ email: value(data, 'email').trim(), redirectTo: '/reset-password' })); setSent(true);
  }); }}><EmailField /><Message error={error} success={sent ? 'If an account exists for this address, you’ll receive a password reset link. Check your inbox and spam folder.' : undefined} /><Submit busy={busy}>Send reset link</Submit></form><p className="auth-switch"><Link href="/sign-in">Back to sign in</Link></p></>;
}

export function ResetPasswordForm({ token }: { token?: string }) {
  const { busy, error, run } = useRequest();
  const [done, setDone] = useState(false);
  if (!token) return <><p className="auth-message auth-error" role="alert">This reset link is missing or invalid. Request a new link to continue.</p><Link className="auth-inline-link" href="/forgot-password">Request a reset link</Link></>;
  if (done) return <><p className="auth-message" role="status">Your password has been changed. Sign in with your new password.</p><Link className="auth-submit" href="/sign-in">Go to sign in <span aria-hidden="true">→</span></Link></>;
  return <form method="post" onSubmit={event => { const data = fields(event); void run(async () => {
    if (value(data, 'password') !== value(data, 'confirmation')) throw new Error('Your passwords do not match. Please check both fields.');
    requireSuccess(await authClient.resetPassword({ newPassword: value(data, 'password'), token })); setDone(true);
  }); }}><PasswordField fresh /><label className="auth-field">Confirm new password<input name="confirmation" type="password" autoComplete="new-password" required minLength={12} maxLength={128} /></label><Message error={error} /><Submit busy={busy}>Save new password</Submit><p className="auth-small">Link expired? <Link href="/forgot-password">Request another reset link</Link>.</p></form>;
}

export function VerificationForm({ initialEmail = '' }: { initialEmail?: string }) {
  const { busy, error, run } = useRequest();
  const [sent, setSent] = useState(false);
  return <form method="post" onSubmit={event => { const data = fields(event); void run(async () => {
    requireSuccess(await authClient.sendVerificationEmail({ email: value(data, 'email').trim(), callbackURL: '/dashboard' })); setSent(true);
  }); }}><EmailField initial={initialEmail} /><p className="auth-small">Look for a verification email from Recalls Tutor, including in your spam folder. You can request another link below.</p><Message error={error} success={sent ? 'If this address needs verification, a new link has been sent. Please check your inbox.' : undefined} /><Submit busy={busy}>Resend verification link</Submit></form>;
}

export function TwoFactorForm() {
  const { busy, error, run } = useRequest();
  const [recovery, setRecovery] = useState(false);
  return <><form key={String(recovery)} method="post" onSubmit={event => { const data = fields(event); void run(async () => {
    const code = value(data, 'code').trim();
    requireSuccess(recovery ? await authClient.twoFactor.verifyBackupCode({ code }) : await authClient.twoFactor.verifyTotp({ code }));
    window.location.assign('/dashboard');
  }); }}><label className="auth-field">{recovery ? 'Recovery code' : 'Authenticator code'}<input name="code" autoComplete="one-time-code" inputMode={recovery ? 'text' : 'numeric'} pattern={recovery ? undefined : '[0-9]{6}'} minLength={recovery ? undefined : 6} maxLength={recovery ? 100 : 6} required /></label><p className="auth-small">{recovery ? 'Use one of the recovery codes you saved during setup. Each code works once.' : 'Enter the six-digit code from your authenticator app.'}</p><Message error={error} /><Submit busy={busy}>Verify and continue</Submit></form><button className="auth-text-button" type="button" disabled={busy} onClick={() => setRecovery(!recovery)}>{recovery ? 'Use my authenticator instead' : 'Use a recovery code instead'}</button><p className="auth-switch"><Link href="/sign-in">Return to sign in</Link></p></>;
}

export function SecurityForm({ enabled, email }: { enabled: boolean; email: string }) {
  const { busy, error, run } = useRequest();
  const [setup, setSetup] = useState<{ secret: string; codes: string[] } | null>(null);
  const [active, setActive] = useState(enabled);
  const [saved, setSaved] = useState(false);
  return <><p className="auth-account-email">{email}</p><h2 className="auth-section-title">Two-step verification</h2><p className="auth-small">Protect your account with a code from an authenticator app. This is required for Super Admin access.</p>{active ? <><p className="auth-message" role="status">Two-step verification is enabled.</p><Link className="auth-submit" href="/dashboard">Continue to dashboard <span aria-hidden="true">→</span></Link></> : setup ? <><div className="auth-setup"><h3>1. Add your account</h3><p>In your authenticator app, choose to enter a setup key. Use your email as the account name and select a time-based code.</p><span className="auth-hint">Setup key</span><code className="auth-secret">{setup.secret}</code><h3>2. Save your recovery codes</h3><p>Keep these somewhere private, such as your password manager. Each code can be used once if you lose your authenticator.</p><ul className="auth-codes">{setup.codes.map(code => <li key={code}><code>{code}</code></li>)}</ul></div><form method="post" onSubmit={event => { const data = fields(event); void run(async () => {
    requireSuccess(await authClient.twoFactor.verifyTotp({ code: value(data, 'code').trim() })); setActive(true); setSetup(null);
  }); }}><label className="auth-check"><input type="checkbox" checked={saved} onChange={event => setSaved(event.target.checked)} required />I have saved my recovery codes privately.</label><label className="auth-field">3. Enter your authenticator code<input name="code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} required /></label><Message error={error} /><Submit busy={busy}>Activate two-step verification</Submit></form></> : <form method="post" onSubmit={event => { const data = fields(event); void run(async () => {
    const result = await authClient.twoFactor.enable({ password: value(data, 'password'), method: 'totp' }); requireSuccess(result);
    if (!result.data || !('totpURI' in result.data)) throw new Error('Authenticator setup was not returned. Please try again.');
    const secret = new URL(result.data.totpURI).searchParams.get('secret');
    if (!secret) throw new Error('The setup key could not be read. Please try again.');
    setSetup({ secret, codes: result.data.backupCodes });
  }); }}><PasswordField /><Message error={error} /><Submit busy={busy}>Set up authenticator</Submit></form>}</>;
}

export function SignOutButton() {
  const { busy, error, run } = useRequest();
  return <div><button className="auth-text-button" type="button" disabled={busy} onClick={() => void run(async () => { requireSuccess(await authClient.signOut()); window.location.assign('/sign-in'); })}>{busy ? 'Signing out…' : 'Sign out'}</button><Message error={error} /></div>;
}
