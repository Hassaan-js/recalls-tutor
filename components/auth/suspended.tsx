// Suspension also ends every session, so this only shows if a page loads while the account is being suspended.
export function SuspendedNotice() {
 return <main id="main" className="wrap practice-page"><h1>This account is suspended.</h1><p className="practice-help" role="alert">Practice and account features are unavailable. Contact support if you think this is a mistake.</p></main>;
}
