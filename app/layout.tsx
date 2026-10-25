import type { Metadata } from "next";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import { modules } from "@/lib/modules";
import "./globals.css";

// Fonts load in the browser from Google Fonts, so building needs no network. Archivo's width
// axis (62–125) gives the wide headings. Swap the link and the --sans/--mono tokens in globals.css to restyle.
const FONTS =
  "https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..800&family=Martian+Mono:wght@400;500;600&display=swap";

export const metadata: Metadata = {
  title: "Verdikt · Insurer reputation from proven claims",
  description: "Verdikt rates insurers only from verified claim outcomes, with AI agents that pay each other in devnet USDC.",
};

// The starter's Gemini chat and Paid API pages are left out: Verdikt uses Groq and pays workers directly.
const links = [{ href: "/", label: "Review" }, { href: "/claim", label: "Add a claim" }, ...modules.filter((m) => m.href && m.id === "race").map((m) => ({ href: m.href!, label: m.name }))];
const usesPayments = modules.some((m) => m.id === "payments");

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href={FONTS} />
      </head>
      <body>
        <header className="header">
          <div className="header-inner">
            <Link href="/" className="wordmark">
              <b>VERDIKT</b>
              <span>insurer reputation from proven claims</span>
            </Link>
            <Nav links={links} />
          </div>
        </header>
        <main className="page">{children}</main>
        <footer className="footer">
          <div className="footer-inner">
            <span>{usesPayments ? "SOLANA DEVNET · TEST MONEY ONLY" : "STARTER PROJECT"}</span>
            <span>BUILT WITH SUPERTEAM AGENT STUDIO</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
