import { randomUUID } from 'node:crypto'
import { db, Seeder } from '@stacksjs/database'
import { log } from '@stacksjs/logging'
import { appEnvName, isProductionEnv, OWNER_WORKSPACE, ownerWorkspaceId } from '../../app/Support/ownerWorkspace'
import { newVerificationToken, verificationRecord } from '../../app/Support/senderDomains'

/**
 * Give the owner workspace one sending domain and two senders, so the
 * domains and senders pages have something to show locally.
 *
 * The domain is `pending`, with a real verification record, and it will stay
 * pending: `news.example.com` is under a name reserved for documentation, so
 * the record can never appear in DNS. That is the point. A seeded `verified`
 * domain would be a domain nobody proved, and the send job trusts that
 * status. Checking it from the page shows the honest "record not found".
 *
 * The two senders show the two kinds of waiting the senders page tells
 * apart: one at the pending domain, one at a domain that was never added.
 *
 * `SenderDomain` declares `useSeeder`, but the model pass leaves `team_id`
 * null, so its rows belong to no workspace and no page shows them.
 *
 * Never in production, which does not get domains nobody added.
 */

const DOMAIN = 'news.example.com'

const SENDERS = [
  { name: 'Maya from Sunday Paper', address: `maya@${DOMAIN}`, replyTo: null },
  { name: 'Studio updates', address: 'hello@studio.example.org', replyTo: 'replies@studio.example.org' },
] as const

export default class WorkspaceSendingSeeder extends Seeder {
  static order = 16
  static tags = ['demo']

  async run(): Promise<void> {
    if (isProductionEnv()) {
      log.info(`[WorkspaceSendingSeeder] Skipped: APP_ENV="${appEnvName()}" is production, which does not get domains nobody added.`)
      return
    }

    const teamId = await ownerWorkspaceId()
    if (!teamId) {
      log.info(`[WorkspaceSendingSeeder] Skipped: the ${OWNER_WORKSPACE} workspace does not exist yet.`)
      return
    }

    /*
     * All or nothing. A workspace that already has a domain or a sender,
     * seeded or real, is left as it is. The domain is also looked for across
     * every team: the unique index is on the domain alone.
     */
    const ownsAny = await db.selectFrom('sender_domains' as any).select(['id'] as any).where('team_id' as any, '=', teamId).executeTakeFirst()
      ?? await db.selectFrom('sender_identities' as any).select(['id'] as any).where('team_id' as any, '=', teamId).executeTakeFirst()
    const taken = await db.selectFrom('sender_domains' as any).select(['id'] as any).where('domain' as any, '=', DOMAIN).executeTakeFirst()
    if (ownsAny || taken) {
      log.info('[WorkspaceSendingSeeder] Nothing to add: this workspace already has a sending domain or sender, or the sample domain is taken.')
      return
    }

    const now = new Date().toISOString()
    await db.insertInto('sender_domains' as any).values({
      team_id: teamId,
      uuid: randomUUID(),
      domain: DOMAIN,
      status: 'pending',
      selector: 'mail',
      dns_records: JSON.stringify([verificationRecord(DOMAIN, newVerificationToken())]),
      verified_at: null,
      last_checked_at: null,
      created_at: now,
      updated_at: now,
    } as any).execute()

    for (const sender of SENDERS) {
      await db.insertInto('sender_identities' as any).values({
        team_id: teamId,
        sender_domain_id: null,
        uuid: randomUUID(),
        channel: 'email',
        name: sender.name,
        address: sender.address,
        reply_to: sender.replyTo,
        status: 'pending',
        created_at: now,
        updated_at: now,
      } as any).execute()
    }

    log.info(`[WorkspaceSendingSeeder] Added 1 pending sending domain and ${SENDERS.length} senders for ${OWNER_WORKSPACE}.`)
  }
}

if (import.meta.main)
  await new WorkspaceSendingSeeder().run()
