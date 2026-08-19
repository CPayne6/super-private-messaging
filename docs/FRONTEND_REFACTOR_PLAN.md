# Frontend structure refactor

## Goal

Replace the current root-level orchestration component with feature-oriented React modules while preserving the existing identity, encryption, messaging, and realtime behavior.

## Target structure

```text
src/
  app/                 # Root composition and providers
  features/
    identity/          # Identity setup, import, persistence, verification
    conversations/     # Conversation list, creation, and key loading
    messages/          # Message list, composer, loading, and sending
    realtime/          # WebSocket lifecycle and typed event routing
  crypto/              # Browser crypto and X25519 interoperability
  infrastructure/      # API client, local persistence, diagnostics
  components/          # Small shared presentation components
  styles/              # Feature-scoped styles
```

## Rules

- UI components do not call `fetch`, open WebSockets, access browser storage, or perform crypto.
- Hooks own feature workflows and expose typed state and actions.
- API modules own route contracts, signed headers, response parsing, and errors.
- Crypto modules remain framework-independent.
- Realtime emits typed events; feature hooks decide how state changes.

## Implementation order

1. Extract shared API and signed-request infrastructure.
2. Extract identity state and actions into `useIdentity`.
3. Extract conversation and message state into dedicated hooks.
4. Extract realtime handling into `useRealtimeMessages`.
5. Split the messenger UI into focused components.
6. Remove orchestration from the root component and verify identity, messaging, realtime, reload, and profile-removal flows.
