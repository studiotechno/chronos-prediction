"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Leads" },
  { href: "/couverture", label: "Couverture" },
  { href: "/resolution", label: "Résolution" },
  { href: "/ingestion", label: "Ingestion" },
  { href: "/reglages", label: "Réglages" },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-0.5 text-sm overflow-x-auto">
      {NAV.map((item) => {
        const actif =
          item.href === "/" ? pathname === "/" || pathname.startsWith("/lead/") : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "px-3 py-1.5 rounded-md whitespace-nowrap transition-colors",
              actif
                ? "text-foreground font-medium bg-accent"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/60",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
