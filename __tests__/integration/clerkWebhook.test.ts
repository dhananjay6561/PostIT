/**
 * Integration tests — POST /api/webhooks/clerk
 *
 * Uses real Supabase test DB. Clerk's verifyWebhook is mocked so we can
 * inject arbitrary payloads without needing real svix signatures.
 * All inserted rows are cleaned up in afterEach.
 */

import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// ---- Mock verifyWebhook --------------------------------------------------

const mockVerifyWebhook = jest.fn()

jest.mock('@clerk/nextjs/webhooks', () => ({
  verifyWebhook: mockVerifyWebhook,
}))

// ---- Import handler after mocks are in place ----------------------------

import { POST } from '@/app/api/webhooks/clerk/route'

// ---- Supabase admin client (test DB) ------------------------------------

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
)

// ---- Helpers -------------------------------------------------------------

const TEST_CLERK_ID = `test_wh_${Date.now()}`
const TEST_EMAIL = `webhook-test-${Date.now()}@example.com`

function makeWebhookRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/webhooks/clerk', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}), // body is irrelevant — verifyWebhook is mocked
  })
}

function userCreatedPayload(clerkId: string, email: string) {
  return {
    type: 'user.created',
    data: {
      id: clerkId,
      primary_email_address_id: 'email_1',
      email_addresses: [{ id: 'email_1', email_address: email }],
      first_name: 'Test',
      last_name: 'User',
    },
  }
}

// ---- Cleanup -------------------------------------------------------------

afterEach(async () => {
  await supabase.from('users').delete().like('clerk_user_id', 'test_wh_%')
})

// ---- Tests ---------------------------------------------------------------

describe('POST /api/webhooks/clerk — user.created', () => {
  beforeEach(() => jest.clearAllMocks())

  it('inserts a user row with correct fields on valid webhook', async () => {
    mockVerifyWebhook.mockResolvedValue(userCreatedPayload(TEST_CLERK_ID, TEST_EMAIL))

    const res = await POST(makeWebhookRequest())
    expect(res.status).toBe(200)

    const { data } = await supabase
      .from('users')
      .select('clerk_user_id, email, plan')
      .eq('clerk_user_id', TEST_CLERK_ID)
      .single()

    expect(data).not.toBeNull()
    expect(data!.clerk_user_id).toBe(TEST_CLERK_ID)
    expect(data!.email).toBe(TEST_EMAIL)
    expect(data!.plan).toBe('free')
  })

  it('is idempotent — duplicate webhook does not create duplicate row', async () => {
    mockVerifyWebhook.mockResolvedValue(userCreatedPayload(TEST_CLERK_ID, TEST_EMAIL))

    await POST(makeWebhookRequest())
    const res2 = await POST(makeWebhookRequest())
    expect(res2.status).toBe(200)

    const { data } = await supabase
      .from('users')
      .select('id')
      .eq('clerk_user_id', TEST_CLERK_ID)

    expect(data).toHaveLength(1)
  })

  it('returns 200 and skips insert when email is missing from payload', async () => {
    mockVerifyWebhook.mockResolvedValue({
      type: 'user.created',
      data: {
        id: TEST_CLERK_ID,
        primary_email_address_id: null,
        email_addresses: [],
        first_name: 'No',
        last_name: 'Email',
      },
    })

    const res = await POST(makeWebhookRequest())
    expect(res.status).toBe(200)

    const { data } = await supabase
      .from('users')
      .select('id')
      .eq('clerk_user_id', TEST_CLERK_ID)

    expect(data).toHaveLength(0)
  })
})

describe('POST /api/webhooks/clerk — signature verification', () => {
  it('returns 400 and writes nothing when signature verification fails', async () => {
    mockVerifyWebhook.mockRejectedValue(new Error('invalid signature'))

    const res = await POST(makeWebhookRequest())
    expect(res.status).toBe(400)

    const { data } = await supabase
      .from('users')
      .select('id')
      .eq('clerk_user_id', TEST_CLERK_ID)

    expect(data).toHaveLength(0)
  })
})

describe('POST /api/webhooks/clerk — unsupported events', () => {
  it('returns 200 without writing to DB for unhandled event types', async () => {
    mockVerifyWebhook.mockResolvedValue({ type: 'user.deleted', data: { id: TEST_CLERK_ID } })

    const before = await supabase.from('users').select('id').eq('clerk_user_id', TEST_CLERK_ID)
    const res = await POST(makeWebhookRequest())
    expect(res.status).toBe(200)

    const after = await supabase.from('users').select('id').eq('clerk_user_id', TEST_CLERK_ID)
    expect(after.data).toHaveLength(before.data?.length ?? 0)
  })
})
