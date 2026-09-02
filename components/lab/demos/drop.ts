import { effect, sampler, target } from "vgpu";
import type { VgpuSetup } from "../useVgpuCanvas";
import { waterOptics } from "./ocean-optics";

/**
 * A free drop of water, ray traced in one fragment shader.
 *
 * Shape comes from Rayleigh's 1879 result: a drop held only by surface tension
 * can wobble in a fixed set of modes, each with its own frequency,
 *
 *   omega_l^2 = l (l - 1) (l + 2) sigma / (rho a^3)
 *
 * and each dying away at Lamb's viscous rate, tau_l = a^2 / (nu (l-1)(2l+1)).
 * Mode 2 is the egg-to-pancake swing, mode 3 the three lobed one; higher modes
 * are small and die fast, so two is enough. Each mode is kept as a tensor
 * rather than as an axis and an amplitude, so pokes from different directions
 * superpose the way they do on the real thing. A tap also sends a capillary
 * ripple out from the point of contact, at the speed the dispersion relation
 * omega^2 = sigma k^3 / rho gives it.
 *
 * Light: Fresnel and Snell at the first surface, a march to the far side,
 * total internal reflection when Snell has no answer, Beer-Lambert over the
 * path with Pope and Fry's absorption for pure water, and water's real
 * dispersion at the exit. The world around it is a photograph: an HDRI by
 * Poly Haven (CC0), stored log-encoded so eight bits carry seventeen stops.
 */

/** Radius in metres. Six centimetres: a drop the size of a grapefruit. */
const RADIUS = 0.06;
const SURFACE_TENSION = 0.072;
const DENSITY = 1000;
// ponytail: real water is 1e-6 and a drop this size rings for twelve minutes;
// a hundred times that settles it in seconds. Lower it for a floatier drop.
const VISCOSITY = 1e-4;

/** Capillary ripple: wavelength as a fraction of the radius, and its lifetime. */
const RIPPLE_WAVELENGTH = RADIUS / 3;
const RIPPLE_LIFE = 1.4;
const RIPPLES = 4;

const FOV = 46;

/**
 * Long edge of the ray traced frame, in pixels. Three refraction paths per
 * pixel is a lot of work for a retina display to do twice over; the composite
 * pass scales it up. Raise it if the rim looks soft on a big screen.
 */
const MAX_RENDER_EDGE = 1600;

/** Background blur, as a fraction of the frame width. What a macro lens does. */
const DOF_BLUR = 0.009;

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

/** How the environment was packed: v = log2(1 + L * K) / M. */
const ENV_K = 32;
const ENV_M = 17;

/**
 * The places the drop can sit. All Poly Haven HDRIs (CC0), each exposed to the
 * same key so the camera does not have to adjust between them. yaw turns the
 * photograph so the part worth looking at is behind the drop.
 */
const SCENES = [
  { url: "/env/road.webp", yaw: 0 }, // rural_asphalt_road
  { url: "/env/city.webp", yaw: 0.08 }, // shanghai_bund, at night
  { url: "/env/studio.webp", yaw: 0.2 }, // studio_small_09, facing the softboxes
  { url: "/env/dawn.webp", yaw: 0 }, // kiara_1_dawn
];
const FADE_SECONDS = 0.8;

/** Rayleigh frequency and Lamb damping time for mode l. */
function rayleigh(l: number) {
  const omega = Math.sqrt(
    (l * (l - 1) * (l + 2) * SURFACE_TENSION) / (DENSITY * RADIUS ** 3),
  );
  const tau = RADIUS ** 2 / (VISCOSITY * (l - 1) * (2 * l + 1));
  return { omega, tau };
}

/** Capillary wave on the surface: wavenumber, frequency, group velocity. */
const ripple = (() => {
  const k = (2 * Math.PI) / RIPPLE_WAVELENGTH;
  const omega = Math.sqrt((SURFACE_TENSION * k ** 3) / DENSITY);
  return { k, omega, groupVelocity: (1.5 * omega) / k };
})();

/**
 * One Rayleigh mode as a set of damped oscillators that all share a frequency.
 * The components are the tensor coefficients the shader multiplies by powers
 * of the surface normal; a poke along an axis adds that axis's outer product.
 */
