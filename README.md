# Relay

Real-time one-to-one messaging built with Next.js App Router, TypeScript, Redux Toolkit, Socket.IO, SQLite, and Cloudinary.

The core design choice is simple: **SQLite is the source of truth; WebSockets are the delivery mechanism.** Messages are committed before being broadcast. Clients reconcile events using server-assigned message IDs and recover missed messages from the database after reconnecting.

Relay targets **one long-running Node.js instance with persistent local storage**. It is designed for local assessment and single-node staging, not presented as a horizontally scalable hosted service.

## Getting started

**Prerequisites:** Node.js 22 (used in CI), npm, a writable filesystem, and a Cloudinary account for media attachments.

```bash
cp .env.example .env.local
npm ci
npm run dev
```

Open `http://127.0.0.1:3000`.

Configure `.env.local` before the first launch:

| Variable | Purpose |
| --- | --- |
| `APP_ORIGIN` | Exact browser origin, e.g. `http://127.0.0.1:3000`, for HTTP mutation and Socket.IO handshake origin checks. |
| `PORT`, `HOSTNAME` | Local HTTP server configuration. |
| `DATABASE_PATH` | SQLite file path; defaults to `./data/chat.db`. |
| `ALICE_PASSWORD`, `BOB_PASSWORD`, `CHARLIE_PASSWORD` | Passwords for the three seeded test accounts. |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Server-side media upload credentials, required for attachments. |

On first startup, the database seeds **Ada Lovelace**, **Grace Hopper**, and **Linus Torvalds** with direct conversations. Use separate browser sessions (e.g. normal and incognito windows) to sign in as two users simultaneously.

Passwords are hashed when the database is created. Changing `.env.local` later does **not** reset existing account passwords. To reseed locally, stop the server, back up `data/`, and reset the database deliberately; deleting it removes existing messages and sessions.

```bash
npm test
npm run typecheck
npm run build
npm start
```

`npm start` runs the custom long-lived Node server (Next.js + Socket.IO) and requires a completed build. A serverless deployment that only serves Next.js routes will not host Socket.IO as implemented.

**Local troubleshooting:** A login `403` generally indicates an origin mismatch with `APP_ORIGIN`; `localhost` and `127.0.0.1` are distinct origins. Socket.IO connections also require an allowed origin. For an upload `502`, check server logs and Cloudinary configuration. Restart the server after changing `.env.local`.

## Architecture

```text
src/app/chats/layout.tsx                  Server Component
  └── Authenticated, user-scoped ChatProvider (persistent Client Component)
      └── src/app/chats/[conversationId]/page.tsx
          ├── Server-side membership check and initial SQLite history
          └── ChatShell (Client Component)
              ├── MessageList            Messages, forwarding, delivery status
              ├── Composer               Drafts, attachments, validation
              └── useChatSocket           Socket lifecycle and history replay

src/store/provider.tsx                    Redux store lifetime + outbox restoration
src/store/chat-slice.ts                  Normalized messages, selectors, outbox
src/store/outbox-storage.ts              User-scoped browser outbox persistence
server.ts                                Next.js HTTP + Socket.IO
src/lib/server/                          Auth, database, message transactions
src/lib/shared/                          Shared DTOs and validation
src/app/api/                              Auth, history replay, media upload
```

### Server and Client Component boundaries

`/chats/layout.tsx` authenticates the user on the server and mounts one user-scoped Redux provider for the chat section. The provider remains mounted when navigating between `/chats/[conversationId]` routes, preserving pending messages and shared state rather than recreating the store for each conversation.

`/chats/[conversationId]/page.tsx` validates the conversation ID, checks membership, and fetches the conversation list and latest 50 messages **on the server**. It passes that serializable history to `ChatShell`, which hydrates the existing Redux store. This avoids an additional client-side request for initial history, while dynamic rendering keeps authentication and authorization at the data boundary.

Interactive behavior belongs to Client Components: message composition, typing, drag-and-forward, drafts, upload feedback, animations, and the Socket.IO connection. Redux stores serializable message data, not socket instances, files, or DOM objects. Server-confirmed messages are keyed by ID; optimistic outgoing messages are keyed separately by client nonce. `createSelector` memoizes message ordering and sidebar previews.

