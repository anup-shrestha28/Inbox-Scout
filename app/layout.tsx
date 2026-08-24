import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "InboxScout — Find the right inbox",
  description: "Public lead discovery and thoughtful job outreach for email designers.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
