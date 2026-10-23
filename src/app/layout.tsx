import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Relay — Real-time conversations",
  description: "Reliable, personal real-time messaging",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