## Message delivery and recovery

Socket event payloads are typed in `src/lib/shared/types.ts` and shared by client and server.

```text
message:send       client -> server    Message + acknowledgment
message:forward    client -> server    Source/destination + acknowledgment
typing:set         client -> server    Ephemeral typing state
message:new        server -> room      Committed message
typing:update      server -> room      Ephemeral typing state
```

A normal send follows these steps:

1. The composer queues an optimistic message with a `clientNonce` generated once for that send.
2. The server derives sender identity from the authenticated session, checks conversation membership, and validates the request.
3. A SQLite transaction commits the message; the unique `(senderId, clientNonce)` constraint makes retrying that operation idempotent.
4. The server broadcasts the committed message and acknowledges the sender.
5. Redux upserts by server message ID and removes the matching outbox item by nonce. ACKs, broadcasts, and replay can arrive in different orders without duplicating the persisted message in the UI.

**Identical message text does not imply duplication.** Separate send operations intentionally have separate nonces.

### Persistent offline outbox

The chat-level Redux store survives conversation navigation. Pending outgoing messages are also saved in a **user-scoped `localStorage` outbox** by `src/store/outbox-storage.ts`. On page refresh, the provider restores saved entries after validating the stored structure. Interrupted `sending` entries return to `queued` and retain their original `clientNonce`; `failed` entries keep their failure state for an explicit retry.

On a connected socket, queued entries are sent using that same nonce. When a server-confirmed message arrives through an acknowledgment, broadcast, or hydrated history, its matching pending entry is removed. This handles ambiguous send acknowledgments without treating a retry as a new message.

The outbox is scoped by authenticated user and cleared from browser storage after successful sign-out. Browser storage is **not encrypted**, may be unavailable or full, and is local to that browser/device. The outbox is not a multi-device synchronization mechanism. In-memory state and cross-tab logout timing require additional hardening before public deployment.

### Reconnection and history replay

On connect and reconnect, the client requests `GET /api/conversations/:id/messages?after=<sequence>` using the last synchronized sequence for that conversation. The API returns committed messages in sequence order; Redux merges them by ID and advances the cursor from ordered database batches rather than from unordered push events.

In-flight history requests use `AbortController` and are cancelled on disconnect or unmount. Fetch failures display a retry path. The existing replay cursor is preserved when revisiting a conversation so that initial page hydration does not blindly skip unseen events.

A disconnected user can still queue a message while the current page remains open. Once connectivity returns, the client retries queued sends. **Full offline navigation to a new server-rendered conversation is not supported** without additional offline route caching; this is separate from outbox persistence.

### Forwarding

Delivered text, image, and video messages can be dragged onto another contact or forwarded with a keyboard-accessible action. The server authorizes access to the source and destination conversations and copies a snapshot of the source message in a transaction. The client does not submit arbitrary replacement content or media URLs.

Forward requests have a `clientNonce`. If an acknowledgment times out, retrying the same source/destination pair while the chat hook remains mounted reuses the pending nonce, avoiding a second database row for the same ambiguous operation. This pending forward retry state is **in memory**: navigation or refresh may discard it. Persisting ambiguous forwards is deferred.

Edits and deletions are not implemented; their interaction with forwarding would require explicit version or snapshot semantics.

## Media uploads

Media uploads pass through authenticated `POST /api/upload` before Cloudinary. The server enforces a 15 MB limit, allows supported image/video formats, and inspects binary file types rather than trusting the browser's MIME declaration. Upload records are tied to their owner; socket sends reference the upload ID, not a client-supplied Cloudinary URL.

The composer supports file selection and drag-and-drop, reports transfer progress and failures, and requires descriptive alt text for images. A separate caption is optional. Forwarded media retains its reference and description.

Progress represents transfer **to the application server**, not necessarily completion of Cloudinary processing. Multipart uploads are buffered in memory for small files; large-video ingest, orphaned-asset cleanup, and chunked uploads are outside this assessment.

## Security and accessibility

