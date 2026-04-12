// ============================================================
// Post input validation
//
// All validation logic for post routes lives here.
// Route handlers call these functions and never duplicate
// validation rules inline.
// ============================================================

import type { PlatformVariants } from '@/types/posts'

const PLATFORMS = ['twitter', 'linkedin', 'instagram', 'facebook'] as const

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Returns true if the value is a well-formed UUID v4. */
export function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value)
}
const ALLOWED_UPDATE_STATUSES = ['draft', 'queued'] as const
const MAX_DRAFT_LENGTH = 2000

// Shape returned by validateUpdatePost on success.
// Only contains fields that are safe to write to the DB.
export interface PostUpdatePayload {
  original_draft?: string
  platform_variants?: PlatformVariants
  status?: 'draft' | 'queued'
  scheduled_at?: string | null
}

// ---- validateCreatePost ------------------------------------------------

export function validateCreatePost(
  body: unknown
): { valid: true } | { valid: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, error: 'Request body must be a JSON object.' }
  }

  const raw = body as Record<string, unknown>

  // original_draft
  if (
    typeof raw.original_draft !== 'string' ||
    raw.original_draft.trim().length === 0
  ) {
    return {
      valid: false,
      error: '`original_draft` must be a non-empty string.',
    }
  }

  if (raw.original_draft.length > MAX_DRAFT_LENGTH) {
    return {
      valid: false,
      error: `\`original_draft\` must not exceed ${MAX_DRAFT_LENGTH} characters.`,
    }
  }

  // platform_variants
  if (
    !raw.platform_variants ||
    typeof raw.platform_variants !== 'object' ||
    Array.isArray(raw.platform_variants)
  ) {
    return {
      valid: false,
      error: '`platform_variants` must be an object with all 4 platform keys.',
    }
  }

  const variants = raw.platform_variants as Record<string, unknown>

  for (const platform of PLATFORMS) {
    if (
      typeof variants[platform] !== 'string' ||
      (variants[platform] as string).trim().length === 0
    ) {
      return {
        valid: false,
        error: `\`platform_variants.${platform}\` must be a non-empty string.`,
      }
    }
  }

  return { valid: true }
}

// ---- validateUpdatePost ------------------------------------------------

export function validateUpdatePost(body: unknown):
  | { valid: true; data: PostUpdatePayload }
  | { valid: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, error: 'Request body must be a JSON object.' }
  }

  const raw = body as Record<string, unknown>
  const data: PostUpdatePayload = {}
  let hasField = false

  // original_draft (optional)
  if ('original_draft' in raw) {
    if (
      typeof raw.original_draft !== 'string' ||
      raw.original_draft.trim().length === 0
    ) {
      return {
        valid: false,
        error: '`original_draft` must be a non-empty string.',
      }
    }

    if (raw.original_draft.length > MAX_DRAFT_LENGTH) {
      return {
        valid: false,
        error: `\`original_draft\` must not exceed ${MAX_DRAFT_LENGTH} characters.`,
      }
    }

    data.original_draft = raw.original_draft
    hasField = true
  }

  // platform_variants (optional)
  if ('platform_variants' in raw) {
    if (
      !raw.platform_variants ||
      typeof raw.platform_variants !== 'object' ||
      Array.isArray(raw.platform_variants)
    ) {
      return {
        valid: false,
        error:
          '`platform_variants` must be an object with all 4 platform keys.',
      }
    }

    const variants = raw.platform_variants as Record<string, unknown>

    for (const platform of PLATFORMS) {
      if (
        typeof variants[platform] !== 'string' ||
        (variants[platform] as string).trim().length === 0
      ) {
        return {
          valid: false,
          error: `\`platform_variants.${platform}\` must be a non-empty string.`,
        }
      }
    }

    data.platform_variants = raw.platform_variants as PlatformVariants
    hasField = true
  }

  // status — only 'draft' | 'queued' allowed; 'published' and 'failed' are
  // system-managed and must never be settable via the API.
  if ('status' in raw) {
    if (
      !ALLOWED_UPDATE_STATUSES.includes(
        raw.status as (typeof ALLOWED_UPDATE_STATUSES)[number]
      )
    ) {
      return {
        valid: false,
        error: '`status` can only be set to "draft" or "queued".',
      }
    }

    data.status = raw.status as 'draft' | 'queued'
    hasField = true
  }

  // scheduled_at — ISO timestamp string or null
  if ('scheduled_at' in raw) {
    if (raw.scheduled_at !== null) {
      if (typeof raw.scheduled_at !== 'string') {
        return {
          valid: false,
          error:
            '`scheduled_at` must be a valid ISO timestamp string or null.',
        }
      }

      if (isNaN(Date.parse(raw.scheduled_at))) {
        return {
          valid: false,
          error:
            '`scheduled_at` must be a valid ISO timestamp string or null.',
        }
      }
    }

    data.scheduled_at = raw.scheduled_at as string | null
    hasField = true
  }

  if (!hasField) {
    return {
      valid: false,
      error:
        'Request body must include at least one updatable field: original_draft, platform_variants, status, or scheduled_at.',
    }
  }

  return { valid: true, data }
}
