"use client";
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <main className="centered" role="alert">
      <h1>Conversation unavailable</h1>
      <p>{error.message || "Something went wrong."}</p>
      <button className="primary-button" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
