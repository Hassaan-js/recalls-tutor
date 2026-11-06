// Google sign-in (AUTH-1) is on only when both credentials are configured, so a missing key never shows a broken button.
export function googleCredentials() {
 const clientId=process.env.GOOGLE_CLIENT_ID,clientSecret=process.env.GOOGLE_CLIENT_SECRET;
 return clientId&&clientSecret?{clientId,clientSecret}:null;
}
export const googleEnabled=()=>googleCredentials()!==null;
