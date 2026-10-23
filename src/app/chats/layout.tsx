import { requireUser } from "@/lib/server/auth";
import { ChatProvider } from "@/store/provider";

export default async function ChatsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();

  return (
    <ChatProvider key={user.id} userId={user.id}>
      {children}
    </ChatProvider>
  );
}
