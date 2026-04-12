// Load .env.test before any test runs.
// In CI, these come from GitHub Secrets; locally, from .env.test.
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.test' })
