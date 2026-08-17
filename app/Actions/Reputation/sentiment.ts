import type { Sentiment } from './platforms'

/**
 * Deterministic lexicon scoring for review and comment text.
 *
 * A star rating, when the platform supplies one, is the strongest signal we
 * have and wins outright. Free-text comments (Instagram, X, Reddit) carry no
 * rating, so they fall back to the lexicon below. The scorer is intentionally
 * transparent and offline: alert thresholds are only defensible if the score
 * behind them can be recomputed and explained.
 */

const POSITIVE_TERMS: Record<string, number> = {
  amazing: 3, awesome: 3, excellent: 3, fantastic: 3, outstanding: 3, perfect: 3, superb: 3, wonderful: 3,
  attentive: 2, beautiful: 2, delicious: 2, delightful: 2, friendly: 2, generous: 2, great: 2, helpful: 2,
  impressed: 2, incredible: 2, lovely: 2, professional: 2, recommend: 2, reliable: 2, responsive: 2, spotless: 2,
  clean: 1, comfortable: 1, courteous: 1, easy: 1, enjoyed: 1, fair: 1, fast: 1, fine: 1, good: 1, happy: 1,
  nice: 1, pleasant: 1, prompt: 1, quick: 1, satisfied: 1, smooth: 1, solid: 1, thanks: 1, worth: 1,
}

const NEGATIVE_TERMS: Record<string, number> = {
  appalling: 3, atrocious: 3, awful: 3, disgusting: 3, disgraceful: 3, horrible: 3, terrible: 3, unacceptable: 3,
  angry: 2, broken: 2, cold: 2, complaint: 2, dirty: 2, disappointed: 2, disappointing: 2, filthy: 2, ignored: 2,
  overpriced: 2, poor: 2, refund: 2, rude: 2, scam: 2, slow: 2, unhelpful: 2, unprofessional: 2, useless: 2,
  worst: 2, wrong: 2,
  bad: 1, bland: 1, confusing: 1, crowded: 1, delayed: 1, expensive: 1, late: 1, mediocre: 1, messy: 1,
  mistake: 1, noisy: 1, problem: 1, rushed: 1, stale: 1, unclear: 1, waiting: 1,
}

const NEGATORS = new Set(['not', 'never', 'no', 'without', 'isnt', 'wasnt', 'arent', 'werent', 'dont', 'didnt', 'doesnt', 'cant', 'couldnt', 'wont', 'wouldnt', 'hardly', 'barely'])
const INTENSIFIERS = new Set(['very', 'extremely', 'really', 'incredibly', 'absolutely', 'completely', 'totally', 'utterly', 'so'])

export interface SentimentResult {
  sentiment: Sentiment
  /** Normalized to -100..100 so thresholds stay readable across platforms. */
  score: number
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

function labelFor(score: number): Sentiment {
  if (score >= 15) return 'positive'
  if (score <= -15) return 'negative'
  return 'neutral'
}

/**
 * Map a 1..5 star rating onto the same -100..100 scale the lexicon uses, so a
 * rule comparing average sentiment behaves consistently whether the platform
 * supplies stars or plain text.
 */
export function scoreFromRating(rating: number): SentimentResult {
  const clamped = Math.min(5, Math.max(1, rating))
  const score = Math.round(((clamped - 3) / 2) * 100)
  if (clamped <= 2) return { sentiment: 'negative', score }
  if (clamped >= 4) return { sentiment: 'positive', score }
  return { sentiment: 'neutral', score }
}

export function scoreText(text: string): SentimentResult {
  const tokens = tokenize(text)
  if (!tokens.length) return { sentiment: 'unknown', score: 0 }

  let total = 0
  let matches = 0

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    if (!token) continue
    const weight = POSITIVE_TERMS[token] ?? -(NEGATIVE_TERMS[token] ?? 0)
    if (!weight) continue

    let value = weight
    // Look back two tokens so "not very clean" and "not clean" both invert.
    for (let back = 1; back <= 2; back++) {
      const previous = tokens[index - back]
      if (!previous) break
      if (INTENSIFIERS.has(previous)) { value *= 1.5; continue }
      if (NEGATORS.has(previous)) { value *= -1; break }
      break
    }

    total += value
    matches++
  }

  if (!matches) return { sentiment: 'unknown', score: 0 }

  // Average the matched terms rather than summing, so a long review is not
  // scored as more extreme than a short one making the same point.
  const average = total / matches
  const score = Math.max(-100, Math.min(100, Math.round((average / 3) * 100)))
  return { sentiment: labelFor(score), score }
}

/** Classify a mention, preferring an explicit star rating over the text lexicon. */
export function classifyMention(input: { body: string, rating?: number | null }): SentimentResult {
  if (typeof input.rating === 'number' && Number.isFinite(input.rating))
    return scoreFromRating(input.rating)
  return scoreText(input.body || '')
}