class Mode {
  x: Float64Array;
  v: Float64Array;
  omega: number;
  tau: number;

  constructor(l: number, size: number, private readonly cap: number) {
    ({ omega: this.omega, tau: this.tau } = rayleigh(l));
    this.x = new Float64Array(size);
    this.v = new Float64Array(size);
  }

  kick(shape: number[], impulse: number) {
    for (let i = 0; i < shape.length; i++) this.v[i] += shape[i] * impulse;
  }

  step(dt: number) {
    const k = this.omega * this.omega;
    const drag = 2 / this.tau;
    let norm = 0;
    for (let i = 0; i < this.x.length; i++) {
      this.v[i] += (-k * this.x[i] - drag * this.v[i]) * dt;
      this.x[i] += this.v[i] * dt;
      norm += this.x[i] * this.x[i];
    }
    // The linear theory only holds for small wobbles, and a hovered pointer
    // pumps energy in every frame. Past this the drop would fold through itself.
    norm = Math.sqrt(norm);
    if (norm > this.cap) {
      const s = this.cap / norm;
      for (let i = 0; i < this.x.length; i++) {
        this.x[i] *= s;
        this.v[i] *= s;
      }
    }
  }
}

/** Q = (3 a a^T - I) / 2, so n^T Q n is the Legendre polynomial P2(n . a). */
function shape2([x, y, z]: number[]) {
  return [
    (3 * x * x - 1) / 2,
    (3 * y * y - 1) / 2,
    (3 * z * z - 1) / 2,
    1.5 * x * y,
    1.5 * x * z,
    1.5 * y * z,
  ];
}

/** The cubic a (x) a (x) a and the linear a, together giving P3(n . a). */
function shape3([x, y, z]: number[]) {
  return [
    x * x * x, y * y * y, z * z * z, x * y * z,
    x * x * y, x * x * z, x * y * y,
    y * y * z, x * z * z, y * z * z,
    x, y, z,
  ];
}

