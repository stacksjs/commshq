/**
 * The setup page: which steps a workspace has done, read from the API.
 *
 * This page was the `onboarding` area of `WorkspaceSurface`. It told every
 * account that setup was 63% complete, 5 of 8 steps, with a verified domain
 * and 1,248 imported contacts, whether or not any of it was true.
 *
 * `GET /api/v1/workspace/setup` answers yes or no for each step from the
 * workspace's own tables, and this module turns that into the list. A step
 * is shown as done only when the server says so. The steps are in the order
 * the work depends on, and the first one not done is marked as next.
 *
 * ## What the page does not show
 *
 * No time estimates and no "sender health". And no consent checklist: the
 * mock listed double opt-in, SMS consent and quiet hours as switches that
 * were "On". They are how the application behaves, not settings a workspace
 * turns on, so there is nothing to tick.
 */
export const SETUP_ENDPOINT = '/api/v1/workspace/setup'

const DASHBOARD = '/dashboard/commshq'

/**
 * The steps, in order, with where each one is done.
 *
 * The keys are the ones `app/Support/workspaceSetup.ts` answers for; a test
 * holds the two lists together, so a step cannot be added on one side only.
 */
export const SETUP_STEPS = [
  { key: 'contacts', title: 'Add your first contacts', detail: 'The people you write to. Add them one at a time on the Contacts page.', href: `${DASHBOARD}/audience`, action: 'Open Contacts' },
  { key: 'audience', title: 'Create an audience', detail: 'A named group of contacts, such as the readers of one newsletter. A campaign is sent to one.', href: `${DASHBOARD}/segments`, action: 'Open Segments' },
  { key: 'domain', title: 'Verify a sending domain', detail: 'Publish one DNS record to prove you control the domain your email comes from. Email is not delivered until one is verified.', href: `${DASHBOARD}/domains`, action: 'Open Domains' },
  { key: 'sender', title: 'Add a sender', detail: 'The name and address people see in their inbox, at your verified domain.', href: `${DASHBOARD}/senders`, action: 'Open Senders' },
  { key: 'campaign', title: 'Write a campaign', detail: 'An email or SMS, saved as a draft until you send it.', href: `${DASHBOARD}/campaigns`, action: 'Open Campaigns' },
  { key: 'sent', title: 'Send a campaign', detail: 'Send a draft to an audience. Each recipient is checked for consent first.', href: `${DASHBOARD}/campaigns`, action: 'Open Campaigns' },
  { key: 'form', title: 'Activate a signup form', detail: 'A form your site posts signups to. It records consent for each contact it creates.', href: `${DASHBOARD}/forms`, action: 'Open Forms' },
  { key: 'teammate', title: 'Invite a teammate', detail: 'Bring in someone else, with a role that fits what they do.', href: `${DASHBOARD}/teams`, action: 'Open Team' },
] as const

export interface SetupStepView {
  key: string
  number: number
  title: string
  detail: string
  href: string
  action: string
  done: boolean
  /** The first step that is not done. */
  next: boolean
  stateLabel: string
}

export interface SetupView {
  steps: SetupStepView[]
  doneCount: number
  total: number
  complete: boolean
  summary: string
  /** 0 to 100, for the progress bar's width. */
  percent: number
}

/**
 * Turn the server's answers into the list.
 *
 * Only a literal `true` counts as done. A missing key, a null or a string
 * all read as not done: a step the server did not vouch for is not shown as
 * finished.
 */
export function toSetupView(body: { data?: { steps?: Record<string, unknown> | null } | null } | null | undefined): SetupView {
  const answers = body?.data?.steps ?? {}
  const firstOpen = SETUP_STEPS.findIndex(step => answers[step.key] !== true)

  const steps = SETUP_STEPS.map((step, index) => {
    const done = answers[step.key] === true
    const next = index === firstOpen
    return {
      key: step.key,
      number: index + 1,
      title: step.title,
      detail: step.detail,
      href: step.href,
      action: step.action,
      done,
      next,
      stateLabel: done ? 'Done' : (next ? 'Next' : 'To do'),
    }
  })

  const doneCount = steps.filter(step => step.done).length
  const total = steps.length
  return {
    steps,
    doneCount,
    total,
    complete: doneCount === total,
    summary: doneCount === total ? `All ${total} steps are done.` : `${doneCount} of ${total} steps done.`,
    percent: Math.round((doneCount / total) * 100),
  }
}

/** What to tell someone when the answers could not be read. */
export function setupErrorMessage(status: number): string {
  if (status === 401)
    return 'Your session has ended. Sign in again to see your setup.'
  if (status === 403)
    return 'This account is not an active member of a workspace, so there is no setup to show.'
  if (status === 429)
    return 'Too many requests just now. Wait a moment and try again.'
  if (status >= 500)
    return 'Setup could not be loaded because the API is not answering.'
  return `Setup could not be loaded (${status}).`
}
