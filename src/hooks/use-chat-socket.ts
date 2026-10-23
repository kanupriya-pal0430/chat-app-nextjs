
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDispatch, useSelector, useStore } from "react-redux";
import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  Media,
  Message,
  SendMessage,
  ForwardMessage,
} from "@/lib/shared/types";
import type { AppDispatch, RootState } from "@/store";
import {
  markSynced,
  queueMessage,
  receiveMessages,
  requeueSending,
  setOnline,
  setOutgoingStatus,
  setSyncStatus,
  setTyping,
} from "@/store/chat-slice";

type ChatSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const ACK_TIMEOUT = 8500;

export function useChatSocket(conversationId: string) {
  const socketRef = useRef<ChatSocket | null>(null);
  const inflight = useRef(new Set<string>());
  const pendingForwards = useRef(new Map<string, ForwardMessage>());
  const forwarding = useRef(new Set<string>());
  const connectionVersion = useRef(0);
  const store = useStore<RootState>();
  const dispatch = useDispatch<AppDispatch>();

  const [retryCounter, setRetryCounter] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  const online = useSelector((state: RootState) => state.chat.online);
  const typingTimers = useRef(
    new Map<string, ReturnType<typeof setTimeout>>()
  );

  const flush = useCallback(() => {
    const socket = socketRef.current;
    if (!socket?.connected) return;

    const queued = Object.values(store.getState().chat.outbox).filter(
      (item) => item.status === "queued"
    );

    for (const outgoing of queued) {
      if (inflight.current.has(outgoing.clientNonce)) continue;

      inflight.current.add(outgoing.clientNonce);

      dispatch(
        setOutgoingStatus({
          nonce: outgoing.clientNonce,
          status: "sending",
        })
      );

      const request: SendMessage = {
        conversationId: outgoing.conversationId,
        clientNonce: outgoing.clientNonce,
        body: outgoing.body,
        ...(outgoing.uploadId ? { uploadId: outgoing.uploadId } : {}),
        ...(outgoing.media?.altText
          ? { altText: outgoing.media.altText }
          : {}),
      };

      const version = connectionVersion.current;

      socket
        .timeout(ACK_TIMEOUT)
        .emit("message:send", request, (err, response) => {
          if (version !== connectionVersion.current) return;

          inflight.current.delete(outgoing.clientNonce);

          if (err) {
            dispatch(
              setOutgoingStatus({
                nonce: outgoing.clientNonce,
                status: "failed",
                error: "Delivery not confirmed.",
              })
            );
            return;
          }

          if (response.ok) {
            dispatch(receiveMessages([response.message]));
          } else {
            dispatch(
              setOutgoingStatus({
                nonce: outgoing.clientNonce,
                status: "failed",
                error: response.error,
              })
            );
          }
        });
    }
  }, [store, dispatch]);

  useEffect(() => {
    const socket: ChatSocket = io({
      autoConnect: false,
      withCredentials: true,
      reconnection: true,
      transports: ["websocket"],
    });

    socketRef.current = socket;

    let activeSync: AbortController | null = null;
    let disposed = false;
    let flushScheduled = false;
    let previousOutbox = store.getState().chat.outbox;

    const scheduleFlush = () => {
      if (flushScheduled || disposed) return;

      flushScheduled = true;

      queueMicrotask(() => {
        flushScheduled = false;

        if (!disposed && socketRef.current === socket) {
          flush();
        }
      });
    };

    const unsubscribe = store.subscribe(() => {
      const currentOutbox = store.getState().chat.outbox;

      if (currentOutbox === previousOutbox) return;

      previousOutbox = currentOutbox;

      if (
        Object.values(currentOutbox).some(
          (item) => item.status === "queued"
        )
      ) {
        scheduleFlush();
      }
    });

    const clearTimers = () => {
      for (const timer of typingTimers.current.values()) {
        clearTimeout(timer);
      }

      typingTimers.current.clear();
    };

    const sync = async () => {
      activeSync?.abort();

      const abort = new AbortController();
      activeSync = abort;

      dispatch(setSyncStatus({ status: "loading" }));

      let cursor =
        store.getState().chat.syncedThrough[conversationId] ?? 0;

      try {
        for (let page = 0; page < 100; page++) {
          const response = await fetch(
            `/api/conversations/${conversationId}/messages?after=${cursor}`,
            {
              signal: abort.signal,
              cache: "no-store",
            }
          );

          if (!response.ok) {
            throw new Error(
              response.status === 401
                ? "Session expired. Sign in again."
                : "Could not synchronize history."
            );
          }

          const data: unknown = await response.json();

          if (
            !data ||
            typeof data !== "object" ||
            !("messages" in data) ||
            !Array.isArray(data.messages) ||
            !("hasMore" in data)
          ) {
            throw new Error("Invalid sync response.");
          }

          const batch = data.messages as Message[];

          dispatch(receiveMessages(batch));

          if (batch.length) {
            cursor = batch[batch.length - 1].seq;

            dispatch(markSynced({ conversationId, seq: cursor }));
          }

          if (!data.hasMore) {
            dispatch(setSyncStatus({ status: "ready" }));
            return;
          }

          if (batch.length === 0) {
            throw new Error("Synchronization stalled.");
          }
        }

        throw new Error(
          "History too large; retry to continue synchronization."
        );
      } catch (error) {
        if (!abort.signal.aborted) {
          dispatch(
            setSyncStatus({
              status: "error",
              error:
                error instanceof Error
                  ? error.message
                  : "Sync failed",
            })
          );
        }
      }
    };

    const onConnect = () => {
      dispatch(setOnline(true));
      void sync();
      scheduleFlush();
    };

    const onDisconnect = () => {
      connectionVersion.current += 1;
      activeSync?.abort();

      dispatch(setOnline(false));
      inflight.current.clear();
      forwarding.current.clear();
      dispatch(requeueSending());
      clearTimers();
    };

    const onMessage = (message: Message) => {
      dispatch(receiveMessages([message]));
    };

    const onTyping = (event: {
      conversationId: string;
      userId: string;
      isTyping: boolean;
    }) => {
      if (event.conversationId !== conversationId) return;

      dispatch(
        setTyping({
          userId: event.userId,
          isTyping: event.isTyping,
        })
      );

      const old = typingTimers.current.get(event.userId);

      if (old) clearTimeout(old);

      if (event.isTyping) {
        typingTimers.current.set(
          event.userId,
          setTimeout(() => {
            dispatch(
              setTyping({
                userId: event.userId,
                isTyping: false,
              })
            );
          }, 3000)
        );
      }
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("message:new", onMessage);
    socket.on("typing:update", onTyping);

    socket.on("connect_error", () => {
      dispatch(setOnline(false));

      dispatch(
        setSyncStatus({
          status: "error",
          error:
            "Could not connect to real-time server. Retry when network returns.",
        })
      );
    });

    socket.connect();

    return () => {
      disposed = true;
      unsubscribe();

      connectionVersion.current += 1;
      activeSync?.abort();
      clearTimers();

      socket.removeAllListeners();
      socket.disconnect();

      if (socketRef.current === socket) {
        socketRef.current = null;
      }

      inflight.current.clear();
      dispatch(requeueSending());
      dispatch(setOnline(false));
    };
  }, [conversationId, dispatch, store, flush, retryCounter]);

  const send = useCallback(
    (body: string, media: Media | null) => {
      const clientNonce = crypto.randomUUID();

      dispatch(
        queueMessage({
          clientNonce,
          conversationId,
          body,
          media,
          uploadId: media?.id,
          createdAt: new Date().toISOString(),
          status: "queued",
          error: null,
        })
      );

      queueMicrotask(flush);
    },
    [conversationId, dispatch, flush]
  );

  const retrySend = useCallback(
    (nonce: string) => {
      dispatch(
        setOutgoingStatus({
          nonce,
          status: "queued",
        })
      );

      queueMicrotask(flush);
    },
    [dispatch, flush]
  );

  const forward = useCallback(
    (
      originalMessageId: string,
      destinationConversationId: string
    ) => {
      const socket = socketRef.current;
  
      if (!socket?.connected) {
        setNotice("You are offline. Reconnect before forwarding.");
        return;
      }
  
      const key = `${originalMessageId}:${destinationConversationId}`;
  
      if (forwarding.current.has(key)) return;
  
      let request = pendingForwards.current.get(key);
  
      if (!request) {
        request = {
          originalMessageId,
          destinationConversationId,
          clientNonce: crypto.randomUUID(),
        };
  
        pendingForwards.current.set(key, request);
      }
  
      forwarding.current.add(key);
  
      socket
        .timeout(ACK_TIMEOUT)
        .emit("message:forward", request, (err, response) => {
          forwarding.current.delete(key);
  
          if (err) {
            setNotice("Forward not confirmed. Retry from the message.");
            return;
          }
  
          pendingForwards.current.delete(key);
  
          if (response.ok) {
            dispatch(receiveMessages([response.message]));
            setNotice("Message forwarded successfully.");
          } else {
            setNotice(response.error);
          }
        });
    },
    [dispatch]
  );

  const setTypingStatus = useCallback(
    (isTyping: boolean) => {
      if (socketRef.current?.connected) {
        socketRef.current.emit("typing:set", {
          conversationId,
          isTyping,
        });
      }
    },
    [conversationId]
  );

  return {
    online,
    send,
    retrySend,
    forward,
    setTypingStatus,
    notice,
    clearNotice: () => setNotice(null),
    retrySync: () => setRetryCounter((x) => x + 1),
  };
}
