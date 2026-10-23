import { it, expect, describe } from "vitest";
import { messageBody, sendSchema } from "./validation";
const id = "e99cba20-0fcd-450c-820f-c297b74fc9df";
describe("server message validation", () => {
  it("trims, removes control characters and retains safe Unicode", () => {
    expect(messageBody.parse("  Hello\u0000 👋 \n")).toBe("Hello 👋");
  });
  it("rejects empty, oversized or spoofed payload properties", () => {
    expect(
      sendSchema.safeParse({ conversationId: id, clientNonce: id, body: "  " })
        .success
    ).toBe(false);
    expect(
      sendSchema.safeParse({
        conversationId: id,
        clientNonce: id,
        body: "x".repeat(2001),
      }).success
    ).toBe(false);
    expect(
      sendSchema.safeParse({
        conversationId: id,
        clientNonce: id,
        body: "Hi",
        senderId: "hacker",
      }).success
    ).toBe(false);
  });
});
