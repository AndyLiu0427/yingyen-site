export const site = {
  name: "YingYen Liu",
  role: "Frontend Engineer",
  tagline:
    "I design interfaces, then build the tools that ship them. Lately, shaders: the field behind this page is running on your GPU, and there is an ocean in the Lab.",
  links: [
    { label: "github", href: "https://github.com/AndyLiu0427" },
    { label: "x", href: "https://x.com/yingyen_" },
    { label: "email", href: "mailto:ay0933@gmail.com" },
  ],
};

export type Project = {
  name: string;
  year: string;
  status: "shipped" | "building";
  description: string;
  stack: string[];
  href?: string;
  preview: { src: string; width: number; height: number };
};

export const projects: Project[] = [
  {
    name: "MsgLens",
    year: "2026",
    status: "shipped",
    description:
      "A browser-based viewer for Outlook .msg and .eml files. There is no backend, which makes “your file is never uploaded” a structural fact rather than a promise. Bodies are recovered through compressed-RTF de-encapsulation, which 17 of 20 real business messages turn out to need.",
    stack: ["Next.js", "React 19", "Tailwind", "Cloudflare Pages"],
    href: "https://msglens.app",
    preview: { src: "/previews/msglens.png", width: 1440, height: 749 },
  },
  {
    name: "Payroll Icon System",
    year: "2026",
    status: "shipped",
    description:
      "54 payroll, time and billing icons generated from a base × modifier system, so a new state composes across every base instead of being redrawn. Published to npm, with a script that rasterises all 1,326 pairs at 16px and scores them on shared ink.",
    stack: ["SVG", "TypeScript", "React", "npm"],
    href: "https://andyliu0427.github.io/payroll-icons/",
    preview: { src: "/previews/payroll-icons.png", width: 2880, height: 1498 },
  },
  {
    name: "UIPrompt",
    year: "2026",
    status: "shipped",
    description:
      "A visual component editor that turns designs into spec-grade prompts for Claude Code, Cursor, and v0. Tune radius, colors, states, and motion; the prompt updates live.",
    stack: ["Next.js", "React 19", "Zustand", "Supabase", "Paddle"],
    preview: { src: "/previews/uiprompt.webp", width: 2880, height: 1498 },
  },
  {
    name: "AgentPulse",
    year: "2026",
    status: "shipped",
    description:
      "A macOS menu bar app that watches Claude Code sessions in real time, parsing the session stream to surface what your agents are doing.",
    stack: ["Swift", "SwiftUI", "macOS"],
    preview: { src: "/previews/agentpulse.png", width: 700, height: 437 },
  },
  {
    name: "Mech Keyboard",
    year: "2026",
    status: "shipped",
    description:
      "An interactive 3D mechanical keyboard you can type on in the browser, with per-key sound and choreographed scroll animation.",
    stack: ["React Three Fiber", "GSAP", "Howler"],
    preview: { src: "/previews/mech-keyboard.webp", width: 2880, height: 1498 },
  },
  {
    name: "Practical AI Stack",
    year: "2026",
    status: "shipped",
    description:
      "A blog of 30 hands-on guides to the AI tool stack, written for people who ship with these tools every day.",
    stack: ["Writing", "SEO"],
    preview: { src: "/previews/ai-stack.webp", width: 2880, height: 1498 },
  },
];
