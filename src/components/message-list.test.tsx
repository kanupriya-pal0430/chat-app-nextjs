import { beforeAll, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MessageList } from "./message-list";
import type { Conversation, Message } from "@/lib/shared/types";
// Use the real component but disable motion measurements in jsdom.
vi.mock("framer-motion", async () => {
  const React = await import("react");
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    motion: {
      div: ({
        children,
        layout,
        initial,
        animate,
        exit,
        transition,
        ...props
      }: React.HTMLAttributes<HTMLDivElement> & {
        layout?: unknown;
        initial?: unknown;
        animate?: unknown;
        exit?: unknown;
        transition?: unknown;
      }) => React.createElement("div", props, children),
    },
  };
});
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
const conversations: Conversation[] = [
  {
    id: "one",
    title: "Grace",
    otherUser: { id: "grace", name: "Grace", initials: "GH", color: "#fff" },
    lastMessage: null,
    lastAt: null,
  },
  {
    id: "two",
    title: "Linus",
    otherUser: { id: "linus", name: "Linus", initials: "LT", color: "#fff" },
    lastMessage: null,
    lastAt: null,
  },
];
const base = {
  messages: [],
  selfId: "ada",
  conversations,
  currentConversationId: "one",
  status: "ready" as const,
  syncError: null,
  onRetrySync: vi.fn(),
  onForward: vi.fn(),
  onRetrySend: vi.fn(),
};
const message: Message = {
  id: "abc",
  seq: 1,
  conversationId: "one",
  senderId: "grace",
  body: "Hello Ada!",
  media: null,
  forwardedFromId: null,
  clientNonce: null,
  createdAt: "2026-10-23T10:00:00Z",
};
describe("message list behavior", () => {
  it("announces loading while initial messages synchronize", () => {
    render(<MessageList {...base} status="loading" />);
    expect(screen.getByRole("status")).toHaveTextContent("Synchronizing");
  });
  it("exposes error and actionable retry", () => {
    const retry = vi.fn();
    render(
      <MessageList
        {...base}
        status="error"
        syncError="Network down"
        onRetrySync={retry}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Network down");
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(retry).toHaveBeenCalledOnce();
  });
  it("renders an accessible empty state", () => {
    render(<MessageList {...base} />);
    expect(screen.getByText("Make the first move.")).toBeInTheDocument();
  });
  it("offers keyboard-operable forwarding and renders inbound message", () => {
    const forward = vi.fn();
    render(<MessageList {...base} messages={[message]} onForward={forward} />);
    expect(screen.getByText("Hello Ada!")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /forward message/i }));
    fireEvent.click(screen.getByRole("button", { name: "Linus" }));
    expect(forward).toHaveBeenCalledWith("abc", "two");
  });
  it("renders retry control on a failed queued message", () => {
    const retry = vi.fn();
    render(
      <MessageList
        {...base}
        messages={[
          {
            ...message,
            id: "pending",
            senderId: "__self__",
            clientNonce: "nonce",
            seq: Number.MAX_SAFE_INTEGER,
            status: "failed" as const,
            error: "Timeout",
          },
        ]}
        onRetrySend={retry}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Timeout");
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(retry).toHaveBeenCalledWith("nonce");
  });
});
