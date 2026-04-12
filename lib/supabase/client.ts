// ============================================================
// Supabase browser-safe client — ANON KEY
//
// Safe to import in client components ('use client').
// Subject to RLS — never bypasses row-level policies.
// Does NOT have access to SUPABASE_SERVICE_ROLE_KEY.
//
// Phase 1 note: All Phase 1 operations go through API routes
// (which use the service-role client). This module exists for
// Phase 2+ real-time subscriptions and any future client-side
// read operations.
// ============================================================

import { createClient, SupabaseClient } from '@supabase/supabase-js'

function requirePublicEnv(key: string): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(
      `Missing required public environment variable: ${key}. ` +
      'Ensure it is prefixed with NEXT_PUBLIC_ and set in .env.local.'
    )
  }
  return value
}

// Singleton for the browser — one instance across the page lifecycle.
let _browserClient: SupabaseClient | null = null

/**
 * Returns the Supabase anon client for browser use.
 * Subject to RLS. Never use for privileged server operations.
 */
export function getSupabaseClient(): SupabaseClient {
  if (_browserClient) return _browserClient

  _browserClient = createClient(
    requirePublicEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requirePublicEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      auth: {
        // Supabase Auth is not used — Clerk handles auth.
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    }
  )

  return _browserClient
}
