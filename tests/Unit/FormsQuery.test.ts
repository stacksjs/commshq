/**
 * The forms list, the rows it turns into, and the create body.
 *
 * Two things here are load-bearing. A new form is always a draft, because an
 * active form answers on a public endpoint the moment it exists. And the
 * public address is shown only for an active form, by its uuid, never by its
 * sequential id.
 */
import { describe, expect, test } from 'bun:test'
import {
  draftError,
  FORM_KINDS,
  FORM_NAME_MAX,
  FORM_SLUG_MAX,
  formPayload,
  FORMS_ENDPOINT,
  FORMS_PER_PAGE,
  formsUrl,
  formUrl,
  kindLabel,
  listErrorMessage,
  readDocument,
  saveErrorMessage,
  slugFor,
  STARTER_DOCUMENT,
  statusLabel,
  submitPath,
  toFormView,
  toFormViews,
} from '../../resources/data/forms-query'
import { parseFormSettings } from '../../app/Support/formSettings'

function params(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url, 'https://commshq.org').searchParams.entries())
}

describe('the requests', () => {
  test('it lists from the endpoint the model publishes, by name then id', () => {
    // The unique index is on the slug, so two forms can share a name and the
    // id is what keeps a row on one page.
    expect(FORMS_ENDPOINT).toBe('/api/v1/forms')
    expect(params(formsUrl())).toEqual({ per_page: String(FORMS_PER_PAGE), sort: 'name,id' })
  })

  test('status is an equality filter, and an empty one is not sent', () => {
    expect(params(formsUrl({ status: 'active', page: 2 }))).toMatchObject({ status: 'active', page: '2' })
    expect(params(formsUrl({ status: '' }))).not.toHaveProperty('status')
  })

  test('one form is addressed by its id for a status change', () => {
    expect(formUrl(12)).toBe('/api/v1/forms/12')
  })
})

describe('the public address', () => {
  test('it is the route routes/public.ts registers, keyed by uuid', () => {
    expect(submitPath('6bc2b588-f818-4d4a-9b8d-fe102802cf6b')).toBe('/forms/6bc2b588-f818-4d4a-9b8d-fe102802cf6b/submit')
    expect(submitPath(null)).toBe('')
  })

  test('only an active form shows one', () => {
    const row = { id: 4, uuid: 'abc-123', name: 'Newsletter', status: 'active' }
    expect(toFormView(row).submitPath).toBe('/forms/abc-123/submit')
    // SubscribeAction only finds active forms. The address of a draft would
    // answer "not found" and read as a bug.
    expect(toFormView({ ...row, status: 'draft' }).submitPath).toBe('')
    expect(toFormView({ ...row, status: 'archived' }).submitPath).toBe('')
  })

  test('the sequential id never appears in it', () => {
    expect(toFormView({ id: 4, uuid: 'abc-123', status: 'active' }).submitPath).not.toContain('/4/')
  })
})

describe('suggesting an address from a name', () => {
  test('it produces the shape the model validates', () => {
    expect(slugFor('Newsletter Signup')).toBe('newsletter-signup')
    expect(slugFor('  Spring 2027: Waitlist!  ')).toBe('spring-2027-waitlist')
    expect(slugFor('Café Updates')).toBe('cafe-updates')
    expect(slugFor('---')).toBe('')
  })

  test('it never exceeds the limit or ends on a hyphen', () => {
    const slug = slugFor(`${'a'.repeat(FORM_SLUG_MAX - 1)} b`)
    expect(slug.length).toBeLessThanOrEqual(FORM_SLUG_MAX)
    expect(slug.endsWith('-')).toBe(false)
  })
})

describe('reading a form’s document', () => {
  test('it counts fields and allowed sites', () => {
    const doc = { fields: [{ name: 'email' }, { name: 'firstName' }], allowedOrigins: ['https://example.com/page', 'https://example.com', 'ftp://nope', 'not a url'] }
    expect(readDocument(JSON.stringify(doc))).toEqual({ fieldCount: 2, allowedOrigins: 1 })
  })

  test('it agrees with the server’s parser about which sites are allowed', () => {
    // SubscribeAction decides with parseFormSettings. If this page counted
    // origins differently it would describe a form the server does not run.
    for (const origins of [[], ['https://a.example'], ['https://a.example/x', 'http://a.example', 'https://b.example:8443', 'javascript:alert(1)', 42]]) {
      const doc = JSON.stringify({ allowedOrigins: origins })
      expect(readDocument(doc).allowedOrigins).toBe(parseFormSettings(doc).allowedOrigins.length)
    }
  })

  test('a malformed or missing document is no fields and any site', () => {
    for (const doc of ['not json', '[]', null, undefined, 7])
      expect(readDocument(doc)).toEqual({ fieldCount: 0, allowedOrigins: 0 })
  })
})

