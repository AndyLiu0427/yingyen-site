"use client";

import VgpuCanvas from "./VgpuCanvas";
import { aurora } from "./demos/aurora";
import { particles } from "./demos/particles";
import { ripple } from "./demos/ripple";
import type { VgpuCanvasOptions, VgpuSetup } from "./useVgpuCanvas";

const SKETCHES: Record<
  string,
  { setup: VgpuSetup; options?: VgpuCanvasOptions }
> = {
  aurora: { setup: aurora() },
  // The wave steps once per frame, so the loop is pinned to keep its speed
  // the same on a 60Hz and a 120Hz display.
  ripple: { setup: ripple, options: { fps: 60, warmupFrames: 150 } },
  particles: {
    setup: particles,
    options: { clearColor: [0.043, 0.051, 0.071, 1] },
  },
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
