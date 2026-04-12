# Phase [1][B] — AI Polish Engine

> **Status:** `complete`
> **Branch:** `feature/1b-ai-polish-engine`
> **PR:** uncommitted (staged)
> **Date:** 2026-04-12

---

## 1. Objective

Users had no way to turn a rough draft into platform-ready copy, and there was no enforcement preventing free users from generating unlimited AI calls. This phase wires the Gemini API into a single endpoint that takes a raw draft and returns tailored variants for Twitter, LinkedIn, Instagram, and Facebook — while gating usage behind a per-user monthly limit and a per-minute rate limiter.

---

## 2. Scope

**In scope:**
- `POST /api/ai/polish` — auth, rate limiting, input validation, limit check, Gemini call, counter increment
- `lib/gemini/polish.ts` — Gemini 2.5 Flash client, prompt, JSON parsing, typed error
- `lib/limits/checkPostLimit.ts` — free (10/month) vs pro (unlimited) gate
- `supabase/migrations/20250412000004_add_increment_function.sql` — atomic Postgres increment function
- `types/posts.ts` — `PlatformVariants`, `Platform`, `PostStatus` shared types
- Upstash Redis sliding-window rate limiter (10 req/min per user)

**Out of scope / deferred:**
- Saving the polished variants to the `posts` table (Phase 1C)
- Monthly counter reset job (Phase 2)
- Streaming AI responses (not required for MVP)
- Per-platform regeneration (single call returns all 4 variants)
- Frontend / UI (later phase)

---

## 3. Design Decisions

| Decision | Chosen approach | Alternative rejected | Reason |
|----------|----------------|----------------------|--------|
| AI provider | Google Gemini 2.5 Flash (`@google/generative-ai`) | Anthropic Claude | Project requirement; Gemini free tier is sufficient for MVP testing |
| API call strategy | Single Gemini call returns all 4 variants as one JSON object | One call per platform (4 calls) | 4× cheaper, 4× faster, simpler error handling |
| Response format enforcement | `responseMimeType: 'application/json'` in `generationConfig` + markdown fence stripping as fallback | Prompt-only JSON instruction | Belt-and-suspenders: model-level config is more reliable than prompt-only, but stripping handles edge cases in both |
| Rate limiting | Upstash Redis sliding window, keyed by `clerkUserId` | In-memory Map | In-memory state is lost on cold starts and doesn't scale across multiple serverless instances; Redis is durable and shared |
| Usage counter increment | Postgres function `increment_posts_used(user_clerk_id)` called via `supabase.rpc()` | Read → increment → write in application code | The Postgres function is atomic — eliminates the race condition where two concurrent requests both read the same counter value and both increment from it |
| Counter increment timing | After successful AI response | Before AI call | Users should not be charged for failed Gemini calls; incrementing after success is the correct billing model |
| Gemini error exposure | `GeminiError` typed class; client receives `{ error: 'ai_unavailable' }` | Propagate raw Gemini error message | Raw SDK errors can expose model internals, quota details, and API key hints; none of that is safe to send to the client |
| Free plan limit | 10 posts/month, checked against `users.posts_used_this_month` | Token-based or time-window quota | Monthly post count is the most user-understandable limit and aligns with the billing model; already stored in the users table |

---

## 4. Implementation

### Endpoints / Features added

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/ai/polish` | Accepts `{ draft: string }`, returns `{ variants: PlatformVariants }` |

### Key files changed

```
types/
  posts.ts                   ← PlatformVariants, Platform, PostStatus

lib/
  gemini/
    polish.ts                ← GoogleGenerativeAI singleton, polishDraft(), GeminiError, prompt, validation
  limits/
    checkPostLimit.ts        ← free/pro gate; queries users.plan + posts_used_this_month

app/
  api/ai/polish/
    route.ts                 ← POST handler: auth → rate limit → validate → limit check → Gemini → increment

supabase/migrations/
  20250412000004_add_increment_function.sql  ← atomic UPDATE via Postgres function
  20250412000005_restrict_users_update_rls.sql  ← drops users_update_own policy (post-review security fix)
