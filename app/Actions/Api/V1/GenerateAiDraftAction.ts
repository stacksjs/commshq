import type { UsageReservation } from '@stacksjs/newsletter'
import type { RequestInstance } from '@stacksjs/types'
import { createHash } from 'node:crypto'
import { Action } from '@stacksjs/actions'
import { ask } from '@stacksjs/ai'
import { db, sqlDateTime } from '@stacksjs/database'
import { log } from '@stacksjs/logging'
import { releaseUsage, reserveUsage, UsageQuotaError } from '@stacksjs/newsletter'
import { isUniqueViolation, transaction } from '@stacksjs/orm'
import { response } from '@stacksjs/router'
import { randomUUIDv7 } from 'bun'
import AiGeneration from '../../../Models/AiGeneration'
import UsageMeter from '../../../Models/UsageMeter'
import { canGenerateAi, estimateTokens, parseAiPurpose, validAiPrompt, validIdempotencyKey } from '../../Ai/generation-policy'
import { updatedRows, usageMeterStore } from '../../Usage/usage-meter-store'
import { activeTeam } from './team'

const MODEL_ID = 'amazon.titan-text-express-v1'

function instruction(purpose: string, prompt: string, context: string): string {
  return [
    'You are assisting a communications team. Return a review-ready draft only.',
    'Do not claim it was approved, published, or sent. Do not invent audience facts.',
    `Task: ${purpose}.`,
    context ? `Approved workspace context:\n${context}` : '',
    `Request:\n${prompt}`,
  ].filter(Boolean).join('\n\n')
}

function scopedKey(teamId: number, key: string): string {
  return createHash('sha256').update(`${teamId}:${key}`).digest('hex')
}

async function existingResponse(teamId: number, idempotencyKey: string) {
  const generation = await AiGeneration.where('team_id', teamId).where('idempotencyKey', idempotencyKey).first()
  if (!generation)
    return null
  if (generation.status === 'generating')
    return response.json({ error: 'AI generation is already in progress' }, 409)
  if (generation.status === 'failed')
    return response.json({ error: 'The original AI generation attempt failed', data: generation, replay: true }, 409)
  return response.json({ data: generation, approvalRequired: generation.status === 'draft', replay: true })
}

function safeError(error: unknown): { name: string, code?: string } {
  const source = error as { name?: unknown, code?: unknown } | null
  return {
    name: String(source?.name || 'Error'),
    ...(source?.code ? { code: String(source.code) } : {}),
  }
}

