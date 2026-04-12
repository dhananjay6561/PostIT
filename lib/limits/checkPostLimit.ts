// ============================================================
// Post usage limit checker
//
// Enforces per-user monthly post limits based on their plan.
// Called before every AI polish request.
// ============================================================

import { getSupabaseAdmin } from '@/lib/supabase/server'
import type { Plan } from '@/lib/types/database'

export const FREE_PLAN_LIMIT = 10
// Pro plan has no enforced ceiling; represented as -1 throughout the codebase.
export const PRO_PLAN_LIMIT = -1

export interface PostLimitResult {
  allowed: boolean
  used: number
  /** Monthly limit for this plan. -1 means unlimited (pro). */
  limit: number
}

// ---- Typed error -------------------------------------------------------

export class InvalidPlanError extends Error {
  constructor(plan: unknown) {
    super(`Invalid plan value: "${plan}". Expected "free" or "pro".`)
    this.name = 'InvalidPlanError'
  }
}

// ---- Pure limit logic (unit-testable, no DB) ----------------------------

/**
 * Pure function: given usage and plan, returns whether another post is allowed.
 * Separated from the DB lookup so it can be unit-tested without a real database.
 *
 * @throws {InvalidPlanError} if plan is not 'free' or 'pro'
 */
export function checkFreeTierLimit(
  postsUsedThisMonth: number,
  plan: Plan
): PostLimitResult {
  if (plan !== 'free' && plan !== 'pro') {
    throw new InvalidPlanError(plan)
  }

  if (plan === 'pro') {
    return { allowed: true, used: postsUsedThisMonth, limit: PRO_PLAN_LIMIT }
  }

  return {
    allowed: postsUsedThisMonth < FREE_PLAN_LIMIT,
    used: postsUsedThisMonth,
    limit: FREE_PLAN_LIMIT,
  }
}

// ---- DB-backed check (used by route handlers) --------------------------

/**
 * Checks whether a user is allowed to generate another polished post.
 *
 * @throws if the user record cannot be found in the database
 */
export async function checkPostLimit(clerkUserId: string): Promise<PostLimitResult> {
  const supabase = getSupabaseAdmin()

  const { data, error } = await supabase
    .from('users')
    .select('plan, posts_used_this_month')
    .eq('clerk_user_id', clerkUserId)
    .single()

  if (error || !data) {
    throw new Error(
      `[checkPostLimit] User record not found for clerk_user_id: ${clerkUserId}`
    )
  }

  return checkFreeTierLimit(data.posts_used_this_month, data.plan as Plan)
}
