export type User = {
  id: string;
  name: string;
  initials: string;
  color: string;
};
export type Conversation = {
  id: string;
  title: string;
  otherUser: User;
  lastMessage: string | null;
  lastAt: string | null;
};
export type Media = {
  id: string;
  url: string;
  kind: "image" | "video";
  name: string;
  altText?: string;
};
export type Message = {
  id: string;
  seq: number;
  conversationId: string;
  senderId: string;
  body: string;
  media: Media | null;
  forwardedFromId: string | null;
  clientNonce: string | null;
  createdAt: string;
};
export type SendMessage = {
  conversationId: string;
  clientNonce: string;
  body: string;
  uploadId?: string;
  altText?: string;
};
export type ForwardMessage = {
  destinationConversationId: string;
  originalMessageId: string;
  clientNonce: string;
};
export type SendAck =
  | { ok: true; message: Message }
  | { ok: false; code: string; error: string };
export type TypingPayload = { conversationId: string; isTyping: boolean };
export type TypingNotice = TypingPayload & { userId: string };
export interface ClientToServerEvents {
  "message:send": (
    payload: SendMessage,
    ack: (response: SendAck) => void
  ) => void;
  "message:forward": (
    payload: ForwardMessage,
    ack: (response: SendAck) => void
  ) => void;
  "typing:set": (payload: TypingPayload) => void;
}
export interface ServerToClientEvents {
  "message:new": (message: Message) => void;
  "typing:update": (notice: TypingNotice) => void;
}
export interface SocketData {
  user: User;
}
