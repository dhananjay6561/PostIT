# PostPilot AI

AI-powered social post manager built on Next.js, Supabase, Clerk, and Google Gemini.

---

## CI Pipeline

Every push to `main` and every pull request runs a four-job pipeline. Jobs are chained — each must pass before the next starts.

```
lint-typecheck → unit-tests → integration-tests → build
```

### Jobs

| Job | What it checks | DB required |
|-----|---------------|-------------|
| `lint-typecheck` | ESLint (zero warnings) + `tsc --noEmit` | No |
| `unit-tests` | Pure logic + mocked handlers; 80 % coverage threshold | No |
| `integration-tests` | Route handlers against real Supabase test DB | Yes (test project) |
| `build` | `next build` succeeds with no type errors | No |

### Test layout

```
__tests__/
  unit/
    authMiddleware.test.ts   # 401 guard on GET /api/posts
    freeTierLimit.test.ts    # checkFreeTierLimit pure function
    aiPolish.test.ts         # Gemini service (mocked)
  integration/
    posts.test.ts            # POST/GET/PATCH/DELETE /api/posts
    aiPolishRoute.test.ts    # POST /api/ai/polish + counter increment
    rls.test.ts              # App-layer data isolation
    clerkWebhook.test.ts     # POST /api/webhooks/clerk
    accounts.test.ts         # 1D placeholder (describe.skip)
```

Adding tests for a new phase: drop a file into the appropriate folder. No changes to `ci.yml` or `jest.config.ts` needed.

### Running locally

```bash
# Copy env template and fill in real test-project credentials
cp .env.test.example .env.test

# Individual suites
npm run test:unit
npm run test:integration

# Full CI sequence (lint → typecheck → unit → integration → build)
npm run ci

# Coverage report (outputs to coverage/)
npm run test:coverage
```

### Required secrets (GitHub → Settings → Secrets)

| Secret | Used by |
|--------|---------|
| `SUPABASE_URL` | `integration-tests` |
| `SUPABASE_SERVICE_ROLE_KEY` | `integration-tests` |
| `CLERK_SECRET_KEY` | `integration-tests` (webhook verification mock) |
| `CLERK_WEBHOOK_SECRET` | `integration-tests` |

Gemini and Upstash are fully mocked in tests — no secrets needed for those services.

### Coverage artifact

After `unit-tests` completes, an `lcov` report is uploaded as a GitHub Actions artifact (`coverage-report`, retained 7 days). Download it from the workflow run's summary page.

### Concurrency

Runs on `ubuntu-latest`, Node 20. `npm ci` output is cached by `package-lock.json` hash. Concurrent runs on the same branch are cancelled automatically (`cancel-in-progress: true`).
