"use client";

import ThreeCanvas from "./ThreeCanvas";
import VgpuCanvas from "./VgpuCanvas";
import { aurora } from "./demos/aurora";
import { elements } from "./demos/elements";
import { particles } from "./demos/particles";
import { ripple } from "./demos/ripple";
import type { ThreeCanvasOptions, ThreeSetup } from "./useThreeCanvas";
import type { VgpuCanvasOptions, VgpuSetup } from "./useVgpuCanvas";

/**
 * Two backends live in the lab: vgpu drives the raw WGSL sketches, three.js
 * drives the ones that need a scene, lights and a node material.
 */
type Entry =
  | { backend: "vgpu"; setup: VgpuSetup; options?: VgpuCanvasOptions }
  | { backend: "three"; setup: ThreeSetup; options?: ThreeCanvasOptions };

const SKETCHES: Record<string, Entry> = {
  aurora: { backend: "vgpu", setup: aurora() },
  // The wave steps once per frame, so the loop is pinned to keep its speed
  // the same on a 60Hz and a 120Hz display.
  ripple: {
    backend: "vgpu",
    setup: ripple,
    options: { fps: 60, warmupFrames: 150 },
  },
  particles: {
    backend: "vgpu",
    setup: particles,
    options: { clearColor: [0.043, 0.051, 0.071, 1] },
  },
  elements: { backend: "three", setup: elements },
};

type Props = {
  slug: string;
  label: string;
  className?: string;
  fps?: number;
};

export default function LabSketch({ slug, label, className, fps }: Props) {
  const sketch = SKETCHES[slug];
  if (!sketch) return null;

  if (sketch.backend === "three") {
    return (
      <ThreeCanvas
        {...sketch.options}
        setup={sketch.setup}
        label={label}
        className={className}
      />
    );
  }

  return (
    <VgpuCanvas
      {...sketch.options}
      setup={sketch.setup}
      label={label}
      className={className}
      fps={fps ?? sketch.options?.fps}
    />
  );
}
