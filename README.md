# Relay

Real-time one-to-one messaging built with Next.js App Router, TypeScript, Redux Toolkit, Socket.IO, SQLite, and Cloudinary.

The main design choice is straightforward: **SQLite is the source of truth; WebSockets are the delivery mechanism.** A message is committed before it is broadcast, and clients reconcile incoming events against server-assigned message IDs. If a connection drops, the client requests missed messages from the database instead of assuming Socket.IO delivered everything.

This repository targets a **single Node.js instance with persistent local storage**. It is suitable for local evaluation and single-node staging; it is not presented as a horizontally scalable hosted chat service.

## Getting started

**Prerequisites:** Node.js 22 (the version used in CI), npm, a writable filesystem, and a Cloudinary account if you want to send media.

```bash
cp .env.example .env.local
npm ci
npm run dev
```

Open `http://127.0.0.1:3000`.

Configure these values in `.env.local` before the first launch:

| Variable | Purpose |
| --- | --- |
| `APP_ORIGIN` | Exact browser origin, e.g. `http://127.0.0.1:3000`. Used to validate state-changing requests. |
| `PORT`, `HOSTNAME` | Local HTTP server configuration. |
| `DATABASE_PATH` | SQLite path; defaults to `./data/chat.db`. |
| `ALICE_PASSWORD`, `BOB_PASSWORD`, `CHARLIE_PASSWORD` | Passwords for the three seeded test accounts. |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Server-side media upload credentials. Required only for attachments. |

On first startup, the database seeds **Ada Lovelace**, **Grace Hopper**, and **Linus Torvalds**, along with their direct conversations. Use separate browser sessions (for example, normal and incognito windows) to sign in as two users simultaneously.

The account passwords are hashed when the database is first created. Changing `.env.local` later does **not** reset existing accounts. To reset a local test database, stop the server, back up `data/`, and reseed deliberately; removing the database deletes existing messages and sessions.

```bash
npm test             # Vitest: reducers, components, validation, persistence
npm run typecheck    # Strict TypeScript
npm run build        # Next.js production build
npm start            # Custom Node server (Next.js + Socket.IO)
```

`npm start` requires a completed build. This project uses a custom long-running Node server; a serverless deployment that only serves Next.js routes will not host the Socket.IO process as written.

**Local troubleshooting:** A `403` on login usually means the request origin does not match `APP_ORIGIN` (for this check, `localhost` and `127.0.0.1` are different). An upload `502` typically requires checking the server log and Cloudinary cloud name/credentials. Restart the server after changing `.env.local`.

## Architecture

```text
src/app/chats/[conversationId]/page.tsx     Server Component
  └── Authenticated conversation + latest messages from SQLite
      └── Redux provider / ChatShell         Client boundary
          ├── MessageList                     Messages, forwarding, status
          ├── Composer                        Drafts, attachments, validation
          └── useChatSocket                    Socket lifecycle and replay

server.ts                                   Next.js HTTP + Socket.IO
src/lib/server/                             Auth, database, message transactions
src/lib/shared/                             Shared DTOs and validation
src/store/chat-slice.ts                     Normalized messages and outbox
src/app/api/                                Auth, history replay, media upload
```

### Rendering boundary

`/chats/[conversationId]` loads the authorized conversation and recent message history **on the server**. That avoids a blank chat pane followed by an unnecessary client-side initial fetch, and keeps session/membership checks near the data access. The route is dynamic because its output depends on the authenticated user.

Interactive behavior stays in Client Components: typing, drag-and-forward, local drafts, upload progress, animations, and the Socket.IO connection. Server-rendered messages are passed as serializable data into Redux. Subsequent server events update that same client-side state.

Redux stores plain data rather than sockets, files, or DOM objects. Messages are keyed by server ID; optimistic sends live separately in an outbox keyed by client nonce. `createSelector` memoizes conversation message ordering and sidebar previews, so unrelated state changes do not trigger repeated filtering and sorting.

## Message delivery and recovery

Event payloads are typed in `src/lib/shared/types.ts` and shared by the Socket.IO client and server.

```text
message:send     client -> server   Message payload + acknowledgment
message:forward  client -> server   Source/destination IDs + acknowledgment
typing:set       client -> server   Ephemeral typing state
message:new      server -> room     Persisted message
typing:update    server -> room     Ephemeral typing state
```

A normal send follows these steps:

1. The composer queues an optimistic message with a `clientNonce` generated once for that send.
2. The server resolves sender identity from the authenticated session, checks conversation membership and validates the payload.
3. A SQLite transaction writes the message. The database has a unique constraint on `(senderId, clientNonce)`; retrying the same send cannot create another row.
4. After commit, the server acknowledges the sender and broadcasts the persisted message to conversation members.
5. Redux upserts the persisted message by ID and removes the matching optimistic item by nonce. ACKs, broadcasts, and replayed history can arrive in different orders without creating duplicate UI entries for the same persisted message.

**Different sends are different messages**, even when their text is identical. Deduplication is based on identity, not on comparing message bodies.

### Reconnection

