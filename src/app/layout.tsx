import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
/* Face d'affichage — titres d'écran, grands nombres, en-têtes de rubrique.
   Bricolage Grotesque est une grotesque contemporaine à chasse resserrée :
   elle donne du caractère aux quelques mots qui portent l'écran, là où Geist
   reste la voix neutre du corps de texte. */
const bricolage = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Chronos — leads intérim",
  description:
    "Détection de leads chauds pour l'intérim à partir de données publiques (SIRENE, France Travail, DECP, BODACC).",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        {/* Le thème doit être posé avant la première peinture, sinon l'écran
            clignote en clair avant de passer au noir. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} ${bricolage.variable} antialiased`}>{children}</body>
    </html>
  );
}
