import {redirect} from 'next/navigation';
import {getCurrentActor} from '@/lib/auth/session';
import {ConfirmPayment} from '@/components/billing/confirm';
import {StudentShell} from '@/components/practice/shell';
import '../../seo.css';
export const metadata={title:'Confirming payment',robots:{index:false}};
export const dynamic='force-dynamic';
export default async function ConfirmPage(props:PageProps<'/billing/confirm'>) {
 const actor=await getCurrentActor();if(!actor)redirect('/sign-in?next=/account/plans');
 const {session_id:sessionId}=await props.searchParams;
 return <StudentShell active="plans" title="Checkout" actor={actor}><div className="app-column billing-confirm"><ConfirmPayment sessionId={typeof sessionId==='string'?sessionId:''}/></div></StudentShell>;
}
