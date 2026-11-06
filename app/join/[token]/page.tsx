import Link from 'next/link';
import {getCurrentActor} from '@/lib/auth/session';
import {getDatabase} from '@/lib/db/client';
import {inviteByToken} from '@/lib/services/partners';
import {ClaimButton} from '@/components/partner/forms';
import '@/app/studio/shell.css';
import '@/app/studio/studio.css';
import '@/app/partner/partner.css';
export const metadata={title:'Claim your seat',robots:{index:false,follow:false}};
export const dynamic='force-dynamic';
// PART-3 invite link: the student signs in (or creates an account), then claims one seat from the link.
export default async function JoinPage(props:{params:Promise<{token:string}>}) {
 const {token}=await props.params;
 const [invite,actor]=await Promise.all([inviteByToken(getDatabase(),token),getCurrentActor()]);
 const next=encodeURIComponent(`/join/${token}`);
 let body:React.ReactNode;
 if(!invite)body=<><h1>This link does not work</h1><p>Check that you copied the whole link, or ask your course provider for a new one.</p></>;
 else if(!invite.usable)body=<><h1>This link is closed</h1><p>{invite.revoked?'Your course provider has turned this link off.':invite.expired?'This link has expired.':invite.used>=invite.cap?'All seats on this link have been taken.':'This course provider cannot assign seats right now.'} Ask {invite.org} for a new link.</p></>;
 else body=<>
  <h1>{invite.org} has a seat for you</h1>
  <p>{invite.months} months of the {invite.exam} question bank on Recalls Tutor, starting when you claim it.</p>
  {!actor?<><p>Sign in, or create a free account, to claim it.</p><p className="partner-row-actions"><Link className="studio-button" href={`/sign-up?next=${next}`}>Create an account</Link><Link className="studio-button studio-button-secondary" href={`/sign-in?next=${next}`}>Sign in</Link></p></>
   :!actor.emailVerified?<p>Verify your email address first (check your inbox), then open this link again.</p>
   :actor.suspended?<p>This account is suspended. Contact support.</p>
   :<><p>Claiming as {actor.email}.</p><ClaimButton token={token}/></>}
 </>;
 // White-label: the partner's logo and colour, when set; Recalls Tutor stays named as the platform.
 const brand=invite?.color?{['--accent' as string]:invite.color,borderTopColor:invite.color}:undefined;
 return <div className="app studio-shell" style={{display:'block'}}><main id="main" className="app-canvas" style={{padding:'64px 16px'}}><div className="join-card" style={brand}>{invite?.logo&&<img className="join-logo" src={invite.logo} alt={invite.org} height={40}/>}{body}<p className="join-platform">Practice on Recalls Tutor</p></div></main></div>;
}
