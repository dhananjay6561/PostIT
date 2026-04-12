// ============================================================
// Gemini AI polish service
//
// Wraps the Google Generative AI SDK.
// Single responsibility: take a raw draft, return 4 platform variants.
// Never called directly from route handlers — always via the polish route.
// ============================================================

import { GoogleGenerativeAI, type GenerativeModel } from '@google/generative-ai'
import type { PlatformVariants } from '@/types/posts'

// ---- Typed error -------------------------------------------------------

export class GeminiError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = 'GeminiError'
  }
}

// ---- Client singleton --------------------------------------------------

function requireEnv(key: string): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`)
  }
  return value
}

let _model: GenerativeModel | null = null

function getModel(): GenerativeModel {
  if (_model) return _model

  const genAI = new GoogleGenerativeAI(requireEnv('GEMINI_API_KEY'))

  _model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      // Force JSON-only output at the model level.
      // The prompt also instructs JSON-only as a belt-and-suspenders measure.
      responseMimeType: 'application/json',
      temperature: 0.7,
    },
  })

  return _model
}

// ---- Prompt ------------------------------------------------------------

function buildPrompt(draft: string): string {
  return `You are a professional social media copywriter. Rewrite the following draft for 4 platforms.

Return ONLY a valid JSON object with exactly these 4 keys: twitter, linkedin, instagram, facebook.
No markdown, no code fences, no explanation, no preamble. Raw JSON only.

Platform requirements:
- twitter: maximum 280 characters total (strictly enforced), punchy hook in the first line, 2-3 relevant hashtags included in the 280 chars
- linkedin: professional tone, 150-300 words, insight-driven narrative, 3-5 hashtags at the very end
- instagram: conversational tone, use emojis naturally throughout, 5-10 hashtags at the end, use line breaks for readability
- facebook: friendly and warm tone, 100-200 words, end with a question or a clear call-to-action, 1-2 hashtags max

Draft to rewrite:
${draft}`
}

// ---- Validation --------------------------------------------------------

const REQUIRED_KEYS: Array<keyof PlatformVariants> = [
  'twitter',
  'linkedin',
  'instagram',
  'facebook',
]

function validateVariants(parsed: unknown): PlatformVariants {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new GeminiError('Gemini response is not a JSON object')
  }

  const obj = parsed as Record<string, unknown>

  for (const key of REQUIRED_KEYS) {
    if (typeof obj[key] !== 'string' || (obj[key] as string).trim().length === 0) {
      throw new GeminiError(
        `Gemini response is missing or has an empty value for field: "${key}"`
      )
    }
  }

  // Warn (don't fail) if Twitter exceeds the character limit.
  // The prompt instructs compliance; Gemini occasionally drifts slightly.
  const twitterText = obj.twitter as string
  if (twitterText.length > 280) {
    console.warn(
      `[gemini] Twitter variant exceeds 280 chars (${twitterText.length}). ` +
        'Prompt compliance drift detected.'
    )
  }

  return {
    twitter: obj.twitter as string,
    linkedin: obj.linkedin as string,
    instagram: obj.instagram as string,
    facebook: obj.facebook as string,
  }
}

// ---- Public API --------------------------------------------------------

/**
 * Takes a raw draft and returns AI-polished variants for all 4 platforms.
 *
 * @throws {GeminiError} on API failure or unparseable/invalid response
 */
export async function polishDraft(draft: string): Promise<PlatformVariants> {
  const model = getModel()

  let rawText: string

  try {
    const result = await model.generateContent(buildPrompt(draft))
    rawText = result.response.text()
  } catch (err) {
    throw new GeminiError('Gemini API call failed', err)
  }

  // Strip markdown fences as a safety net, even though responseMimeType is set.
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  let parsed: unknown

  try {
    parsed = JSON.parse(cleaned)
  } catch (err) {
    throw new GeminiError(
      `Gemini returned non-JSON content: "${cleaned.slice(0, 300)}"`,
      err
    )
  }

  return validateVariants(parsed)
}