export default new Action({
  name: 'Generate AI Draft',
  description: 'Creates a quota-governed Bedrock draft with stored provenance and mandatory review',
  method: 'POST',

  async handle(request: RequestInstance) {
    const membership = await activeTeam(request)
    const teamId = membership?.teamId ?? null
    const user = await request.user()
    if (!teamId || !user) return response.json({ error: 'Active team required' }, 403)
    if (!canGenerateAi(membership?.role)) return response.json({ error: 'AI drafting requires an editor, admin, or owner role' }, 403)

    const purpose = parseAiPurpose(request.get('purpose'))
    const prompt = validAiPrompt(request.get('prompt'))
    const context = String(request.get('context') || '').trim()
    const requestKey = validIdempotencyKey(request.headers.get('idempotency-key'))
    if (!purpose) return response.json({ error: 'Unsupported AI purpose' }, 422)
    if (!prompt) return response.json({ error: 'Prompt must be between 20 and 8,000 characters' }, 422)
    if (context.length > 8_000) return response.json({ error: 'Context must be 8,000 characters or fewer' }, 422)
    if (!requestKey) return response.json({ error: 'A valid Idempotency-Key header is required' }, 422)

    const idempotencyKey = scopedKey(teamId, requestKey)
    const replay = await existingResponse(teamId, idempotencyKey)
    if (replay) return replay

    const providerInput = instruction(purpose, prompt, context)
    let generation
    try {
      generation = await AiGeneration.forceCreate({
        team_id: teamId,
        user_id: Number(user.id),
        purpose,
        idempotencyKey,
        model: MODEL_ID,
        promptHash: createHash('sha256').update(prompt).digest('hex'),
        provenance: JSON.stringify({
          provider: 'bedrock',
          model: MODEL_ID,
          purpose,
          contextHash: context ? createHash('sha256').update(context).digest('hex') : null,
          requestedBy: Number(user.id),
          requiresHumanApproval: true,
        }),
        output: '',
        inputTokens: estimateTokens(providerInput),
        outputTokens: 0,
        cost: 0,
        status: 'generating',
      })
    }
    catch (error) {
      if (isUniqueViolation(error)) {
        const concurrentReplay = await existingResponse(teamId, idempotencyKey)
        if (concurrentReplay) return concurrentReplay
      }
      log.error('[commshq:ai] Generation claim failed', { error: safeError(error), teamId })
      return response.json({ error: 'AI generation could not be claimed' }, 500)
    }

    const now = new Date().toISOString()
    const meter = await UsageMeter.where('team_id', teamId)
      .where('key', 'ai_generations')
      .where('periodStart', '<=', now)
      .where('periodEnd', '>', now)
      .orderByDesc('periodStart')
      .first()
    if (!meter) {
      await AiGeneration.forceUpdate(generation.id, { status: 'failed', failureReason: 'quota_unavailable' })
      return response.json({ error: 'AI generation quota is unavailable or exhausted' }, 429)
    }

    const store = usageMeterStore({ id: Number(meter.id), teamId, meter: 'ai_generations' })
    let reservation: UsageReservation
    try {
      reservation = await reserveUsage(store, 'ai_generations')
    }
    catch (error) {
      const code = error instanceof UsageQuotaError ? error.code : 'invalid'
      await AiGeneration.forceUpdate(generation.id, { status: 'failed', failureReason: `quota_${code}` })
      return response.json(
        { error: 'AI generation quota is unavailable or exhausted' },
        code === 'contention' ? 503 : 429,
      )
    }

    let providerCompleted = false
    try {
      const output = String(await ask(providerInput, { modelId: MODEL_ID, maxTokenCount: 1_200, temperature: 0.25, topP: 0.9 })).trim()
      if (!output) throw new Error('Bedrock returned an empty draft')
      providerCompleted = true

      const completedAt = sqlDateTime()
      await transaction(async (rawTrx) => {
        const trx = rawTrx as unknown as typeof db
        const updated = await trx
          .updateTable('ai_generations')
          .set({ output, output_tokens: estimateTokens(output), status: 'draft', failure_reason: null, updated_at: completedAt })
          .where('id', '=', Number(generation.id))
          .where('team_id', '=', teamId)
          .where('status', '=', 'generating')
          .executeTakeFirst()
        if (updatedRows(updated) !== 1)
          throw new Error('AI generation state changed before completion')

        await trx.insertInto('usage_events').values({
          uuid: randomUUIDv7(),
          team_id: teamId,
          user_id: Number(user.id),
          meter: 'ai_generations',
          quantity: 1,
          source_type: 'AiGeneration',
          source_id: String(generation.id),
          idempotency_key: `ai-generation:${teamId}:${generation.uuid || generation.id}`,
          provider_cost: 0,
          metadata: JSON.stringify({ provider: 'bedrock', model: MODEL_ID }),
          occurred_at: completedAt,
          created_at: completedAt,
          updated_at: completedAt,
        }).execute()
      })

      return response.json({ data: await AiGeneration.where('id', generation.id).where('team_id', teamId).first(), approvalRequired: true }, 201)
    }
    catch (error) {
      let failureReason = providerCompleted ? 'persistence_error' : 'provider_error'
      try {
        await releaseUsage(store, reservation)
      }
      catch (releaseError) {
        failureReason = 'quota_release_error'
        log.error('[commshq:ai] Usage reservation release failed', {
          error: safeError(releaseError),
          generationId: Number(generation.id),
          teamId,
        })
      }
      await AiGeneration.forceUpdate(generation.id, { status: 'failed', failureReason })
      log.error('[commshq:ai] Generation failed', {
        error: safeError(error),
        generationId: Number(generation.id),
        teamId,
      })
      return response.json({ error: providerCompleted ? 'AI draft could not be recorded' : 'AI provider request failed' }, providerCompleted ? 500 : 502)
    }
  },
})
