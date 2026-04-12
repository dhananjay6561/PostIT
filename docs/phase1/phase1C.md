# Phase [1][C] — Post Management

> **Status:** `complete`
> **Branch:** `feature/1c-post-management`
> **PR:** uncommitted (staged)
> **Date:** 2026-04-12

---

## 1. Objective

Users had no way to create, retrieve, update, or delete posts. The AI polish engine (Phase 1B) could generate platform variants but had nowhere to save them. This phase builds the full post CRUD layer — a service module that owns all DB operations, a reusable validation module, and four route handlers — so that polished content can be persisted and managed before Phase 1D publishes it.

---

## 2. Scope

**In scope:**
- `POST /api/posts` — create a draft post with all 4 platform variants
- `GET /api/posts` — paginated post list for the authenticated user, newest-first
- `PATCH /api/posts/:id` — partial update; enforces immutability on published/failed posts
- `DELETE /api/posts/:id` — delete; blocks deletion of published posts
- `lib/posts/postService.ts` — all DB operations; no raw Supabase queries in route handlers
- `lib/validation/posts.ts` — reusable input validation for create and update payloads

**Out of scope / deferred:**
- Social OAuth and publish-to-platform (Phase 1D)
- Attaching media to posts (`media_urls`) — field exists in schema, writable in Phase 1D
- Rate limiting on CRUD endpoints (noted in Known Limitations)
- Frontend / UI (later phase)

---

## 3. Design Decisions

| Decision | Chosen approach | Alternative rejected | Reason |
|----------|----------------|----------------------|--------|
| DB operations location | All in `lib/posts/postService.ts` | Raw queries in route handlers | Single responsibility — route handlers handle HTTP, the service handles data. Easier to test, no logic duplication |
| User ID resolution | `resolveSupabaseUserId()` translates Clerk ID → Supabase UUID inside every service function | Pass Supabase UUID from route handler | Route handlers should not know about the internal ID mapping; keeping the translation inside the service makes the boundary clean |
| Ownership enforcement | Every query filters by both `id` AND `user_id` | Rely on RLS alone | Defence-in-depth — service-role client bypasses RLS, so application-layer user filtering is mandatory |
| Immutable statuses | `published` and `failed` block edits; `published` blocks delete | Allow all mutations | Published posts are public record; modifying or deleting them after the fact would create inconsistencies with what was actually sent to social platforms |
| Status update restriction | Users can only set `draft` or `queued`; `published`/`failed` are system-managed | Allow any status via API | Prevents clients from manually short-circuiting the publish pipeline or faking successful publishes |
| UUID validation | `isValidUuid()` checks route params before hitting DB | Let Supabase reject invalid types | Non-UUID param causes a `22P02` type-mismatch error at the DB layer, which maps to 500. Validating upfront returns a clean 404 and avoids a wasted DB round-trip |
| Out-of-range pagination | Detect PostgREST `PGRST103`, fire a count-only follow-up query, return `{ posts: [], total: N }` | Return 500 or 400 | `PGRST103` is not a DB error — it means the client asked for a page that doesn't exist. Returning the real total lets clients know how many pages actually exist |
| Validation module | Separate `lib/validation/posts.ts` with explicit per-field errors | Inline validation in route handlers | Keeps route handlers readable; validation rules are reusable and testable in isolation |

---

## 4. Implementation

### Endpoints added

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/posts` | Create a draft post; expects `original_draft` + `platform_variants` |
| GET | `/api/posts` | Paginated list; query params `page` (default 1), `limit` (default 10, max 50) |
| PATCH | `/api/posts/:id` | Partial update; allowed fields: `original_draft`, `platform_variants`, `status` (`draft`\|`queued`), `scheduled_at` |
| DELETE | `/api/posts/:id` | Delete a post; blocked if status is `published` |

### Key files added

```
lib/
  validation/
    posts.ts          ← validateCreatePost(), validateUpdatePost(), isValidUuid(), PostUpdatePayload
  posts/
    postService.ts    ← PostServiceError, resolveSupabaseUserId(), createPost(), getPosts(),
                         getPostById(), updatePost(), deletePost()

app/
  api/posts/
    route.ts          ← POST handler (create) + GET handler (paginated list)
    [id]/
      route.ts        ← PATCH handler (update) + DELETE handler (delete)

scripts/
  test-posts.sh       ← curl-based test suite for all 4 endpoints
