
// Supabase server-side client — SERVICE ROLE
//
// NEVER import this file in client components or expose it
// to the browser. The service role key bypasses all RLS.
// Use it only inside:
//   - API route handlers (app/api/**)
//   - Server Actions
//   - Background workers


import { createClient, SupabaseClient } from '@supabase/supabase-js'

function requireEnv(key: string): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${key}. ` +
      'Check your .env.local file.'
    )
  }
  return value
}

// Singleton — created once per server process, not per request.
let _adminClient: SupabaseClient | null = null

/**
 * Returns the Supabase admin client (service role).
 * Bypasses all RLS. For server-only use.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (_adminClient) return _adminClient

  _adminClient = createClient(
    requireEnv('SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    {
      auth: {
        // Disable Supabase Auth entirely — we use Clerk.
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    }
  )

  return _adminClient
}

/**
 * Creates a per-request Supabase client scoped to a specific user
 * by attaching their Clerk-issued JWT.
 *
 * This client is subject to RLS policies.
 * Use for operations where row-level isolation should be enforced
 * at the DB layer in addition to the application layer.
 *
 * @param clerkToken - The Clerk JWT from `await auth().getToken({ template: 'supabase' })`
 */
export function createUserSupabaseClient(clerkToken: string): SupabaseClient {
  return createClient(
    requireEnv('SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      global: {
        headers: {
          Authorization: `Bearer ${clerkToken}`,
        },
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    }
  )
}
