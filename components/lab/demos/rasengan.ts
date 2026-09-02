import { effect } from "vgpu";
import type { VgpuSetup } from "../useVgpuCanvas";
import { lens } from "./lens";
import { PHOTO_WGSL, photoScenes } from "./photo-scenes";
import type { Scene } from "./photo-scenes";

/**
 * Naruto's Rasengan, the way the films draw it rather than the television
 * series: not a few clean arcs but a ball of glowing thread. Hundreds of
 * thin, wavy, tangled filaments of white and cyan wound around each other,
 * inside a soft luminous volume that has no hard edge and throws its light
 * onto everything nearby.
 *
 * What reads as spinning, in the films, is a handful of bright arcs orbiting
 * the ball on tilted circles, fast, each with a tail, dimmed where they pass
 * behind the glow. They are drawn as ray-plane intersections with each orbit's
 * plane: cheap, exact, and no noise involved.
 *
 * The threads are what the film draws: a cage of light. In the Parent and
 * Child Rasengan at the end of Boruto: Naruto the Movie the ball is wound
 * with hundreds of thin, smooth, bright lines at every angle, crossing into a
 * net that thickens toward the rim, around a core too bright to see into.
 * Each line is a circle on the sphere, the set of directions n with
 * dot(n, a) = h for some axis a and offset h: one dot product per line, no
 * noise, so every thread is clean. A hundred and forty-four of them in four groups, each
 * group turning about its own axis at its own speed, one against the others,
 * so the net shears the way chakra spun several ways at once would. Four
 * shells of it, front and back faces each, give the cage depth. Each thread
 * also breathes in brightness on its own clock, which is the flicker.
 *
 * The air around it is drawn in: the world just outside the shell shimmers and
 * is pulled into a spiral, and chakra peels off the shell in soft tongues, so
 * the ball reads as something that is doing work on the room, not a sticker
 * on it.
 */

const RADIUS = 0.06;
const FOV = 46;
/** Background blur, as a fraction of the frame width. A fight scene stays legible. */
const DOF_BLUR = 0.0015;
/**
 * Places a ninja would fight in. Poly Haven HDRIs (CC0): a field under the
 * moon, a pine forest, a meadow at dusk, a rocky valley at dawn.
 */
const SCENES: Scene[] = [
  { url: "/env/moon.webp", yaw: 0.05 }, // moonlit_golf, moon overhead
  { url: "/env/forest.webp", yaw: -0.12 }, // je_gray_02, trees, sun off to the side
  { url: "/env/dusk.webp", yaw: 0.32 }, // lilienstein, the rock on the right
  { url: "/env/dawn.webp", yaw: 0 }, // kiara_1_dawn
];

/** Holding the pointer on the ball charges it; letting go lets it settle. */
const CHARGE_SECONDS = 1.6;
const SETTLE_SECONDS = 1.0;
/** Fully charged, the ball is this many times its resting size and speed. */
const CHARGE_MAX = 1.6;

/**
 * Orbits: the axis each ring turns about, its radius as a fraction of the
 * ball, turns per second (sign is direction), and how many arcs ride it.
 */
const ORBITS = [
  { axis: [0.2, 1.0, 0.1], radius: 1.04, speed: 0.9, arcs: 2 },
  { axis: [1.0, 0.35, 0.2], radius: 1.08, speed: -0.7, arcs: 2 },
  { axis: [0.3, 0.5, 1.0], radius: 1.0, speed: 1.2, arcs: 1 },
  { axis: [-0.6, 0.8, 0.3], radius: 1.12, speed: -1.0, arcs: 2 },
  { axis: [0.5, 0.2, -0.8], radius: 1.06, speed: 0.75, arcs: 1 },
  { axis: [-0.3, 0.9, -0.6], radius: 0.98, speed: -1.3, arcs: 2 },
].map((o) => {
  const n = Math.hypot(...o.axis);
  return { ...o, axis: o.axis.map((v) => v / n) };
});

/** Circles per group, and groups. 144 lines: as dense as the film's net. */
const CIRCLES_PER_GROUP = 36;

