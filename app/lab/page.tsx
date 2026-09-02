import Link from "next/link";
import type { Metadata } from "next";
import LabSketch from "@/components/lab/LabSketch";
import { labSketches } from "@/lib/lab";

export const metadata: Metadata = {
  title: "Lab · YingYen Liu",
  description:
    "WebGPU sketches: an FFT ocean, a ray traced drop of water, a Rasengan, compute-shader particles, a ping-pong wave solver, and domain-warped noise.",
};

export default function LabPage() {
  return (
    <div className="atelier-bg flex-1">
      <main className="relative mx-auto w-full max-w-5xl px-6 pb-32 pt-10 sm:px-10">
        <Link
          href="/"
          className="-m-2 inline-block p-2 font-mono text-xs tracking-[0.18em] text-muted uppercase transition-colors duration-150 hover:text-ink"
        >
          &larr; YingYen Liu
        </Link>

        <header className="max-w-2xl py-24 sm:py-32">
          <h1 className="animate-rise font-display text-[clamp(3rem,10vw,6.5rem)] font-light leading-[0.95] tracking-tight text-ink">
            Lab
          </h1>
          <p className="mt-8 max-w-[46ch] animate-rise leading-relaxed text-muted [animation-delay:150ms] [text-wrap:pretty]">
            Six sketches that run on the GPU directly. Five are raw WGSL
            against{" "}
            <a
              href="https://github.com/vercel-labs/vgpu"
              className="text-ink underline decoration-line underline-offset-4 transition-colors duration-150 hover:decoration-ink"
            >
              vgpu
            </a>
            , with no renderer underneath. The sixth is three.js driving
            WebGPU through TSL node materials. They need a browser with WebGPU:
            Chrome, Edge, or Safari 26.
          </p>
        </header>

        <ul className="space-y-24 sm:space-y-32">
          {labSketches.map((sketch, index) => (
            <li key={sketch.slug}>
              <Link
                href={`/lab/${sketch.slug}`}
                className="group block focus:outline-none"
              >
                <div
                  className={`relative aspect-[16/10] overflow-hidden rounded-lg border transition-[border-color,transform] duration-300 ease-out group-hover:-translate-y-1 group-focus-visible:ring-2 group-focus-visible:ring-accent group-focus-visible:ring-offset-4 group-focus-visible:ring-offset-paper ${
                    sketch.dark
                      ? "border-ink/15 bg-[#0b0d12] group-hover:border-ink/35"
                      : "border-line bg-paper group-hover:border-ink/25"
                  }`}
                >
                  <LabSketch
                    slug={sketch.slug}
                    label={`${sketch.name}: ${sketch.blurb}`}
                    className="absolute inset-0"
                    fps={30}
                    preview={sketch.preview}
                  />
                </div>

                <div className="mt-6 flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2">
                  <h2 className="font-display text-2xl text-ink sm:text-3xl">
                    <span className="font-mono text-xs text-faint align-super mr-3">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    {sketch.name}
                  </h2>
                  <p className="font-mono text-xs text-faint">
                    {sketch.technique}
                  </p>
                </div>
                <p className="mt-2 max-w-[52ch] leading-relaxed text-muted [text-wrap:pretty]">
                  {sketch.blurb}
                </p>
              </Link>
            </li>
          ))}
        </ul>

        <footer className="mt-32 border-t border-line py-10">
          <p className="font-mono text-xs text-faint">
            WGSL and TSL, straight onto WebGPU.
          </p>
        </footer>
      </main>
    </div>
  );
}