```

### Core logic (brief)

Every service function calls `resolveSupabaseUserId()` first, translating the Clerk user ID to the internal Supabase UUID. All subsequent queries filter by `user_id` explicitly — a user can never read or mutate another user's posts even though the admin client bypasses RLS.

PATCH and DELETE both fetch the post first via `getPostById()` before acting. This gives the route clean 404s on missing/unowned posts and lets it enforce status-based immutability rules before touching the DB.

Pagination uses Supabase's `.range(from, to)` with `count: 'exact'`. When the requested range exceeds the data (PostgREST `PGRST103`), a lightweight `head: true` count query is fired and the route returns `{ posts: [], total: N }` so clients always know the real total.

---

## 5. Security Notes

| Area | Risk | Mitigation |
|------|------|------------|
| Cross-user data access | Admin client bypasses RLS | Every query explicitly filters by resolved `user_id` |
| Non-UUID route params | DB type mismatch returns 500 | `isValidUuid()` validates `postId` before any DB call; returns 404 |
| Arbitrary field injection on update | Client could try to set `user_id`, `published_at`, etc. | `validateUpdatePost()` returns only the 4 explicitly allowed fields; all other keys are dropped |
| Status escalation | Client setting `status: "published"` directly | Validation rejects any status other than `draft` or `queued` |
| SQL injection | All user input into DB queries | Supabase query builder uses parameterized queries throughout; no raw SQL |
| Auth bypass | Request with no token | Middleware returns 401 before route runs; route also calls `auth()` for belt-and-suspenders |

---

## 6. Testing

### What was tested

| Scenario | Type | Result |
|----------|------|--------|
| No token on all 4 routes | Auth guard | Pass — 401 on all |
| Missing `original_draft` | Validation | Pass — 400 `validation_error` |
| Empty `original_draft` | Validation | Pass — 400 |
| `original_draft` > 2000 chars | Validation | Pass — 400 with message |
| Missing `platform_variants` | Validation | Pass — 400 |
| `platform_variants` missing one key | Validation | Pass — 400 naming the missing platform |
| `platform_variants` empty string value | Validation | Pass — 400 naming the bad platform |
| Malformed JSON body | Body parsing | Pass — 400 `invalid_json` |
| Valid create request | Happy path | Pass — 201, `status: "draft"`, real UUID returned |
| GET with no params | List | Pass — `page: 1`, `limit: 10`, posts array, total |
| GET newest-first ordering | Ordering | Pass — second post appeared first |
| GET `?page=2&limit=5` (beyond data) | Pagination edge case | Pass — `{ posts: [], total: 2 }` after PGRST103 fix |
| GET `?limit=999` | Limit clamping | Pass — clamped to 50 |
| GET `?limit=abc` | Bad param | Pass — defaults to 10 |
| PATCH `original_draft` | Update | Pass — field updated |
| PATCH `status: "queued"` | Status update | Pass |
| PATCH `status: "published"` | Blocked status | Pass — 400 |
| PATCH `status: "failed"` | Blocked status | Pass — 400 |
| PATCH `scheduled_at` ISO string | Scheduling | Pass |
| PATCH `scheduled_at: null` | Clear schedule | Pass |
| PATCH invalid `scheduled_at` | Validation | Pass — 400 |
| PATCH unknown field only | No valid fields | Pass — 400 |
| PATCH non-existent post ID | Not found | Pass — 404 |
| DELETE draft post | Happy path | Pass — 204 empty body |
| DELETE same post twice | Idempotency check | Pass — 404 on second call |
| DELETE non-existent ID | Not found | Pass — 404 |

### Test script

```bash
# Get a fresh token from browser DevTools console (60-second TTL):
# const token = await window.Clerk.session.getToken(); console.log(token)

TOKEN=<clerk_jwt> bash scripts/test-posts.sh
```

### Sample responses

**POST /api/posts — success**
```json
{
  "id": "0da3132b-25cf-4a05-a6cf-e8b2d3330814",
  "user_id": "a1b2c3d4-...",
  "original_draft": "First test post",
  "platform_variants": {
    "twitter": "Tweet text here",
    "linkedin": "LinkedIn post here",
    "instagram": "Insta post here",
    "facebook": "Facebook post here"
  },
  "status": "draft",
  "scheduled_at": null,
  "published_at": null,
  "media_urls": [],
  "created_at": "2026-04-12T..."
}
```

**GET /api/posts — beyond last page**
```json
{ "posts": [], "total": 2, "page": 5, "limit": 10 }
```

**PATCH — blocked status**
```json
{ "error": "validation_error", "message": "`status` can only be set to \"draft\" or \"queued\"." }
```

**PATCH — immutable post**
```json
{ "error": "forbidden", "message": "Cannot edit a post with status \"published\"." }
```

---

## 7. Known Limitations

- [ ] No rate limit on CRUD endpoints — a user could create an unbounded number of draft posts. The AI polish endpoint (Phase 1B) already limits how many useful posts can be generated (10/month free), so the practical blast radius is low. A per-user creation rate limit is the correct long-term fix; deferred to Phase 2.
- [ ] TOCTOU window on PATCH/DELETE — the route fetches the post (to check status), then mutates it in a separate query. A concurrent background job could change post status between the two operations. Acceptable for MVP since Phase 1 has no background workers.
- [ ] `media_urls` field is always set to `[]` on create — media upload is Phase 1D (ImageKit). The field exists in the schema and is returned in all responses.
- [ ] No integration tests — only manual curl testing via `scripts/test-posts.sh` at this stage.
- [ ] `scheduled_at` is accepted and stored but has no effect — scheduling and auto-publish are Phase 2 (BullMQ worker).

---

## 8. PR Summary

**What was added?**
- `lib/validation/posts.ts` — `validateCreatePost()`, `validateUpdatePost()`, `isValidUuid()`, `PostUpdatePayload` type
- `lib/posts/postService.ts` — `PostServiceError`, `resolveSupabaseUserId()`, `createPost()`, `getPosts()`, `getPostById()`, `updatePost()`, `deletePost()`
- `POST /api/posts` — create draft post, returns 201 with full post object
- `GET /api/posts` — paginated list with `page`, `limit`, `total`; handles out-of-range pages gracefully
- `PATCH /api/posts/:id` — partial update; blocks edits on `published`/`failed` posts; strips unknown fields
- `DELETE /api/posts/:id` — blocks deletion of `published` posts; returns 204
- `scripts/test-posts.sh` — full curl-based test suite (31 cases)

**Why was it needed?**
The AI polish engine produces platform variants but had nowhere to save them. Post management is the persistence layer that bridges AI output (Phase 1B) and social publishing (Phase 1D).

**How was it tested?**
Full automated curl test suite (`scripts/test-posts.sh`) run against a live dev server with a real Clerk JWT. All 31 cases pass. One real bug was caught and fixed during testing: PostgREST `PGRST103` on out-of-range pagination was surfacing as a 500; now returns `{ posts: [], total: N }` correctly.
