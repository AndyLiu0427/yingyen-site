"use client";

import type { ReactNode } from "react";
import {
  useVgpuCanvas,
  type VgpuCanvasOptions,
  type VgpuSetup,
} from "./useVgpuCanvas";

type Props = VgpuCanvasOptions & {
  setup: VgpuSetup;
  /** Described to screen readers; these canvases are decorative imagery. */
  label: string;
  className?: string;
  /** Rendered instead of the canvas when the browser has no WebGPU. */
  fallback?: ReactNode;
};

export default function VgpuCanvas({
  setup,
  label,
  className,
  fallback,
  ...options
}: Props) {
  const { canvasRef, status } = useVgpuCanvas(setup, options);

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
