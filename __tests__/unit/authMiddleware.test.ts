/**
 * Unit tests — auth guard behaviour
 *
 * Tests that every protected route handler returns 401 when Clerk's auth()
 * resolves with no userId, and passes through when a userId is present.
 *
 * We test via the GET /api/posts handler as a representative protected route.
 * Supabase is mocked so no DB is needed.
 */

import { NextRequest } from 'next/server'

// ---- Mocks (must be declared before imports that use them) ---------------

jest.mock('@clerk/nextjs/server', () => ({
  auth: jest.fn(),
  clerkMiddleware: jest.fn(),
  createRouteMatcher: jest.fn(() => jest.fn()),
}))

jest.mock('@/lib/supabase/server', () => ({
  getSupabaseAdmin: jest.fn(() => ({
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      range: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: { id: 'uuid-1' }, error: null }),
    }),
  })),
}))

import { auth } from '@clerk/nextjs/server'
import { GET } from '@/app/api/posts/route'

const mockAuth = auth as jest.MockedFunction<typeof auth>

// ---- Helpers -------------------------------------------------------------

function makeGetRequest(url = 'http://localhost:3000/api/posts'): NextRequest {
  return new NextRequest(url)
}

// ---- Tests ---------------------------------------------------------------

describe('Auth guard — unauthenticated requests', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns 401 when auth() resolves with null userId', async () => {
    mockAuth.mockResolvedValue({ userId: null } as ReturnType<typeof auth> extends Promise<infer T> ? T : never)
    const res = await GET(makeGetRequest())
    expect(res.status).toBe(401)
  })

  it('returns 401 with correct error shape', async () => {
    mockAuth.mockResolvedValue({ userId: null } as ReturnType<typeof auth> extends Promise<infer T> ? T : never)
    const res = await GET(makeGetRequest())
    const body = await res.json() as { error: string; message: string }
    expect(body.error).toBe('unauthorized')
    expect(typeof body.message).toBe('string')
  })

  it('returns 401 when auth() resolves with undefined userId', async () => {
    mockAuth.mockResolvedValue({ userId: undefined } as ReturnType<typeof auth> extends Promise<infer T> ? T : never)
    const res = await GET(makeGetRequest())
    expect(res.status).toBe(401)
  })
})

describe('Auth guard — authenticated requests', () => {
  beforeEach(() => jest.clearAllMocks())

  it('does not return 401 when a valid userId is present', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_test_abc' } as ReturnType<typeof auth> extends Promise<infer T> ? T : never)

    // Supabase mock returns empty posts list — handler should succeed (200)
    const { getSupabaseAdmin } = jest.requireMock('@/lib/supabase/server') as {
      getSupabaseAdmin: jest.Mock
    }
    getSupabaseAdmin.mockReturnValue({
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        range: jest.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
        single: jest.fn().mockResolvedValue({ data: { id: 'uuid-1' }, error: null }),
      }),
    })

    const res = await GET(makeGetRequest())
    expect(res.status).not.toBe(401)
  })
})
