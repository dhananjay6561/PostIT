# Phase 1 — Testing Infrastructure

Everything needed to run, extend, and understand the test suite for PostPilot AI.

---

## Overview

The test suite is split into two tiers. Each tier runs independently and in order in CI.

| Tier | Folder | DB required | Mocked |
|------|--------|-------------|--------|
| Unit | `__tests__/unit/` | No | Everything external (Clerk, Supabase, Gemini, Upstash) |
| Integration | `__tests__/integration/` | Yes (Supabase test project) | Clerk `auth()`, Gemini, Upstash |

Both tiers use `@swc/jest` for fast TypeScript compilation. No Babel, no `ts-jest`.

---

## Running Tests Locally

```bash
# 1. Create .env.test with the following vars (git-ignored, never commit):
#
# Real credentials (integration tests hit a live test DB):
#   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_ANON_KEY
#   CLERK_SECRET_KEY, CLERK_WEBHOOK_SECRET, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
#
# Stub values are fine (modules validate env at init even when the SDK is mocked):
#   GEMINI_API_KEY=stub
#   UPSTASH_REDIS_REST_URL=http://stub
#   UPSTASH_REDIS_REST_TOKEN=stub

# 2. Run each tier independently
npm run test:unit
npm run test:integration

# 3. Run everything including lint, typecheck, and build (mirrors CI exactly)
npm run ci

# 4. Coverage report — output written to coverage/
npm run test:coverage
```

---

## CI Pipeline

Four jobs run in strict sequence on every push to `main` and every pull request:

```
lint-typecheck → unit-tests → integration-tests → build
```

| Job | Command | Secrets needed |
|-----|---------|---------------|
| `lint-typecheck` | `next lint --max-warnings 0` + `tsc --noEmit` | None |
| `unit-tests` | `jest --testPathPattern=__tests__/unit --coverage` | None (all stubbed) |
| `integration-tests` | `jest --testPathPattern=__tests__/integration` | Supabase test DB, Clerk |
| `build` | `next build` | None (all stubbed) |

A coverage artifact (`lcov` format) is uploaded after `unit-tests` and retained for 7 days. Download from the GitHub Actions run summary.

Concurrent runs on the same branch are cancelled automatically (`cancel-in-progress: true`).

**GitHub secrets required** (Settings → Secrets → Actions):

| Secret | Used by |
|--------|---------|
| `SUPABASE_TEST_URL` | integration-tests |
| `SUPABASE_TEST_KEY` | integration-tests (service role) |
| `SUPABASE_TEST_ANON_KEY` | integration-tests |
| `CLERK_SECRET_KEY` | integration-tests |
| `CLERK_WEBHOOK_SECRET` | integration-tests |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | integration-tests |

---

## Test Files

### Unit Tests (`__tests__/unit/`)

#### `freeTierLimit.test.ts`
Tests the `checkFreeTierLimit` pure function in `lib/limits/checkPostLimit.ts`.

No mocking needed — the function takes `(postsUsedThisMonth, plan)` and returns a `PostLimitResult`. This is the canonical example of logic extracted specifically to be unit-testable.

| Case | Expected |
|------|----------|
| free, 0 used | `allowed: true` |
| free, 9 used | `allowed: true` |
| free, 10 used | `allowed: false` |
| free, 15 used | `allowed: false` |
| pro, 10 used | `allowed: true`, `limit: -1` |
| pro, 1000 used | `allowed: true` |
| invalid plan `"enterprise"` | throws `InvalidPlanError` |

#### `authMiddleware.test.ts`
Tests that every protected route returns `401` when `auth()` resolves with no `userId`.

Uses `GET /api/posts` as the representative handler. Supabase is mocked to avoid any DB setup. Covers `null` userId, `undefined` userId, and a valid userId (should not 401).

#### `aiPolish.test.ts`
Tests the `polishDraft` service function in `lib/gemini/polish.ts`.

`@google/generative-ai` is mocked via `mockGenerateContent`. Verifies: all 4 platform variants are returned, each is a non-empty string, Twitter variant is ≤ 280 characters, and variants differ from the original draft.

Error cases: API rejection → `GeminiError`, empty response text → `GeminiError`, non-JSON response → `GeminiError`, missing platform key → `GeminiError`.

---

### Integration Tests (`__tests__/integration/`)

All integration tests use a real Supabase **test project** (never production). Test users are created with timestamped `clerk_user_id` prefixes (e.g. `test_posts_a_1234567890`) to prevent cross-run collisions. All records are cleaned up in `afterEach` / `afterAll`.

