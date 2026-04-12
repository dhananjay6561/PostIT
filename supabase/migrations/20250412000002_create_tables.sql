-- ============================================================
-- Migration: Create core tables
-- ============================================================

-- ------------------------------------------------------------
-- users
-- Synced from Clerk via webhook on user.created.
-- clerk_user_id is the authoritative identity link.
-- ------------------------------------------------------------
CREATE TABLE users (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id          TEXT NOT NULL,
  email                  TEXT NOT NULL,
  plan                   plan_type NOT NULL DEFAULT 'free',
  posts_used_this_month  INTEGER NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT users_clerk_user_id_unique UNIQUE (clerk_user_id)
);

-- Index for Clerk lookups (already indexed via UNIQUE, listed explicitly for clarity)
CREATE INDEX idx_users_clerk_user_id ON users (clerk_user_id);

-- ------------------------------------------------------------
-- connected_accounts
-- One row per user–platform pair.
-- access_token is stored encrypted at the app layer before insert.
-- ------------------------------------------------------------
CREATE TABLE connected_accounts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  platform          platform_type NOT NULL,
  access_token      TEXT NOT NULL,  -- encrypted before storage
  refresh_token     TEXT,           -- encrypted before storage (nullable)
  platform_user_id  TEXT NOT NULL,
  expires_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A user can only connect one account per platform
  CONSTRAINT connected_accounts_user_platform_unique UNIQUE (user_id, platform)
);

CREATE INDEX idx_connected_accounts_user_id ON connected_accounts (user_id);

-- ------------------------------------------------------------
-- posts
-- Stores the original draft plus AI-generated platform variants.
-- platform_variants shape: { "twitter": "...", "linkedin": "...", ... }
-- ------------------------------------------------------------
CREATE TABLE posts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  original_draft     TEXT NOT NULL,
  platform_variants  JSONB NOT NULL DEFAULT '{}',
  status             post_status NOT NULL DEFAULT 'draft',
  scheduled_at       TIMESTAMPTZ,
  published_at       TIMESTAMPTZ,
  media_urls         TEXT[] NOT NULL DEFAULT '{}',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_posts_user_id  ON posts (user_id);
CREATE INDEX idx_posts_status   ON posts (status);
-- Phase 2 will query by scheduled_at for the worker; index it now
CREATE INDEX idx_posts_scheduled_at ON posts (scheduled_at)
  WHERE scheduled_at IS NOT NULL;
