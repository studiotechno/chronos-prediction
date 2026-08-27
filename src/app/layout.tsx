import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Chronos — Leads intérim",
  description:
    "Détection de leads chauds pour l'intérim à partir de données publiques (SIRENE, France Travail, DECP, BODACC).",
};

const NAV = [
  { href: "/", label: "Leads" },
  { href: "/couverture", label: "Couverture" },
  { href: "/resolution", label: "Résolution" },
  { href: "/ingestion", label: "Ingestion" },
  { href: "/reglages", label: "Réglages" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen bg-background text-foreground flex flex-col`}
      >
        <header className="border-b bg-card">
          <div className="mx-auto max-w-7xl px-4 flex items-center gap-6 h-12">
            <Link href="/" className="font-semibold tracking-tight">
              Chronos<span className="text-muted-foreground font-normal"> · leads intérim</span>
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="flex-1 mx-auto w-full max-w-7xl px-4 py-6">{children}</main>
        <footer className="border-t bg-card">
          <p className="mx-auto max-w-7xl px-4 py-2 text-xs text-muted-foreground">
            Données publiques (SIRENE, France Travail, DECP, BODACC). Aucune donnée personnelle
            n&apos;est collectée en V0.
          </p>
        </footer>
      </body>
    </html>
  );
}
