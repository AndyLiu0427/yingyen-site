"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { Project } from "@/lib/site";

const PREVIEW_WIDTH = 320;
const CURSOR_OFFSET = 28;

const STATUS_COPY: Record<Project["status"], string> = {
  shipped: "shipped",
  building: "building",
};

function WorkRow({
  project,
  onEnter,
  onLeave,
}: {
  project: Project;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const Wrapper = project.href ? "a" : "div";
  return (
    <Wrapper
      {...(project.href
        ? { href: project.href, target: "_blank", rel: "noreferrer" }
        : {})}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      className="group -mx-4 block rounded-lg px-4 py-5 transition-[background-color,box-shadow] duration-200 hover:bg-white/70 hover:shadow-[0_1px_2px_rgb(32_36_46/0.04),0_10px_30px_rgb(32_36_46/0.07)]"
    >
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="font-display text-lg text-ink">
          {project.name}
          {project.href && (
            <span
              aria-hidden
              className="ml-1.5 inline-block text-faint transition-[translate,color] duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-accent"
            >
              &#8599;
            </span>
          )}
        </h3>
        <div className="flex shrink-0 items-center gap-3 font-mono text-xs text-faint">
          <span className="flex items-center gap-1.5">
            <span
              className={
                project.status === "building"
                  ? "size-1.5 rounded-full bg-accent animate-pulse"
                  : "size-1.5 rounded-full bg-accent/40"
              }
            />
            {STATUS_COPY[project.status]}
          </span>
          <span className="tabular-nums">{project.year}</span>
        </div>
      </div>
      <p className="mt-2 max-w-[52ch] text-sm leading-relaxed text-muted [text-wrap:pretty]">
        {project.description}
      </p>
      <p className="mt-3 font-mono text-xs text-faint">
        {project.stack.join(" · ")}
      </p>
    </Wrapper>
  );
}

/**
 * Work list with a cursor-following preview card. One shared floating
 * element trails the pointer with a lerp; the image swaps per hovered row.
 * Hover-only by design: touch devices never see it.
 */
export default function WorkList({ projects }: { projects: Project[] }) {
  const [active, setActive] = useState<Project | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const target = useRef({ x: 0, y: 0 });
  const pos = useRef({ x: 0, y: 0 });
  const activeRef = useRef(false);

  useEffect(() => {
    if (window.matchMedia("(hover: none)").matches) return;
    let raf: number;
    const tick = () => {
      const card = cardRef.current;
      if (card) {
        pos.current.x += (target.current.x - pos.current.x) * 0.14;
        pos.current.y += (target.current.y - pos.current.y) * 0.14;
        const previewHeight = card.offsetHeight || 200;
        const x = Math.min(
          pos.current.x + CURSOR_OFFSET,
          window.innerWidth - PREVIEW_WIDTH - 16,
        );
        const y = Math.min(
          Math.max(pos.current.y - previewHeight / 2, 16),
          window.innerHeight - previewHeight - 16,
        );
        card.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const handleMove = (e: React.MouseEvent) => {
    target.current = { x: e.clientX, y: e.clientY };
    // First hover of a session: start at the cursor instead of gliding
    // in from the viewport origin
    if (!activeRef.current) {
      pos.current = { x: e.clientX, y: e.clientY };
      activeRef.current = true;
    }
  };

  return (
    <div onMouseMove={handleMove}>
      <div className="divide-y divide-line">
        {projects.map((project) => (
          <WorkRow
            key={project.name}
            project={project}
            onEnter={() => setActive(project)}
            onLeave={() => setActive(null)}
          />
        ))}
      </div>

      <div
        ref={cardRef}
        aria-hidden
        className={`pointer-events-none fixed left-0 top-0 z-50 hidden [@media(hover:hover)]:block ${
          active
            ? "opacity-100 blur-0 [scale:1]"
            : "opacity-0 blur-[4px] [scale:0.96]"
        } transition-[opacity,scale,filter] duration-300 [transition-timing-function:cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none`}
        style={{ width: PREVIEW_WIDTH }}
      >
        {projects.map((project) => (
          <Image
            key={project.preview.src}
            src={project.preview.src}
            alt=""
            width={project.preview.width}
            height={project.preview.height}
            sizes={`${PREVIEW_WIDTH}px`}
            priority={false}
            className={`rounded-xl bg-paper outline outline-1 -outline-offset-1 outline-line shadow-[0_2px_8px_rgb(32_36_46/0.10),0_16px_40px_rgb(32_36_46/0.14)] ${
              active?.name === project.name ? "block" : "hidden"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
