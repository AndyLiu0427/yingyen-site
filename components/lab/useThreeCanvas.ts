"use client";

import { useEffect, useRef, useState } from "react";
import {
  ACESFilmicToneMapping,
  Timer,
  PerspectiveCamera,
  Scene,
  WebGPURenderer,
} from "three/webgpu";
import type { VgpuStatus } from "./useVgpuCanvas";
import { whileVisible } from "./visibility";

export type ThreeContext = {
  renderer: WebGPURenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  canvas: HTMLCanvasElement;
  reducedMotion: boolean;
  /** Register a teardown; runs before the renderer is disposed. */
  onCleanup: (fn: () => void) => void;
};

/** Advances a sketch by one frame. The hook renders after it returns. */
export type ThreeRender = (time: number, delta: number) => void;

export type ThreeSetup = (ctx: ThreeContext) => ThreeRender;

export type ThreeCanvasOptions = {
  /** Vertical field of view in degrees. Defaults to 40. */
  fov?: number;
  /** Frames to render for the still under prefers-reduced-motion. */
  warmupFrames?: number;
};

/**
 * The three.js counterpart of useVgpuCanvas: same lifecycle, same offscreen
 * pausing, but three owns the device through its WebGPURenderer instead of
 * vgpu. A sketch builds its scene in setup and returns the per-frame update.
 */
export function useThreeCanvas(
  setup: ThreeSetup,
  { fov = 40, warmupFrames = 1 }: ThreeCanvasOptions = {},
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<VgpuStatus>("pending");

  // Bound at mount, like the vgpu hook: swapping the setup would mean tearing
  // the renderer down, so the ref exists to keep it out of the dependencies.
  const setupRef = useRef(setup);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (typeof navigator === "undefined" || !navigator.gpu) {
      const settle = setTimeout(() => setStatus("unsupported"), 0);
      return () => clearTimeout(settle);
    }

    let cancelled = false;
    let renderer: WebGPURenderer | null = null;
    let teardown: (() => void) | undefined;

    void (async () => {
      const created = new WebGPURenderer({ canvas, antialias: true });
      created.toneMapping = ACESFilmicToneMapping;
      created.setPixelRatio(Math.min(window.devicePixelRatio, 2));

      try {
        await created.init();
      } catch {
        if (!cancelled) setStatus("unsupported");
        return;
      }
      if (cancelled) {
        created.dispose();
        return;
      }
      renderer = created;

      const cleanups: (() => void)[] = [];
      let torn = false;
      const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;

      const scene = new Scene();
      const camera = new PerspectiveCamera(fov, 1, 0.1, 100);
      camera.position.set(0, 0, 8);

      const resize = () => {
        const width = canvas.clientWidth || 1;
        const height = canvas.clientHeight || 1;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        // updateStyle false: the canvas is sized by CSS, not by three.
        created.setSize(width, height, false);
      };
      resize();

      const render = setupRef.current({
        renderer: created,
        scene,
        camera,
        canvas,
        reducedMotion,
        onCleanup: (fn) => cleanups.push(fn),
      });

      setStatus("ready");

      const timer = new Timer();
      const frame = () => {
        timer.update();
        render(timer.getElapsed(), timer.getDelta());
        created.render(scene, camera);
      };

      const observer = new ResizeObserver(() => {
        resize();
        // A paused or still sketch would otherwise show a stretched last frame.
        if (!torn) frame();
      });
      observer.observe(canvas);
      cleanups.push(() => observer.disconnect());

      if (reducedMotion) {
        for (let i = 0; i < warmupFrames; i++) frame();
        teardown = () => {
          torn = true;
          cleanups.forEach((fn) => fn());
        };
        return;
      }

      cleanups.push(
        whileVisible(
          canvas,
          () => created.setAnimationLoop(frame),
          () => created.setAnimationLoop(null),
        ),
      );
      teardown = () => {
        torn = true;
        cleanups.forEach((fn) => fn());
      };
    })();

    return () => {
      cancelled = true;
      teardown?.();
      renderer?.setAnimationLoop(null);
      renderer?.dispose();
    };
  }, [fov, warmupFrames]);

  return { canvasRef, status };
}
