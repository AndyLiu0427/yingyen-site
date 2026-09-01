import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import LabSketch from "@/components/lab/LabSketch";
import { findSketch, labSketches } from "@/lib/lab";

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return labSketches.map((sketch) => ({ slug: sketch.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const sketch = findSketch(slug);
  if (!sketch) return {};
  return {
    title: `${sketch.name} · Lab · YingYen Liu`,
    description: sketch.blurb,
  };
}

export default async function SketchPage({ params }: Props) {
  const { slug } = await params;
  const sketch = findSketch(slug);
  if (!sketch) notFound();

  const index = labSketches.findIndex((item) => item.slug === slug);
  const next = labSketches[(index + 1) % labSketches.length];

  return (
    <div
      className={`flex-1 ${sketch.dark ? "bg-[#0b0d12]" : "atelier-bg"}`}
      // The dark sketch inverts the page, so text colours come from here rather
      // than from a second set of Tailwind classes on every element.
      style={
        sketch.dark
          ? {
              ["--color-ink" as string]: "#f2f4f8",
              ["--color-muted" as string]: "#98a0b2",
              ["--color-faint" as string]: "#69718a",
              ["--color-line" as string]: "#242a36",
              ["--color-accent" as string]: "#8fa4ff",
            }
          : undefined
      }
    >
      <div className="mx-auto w-full max-w-5xl px-6 pb-32 pt-10 sm:px-10">
        <Link
          href="/lab"
          className="-m-2 inline-block p-2 font-mono text-xs tracking-[0.18em] text-muted uppercase transition-colors duration-150 hover:text-ink"
        >
          &larr; Lab
        </Link>

        <div className="mt-10 overflow-hidden rounded-lg border border-line">
          <LabSketch
            slug={sketch.slug}
            label={`${sketch.name}: ${sketch.blurb}`}
            className="relative aspect-[16/10] w-full sm:aspect-[2/1]"
          />
        </div>

        <header className="mt-12 flex flex-wrap items-baseline justify-between gap-x-8 gap-y-3">
          <h1 className="font-display text-4xl font-light text-ink sm:text-5xl">
            {sketch.name}
          </h1>
          <p className="font-mono text-xs text-faint">{sketch.technique}</p>
        </header>

        <p className="mt-8 max-w-[58ch] leading-relaxed text-muted [text-wrap:pretty]">
          {sketch.detail}
        </p>

        <nav className="mt-24 flex items-baseline justify-between border-t border-line pt-8">
          <span className="font-mono text-xs tracking-[0.18em] text-faint uppercase">
            Next
          </span>
          <Link
            href={`/lab/${next.slug}`}
            className="font-display text-2xl text-ink underline decoration-line underline-offset-8 transition-colors duration-150 hover:decoration-ink"
          >
            {next.name}
          </Link>
        </nav>
      </div>
    </div>
  );
}
