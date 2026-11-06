// One icon family for the website and the student app: 24px grid, 1.75 stroke, round caps and joins.
type P = { size?: number; className?: string };
const base = (size: number) => ({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true });

// The mark: a page with one thumb tab cut into its edge.
export function Mark({ size = 30 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <defs><linearGradient id="rt-mark" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#0f766e" /><stop offset="1" stopColor="#0e7490" /></linearGradient></defs>
    <rect x="2" y="3" width="23" height="26" rx="7" fill="url(#rt-mark)" />
    <path d="M25 9h2.5a2.5 2.5 0 0 1 2.5 2.5v3a2.5 2.5 0 0 1-2.5 2.5H25z" fill="#5eead4" />
    <path d="M8 11h9M8 16h7M8 21h5" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
  </svg>;
}
export const ArrowRight = ({ size = 18, className }: P) => <svg {...base(size)} className={className}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
export const Check = ({ size = 16, className }: P) => <svg {...base(size)} className={className} strokeWidth={2.25}><path d="M5 12.5 10 17l9-10" /></svg>;
export const Cross = ({ size = 16, className }: P) => <svg {...base(size)} className={className} strokeWidth={2.25}><path d="M6 6l12 12M18 6 6 18" /></svg>;
export const Plus = ({ size = 20, className }: P) => <svg {...base(size)} className={className}><path d="M12 5v14M5 12h14" /></svg>;
export const Chat = ({ size = 22, className }: P) => <svg {...base(size)} className={className}><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4h0A2.5 2.5 0 0 1 4 13.5z" /><path d="M8.5 8.5h7M8.5 11.5h4.5" /></svg>;
export const Collect = ({ size = 22, className }: P) => <svg {...base(size)} className={className}><path d="M4 7.5h16v11A2.5 2.5 0 0 1 17.5 21h-11A2.5 2.5 0 0 1 4 18.5z" /><path d="M3 4h18v3.5H3zM10 12h4" /></svg>;
export const Layers = ({ size = 22, className }: P) => <svg {...base(size)} className={className}><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 13 9 5 9-5" /></svg>;
export const Shield = ({ size = 22, className }: P) => <svg {...base(size)} className={className}><path d="M12 3 5 6v5.5c0 4.4 3 8 7 9.5 4-1.5 7-5.1 7-9.5V6z" /><path d="m9 12 2.2 2.2L15.5 10" /></svg>;
export const Phone = ({ size = 22, className }: P) => <svg {...base(size)} className={className}><rect x="6.5" y="2.5" width="11" height="19" rx="2.5" /><path d="M10.5 18.5h3" /></svg>;
export const Target = ({ size = 22, className }: P) => <svg {...base(size)} className={className}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r=".8" fill="currentColor" /></svg>;
export const Clock = ({ size = 22, className }: P) => <svg {...base(size)} className={className}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>;
export const Book = ({ size = 22, className }: P) => <svg {...base(size)} className={className}><path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z" /><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19M9 7.5h6" /></svg>;
export const Repeat = ({ size = 22, className }: P) => <svg {...base(size)} className={className}><path d="M17 2.5 20.5 6 17 9.5" /><path d="M3.5 11.5V10A4 4 0 0 1 7.5 6h13M7 21.5 3.5 18 7 14.5" /><path d="M20.5 12.5V14a4 4 0 0 1-4 4h-13" /></svg>;
export const Spark = ({ size = 14, className }: P) => <svg {...base(size)} className={className} strokeWidth={2}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" /></svg>;
export const Calendar = ({ size = 14, className }: P) => <svg {...base(size)} className={className} strokeWidth={2}><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>;
