/** The accounts of demo mode, in the order they are created (the first is admin). */
export interface DemoAccount {
  email: string
  name: string
  /** One short line for the sign-in screen. */
  description: string
}

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  { email: 'sam@example.com', name: 'Sam Rivera', description: 'freelance web designer' },
  { email: 'morgan@example.com', name: 'Morgan Rivera', description: "teacher, Sam's partner" },
  { email: 'new@example.com', name: 'New user', description: 'empty account' },
]

export function demoAccount(email: string): DemoAccount | undefined {
  const wanted = email.trim().toLowerCase()
  return DEMO_ACCOUNTS.find((a) => a.email === wanted)
}