Socket reconnection alone is not a durability guarantee. On connection and reconnection, the client requests `GET /api/conversations/:id/messages?after=<sequence>` using the last synchronized sequence for that conversation. The API returns committed messages in sequence order; Redux merges them by ID. The cursor is advanced from ordered database response batches rather than blindly trusting the order of push events.

In-flight history requests use `AbortController` and are cancelled on disconnect or unmount. A failed sync is surfaced with a retry action rather than silently treating the conversation as current.

If a send times out waiting for an ACK, the UI marks it as unconfirmed. Retrying reuses the **original nonce**, because the server may already have committed the first attempt. The client outbox is **in memory**, though: a full page reload while an outgoing message is still offline/queued can lose that unsent item. Received and committed messages remain in SQLite.

### Forwarding

The UI supports dragging a delivered text, image, or video message onto another contact, as well as a keyboard-accessible Forward control. The server checks access to both conversations and copies a snapshot of the source message within a transaction. Clients do not supply a replacement message body or arbitrary media URL.

Edits and deletions are not implemented. Their interaction with forwarding would require explicit version/snapshot semantics; that work is outside this assessment.

## Media uploads

Uploads go through the authenticated `POST /api/upload` route and then Cloudinary. The server enforces a 15 MB limit, an allowlist of supported image/video types, and binary file-type validation rather than trusting the browser's MIME declaration. An upload record is associated with its owner; socket messages reference that upload ID, not a client-provided Cloudinary URL.

The composer supports file selection and drag-and-drop, displays transfer progress, and reports cancel/error states. Images require descriptive alt text for screen reader users; a separate message caption is optional. Forwarded media retains its reference and description.

The progress percentage measures transfer **to the application server**. Cloudinary processing may finish later. The current multipart path buffers small uploads in memory; it is not designed for large video ingest.

## Security and accessibility

- Sender identity comes from the session, never from a `senderId` supplied in a socket event. Message reads, sends, and forwards check membership on the server.
- Passwords are hashed with bcrypt. Session tokens are random, stored as hashes in SQLite, and issued in `HttpOnly` cookies. State-changing HTTP requests check the configured origin.
- Message bodies are length-limited and validated server-side. React renders them as text rather than untrusted HTML.
- File type, size, upload ownership, and one-time upload use are validated on the backend.
- Forwarding is operable without drag-and-drop. Inputs have accessible labels, failures use readable announcements, images have alt text, and motion respects `prefers-reduced-motion`.

Messages are **not end-to-end encrypted**. The application server and authorized operators with access to its storage can read them. Transport security and encrypted storage should be configured for any deployment beyond local evaluation.

## Testing

The automated suite covers:

| Area | Coverage |
| --- | --- |
| Redux | Message ordering, memoized selection, duplicate reconciliation, optimistic sends |
| Message persistence | Idempotency, membership checks, upload ownership, forwarding transactions |
| Composer | Empty sends, Enter behavior, per-chat draft persistence, media errors, alt-text validation |
| Message list | Loading, empty/error states, retry, received messages, keyboard forwarding |
| Validation | Message and media payload constraints |

At the last local verification, **21 tests passed**, TypeScript checks passed, and the production build completed. GitHub Actions (`.github/workflows/ci.yml`) runs `npm ci`, typecheck, tests, and build on pushes and pull requests to `main`. The production-dependency audit (`npm audit --omit=dev`) reported zero findings after the targeted dependency updates; the full development-dependency audit still needs separate review. These are point-in-time results, not a guarantee about later dependency changes.

For a manual integration pass:

1. Sign in as Ada and Grace in separate browser sessions. Exchange text and media in both directions without refreshing.
2. Send one message and confirm that ACK/replay do not produce extra bubbles; sending identical text in separate actions should still create separate messages.
3. Disconnect Grace, send messages from Ada, reconnect Grace, and confirm that missed messages arrive once and in order.
4. Refresh with an unsent draft in each conversation, then switch conversations to verify isolation.
5. Forward text and media through both drag-and-drop and the keyboard-accessible control. Check the typing indicator and reduced-motion behavior.

## Known limits and next steps

These are deliberate scope boundaries, not features hidden behind a “production-ready” label:

- **Single-node runtime.** SQLite WAL and in-process Socket.IO rooms assume one persistent Node process. Scaling out requires shared durable storage, a distributed Socket.IO adapter, and a cross-instance delivery/replay strategy.
- **Offline sends.** Confirmed messages recover on reconnect, but the outbox is not persisted across a browser reload. An offline-first version would need durable client-side queue storage with nonce preservation.
- **Message history.** The first server render loads the latest 50 messages. Older-history scrolling/pagination is not implemented; reconnect replay is paginated and bounded per attempt.
- **Media lifecycle.** A failed request after Cloudinary has accepted a file can leave an unreferenced asset. Asset reconciliation, malware scanning, and signed/chunked direct uploads are deferred.
- **Operational hardening.** Before a public deployment, add distributed rate limits, session maintenance, backups and migrations, structured logs/metrics, content-abuse controls, stronger CSP, and browser-level end-to-end testing.
- **Product scope.** No group chats, account registration, edit/delete, read receipts, or end-to-end encryption.

For this assessment, I prioritized correct single-node delivery, explicit failure behavior, accessible interactions, and testable state transitions over adding more surface area.
