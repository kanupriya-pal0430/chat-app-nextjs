import Link from "next/link";
export default function NotFound() {
  return (
    <main className="centered">
      <h1>Conversation not found</h1>
      <p>You may not have access to this chat.</p>
      <Link href="/chats">Back to chats</Link>
    </main>
  );
}
