-- ============================================================
-- Migration: Atomic post usage counter increment
--
-- Using a Postgres function instead of a read-modify-write in
-- application code eliminates the race condition that occurs when
-- two concurrent requests both read the same counter value and
-- both increment from it.
-- ============================================================

CREATE OR REPLACE FUNCTION increment_posts_used(user_clerk_id TEXT)
RETURNS VOID
LANGUAGE SQL
AS $$
  UPDATE users
  SET posts_used_this_month = posts_used_this_month + 1
  WHERE clerk_user_id = user_clerk_id;
$$;
