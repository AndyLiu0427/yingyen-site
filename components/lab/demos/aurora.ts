import { effect } from "vgpu";
import type { VgpuSetup } from "../useVgpuCanvas";

/**
 * Domain-warped fBm: noise sampled at coordinates that are themselves noise,
 * twice over. That is what turns plain clouds into something with currents in it.
 * The pointer bends the warp field rather than painting on top of it, so the
 * cursor pulls the whole image around instead of leaving a blob.
 */
const AURORA = /* wgsl */ `
struct Params {
  time: f32,
  aspect: f32,
  pointer: vec2f,
  reach: f32,
  ink: f32,
  veil: f32,
}
@group(0) @binding(0) var<uniform> params: Params;

fn hash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453123);
}

fn noise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash(i);
  let b = hash(i + vec2f(1.0, 0.0));
  let c = hash(i + vec2f(0.0, 1.0));
  let d = hash(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn fbm(p: vec2f) -> f32 {
  var value = 0.0;
  var amplitude = 0.5;
  var q = p;
  for (var i = 0; i < 5; i = i + 1) {
    value = value + amplitude * noise(q);
    q = q * 2.03 + vec2f(1.7, 9.2);
    amplitude = amplitude * 0.5;
  }
  return value;
}

@fragment fn main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let scale = vec2f(params.aspect, 1.0);
  let p = (uv - 0.5) * scale * 3.0;
  let t = params.time * 0.05;

  let toPointer = p - (params.pointer - 0.5) * scale * 3.0;
  let pull = params.reach / (1.0 + dot(toPointer, toPointer) * 2.5);
  let bend = normalize(toPointer + vec2f(1e-4, 1e-4)) * pull;

  let q = vec2f(fbm(p + vec2f(0.0, t)), fbm(p + vec2f(5.2, 1.3) - t));
  let r = vec2f(
    fbm(p + 2.4 * q + vec2f(1.7, 9.2) + t * 1.4),
    fbm(p + 2.4 * q + vec2f(8.3, 2.8) - t * 1.1),
  );
  let f = fbm(p + 2.8 * r + bend);

  let paper  = vec3f(0.965, 0.969, 0.976);
  let wash   = vec3f(0.875, 0.902, 1.000);
  let warm   = vec3f(1.000, 0.914, 0.863);
  let accent = vec3f(0.153, 0.259, 0.910);

  var color = mix(paper, wash, smoothstep(0.18, 0.86, f));
  color = mix(color, warm, smoothstep(0.42, 0.05, length(r - 0.5)) * 0.55);
  color = mix(color, accent, smoothstep(0.62, 1.02, f + pull * 0.4) * params.ink);

  // Fade to paper at the edges so the canvas reads as one surface with the page.
  color = mix(color, paper, smoothstep(0.52, 1.18, length(uv - 0.5) * 1.7));
  // Behind body copy the field is a backdrop, not the subject.
  color = mix(color, paper, params.veil);
  return vec4f(color, 1.0);
}
`;

type Options = {
  /** How much accent blue the brightest ridges take. */
  ink?: number;
  /** How far the pointer bends the field. 0 disables pointer tracking. */
  reach?: number;
  /** Pulls the whole field back toward paper. Raise it when text sits on top. */
  veil?: number;
};

export function aurora({
  ink = 0.55,
  reach = 0.55,
  veil = 0,
}: Options = {}): VgpuSetup {
  return ({ gpu, surface, canvas, onCleanup }) => {
    const pass = effect(gpu, AURORA, {
      label: "aurora",
      set: { ink, reach, veil },
    });

    // Chased rather than snapped, so a fast cursor drags the field behind it.
    const target = { x: 0.5, y: 0.5 };
    const pointer = { x: 0.5, y: 0.5 };

    if (reach > 0) {
      const move = (event: PointerEvent) => {
        const rect = canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        target.x = (event.clientX - rect.left) / rect.width;
        target.y = (event.clientY - rect.top) / rect.height;
      };
      // The hero canvas sits behind the page content, so the pointer is tracked
      // on the window rather than on the canvas itself.
      window.addEventListener("pointermove", move, { passive: true });
      onCleanup(() => window.removeEventListener("pointermove", move));
    }

    return (frame, time) => {
      pointer.x += (target.x - pointer.x) * 0.05;
      pointer.y += (target.y - pointer.y) * 0.05;

      const [width, height] = surface.size;
      pass.set({
        time,
        aspect: width / Math.max(height, 1),
        pointer: [pointer.x, pointer.y],
      });
      frame.pass(surface, pass);
    };
  };
}
