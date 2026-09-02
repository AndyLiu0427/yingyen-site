"use client";

import type { ReactNode } from "react";
import SketchFrame from "./SketchFrame";
import {
  useVgpuCanvas,
  type VgpuCanvasOptions,
  type VgpuSetup,
} from "./useVgpuCanvas";

type Props = VgpuCanvasOptions & {
  setup: VgpuSetup;
  label: string;
  className?: string;
  fallback?: ReactNode;
  preview?: string;
};

export default function VgpuCanvas({
  setup,
  label,
  className,
  fallback,
  preview,
  ...options
}: Props) {
  const { canvasRef, status } = useVgpuCanvas(setup, options);
  return (
    <SketchFrame
      canvasRef={canvasRef}
      status={status}
      label={label}
      className={className}
      fallback={fallback}
      preview={preview}
    />
  );
}
