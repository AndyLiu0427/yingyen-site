import Link from "next/link";
import HeroBackdrop from "@/components/hero/HeroBackdrop";
import Hero from "@/components/hero/Hero";
import WorkList from "@/components/WorkList";
import { labSketches } from "@/lib/lab";
import { projects, site } from "@/lib/site";

const CRAFT = [
  {
    title: "Interface engineering",
    body: "Design-system-grade React and TypeScript. Components with real states, real edge cases, and APIs the next engineer will thank you for.",
  },
  {
    title: "Motion and 3D",
    body: "GSAP, React Three Fiber, and WGSL compute shaders straight on the GPU. Motion that explains what just happened instead of decorating it.",
  },
  {
    title: "Tools for builders",
    body: "Editors, prompt generators, agent monitors. I like building the thing that makes the next thing faster to build.",
  },
];

export default function Home() {
  return (
    <div className="flex-1">
      <HeroBackdrop />

      <Hero />

      <main className="relative z-20 mx-auto w-full max-w-3xl px-6">
        <section aria-labelledby="about" className="py-28 sm:py-40">
          <h2
            id="about"
            className="font-mono text-xs uppercase tracking-[0.2em] text-faint"
          >
            About
          </h2>
          <p className="mt-8 max-w-[24ch] font-display text-2xl font-light leading-snug text-ink sm:text-[2rem] [text-wrap:pretty]">
            I care about the last five percent of an interface.
          </p>
          <p className="mt-6 max-w-[44ch] leading-relaxed text-muted [text-wrap:pretty]">
            The easing curve, the empty state, the weight of a shadow, the
            feel of a click. That last stretch is where an interface stops
            being screens and starts being a product.
          </p>
        </section>

        <section aria-labelledby="craft" className="py-28 sm:py-40">
          <div className="sm:ml-auto sm:max-w-xl">
            <h2
              id="craft"
              className="font-mono text-xs uppercase tracking-[0.2em] text-faint"
            >
              Craft
            </h2>
            <ul className="mt-8 space-y-12">
              {CRAFT.map((item) => (
                <li key={item.title}>
                  <h3 className="font-display text-xl text-ink sm:text-2xl">
                    {item.title}
                  </h3>
                  <p className="mt-3 max-w-[52ch] leading-relaxed text-muted [text-wrap:pretty]">
                    {item.body}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="lab" className="py-28 sm:py-40">
          <h2
            id="lab"
            className="font-mono text-xs uppercase tracking-[0.2em] text-faint"
          >
            Lab
          </h2>
          <p className="mt-8 max-w-[44ch] leading-relaxed text-muted [text-wrap:pretty]">
            Four WebGPU sketches, written in WGSL and TSL. The one behind this
            page is the last of them.
          </p>
          <ul className="mt-8 border-t border-line">
            {labSketches.map((sketch) => (
              <li key={sketch.slug}>
                <Link
                  href={`/lab/${sketch.slug}`}
                  className="group flex flex-wrap items-baseline justify-between gap-x-8 gap-y-1 border-b border-line py-5 transition-colors duration-150 hover:bg-wash/40"
                >
                  <span className="font-display text-xl text-ink sm:text-2xl">
                    {sketch.name}
                  </span>
                  <span className="font-mono text-xs text-faint transition-colors duration-150 group-hover:text-muted">
                    {sketch.technique}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <Link
            href="/lab"
            className="mt-8 -m-2 inline-block p-2 font-mono text-xs uppercase tracking-[0.18em] text-muted underline decoration-line underline-offset-8 transition-colors duration-150 hover:text-ink"
          >
            Open the lab &rarr;
          </Link>
        </section>

        <section aria-labelledby="work" className="py-28 sm:py-40">
          <h2
            id="work"
            className="font-mono text-xs uppercase tracking-[0.2em] text-faint"
          >
            Work
          </h2>
          <div className="mt-8">
            <WorkList projects={projects} />
          </div>
        </section>

        <section aria-labelledby="now" className="py-28 sm:py-40">
          <h2
            id="now"
            className="font-mono text-xs uppercase tracking-[0.2em] text-faint"
          >
            Now
          </h2>
          <p className="mt-8 max-w-[26ch] font-display text-2xl font-light leading-snug text-ink sm:text-[2rem] [text-wrap:pretty]">
            Shipping small, sharp tools.
          </p>
          <p className="mt-6 max-w-[44ch] leading-relaxed text-muted [text-wrap:pretty]">
            MsgLens is the most recent one, a viewer that parses Outlook mail
            entirely inside the browser. Alongside it, the Lab: four sketches
            that run straight on the GPU, most recently an ocean built the way
            film ocean is, by inverse transforming a wave spectrum. And I write
            Practical AI Stack, hands-on guides to shipping with AI tools.
          </p>
        </section>

        <section
          aria-labelledby="contact"
          className="flex min-h-[80svh] flex-col items-center justify-center py-28 text-center"
        >
          <h2
            id="contact"
            className="font-mono text-xs uppercase tracking-[0.2em] text-faint"
          >
            Contact
          </h2>
          <p className="mt-6 font-display text-5xl font-light text-ink sm:text-7xl">
            Say <span className="italic text-accent">hi</span>.
          </p>
          <a
            href={site.links.find((l) => l.label === "email")?.href}
            className="mt-8 text-lg text-muted underline decoration-line underline-offset-8 transition-colors duration-150 hover:text-ink"
          >
            ay0933@gmail.com
          </a>
        </section>

        <footer className="flex flex-wrap items-baseline justify-between gap-4 border-t border-line py-10">
          <p className="font-mono text-xs text-faint">
            YingYen Liu, {new Date().getFullYear()}
          </p>
          <p className="font-mono text-xs text-faint">
            background rendered live on the GPU. WGSL, via vgpu
          </p>
        </footer>
      </main>
    </div>
  );
}
