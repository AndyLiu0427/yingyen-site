import { sampler } from "vgpu";
import type { Effect, Gpu } from "vgpu";

/**
 * Photographed surroundings for a sketch: Poly Haven HDRIs (CC0), each
 * exposed to the same key so the camera does not have to adjust between them,
 * stored log-encoded so eight bits carry seventeen stops. A shader gets two of
 * them and a crossfade; the sketch asks for the next one and this does the
 * fetching, the mip levels and the fade.
 */

/** How the photographs were packed: v = log2(1 + L * K) / M. */
const ENV_K = 32;
const ENV_M = 17;

export type Scene = { url: string; yaw: number };

/** yaw turns the photograph so the part worth looking at is behind the subject. */
export const SCENES: Scene[] = [
  { url: "/env/road.webp", yaw: 0 }, // rural_asphalt_road
  { url: "/env/city.webp", yaw: 0.08 }, // shanghai_bund, at night
  { url: "/env/studio.webp", yaw: 0.2 }, // studio_small_09, facing the softboxes
  { url: "/env/dawn.webp", yaw: 0 }, // kiara_1_dawn
];
const FADE_SECONDS = 0.8;
const MIPS = 7;

/** Bindings 1 to 4 of group 0, plus envColor(direction, lod). */
export const PHOTO_WGSL = /* wgsl */ `
struct Photo {
  yawA: f32,
  yawB: f32,
  fade: f32,
}
@group(0) @binding(1) var envA: texture_2d<f32>;
@group(0) @binding(2) var envB: texture_2d<f32>;
@group(0) @binding(3) var envSampler: sampler;
@group(0) @binding(4) var<uniform> photo: Photo;

const ENV_K = ${ENV_K}.0;
const ENV_M = ${ENV_M}.0;

/** One photograph, looked up by direction and unpacked from its log encoding. */
fn lookup(tex: texture_2d<f32>, d: vec3f, lod: f32, yaw: f32) -> vec3f {
  let u = 0.5 + atan2(d.x, -d.z) / 6.2831853 + yaw;
  let v = 0.5 - asin(clamp(d.y, -1.0, 1.0)) / 3.1415927;
  var packed = textureSampleLevel(tex, envSampler, vec2f(u, v), lod).rgb;
  if (lod > 2.5) {
    // A coarse level blown up bilinearly shows its texels as squares. Four
    // extra taps half a texel out round them off into a proper blur.
    let texel = exp2(floor(lod)) * 0.5 / vec2f(textureDimensions(tex));
    packed = (packed * 2.0
      + textureSampleLevel(tex, envSampler, vec2f(u, v) + texel, lod).rgb
      + textureSampleLevel(tex, envSampler, vec2f(u, v) - texel, lod).rgb
      + textureSampleLevel(tex, envSampler, vec2f(u, v) + vec2f(texel.x, -texel.y), lod).rgb
      + textureSampleLevel(tex, envSampler, vec2f(u, v) - vec2f(texel.x, -texel.y), lod).rgb) / 6.0;
  }
  return (exp2(packed * ENV_M) - 1.0) / ENV_K;
}

/** The world around the subject; two worlds while one is fading into the next. */
fn envColor(d: vec3f, lod: f32) -> vec3f {
  let a = lookup(envA, d, lod, photo.yawA);
  if (photo.fade <= 0.0) { return a; }
  return mix(a, lookup(envB, d, lod, photo.yawB), photo.fade);
}
`;

type Photo = { texture: GPUTexture; width: number };

export type PhotoScenes = {
  /** Width in texels of the photograph on show; 1 until the first one lands. */
  readonly width: number;
  /** Start fading to the next scene. Ignored while a fade is running. */
  next(): void;
  /** Advance the fade; call once per frame before drawing. */
  frame(time: number): void;
};

function envTexture(device: GPUDevice, width: number, height: number, mips = 1) {
  return device.createTexture({
    label: "photo-scene",
    size: [width, height],
    mipLevelCount: mips,
    format: "rgba8unorm",
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  });
}

export function photoScenes(
  gpu: Gpu,
  pass: Effect,
  onCleanup: (fn: () => void) => void,
  scenes: Scene[] = SCENES,
  first = 0,
  /** Seconds between automatic changes; 0 leaves it to clicks alone. */
  autoSeconds = 0,
): PhotoScenes {
  const device = gpu.device.gpu;
  // Mid grey, so the first frames are a subject in fog rather than a subject
  // in a void, and the first photo fades in from it. In the log encoding an
  // 18 percent grey is byte 41; a byte of 128 would decode to blinding white.
  const grey = envTexture(device, 1, 1);
  device.queue.writeTexture({ texture: grey }, new Uint8Array([41, 41, 41, 255]), {}, [1, 1]);
  pass.set({
    envA: grey,
    envB: grey,
    envSampler: sampler(gpu, {
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
      addressModeU: "repeat",
      addressModeV: "clamp-to-edge",
    }),
    yawA: 0,
    yawB: 0,
    fade: 0,
  });

  let disposed = false;
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
      const blob = await (await fetch(scenes[index].url)).blob();
      const options: ImageBitmapOptions = {
        colorSpaceConversion: "none",
        premultiplyAlpha: "none",
        resizeQuality: "high",
      };
      let level = await createImageBitmap(blob, options);
      const { width, height } = level;
      // Mip levels are what a background blur samples. WebGPU does not build
      // them, so the photo is halved and halved again, off the main thread,
      // and each half is copied into its level.
      const texture = envTexture(device, width, height, MIPS);
      for (let i = 0; i < MIPS; i++) {
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

  // A is what is shown; B is what it is fading into, if anything.
  let current = first;
  let incoming: number | null = null;
  let fadeStart = -1;
  let width = 1;
  // -1 until the first frame: the clock may not start at zero, and the wait
  // for the first photo must not count as time to move on.
  let settledAt = -1;

  const fadeTo = (index: number) => {
    void photo(index).then((loaded) => {
      if (disposed || incoming !== null) return;
      pass.set({ envB: loaded.texture, yawB: scenes[index].yaw });
      incoming = index;
      // Uploading a 4k photo stalls the loop for a moment, so the clock is
      // read on the first frame that draws the fade, not here, or it would
      // start part way in.
      fadeStart = -1;
    });
  };
  fadeTo(first);

  return {
    get width() {
      return width;
    },
    next() {
      if (incoming !== null) return;
      fadeTo((current + 1) % scenes.length);
    },
    frame(time) {
      if (settledAt < 0) settledAt = time;
      if (incoming === null) {
        // Left alone, the world moves on by itself.
        if (autoSeconds > 0 && time - settledAt > autoSeconds) this.next();
        return;
      }
      if (fadeStart < 0) fadeStart = time;
      const fade = Math.min(1, (time - fadeStart) / FADE_SECONDS);
      if (fade < 1) {
        pass.set({ fade });
        return;
      }
      current = incoming;
      incoming = null;
      settledAt = time;
      const done = ready.get(current);
      if (done) {
        width = done.width;
        pass.set({ envA: done.texture, yawA: scenes[current].yaw });
      }
      pass.set({ fade: 0 });
    },
  };
}
