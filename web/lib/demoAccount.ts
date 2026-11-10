// Optional demo account for showing premium features without signing up
// live. When both NEXT_PUBLIC_DEMO_EMAIL and NEXT_PUBLIC_DEMO_PASSWORD are
// set, /login pre-fills them and /signup offers a link to that pre-filled
// login. Both values ship in the client bundle, so only point them at a
// throwaway test-mode account, and unset them to turn the feature off.
// NEXT_PUBLIC_ vars are inlined at build time, so they must be referenced
// statically here (not via a computed key).
const demoEmail = process.env.NEXT_PUBLIC_DEMO_EMAIL;
const demoPassword = process.env.NEXT_PUBLIC_DEMO_PASSWORD;

export const DEMO_ACCOUNT: { email: string; password: string } | null =
  demoEmail && demoPassword ? { email: demoEmail, password: demoPassword } : null;
