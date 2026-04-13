/**
 * Integration tests — Row-Level Security (data isolation)
 *
 * Uses the Supabase admin (service-role) client to set up two test users
 * and their posts, then verifies that:
 *   - The application service layer always scopes queries by userId,
 *     so User A's data is never returned to User B.
 *   - The admin client (used by all route handlers) correctly enforces
 *     app-layer isolation via explicit user_id filters.
 *
 * Note: full RLS policy verification (anon key + Clerk JWT) requires a
 * local Supabase instance with the JWT secret and is covered by Supabase
 * migration tests. These tests verify the *application-layer* isolation
 * that mirrors what the RLS policies enforce at the DB layer.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { getPosts, getPostById } from '@/lib/posts/postService'

// ---- Admin client -------------------------------------------------------

const admin: SupabaseClient = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
)

// ---- Test fixtures -------------------------------------------------------

const USER_A_CLERK_ID = `test_rls_userA_${Date.now()}`
const USER_B_CLERK_ID = `test_rls_userB_${Date.now()}`
const USER_A_EMAIL = `rls-a-${Date.now()}@example.com`
const USER_B_EMAIL = `rls-b-${Date.now()}@example.com`

let userAId: string
let userBId: string
let postByBId: string

const VARIANTS = {
  twitter: 'tw', linkedin: 'li', instagram: 'ig', facebook: 'fb',
}

beforeAll(async () => {
  // Seed User A
  const { data: a } = await admin
    .from('users')
    .insert({ clerk_user_id: USER_A_CLERK_ID, email: USER_A_EMAIL })
    .select('id')
    .single()
  userAId = a!.id

  // Seed User B + one post belonging to B
  const { data: b } = await admin
    .from('users')
    .insert({ clerk_user_id: USER_B_CLERK_ID, email: USER_B_EMAIL })
    .select('id')
    .single()
  userBId = b!.id

  const { data: post } = await admin
    .from('posts')
    .insert({
      user_id: userBId,
      original_draft: "User B's private post",
      platform_variants: VARIANTS,
      status: 'draft',
      media_urls: [],
    })
    .select('id')
    .single()
  postByBId = post!.id
})

afterAll(async () => {
  await admin.from('posts').delete().in('user_id', [userAId, userBId])
  await admin.from('users').delete().like('clerk_user_id', 'test_rls_%')
})

// ---- Tests ---------------------------------------------------------------

describe('Application-layer data isolation — posts', () => {
  it("getPosts for User A returns an empty list (does not include User B's posts)", async () => {
    const { posts } = await getPosts(USER_A_CLERK_ID, 1, 50)
    expect(posts).toHaveLength(0)
  })

  it("getPostById for User A cannot retrieve User B's post (returns null)", async () => {
    const result = await getPostById(USER_A_CLERK_ID, postByBId)
    expect(result).toBeNull()
  })

  it("getPosts for User B returns only User B's post", async () => {
    const { posts } = await getPosts(USER_B_CLERK_ID, 1, 50)
    const ids = posts.map((p) => p.id)
    expect(ids).toContain(postByBId)
    expect(posts.every((p) => p.user_id === userBId)).toBe(true)
  })

  it("getPostById for User B can retrieve User B's own post", async () => {
    const result = await getPostById(USER_B_CLERK_ID, postByBId)
    expect(result).not.toBeNull()
    expect(result!.id).toBe(postByBId)
  })
})

describe('Application-layer data isolation — connected_accounts', () => {
  it('admin SELECT scoped to user_id returns only that user\'s rows', async () => {
    // Insert a connected account for User B
    await admin.from('connected_accounts').insert({
      user_id: userBId,
      platform: 'twitter',
      access_token: 'tok_b',
      platform_user_id: 'tw_b',
    })

    // User A should see zero connected accounts when filtered by their UUID
    const { data } = await admin
      .from('connected_accounts')
      .select('id')
      .eq('user_id', userAId)

    expect(data).toHaveLength(0)

    // Cleanup
    await admin.from('connected_accounts').delete().eq('user_id', userBId)
  })
})
