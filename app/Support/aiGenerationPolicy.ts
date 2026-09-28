export const AI_PURPOSES = ['writing', 'segmentation', 'summary', 'optimization', 'recommendation'] as const
export type AiPurpose = typeof AI_PURPOSES[number]

const ALLOWED_ROLES = new Set(['owner', 'admin', 'editor'])

export function canGenerateAi(role: unknown): boolean {
  return ALLOWED_ROLES.has(String(role || '').toLowerCase())
}

export function parseAiPurpose(value: unknown): AiPurpose | null {
  const purpose = String(value || '').toLowerCase()
  return AI_PURPOSES.includes(purpose as AiPurpose) ? purpose as AiPurpose : null
}

export function validAiPrompt(value: unknown): string | null {
  const prompt = String(value || '').trim()
  return prompt.length >= 20 && prompt.length <= 8_000 ? prompt : null
}

export function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4))
}

export function validIdempotencyKey(value: unknown): string | null {
  const key = String(value || '').trim()
  return key.length >= 16 && key.length <= 200 && /^[\w.:-]+$/.test(key) ? key : null
}
