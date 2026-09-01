import { compute, draw, storage } from "vgpu";
import type { VgpuSetup } from "../useVgpuCanvas";

const COUNT = 163_840; // 2560 workgroups of 64
const WORKGROUP = 64;
const BOUND_Y = 1.15;

/**
 * Curl noise: the perpendicular of a noise gradient. Because a perpendicular
 * field has zero divergence, particles circulate forever instead of draining
 * into the sinks a plain noise field would create. Each particle is one vec4f,
 * xy position and zw velocity, and the whole 163k of them update in one dispatch.
 */
const SIM = /* wgsl */ `
@group(0) @binding(0) var<uniform> sim: Sim;
@group(0) @binding(1) var<storage, read_write> particles: array<vec4f>;

struct Sim {
  dt: f32,
  time: f32,
  aspect: f32,
  pointerActive: f32,
  pointer: vec2f,
}

fn hash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453123);
}

fn noise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2f(1.0, 0.0)), u.x),
    mix(hash(i + vec2f(0.0, 1.0)), hash(i + vec2f(1.0, 1.0)), u.x),
    u.y,
  );
}

fn field(p: vec2f) -> f32 {
  return noise(p) * 0.6 + noise(p * 2.1 + vec2f(4.7, 1.3)) * 0.3;
}

fn curl(p: vec2f) -> vec2f {
  let e = 0.06;
  let dx = field(p + vec2f(e, 0.0)) - field(p - vec2f(e, 0.0));
  let dy = field(p + vec2f(0.0, e)) - field(p - vec2f(0.0, e));
  return vec2f(dy, -dx) / (2.0 * e);
}

@compute @workgroup_size(${WORKGROUP})
fn main(@builtin(global_invocation_id) id: vec3u) {
  let index = id.x;
  if (index >= arrayLength(&particles)) { return; }

  let particle = particles[index];
  var position = particle.xy;
  var velocity = particle.zw;

  velocity = velocity + curl(position * 1.5 + vec2f(0.0, sim.time * 0.06)) * sim.dt * 0.7;

  if (sim.pointerActive > 0.5) {
    let toPointer = sim.pointer - position;
    let distanceSq = max(dot(toPointer, toPointer), 0.006);
    velocity = velocity + normalize(toPointer) * (sim.dt * 0.022 / distanceSq);
  }

  velocity = velocity * 0.965;
  position = position + velocity * sim.dt;

  // Wrapping keeps the field evenly populated with no respawn bookkeeping.
  let bound = vec2f(sim.aspect * ${BOUND_Y}, ${BOUND_Y});
  if (position.x >  bound.x) { position.x = -bound.x; }
  if (position.x < -bound.x) { position.x =  bound.x; }
  if (position.y >  bound.y) { position.y = -bound.y; }
  if (position.y < -bound.y) { position.y =  bound.y; }

  particles[index] = vec4f(position, velocity);
}
`;

/** Six vertices per instance: a screen-facing quad, shaded into a soft round dot. */
const RENDER = /* wgsl */ `
@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var<storage, read> particles: array<vec4f>;

struct View {
  aspect: f32,
  size: f32,
}

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) offset: vec2f,
  @location(1) speed: f32,
}

@vertex
fn vs(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> VertexOut {
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f( 1.0, -1.0), vec2f(-1.0,  1.0),
    vec2f(-1.0,  1.0), vec2f( 1.0, -1.0), vec2f( 1.0,  1.0),
  );
  let corner = corners[vertex];
  let particle = particles[instance];

  // Expand in clip space, divided by aspect on x, so the dot stays circular.
  let clip = particle.xy / vec2f(view.aspect, 1.0);
  var out: VertexOut;
  out.position = vec4f(clip + corner * vec2f(view.size / view.aspect, view.size), 0.0, 1.0);
  out.offset = corner;
  out.speed = length(particle.zw);
  return out;
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4f {
  let falloff = smoothstep(1.0, 0.0, length(in.offset));
  let heat = clamp(in.speed * 2.6, 0.0, 1.0);
  let cool = vec3f(0.278, 0.400, 1.000);
  let hot = vec3f(1.000, 0.639, 0.400);
  let color = mix(cool, hot, heat);
  let alpha = falloff * 0.30;
  return vec4f(color * alpha, alpha);
}
`;

export const particles: VgpuSetup = ({ gpu, surface, canvas, onCleanup }) => {
  const buffer = storage(gpu, COUNT * 16);

  const seed = new Float32Array(COUNT * 4);
  for (let i = 0; i < COUNT; i++) {
    seed[i * 4 + 0] = (Math.random() * 2 - 1) * BOUND_Y * 1.8;
    seed[i * 4 + 1] = (Math.random() * 2 - 1) * BOUND_Y;
    seed[i * 4 + 2] = (Math.random() * 2 - 1) * 0.05;
    seed[i * 4 + 3] = (Math.random() * 2 - 1) * 0.05;
  }
  buffer.write(seed);

  const step = compute(gpu, SIM, { label: "particles-step" });
  const points = draw(gpu, {
    shader: RENDER,
    label: "particles-draw",
    vertices: 6,
    instances: COUNT,
    blend: "additive",
  });

  const pointer = { x: 0, y: 0, active: 0 };

  const move = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const aspect = rect.width / rect.height;
    // Same space the simulation works in: y up, x scaled by aspect.
    pointer.x = ((event.clientX - rect.left) / rect.width - 0.5) * 2 * aspect;
    pointer.y = -((event.clientY - rect.top) / rect.height - 0.5) * 2;
    pointer.active = 1;
  };
  const leave = () => {
    pointer.active = 0;
  };
  canvas.addEventListener("pointermove", move, { passive: true });
  canvas.addEventListener("pointerleave", leave, { passive: true });
  onCleanup(() => {
    canvas.removeEventListener("pointermove", move);
    canvas.removeEventListener("pointerleave", leave);
  });

  return (frame, time, delta) => {
    const [width, height] = surface.size;
    const aspect = width / Math.max(height, 1);

    step.set({
      // A tab that was backgrounded returns with a huge delta; clamp it or every
      // particle teleports out of the field on the first frame back.
      dt: Math.min(delta, 1 / 30),
      time,
      aspect,
      pointerActive: pointer.active,
      pointer: [pointer.x, pointer.y],
      particles: buffer,
    });
    step.dispatch(COUNT / WORKGROUP);

    points.set({ aspect, size: 0.009, particles: buffer });
    frame.pass(surface, points);
  };
};
