"use client";

import Image from "next/image";
import type { ReactNode, RefObject } from "react";
import type { VgpuStatus } from "./useVgpuCanvas";

type Props = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  status: VgpuStatus;
  /** Described to screen readers; these canvases are decorative imagery. */
  label: string;
  className?: string;
  /** Replaces the frame entirely when the browser has no WebGPU. */
  fallback?: ReactNode;
  /** Still frame shown inside the frame when the browser has no WebGPU. */
  preview?: string;
};

/** Shared shell for every sketch, whichever backend drew it. */
export default function SketchFrame({
  canvasRef,
  status,
  label,
  className,
  fallback,
  preview,
}: Props) {
  if (status === "unsupported" && fallback !== undefined) return <>{fallback}</>;

  // An empty box and an apology is a worse answer than the picture itself.
  if (status === "unsupported" && preview) {
    return (
      <div className={className}>
        <Image
          src={preview}
          alt={label}
          fill
          unoptimized
          sizes="(max-width: 640px) 100vw, 960px"
          className="object-cover"
        />
        <p className="absolute inset-x-0 bottom-0 bg-black/45 px-4 py-2 text-center font-mono text-xs text-white/80">
          A still. The live version needs WebGPU: Chrome, Edge, or Safari 26.
        </p>
      </div>
    );
  }

  return (
    <div className={className}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={label}
        className="block h-full w-full"
      />
      {status === "unsupported" && (
        <p className="absolute inset-0 flex items-center justify-center px-6 text-center font-mono text-xs text-faint">
          Needs WebGPU. Try Chrome, Edge, or Safari 26.
        </p>
      )}
    </div>
  );
}