```

### Core logic (brief)

The Gemini prompt instructs the model to return a raw JSON object with exactly four string keys; `responseMimeType: 'application/json'` enforces this at the model level. The response is then validated key-by-key in `validateVariants()` — if any key is missing or empty, a `GeminiError` is thrown and the route returns `502`. The usage counter is incremented via `supabase.rpc('increment_posts_used')` only after a successful response, so a Gemini failure never consumes a user's monthly quota.

---

## 5. Testing

### What was tested

| Scenario | Type | Result |
|----------|------|--------|
| No auth token | Auth guard | Pass — 401 `unauthorized` |
| Empty body `{}` | Validation | Pass — 400 `missing_field` |
| `{ "draft": "" }` | Validation | Pass — 400 `invalid_draft` |
| Draft length 2001 chars | Validation | Pass — 400 `draft_too_long` with `received: 2001` |
| Valid draft, authenticated | Happy path | Pass — 200 with all 4 platform variants |
| Gemini quota exhausted (free tier) | External dependency | Pass — returned `502 ai_unavailable`; no Gemini internals exposed |
| Usage counter after success | DB side effect | Pass — `posts_used_this_month` incremented from 0 → 1 confirmed via Supabase REST API |

### Sample requests & responses

**Success case**
```bash
curl -X POST http://localhost:3000/api/ai/polish \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <clerk_jwt>" \
  -d '{"draft": "Just launched my new productivity app after 6 months of building in public. It helps solo founders track their weekly goals without the bloat of enterprise tools."}'
```
```json
{
  "variants": {
    "twitter": "Launched my new productivity app! 🚀 6 months of building in public. Solo founders, track weekly goals without enterprise bloat. #ProductivityApp #SoloFounder #BuildInPublic",
    "linkedin": "After six months of dedicated development and transparent iteration...",
    "instagram": "Guess what?! 🎉 My new productivity app is officially LIVE!...\n\n#ProductivityApp #SoloFounderLife",
    "facebook": "Hey everyone! I'm thrilled to share... What are your biggest challenges when it comes to tracking your goals? Let me know!\n#ProductivityApp"
  }
}
```

**Missing field**
```bash
curl -X POST http://localhost:3000/api/ai/polish \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <clerk_jwt>" \
  -d '{}'
```
```json
{
  "error": "missing_field",
  "message": "`draft` field is required."
}
```

**Limit reached (free tier exhausted)**
```json
{
  "error": "limit_reached",
  "message": "You have used all 10 free posts this month. Upgrade to Pro for unlimited posts.",
  "used": 10,
  "limit": 10,
  "upgrade": true
}
```

---

## 6. Known Limitations

- [ ] Twitter variant length is not hard-truncated to 280 chars — the prompt instructs compliance but Gemini occasionally drifts. A warning is logged server-side; truncation is not applied. This is acceptable for MVP.
- [ ] `posts_used_this_month` has no monthly reset — deferred to Phase 2 (cron job).
- [ ] Gemini free tier is 15 RPM — during testing, back-to-back requests hit quota. Not a production concern with paid billing.
- [ ] No integration tests — only manual curl testing at this stage.
- [ ] Upstash rate limit is per-user, not per-IP — a user with multiple clients could be inadvertently limited across devices. Acceptable for MVP.
- [ ] Check + increment are separate DB operations — two truly concurrent requests could both pass the limit gate. Mitigated in practice by the 10 req/min Upstash rate limiter. A single atomic `check_and_increment` RPC is the correct long-term fix; tracked for Phase 2.
- [x] ~~`users_update_own` RLS policy allowed authenticated clients to modify `plan` and `posts_used_this_month`~~ — fixed in `20250412000005_restrict_users_update_rls.sql`: policy dropped entirely since no authenticated client needs direct UPDATE on the users table in Phase 1.
- [x] ~~`ratelimit.limit()` had no error handling — Redis unavailability produced a raw unhandled 500~~ — fixed: wrapped in try/catch, returns `503 service_unavailable` with consistent `{ error, message }` shape.
- [x] ~~GeminiError message embedded up to 300 chars of model output (user draft content) in server logs~~ — fixed: logs `length=N` only; raw content never written to logs.

---

## 7. PR Summary

**What was added?**
- `types/posts.ts` — `PlatformVariants`, `Platform`, `PostStatus` shared types
- `lib/gemini/polish.ts` — Gemini 2.5 Flash client, single-call multi-platform prompt, JSON validation, `GeminiError`
- `lib/limits/checkPostLimit.ts` — free (10/month) vs pro (unlimited) usage gate
- `supabase/migrations/20250412000004_add_increment_function.sql` — atomic `increment_posts_used` Postgres function
- `supabase/migrations/20250412000005_restrict_users_update_rls.sql` — drops `users_update_own` policy (security fix from code review)
- `app/api/ai/polish/route.ts` — full pipeline: auth → Upstash rate limit → input validation → limit check → Gemini → atomic increment
- New dependencies: `@google/generative-ai`, `@upstash/ratelimit`, `@upstash/redis`

**Why was it needed?**
The core value proposition of PostPilot AI is AI-assisted multi-platform copy. Without this endpoint, the product does nothing useful. The rate limiter and usage gate are required from day one to prevent free-tier abuse.

**How was it tested?**
Manual curl testing against a live dev server with a real Clerk JWT. All validation branches confirmed with targeted bad inputs. Happy path confirmed with a real Gemini response. Counter increment verified by querying Supabase REST API after a successful call.