- Sender identity comes from the authenticated session, not a client-supplied `senderId`. Message reads, sends, and forwards enforce conversation membership.
- Passwords use bcrypt. Random session tokens are stored as hashes in SQLite and issued as `HttpOnly` cookies.
- State-changing HTTP requests validate origin. Socket.IO handshakes validate the expected `APP_ORIGIN`.
- Active sockets recheck their session periodically and disconnect after session revocation or expiry. This is a polling-based check, not instantaneous invalidation; a short window between checks remains.
- Message length, upload MIME type, file size, upload ownership, and one-time upload use are validated server-side. React renders message text without injecting untrusted HTML.
- Message forwarding is available without drag-and-drop. Inputs have accessible labels, errors are announced, images have alt text, and motion respects reduced-motion preferences.

Messages are **not end-to-end encrypted**. The server and anyone authorized to access its storage can read them. Public deployment would additionally require appropriate HTTPS/WSS configuration, operational security, and data-protection controls.

## Testing

The automated suite includes the following areas:

| Area | Coverage |
| --- | --- |
| Redux and selectors | Message ordering, memoized selection, optimistic sends, duplicate reconciliation |
| Outbox storage | Save/load/clear, user isolation, malformed data, refresh restoration, stable nonce |
| Message persistence | Idempotency, membership, upload ownership, forwarding transactions |
| Composer | Empty sends, Enter behavior, conversation drafts, upload errors, alt-text validation |
| Message list | Loading, empty/error states, retry, received messages, keyboard forwarding |
| Socket.IO integration | Two authenticated clients, bidirectional delivery, missed-message history recovery, nonce idempotency, unauthorized connections, logout disconnect |
| Validation | Message and media constraints |

```bash
npm test
npx vitest run src/store/outbox-storage.test.ts
npx vitest run src/tests/socket.integration.test.ts
npm run typecheck
npm run build
```

The Socket.IO integration tests start an isolated Node server with a temporary SQLite database and a matching `APP_ORIGIN`. They exercise actual network connections, not just mocked components. The reported local runs passed; this README does not claim a fresh CI run or a specific total test count. GitHub Actions (`.github/workflows/ci.yml`) is configured to run install, typecheck, tests, and build on pushes and pull requests to `main`.

### Manual verification

1. Sign in as Ada and Grace in separate browser sessions; exchange text and media without refreshing.
2. Confirm ACK and broadcast of the same send produce one delivered bubble, while two intentional sends of identical text remain separate.
3. Disconnect one participant, send messages from the other, then reconnect and verify missed history appears once and in order.
4. Queue a message offline, switch between already accessible chat routes while requests remain available, refresh, then reconnect and verify the same nonce is delivered once.
5. Verify per-conversation drafts survive refresh; forward text and media using drag-and-drop and keyboard controls.
6. Check upload progress/errors, typing states, and reduced-motion behavior.
7. Sign out and confirm the existing socket disconnects within the session revalidation interval.

## Known limits and next steps

These are intentional scope boundaries, not hidden production-readiness claims:

- **Single-node runtime.** SQLite WAL and in-process Socket.IO rooms assume one persistent Node server. Multi-instance deployment needs shared durable storage, a distributed Socket.IO adapter, and a cross-instance replay/delivery strategy.
- **Browser outbox.** Pending sends survive chat navigation and refresh in the same browser, but local storage is plaintext and can fail under storage restrictions or quota pressure. Cross-device or robust multi-tab delivery is not implemented. Offline navigation of uncached server routes is not supported.
- **Forward retry.** Ambiguous forward operations reuse their nonce only during the active chat-hook lifetime; they are not persisted across route changes or reloads.
- **Session revocation.** Existing sockets are disconnected by periodic revalidation, leaving a bounded delay rather than immediate revocation.
- **Message history.** The initial server load includes the latest 50 messages; older-history scrolling/pagination is not implemented. Reconnect replay is paginated and bounded per attempt.
- **Media lifecycle.** A failure after Cloudinary accepts a file may leave an unreferenced asset. Reconciliation, malware scanning, and signed/chunked direct uploads are deferred.
- **Operational hardening.** Production deployment would need distributed rate limits, backups and migrations, structured logs/metrics, content-abuse controls, stronger CSP, and broader browser-level end-to-end coverage.
- **Product scope.** No group chats, public registration, edit/delete, read receipts, or end-to-end encryption.

For this assessment, the focus is correct single-node delivery, predictable failures, accessible interactions, and testable state transitions rather than additional features.
