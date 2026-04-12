-- ============================================================
-- Migration: Enable RLS and create access policies
-- ============================================================
--
-- Architecture note:
--   All server-side API routes use the Supabase service-role client,
--   which bypasses RLS by design. These policies act as a defence-in-depth
--   layer that protects against:
--     1. Accidental use of the anon key in a server route
--     2. Any direct DB access that doesn't go through the API layer
--
-- Clerk JWT integration required for policies to match:
--   In Clerk Dashboard → JWT Templates → create a "supabase" template.
--   Set the `sub` claim to {{user.id}} (the Clerk user ID string).
--   Set the `role` claim to "authenticated".
--   Supabase will then populate auth.uid() with the Clerk user ID,
--   which matches the clerk_user_id column in the users table.
-- ============================================================

-- ------------------------------------------------------------
-- users
-- ------------------------------------------------------------
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Users may read only their own row
CREATE POLICY "users_select_own"
  ON users
  FOR SELECT
  TO authenticated
  USING (clerk_user_id = auth.uid()::text);

-- Users may update only their own row (no plan changes — that goes via Clerk webhook)
CREATE POLICY "users_update_own"
  ON users
  FOR UPDATE
  TO authenticated
  USING     (clerk_user_id = auth.uid()::text)
  WITH CHECK (clerk_user_id = auth.uid()::text);

-- INSERT is handled exclusively by the service-role Clerk webhook handler.
-- No authenticated INSERT policy → prevents self-registration bypass.

-- DELETE is handled exclusively by the service-role Clerk webhook handler.
-- No authenticated DELETE policy → prevents accidental self-deletion.

-- ------------------------------------------------------------
-- connected_accounts
-- ------------------------------------------------------------
ALTER TABLE connected_accounts ENABLE ROW LEVEL SECURITY;

-- Helper subquery: resolve the internal UUID for the calling Clerk user
-- Used in both USING and WITH CHECK clauses below.
CREATE POLICY "connected_accounts_select_own"
  ON connected_accounts
  FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT id FROM users WHERE clerk_user_id = auth.uid()::text)
  );

CREATE POLICY "connected_accounts_insert_own"
  ON connected_accounts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (SELECT id FROM users WHERE clerk_user_id = auth.uid()::text)
  );

CREATE POLICY "connected_accounts_update_own"
  ON connected_accounts
  FOR UPDATE
  TO authenticated
  USING     (user_id = (SELECT id FROM users WHERE clerk_user_id = auth.uid()::text))
  WITH CHECK (user_id = (SELECT id FROM users WHERE clerk_user_id = auth.uid()::text));

CREATE POLICY "connected_accounts_delete_own"
  ON connected_accounts
  FOR DELETE
  TO authenticated
  USING (
    user_id = (SELECT id FROM users WHERE clerk_user_id = auth.uid()::text)
  );

-- ------------------------------------------------------------
-- posts
-- ------------------------------------------------------------
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "posts_select_own"
  ON posts
  FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT id FROM users WHERE clerk_user_id = auth.uid()::text)
  );

CREATE POLICY "posts_insert_own"
  ON posts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (SELECT id FROM users WHERE clerk_user_id = auth.uid()::text)
  );

CREATE POLICY "posts_update_own"
  ON posts
  FOR UPDATE
  TO authenticated
  USING     (user_id = (SELECT id FROM users WHERE clerk_user_id = auth.uid()::text))
  WITH CHECK (user_id = (SELECT id FROM users WHERE clerk_user_id = auth.uid()::text));

CREATE POLICY "posts_delete_own"
  ON posts
  FOR DELETE
  TO authenticated
  USING (
    user_id = (SELECT id FROM users WHERE clerk_user_id = auth.uid()::text)
  );
