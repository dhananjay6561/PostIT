// ============================================================
// Shared post-related types.
// Used across API routes, service modules, and (later) the frontend.
// ============================================================

export type Platform = 'twitter' | 'linkedin' | 'instagram' | 'facebook'

export type PostStatus = 'draft' | 'queued' | 'scheduled' | 'published' | 'failed'


export interface PlatformVariants {
  twitter: string    // max 280 chars, punchy hook, 2-3 hashtags
  linkedin: string   // 150-300 words, professional, 3-5 hashtags
  instagram: string  // conversational, emojis, 5-10 hashtags
  facebook: string   // friendly, 100-200 words, CTA or question at end
}
