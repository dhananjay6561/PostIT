/**
 * Unit tests — checkFreeTierLimit (pure, no DB)
 *
 * Tests the extracted pure function that computes whether a user is allowed
 * to generate another post based only on their plan and current usage count.
 */

import {
  checkFreeTierLimit,
  InvalidPlanError,
  FREE_PLAN_LIMIT,
  PRO_PLAN_LIMIT,
} from '@/lib/limits/checkPostLimit'

describe('checkFreeTierLimit — free plan', () => {
  it('allows when 0 posts used', () => {
    const result = checkFreeTierLimit(0, 'free')
    expect(result.allowed).toBe(true)
    expect(result.used).toBe(0)
    expect(result.limit).toBe(FREE_PLAN_LIMIT)
  })

  it('allows when 9 posts used (one below limit)', () => {
    const result = checkFreeTierLimit(9, 'free')
    expect(result.allowed).toBe(true)
  })

  it('blocks at exactly 10 posts used', () => {
    const result = checkFreeTierLimit(10, 'free')
    expect(result.allowed).toBe(false)
    expect(result.used).toBe(10)
    expect(result.limit).toBe(FREE_PLAN_LIMIT)
  })

  it('blocks when over limit (15 posts used)', () => {
    const result = checkFreeTierLimit(15, 'free')
    expect(result.allowed).toBe(false)
  })
})

describe('checkFreeTierLimit — pro plan', () => {
  it('allows when 10 posts used', () => {
    const result = checkFreeTierLimit(10, 'pro')
    expect(result.allowed).toBe(true)
    expect(result.limit).toBe(PRO_PLAN_LIMIT)
  })

  it('allows when 1000 posts used', () => {
    const result = checkFreeTierLimit(1000, 'pro')
    expect(result.allowed).toBe(true)
  })
})

describe('checkFreeTierLimit — invalid plan', () => {
  it('throws InvalidPlanError for an unrecognised plan value', () => {
    expect(() =>
      // Force an invalid plan through; cast needed to reach the guard.
      checkFreeTierLimit(0, 'enterprise' as 'free' | 'pro')
    ).toThrow(InvalidPlanError)
  })

  it('thrown error message mentions the bad value', () => {
    expect(() =>
      checkFreeTierLimit(0, 'enterprise' as 'free' | 'pro')
    ).toThrow(/enterprise/)
  })
})
