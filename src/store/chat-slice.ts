import {
  createSelector,
  createSlice,
  type PayloadAction,
} from "@reduxjs/toolkit";
import type { Message, Media } from "@/lib/shared/types";

export type Outgoing = {
  clientNonce: string;
  conversationId: string;
  body: string;
  media: Media | null;
  uploadId?: string;
  createdAt: string;
  status: "queued" | "sending" | "failed";
  error: string | null;
};
export type SyncState = "loading" | "ready" | "error";
export interface ChatState {
  messages: Record<string, Message>;
  outbox: Record<string, Outgoing>;
  syncedThrough: Record<string, number>;
  syncState: SyncState;
  syncError: string | null;
  online: boolean;
  typing: Record<string, boolean>;
}
export const initialChatState: ChatState = {
  messages: {},
  outbox: {},
  syncedThrough: {},
  syncState: "loading",
  syncError: null,
  online: false,
  typing: {},
};
const slice = createSlice({
  name: "chat",
  initialState: initialChatState,
  reducers: {
    hydrate(
      state,
      action: PayloadAction<{
        conversationId: string;
        messages: Message[];
      }>
    ) {
      const { conversationId, messages } = action.payload;
    
      for (const message of messages) {
        state.messages[message.id] = message;
      }
    
      const previousCursor =
        state.syncedThrough[conversationId] ?? 0;
    
      const highestReceivedSeq = messages.reduce(
        (highest, message) =>
          Math.max(highest, message.seq),
        0
      );
    
      state.syncedThrough[conversationId] = Math.max(
        previousCursor,
        highestReceivedSeq
      );
    },
    receiveMessages(state, action: PayloadAction<Message[]>) {
      for (const m of action.payload) {
        state.messages[m.id] = m;
        if (m.clientNonce) delete state.outbox[m.clientNonce];
      }
    },
    queueMessage(state, action: PayloadAction<Outgoing>) {
      state.outbox[action.payload.clientNonce] = action.payload;
    },
    setOutgoingStatus(
      state,
      action: PayloadAction<{
        nonce: string;
        status: Outgoing["status"];
        error?: string | null;
      }>
    ) {
      const item = state.outbox[action.payload.nonce];
      if (item) {
        item.status = action.payload.status;
        item.error = action.payload.error ?? null;
      }
    },
    requeueSending(state) {
      for (const item of Object.values(state.outbox))
        if (item.status === "sending") item.status = "queued";
    },
    setOnline(state, action: PayloadAction<boolean>) {
      state.online = action.payload;
    },
    setSyncStatus(
      state,
      action: PayloadAction<{ status: SyncState; error?: string }>
    ) {
      state.syncState = action.payload.status;
      state.syncError = action.payload.error ?? null;
    },
    markSynced(
      state,
      action: PayloadAction<{ conversationId: string; seq: number }>
    ) {
      state.syncedThrough[action.payload.conversationId] = Math.max(
        state.syncedThrough[action.payload.conversationId] ?? 0,
        action.payload.seq
      );
    },
    setTyping(
      state,
      action: PayloadAction<{ userId: string; isTyping: boolean }>
    ) {
      state.typing[action.payload.userId] = action.payload.isTyping;
    },
  },
});
export const {
  hydrate,
  receiveMessages,
  queueMessage,
  setOutgoingStatus,
  requeueSending,
  setOnline,
  setSyncStatus,
  markSynced,
  setTyping,
} = slice.actions;
export const chatReducer = slice.reducer;
type StoreState = { chat: ChatState };
export const selectOnline = (state: StoreState) => state.chat.online;
export const selectSyncStatus = (state: StoreState) => state.chat.syncState;
export const selectSyncError = (state: StoreState) => state.chat.syncError;
export const selectOutbox = (state: StoreState) => state.chat.outbox;
export const selectTyping = (state: StoreState) => state.chat.typing;
const selectMessagesById = (state: StoreState) => state.chat.messages;
const selectOutboxById = (state: StoreState) => state.chat.outbox;
const selectConversationId = (_state: StoreState, conversationId: string) =>
  conversationId;
// Memoized: sorting/filtering never occurs in a render body or on unrelated state changes.
export const selectLatestByConversation = createSelector(
  [selectMessagesById],
  (byId) => {
    const latest: Record<string, Message> = {};
    for (const m of Object.values(byId)) {
      if (!latest[m.conversationId] || latest[m.conversationId].seq < m.seq)
        latest[m.conversationId] = m;
    }
    return latest;
  }
);
export const selectConversationMessages = createSelector(
  [selectMessagesById, selectOutboxById, selectConversationId],
  (byId, outbox, id) => {
    const delivered = Object.values(byId)
      .filter((m) => m.conversationId === id)
      .sort((a, b) => a.seq - b.seq);
    const pending = Object.values(outbox)
      .filter((m) => m.conversationId === id)
      .map((o) => ({
        id: o.clientNonce,
        seq: Number.MAX_SAFE_INTEGER,
        conversationId: o.conversationId,
        senderId: "__self__",
        body: o.body,
        media: o.media,
        forwardedFromId: null,
        clientNonce: o.clientNonce,
        createdAt: o.createdAt,
        status: o.status,
        error: o.error,
      }));
    return [...delivered, ...pending];
  }
);
export type ViewMessage = Message & {
  status?: Outgoing["status"];
  error?: string | null;
};
