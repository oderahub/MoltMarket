import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MoltMarket Terminal",
  description: "The Bloomberg Terminal for AI Agents — Bitcoin Intelligence Bounty Board",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
