// ============================================================
// POST /api/posts  — create a new post
// GET  /api/posts  — list posts for the authenticated user
//
// Auth is enforced by middleware for all /api/* routes.
// We still call auth() here to get the userId.
//
// Error responses follow the project-wide shape:
//   { error: string, message: string }
// ============================================================

import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { createPost, getPosts, PostServiceError } from '@/lib/posts/postService'
import { validateCreatePost } from '@/lib/validation/posts'
import type { PlatformVariants } from '@/types/posts'

// ---- POST /api/posts ---------------------------------------------------

export async function POST(req: NextRequest) {
  // Auth — belt-and-suspenders (middleware already checked, but we need userId)
  const { userId: clerkUserId } = await auth()
  if (!clerkUserId) {
    return NextResponse.json(
      { error: 'unauthorized', message: 'A valid session is required.' },
      { status: 401 }
    )
  }

  // Parse body
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: 'invalid_json', message: 'Request body must be valid JSON.' },
      { status: 400 }
    )
  }

  // Validate
  const validation = validateCreatePost(body)
  if (!validation.valid) {
    return NextResponse.json(
      { error: 'validation_error', message: validation.error },
      { status: 400 }
    )
  }

  // Safe to cast — validation guarantees the shape
  const { original_draft, platform_variants } = body as {
    original_draft: string
    platform_variants: PlatformVariants
  }

  try {
    const post = await createPost(
      clerkUserId,
      original_draft.trim(),
      platform_variants
    )
    return NextResponse.json(post, { status: 201 })
  } catch (err) {
    if (err instanceof PostServiceError) {
      console.error('[POST /api/posts]', err.message, err.cause)
      return NextResponse.json(
        { error: 'server_error', message: err.message },
        { status: 500 }
      )
    }
    console.error('[POST /api/posts] Unexpected error:', err)
    return NextResponse.json(
      { error: 'server_error', message: 'An unexpected error occurred.' },
      { status: 500 }
    )
  }
}

// ---- GET /api/posts ----------------------------------------------------

export async function GET(req: NextRequest) {
  const { userId: clerkUserId } = await auth()
  if (!clerkUserId) {
    return NextResponse.json(
      { error: 'unauthorized', message: 'A valid session is required.' },
      { status: 401 }
    )
  }

  const { searchParams } = new URL(req.url)

  // Parse and clamp pagination params
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1)
  const limit = Math.min(
    50,
    Math.max(1, parseInt(searchParams.get('limit') ?? '10', 10) || 10)
  )

  try {
    const { posts, total } = await getPosts(clerkUserId, page, limit)
    return NextResponse.json({ posts, total, page, limit }, { status: 200 })
  } catch (err) {
    if (err instanceof PostServiceError) {
      console.error('[GET /api/posts]', err.message, err.cause)
      return NextResponse.json(
        { error: 'server_error', message: err.message },
        { status: 500 }
      )
    }
    console.error('[GET /api/posts] Unexpected error:', err)
    return NextResponse.json(
      { error: 'server_error', message: 'An unexpected error occurred.' },
      { status: 500 }
    )
  }
}