describe('normalizing rows', () => {
  const row = { id: 4, uuid: 'abc-123', name: 'Newsletter signup', slug: 'newsletter-signup', kind: 'inline', schema_document: STARTER_DOCUMENT, double_opt_in: 1, status: 'active', updated_at: '2026-11-10T16:13:49.511Z' }

  test('a form reads as what it is', () => {
    const view = toFormView(row, 'en-US')
    expect(view.kindLabel).toBe('Inline form')
    expect(view.statusLabel).toBe('Active')
    expect(view.optInLabel).toBe('Double opt-in')
    expect(view.fieldsLabel).toBe('1 field')
    expect(view.originsLabel).toBe('Any site may post to it')
  })

  test('single opt-in and restricted sites are stated', () => {
    const view = toFormView({ ...row, double_opt_in: 0, schema_document: JSON.stringify({ fields: [], allowedOrigins: ['https://a.example', 'https://b.example'] }) }, 'en-US')
    expect(view.optInLabel).toBe('Single opt-in')
    expect(view.fieldsLabel).toBe('0 fields')
    expect(view.originsLabel).toBe('2 allowed sites')
  })

  test('labels fall back to the raw value rather than hiding it', () => {
    expect(FORM_KINDS.map(item => item.value)).toEqual(['inline', 'popup', 'landing_page', 'gated_resource'])
    expect(kindLabel('quiz')).toBe('Quiz')
    expect(statusLabel(null)).toBe('Unknown')
    expect(toFormView({ id: 9 }).name).toBe('Form 9')
    expect(toFormViews(null)).toEqual([])
  })
})

describe('creating a form', () => {
  test('the name and address must fit the model', () => {
    expect(draftError({ name: 'A' })).toContain('at least 2')
    expect(draftError({ name: 'x'.repeat(FORM_NAME_MAX + 1) })).toContain(String(FORM_NAME_MAX))
    expect(draftError({ name: 'Newsletter', slug: 'Has Spaces' })).toContain('lowercase letters')
    expect(draftError({ name: '!!!' })).toContain('address')
    expect(draftError({ name: 'Newsletter' })).toBe('')
  })

  test('it is always created as a draft', () => {
    // An active form answers on the public endpoint the instant it exists.
    const body = formPayload({ name: ' Newsletter signup ', kind: 'popup' })
    expect(body).toEqual({ name: 'Newsletter signup', slug: 'newsletter-signup', kind: 'popup', schema_document: STARTER_DOCUMENT, double_opt_in: true, status: 'draft' })
    expect(formPayload({ name: 'X', status: 'active' } as never).status).toBe('draft')
  })

  test('double opt-in is on unless explicitly turned off', () => {
    expect(formPayload({ name: 'Newsletter' }).double_opt_in).toBe(true)
    expect(formPayload({ name: 'Newsletter', doubleOptIn: false }).double_opt_in).toBe(false)
  })

  test('a typed address wins over the suggested one, and an unknown kind is inline', () => {
    const body = formPayload({ name: 'Newsletter', slug: 'weekly', kind: 'quiz' })
    expect(body.slug).toBe('weekly')
    expect(body.kind).toBe('inline')
  })

  test('the starter document is one required email field', () => {
    expect(JSON.parse(STARTER_DOCUMENT)).toEqual({ fields: [{ name: 'email', type: 'email', required: true }] })
  })
})

describe('explaining a failure', () => {
  test('listing and saving each name what they can', () => {
    expect(listErrorMessage(401)).toContain('Sign in again')
    expect(listErrorMessage(403)).toContain('not an active member')
    expect(saveErrorMessage(409)).toContain('already has a form at that address')
    expect(saveErrorMessage(404)).toContain('no longer exists')
    expect(saveErrorMessage(418)).toContain('418')
  })
})
