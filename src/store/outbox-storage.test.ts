// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import type { Message } from "@/lib/shared/types";
import {
  chatReducer,
  hydrate,
  receiveMessages,
  restoreOutbox,
  type Outgoing,
} from "./chat-slice";
import { clearOutbox, loadOutbox, saveOutbox } from "./outbox-storage";

const userId = "user-1";
const otherUserId = "user-2";
const conversationId = "550e8400-e29b-41d4-a716-446655440001";
const clientNonce = "550e8400-e29b-41d4-a716-446655440002";

const createOutgoing = (overrides: Partial<Outgoing> = {}): Outgoing => ({
  clientNonce,
  conversationId,
  body: "Test message",
  media: null,
  createdAt: "2026-10-23T10:00:00.000Z",
  status: "queued",
  error: null,
  ...overrides,
});

const createMessage = (overrides: Partial<Message> = {}): Message => ({
  id: "550e8400-e29b-41d4-a716-446655440003",
  seq: 1,
  conversationId,
  senderId: userId,
  body: "Test message",
  media: null,
  forwardedFromId: null,
  clientNonce,
  createdAt: "2026-10-23T10:00:01.000Z",
  ...overrides,
});

describe("outbox storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("persists and restores queued messages", () => {
    const message = createOutgoing();

    saveOutbox(userId, [message]);

    expect(loadOutbox(userId)).toEqual([message]);
  });

  it("keeps messages isolated between users", () => {
    const firstMessage = createOutgoing();

    const secondMessage = createOutgoing({
      clientNonce: "550e8400-e29b-41d4-a716-446655440004",
      body: "Another message",
    });

    saveOutbox(userId, [firstMessage]);
    saveOutbox(otherUserId, [secondMessage]);

    expect(loadOutbox(userId)).toEqual([firstMessage]);
    expect(loadOutbox(otherUserId)).toEqual([secondMessage]);
  });

  it("returns an empty outbox for invalid JSON", () => {
    localStorage.setItem(`relay:outbox:v1:${userId}`, "{invalid-json");

    expect(loadOutbox(userId)).toEqual([]);
  });

  it("rejects invalid stored messages", () => {
    localStorage.setItem(
      `relay:outbox:v1:${userId}`,
      JSON.stringify([
        createOutgoing({ status: "queued" }),
        { ...createOutgoing(), status: "unknown" },
      ])
    );

    expect(loadOutbox(userId)).toEqual([]);
  });

  it("clears only the specified user's outbox", () => {
    const message = createOutgoing();

    saveOutbox(userId, [message]);
    saveOutbox(otherUserId, [message]);

    clearOutbox(userId);

    expect(loadOutbox(userId)).toEqual([]);
    expect(loadOutbox(otherUserId)).toEqual([message]);
  });
});

describe("outbox recovery", () => {
  it("restores interrupted sending messages as queued", () => {
    const pending = createOutgoing({
      status: "sending",
      error: "Connection interrupted",
    });

    const state = chatReducer(undefined, restoreOutbox([pending]));

    expect(state.outbox[clientNonce]).toMatchObject({
      status: "queued",
      error: null,
    });
  });

  it("preserves failed message status after restoration", () => {
    const pending = createOutgoing({
      status: "failed",
      error: "Delivery not confirmed",
    });

    const state = chatReducer(undefined, restoreOutbox([pending]));

    expect(state.outbox[clientNonce]).toMatchObject({
      status: "failed",
      error: "Delivery not confirmed",
    });
  });

  it("does not restore already confirmed messages", () => {
    const confirmed = createMessage();

    const initialState = chatReducer(undefined, receiveMessages([confirmed]));

    const state = chatReducer(initialState, restoreOutbox([createOutgoing()]));

    expect(state.outbox[clientNonce]).toBeUndefined();
    expect(state.messages[confirmed.id]).toEqual(confirmed);
  });

  it("removes pending messages when server confirms delivery", () => {
    const pending = createOutgoing();
    const confirmed = createMessage();

    const restoredState = chatReducer(undefined, restoreOutbox([pending]));

    const state = chatReducer(restoredState, receiveMessages([confirmed]));

    expect(state.outbox[clientNonce]).toBeUndefined();
    expect(state.messages[confirmed.id]).toEqual(confirmed);
  });

  it("reconciles pending messages during SSR hydration", () => {
    const pending = createOutgoing();
    const confirmed = createMessage();

    const restoredState = chatReducer(undefined, restoreOutbox([pending]));

    const state = chatReducer(
      restoredState,
      hydrate({
        conversationId,
        messages: [confirmed],
      })
    );

    expect(state.outbox[clientNonce]).toBeUndefined();
    expect(state.messages[confirmed.id]).toEqual(confirmed);
    expect(state.syncedThrough[conversationId]).toBe(1);
  });

  it("preserves the original nonce across restoration", () => {
    const pending = createOutgoing();

    saveOutbox(userId, [pending]);

    const restoredState = chatReducer(
      undefined,
      restoreOutbox(loadOutbox(userId))
    );

    expect(restoredState.outbox[clientNonce].clientNonce).toBe(clientNonce);
  });

  it("does not duplicate messages on repeated restoration", () => {
    const pending = createOutgoing();

    const firstState = chatReducer(undefined, restoreOutbox([pending]));

    const secondState = chatReducer(firstState, restoreOutbox([pending]));

    expect(Object.keys(secondState.outbox)).toHaveLength(1);
    expect(secondState.outbox[clientNonce]).toEqual(pending);
  });
});
