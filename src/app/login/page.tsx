import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/server/auth";
import { LoginForm } from "@/components/login-form";
export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/chats");
  return (
    <main className="login-layout">
      <div className="login-art">
        <div className="art-orbit orbit-one" />
        <div className="art-orbit orbit-two" />
        <div className="brand-glyph">✳</div>
        <p>MORE THAN WORDS</p>
        <h1>Every good conversation starts somewhere.</h1>
        <span>Stay in sync. Share a moment. Keep it moving.</span>
        <div className="art-bubble bubble-one">
          Hey, you there? <span>●</span>
        </div>
        <div className="art-bubble bubble-two">Always. ✨</div>
      </div>
      <div className="login-pane">
        <div className="login-card">
          <div className="eyebrow">WELCOME TO RELAY</div>
          <h2>Sign in to your space.</h2>
          <p>
            Choose an account and enter its configured password to start a real
            conversation.
          </p>
          <LoginForm />
          <p className="fine-print">
            Three local accounts are seeded on first boot. Credentials are
            configured in <code>.env.local</code>.
          </p>
        </div>
      </div>
    </main>
  );
}
