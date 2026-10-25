"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Led } from "./ui";

/** Header navigation. Pages come from lib/modules.ts, which the generator fills in. */
export function Nav({ links }: { links: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <nav className="nav" aria-label="Main">
      {links.map((l) => {
        const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
        return (
          <Link key={l.href} href={l.href} aria-current={active ? "page" : undefined}>
            <Led />
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