#### `posts.test.ts`
Full CRUD coverage for `POST /api/posts`, `GET /api/posts`, `PATCH /api/posts/:id`, `DELETE /api/posts/:id`.

Two test users (User A, User B) are seeded before the suite to verify data isolation. Cross-user access consistently returns `404` — not `403` — so post existence is never revealed to a different user.

| Suite | Key cases |
|-------|-----------|
| `POST /api/posts` | 401 unauthenticated, 201 + DB record, 400 missing `original_draft`, 400 incomplete `platform_variants` |
| `GET /api/posts` | Only own posts returned, pagination params respected, empty page returns correct `total` |
| `PATCH /api/posts/:id` | 200 + DB reflects update, 404 for another user's post, 400 invalid status, 404 non-existent ID |
| `DELETE /api/posts/:id` | 204 + record gone from DB, 404 for another user's post, 404 non-existent ID |

Note: Next.js 16 uses async route params (`Promise<{ id: string }>`). The `patchParams(id)` helper wraps the ID with `Promise.resolve({ id })` to match the handler signature.

#### `aiPolishRoute.test.ts`
Tests `POST /api/ai/polish` against the real Supabase DB (for counter increment checks). Gemini and Upstash are fully mocked.

| Suite | Key cases |
|-------|-----------|
| Auth guard | 401 with no session |
| Free user under limit | 200 + all 4 variants, `posts_used_this_month` increments by exactly 1 |
| Free user at limit | 403 `limit_reached` when `posts_used_this_month === 10` |
| Pro user | 200 even at 10+ posts used |
| Input validation | 400 empty draft, 400 missing draft field |
| Gemini failure | 502 `ai_unavailable` when Gemini returns empty text |

#### `rls.test.ts`
Verifies application-layer data isolation — that every service function scopes its query to the authenticated user's UUID.

Seeds User A and User B with posts, then calls `getPosts` and `getPostById` directly (not through HTTP). User A cannot see User B's data and vice versa. Also tests `connected_accounts` scoping.

> Full RLS policy verification at the database level (anon key + Clerk JWT) requires a local Supabase instance with the matching JWT secret. This is handled by Supabase migration tests, not this suite.

#### `clerkWebhook.test.ts`
Tests `POST /api/webhooks/clerk`. `verifyWebhook` from `@clerk/nextjs/webhooks` is mocked to inject arbitrary payloads.

| Case | Expected |
|------|----------|
| Valid `user.created` | 200, user row inserted with correct `clerk_user_id`, `email`, `plan: 'free'` |
| Duplicate `user.created` | 200, only 1 row in DB (idempotent) |
| `user.created` with no email | 200, no row inserted |
| Signature verification fails | 400, no row inserted |
| Unhandled event type (`user.deleted`) | 200, DB unchanged |

#### `accounts.test.ts`
Placeholder for Phase 1D (Social OAuth + Publish). All cases are wrapped in `describe.skip` and use `it.todo`. When Phase 1D is built, remove `.skip` — no changes to `ci.yml` or `jest.config.ts` are needed.

---

## Configuration Files

### `jest.config.ts`
Two Jest projects (`unit`, `integration`) sharing a common base config:
- **Transformer**: `@swc/jest` with `{ module: { type: 'commonjs' } }`
- **Module alias**: `@/*` → `<rootDir>/*` (matches `tsconfig.json` paths)
- **Transform ignore**: next, `@clerk/nextjs`, `@clerk/backend`, `@supabase/supabase-js` are compiled (they ship ESM)
- **Coverage**: from `lib/**/*.ts` only; threshold 80% lines / functions / branches (API routes are covered by integration tests, not unit tests)
- **Reporters**: `lcov` (artifact) + `text-summary` (CI log output)

### `jest.setup.ts`
Runs before every test file. Loads `.env.test` via `dotenv` so integration tests can read real credentials without requiring `dotenv.config()` in each file.

---

## Adding Tests for a New Phase

1. Drop unit tests into `__tests__/unit/<phase>.test.ts`
2. Drop integration tests into `__tests__/integration/<phase>.test.ts`
3. Remove `describe.skip` from the placeholder in `accounts.test.ts` when Phase 1D ships

No changes to `jest.config.ts`, `ci.yml`, or `package.json` are required.

---

## Coverage Threshold

80% lines, functions, and branches globally across `lib/`. The CI unit job collects coverage only from `lib/**/*.ts` — API route handlers live in `app/api/` and are exercised by integration tests, not the unit suite. Run `npm run test:coverage` locally to check before pushing.

```
npm run test:coverage
# → opens coverage/lcov-report/index.html for a full line-by-line view
```
