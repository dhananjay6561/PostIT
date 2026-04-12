// ============================================================
// POST /api/ai/polish
//
// Accepts a raw draft, returns AI-polished variants for all 4 platforms.
//
// Request:  { draft: string }   (max 2000 chars)
// Response: { variants: PlatformVariants }
//
// Error responses follow a consistent shape:
//   { error: string, message?: string, ...extra }
// ============================================================

import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { polishDraft, GeminiError } from '@/lib/gemini/polish'
import { checkPostLimit, FREE_PLAN_LIMIT } from '@/lib/limits/checkPostLimit'
import { getSupabaseAdmin } from '@/lib/supabase/server'

// ---- Rate limiter (module-level singleton) ------------------------------
// 10 requests per user per 60-second sliding window.
// Redis.fromEnv() reads UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN.
const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, '1 m'),
  analytics: false,
  prefix: 'postpilot:polish',
})

// ---- Route handler -----------------------------------------------------

export async function POST(req: NextRequest) {
  // ---- 1. Authentication -----------------------------------------------
  const { userId: clerkUserId } = await auth()

  if (!clerkUserId) {
    return NextResponse.json(
      { error: 'unauthorized', message: 'A valid session is required.' },
      { status: 401 }
    )
  }

  // ---- 2. Rate limiting ------------------------------------------------
  let withinRateLimit: boolean
  let limit: number
  let remaining: number
  let reset: number

  try {
    const rl = await ratelimit.limit(clerkUserId)
    withinRateLimit = rl.success
    limit = rl.limit
    remaining = rl.remaining
    reset = rl.reset
  } catch (err) {
    console.error('[polish] Rate limit service unavailable:', err)
    return NextResponse.json(
      { error: 'service_unavailable', message: 'Rate limit service is temporarily unavailable. Please try again shortly.' },
      { status: 503 }
    )
  }

  if (!withinRateLimit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((reset - Date.now()) / 1000))
    return NextResponse.json(
      {
        error: 'rate_limit_exceeded',
        message: 'Too many requests. Please wait before trying again.',
        retry_after: retryAfterSeconds,
      },
      {
        status: 429,
        headers: {
          'X-RateLimit-Limit': String(limit),
          'X-RateLimit-Remaining': String(remaining),
          'X-RateLimit-Reset': String(reset),
          'Retry-After': String(retryAfterSeconds),
        },
      }
    )
  }

  // ---- 3. Input validation --------------------------------------------
  let body: unknown

  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: 'invalid_json', message: 'Request body must be valid JSON.' },
      { status: 400 }
    )
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json(
      { error: 'invalid_body', message: 'Request body must be a JSON object.' },
      { status: 400 }
    )
  }

  const { draft } = body as Record<string, unknown>

  if (draft === undefined || draft === null) {
    return NextResponse.json(
      { error: 'missing_field', message: '`draft` field is required.' },
      { status: 400 }
    )
  }

  if (typeof draft !== 'string' || draft.trim().length === 0) {
    return NextResponse.json(
      { error: 'invalid_draft', message: '`draft` must be a non-empty string.' },
      { status: 400 }
    )
  }

  if (draft.length > 2000) {
    return NextResponse.json(
      {
        error: 'draft_too_long',
        message: '`draft` must not exceed 2000 characters.',
        max: 2000,
        received: draft.length,
      },
      { status: 400 }
    )
  }

  const cleanDraft = draft.trim()

  // ---- 4. Free tier limit check ---------------------------------------
  let limitResult

  try {
    limitResult = await checkPostLimit(clerkUserId)
  } catch (err) {
    console.error('[polish] Failed to check post limit:', err)
    return NextResponse.json(
      { error: 'server_error', message: 'Could not verify usage limits.' },
      { status: 500 }
    )
  }

  if (!limitResult.allowed) {
    return NextResponse.json(
      {
        error: 'limit_reached',
        message: `You have used all ${FREE_PLAN_LIMIT} free posts this month. Upgrade to Pro for unlimited posts.`,
        used: limitResult.used,
        limit: limitResult.limit,
        upgrade: true,
      },
      { status: 403 }
    )
  }

  // ---- 5. AI polish ---------------------------------------------------
  let variants

  try {
    variants = await polishDraft(cleanDraft)
  } catch (err) {
    if (err instanceof GeminiError) {
      // Log full error server-side; never expose Gemini internals to the client.
      console.error('[polish] Gemini error:', err.message, err.cause)
      return NextResponse.json(
        { error: 'ai_unavailable', message: 'The AI service is temporarily unavailable. Please try again.' },
        { status: 502 }
      )
    }

    console.error('[polish] Unexpected error during polish:', err)
    return NextResponse.json(
      { error: 'server_error', message: 'An unexpected error occurred.' },
      { status: 500 }
    )
  }

  // ---- 6. Increment usage counter (atomic) ----------------------------
  // Done after a successful response to avoid charging the user for failed calls.
  // If this fails, log it — the user still gets their result.
  // A monthly reset job (Phase 2) will reconcile any drift.
  const supabase = getSupabaseAdmin()
  const { error: incrementError } = await supabase.rpc('increment_posts_used', {
    user_clerk_id: clerkUserId,
  })

  if (incrementError) {
    console.error('[polish] Failed to increment posts_used_this_month:', {
      clerkUserId,
      error: incrementError,
    })
  }

  // ---- 7. Success -----------------------------------------------------
  return NextResponse.json({ variants }, { status: 200 })
}
