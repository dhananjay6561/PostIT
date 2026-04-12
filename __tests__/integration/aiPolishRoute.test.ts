/**
 * Integration tests — POST /api/ai/polish
 *
 * Real Supabase test DB. Gemini and Upstash are mocked entirely.
 * Clerk auth() is mocked to return a deterministic test userId.
 */

import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// ---- Mocks ---------------------------------------------------------------

const mockGenerateContent = jest.fn()

jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({
      generateContent: mockGenerateContent,
    }),
  })),
}))

jest.mock('@upstash/redis', () => ({
  Redis: { fromEnv: jest.fn().mockReturnValue({}) },
}))

const mockRatelimitFn = jest.fn()
jest.mock('@upstash/ratelimit', () => ({
  Ratelimit: jest.fn().mockImplementation(() => ({ limit: mockRatelimitFn })),
}))

const mockAuth = jest.fn()
jest.mock('@clerk/nextjs/server', () => ({
  auth: mockAuth,
  clerkMiddleware: jest.fn(),
  createRouteMatcher: jest.fn(() => jest.fn()),
}))

// ---- Handler (imported after mocks) -------------------------------------

import { POST } from '@/app/api/ai/polish/route'

// ---- Supabase admin (test DB) -------------------------------------------

const admin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
)

// ---- Test fixtures -------------------------------------------------------

const FREE_USER_CLERK_ID = `test_polish_free_${Date.now()}`
const PRO_USER_CLERK_ID = `test_polish_pro_${Date.now()}`

const VALID_VARIANTS = {
  twitter: 'Tweet text. #hashtag',
  linkedin: 'LinkedIn post text here with more detail.',
  instagram: 'Insta text! 🎉 #tag',
  facebook: 'Facebook post text here. What do you think?',
}

async function seedUser(clerkId: string, plan: 'free' | 'pro', postsUsed = 0) {
  const { data } = await admin
    .from('users')
    .insert({ clerk_user_id: clerkId, email: `${clerkId}@test.com`, plan, posts_used_this_month: postsUsed })
    .select('id')
    .single()
  return data!.id
}

function makeRequest(draft = 'Test draft content for AI polish') {
  return new NextRequest('http://localhost:3000/api/ai/polish', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ draft }),
  })
}

function mockRateLimitPass() {
  mockRatelimitFn.mockResolvedValue({
    success: true, limit: 10, remaining: 9, reset: Date.now() + 60000,
  })
}

function mockGeminiSuccess() {
  mockGenerateContent.mockResolvedValue({
    response: { text: () => JSON.stringify(VALID_VARIANTS) },
  })
}

// ---- Cleanup ------------------------------------------------------------

afterAll(async () => {
  await admin.from('users').delete().like('clerk_user_id', 'test_polish_%')
})

// ---- Tests ---------------------------------------------------------------

describe('POST /api/ai/polish — auth guard', () => {
  it('returns 401 with no session', async () => {
    mockAuth.mockResolvedValue({ userId: null })
    const res = await POST(makeRequest())
    expect(res.status).toBe(401)
  })
})

describe('POST /api/ai/polish — free user under limit', () => {
  beforeAll(async () => {
    await seedUser(FREE_USER_CLERK_ID, 'free', 5)
  })

  beforeEach(() => {
    mockAuth.mockResolvedValue({ userId: FREE_USER_CLERK_ID })
    mockRateLimitPass()
    mockGeminiSuccess()
  })

  afterEach(() => jest.clearAllMocks())

  it('returns 200 with all 4 platform variants', async () => {
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json() as { variants: typeof VALID_VARIANTS }
    expect(body.variants).toHaveProperty('twitter')
    expect(body.variants).toHaveProperty('linkedin')
    expect(body.variants).toHaveProperty('instagram')
    expect(body.variants).toHaveProperty('facebook')
  })

  it('increments posts_used_this_month by 1 after success', async () => {
    const before = await admin
      .from('users')
      .select('posts_used_this_month')
      .eq('clerk_user_id', FREE_USER_CLERK_ID)
      .single()

    await POST(makeRequest())

    const after = await admin
      .from('users')
      .select('posts_used_this_month')
      .eq('clerk_user_id', FREE_USER_CLERK_ID)
      .single()

    expect(after.data!.posts_used_this_month).toBe(before.data!.posts_used_this_month + 1)
  })
})

describe('POST /api/ai/polish — free user at limit', () => {
  const AT_LIMIT_ID = `test_polish_atlimit_${Date.now()}`

  beforeAll(async () => {
    await seedUser(AT_LIMIT_ID, 'free', 10)
  })

  it('returns 403 limit_reached when posts_used_this_month === 10', async () => {
    mockAuth.mockResolvedValue({ userId: AT_LIMIT_ID })
    mockRateLimitPass()

    const res = await POST(makeRequest())
    expect(res.status).toBe(403)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('limit_reached')
  })
})

describe('POST /api/ai/polish — pro user', () => {
  beforeAll(async () => {
    await seedUser(PRO_USER_CLERK_ID, 'pro', 10)
  })

  it('returns 200 even at 10+ posts used', async () => {
    mockAuth.mockResolvedValue({ userId: PRO_USER_CLERK_ID })
    mockRateLimitPass()
    mockGeminiSuccess()

    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
  })
})

describe('POST /api/ai/polish — input validation', () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue({ userId: FREE_USER_CLERK_ID })
    mockRateLimitPass()
  })

  it('returns 400 for empty draft', async () => {
    const req = new NextRequest('http://localhost:3000/api/ai/polish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ draft: '' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 for missing draft field', async () => {
    const req = new NextRequest('http://localhost:3000/api/ai/polish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})

describe('POST /api/ai/polish — Gemini failure', () => {
  beforeAll(async () => {
    // Ensure the free user still has posts remaining
    await admin
      .from('users')
      .update({ posts_used_this_month: 0 })
      .eq('clerk_user_id', FREE_USER_CLERK_ID)
  })

  it('returns 502 when Gemini returns empty response', async () => {
    mockAuth.mockResolvedValue({ userId: FREE_USER_CLERK_ID })
    mockRateLimitPass()
    mockGenerateContent.mockResolvedValue({ response: { text: () => '' } })

    const res = await POST(makeRequest())
    expect(res.status).toBe(502)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('ai_unavailable')
  })
})