const SCENE = /* wgsl */ `
struct Params {
  size: vec2f,
  tanHalf: f32,
  time: f32,
  dofLod: f32,
  // Mip level a reflection off the drop should read. A pixel on a mirror ball
  // covers many texels of sky, and reading one of them makes the sun flicker.
  reflLod: f32,
  camPos: vec3f,
  camRight: vec3f,
  camUp: vec3f,
  camFwd: vec3f,
  qDiag: vec3f,
  qOff: vec3f,
  c0: vec4f,
  c1: vec3f,
  c2: vec3f,
  b: vec3f,
  absorb: vec3f,
  // Ripple sources: unit direction from the centre, and the time it started.
  rip0: vec4f,
  rip1: vec4f,
  rip2: vec4f,
  rip3: vec4f,
  ripAmp: vec4f,
  // Two photographs and a crossfade between them: yaw turns each one.
  yawA: f32,
  yawB: f32,
  fade: f32,
}
@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var envA: texture_2d<f32>;
@group(0) @binding(2) var envB: texture_2d<f32>;
@group(0) @binding(3) var envSampler: sampler;

const R = ${RADIUS};
// Water at 680, 550 and 440nm. Blue bends most, which is the rim fringe.
const IOR = vec3f(1.3308, 1.3334, 1.3397);
const RIP_K = ${ripple.k.toFixed(3)};
const RIP_W = ${ripple.omega.toFixed(3)};
const RIP_V = ${ripple.groupVelocity.toFixed(4)};
const RIP_LIFE = ${RIPPLE_LIFE};
const ENV_K = ${ENV_K}.0;
const ENV_M = ${ENV_M}.0;

/** A wave packet that has travelled dist along the surface for age seconds. */
fn packet(dist: f32, age: f32) -> f32 {
  // Travels at the group velocity and spreads as it goes.
  let centre = RIP_V * age;
  let width = 0.25 * R + 0.35 * centre;
  return sin(RIP_K * dist - RIP_W * age) * exp(-((dist - centre) * (dist - centre)) / (width * width));
}

fn oneRipple(n: vec3f, src: vec4f, amp: f32) -> f32 {
  let age = p.time - src.w;
  if (age <= 0.0 || age > RIP_LIFE * 4.0) { return 0.0; }
  let theta = acos(clamp(dot(n, src.xyz), -1.0, 1.0));
  let arc = theta * R;
  // The ring the wave sits on has length sin(theta), so its energy thins out
  // toward the equator and gathers again as it closes on the far side.
  let focus = inverseSqrt(max(sin(theta), 0.2));
  // The short way round, and the long way round once it has met itself.
  let both = packet(arc, age) + packet(6.2831853 * R - arc, age);
  return amp * exp(-age / RIP_LIFE) * focus * both;
}

/** Radial displacement of the surface as a fraction of R. */
fn wobble(n: vec3f) -> f32 {
  let nn = n * n;
  let d2 = dot(p.qDiag, nn) + 2.0 * dot(p.qOff, vec3f(n.x * n.y, n.x * n.z, n.y * n.z));
  let cubic = dot(p.c0.xyz, nn * n) + 6.0 * p.c0.w * n.x * n.y * n.z
    + 3.0 * (nn.x * n.y * p.c1.x + nn.x * n.z * p.c1.y + n.x * nn.y * p.c1.z
           + nn.y * n.z * p.c2.x + n.x * nn.z * p.c2.y + n.y * nn.z * p.c2.z);
  let d3 = 2.5 * cubic - 1.5 * dot(p.b, n);
  let rip = oneRipple(n, p.rip0, p.ripAmp.x) + oneRipple(n, p.rip1, p.ripAmp.y)
          + oneRipple(n, p.rip2, p.ripAmp.z) + oneRipple(n, p.rip3, p.ripAmp.w);
  return clamp(d2 + d3, -0.3, 0.3) + rip;
}

fn sdf(q: vec3f) -> f32 {
  let r = length(q);
  return r - R * (1.0 + wobble(q / max(r, 1e-6)));
}

fn normalAt(q: vec3f) -> vec3f {
  let e = vec2f(1.0, -1.0) * R * 0.002;
  return normalize(
      e.xyy * sdf(q + e.xyy) + e.yyx * sdf(q + e.yyx)
    + e.yxy * sdf(q + e.yxy) + e.xxx * sdf(q + e.xxx));
}

/** Schlick, with the total internal reflection case handled when n1 > n2. */
fn fresnel(n1: f32, n2: f32, normal: vec3f, incident: vec3f) -> f32 {
  var r0 = (n1 - n2) / (n1 + n2);
  r0 = r0 * r0;
  var cosX = -dot(normal, incident);
  if (n1 > n2) {
    let n = n1 / n2;
    let sinT2 = n * n * (1.0 - cosX * cosX);
    if (sinT2 > 1.0) { return 1.0; }
    cosX = sqrt(1.0 - sinT2);
  }
  let x = 1.0 - cosX;
  return r0 + (1.0 - r0) * x * x * x * x * x;
}

/** One photograph, looked up by direction and unpacked from its log encoding. */
fn lookup(tex: texture_2d<f32>, d: vec3f, lod: f32, yaw: f32) -> vec3f {
  let u = 0.5 + atan2(d.x, -d.z) / 6.2831853 + yaw;
  let v = 0.5 - asin(clamp(d.y, -1.0, 1.0)) / 3.1415927;
  let packed = textureSampleLevel(tex, envSampler, vec2f(u, v), lod).rgb;
  return (exp2(packed * ENV_M) - 1.0) / ENV_K;
}

/** The world around the drop; two worlds while one is fading into the next. */
fn envColor(d: vec3f, lod: f32) -> vec3f {
  let a = lookup(envA, d, lod, p.yawA);
  if (p.fade <= 0.0) { return a; }
  return mix(a, lookup(envB, d, lod, p.yawB), p.fade);
}

/**
 * One colour's journey through the drop. Into the water, across, and at each
 * face some light leaves while the rest reflects back in to try the next one,
 * until what is left is not worth following. Snell with no answer is total
 * internal reflection: nothing leaves, everything carries on. Each channel has
 * its own index, so the three paths part company at the very first surface.
 */
fn traceInside(pos: vec3f, n: vec3f, rd: vec3f, ior: f32, absorb: f32, channel: vec3f) -> f32 {
  var dir = refract(rd, n, 1.0 / ior);
  var q = pos + dir * R * 0.002;
  var carry = 1.0 - fresnel(1.0, ior, n, rd);
  var radiance = 0.0;
  for (var k = 0; k < 5; k++) {
    var s = 0.0;
    for (var i = 0; i < 40; i++) {
      let d = -sdf(q + dir * s);
      if (d < R * 0.0005) { break; }
      s += d * 0.85;
    }
    q += dir * s;
    carry *= exp(-absorb * s);
    let nOut = normalAt(q);
    let out = refract(dir, -nOut, ior);
    if (dot(out, out) > 0.5) {
      let fo = fresnel(ior, 1.0, -nOut, dir);
      // ponytail: the refracted image is magnified less than the mirror one,
      // so it reads a finer level; the true footprint would need ray differentials.
      radiance += dot(envColor(out, p.reflLod * 0.6), channel) * carry * (1.0 - fo);
      carry *= fo;
      if (carry < 0.02) { break; }
    }
    dir = reflect(dir, nOut);
    q += dir * R * 0.002;
  }
  return radiance;
}

@fragment fn main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let aspect = p.size.x / p.size.y;
  let ndc = vec2f(uv.x - 0.5, 0.5 - uv.y) * 2.0;
  let rd = normalize(p.camFwd
    + p.camRight * (ndc.x * p.tanHalf * aspect)
    + p.camUp * (ndc.y * p.tanHalf));
  let ro = p.camPos;

  // Analytic bounding sphere first; most pixels never march.
  let bound = R * 1.35;
  let bb = dot(ro, rd);
  let h = bb * bb - (dot(ro, ro) - bound * bound);
  var hit = false;
  var t = 0.0;
  var nearest = 1e9;
  if (h > 0.0) {
    t = -bb - sqrt(h);
    let exit = -bb + sqrt(h);
    for (var i = 0; i < 48; i++) {
      let d = sdf(ro + rd * t);
      nearest = min(nearest, d);
      if (d < R * 0.0005) { hit = true; break; }
      t += d * 0.8;
      if (t > exit) { break; }
    }
    // The march can step over the closest approach; sample it outright.
    nearest = min(nearest, sdf(ro - rd * bb));
  }

  var color: vec3f;
  if (!hit) {
    // The camera is focused on the drop, so the world behind it is not.
    color = envColor(rd, p.dofLod);
    // Feather the rim over one pixel. A grazing ray is almost all reflection,
    // so the rim colour is the environment mirrored off the closest point.
    let px = length(ro) * 2.0 * p.tanHalf / p.size.y;
    let cover = 1.0 - smoothstep(0.0, px, nearest);
    if (cover > 0.0) {
      let closest = ro - rd * bb;
      color = mix(color, envColor(reflect(rd, normalize(closest)), 0.0), cover);
    }
  } else {
    let pos = ro + rd * t;
    let n = normalAt(pos);
    let f = vec3f(fresnel(1.0, IOR.x, n, rd), fresnel(1.0, IOR.y, n, rd), fresnel(1.0, IOR.z, n, rd));
    color = envColor(reflect(rd, n), p.reflLod) * f + vec3f(
      traceInside(pos, n, rd, IOR.x, p.absorb.x, vec3f(1.0, 0.0, 0.0)),
      traceInside(pos, n, rd, IOR.y, p.absorb.y, vec3f(0.0, 1.0, 0.0)),
      traceInside(pos, n, rd, IOR.z, p.absorb.z, vec3f(0.0, 0.0, 1.0)));
  }

  // Linear radiance out; the lens (bloom, tone curve) is a later pass.
  return vec4f(color, 1.0);
}
`;

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

