"use client";

import { useEffect, useRef, useState } from "react";
import { clock, frame, frameLoop, init, surface } from "vgpu";
import type { Frame, FrameLoopHandle, Gpu, Surface } from "vgpu";
import { whileVisible } from "./visibility";

export type VgpuStatus = "pending" | "ready" | "unsupported";

export type VgpuContext = {
  gpu: Gpu;
  surface: Surface;
  canvas: HTMLCanvasElement;
  reducedMotion: boolean;
  /** Register a listener teardown; runs before the gpu is disposed. */
  onCleanup: (fn: () => void) => void;
};

/** What a demo returns from its setup: one frame's worth of encoding. */
export type VgpuRender = (frame: Frame, time: number, delta: number) => void;

export type VgpuSetup = (ctx: VgpuContext) => VgpuRender;

export type VgpuCanvasOptions = {
  /** Cap the loop. Gallery cards run slower than a full-page demo. */
  fps?: number;
  /** Clear color of the surface, RGBA 0..1. Defaults to opaque black. */
  clearColor?: readonly [number, number, number, number];
  /**
   * Frames to render for the still image under `prefers-reduced-motion`.
   * A simulation that starts empty needs a few steps before it shows anything.
   */
  warmupFrames?: number;
};

/**
 * Owns one WebGPU device per canvas: init, surface, clock, and the frame loop.
 *
 * The loop is the hook's job rather than each demo's, so pausing offscreen and
 * honouring reduced motion is written once instead of four times. A demo just
 * returns the function that encodes a frame.
 */
export function useVgpuCanvas(
  setup: VgpuSetup,
  { fps, clearColor, warmupFrames = 1 }: VgpuCanvasOptions = {},
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<VgpuStatus>("pending");

  // The device is bound to the setup this canvas mounted with. Swapping the
  // setup afterwards would mean tearing the device down, so it is not supported;
  // the ref is here to keep `setup` out of the effect's dependencies.
  const setupRef = useRef(setup);

  const clearKey = clearColor ? clearColor.join(",") : "";

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (typeof navigator === "undefined" || !navigator.gpu) {
      // Deferred so the effect does not set state synchronously.
      const settle = setTimeout(() => setStatus("unsupported"), 0);
      return () => clearTimeout(settle);
    }

    let cancelled = false;
    let gpu: Gpu | null = null;
    let teardown: (() => void) | undefined;

    void (async () => {
      let created: Gpu;
      try {
        created = await init({ powerPreference: "high-performance" });
      } catch {
        if (!cancelled) setStatus("unsupported");
        return;
      }
      // The effect can be torn down while init() is still in flight.
      if (cancelled) {
        created.dispose();
        return;
      }
      gpu = created;

      const cleanups: (() => void)[] = [];
      const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;

      const view = surface(created, canvas, {
        dpr: [1, 2],
        clearColor: clearColor ? [...clearColor] : undefined,
      });
      const clk = clock(created);
      const render = setupRef.current({
        gpu: created,
        surface: view,
        canvas,
        reducedMotion,
        onCleanup: (fn) => cleanups.push(fn),
      });

      setStatus("ready");

      const tick = (f: Frame) => render(f, clk.time, clk.deltaTime);

      if (reducedMotion) {
        // The still image is the whole animation. Re-render on resize so it
        // stays sharp.
        const still = () => {
          for (let i = 0; i < warmupFrames; i++) frame(created, tick);
        };
        still();

        // onResize fires from inside a frame, and vgpu refuses to open a frame
        // within one, so the redraw waits for the next tick.
        let pending = 0;
        cleanups.push(
          view.onResize(() => {
            cancelAnimationFrame(pending);
            pending = requestAnimationFrame(() => {
              if (!created.disposed) still();
            });
          }),
        );
        cleanups.push(() => cancelAnimationFrame(pending));
        teardown = () => cleanups.forEach((fn) => fn());
        return;
      }

      let loop: FrameLoopHandle | null = null;

      cleanups.push(
        whileVisible(
          canvas,
          () => {
            if (loop || created.disposed) return;
            loop = frameLoop(created, tick, fps ? { fps } : undefined);
          },
          () => {
            loop?.stop();
            loop = null;
          },
        ),
      );

      teardown = () => cleanups.forEach((fn) => fn());
    })();

    return () => {
      cancelled = true;
      teardown?.();
      gpu?.dispose();
    };
    // clearColor is compared by value; the array literal identity is not stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fps, clearKey, warmupFrames]);

  return { canvasRef, status };
}
