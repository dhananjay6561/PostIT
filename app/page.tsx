// Temporary test page — replace with real UI in frontend phase.
import { SignedIn, SignedOut, SignInButton, SignUpButton, UserButton } from '@clerk/nextjs'

export default function RootPage() {
  return (
    <div style={{ padding: 40, fontFamily: 'sans-serif' }}>
      <h1>PostPilot AI</h1>
      <SignedOut>
        <SignUpButton mode="modal"><button>Sign Up</button></SignUpButton>
        &nbsp;
        <SignInButton mode="modal"><button>Sign In</button></SignInButton>
      </SignedOut>
      <SignedIn>
        <p>Signed in.</p>
        <UserButton />
      </SignedIn>
    </div>
  )
}
