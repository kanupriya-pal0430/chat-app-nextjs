"use client";
import { useState, type DragEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowUpRight,
  LogOut,
  MessageCircle,
  MoreHorizontal,
  Search,
  ShieldCheck,
  Sparkles,
  WifiOff,
} from "lucide-react";
import { useSelector } from "react-redux";
import type { User, Conversation } from "@/lib/shared/types";
import type { RootState } from "@/store";
import {
  selectConversationMessages,
  selectLatestByConversation,
  selectSyncStatus,
  selectSyncError,
  selectTyping,
} from "@/store/chat-slice";
import { useChatSocket } from "@/hooks/use-chat-socket";
import { MessageList } from "./message-list";
import { Composer } from "./composer";

export function ChatShell({
  user,
  conversations,
  conversationId,
}: {
  user: User;
  conversations: Conversation[];
  conversationId: string;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [hoverTarget, setHoverTarget] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const current = conversations.find((c) => c.id === conversationId)!;
  const messages = useSelector((state: RootState) =>
    selectConversationMessages(state, conversationId)
  );
  const status = useSelector(selectSyncStatus);
  const syncError = useSelector(selectSyncError);
  const typing = useSelector(selectTyping);
  const latest = useSelector(selectLatestByConversation);
  const {
    online,
    send,
    retrySend,
    forward,
    setTypingStatus,
    notice,
    clearNotice,
    retrySync,
  } = useChatSocket(conversationId);
  const visibleContacts = conversations.filter((c) =>
    c.title.toLowerCase().includes(search.toLowerCase())
  );
  const onDropContact = (
    event: DragEvent<HTMLElement>,
    destination: string
  ) => {
    event.preventDefault();
    setHoverTarget(null);
    const sourceId = event.dataTransfer.getData("application/x-relay-message");
    if (
      sourceId &&
      destination !== conversationId &&
      messages.some((m) => m.id === sourceId && !("status" in m))
    )
      forward(sourceId, destination);
  };
  const logout = async () => {
    setLoggingOut(true);
    setLogoutError(null);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok)
        throw new Error("Could not sign out. Please try again.");
      router.replace("/login");
      router.refresh();
    } catch (err) {
      setLogoutError(err instanceof Error ? err.message : "Sign-out failed.");
      setLoggingOut(false);
    }
  };
  return (
    <div className="app-layout">
      <aside className="sidebar" aria-label="Conversations">
        <div className="sidebar-top">
          <div className="brand">
            <span className="brand-logo">
              <Sparkles size={21} />
            </span>
            <span>
              relay<span className="brand-dot">.</span>
            </span>
          </div>
          <button
            className="plain-icon"
            type="button"
            title="Your conversations"
            aria-label="Your conversations"
          >
            <MoreHorizontal size={22} />
          </button>
        </div>
        <div className="sidebar-head">
          <div className="eyebrow">YOUR SPACE</div>
          <h2>
            Messages<span className="count">{conversations.length}</span>
          </h2>
        </div>
        <div className="searchbox">
          <Search size={17} />
          <label className="visually-hidden" htmlFor="search-contacts">
            Search contacts
          </label>
          <input
            id="search-contacts"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search conversations…"
          />
        </div>
        <div className="section-label">
          <span>ALL CONVERSATIONS</span>
          <span>↗</span>
        </div>
        <nav className="contact-list" aria-label="Chats">
          {visibleContacts.map((c) => (
            <div
              key={c.id}
              className={`contact-wrapper ${
                hoverTarget === c.id ? "drag-target" : ""
              }`}
              onDragOver={(e) => {
                if (
                  e.dataTransfer.types.includes("application/x-relay-message")
                ) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
                  setHoverTarget(c.id);
                }
              }}
              onDragLeave={() => setHoverTarget(null)}
              onDrop={(e) => onDropContact(e, c.id)}
            >
              <Link
                href={`/chats/${c.id}`}
                aria-current={c.id === conversationId ? "page" : undefined}
                className={`contact ${c.id === conversationId ? "active" : ""}`}
              >
                <span
                  className="avatar"
                  style={{ backgroundColor: c.otherUser.color }}
                  aria-hidden="true"
                >
                  {c.otherUser.initials}
                </span>
                <span className="contact-main">
                  <strong>{c.title}</strong>
                  <small>
                    {latest[c.id]
                      ? latest[c.id].body || "Attachment"
                      : c.lastMessage ?? "Start a conversation"}
                  </small>
                </span>
                <span className="contact-side">
                  {c.lastAt
                    ? new Date(c.lastAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        timeZone: "UTC",
                      })
                    : ""}
                </span>
              </Link>
              {hoverTarget === c.id && c.id !== conversationId && (
                <span className="drop-hint" aria-hidden="true">
                  Drop to forward
                </span>
              )}
            </div>
          ))}
          {visibleContacts.length === 0 && (
            <p className="no-results">No contacts found.</p>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="profile">
            <span
              className="avatar profile-avatar"
              style={{ backgroundColor: user.color }}
              aria-hidden="true"
            >
              {user.initials}
            </span>
            <span className="profile-copy">
              <strong>{user.name}</strong>
              <small>
                <span className="online-dot" />
                Signed in
              </small>
            </span>
            <button
              onClick={() => {
                void logout();
              }}
              disabled={loggingOut}
              aria-label="Sign out"
              title="Sign out"
              className="plain-icon"
            >
              <LogOut size={18} />
            </button>
          </div>
          {logoutError && (
            <p role="alert" className="error-text">
              {logoutError}
            </p>
          )}
        </div>
      </aside>
      <main className="conversation-container">
        <header className="chat-header">
          <span
            className="avatar header-avatar"
            style={{ backgroundColor: current.otherUser.color }}
            aria-hidden="true"
          >
            {current.otherUser.initials}
          </span>
          <div className="header-copy">
            <h1>{current.title}</h1>
            <div className="header-status">
              <span className={online ? "online-dot" : "offline-dot"} />
              {online ? "Connected · Real-time chat" : "Reconnecting…"}
            </div>
          </div>
          <div className="header-details">
            <span className="safe-badge">
              <ShieldCheck size={15} /> Private conversation
            </span>
            <button
              className="plain-icon desktop-only"
              title="Conversation info"
              aria-label="Conversation information"
              aria-expanded={showInfo}
              onClick={() => setShowInfo((v) => !v)}
            >
              <MoreHorizontal size={21} />
            </button>
          </div>
        </header>
        {showInfo && (
          <div className="info-banner" role="note">
            Access is limited to conversation members. Messages are stored on
            the server and are not end-to-end encrypted.{" "}
            <button
              onClick={() => setShowInfo(false)}
              aria-label="Close information"
            >
              ×
            </button>
          </div>
        )}
        {!online && (
          <div className="connection-banner" role="status">
            <WifiOff size={15} /> Offline or connecting. Your unsent messages
            are queued until you reconnect.
          </div>
        )}
        <MessageList
          messages={messages}
          selfId={user.id}
          conversations={conversations}
          currentConversationId={conversationId}
          status={status}
          syncError={syncError}
          onRetrySync={retrySync}
          onForward={forward}
          onRetrySend={retrySend}
        />
        <AnimatePresence>
          {typing[current.otherUser.id] && (
            <motion.div
              className="typing-line"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              role="status"
            >
              <span className="typing-dots">
                <i />
                <i />
                <i />
              </span>
              {current.otherUser.name.split(" ")[0]} is typing…
            </motion.div>
          )}
        </AnimatePresence>
        <Composer
          key={conversationId}
          conversationId={conversationId}
          userId={user.id}
          onSend={send}
          onTyping={setTypingStatus}
        />
        <div className="bottom-info">
          <span>
            <MessageCircle size={13} /> Made for real conversations
          </span>
          <span>
            Drag messages onto contacts to forward <ArrowUpRight size={13} />
          </span>
        </div>
        {notice && (
          <div className="toast" role="status">
            {notice}
            <button onClick={clearNotice} aria-label="Dismiss notification">
              ×
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
