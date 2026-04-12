import type { Config } from 'jest'

// SWC transformer config shared between both projects.
const swcTransform = {
  '^.+\\.(t|j)sx?$': [
    '@swc/jest',
    {
      jsc: {
        parser: { syntax: 'typescript', tsx: false },
        target: 'es2020',
      },
      module: { type: 'commonjs' },
    },
  ],
}

// Module name mapper mirrors tsconfig.json paths: @/* → <root>/*
const moduleNameMapper = {
  '^@/(.*)$': '<rootDir>/$1',
}

// node_modules that ship ESM and must be transformed
const transformIgnorePatterns = [
  '/node_modules/(?!(next|@clerk/nextjs|@clerk/backend|@supabase/supabase-js)/)',
]

const sharedProjectConfig = {
  testEnvironment: 'node',
  transform: swcTransform,
  moduleNameMapper,
  transformIgnorePatterns,
  setupFiles: ['<rootDir>/jest.setup.ts'],
}

const config: Config = {
  // Two independently runnable projects: unit and integration.
  projects: [
    {
      ...sharedProjectConfig,
      displayName: 'unit',
      testMatch: ['<rootDir>/__tests__/unit/**/*.test.ts'],
    },
    {
      ...sharedProjectConfig,
      displayName: 'integration',
      testMatch: ['<rootDir>/__tests__/integration/**/*.test.ts'],
    },
  ],

  // Coverage collected from all source modules.
  // Excludes: migrations, type-only files, page/layout roots, test files.
  collectCoverageFrom: [
    'lib/**/*.ts',
    'app/api/**/*.ts',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!supabase/**',
  ],

  coverageReporters: ['lcov', 'text-summary'],

  coverageThreshold: {
    global: {
      lines: 80,
      functions: 80,
      branches: 80,
    },
  },
}

export default config
