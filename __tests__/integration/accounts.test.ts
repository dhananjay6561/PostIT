/**
 * 1D — Social OAuth + Publish (not yet built)
 *
 * These tests are skipped until Phase 1D is implemented.
 * When 1D is built, remove the `.skip` — no changes to ci.yml or
 * jest.config.ts are needed; Jest picks them up automatically.
 */

describe.skip('1D — Social OAuth + Publish (not yet built)', () => {
  it.todo('GET /api/accounts returns connected accounts')
  it.todo('POST /api/accounts/connect initiates OAuth flow')
  it.todo('DELETE /api/accounts/:id disconnects account')
  it.todo('POST /api/posts/:id/publish publishes to selected platforms')
})
