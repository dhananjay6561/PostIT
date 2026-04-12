# Phase [1][A] — Foundation

> **Status:** `complete`
> **Branch:** `main`
> **Commit:** `fd35bc7`
> **Date:** 2026-04-12

---

## 1. Objective

The app had no database schema, no authentication layer, and no way to identify users across services. Without this, every subsequent phase would have no ground to stand on — no way to store data, no way to know who is making a request, and no way to safely sync identity from the auth provider into the database.

---

## 2. Scope

**In scope:**
- PostgreSQL schema: `users`, `connected_accounts`, `posts` tables + enum types
- Row-Level Security enabled and policies written for all 3 tables
- Supabase service-role client (server-only) and anon client (browser-safe)
- Clerk webhook handler (`POST /api/webhooks/clerk`) — listens for `user.created`, inserts row into `users`
- Next.js middleware — protects all `/api/*` routes, exempts `/api/webhooks/*`, returns `401 JSON` if unauthenticated
- TypeScript row and insert types for all 3 tables

**Out of scope / deferred:**
- Post CRUD operations (Phase 1C)
- Social account OAuth connect flow (Phase 1D)
- AI polish logic (Phase 1B)
- Frontend / UI (later phase)
- Monthly post counter reset job (Phase 2)

---

## 3. Design Decisions

| Decision | Chosen approach | Alternative rejected | Reason |
|----------|----------------|----------------------|--------|
| Auth provider | Clerk (external) | Supabase Auth | Clerk handles OAuth, session management, and org support out of the box; Supabase Auth would require rebuilding this |
| User identity sync | Clerk webhook (`user.created`) inserts into `users` | Pull user from Clerk API on every request | Webhook is event-driven and adds zero latency to API requests; polling Clerk on every request adds latency and a network dependency |
| Supabase client strategy | Service-role singleton for all server routes; separate anon client for browser | Single client for both | Service-role bypasses RLS — never safe to expose to the browser. Keeping them in separate files makes the distinction enforced by the module system |
| RLS approach | Policies written against `auth.uid()` (requires Clerk JWT template) | Skip RLS, do app-level filtering only | RLS provides defence-in-depth: even if a route incorrectly uses the anon key, data is still isolated per user |
| Webhook idempotency | `upsert` with `ignoreDuplicates: true` on `clerk_user_id` | Check-then-insert | Upsert is atomic — eliminates the race condition between check and insert when Clerk retries the same event |
| INSERT/DELETE RLS for `users` | No policy (blocks authenticated clients) | Allow authenticated INSERT | User rows are only ever created by the service-role webhook handler; blocking authenticated INSERT prevents self-registration bypass attacks |
| Middleware 401 response | JSON `{ error, message }` | Clerk default redirect to `/sign-in` | This is a backend-only API — clients are scripts or SPAs, not browsers navigating pages. A redirect is meaningless; a JSON 401 is actionable |

---

## 4. Implementation

### Endpoints / Features added

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/webhooks/clerk` | Receives `user.created` from Clerk, inserts user row into Supabase |

### Key files changed

```
supabase/migrations/
  20250412000001_create_enums.sql     ← plan_type, platform_type, post_status enums
  20250412000002_create_tables.sql    ← users, connected_accounts, posts + indexes
  20250412000003_rls_policies.sql     ← RLS enabled + per-operation policies on all 3 tables

lib/
  supabase/
    server.ts   ← getSupabaseAdmin() (service role singleton) + createUserSupabaseClient() factory
    client.ts   ← getSupabaseClient() (anon, browser-safe singleton)
  types/
    database.ts ← UserRow, ConnectedAccountRow, PostRow, UserInsert, etc.

app/
  api/webhooks/clerk/route.ts  ← POST handler: verify → extract email → upsert user

middleware.ts  ← clerkMiddleware: public = /api/webhooks/*, protected = /api/*
```

### Core logic (brief)

The webhook handler uses Clerk's `verifyWebhook(req)` which reads `CLERK_WEBHOOK_SECRET` and validates the svix signature before any payload is trusted. Email is resolved via `primary_email_address_id` first (the Clerk-recommended approach), falling back to `email_addresses[0]` — this handles cases where the primary ID and array order don't align. The `connected_accounts` table has a `UNIQUE (user_id, platform)` constraint so Phase 1D can safely upsert on reconnect without creating duplicates.

---

## 5. Testing

### What was tested

| Scenario | Type | Result |
|----------|------|--------|
| Clerk test event → no email in payload | Edge case | Handled — returns 200, skips insert, logs warning |
| Real user signup → `user.created` fires | Happy path (manual) | Pass — row appeared in Supabase `users` table |
| Webhook sent twice (retry simulation) | Idempotency | Pass — `posts_used_this_month` stays at 0, no duplicate row |
| `POST /api/ai/polish` with no token | Auth guard | Pass — 401 JSON returned by middleware |
| `GET /api/webhooks/clerk` (no auth) | Public route exemption | Pass — 405 (route exists, GET not handled) not 401 |
| Supabase URL placeholder | Misconfiguration | Failed fast — connection error surfaced immediately |

### Sample requests & responses

**Webhook — success**
```bash
# Triggered automatically by Clerk on user signup
# Terminal output:
[clerk-webhook] User synced to Supabase: { clerkUserId: 'user_3CFhQSvhijSdPGcHTKx7kzPAk4i', email: 'user@example.com' }
POST /api/webhooks/clerk 200 in 115ms
```

**Protected route — no token**
```bash
curl -X POST http://localhost:3000/api/ai/polish \
  -H "Content-Type: application/json" \
  -d '{"draft": "test"}'
```
```json
{
  "error": "Unauthorized",
  "message": "A valid session is required to access this endpoint."
}
```

---

## 6. Known Limitations

- [ ] RLS policies use `auth.uid()` which requires a Clerk JWT Template to be configured in Clerk Dashboard (mapping `sub` to the Clerk user ID). Without this, authenticated anon-key queries will return 0 rows. Phase 1 API routes all use the service-role client (bypasses RLS), so this does not affect functionality yet.
- [ ] `posts_used_this_month` has no reset mechanism — a monthly cron job to zero this column is deferred to Phase 2.
- [ ] No integration tests — only manual curl and Clerk dashboard testing at this stage.
- [ ] The `connected_accounts.access_token` column stores tokens as plain text — encryption at the application layer is noted in comments but not yet implemented (deferred to Phase 1D).

---

## 7. PR Summary

**What was added?**
- 3 SQL migrations: enums, tables (with indexes), RLS policies
- `lib/supabase/server.ts` — service-role client + user-scoped client factory
- `lib/supabase/client.ts` — anon browser client
- `lib/types/database.ts` — TypeScript row/insert types
- `POST /api/webhooks/clerk` — verified, idempotent Clerk webhook handler
- `middleware.ts` — Clerk auth guard returning 401 JSON on all `/api/*` except webhooks

**Why was it needed?**
No other phase can be built without a working database schema, a known user identity, and a secure API boundary.

**How was it tested?**
Real user signup via Clerk triggered the webhook; row confirmed in Supabase. Middleware tested by calling a protected route without a token. Idempotency confirmed by resending the same event twice — single row in DB.
