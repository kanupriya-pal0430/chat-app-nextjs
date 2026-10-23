"use client";
import { useRef, type ReactNode } from "react";
import { Provider } from "react-redux";
import { makeStore, type AppStore } from "./index";
import { hydrate } from "./chat-slice";
import type { Message } from "@/lib/shared/types";
export function ChatProvider({
  conversationId,
  messages,
  children,
}: {
  conversationId: string;
  messages: Message[];
  children: ReactNode;
}) {
  const store = useRef<AppStore | null>(null);
  if (!store.current) {
    store.current = makeStore();
    store.current.dispatch(hydrate({ conversationId, messages }));
  }
  return <Provider store={store.current}>{children}</Provider>;
}
