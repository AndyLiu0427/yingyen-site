"use client";

import type { ReactNode } from "react";
import SketchFrame from "./SketchFrame";
import {
  useThreeCanvas,
  type ThreeCanvasOptions,
  type ThreeSetup,
} from "./useThreeCanvas";

type Props = ThreeCanvasOptions & {
  setup: ThreeSetup;
  label: string;
  className?: string;
  fallback?: ReactNode;
  preview?: string;
};

export default function ThreeCanvas({
  setup,
  label,
  className,
  fallback,
  preview,
  ...options
}: Props) {
  const { canvasRef, status } = useThreeCanvas(setup, options);
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
