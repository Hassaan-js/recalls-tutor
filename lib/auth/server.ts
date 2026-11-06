import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { isSuspendedAuthUser } from '../services/protection';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { twoFactor } from 'better-auth/plugins';
import { randomUUID } from 'node:crypto';
import { getDatabase, type Database } from '../db/client';
import * as schema from '../db/auth-schema';
import { sendAuthMail, type AuthMail } from './mail';
import { googleCredentials } from './providers';

export function createAuth(db:Database, options:{secret:string;baseURL:string;sendMail:(mail:AuthMail)=>Promise<void>;rateLimit?:boolean}) {
 if (options.secret.length<32) throw new Error('BETTER_AUTH_SECRET must contain at least 32 characters.');
 return betterAuth({
  appName:'Recalls Tutor', baseURL:options.baseURL, secret:options.secret,
  trustedOrigins:[new URL(options.baseURL).origin],
  database:drizzleAdapter(db.authOrm,{provider:'pg',schema,transaction:true}),
  emailAndPassword:{enabled:true,minPasswordLength:12,maxPasswordLength:128,requireEmailVerification:true,
   revokeSessionsOnPasswordReset:true,
   async sendResetPassword({user,url}) {await options.sendMail({to:user.email,subject:'Reset your Recalls Tutor password',text:`Reset your password using this link:\n${url}\nIf you did not request this, ignore this email.`});},
  },
  emailVerification:{sendOnSignUp:true,sendOnSignIn:true,autoSignInAfterVerification:false,
   async sendVerificationEmail({user,url}) {await options.sendMail({to:user.email,subject:'Verify your Recalls Tutor email',text:`Verify your email address using this link:\n${url}`});},
  },
  // AUTH-3: a new address takes effect only after the link sent to it is opened.
  user:{changeEmail:{enabled:true}},
  ...(googleCredentials()?{socialProviders:{google:{...googleCredentials()!,prompt:'select_account' as const}}}:{}),
  session:{expiresIn:60*60*24*7,updateAge:60*60*24,cookieCache:{enabled:false}},
  rateLimit:{enabled:options.rateLimit??true,storage:'database',window:60,max:100,
   customRules:{'/sign-in/email':{window:60,max:10},'/sign-up/email':{window:60,max:5},'/request-password-reset':{window:60,max:5},'/send-verification-email':{window:60,max:5}},
  },
  // Better Auth skips origin checks when NODE_ENV=test; keep CSRF protection on in every environment.
  advanced:{database:{generateId:()=>randomUUID()},cookiePrefix:'recalls',disableOriginCheck:false},
  // PROT-5: a suspended account cannot start a new session.
  databaseHooks:{session:{create:{async before(session){
   if(await isSuspendedAuthUser(db,session.userId))throw new APIError('FORBIDDEN',{message:'This account is suspended. Contact support if you think this is a mistake.'});
  }}}},
  plugins:[twoFactor({issuer:'Recalls Tutor'})],
  telemetry:{enabled:false},
 });
}
let authInstance:ReturnType<typeof createAuth>|undefined;
export function getAuth() {
 if (authInstance) return authInstance;
 const secret=process.env.BETTER_AUTH_SECRET,baseURL=process.env.BETTER_AUTH_URL;
 if (!secret || !baseURL) throw new Error('Authentication is not configured.');
 if (process.env.NODE_ENV==='production' && (!baseURL.startsWith('https://') || !process.env.RESEND_API_KEY || !process.env.AUTH_EMAIL_FROM)) throw new Error('Production authentication requires HTTPS and email delivery.');
 authInstance=createAuth(getDatabase(),{secret,baseURL,sendMail:sendAuthMail});
 return authInstance;
}
