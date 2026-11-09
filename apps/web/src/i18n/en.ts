/** English is the source of truth; every other language must provide the same keys. */
export const en = {
  // App
  'app.loading': 'Loading…',
  'app.noConnection': 'No connection to the server.',
  'app.unknownError': 'Something went wrong ({code}).',

  // Auth
  'auth.welcomeFirst': 'Welcome. Create the first account on this server.',
  'auth.createAccount': 'Create an account.',
  'auth.signInPrompt': 'Sign in to continue.',
  'auth.email': 'Email address',
  'auth.password': 'Password',
  'auth.register': 'Create account',
  'auth.signIn': 'Sign in',
  'auth.toRegister': 'No account yet? Register',
  'auth.toSignIn': 'Already have an account? Sign in',
  'auth.error.invalid_credentials': 'Email address or password is incorrect.',
  'auth.error.email_taken': 'An account with this email address already exists.',
  'auth.error.registration_closed': 'Registration is closed on this server.',
  'auth.error.too_many_attempts': 'Too many attempts. Try again in fifteen minutes.',
  'auth.error.invalid_body': 'Check the email address and use a password of at least 8 characters.',

  // Lists
  'list.inbox': 'Inbox',
  'list.today': 'Today',
  'list.upcoming': 'Upcoming',
  'list.someday': 'Someday',
  'list.logbook': 'Logbook',
  'list.anytime': 'Anytime',
  'list.thisEvening': 'This Evening',
  'list.empty.inbox': 'Your Inbox is empty.',
  'list.empty.today': 'Nothing planned for today.',
  'list.empty.upcoming': 'Nothing planned.',
  'list.empty.someday': 'Nothing for someday.',
  'list.empty.logbook': 'Nothing completed yet.',
  'nav.lists': 'Lists',
  'nav.account': 'Account',

  // Sync
  'sync.idle': 'Synced',
  'sync.syncing': 'Syncing…',
  'sync.offline': 'Offline, changes are queued',
  'sync.unauthorized': 'Signed out',

  // Tasks
  'task.new': 'New task',
  'task.untitled': 'Untitled',
  'task.title': 'Title',
  'task.notes': 'Notes',
  'task.markDone': 'Mark as done',
  'task.markOpen': 'Mark as open',
  'task.delete': 'Delete',
  'task.done': 'Done',

  // When
  'when.label': 'When',
  'when.inbox': 'Inbox',
  'when.today': 'Today',
  'when.thisEvening': 'This Evening',
  'when.tomorrow': 'Tomorrow',
  'when.someday': 'Someday',
  'when.anytime': 'Anytime',
  'when.pickDate': 'Pick a date',
  'date.today': 'today',
  'date.tomorrow': 'tomorrow',

  // Account
  'account.title': 'Account',
  'account.signOut': 'Sign out',
  'account.signedInAs': 'Signed in as {email} at {app}.',
  'account.language': 'Language',
  'account.language.system': 'Follow the browser',
  'account.tokens': 'API tokens',
  'account.tokens.intro': 'For Claude, the MCP server and future apps. A token is shown only once.',
  'account.tokens.namePlaceholder': 'Name, e.g. Claude on the Mac',
  'account.tokens.create': 'Create token',
  'account.tokens.reveal': 'Token for {name}. Copy it now; it will not be shown again.',
  'account.tokens.hide': 'Copied, hide',
  'account.tokens.none': 'No tokens yet.',
  'account.tokens.lastUsed': 'last used {date}',
  'account.tokens.unused': 'not used yet',
  'account.tokens.revoke': 'Revoke',
} as const

export type MessageKey = keyof typeof en
export type Messages = Record<MessageKey, string>
