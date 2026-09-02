import { effect, sampler, target } from "vgpu";
import type { Frame, Gpu, Surface, Target } from "vgpu";

/**
 * The camera after the scene: a sketch draws linear HDR radiance into
 * `scene`, and `finish` adds a bloom and puts it through the tone curve onto
 * the surface. Because that is what glass in front of a sensor does.
 */

/**
 * Long edge of the HDR frame, in pixels. Ray tracing three refraction paths
 * per pixel is a lot of work for a retina display to do twice over; the
 * composite pass scales it up. Raise it if edges look soft on a big screen.
 */
const MAX_RENDER_EDGE = 1600;

/** Bloom: where the glow starts, in linear radiance, and how much is added. */
const BLOOM_THRESHOLD = 1.5;
const BLOOM_STRENGTH = 0.18;
const BLUR_SIGMA = 3;
const BLUR_TAPS = 7;
const BLUR_WEIGHTS = (() => {
  const raw = Array.from({ length: BLUR_TAPS }, (_, i) =>
    Math.exp(-(i * i) / (2 * BLUR_SIGMA * BLUR_SIGMA)),
  );
  const total = raw[0] + 2 * raw.slice(1).reduce((a, b) => a + b, 0);
  return raw.map((w) => w / total);
})();

/** What is bright enough to bleed. */
const BRIGHT = /* wgsl */ `
@group(0) @binding(0) var scene: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@fragment fn main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let c = textureSampleLevel(scene, samp, uv, 0.0).rgb;
  let peak = max(max(c.r, c.g), c.b);
  let keep = max(peak - ${BLOOM_THRESHOLD}, 0.0) / max(peak, 1e-4);
  return vec4f(c * keep, 1.0);
}
`;

/** Separable Gaussian, run once across and once down at quarter resolution. */
const BLUR = /* wgsl */ `
struct Params { step: vec2f }
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> p: Params;
const W = array<f32, ${BLUR_TAPS}>(${BLUR_WEIGHTS.map((w) => w.toFixed(6)).join(", ")});
@fragment fn main(@location(0) uv: vec2f) -> @location(0) vec4f {
  var c = textureSampleLevel(src, samp, uv, 0.0).rgb * W[0];
  for (var i = 1; i < ${BLUR_TAPS}; i++) {
    let o = p.step * f32(i);
    c += (textureSampleLevel(src, samp, uv + o, 0.0).rgb + textureSampleLevel(src, samp, uv - o, 0.0).rgb) * W[i];
  }
  return vec4f(c, 1.0);
}
`;

/** Glow added back, then the tone curve and gamma. */
const COMPOSITE = /* wgsl */ `
@group(0) @binding(0) var scene: texture_2d<f32>;
@group(0) @binding(1) var glow: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

fn aces(x: vec3f) -> vec3f {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
}

@fragment fn main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let hdr = textureSampleLevel(scene, samp, uv, 0.0).rgb;
  let bloom = textureSampleLevel(glow, samp, uv, 0.0).rgb * ${BLOOM_STRENGTH};
  return vec4f(pow(aces(hdr + bloom), vec3f(1.0 / 2.2)), 1.0);
}
`;

export type Lens = {
  /** Draw the scene here, in linear radiance. */
  readonly scene: Target;
  /** Pixel size of `scene`. */
  readonly size: readonly [number, number];
  /** Bloom, tone curve, and out to the surface. */
  finish(frame: Frame): void;
};

export function lens(
  gpu: Gpu,
  surface: Surface,
  onCleanup: (fn: () => void) => void,
): Lens {
  const renderSize = ([w, h]: readonly [number, number]) => {
    const scale = Math.min(1, MAX_RENDER_EDGE / Math.max(w, h, 1));
    return [Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale))] as [number, number];
  };
  const quarter = ([w, h]: readonly [number, number]) =>
    [Math.max(1, Math.ceil(w / 4)), Math.max(1, Math.ceil(h / 4))] as [number, number];

  let size = renderSize(surface.size);
  const scene = target(gpu, { size, format: "rgba16float" });
  const glowA = target(gpu, { size: quarter(size), format: "rgba16float" });
  const glowB = target(gpu, { size: quarter(size), format: "rgba16float" });
  onCleanup(
    surface.onResize((event) => {
      size = renderSize([event.width, event.height]);
      scene.resize(size);
      glowA.resize(quarter(size));
      glowB.resize(quarter(size));
    }),
  );

  const samp = sampler(gpu, { magFilter: "linear", minFilter: "linear" });
  const bright = effect(gpu, BRIGHT, { label: "lens-bright", set: { samp, scene } });
  const blur = effect(gpu, BLUR, { label: "lens-blur", set: { samp } });
  const composite = effect(gpu, COMPOSITE, { label: "lens-composite", set: { samp, scene, glow: glowA } });

  return {
    scene,
    get size() {
      return size;
    },
    finish(frame) {
      const [gw, gh] = glowA.size;
      frame.pass(glowA, bright);
      blur.set({ src: glowA, step: [1.5 / gw, 0] });
      frame.pass(glowB, blur);
      blur.set({ src: glowB, step: [0, 1.5 / gh] });
      frame.pass(glowA, blur);
      frame.pass(surface, composite);
    },
  };
}
