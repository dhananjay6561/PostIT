/**
 * Integration tests — POST/GET /api/posts, PATCH/DELETE /api/posts/:id
 *
 * Real Supabase test DB. Clerk auth() mocked to return deterministic IDs.
 * Two test users are seeded before the suite to verify data isolation.
 * All records are cleaned up in afterEach.
 */

import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// ---- Mocks ---------------------------------------------------------------

const mockAuth = jest.fn()

jest.mock('@clerk/nextjs/server', () => ({
  auth: mockAuth,
  clerkMiddleware: jest.fn(),
  createRouteMatcher: jest.fn(() => jest.fn()),
}))

// ---- Handlers (imported after mocks) ------------------------------------

import { POST, GET } from '@/app/api/posts/route'
import { PATCH, DELETE } from '@/app/api/posts/[id]/route'

// ---- Admin client -------------------------------------------------------

const admin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
)

// ---- Fixtures -----------------------------------------------------------

const USER_A_CLERK_ID = `test_posts_a_${Date.now()}`
const USER_B_CLERK_ID = `test_posts_b_${Date.now()}`

const VALID_VARIANTS = {
  twitter: 'Tweet text. #launch',
  linkedin: 'LinkedIn post text here.',
  instagram: 'Insta text! 🎉 #launch',
  facebook: 'Facebook post text here.',
}

const VALID_CREATE_BODY = {
  original_draft: 'Integration test draft',
  platform_variants: VALID_VARIANTS,
}

async function seedUser(clerkId: string) {
  const { data } = await admin
    .from('users')
    .insert({ clerk_user_id: clerkId, email: `${clerkId}@test.com` })
    .select('id')
    .single()
  return data!.id
}

// ---- Setup / Teardown ---------------------------------------------------

beforeAll(async () => {
  await seedUser(USER_A_CLERK_ID)
  await seedUser(USER_B_CLERK_ID)
})

afterEach(async () => {
  // Clean all posts for both test users after each test
  const { data: users } = await admin
    .from('users')
    .select('id')
    .in('clerk_user_id', [USER_A_CLERK_ID, USER_B_CLERK_ID])

  if (users && users.length > 0) {
    const ids = users.map((u) => u.id)
    await admin.from('posts').delete().in('user_id', ids)
  }
})

afterAll(async () => {
  await admin.from('users').delete().like('clerk_user_id', 'test_posts_%')
})

// ---- Request helpers ----------------------------------------------------

function postRequest(body: unknown) {
  return new NextRequest('http://localhost:3000/api/posts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function getRequest(query = '') {
  return new NextRequest(`http://localhost:3000/api/posts${query}`)
}

function patchRequest(id: string, body: unknown) {
  return new NextRequest(`http://localhost:3000/api/posts/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function deleteRequest(id: string) {
  return new NextRequest(`http://localhost:3000/api/posts/${id}`, { method: 'DELETE' })
}

function patchParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) }
}

// ---- POST /api/posts ----------------------------------------------------

describe('POST /api/posts', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue({ userId: null })
    const res = await POST(postRequest(VALID_CREATE_BODY))
    expect(res.status).toBe(401)
  })

  it('returns 201 and record exists in DB with correct platform_variants', async () => {
    mockAuth.mockResolvedValue({ userId: USER_A_CLERK_ID })
    const res = await POST(postRequest(VALID_CREATE_BODY))
    expect(res.status).toBe(201)

    const body = await res.json() as { id: string; status: string; platform_variants: typeof VALID_VARIANTS }
    expect(body.status).toBe('draft')
    expect(body.platform_variants).toMatchObject(VALID_VARIANTS)

    const { data } = await admin.from('posts').select('id').eq('id', body.id).single()
    expect(data).not.toBeNull()
  })

  it('returns 400 when original_draft is missing', async () => {
    mockAuth.mockResolvedValue({ userId: USER_A_CLERK_ID })
    const res = await POST(postRequest({ platform_variants: VALID_VARIANTS }))
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('validation_error')
  })

  it('returns 400 when platform_variants is incomplete', async () => {
    mockAuth.mockResolvedValue({ userId: USER_A_CLERK_ID })
    const res = await POST(postRequest({
      original_draft: 'Test',
      platform_variants: { twitter: 'only this' },
    }))
    expect(res.status).toBe(400)
  })
})

// ---- GET /api/posts -----------------------------------------------------

