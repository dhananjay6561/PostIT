// Minimal root layout — required by Next.js App Router.
// Frontend will be built in a later phase.
import { ClerkProvider } from '@clerk/nextjs'
import type { ReactNode } from 'react'

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>{children}</body>
      </html>
    </ClerkProvider>
  )
}