/** The lens: glow added back, then the tone curve and gamma. */
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

const normalize3 = (v: number[]) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross3 = (a: number[], b: number[]) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/**
 * The shader expands P2 and P3 from tensor coefficients. A wrong coefficient
 * still wobbles plausibly, so in development the expansion is checked against
 * the polynomials it is meant to equal.
 */
function checkShapes() {
  const rand = () => normalize3([Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5]);
  const a = rand();
  const n = rand();
  const x = n[0] * a[0] + n[1] * a[1] + n[2] * a[2];
  const q = shape2(a);
  const c = shape3(a);
  const [nx, ny, nz] = n;
  const d2 = q[0] * nx * nx + q[1] * ny * ny + q[2] * nz * nz
    + 2 * (q[3] * nx * ny + q[4] * nx * nz + q[5] * ny * nz);
  const cubic = c[0] * nx ** 3 + c[1] * ny ** 3 + c[2] * nz ** 3 + 6 * c[3] * nx * ny * nz
    + 3 * (nx * nx * ny * c[4] + nx * nx * nz * c[5] + nx * ny * ny * c[6]
         + ny * ny * nz * c[7] + nx * nz * nz * c[8] + ny * nz * nz * c[9]);
  const d3 = 2.5 * cubic - 1.5 * (c[10] * nx + c[11] * ny + c[12] * nz);
  const p2 = (3 * x * x - 1) / 2;
  const p3 = (5 * x ** 3 - 3 * x) / 2;
  if (Math.abs(d2 - p2) > 1e-9 || Math.abs(d3 - p3) > 1e-9) {
    console.error("drop mode tensors do not match Legendre", { d2, p2, d3, p3 });
  }
}

