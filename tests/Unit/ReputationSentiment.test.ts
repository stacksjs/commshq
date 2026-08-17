import { describe, expect, it } from 'bun:test'
import { classifyMention, scoreFromRating, scoreText } from '../../app/Actions/Reputation/sentiment'

describe('reputation sentiment', () => {
  it('maps star ratings onto the shared scale', () => {
    expect(scoreFromRating(1)).toEqual({ sentiment: 'negative', score: -100 })
    expect(scoreFromRating(3)).toEqual({ sentiment: 'neutral', score: 0 })
    expect(scoreFromRating(5)).toEqual({ sentiment: 'positive', score: 100 })
  })

  it('clamps ratings outside the one to five range', () => {
    expect(scoreFromRating(0).score).toBe(-100)
    expect(scoreFromRating(9).score).toBe(100)
  })

  it('scores plain text by lexicon', () => {
    expect(scoreText('The staff were friendly and the room was spotless.').sentiment).toBe('positive')
    expect(scoreText('Rude service and the order was completely wrong.').sentiment).toBe('negative')
  })

  it('reports unknown rather than neutral when no term matches', () => {
    expect(scoreText('We arrived at four and left at six.')).toEqual({ sentiment: 'unknown', score: 0 })
    expect(scoreText('')).toEqual({ sentiment: 'unknown', score: 0 })
  })

  it('inverts a term that follows a negator', () => {
    expect(scoreText('The room was clean.').sentiment).toBe('positive')
    expect(scoreText('The room was not clean.').sentiment).toBe('negative')
    expect(scoreText('The room was not very clean.').sentiment).toBe('negative')
  })

  it('does not let review length inflate the score', () => {
    const short = scoreText('Terrible.')
    const long = scoreText(`Terrible. ${'We waited and waited. '.repeat(10)}`)
    expect(long.score).toBeGreaterThanOrEqual(short.score)
    expect(long.sentiment).toBe('negative')
  })

  it('prefers an explicit rating over the text lexicon', () => {
    // A one star review whose text reads positively is still a one star review.
    const result = classifyMention({ body: 'Great location and friendly staff.', rating: 1 })
    expect(result.sentiment).toBe('negative')
  })

  it('falls back to the lexicon when the platform supplies no rating', () => {
    expect(classifyMention({ body: 'Absolutely awful experience.', rating: null }).sentiment).toBe('negative')
  })
})
