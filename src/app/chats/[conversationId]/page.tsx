import { notFound } from "next/navigation";
import { requireUser } from "@/lib/server/auth";
import {
  getConversations,
  getConversationMessages,
  isMember,
} from "@/lib/server/db";
import { idSchema } from "@/lib/shared/validation";
import { ChatProvider } from "@/store/provider";
import { ChatShell } from "@/components/chat-shell";
export const dynamic = "force-dynamic";
export default async function ConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const user = await requireUser();
  const { conversationId } = await params;
  if (
    !idSchema.safeParse(conversationId).success ||
    !isMember(user.id, conversationId)
  )
    notFound();
  // Server Component: authenticate, authorize, and load initial data before hydration.
  const conversations = getConversations(user.id);
  const initialMessages = getConversationMessages(conversationId, null, 50);
  return (
    <ChatProvider
      key={conversationId}
      conversationId={conversationId}
      messages={initialMessages}
    >
      <ChatShell
        user={user}
        conversations={conversations}
        conversationId={conversationId}
      />
    </ChatProvider>
  );
}
