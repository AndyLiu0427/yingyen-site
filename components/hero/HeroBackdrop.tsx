"use client";

import BlobCanvas from "@/components/blob/BlobCanvas";
import VgpuCanvas from "@/components/lab/VgpuCanvas";
import { aurora } from "@/components/lab/demos/aurora";

// Calmer than the Lab version: this one sits under body copy all the way down
// the page, so it keeps its contrast well away from the text.
const heroAurora = aurora({ ink: 0.34, reach: 0.4, veil: 0.55 });

/**
 * The page background. WebGPU draws it; everywhere else falls back to the
 * WebGL blob, which is why the gradient wash lives in the fallback rather than
 * on the page wrapper.
 */
export default function HeroBackdrop() {
  return (
    <VgpuCanvas
      setup={heroAurora}
      label="A slowly drifting field of noise, rendered live"
      className="pointer-events-none fixed inset-0 -z-10"
      fallback={
        <>
          <div className="atelier-bg pointer-events-none fixed inset-0 -z-10" />
          <BlobCanvas />
        </>
      }
    />
  );
}
