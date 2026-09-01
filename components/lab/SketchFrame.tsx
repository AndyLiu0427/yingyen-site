"use client";

import type { ReactNode, RefObject } from "react";
import type { VgpuStatus } from "./useVgpuCanvas";

type Props = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  status: VgpuStatus;
  /** Described to screen readers; these canvases are decorative imagery. */
  label: string;
  className?: string;
  /** Rendered instead of the canvas when the browser has no WebGPU. */
  fallback?: ReactNode;
};

/** Shared shell for every sketch, whichever backend drew it. */
export default function SketchFrame({
  canvasRef,
  status,
  label,
  className,
  fallback,
}: Props) {
  if (status === "unsupported" && fallback !== undefined) return <>{fallback}</>;

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