describe('GET /api/posts', () => {
  beforeEach(async () => {
    // Seed one post for User A and one for User B
    const [a, b] = await Promise.all([
      admin.from('users').select('id').eq('clerk_user_id', USER_A_CLERK_ID).single(),
      admin.from('users').select('id').eq('clerk_user_id', USER_B_CLERK_ID).single(),
    ])
    await admin.from('posts').insert([
      { user_id: a.data!.id, original_draft: 'Post A', platform_variants: VALID_VARIANTS, status: 'draft', media_urls: [] },
      { user_id: b.data!.id, original_draft: 'Post B', platform_variants: VALID_VARIANTS, status: 'draft', media_urls: [] },
    ])
  })

  it("returns only the authenticated user's posts — not other users'", async () => {
    mockAuth.mockResolvedValue({ userId: USER_A_CLERK_ID })
    const res = await GET(getRequest())
    expect(res.status).toBe(200)
    const body = await res.json() as { posts: Array<{ original_draft: string }> }
    expect(body.posts.every((p) => p.original_draft === 'Post A')).toBe(true)
    expect(body.posts.some((p) => p.original_draft === 'Post B')).toBe(false)
  })

  it('returns paginated response respecting page and limit params', async () => {
    mockAuth.mockResolvedValue({ userId: USER_A_CLERK_ID })
    const res = await GET(getRequest('?page=1&limit=5'))
    expect(res.status).toBe(200)
    const body = await res.json() as { page: number; limit: number; total: number }
    expect(body.page).toBe(1)
    expect(body.limit).toBe(5)
    expect(typeof body.total).toBe('number')
  })

  it('returns empty posts array with correct total for out-of-range page', async () => {
    mockAuth.mockResolvedValue({ userId: USER_A_CLERK_ID })
    const res = await GET(getRequest('?page=999&limit=10'))
    expect(res.status).toBe(200)
    const body = await res.json() as { posts: unknown[]; total: number }
    expect(body.posts).toHaveLength(0)
    expect(body.total).toBeGreaterThanOrEqual(1) // User A has 1 post
  })
})

// ---- PATCH /api/posts/:id -----------------------------------------------

describe('PATCH /api/posts/:id', () => {
  let postId: string

  beforeEach(async () => {
    mockAuth.mockResolvedValue({ userId: USER_A_CLERK_ID })
    const res = await POST(postRequest(VALID_CREATE_BODY))
    const body = await res.json() as { id: string }
    postId = body.id
  })

  it('returns 200 and updated fields reflect in DB', async () => {
    const res = await PATCH(patchRequest(postId, { original_draft: 'Updated draft' }), patchParams(postId))
    expect(res.status).toBe(200)

    const { data } = await admin.from('posts').select('original_draft').eq('id', postId).single()
    expect(data!.original_draft).toBe('Updated draft')
  })

  it('returns 404 for another user\'s post (not 403 — existence not revealed)', async () => {
    // Create a post as User B
    mockAuth.mockResolvedValue({ userId: USER_B_CLERK_ID })
    const resB = await POST(postRequest(VALID_CREATE_BODY))
    const { id: postBId } = await resB.json() as { id: string }

    // User A tries to patch User B's post
    mockAuth.mockResolvedValue({ userId: USER_A_CLERK_ID })
    const res = await PATCH(patchRequest(postBId, { original_draft: 'steal' }), patchParams(postBId))
    expect(res.status).toBe(404)
  })

  it('returns 400 for invalid status value', async () => {
    const res = await PATCH(
      patchRequest(postId, { status: 'published' }),
      patchParams(postId)
    )
    expect(res.status).toBe(400)
  })

  it('returns 404 for non-existent post ID', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000'
    const res = await PATCH(patchRequest(fakeId, { original_draft: 'x' }), patchParams(fakeId))
    expect(res.status).toBe(404)
  })
})

// ---- DELETE /api/posts/:id ----------------------------------------------

describe('DELETE /api/posts/:id', () => {
  let postId: string

  beforeEach(async () => {
    mockAuth.mockResolvedValue({ userId: USER_A_CLERK_ID })
    const res = await POST(postRequest(VALID_CREATE_BODY))
    const body = await res.json() as { id: string }
    postId = body.id
  })

  it('returns 204 and record no longer exists in DB', async () => {
    const res = await DELETE(deleteRequest(postId), patchParams(postId))
    expect(res.status).toBe(204)

    const { data } = await admin.from('posts').select('id').eq('id', postId)
    expect(data).toHaveLength(0)
  })

  it("returns 404 for another user's post", async () => {
    mockAuth.mockResolvedValue({ userId: USER_B_CLERK_ID })
    const resB = await POST(postRequest(VALID_CREATE_BODY))
    const { id: postBId } = await resB.json() as { id: string }

    mockAuth.mockResolvedValue({ userId: USER_A_CLERK_ID })
    const res = await DELETE(deleteRequest(postBId), patchParams(postBId))
    expect(res.status).toBe(404)
  })

  it('returns 404 for non-existent post', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000'
    const res = await DELETE(deleteRequest(fakeId), patchParams(fakeId))
    expect(res.status).toBe(404)
  })
})