/**
 * Three groups of circles on the sphere. Each group rides its own axis at its
 * own speed (turns per second, sign is direction). Axes and offsets within a
 * group are pseudo-random but fixed, from a tiny seeded generator, so the net
 * is the same net every load.
 */
const GROUPS = [
  { axis: [0.2, 1.0, 0.15], speed: 0.45 },
  { axis: [1.0, 0.25, -0.3], speed: -0.32 },
  { axis: [-0.4, 0.6, 1.0], speed: 0.6 },
  { axis: [0.7, -0.5, 0.5], speed: -0.5 },
].map((g) => {
  const n = Math.hypot(...g.axis);
  return { ...g, axis: g.axis.map((v) => v / n) };
});

/** mulberry32: a seeded random so the cage is deterministic. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** xyz: unit axis of the circle; w: offset from a great circle, -0.55..0.55. */
const CIRCLES = (() => {
  const rnd = seeded(20260902);
  const out: number[][] = [];
  for (let i = 0; i < GROUPS.length * CIRCLES_PER_GROUP; i++) {
    // Uniform on the sphere: z uniform, angle uniform.
    const z = rnd() * 2 - 1;
    const t = rnd() * Math.PI * 2;
    const rr = Math.sqrt(1 - z * z);
    out.push([rr * Math.cos(t), rr * Math.sin(t), z, (rnd() * 2 - 1) * 0.55]);
  }
  return out;
})();

/** Radius, as a fraction of the ball, out to which chakra is still found. */
const REACH = 1.2;

