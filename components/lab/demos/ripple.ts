import { effect, pingPong } from "vgpu";
import type { Target } from "vgpu";
import type { VgpuSetup } from "../useVgpuCanvas";

/**
 * One step of the discrete wave equation, held in a ping-pong pair.
 *
 * next = 2*here - before + c^2 * laplacian(here), and with c^2 = 0.5 the `here`
 * terms cancel down to `sum*0.5 - before`. Red channel is the surface now,
 * green is where it was last frame; that second channel is the whole reason a
 * wave carries on travelling instead of snapping flat.
 */
const STEP = /* wgsl */ `
@group(0) @binding(0) var state: texture_2d<f32>;
@group(0) @binding(1) var<uniform> sim: Sim;

struct Sim {
  size: vec2f,
  pointer: vec2f,
  impulse: f32,
  damping: f32,
}

fn heightAt(coord: vec2i, bound: vec2i) -> vec2f {
  // Clamped edges reflect the wave back instead of letting it fall off.
  return textureLoad(state, vec2u(clamp(coord, vec2i(0), bound)), 0).rg;
}

@fragment fn main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let bound = vec2i(sim.size) - vec2i(1);
  let coord = vec2i(uv * sim.size);
  let here = heightAt(coord, bound);

  let sum =
      heightAt(coord + vec2i( 1,  0), bound).r
    + heightAt(coord + vec2i(-1,  0), bound).r
    + heightAt(coord + vec2i( 0,  1), bound).r
    + heightAt(coord + vec2i( 0, -1), bound).r;

  var next = (sum * 0.5 - here.g) * sim.damping;

  let d = distance(uv * sim.size, sim.pointer * sim.size);
  next = next + sim.impulse * exp(-d * d / 26.0);

  return vec4f(clamp(next, -1.5, 1.5), here.r, 0.0, 1.0);
}
`;

/** Shades the height field: slope becomes a normal, the normal becomes light. */
const SHADE = /* wgsl */ `
@group(0) @binding(0) var state: texture_2d<f32>;
@group(0) @binding(1) var<uniform> view: View;

struct View {
  size: vec2f,
}

fn heightAt(coord: vec2i, bound: vec2i) -> f32 {
  return textureLoad(state, vec2u(clamp(coord, vec2i(0), bound)), 0).r;
}

@fragment fn main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let bound = vec2i(view.size) - vec2i(1);
  let coord = vec2i(uv * view.size);

  let left  = heightAt(coord + vec2i(-1, 0), bound);
  let right = heightAt(coord + vec2i( 1, 0), bound);
  let up    = heightAt(coord + vec2i(0, -1), bound);
  let down  = heightAt(coord + vec2i(0,  1), bound);
  let here  = heightAt(coord, bound);

  let slope = vec2f(right - left, down - up) * 4.0;
  let normal = normalize(vec3f(-slope, 1.0));
  let light = normalize(vec3f(0.42, -0.58, 0.70));
  let diffuse = clamp(dot(normal, light), 0.0, 1.0);
  let specular = pow(clamp(dot(reflect(-light, normal), vec3f(0.0, 0.0, 1.0)), 0.0, 1.0), 42.0);

  let paper  = vec3f(0.965, 0.969, 0.976);
  let wash   = vec3f(0.855, 0.886, 1.000);
  let accent = vec3f(0.153, 0.259, 0.910);

  var color = mix(paper, wash, clamp(here * 1.6 + 0.5, 0.0, 1.0));
  color = mix(color, accent, clamp(length(slope) * 0.42, 0.0, 0.46));
  color = color * (0.82 + 0.30 * diffuse) + vec3f(specular * 0.70);
  return vec4f(color, 1.0);
}
`;

/** Half resolution, capped on the long edge: it is water, it does not need 4K. */
function simSize(width: number, height: number): [number, number] {
  const scale = Math.min(0.5, 640 / Math.max(width, height, 1));
  return [
    Math.max(64, Math.round(width * scale)),
    Math.max(64, Math.round(height * scale)),
  ];
}

// PingPongTargets exposes its halves as Target, which hides the resize that
// OffscreenTarget actually implements.
type Resizable = Target & { resize(size: readonly [number, number]): void };

export const ripple: VgpuSetup = ({ gpu, surface, canvas, onCleanup }) => {
  let [width, height] = simSize(...(surface.size as [number, number]));
  const field = pingPong(gpu, width, height, { format: "rgba16float" });

  const step = effect(gpu, STEP, { label: "ripple-step" });
  const shade = effect(gpu, SHADE, { label: "ripple-shade" });

  onCleanup(
    surface.onResize((event) => {
      [width, height] = simSize(event.width, event.height);
      (field.read as Resizable).resize([width, height]);
      (field.write as Resizable).resize([width, height]);
    }),
  );

  const pointer = { x: 0.5, y: 0.5, impulse: 0 };
  // -Infinity, not 0: performance.now() is small on a fast load, and a zero
  // here would hold the first drop back until the page had been open 2s.
  let lastTouched = Number.NEGATIVE_INFINITY;

  const move = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    pointer.x = (event.clientX - rect.left) / rect.width;
    pointer.y = (event.clientY - rect.top) / rect.height;
    pointer.impulse = 0.26;
    lastTouched = performance.now();
  };
  canvas.addEventListener("pointermove", move, { passive: true });
  canvas.addEventListener("pointerdown", move, { passive: true });
  onCleanup(() => {
    canvas.removeEventListener("pointermove", move);
    canvas.removeEventListener("pointerdown", move);
  });

  let nextDrop = -1;

  return (frame, time) => {
    // Untouched, the pool rains on itself so a card in a gallery still moves.
    if (time > nextDrop && performance.now() - lastTouched > 2000) {
      pointer.x = 0.18 + Math.random() * 0.64;
      pointer.y = 0.18 + Math.random() * 0.64;
      pointer.impulse = 0.85;
      nextDrop = time + 1.6 + Math.random() * 1.4;
    }

    step.set({
      state: field.read,
      size: [width, height],
      pointer: [pointer.x, pointer.y],
      impulse: pointer.impulse,
      damping: 0.994,
    });
    frame.pass(field.write, step);
    field.swap();

    shade.set({ state: field.read, size: [width, height] });
    frame.pass(surface, shade);

    // Each drop is a single frame of energy. Holding it across frames welds
    // successive ripples into one blob instead of leaving clean rings.
    pointer.impulse = 0;
  };
};
