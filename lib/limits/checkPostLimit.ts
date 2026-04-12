// ============================================================
// Post usage limit checker
//
// Enforces per-user monthly post limits based on their plan.
// Called before every AI polish request.
// ============================================================

import { getSupabaseAdmin } from '@/lib/supabase/server'

export const FREE_PLAN_LIMIT = 10
// Pro plan has no enforced ceiling; represented as -1 throughout the codebase.
export const PRO_PLAN_LIMIT = -1

export interface PostLimitResult {
  allowed: boolean
  used: number
  /** Monthly limit for this plan. -1 means unlimited (pro). */
  limit: number
}

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

  const used = data.posts_used_this_month

  if (data.plan === 'pro') {
    return {
      allowed: true,
      used,
      limit: PRO_PLAN_LIMIT,
    }
  }

  // Free plan
  return {
    allowed: used < FREE_PLAN_LIMIT,
    used,
    limit: FREE_PLAN_LIMIT,
  }
}
