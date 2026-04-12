
// POST /api/webhooks/clerk
//
// Handles Clerk lifecycle events.
// This route is PUBLIC — excluded from auth middleware.
// Signature verification via svix (Clerk's verifyWebhook) is
// the only trust mechanism. Never skip it.

import { verifyWebhook } from '@clerk/nextjs/webhooks'
import type { WebhookEvent } from '@clerk/nextjs/webhooks'
import type { UserJSON } from '@clerk/backend'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import type { UserInsert } from '@/lib/types/database'

export async function POST(req: NextRequest) {
  // ----------------------------------------------------------
  // Step 1: Verify webhook signature.
  // verifyWebhook reads CLERK_WEBHOOK_SECRET from env automatically.
  // Returns a typed WebhookEvent on success; throws on bad signature.
  // ----------------------------------------------------------
  let evt: WebhookEvent

  try {
    evt = await verifyWebhook(req)
  } catch (err) {
    console.error('[clerk-webhook] Signature verification failed:', err)
    return NextResponse.json(
      { error: 'Invalid webhook signature' },
      { status: 400 }
    )
  }

  // ----------------------------------------------------------
  // Step 2: Route by event type.
  // Only act on events we explicitly support; ignore the rest.
  // ----------------------------------------------------------
  if (evt.type === 'user.created') {
    return handleUserCreated(evt.data as UserJSON)
  }

  // Acknowledge all other events without processing them.
  // This prevents Clerk from retrying unsupported event types.
  return NextResponse.json({ received: true }, { status: 200 })
}

// ============================================================
// Handler: user.created
// ============================================================
async function handleUserCreated(data: UserJSON): Promise<NextResponse> {
  const clerkUserId = data.id

  // Use primary_email_address_id to find the correct email (Clerk best practice).
  // Falls back to [0] if primary ID is not set (e.g. OAuth-only signups).
  const primaryEmailId = data.primary_email_address_id
  const email =
    data.email_addresses?.find((e) => e.id === primaryEmailId)?.email_address ??
    data.email_addresses?.[0]?.email_address

  if (!email) {
    console.warn('[clerk-webhook] user.created — no email address found in payload', {
      clerkUserId,
      primaryEmailId,
      emailCount: data.email_addresses?.length ?? 0,
    })
    return NextResponse.json({ received: true }, { status: 200 })
  }

  const supabase = getSupabaseAdmin()

  const payload: UserInsert = {
    clerk_user_id: clerkUserId,
    email,
  }

  // Upsert with ignoreDuplicates: true makes this handler idempotent.
  // If the webhook fires twice (Clerk retries on 5xx), the second call
  // hits the UNIQUE constraint on clerk_user_id and is silently ignored.
  const { error } = await supabase
    .from('users')
    .upsert(payload, {
      onConflict: 'clerk_user_id',
      ignoreDuplicates: true,
    })

  if (error) {
    console.error('[clerk-webhook] Failed to insert user into Supabase:', {
      clerkUserId,
      email,
      error,
    })
    // Return 500 so Clerk retries the webhook delivery.
    return NextResponse.json(
      { error: 'Failed to persist user record' },
      { status: 500 }
    )
  }

  console.info('[clerk-webhook] User synced to Supabase:', { clerkUserId, email })
  return NextResponse.json({ received: true }, { status: 200 })
}
