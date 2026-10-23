"use client";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUpRight,
  Check,
  Clock3,
  Image as ImageIcon,
  RefreshCw,
  Send,
  WifiOff,
} from "lucide-react";
import type { Conversation } from "@/lib/shared/types";
import type { SyncState, ViewMessage } from "@/store/chat-slice";

type Props = {
  messages: ViewMessage[];
  selfId: string;
  conversations: Conversation[];
  currentConversationId: string;
  status: SyncState;
  syncError: string | null;
  onRetrySync: () => void;
  onForward: (messageId: string, destinationId: string) => void;
  onRetrySend: (nonce: string) => void;
};
export function MessageList({
  messages,
  selfId,
  conversations,
  currentConversationId,
  status,
  syncError,
  onRetrySync,
  onForward,
  onRetrySend,
}: Props) {
  const bottom = useRef<HTMLDivElement | null>(null);
  const [forwarding, setForwarding] = useState<string | null>(null);
  const choices = conversations.filter((c) => c.id !== currentConversationId);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);
  return (
    <section
      className="messages-panel"
      aria-label="Messages"
      aria-live="polite"
      aria-relevant="additions"
    >
      <div className="conversation-start">
        <span>THIS IS THE BEGINNING OF YOUR CONVERSATION</span>
        <small>Messages appear here in real time</small>
      </div>
      {status === "loading" && messages.length === 0 && (
        <div className="message-state" role="status">
          <div className="loader" />
          Synchronizing your messages…
        </div>
      )}
      {status === "error" && (
        <div className="inline-banner error-banner" role="alert">
          <WifiOff size={17} />
          <span>{syncError || "Unable to load messages."}</span>
          <button onClick={onRetrySync}>
            <RefreshCw size={15} />
            Retry
          </button>
        </div>
      )}
      {status === "ready" && messages.length === 0 && (
        <div className="message-state">
          <ImageIcon size={32} />
          <h3>Make the first move.</h3>
          <p>Say hello or share something good.</p>
        </div>
      )}
      <div className="message-stack" role="list">
        <AnimatePresence initial={false}>
          {messages.map((message) => {
            const pending = "status" in message;
            const own = message.senderId === selfId || pending;
            const created = new Date(message.createdAt);
            const formatted = Number.isNaN(created.getTime())
              ? ""
              : created.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                });
            return (
              <motion.div
                key={message.id}
                role="listitem"
                layout
                initial={{ opacity: 0, y: 12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.2 }}
                className={`message-row ${own ? "mine" : "theirs"}`}
              >
                <div
                  className={`message-bubble ${pending ? "pending" : ""}`}
                  draggable={!pending}
                  onDragStart={(event) => {
                    if (!pending) {
                      event.dataTransfer.setData(
                        "application/x-relay-message",
                        message.id
                      );
                      event.dataTransfer.effectAllowed = "copy";
                    }
                  }}
                  aria-label={`${own ? "You" : "Contact"}: ${
                    message.body || "Media message"
                  }`}
                >
                  {message.forwardedFromId && (
                    <div className="forwarded-label">
                      <ArrowUpRight size={13} /> Forwarded
                    </div>
                  )}
                  {message.body && (
                    <p className="message-text">{message.body}</p>
                  )}
                  {message.media?.kind === "image" && (
                    <a
                      href={message.media.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Open image: ${message.media.name}`}
                    >
                      {/* The URL is emitted by our authenticated Cloudinary upload path. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        className="message-media"
                        src={message.media.url}
                        alt={
                          message.media.altText ||
                          `Shared image: ${message.media.name}`
                        }
                        loading="lazy"
                      />
                    </a>
                  )}
                  {message.media?.kind === "video" && (
                    <video
                      className="message-media"
                      controls
                      preload="metadata"
                      src={message.media.url}
                      aria-label={`Shared video: ${message.media.name}`}
                    />
                  )}
                  <div className="message-meta">
                    <time dateTime={message.createdAt}>{formatted}</time>
                    {own &&
                      (pending ? (
                        <Clock3 size={12} aria-label="Pending delivery" />
                      ) : (
                        <Check size={13} aria-label="Delivered to server" />
                      ))}
                  </div>
                </div>
                <div className="message-actions">
                  {!pending && choices.length > 0 && (
                    <button
                      type="button"
                      className="icon-text-button"
                      aria-label={`Forward message ${
                        message.body || "attachment"
                      }`}
                      aria-expanded={forwarding === message.id}
                      onClick={() =>
                        setForwarding(
                          forwarding === message.id ? null : message.id
                        )
                      }
                    >
                      <Send size={13} /> Forward
                    </button>
                  )}
                  {pending && message.status === "failed" && (
                    <button
                      type="button"
                      className="retry-message"
                      onClick={() => onRetrySend(message.clientNonce!)}
                    >
                      <RefreshCw size={12} /> Retry
                    </button>
                  )}
                </div>
                {pending && message.error && (
                  <small className="send-error" role="alert">
                    {message.error}
                  </small>
                )}
                {forwarding === message.id && (
                  <div
                    className="forward-choices"
                    role="group"
                    aria-label="Forward to conversation"
                  >
                    <span>Forward to</span>
                    {choices.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => {
                          onForward(message.id, c.id);
                          setForwarding(null);
                        }}
                      >
                        {c.otherUser.name}
                      </button>
                    ))}
                    <button onClick={() => setForwarding(null)}>Cancel</button>
                  </div>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
      <div ref={bottom} />
    </section>
  );
}
