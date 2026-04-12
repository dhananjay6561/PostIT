// ============================================================
// PATCH  /api/posts/:id  — update a post
// DELETE /api/posts/:id  — delete a post
//
// Both handlers:
//   1. Verify the session (belt-and-suspenders over middleware)
//   2. Fetch the post first to check ownership and current status
//   3. Enforce immutability rules before any mutation
//
// Note: params is a Promise in Next.js 15+ — always await it.
// ============================================================

import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import {
  getPostById,
  updatePost,
  deletePost,
  PostServiceError,
} from '@/lib/posts/postService'
import { validateUpdatePost, isValidUuid } from '@/lib/validation/posts'

type RouteContext = { params: Promise<{ id: string }> }

// ---- PATCH /api/posts/:id ----------------------------------------------

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const { userId: clerkUserId } = await auth()
  if (!clerkUserId) {
    return NextResponse.json(
      { error: 'unauthorized', message: 'A valid session is required.' },
      { status: 401 }
    )
  }

  const { id: postId } = await params

  if (!isValidUuid(postId)) {
    return NextResponse.json(
      { error: 'not_found', message: 'Post not found.' },
      { status: 404 }
    )
  }

  // Fetch the existing post to check status before allowing the update
  let existing
  try {
    existing = await getPostById(clerkUserId, postId)
  } catch (err) {
    console.error('[PATCH /api/posts/:id] Failed to fetch post:', err)
    return NextResponse.json(
      { error: 'server_error', message: 'An unexpected error occurred.' },
      { status: 500 }
    )
  }

  if (!existing) {
    return NextResponse.json(
      { error: 'not_found', message: 'Post not found.' },
      { status: 404 }
    )
  }

  // Published and failed posts are immutable
  if (existing.status === 'published' || existing.status === 'failed') {
    return NextResponse.json(
      {
        error: 'forbidden',
        message: `Cannot edit a post with status "${existing.status}".`,
      },
      { status: 403 }
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

  // Validate — strips any fields not in the allowed set
  const validation = validateUpdatePost(body)
  if (!validation.valid) {
    return NextResponse.json(
      { error: 'validation_error', message: validation.error },
      { status: 400 }
    )
  }

  try {
    const updated = await updatePost(clerkUserId, postId, validation.data)
    return NextResponse.json(updated, { status: 200 })
  } catch (err) {
    if (err instanceof PostServiceError) {
      if (err.code === 'NOT_FOUND') {
        return NextResponse.json(
          { error: 'not_found', message: 'Post not found.' },
          { status: 404 }
        )
      }
      console.error('[PATCH /api/posts/:id]', err.message, err.cause)
      return NextResponse.json(
        { error: 'server_error', message: err.message },
        { status: 500 }
      )
    }
    console.error('[PATCH /api/posts/:id] Unexpected error:', err)
    return NextResponse.json(
      { error: 'server_error', message: 'An unexpected error occurred.' },
      { status: 500 }
    )
  }
}

// ---- DELETE /api/posts/:id ---------------------------------------------

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const { userId: clerkUserId } = await auth()
  if (!clerkUserId) {
    return NextResponse.json(
      { error: 'unauthorized', message: 'A valid session is required.' },
      { status: 401 }
    )
  }

  const { id: postId } = await params

  if (!isValidUuid(postId)) {
    return NextResponse.json(
      { error: 'not_found', message: 'Post not found.' },
      { status: 404 }
    )
  }

  // Fetch the existing post to check ownership and status before deleting
  let existing
  try {
    existing = await getPostById(clerkUserId, postId)
  } catch (err) {
    console.error('[DELETE /api/posts/:id] Failed to fetch post:', err)
    return NextResponse.json(
      { error: 'server_error', message: 'An unexpected error occurred.' },
      { status: 500 }
    )
  }

  if (!existing) {
    return NextResponse.json(
      { error: 'not_found', message: 'Post not found.' },
      { status: 404 }
    )
  }

  // Published posts cannot be deleted — they exist as a record
  if (existing.status === 'published') {
    return NextResponse.json(
      {
        error: 'forbidden',
        message: 'Cannot delete a published post.',
      },
      { status: 403 }
    )
  }

  try {
    await deletePost(clerkUserId, postId)
    return new NextResponse(null, { status: 204 })
  } catch (err) {
    if (err instanceof PostServiceError) {
      console.error('[DELETE /api/posts/:id]', err.message, err.cause)
      return NextResponse.json(
        { error: 'server_error', message: err.message },
        { status: 500 }
      )
    }
    console.error('[DELETE /api/posts/:id] Unexpected error:', err)
    return NextResponse.json(
      { error: 'server_error', message: 'An unexpected error occurred.' },
      { status: 500 }
    )
  }
}
