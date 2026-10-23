"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Provider } from "react-redux";
import { makeStore, type AppStore } from "./index";
import { restoreOutbox, selectOutbox } from "./chat-slice";
import { loadOutbox, saveOutbox } from "./outbox-storage";

export function ChatProvider({
  userId,
  children,
}: {
  userId: string;
  children: ReactNode;
}) {
  const storeRef = useRef<AppStore | null>(null);

  if (!storeRef.current) {
    storeRef.current = makeStore();
  }

  useEffect(() => {
    const store = storeRef.current;
    if (!store) return;

    const savedMessages = loadOutbox(userId);
    store.dispatch(restoreOutbox(savedMessages));

    let previousOutbox = selectOutbox(store.getState());

    saveOutbox(userId, Object.values(previousOutbox));

    const unsubscribe = store.subscribe(() => {
      const currentOutbox = selectOutbox(store.getState());

      if (currentOutbox === previousOutbox) return;

      previousOutbox = currentOutbox;
      saveOutbox(userId, Object.values(currentOutbox));
    });

    return () => {
      unsubscribe();
    };
  }, [userId]);

  return <Provider store={storeRef.current}>{children}</Provider>;
}
