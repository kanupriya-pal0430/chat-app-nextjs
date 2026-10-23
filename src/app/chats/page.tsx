import { redirect } from "next/navigation";
import { requireUser } from "@/lib/server/auth";
import { getConversations } from "@/lib/server/db";
export const dynamic = "force-dynamic";
export default async function Chats() {
  const user = await requireUser();
  const first = getConversations(user.id)[0];
  if (first) redirect(`/chats/${first.id}`);
  return (
    <main className="centered">
      <h1>No conversations yet</h1>
    </main>
  );
}