const SCENE = /* wgsl */ `
struct Params {
  size: vec2f,
  tanHalf: f32,
  time: f32,
  spin: f32,
  dofLod: f32,
  charge: f32,
  camPos: vec3f,
  camRight: vec3f,
  camUp: vec3f,
  camFwd: vec3f,
}
@group(0) @binding(0) var<uniform> p: Params;
${PHOTO_WGSL}

const R = ${RADIUS};
const CORE = vec3f(0.85, 0.97, 1.0);
const CYAN = vec3f(0.45, 0.85, 1.0);
const CHAKRA = vec3f(0.22, 0.52, 1.0);

fn hash3(q: vec3f) -> f32 {
  return fract(sin(dot(q, vec3f(127.1, 311.7, 74.7))) * 43758.5453);
}

fn noise3(q: vec3f) -> f32 {
  let i = floor(q);
  let f = fract(q);
  // Quintic fade: no kinks in the second derivative, so nothing drawn from
  // this field shows the cell grid up close.
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(
    mix(mix(hash3(i), hash3(i + vec3f(1, 0, 0)), u.x),
        mix(hash3(i + vec3f(0, 1, 0)), hash3(i + vec3f(1, 1, 0)), u.x), u.y),
    mix(mix(hash3(i + vec3f(0, 0, 1)), hash3(i + vec3f(1, 0, 1)), u.x),
        mix(hash3(i + vec3f(0, 1, 1)), hash3(i + vec3f(1, 1, 1)), u.x), u.y),
    u.z);
}

/** Rodrigues: v turned about unit axis k by angle a. */
fn turn(v: vec3f, k: vec3f, a: f32) -> vec3f {
  let c = cos(a);
  return v * c + cross(k, v) * sin(a) + k * dot(k, v) * (1.0 - c);
}

const CIRCLES = array<vec4f, ${CIRCLES.length}>(
${CIRCLES.map((c) => `  vec4f(${c.map((v) => v.toFixed(4)).join(", ")})`).join(",\n")}
);

/**
 * The cage on one shell at unit direction n: every circle is a thin line
 * where dot(n, axis) is near its offset. Each group is first turned about its
 * own axis, so the three nets slide over each other, and each line breathes
 * on its own clock so the whole thing flickers rather than glows evenly.
 */
fn cage(n: vec3f, spin: f32) -> f32 {
  var s = 0.0;
${GROUPS.map((g, gi) => `  {
    let q = turn(n, vec3f(${g.axis.map((v) => v.toFixed(4)).join(", ")}), spin * ${(g.speed * 6.2831853).toFixed(3)});
    for (var i = ${gi * CIRCLES_PER_GROUP}; i < ${(gi + 1) * CIRCLES_PER_GROUP}; i++) {
      let c = CIRCLES[i];
      let d = abs(dot(q, c.xyz) - c.w);
      let breathe = 0.55 + 0.45 * sin(spin * (1.1 + f32(i) * 0.09) + f32(i) * 1.7);
      s += smoothstep(0.009, 0.002, d) * breathe;
    }
  }`).join("\n")}
  return s;
}

/**
 * The cage on three shells, front and back of each, where the ray crosses.
 * Returns the light and how much of it came from deep inside. Inner shells
 * ease out at their own silhouettes; the outer one is the ball's edge, which
 * is what the film draws.
 */
fn shells(closest: vec3f, rd: vec3f, b: f32, r: f32) -> vec2f {
  var s = 0.0;
  var deep = 0.0;
${[
  { radius: 1.0, front: 1.0, back: 0.3, fade: 0.0 },
  { radius: 0.85, front: 0.6, back: 0.2, fade: 0.1 },
  { radius: 0.68, front: 0.45, back: 0.15, fade: 0.1 },
  { radius: 0.5, front: 0.3, back: 0.1, fade: 0.1 },
].map((k, i) => `  if (b < ${k.radius.toFixed(2)}) {
    let h = sqrt(${k.radius.toFixed(2)} * ${k.radius.toFixed(2)} - b * b) * r;
    let edge = ${k.fade > 0 ? `smoothstep(${k.radius.toFixed(2)}, ${(k.radius - k.fade).toFixed(2)}, b)` : "1.0"};
    let t = (cage(normalize(closest - rd * h), p.spin) * ${k.front.toFixed(2)} + cage(normalize(closest + rd * h), p.spin) * ${k.back.toFixed(2)}) * edge;
    s += t;
    deep += t * ${(i / 3).toFixed(2)};
  }`).join("\n")}
  return vec2f(s, deep);
}

/**
 * One orbit: where this ray crosses the ring's plane, how far that point is
 * from the ring, and where it sits around it relative to the arcs' heads.
 * ro and rd are in ball units, centred on the ball.
 */
fn orbit(ro: vec3f, rd: vec3f, axis: vec3f, radius: f32, phase: f32, arcs: f32, inside: f32) -> f32 {
  let denom = dot(rd, axis);
  if (abs(denom) < 1e-4) { return 0.0; }
  let t = -dot(ro, axis) / denom;
  if (t < 0.0) { return 0.0; }
  let hit = ro + rd * t;
  let u = normalize(cross(axis, vec3f(0.31, 0.77, 0.55)));
  let v = cross(axis, u);
  let ring = smoothstep(0.035, 0.008, abs(length(hit) - radius));
  // Angle around the ring, measured from the leading head, wrapped so the
  // tail trails behind the direction of travel.
  let ang = atan2(dot(hit, v), dot(hit, u));
  let behind = fract((phase - ang) / 6.2831853 * arcs);
  let arc = exp(-behind * 9.0) * smoothstep(0.0, 0.02, behind);
  // On the far side of the ball the arc is seen through chakra, and where
  // the glow is dense it is lost altogether.
  let far = step(0.0, dot(hit, rd));
  let hidden = mix(1.0, 0.18, far * inside);
  return ring * arc * hidden;
}

@fragment fn main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let aspect = p.size.x / p.size.y;
  let ndc = vec2f(uv.x - 0.5, 0.5 - uv.y) * 2.0;
  let rd = normalize(p.camFwd
    + p.camRight * (ndc.x * p.tanHalf * aspect)
    + p.camUp * (ndc.y * p.tanHalf));
  let ro = p.camPos;

  // The ball breathes, and swells while it is being charged.
  let r = R * (1.0 + 0.025 * sin(p.time * 5.3) + ${(CHARGE_MAX - 1).toFixed(2)} * p.charge);
  // Chakra is not steady: a frame-rate flicker, a few percent, like the anime.
  let flicker = 1.0 + 0.06 * (hash3(vec3f(floor(p.time * 24.0), 1.0, 7.0)) - 0.5);
  let glow = (1.0 + 0.3 * p.charge) * flicker;

  // Closest approach of the ray to the centre: everything below is a function
  // of it, because the ball is a volume and a pixel is a chord through it.
  let tc = -dot(ro, rd);
  let closest = ro + rd * tc;
  let b = length(closest) / r;

  // Where this pixel sits around the centre, in the picture plane.
  let ox = dot(closest, p.camRight);
  let oy = dot(closest, p.camUp);
  let theta = atan2(oy, ox);
  let radial = vec2f(cos(theta), sin(theta));
  let tangent = vec2f(-radial.y, radial.x);
  let pull = 1.0 + 1.5 * p.charge;

  // How much chakra is in front of this pixel, softly: full well inside, gone
  // a little past the reach. Every term below rides on this so nothing has an
  // edge.
  let inside = smoothstep(${REACH}, 0.6, b);

  // The air is drawn in: the world behind shimmers and is dragged into a
  // spiral, hardest around the shell and fading both ways from it.
  let near = exp(-abs(b - 1.0) * 3.0);
  let shimmer = noise3(vec3f(theta * 2.0, b * 2.5, p.time * 2.0)) - 0.5;
  let drag = (tangent * 0.6 - radial * 0.5) * near * (0.03 + 0.03 * shimmer) * pull;
  let bent = normalize(rd + p.camRight * drag.x + p.camUp * drag.y);
  var color = envColor(bent, p.dofLod);
  // Seen through chakra the world is dimmer and bluer.
  color *= mix(vec3f(1.0), mix(vec3f(0.22), CHAKRA * 0.7 + 0.05, 0.5), inside);

  // Chakra peeling off the shell: soft tongues that ride the rotation,
  // stretch along it, and dissolve half a radius out. Noise is read on the
  // circle itself, cos and sin, so there is no seam where the angle wraps.
  let ride = theta + p.spin * 1.2;
  let ring = vec2f(cos(ride), sin(ride)) * 2.2;
  let outward = log(max(b, 0.3)) * 14.0 - p.spin * 2.5;
  var tongue = noise3(vec3f(ring, outward)) * 0.65
    + noise3(vec3f(ring * 2.3 + 5.0, outward * 2.1 + 3.0)) * 0.35;
  tongue = smoothstep(0.62 - 0.08 * p.charge, 0.88, tongue);
  let cling = exp(-abs(b - 1.0) * 5.0) * smoothstep(0.7, 1.05, b);
  color += mix(CHAKRA, CORE, 0.35) * tongue * cling * (0.35 + 0.6 * p.charge) * glow;

  // Halo around the shell, and the light it throws on everything nearby: the
  // films let the chakra bleed a long way into the frame.
  let out = max(b, 1.0);
  color += CYAN * exp(-(out - 1.0) * 6.0) * 0.5 * glow;
  color += CHAKRA * exp(-(out - 1.0) * 1.2) * 0.24 * glow;

  // Arcs orbiting the ball: the spin you can see.
  let rob = ro / r;
  var arcs = 0.0;
${ORBITS.map((o) => `  arcs += orbit(rob, rd, vec3f(${o.axis.map((v) => v.toFixed(4)).join(", ")}), ${o.radius.toFixed(2)}, p.spin * ${(o.speed * 6.2831853).toFixed(3)}, ${o.arcs.toFixed(1)}, inside);`).join("\n")}
  color += mix(CYAN, CORE, 0.6) * arcs * 1.2 * glow;

  if (b < ${REACH}) {
    // The cage of thread, and how much of it is deep inside.
    let caged = shells(closest, rd, b, r);
    let s = caged.x;
    let white = caged.y;

    // A soft luminous body, cyan in the middle and blue toward the edge, that
    // fades with the same curve as the strands.
    let body = mix(CYAN, CHAKRA, smoothstep(0.15, 0.9, b));
    color += body * inside * inside * 0.55 * glow;

    // Thread: whiter the deeper it is.
    color += mix(CYAN, CORE, clamp(white * 0.8 + 0.35, 0.0, 1.0)) * s * 0.95 * glow;
    // The film's rim: a soft band of saturated blue just inside the edge.
    color += CHAKRA * smoothstep(0.55, 0.98, b) * smoothstep(1.06, 0.98, b) * 0.35 * glow;

    // Core: the compressed centre, white going cyan.
    color += mix(CYAN, CORE, exp(-b * b * 5.0)) * exp(-b * b * 2.8) * 1.6 * glow;
  }

  return vec4f(color, 1.0);
}
`;

