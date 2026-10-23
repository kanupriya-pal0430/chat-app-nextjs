import { describe, it, expect } from "vitest";
import { makeStore } from "./index";
import {
  hydrate,
  queueMessage,
  receiveMessages,
  markSynced,
  selectConversationMessages,
  chatReducer,
} from "./chat-slice";
import type { Message } from "@/lib/shared/types";
const m = (id: string, seq: number, conversationId = "one"): Message => ({
  id,
  seq,
  conversationId,
  senderId: "ada",
  body: id,
  media: null,
  forwardedFromId: null,
  clientNonce: null,
  createdAt: "2026-10-23T00:00:00Z",
});
describe("normalized message selector", () => {
  it("filters conversation, sorts by server sequence, memoizes unchanged inputs", () => {
    const store = makeStore();
    store.dispatch(
      hydrate({
        conversationId: "one",
        messages: [m("b", 7), m("z", 2), m("another", 10, "two")],
      })
    );
    const one = selectConversationMessages(store.getState(), "one");
    expect(one.map((m) => m.id)).toEqual(["z", "b"]);
    expect(selectConversationMessages(store.getState(), "one")).toBe(one);
    store.dispatch(markSynced({ conversationId: "one", seq: 11 }));
    expect(selectConversationMessages(store.getState(), "one")).toBe(one);
  });
  it("deduplicates replayed socket events by server ID", () => {
    const store = makeStore();
    const message = m("first", 3);
    store.dispatch(receiveMessages([message]));
    store.dispatch(receiveMessages([message]));
    expect(selectConversationMessages(store.getState(), "one")).toHaveLength(1);
  });
  it("does not duplicate repeated socket messages", () => {
    const message = {
      id: "message-1",
      seq: 1,
      conversationId: "chat-1",
      senderId: "ada",
      body: "Hello Grace",
      media: null,
      forwardedFromId: null,
      clientNonce: "nonce-1",
      createdAt: "2026-10-23T10:00:00.000Z",
    };
  
    let state = chatReducer(
      undefined,
      receiveMessages([message])
    );
  
    state = chatReducer(
      state,
      receiveMessages([message])
    );
  
    state = chatReducer(
      state,
      receiveMessages([message])
    );
  
    expect(Object.keys(state.messages)).toHaveLength(1);
    expect(state.messages["message-1"]).toEqual(message);
  });
  it("removes optimistic message when server confirms it", () => {
    const outgoing = {
      clientNonce: "nonce-123",
      conversationId: "chat-1",
      body: "Hello Grace",
      media: null,
      createdAt: "2026-10-23T10:00:00.000Z",
      status: "queued" as const,
      error: null,
    };
  
    let state = chatReducer(
      undefined,
      queueMessage(outgoing)
    );
  
    expect(Object.keys(state.outbox)).toHaveLength(1);
  
    state = chatReducer(
      state,
      receiveMessages([
        {
          id: "server-message-1",
          seq: 10,
          conversationId: "chat-1",
          senderId: "ada",
          body: "Hello Grace",
          media: null,
          forwardedFromId: null,
          clientNonce: "nonce-123",
          createdAt: "2026-10-23T10:00:00.000Z",
        },
      ])
    );
  
    expect(Object.keys(state.outbox)).toHaveLength(0);
    expect(Object.keys(state.messages)).toHaveLength(1);
  });
  it("reconciles optimistic outbox items by client nonce", () => {
    const store = makeStore();
    const nonce = "69ed2cb9-33aa-402b-ac85-ddf055b2f400";
    store.dispatch(
      queueMessage({
        clientNonce: nonce,
        conversationId: "one",
        body: "hello",
        media: null,
        createdAt: "2026-10-23T00:00:00Z",
        status: "queued",
        error: null,
      })
    );
    expect(selectConversationMessages(store.getState(), "one")[0].id).toBe(
      nonce
    );
    store.dispatch(
      receiveMessages([{ ...m("server-id", 20), clientNonce: nonce }])
    );
    expect(
      selectConversationMessages(store.getState(), "one").map((m) => m.id)
    ).toEqual(["server-id"]);
    expect(store.getState().chat.outbox[nonce]).toBeUndefined();
  });
});