/** A texture the shader can sample; starts as one grey texel until the photo lands. */
function envTexture(device: GPUDevice, width: number, height: number, mips = 1) {
  return device.createTexture({
    label: "drop-env",
    size: [width, height],
    mipLevelCount: mips,
    format: "rgba8unorm",
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  });
}

export const drop: VgpuSetup = ({ gpu, surface, canvas, onCleanup, reducedMotion }) => {
  if (process.env.NODE_ENV === "development") checkShapes();

  const device = gpu.device.gpu;
  // Mid grey in the log encoding, so the first frames are a drop in fog rather
  // than a drop in a void.
  const grey = envTexture(device, 1, 1);
  device.queue.writeTexture({ texture: grey }, new Uint8Array([120, 120, 120, 255]), {}, [1, 1]);
  const envSampler = sampler(gpu, {
    magFilter: "linear",
    minFilter: "linear",
    mipmapFilter: "linear",
    addressModeU: "repeat",
    addressModeV: "clamp-to-edge",
  });
  const samp = sampler(gpu, { magFilter: "linear", minFilter: "linear" });

  // Ray tracing lands in a linear HDR frame; the glow is built at quarter size.
  const renderSize = ([w, h]: readonly [number, number]) => {
    const scale = Math.min(1, MAX_RENDER_EDGE / Math.max(w, h, 1));
    return [Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale))] as [number, number];
  };
  const quarter = ([w, h]: readonly [number, number]) =>
    [Math.max(1, Math.ceil(w / 4)), Math.max(1, Math.ceil(h / 4))] as [number, number];
  let frameSize = renderSize(surface.size as [number, number]);
  const scene = target(gpu, { size: frameSize, format: "rgba16float" });
  const glowA = target(gpu, { size: quarter(frameSize), format: "rgba16float" });
  const glowB = target(gpu, { size: quarter(frameSize), format: "rgba16float" });
  onCleanup(
    surface.onResize((event) => {
      frameSize = renderSize([event.width, event.height]);
      scene.resize(frameSize);
      glowA.resize(quarter(frameSize));
      glowB.resize(quarter(frameSize));
    }),
  );

  const pass = effect(gpu, SCENE, {
    label: "drop-scene",
    // Pure water: chlorophyll zero leaves only Pope and Fry's measurement.
    set: { absorb: waterOptics(0).attenuation, envA: grey, envB: grey, envSampler },
  });
  const bright = effect(gpu, BRIGHT, { label: "drop-bright", set: { samp } });
  const blur = effect(gpu, BLUR, { label: "drop-blur", set: { samp } });
  const composite = effect(gpu, COMPOSITE, { label: "drop-composite", set: { samp } });

  let disposed = false;
  type Photo = { texture: GPUTexture; width: number };
  const photos = new Map<number, Promise<Photo>>();
  // Resolved photos, reachable synchronously: swapping one in has to happen
  // in the same frame the crossfade ends, or the old scene shows for a frame.
  const ready = new Map<number, Photo>();
  onCleanup(() => {
    disposed = true;
    grey.destroy();
    for (const photo of photos.values()) void photo.then((p) => p.texture.destroy());
  });

  /** Fetches a scene's photograph once and builds its mip levels. */
  const photo = (index: number) => {
    let loading = photos.get(index);
    if (loading) return loading;
    loading = (async () => {
      const blob = await (await fetch(SCENES[index].url)).blob();
      const options: ImageBitmapOptions = {
        colorSpaceConversion: "none",
        premultiplyAlpha: "none",
        resizeQuality: "high",
      };
      let level = await createImageBitmap(blob, options);
      const { width, height } = level;
      // Mip levels are what the background blur samples. WebGPU does not
      // build them, so the photo is halved and halved again, off the main
      // thread, and each half is copied into its level.
      const mips = 7;
      const texture = envTexture(device, width, height, mips);
      for (let i = 0; i < mips; i++) {
        if (i > 0) {
          const next = await createImageBitmap(level, {
            ...options,
            resizeWidth: Math.max(1, width >> i),
            resizeHeight: Math.max(1, height >> i),
          });
          level.close();
          level = next;
        }
        device.queue.copyExternalImageToTexture(
          { source: level },
          { texture, mipLevel: i },
          [level.width, level.height],
        );
      }
      level.close();
      const result = { texture, width };
      ready.set(index, result);
      return result;
    })();
    photos.set(index, loading);
    return loading;
  };

  // Scene A is what is shown; B is what it is fading into, if anything. The
  // first photo fades in from grey the same way the others fade in from it.
  let current = 0;
  let incoming: number | null = null;
  let fadeStart = 0;
  let envWidth = 1;
  let now = 0;

  const fadeTo = (index: number) => {
    void photo(index).then((loaded) => {
      if (disposed || incoming !== null) return;
      pass.set({ envB: loaded.texture, yawB: SCENES[index].yaw });
      incoming = index;
      // Uploading a 4k photo stalls the loop for a moment, so the clock is
      // read on the first frame that draws the fade, not here, or it would
      // start part way in.
      fadeStart = -1;
    });
  };
  fadeTo(0);

  const nextScene = () => {
    if (incoming !== null) return;
    fadeTo((current + 1) % SCENES.length);
  };

  const mode2 = new Mode(2, 6, 0.22);
  const mode3 = new Mode(3, 13, 0.1);

  const ripples = { src: Array.from({ length: RIPPLES }, () => [0, 1, 0, -1e9]), amp: new Array<number>(RIPPLES).fill(0) };
  let nextRipple = 0;

  const poke = (axis: number[], impulse: number, splash = 0) => {
    // Negative: a poke pushes the surface in before it springs back out.
    mode2.kick(shape2(axis), -impulse);
    mode3.kick(shape3(axis), -impulse * 0.6);
    if (splash > 0) {
      ripples.src[nextRipple] = [...axis, now];
      ripples.amp[nextRipple] = splash;
      nextRipple = (nextRipple + 1) % RIPPLES;
    }
  };

  // Start mid-wobble rather than as a perfect sphere, so the first frame and
  // the reduced-motion still both show water rather than a marble.
  const seed = shape2(normalize3([0.6, 0.5, 0.62]));
  for (let i = 0; i < seed.length; i++) mode2.x[i] = seed[i] * 0.07;

  const tanHalf = Math.tan((FOV * Math.PI) / 360);
  const camera = {
    pos: [0, 0, 1],
    right: [1, 0, 0],
    up: [0, 1, 0],
    fwd: [0, 0, -1],
  };
  const aim = (yaw: number, aspect: number) => {
    // A narrow frame moves in so the drop still fills it.
    const dist = 4.2 * RADIUS * Math.min(1, Math.max(0.75, aspect / 1.6));
    camera.pos = [Math.sin(yaw) * dist, 0.45 * RADIUS, Math.cos(yaw) * dist];
    camera.fwd = normalize3(camera.pos.map((v) => -v));
    camera.right = normalize3(cross3(camera.fwd, [0, 1, 0]));
    camera.up = cross3(camera.right, camera.fwd);
  };
  aim(0, surface.size[0] / Math.max(surface.size[1], 1));

  /** Where a pointer ray meets the drop, as a unit direction from its centre. */
  const pick = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
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
    const bound = RADIUS * 1.08;
    const h = b * b - (ro[0] ** 2 + ro[1] ** 2 + ro[2] ** 2 - bound * bound);
    if (h < 0) return null;
    const t = -b - Math.sqrt(h);
    return { axis: normalize3(ro.map((o, i) => o + dir[i] * t)), x, y };
  };

  let last: { x: number; y: number } | null = null;
  let lastTouched = Number.NEGATIVE_INFINITY;
  const move = (event: PointerEvent) => {
    const at = pick(event);
    if (!at) {
      last = null;
      return;
    }
    // Speed across the drop sets the strength, so a slow pass barely stirs it.
    const speed = last ? Math.hypot(at.x - last.x, at.y - last.y) : 0;
    last = at;
    poke(at.axis, Math.min(speed * 0.6, 0.05));
    lastTouched = performance.now();
  };
  const press = (event: PointerEvent) => {
    const at = pick(event);
    // Tap the drop to poke it; tap the world behind it to change the world.
    if (!at) {
      nextScene();
      return;
    }
    poke(at.axis, 0.2, 0.004);
    lastTouched = performance.now();
  };
  canvas.addEventListener("pointermove", move, { passive: true });
  canvas.addEventListener("pointerdown", press, { passive: true });
  onCleanup(() => {
    canvas.removeEventListener("pointermove", move);
    canvas.removeEventListener("pointerdown", press);
  });

  let nextNudge = 2;

  return (frame, time, delta) => {
    now = time;
    let fade = 0;
    if (incoming !== null) {
      if (fadeStart < 0) fadeStart = time;
      fade = Math.min(1, (time - fadeStart) / FADE_SECONDS);
      if (fade >= 1) {
        current = incoming;
        incoming = null;
        fade = 0;
        const done = ready.get(current);
        if (done) {
          envWidth = done.width;
          pass.set({ envA: done.texture, yawA: SCENES[current].yaw });
        }
      }
    }
    if (!reducedMotion) {
      // Left alone it gets the odd tap, so a gallery card still moves.
      if (time > nextNudge && performance.now() - lastTouched > 2500) {
        poke(normalize3([Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5]), 0.08 + Math.random() * 0.06, 0.0025);
        nextNudge = time + 3 + Math.random() * 3;
      }
      const dt = Math.min(delta, 1 / 20);
      mode2.step(dt);
      mode3.step(dt);
      aim(Math.sin(time * 0.09) * 0.45, frameSize[0] / frameSize[1]);
    }

    const q = mode2.x;
    const c = mode3.x;
    // Blur radius in photo texels, given how many texels a pixel spans here.
    const aspect = frameSize[0] / frameSize[1];
    const horizontalFov = (2 * Math.atan(tanHalf * aspect) * 180) / Math.PI;
    const texelsPerPixel = (envWidth * (horizontalFov / 360)) / frameSize[0];
    const dofLod = Math.max(0, Math.min(6, Math.log2((DOF_BLUR * frameSize[0]) / texelsPerPixel)));
    // A pixel on the drop spans px metres; the normal turns px / R over it and
    // the mirrored ray twice that, which is this many photo texels.
    const px = (Math.hypot(...camera.pos) * 2 * tanHalf) / frameSize[1];
    const mirrorTexels = ((2 * px) / RADIUS) * (envWidth / (2 * Math.PI));
    const reflLod = Math.max(0, Math.min(6, Math.log2(Math.max(mirrorTexels, 1e-3))));
    pass.set({
      size: frameSize,
      tanHalf,
      time,
      dofLod,
      reflLod,
      camPos: camera.pos,
      camRight: camera.right,
      camUp: camera.up,
      camFwd: camera.fwd,
      qDiag: [q[0], q[1], q[2]],
      qOff: [q[3], q[4], q[5]],
      c0: [c[0], c[1], c[2], c[3]],
      c1: [c[4], c[5], c[6]],
      c2: [c[7], c[8], c[9]],
      b: [c[10], c[11], c[12]],
      rip0: ripples.src[0],
      rip1: ripples.src[1],
      rip2: ripples.src[2],
      rip3: ripples.src[3],
      ripAmp: ripples.amp,
      fade,
    });
    frame.pass(scene, pass);

    const [gw, gh] = glowA.size;
    bright.set({ scene });
    frame.pass(glowA, bright);
    blur.set({ src: glowA, step: [1.5 / gw, 0] });
    frame.pass(glowB, blur);
    blur.set({ src: glowB, step: [0, 1.5 / gh] });
    frame.pass(glowA, blur);

    composite.set({ scene, glow: glowA });
    frame.pass(surface, composite);
  };
};
