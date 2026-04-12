// ============================================================
// Post service module
//
// All database operations for posts go here.
// Route handlers never contain raw Supabase queries — they call
// these functions and handle the errors they throw.
//
// userId parameters are Clerk user IDs. resolveSupabaseUserId()
// translates them to the internal Supabase UUID before every
// DB operation. This keeps route handlers unaware of the
// internal ID mapping.
// ============================================================

import { getSupabaseAdmin } from '@/lib/supabase/server'
import type { PostRow } from '@/lib/types/database'
import type { PlatformVariants } from '@/types/posts'
import type { PostUpdatePayload } from '@/lib/validation/posts'

// ---- Typed error -------------------------------------------------------

export class PostServiceError extends Error {
  constructor(
    message: string,
    public readonly code: 'NOT_FOUND' | 'DB_ERROR',
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = 'PostServiceError'
  }
}

// ---- Internal helpers --------------------------------------------------

/**
 * Translates a Clerk user ID to the Supabase user UUID.
 * Throws NOT_FOUND if the user row does not exist.
 */
async function resolveSupabaseUserId(clerkUserId: string): Promise<string> {
  const supabase = getSupabaseAdmin()

  const { data, error } = await supabase
    .from('users')
    .select('id')
    .eq('clerk_user_id', clerkUserId)
    .single()

  if (error || !data) {
    console.error('[postService] Failed to resolve Supabase user ID', {
      clerkUserId,
      error,
    })
    throw new PostServiceError('User record not found', 'NOT_FOUND', error)
  }

  return data.id
}

// ---- Public API --------------------------------------------------------

/**
 * Creates a new post with status 'draft'.
 *
 * @throws {PostServiceError} on DB failure
 */
export async function createPost(
  clerkUserId: string,
  draft: string,
  variants: PlatformVariants
): Promise<PostRow> {
  const supabase = getSupabaseAdmin()
  const userId = await resolveSupabaseUserId(clerkUserId)

  const { data, error } = await supabase
    .from('posts')
    .insert({
      user_id: userId,
      original_draft: draft,
      platform_variants: variants,
      status: 'draft',
      media_urls: [],
    })
    .select()
    .single()

  if (error || !data) {
    throw new PostServiceError('Failed to create post', 'DB_ERROR', error)
  }

  return data as PostRow
}

/**
 * Returns a paginated list of posts for a user, ordered newest-first.
 *
 * @throws {PostServiceError} on DB failure
 */
export async function getPosts(
  clerkUserId: string,
  page: number,
  limit: number
): Promise<{ posts: PostRow[]; total: number }> {
  const supabase = getSupabaseAdmin()
  const userId = await resolveSupabaseUserId(clerkUserId)

  const from = (page - 1) * limit
  const to = from + limit - 1

  const { data, error, count } = await supabase
    .from('posts')
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) {
    // PGRST103: requested range starts beyond the last row.
    // This happens when the client requests a page that doesn't exist
    // (e.g. page 5 when there are only 3 posts). Return empty posts
    // with the real total so the caller knows how many pages actually exist.
    if (error.code === 'PGRST103') {
      const { count: totalCount, error: countError } = await supabase
        .from('posts')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)

      if (countError) {
        throw new PostServiceError('Failed to fetch posts', 'DB_ERROR', countError)
      }

      return { posts: [], total: totalCount ?? 0 }
    }

    throw new PostServiceError('Failed to fetch posts', 'DB_ERROR', error)
  }

  return {
    posts: (data ?? []) as PostRow[],
    total: count ?? 0,
  }
}

/**
 * Returns a single post belonging to the user, or null if not found.
 *
 * @throws {PostServiceError} on DB failure (NOT on missing row — that returns null)
 */
export async function getPostById(
  clerkUserId: string,
  postId: string
): Promise<PostRow | null> {
  const supabase = getSupabaseAdmin()
  const userId = await resolveSupabaseUserId(clerkUserId)

  const { data, error } = await supabase
    .from('posts')
    .select('*')
    .eq('id', postId)
    .eq('user_id', userId)
    .single()

  if (error) {
    // PGRST116: no rows returned — not a DB error, just a missing post.
    if (error.code === 'PGRST116') return null
    throw new PostServiceError('Failed to fetch post', 'DB_ERROR', error)
  }

  return data as PostRow
}

/**
 * Updates a post. Only the fields present in `updates` are changed.
 * The caller is responsible for checking post ownership and status
 * before calling this function.
 *
 * @throws {PostServiceError} NOT_FOUND if the post no longer exists, DB_ERROR otherwise
 */
export async function updatePost(
  clerkUserId: string,
  postId: string,
  updates: PostUpdatePayload
): Promise<PostRow> {
  const supabase = getSupabaseAdmin()
  const userId = await resolveSupabaseUserId(clerkUserId)

  const { data, error } = await supabase
    .from('posts')
    .update(updates)
    .eq('id', postId)
    .eq('user_id', userId)
    .select()
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      throw new PostServiceError('Post not found', 'NOT_FOUND', error)
    }
    throw new PostServiceError('Failed to update post', 'DB_ERROR', error)
  }

  return data as PostRow
}

/**
 * Deletes a post. The caller is responsible for checking post status
 * before calling this function.
 *
 * @throws {PostServiceError} on DB failure
 */
export async function deletePost(
  clerkUserId: string,
  postId: string
): Promise<void> {
  const supabase = getSupabaseAdmin()
  const userId = await resolveSupabaseUserId(clerkUserId)

  const { error } = await supabase
    .from('posts')
    .delete()
    .eq('id', postId)
    .eq('user_id', userId)
    .select('id')
    .single()

  if (error) {
    // PGRST116: no row matched — already deleted (TOCTOU between pre-fetch and delete).
    if (error.code === 'PGRST116') {
      throw new PostServiceError('Post not found', 'NOT_FOUND', error)
    }
    throw new PostServiceError('Failed to delete post', 'DB_ERROR', error)
  }
}
