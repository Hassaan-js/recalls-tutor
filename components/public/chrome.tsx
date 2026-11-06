'use client';
import {usePathname} from 'next/navigation';
// The student's app screens have their own shell; the public header and footer stay on the website.
const APP=/^\/(practice|account|dashboard|billing|studio|partner|join)(\/|$)/;
export function PublicOnly({children}:{children:React.ReactNode}) {
 return APP.test(usePathname()??'')?null:<>{children}</>;
}