const normalize3 = (v: number[]) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross3 = (a: number[], b: number[]) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export const rasengan: VgpuSetup = ({ gpu, surface, canvas, onCleanup, reducedMotion }) => {
  const view = lens(gpu, surface, onCleanup);
  const pass = effect(gpu, SCENE, { label: "rasengan-scene" });
  // Night first: blue chakra under the moon. The world moves on every twelve
  // seconds on its own; a click on it moves on at once.
  const scenes = photoScenes(gpu, pass, onCleanup, SCENES, 0, 12);

  const tanHalf = Math.tan((FOV * Math.PI) / 360);
  const camera = {
    pos: [0, 0, 1],
    right: [1, 0, 0],
    up: [0, 1, 0],
    fwd: [0, 0, -1],
  };
  const aim = (yaw: number, aspect: number) => {
    const dist = 4.8 * RADIUS * Math.min(1, Math.max(0.75, aspect / 1.6));
    camera.pos = [Math.sin(yaw) * dist, 0.45 * RADIUS, Math.cos(yaw) * dist];
    camera.fwd = normalize3(camera.pos.map((v) => -v));
    camera.right = normalize3(cross3(camera.fwd, [0, 1, 0]));
    camera.up = cross3(camera.right, camera.fwd);
  };
  aim(0, surface.size[0] / Math.max(surface.size[1], 1));

  /** Whether a pointer ray meets the ball. */
  const hits = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
    const y = (0.5 - (event.clientY - rect.top) / rect.height) * 2;
    const aspect = rect.width / rect.height;
    const dir = normalize3(
      camera.fwd.map(
        (f, i) =>
          f + camera.right[i] * x * tanHalf * aspect + camera.up[i] * y * tanHalf,
      ),
    );
    const ro = camera.pos;
    const b = ro[0] * dir[0] + ro[1] * dir[1] + ro[2] * dir[2];
    const bound = RADIUS * 1.2;
    return b * b - (ro[0] ** 2 + ro[1] ** 2 + ro[2] ** 2 - bound * bound) >= 0;
  };

  // Hold the pointer on the ball and it charges: bigger, brighter, faster.
  // Let go and it settles. A press on the world behind it changes the world.
  let holding = false;
  let charge = 0;
  const press = (event: PointerEvent) => {
    if (hits(event)) holding = true;
    else scenes.next();
  };
  const release = () => {
    holding = false;
  };
  canvas.addEventListener("pointerdown", press, { passive: true });
  window.addEventListener("pointerup", release, { passive: true });
  window.addEventListener("pointercancel", release, { passive: true });
  onCleanup(() => {
    canvas.removeEventListener("pointerdown", press);
    window.removeEventListener("pointerup", release);
    window.removeEventListener("pointercancel", release);
  });

  let spin = 0;

  return (frame, time, delta) => {
    scenes.frame(time);
    const [fw, fh] = view.size;

    if (!reducedMotion) {
      const dt = Math.min(delta, 1 / 20);
      charge = Math.max(0, Math.min(1, charge + dt / (holding ? CHARGE_SECONDS : -SETTLE_SECONDS)));
      // Spin is its own clock so the charge can speed the streaks up.
      spin += dt * (1 + (CHARGE_MAX - 1) * charge);
      aim(Math.sin(time * 0.09) * 0.45, fw / fh);
    }

    const aspect = fw / fh;
    const horizontalFov = (2 * Math.atan(tanHalf * aspect) * 180) / Math.PI;
    // Blur radius as a fraction of the view is a fixed number of photo texels,
    // whatever the render size, so retina and not look the same.
    const blurTexels = DOF_BLUR * scenes.width * (horizontalFov / 360);
    const dofLod = Math.max(0, Math.min(6, Math.log2(Math.max(blurTexels, 1))));

    pass.set({
      size: [fw, fh],
      tanHalf,
      time,
      spin,
      dofLod,
      charge,
      camPos: camera.pos,
      camRight: camera.right,
      camUp: camera.up,
      camFwd: camera.fwd,
    });
    frame.pass(view.scene, pass);
    view.finish(frame);
  };
};
