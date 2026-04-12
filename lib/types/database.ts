// ============================================================
// Database type definitions — mirrors the Supabase schema.
// Import these everywhere instead of using inline object shapes.
// ============================================================

export type Plan = 'free' | 'pro'

export type Platform = 'twitter' | 'linkedin' | 'instagram' | 'facebook'

export type PostStatus = 'draft' | 'queued' | 'scheduled' | 'published' | 'failed'

// ---- Row types (what comes back from SELECT) ----

export interface UserRow {
  id: string
  clerk_user_id: string
  email: string
  plan: Plan
  posts_used_this_month: number
  created_at: string
}

export interface ConnectedAccountRow {
  id: string
  user_id: string
  platform: Platform
  access_token: string        // encrypted at rest
  refresh_token: string | null // encrypted at rest
  platform_user_id: string
  expires_at: string | null
  created_at: string
}

export interface PostRow {
  id: string
  user_id: string
  original_draft: string
  platform_variants: Record<Platform, string>
  status: PostStatus
  scheduled_at: string | null
  published_at: string | null
  media_urls: string[]
  created_at: string
}

// ---- Insert types (what you send on INSERT) ----

export type UserInsert = Pick<UserRow, 'clerk_user_id' | 'email'>

export type ConnectedAccountInsert = Omit<ConnectedAccountRow, 'id' | 'created_at'>

export type PostInsert = Pick<
  PostRow,
  'user_id' | 'original_draft' | 'platform_variants' | 'media_urls'
>
