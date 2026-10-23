# Relay — production-minded real-time chat

A Next.js App Router + Redux Toolkit + TypeScript chat assessment. Direct (one-to-one) conversations, text and Cloudinary-backed images/video, accessible drag-or-click forwarding, persistent drafts, and server-authoritative WebSocket messages.

> **Deployment scope:** designed for a **single long-running Node process** with a persistent filesystem, suitable for a controlled assessment / single-node staging environment. It is not a claim of audited, horizontally scalable production readiness. See [Hardening and deferred work](#hardening-and-deferred-work).

## Quick start

Requirements: Node 20+, npm, a writable local filesystem. Cloudinary credentials are required for media, but text chat works without them.

```bash
cp .env.example .env.local
# Edit ALICE_PASSWORD, BOB_PASSWORD and CHARLIE_PASSWORD (required, distinct and strong)
# Set CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET for uploads
npm install
npm run dev
# Open http://127.0.0.1:3000
```

Sign in as **Ada Lovelace**, **Grace Hopper**, or **Linus Torvalds** using the corresponding password. Use a normal and private browser session, or two browsers, to test both participants without sharing cookies. SQLite creates three seed users and one-to-one conversations between each pair on first boot. Existing credentials are not reset by changing `.env.local`; delete the local `data/` database to reseed (destructive).

```bash
npm run typecheck    # TypeScript strict mode
npm test             # unit, component and database integrity tests
npm run test:watch
npm run build
npm start            # starts Next and Socket.IO in the same Node process
```

Cloudinary uploads enforce the 15 MB cap and MIME allowlist **on the server** using binary magic-byte sniffing, not just the browser's `File.type`. Upload progress indicates transfer from the browser to the application server; the cloud-processing phase may continue briefly afterwards. Missing Cloudinary credentials produce a recoverable configuration error.

## What is implemented

| Requirement         | Implementation                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| App Router / SSR    | `/chats/[conversationId]` is a Server Component; latest 50 messages and contacts loaded directly from SQLite before hydration              |
| Real-time transport | Same-origin Socket.IO with per-conversation rooms, session-authenticated sockets, typed event contracts, acknowledgments                   |
| Persistence         | SQLite WAL; monotonic `seq`, unique `(senderId, clientNonce)`, atomic sends/forwards                                                       |
| Reconnect           | Socket reconnect + authenticated REST replay after last synchronized sequence; normalized ID upsert removes duplicates                     |
| Drafts              | `localStorage` key `relay:draft:<userId>:<conversationId>`, restored on full reload, scoped to conversation                                |
| Media               | Authenticated `POST /api/upload`, size/magic-byte checks, Cloudinary upload stream, ownership-bound upload IDs                             |
| Forward             | Drag a delivered message to another contact, **or** use its keyboard-accessible Forward button; server copies authorized source atomically |
| Loading/error/retry | Route-level loading/error, history sync banner with Retry, failed send Retry, upload progress/cancel/error                                 |
| Motion              | Layout + arrival animations, typing indicators, drag-target highlighting, respects `prefers-reduced-motion` CSS                            |
| Tests               | Redux selector/reconciliation, validation, message list states/forwarding, composer drafts/errors, DB auth/idempotency/forwarding          |

## Rendering strategy (Server versus Client)

```text
app/chats/[conversationId]/page.tsx   SERVER (dynamic request)
  ├─ cookies() session → membership check
  ├─ getConversations() + getConversationMessages() from SQLite
  └─ <ChatProvider initialMessages>       CLIENT boundary
       └─ <ChatShell>
            ├─ Redux memoized selectors
            ├─ useChatSocket()                  typed Socket.IO client
            ├─ <MessageList>                   animation / draggable messages / keyboard forwarding
            └─ <Composer>                      controlled input / local draft / XHR upload progress

server.ts: Node HTTP server + Next request handler + Socket.IO server
src/lib/server/*: sessions, SQLite, transactional messaging
app/api/*: authenticated, validated HTTP endpoints
```

The root page redirects to `/chats`; `/chats` routes to the first authorized conversation. These are Server Components, not hydration-dependent client `useEffect` fetches. `force-dynamic` / reading auth cookies ensures user-specific HTML is never statically shared. Server data is plain serializable DTOs passed to a **per-conversation** client Redux store. Browser-only elements (draft persistence, socket subscriptions, `XMLHttpRequest` progress, drag and animations) live behind `'use client'`. An initial route loading boundary and error boundary handle slow/failed server renders. The unread message history **syncs after hydration** to fill the SSR→socket connection window; history is not lost in that gap.

Redux uses plain serializable state, not raw `Socket` or `File` instances. `createSelector` memoizes conversation filtering/sorting and latest-message sidebar previews. React never has to filter/sort the entire message state just because the connection indicator changes.

## Message protocol and consistency

Events (all defined in `src/lib/shared/types.ts`):

```text
client → server: message:send({ conversationId, clientNonce, body, uploadId? }, ack)
client → server: message:forward({ destinationConversationId, originalMessageId, clientNonce }, ack)
client → server: typing:set({ conversationId, isTyping })
server → room: message:new(Message)
server → room: typing:update({ conversationId, userId, isTyping })
```

1. Authenticated session cookie identifies the sender. The client cannot pass `senderId`. Each send must belong to an authorized conversation.
2. The server transaction checks membership, idempotency nonce and optional upload ownership. An INSERT allocates a database-wide monotonic sequence. **Commit happens before broadcast and ACK.**
3. Receiving clients upsert by server message ID. An optimistic item is identified by `clientNonce` and removed when either the ACK or the broadcast arrives. Receiving the same event twice is harmless.
4. If disconnected, newly composed text/media metadata is held in an in-memory outbox and flushed on reconnect. On an ambiguous acknowledgment timeout, the item becomes explicitly retryable with its **original nonce**, so retrying cannot create a second message.
5. Every socket connection/reconnection requests `GET /api/conversations/:id/messages?after=<lastSyncedSeq>`, in pages of up to 100. This **durable DB replay** handles a long outage even when Socket.IO connection-state recovery expires. The replay cursor is _not_ advanced just because a possibly out-of-order push event arrives; that avoids skipping messages in the reconnect race. Duplicate replay/push/ACK messages collapse by ID.
6. History sync can be manually retried. In-flight fetches are aborted on socket disconnect/route unmount. Each reconnect cancels any prior sync before starting again.

**Ordering:** `seq` is the server insertion order (global, not per-conversation). UI sorts each conversation by this value. Pending optimistic items render after confirmed messages. Client clock timestamps do not control ordering.

**Forwarding race:** The original is loaded and copied **within one SQLite transaction**. The server authorizes access to both the source and destination. The forwarded message stores a snapshot of source text and its existing media reference; the request does not include editable body or URL. There are no edit/delete endpoints in this assessment, so concurrency with edits/deletions is explicitly deferred. If those endpoints are added, they must use the same transaction/authorization discipline and define snapshot versus current-version semantics.

## Security and accessibility

- Logins use bcrypt password hashes, opaque cryptographically random 256-bit session tokens, **SHA-256 token hashes in SQLite**, `HttpOnly`, `SameSite=Lax`, and `Secure` in production. Expired/revoked sessions cannot send new messages (socket event handlers revalidate session). Browser secrets are never placed in `NEXT_PUBLIC_*` values.
- Origin checks protect HTTP mutations. For reverse-proxy use, set `APP_ORIGIN` to the public origin; configure HTTPS and trusted proxy headers appropriately. Messages are sanitized for control characters and limited to 2,000 characters. React escapes rendered text (not `dangerouslySetInnerHTML`).
- Upload route validates authenticated ownership, declared and _sniffed_ MIME, max size and Cloudinary configuration. Clients send only a generated `uploadId` over the socket; they cannot spoof a Cloudinary URL. Used upload IDs are not transferable between other users.
- SQLite access to messages and history enforces membership (not just the UI). User IDs in socket data come exclusively from authenticated sessions.
- Image attachments require a user-supplied descriptive alt text (validated on the server and preserved on forwards). Interactive chat controls include accessible names, text labels, keyboard navigation, visible focus outlines, and server error announcements with `role="alert"`. Every dragged message can also be forwarded by a button, which works by keyboard. `Enter` sends, `Shift+Enter` inserts a newline. Motion is minimized under OS reduced-motion preferences.
- **Not end-to-end encrypted.** Authorized backend operators with database/Cloudinary access can view message content. The UI discloses this rather than claiming E2EE.

## Reliability and tradeoffs

- **Refresh:** drafts survive reload and are isolated by user and conversation (but are still browser-local plaintext; clear browser storage on shared devices). Confirmed messages survive restart. The _outbox_, however, is in memory; a hard refresh during an offline queued send can lose that queue item. It is not claimed to be an offline-first app. For stronger offline durability, persist encrypted/local outbox metadata with nonce reuse and a retention policy.
- **Page size:** initial SSR loads the latest 50 only; older-history upward pagination is not implemented. Replay reads up to 100 messages per page, at most 100 pages per sync attempt; if the cap is hit it exposes Retry rather than silently dropping rows.
- **Upload path:** HTTP multipart parsing buffers up to 15 MB in memory. A production edge proxy should reject oversized bodies before Node; larger videos need authenticated direct-to-Cloudinary signed/chunked uploads, streaming parsers, scanning, and asset cleanup for abandoned uploads. Upload transfer percentage does not represent Cloudinary processing time.
- **Failure semantics:** a timed-out ACK is ambiguous: maybe the server committed, maybe not. A retry keeps the nonce. An upload failing after Cloudinary stored a file but before SQLite saved it can orphan an asset; reconciliation jobs are deferred.
- **Storage & scale:** SQLite WAL and in-process Socket.IO rooms are **single-node only**. Multi-instance production requires PostgreSQL or another shared database, a distributed sequence/outbox strategy, and the Redis Streams Socket.IO adapter (not just ephemeral pub/sub), plus sticky-session decisions. See the Socket.IO [recovery docs](https://socket.io/docs/v4/connection-state-recovery/).
- **Security hardening before public deployment:** shared distributed rate limiting (login and REST as well as socket), credential enrollment/reset and rotation, richer audit logging, metrics/tracing, session cleanup, database backups/migrations, tighter CSP, abuse reporting, antivirus/content moderation for attachments, media accessibility review, and automated browser E2E tests. Account creation, group chats, edit/delete, and read receipts are out of scope.
- **Testing:** TypeScript syntax was statically parsed for this assessment, but dependency installation and live browser/socket tests require `npm install` in an environment with package-registry access. Never treat passing source inspection as equivalent to a verified production deploy.

## Test inventory

`src/store/chat-slice.test.ts` exercises filtering, ordering, selector memoization, replay deduplication and optimistic ACK reconciliation. `src/lib/shared/validation.test.ts` tests unsafe payload and length validation. `src/lib/server/messages.test.ts` tests SQLite transactional idempotence, sender authorization, source authorization, image descriptions/upload ownership and forwarding snapshots. `src/components/message-list.test.tsx` covers loading/error/retry, empty, inbound messages, accessible forward and failed-send retry. `src/components/composer.test.tsx` covers empty send prevention, Enter, draft reload isolation and unsupported media errors.

CI (`.github/workflows/ci.yml`) installs packages and runs strict TypeScript, Vitest and Next build. For a manual end-to-end check: start the server; sign in in separate browsers as Ada and Grace; send messages in both directions; reload to confirm the draft; disconnect one browser, send from the other, reconnect and observe replay; send a media attachment; drag a message onto Linus or use Forward. All passwords must be set in `.env.local` on first boot.
