"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Lock, UserRound } from "lucide-react";
export function LoginForm() {
  const router = useRouter();
  const [name, setName] = useState("Ada Lovelace");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, password }),
        signal: abort.signal,
      });
      if (!res.ok) throw new Error("Sign-in failed. Check your password.");
      router.replace("/chats");
      router.refresh();
    } catch (err) {
      if (abort.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Sign-in failed.");
      setBusy(false);
    }
  };
  return (
    <form
      className="login-form"
      onSubmit={(e) => {
        void submit(e);
      }}
    >
      <label htmlFor="account">Account</label>
      <div className="field-with-icon">
        <UserRound size={18} />
        <select
          id="account"
          value={name}
          onChange={(e) => setName(e.target.value)}
        >
          <option>Ada Lovelace</option>
          <option>Grace Hopper</option>
          <option>Linus Torvalds</option>
        </select>
      </div>
      <label htmlFor="password">Password</label>
      <div className="field-with-icon">
        <Lock size={18} />
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter account password"
        />
      </div>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <button
        type="submit"
        className="primary-button login-submit"
        disabled={busy}
      >
        {busy ? "Signing in…" : "Enter Relay"} <ArrowRight size={18} />
      </button>
    </form>
  );
}
