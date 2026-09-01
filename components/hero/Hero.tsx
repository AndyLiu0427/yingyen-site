"use client";

import Link from "next/link";
import { site } from "@/lib/site";

export default function Hero() {
  return (
    <section className="relative flex h-[100svh] min-h-[620px] flex-col">
      <header className="z-20 flex items-center justify-between px-6 pt-6 sm:px-10 sm:pt-8">
        <p className="animate-rise font-mono text-xs tracking-[0.18em] text-muted uppercase">
          {site.role}
        </p>
        <nav className="flex animate-rise gap-5 font-mono text-sm [animation-delay:100ms]">
          <Link
            href="/lab"
            className="-m-2 p-2 text-muted transition-colors duration-150 hover:text-ink"
          >
            lab
          </Link>
          {site.links.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="-m-2 p-2 text-muted transition-colors duration-150 hover:text-ink"
            >
              {link.label}
            </a>
          ))}
        </nav>
      </header>

      {/* Giant name; the blob floats in front of it */}
      <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center">
        <h1 className="-translate-y-[14svh] px-4 text-center font-display font-light leading-[0.95] tracking-tight text-ink [text-wrap:balance] sm:translate-y-0">
          <span className="block -translate-x-[3vw] animate-rise text-[clamp(4rem,14vw,12.5rem)] [animation-delay:150ms]">
            YingYen
          </span>
          <span className="block translate-x-[9vw] animate-rise text-[clamp(4rem,14vw,12.5rem)] italic text-accent [animation-delay:300ms]">
            Liu
          </span>
        </h1>
      </div>

      <div className="z-20 mt-auto flex items-end justify-between px-6 pb-8 sm:px-10 sm:pb-10">
        <p className="max-w-[36ch] animate-rise text-sm leading-relaxed text-muted [animation-delay:450ms] [text-wrap:pretty]">
          {site.tagline}
        </p>
        <p
          aria-hidden
          className="hidden animate-rise font-mono text-xs text-faint [animation-delay:600ms] sm:block"
        >
          <span className="inline-block animate-bob">&darr;</span> scroll
        </p>
      </div>
    </section>
  );
}
