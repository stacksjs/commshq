import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/*
 * `team_id` is deliberately absent from the factories below, and adding one
 * would not work anyway.
 *
 * `Team` is on the seeder's ACCOUNT_MODELS list, so `relationColumns()` skips
 * it and leaves every foreign key pointing at an account null, whatever this
 * file declares. That is the framework being careful rather than incomplete:
 * pointing invented rows at a table of real sign-ins hands one workspace
 * another workspace's fabricated audience. Which account owns a seeded row is
 * the application's decision, so it is made in
 * `database/seeders/WorkspaceContactsSeeder.ts`, which runs after the model
 * pass and claims the orphans for the owner workspace.
 */

/**
 * One invented person, reused across the three factories that describe them.
 *
 * Each attribute factory is called exactly once per row, so three counters
 * that each advance on their own call still arrive at the same row number, and
 * all three read the same entry here. Without that, `firstName`, `lastName`
 * and `email` each draw independently and the table shows Natalie Parker
 * reachable at charlie.scott@example.com, which is the detail that gives
 * seeded data away at a glance.
 */
interface SeededPerson {
  first: string
  last: string
}

/** Only `person.firstName` / `person.lastName` are needed, so only those are asked for. */
interface NameFaker {
  person: { firstName: () => string, lastName: () => string }
}

const people: SeededPerson[] = []
let nameRow = 0
let surnameRow = 0
let emailRow = 0

function personAt(index: number, faker: NameFaker): SeededPerson {
  while (people.length <= index)
    people.push({ first: faker.person.firstName(), last: faker.person.lastName() })
  return people[index] as SeededPerson
}

/**
 * An address that is unique and cannot receive mail.
 *
 * Both halves matter now that the seeded contacts all land in one workspace.
 * `contacts_team_email_unique` spans (team_id, email), so two rows sharing an
 * address were harmless while every `team_id` was null and are a failed insert
 * the moment one team owns them - and `email` is not declared `unique`, so the
 * seeder's own disambiguation never ran on it. It could not have helped if it
 * had: it appends " 2" to the duplicate, producing an address with a space in
 * it. The row number does the job instead, before a collision can happen.
 *
 * example.com rather than a faker domain because this is a product that sends
 * email. RFC 2606 reserves it precisely so it can never resolve to a real
 * mailbox, which a plausible invented domain very much can.
 */
function seededEmail(person: SeededPerson, row: number): string {
  return `${person.first}.${person.last}${row}@example.com`.toLowerCase().replace(/[^a-z0-9.@]/g, '')
}

export default defineModel({
  name: 'Contact', table: 'contacts', belongsTo: ['Team'],
  hasMany: ['ContactIdentity', 'AudienceMembership', 'ConsentEvent', 'ContactMerge'],
  indexes: [
    { name: 'contacts_team_email_unique', columns: ['team_id', 'email'], unique: true },
    { name: 'contacts_team_status_index', columns: ['team_id', 'status'] },
  ],
  traits: {
    useUuid: true, useTimestamps: true, observe: true,
    useSearch: { searchable: ['email', 'firstName', 'lastName'], filterable: ['teamId', 'status'], sortable: ['createdAt'] },
    useApi: { prefix: 'v1', uri: 'contacts', routes: ['index', 'store', 'show', 'update', 'destroy'], middleware: ['auth', 'team'] },
    useSeeder: { count: 36 },
  },
  attributes: {
    email: { required: false, fillable: true, validation: { rule: schema.string().email().max(255) }, factory: faker => seededEmail(personAt(emailRow++, faker), emailRow) },
    phone: { required: false, fillable: true, validation: { rule: schema.string().max(32) }, factory: () => null },
    firstName: { required: false, fillable: true, validation: { rule: schema.string().max(100) }, factory: faker => personAt(nameRow++, faker).first },
    lastName: { required: false, fillable: true, validation: { rule: schema.string().max(100) }, factory: faker => personAt(surnameRow++, faker).last },
    status: { required: true, fillable: true, default: 'active', validation: { rule: schema.enum(['active', 'pending', 'unsubscribed', 'suppressed', 'archived']) }, factory: () => 'active' },
    source: { required: true, fillable: true, default: 'manual', validation: { rule: schema.string().max(100) }, factory: () => 'demo' },
    properties: { required: false, fillable: true, validation: { rule: schema.json() }, factory: () => JSON.stringify({}) },
    lastEngagedAt: { required: false, fillable: true, validation: { rule: schema.timestamp() }, factory: () => null },
  },
  dashboard: { highlight: true },
} as const)
