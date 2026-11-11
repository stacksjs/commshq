/**
 * The message template listing, the rows it turns into, and the create body.
 *
 * The message studio page used to state 34 reusable blocks, 12 templates and
 * 186 draft revisions as fact. What replaces them is read per row, so the
 * cases here are about a row that says little: no blocks, no subject, a
 * document that does not parse. Each must come out as a stated absence.
 */
import { describe, expect, test } from 'bun:test'
import {
  blockCount,
  channelLabel,
  draftError,
  EMPTY_DOCUMENT,
  listErrorMessage,
  saveErrorMessage,
  TEMPLATE_CHANNELS,
  TEMPLATE_NAME_MAX,
  TEMPLATE_SUBJECT_MAX,
  templatePayload,
  TEMPLATES_ENDPOINT,
  TEMPLATES_PER_PAGE,
  templatesUrl,
  toTemplateView,
  toTemplateViews,
} from '../../resources/data/templates-query'

function params(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url, 'https://commshq.org').searchParams.entries())
}

describe('building the listing request', () => {
  test('it asks the endpoint the model publishes, sorted by its unique name', () => {
    expect(TEMPLATES_ENDPOINT).toBe('/api/v1/message-templates')
    expect(params(templatesUrl())).toEqual({ per_page: String(TEMPLATES_PER_PAGE), sort: 'name' })
  })

  test('a channel becomes an equality filter, and an empty one is not sent', () => {
    expect(params(templatesUrl({ channel: 'sms' })).channel).toBe('sms')
    expect(params(templatesUrl({ channel: '' }))).not.toHaveProperty('channel')
  })

  test('paging is clamped and page one is left out', () => {
    expect(params(templatesUrl({ page: 2 })).page).toBe('2')
    expect(params(templatesUrl({ page: 0, perPage: -3 }))).toEqual({ per_page: '1', sort: 'name' })
  })

  test('it sends no search, because the endpoint has nothing to search', () => {
    expect(params(templatesUrl())).not.toHaveProperty('search')
  })
})

describe('counting blocks', () => {
  test('it reads the document as a string or as an object', () => {
    expect(blockCount('{"version":1,"blocks":[{},{}]}')).toBe(2)
    expect(blockCount({ version: 1, blocks: [{}] })).toBe(1)
  })

  test('a document that is empty, malformed or missing has no blocks', () => {
    for (const document of [EMPTY_DOCUMENT, 'not json', '{"blocks":"three"}', null, undefined, 7])
      expect(blockCount(document)).toBe(0)
  })
})

describe('normalizing rows', () => {
  const seeded = { id: 7, name: 'Sunday dispatch', channel: 'email', subject: 'This week', document: EMPTY_DOCUMENT, revision: 1, updated_at: '2026-11-10T16:13:49.511Z' }

  test('a seeded template reads as it is: one revision, no blocks', () => {
    const view = toTemplateView(seeded, 'en-US')
    expect(view.name).toBe('Sunday dispatch')
    expect(view.channelLabel).toBe('Email')
    expect(view.subject).toBe('This week')
    expect(view.contentLabel).toBe('No blocks yet')
    expect(view.revisionLabel).toBe('Revision 1')
    expect(view.updatedLabel).toContain('2026')
  })

  test('blocks are counted with the right noun', () => {
    expect(toTemplateView({ ...seeded, document: '{"blocks":[{}]}' }, 'en-US').contentLabel).toBe('1 block')
    expect(toTemplateView({ ...seeded, document: '{"blocks":[{},{},{}]}' }, 'en-US').contentLabel).toBe('3 blocks')
  })

  test('a missing subject, name or revision is a placeholder, not a guess', () => {
    const view = toTemplateView({ id: 9, channel: 'sms' }, 'en-US')
    expect(view.subject).toBe('-')
    expect(view.name).toBe('Template 9')
    expect(view.revisionLabel).toBe('Revision 1')
    expect(view.updatedLabel).toBe('-')
  })

  test('channels are named in words, and an unknown one stays visible', () => {
    expect(TEMPLATE_CHANNELS.map(item => item.value)).toEqual(['email', 'sms', 'landing_page'])
    expect(channelLabel('landing_page')).toBe('Landing page')
    expect(channelLabel('push')).toBe('push')
    expect(channelLabel(null)).toBe('Unknown')
  })

  test('a body with no rows is an empty list', () => {
    expect(toTemplateViews(null)).toEqual([])
    expect(toTemplateViews({ data: [seeded] })).toHaveLength(1)
  })
})

describe('creating a template', () => {
  test('a name is required, within the limits the model declares', () => {
    expect(draftError({ name: ' ' })).toContain('needs a name')
    expect(draftError({ name: 'x'.repeat(TEMPLATE_NAME_MAX) })).toBe('')
    expect(draftError({ name: 'x'.repeat(TEMPLATE_NAME_MAX + 1) })).toContain(String(TEMPLATE_NAME_MAX))
    expect(draftError({ name: 'Fine', subject: 'x'.repeat(TEMPLATE_SUBJECT_MAX + 1) })).toContain(String(TEMPLATE_SUBJECT_MAX))
  })

  test('the body carries the required empty document and trims what was typed', () => {
    expect(templatePayload({ name: ' Welcome ', channel: 'email', subject: ' Hello ' }))
      .toEqual({ name: 'Welcome', channel: 'email', subject: 'Hello', document: EMPTY_DOCUMENT })
    expect(JSON.parse(EMPTY_DOCUMENT)).toEqual({ version: 1, blocks: [] })
  })

  test('only email keeps a subject, and an unknown channel is email', () => {
    expect(templatePayload({ name: 'Reminder', channel: 'sms', subject: 'Ignored' }).subject).toBeNull()
    expect(templatePayload({ name: 'Reminder', channel: 'fax' }).channel).toBe('email')
  })

  test('the body never carries a revision', () => {
    expect(templatePayload({ name: 'Welcome' }) as Record<string, unknown>).not.toHaveProperty('revision')
  })
})

describe('explaining a failure', () => {
  test('listing and saving each name what they can', () => {
    expect(listErrorMessage(401)).toContain('Sign in again')
    expect(listErrorMessage(403)).toContain('not an active member')
    expect(listErrorMessage(418)).toContain('418')
    expect(saveErrorMessage(409)).toContain('already has a template with that name')
    expect(saveErrorMessage(418)).toContain('418')
  })
})
