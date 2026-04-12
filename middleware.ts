// ============================================================
// Next.js Middleware — Auth enforcement via Clerk
//
// Rules:
//   - /api/webhooks/* → always public (Clerk webhook delivery)
//   - /api/*          → require valid Clerk session; return 401 JSON if missing
//   - Everything else → pass through (no-op for Phase 1 backend-only build)
// ============================================================

import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

// Routes that must bypass auth checks
const isPublicRoute = createRouteMatcher([
  '/api/webhooks(.*)',
])

// Routes that require authentication
const isProtectedApiRoute = createRouteMatcher([
  '/api(.*)',
])

export default clerkMiddleware(async (auth, req) => {
  // Webhook routes are always public — never authenticate them.
  if (isPublicRoute(req)) return

  // Protect all /api/* routes that aren't in the public list.
  if (isProtectedApiRoute(req)) {
    const { userId } = await auth()

    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'A valid session is required to access this endpoint.' },
        { status: 401 }
      )
    }

    // userId is now available to downstream route handlers via:
    //   const { userId } = await auth()  (from @clerk/nextjs/server)
    // No manual header injection needed — Clerk populates the auth context.
  }
})

export const config = {
  // Run middleware on all routes except Next.js internals and static files.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
