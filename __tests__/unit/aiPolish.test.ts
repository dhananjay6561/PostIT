/**
 * Unit tests — AI polish service (lib/gemini/polish.ts)
 *
 * Google Generative AI is mocked entirely — zero real API calls.
 * Tests verify the service contract: shape of returned variants,
 * character limits, and typed error propagation.
 */

// ---- Mock @google/generative-ai before importing the module under test ---

const mockGenerateContent = jest.fn()

jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({
      generateContent: mockGenerateContent,
    }),
  })),
}))

import { polishDraft, GeminiError } from '@/lib/gemini/polish'

// ---- Helpers -------------------------------------------------------------

const VALID_VARIANTS = {
  twitter: 'Launched my app! 🚀 #BuildInPublic #SoloFounder #Indie',
  linkedin: 'After months of work, I am excited to share my new productivity app with the world. It helps solo founders stay focused.',
  instagram: 'Big news! 🎉 My app is live!\n\n#BuildInPublic #SoloFounder #ProductivityApp #IndieHacker #Launch',
  facebook: 'Hey everyone! I just launched my new app. What are your biggest productivity challenges? #Productivity',
}

function mockSuccess(variants = VALID_VARIANTS): void {
  mockGenerateContent.mockResolvedValue({
    response: { text: () => JSON.stringify(variants) },
  })
}

const DRAFT = 'Just launched my productivity app after 6 months of building.'

// ---- Tests ---------------------------------------------------------------

beforeEach(() => jest.clearAllMocks())

describe('polishDraft — happy path', () => {
  it('returns all 4 platform variants', async () => {
    mockSuccess()
    const result = await polishDraft(DRAFT)
    expect(result).toHaveProperty('twitter')
    expect(result).toHaveProperty('linkedin')
    expect(result).toHaveProperty('instagram')
    expect(result).toHaveProperty('facebook')
  })

  it('each variant is a non-empty string', async () => {
    mockSuccess()
    const result = await polishDraft(DRAFT)
    for (const key of ['twitter', 'linkedin', 'instagram', 'facebook'] as const) {
      expect(typeof result[key]).toBe('string')
      expect(result[key].length).toBeGreaterThan(0)
    }
  })

  it('twitter variant is ≤ 280 characters', async () => {
    mockSuccess()
    const result = await polishDraft(DRAFT)
    expect(result.twitter.length).toBeLessThanOrEqual(280)
  })

  it('variants are distinct from the original draft', async () => {
    mockSuccess()
    const result = await polishDraft(DRAFT)
    for (const key of ['twitter', 'linkedin', 'instagram', 'facebook'] as const) {
      expect(result[key]).not.toBe(DRAFT)
    }
  })
})

describe('polishDraft — Gemini failures', () => {
  it('throws GeminiError when the API call rejects', async () => {
    mockGenerateContent.mockRejectedValue(new Error('network timeout'))
    await expect(polishDraft(DRAFT)).rejects.toThrow(GeminiError)
  })

  it('throws GeminiError when Gemini returns empty text', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => '' },
    })
    await expect(polishDraft(DRAFT)).rejects.toThrow(GeminiError)
  })

  it('throws GeminiError when response is not valid JSON', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => 'not json at all' },
    })
    await expect(polishDraft(DRAFT)).rejects.toThrow(GeminiError)
  })

  it('throws GeminiError when a required platform key is missing', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () =>
          JSON.stringify({ twitter: 'ok', linkedin: 'ok', instagram: 'ok' }),
        // facebook missing
      },
    })
    await expect(polishDraft(DRAFT)).rejects.toThrow(GeminiError)
  })

  it('thrown GeminiError name is "GeminiError"', async () => {
    mockGenerateContent.mockRejectedValue(new Error('timeout'))
    try {
      await polishDraft(DRAFT)
    } catch (err) {
      expect((err as GeminiError).name).toBe('GeminiError')
    }
  })
})
