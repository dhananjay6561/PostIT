-- ============================================================
-- Migration: Create shared enum types
-- ============================================================

-- User subscription plan
CREATE TYPE plan_type AS ENUM ('free', 'pro');

-- Supported social platforms
CREATE TYPE platform_type AS ENUM (
  'twitter',
  'linkedin',
  'instagram',
  'facebook'
);

-- Lifecycle states of a post
CREATE TYPE post_status AS ENUM (
  'draft',
  'queued',
  'scheduled',
  'published',
  'failed'
);
