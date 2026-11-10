/**
 * The dashboard's navigation, declared once.
 *
 * Every page under `/dashboard/commshq` is reached from here, and the shell
 * layout renders this list rather than hand-writing a second copy of it. That
 * matters for more than tidiness: the layout marks the current row by matching
 * `requestContext.path()` against `href`, so a page that is not in this list is
 * a page the sidebar can never highlight, and one whose `href` drifts is a row
 * that highlights nothing while still linking correctly. Both failures look
 * like a styling bug and are not.
 *
 * Navigation only. What each page renders is the page's own business and is
 * declared there, including the `area` the sixteen `<WorkspaceSurface>` pages
 * pass; restating it here would be a second copy with no reader.
 */

/** Where the dashboard is mounted. Links are built from this, never typed out. */
export const DASHBOARD_ROOT = '/dashboard/commshq'

export interface DashboardLink {
  /** Stable id, also the path segment under {@link DASHBOARD_ROOT}. */
  id: string
  label: string
  /** An Iconify class from the hugeicons collection the rest of the app uses. */
  icon: string
  href: string
}

export interface DashboardSection {
  id: string
  label: string
  items: DashboardLink[]
}

/** Build a link, so no href is ever spelled out by hand. */
function link(id: string, label: string, icon: string): DashboardLink {
  return { id, label, icon, href: id === 'index' ? DASHBOARD_ROOT : `${DASHBOARD_ROOT}/${id}` }
}

export const dashboardSections: DashboardSection[] = [
  {
    id: 'overview',
    label: 'Overview',
    items: [
      link('index', 'Command center', 'i-hugeicons-layout-grid'),
      link('analytics', 'Analytics', 'i-hugeicons-chart-line-data-02'),
    ],
  },
  {
    id: 'audience',
    label: 'Audience',
    items: [
      link('audience', 'Contacts', 'i-hugeicons-user-multiple-02'),
      link('segments', 'Segments', 'i-hugeicons-filter-horizontal'),
    ],
  },
  {
    id: 'messaging',
    label: 'Messaging',
    items: [
      link('campaigns', 'Campaigns', 'i-hugeicons-megaphone-02'),
      link('editor', 'Message studio', 'i-hugeicons-edit-02'),
      link('automations', 'Automations', 'i-hugeicons-workflow-square-06'),
    ],
  },
  {
    id: 'publishing',
    label: 'Publishing',
    items: [
      link('publications', 'Publications', 'i-hugeicons-news-01'),
      link('sites', 'Sites', 'i-hugeicons-web-design-02'),
      link('forms', 'Forms and pages', 'i-hugeicons-form'),
    ],
  },
  {
    id: 'revenue',
    label: 'Revenue',
    items: [
      link('monetization', 'Monetization', 'i-hugeicons-coins-dollar'),
      link('commerce', 'Commerce', 'i-hugeicons-shopping-bag-02'),
      link('reputation', 'Reputation', 'i-hugeicons-star'),
    ],
  },
  {
    id: 'delivery',
    label: 'Delivery',
    items: [
      link('senders', 'Senders', 'i-hugeicons-mail-validation-01'),
      link('domains', 'Domains', 'i-hugeicons-global'),
    ],
  },
  {
    id: 'workspace',
    label: 'Workspace',
    items: [
      link('onboarding', 'Setup', 'i-hugeicons-rocket-02'),
      link('teams', 'Team', 'i-hugeicons-user-group'),
      link('integrations', 'Integrations', 'i-hugeicons-plug-socket'),
      link('billing', 'Billing', 'i-hugeicons-credit-card'),
      link('settings', 'Settings', 'i-hugeicons-settings-02'),
    ],
  },
]

/** Every link, flat, in sidebar order. */
export const dashboardLinks: DashboardLink[] = dashboardSections.flatMap(section => section.items)

/**
 * The link a path belongs to, for marking the current row.
 *
 * Longest href first, so `/dashboard/commshq/audience` wins over the root
 * `/dashboard/commshq` instead of both matching by prefix. A trailing slash is
 * the same page, which is what `replace` below is for.
 */
export function dashboardLinkFor(pathname: string): DashboardLink | undefined {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  return [...dashboardLinks]
    .sort((a, b) => b.href.length - a.href.length)
    .find(item => path === item.href || path.startsWith(`${item.href}/`))
}
