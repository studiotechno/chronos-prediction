import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { like } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { NavLinks } from "@/components/nav-links";
import "./globals.css";

const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Chronos — Leads intérim",
  description:
    "Détection de leads chauds pour l'intérim à partir de données publiques (SIRENE, France Travail, DECP, BODACC).",
};

function donneesDemo(): boolean {
  try {
    const db = getDb();
    return (
      db.select({ id: schema.signal.id }).from(schema.signal).where(like(schema.signal.source, "fixture:%")).limit(1).all()
        .length > 0
    );
  } catch {
    return false;
  }
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const demo = donneesDemo();
  return (
    <html lang="fr">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen bg-background text-foreground flex flex-col`}
      >
        <header className="border-b bg-card sticky top-0 z-40">
          <div className="mx-auto max-w-7xl px-4 flex items-center gap-5 h-12">
            <Link href="/" className="font-semibold tracking-tight shrink-0">
              Chronos
              <span className="text-muted-foreground font-normal hidden sm:inline"> · leads intérim</span>
            </Link>
            <NavLinks />
            {demo && (
              <span
                className="ml-auto shrink-0 rounded-full bg-sismo-soft text-sismo border border-sismo/30 px-2.5 py-0.5 text-[11px] font-medium"
                title="La base contient des fixtures : données fictives de démonstration, étiquetées comme telles."
              >
                Démo — données fictives
              </span>
            )}
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
