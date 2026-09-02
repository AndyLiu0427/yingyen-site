import {
  HalfFloatType,
  LinearFilter,
  RepeatWrapping,
  RGBAFormat,
  StorageTexture,
} from "three/webgpu";
import type { ComputeNode, WebGPURenderer } from "three/webgpu";
import {
  attributeArray,
  cos,
  float,
  Fn,
  instanceIndex,
  sin,
  smoothstep,
  textureStore,
  uint,
  uniform,
  uvec2,
  vec2,
  vec4,
} from "three/tsl";
import type Node from "three/src/nodes/core/Node.js";
import type StorageBufferNode from "three/src/nodes/accessors/StorageBufferNode.js";

/** attributeArray is overloaded; ReturnType picks the float form. */
type Vec4Buffer = StorageBufferNode<"vec4">;

type Vec2Node = Node<"vec2">;

const GRAVITY = 9.81;

/** Choppiness is at full strength below the first wavenumber, gone above the
 *  second. Long swell gets sharp crests; ripples are left round. */
const CHOP_ROLLOFF_START = 0.35;
const CHOP_ROLLOFF_END = 4.5;

/** Complex multiply. */
const cmul = (a: Vec2Node, b: Vec2Node) =>
  vec2(a.x.mul(b.x).sub(a.y.mul(b.y)), a.x.mul(b.y).add(a.y.mul(b.x)));

/**
 * Butterfly table for a radix-2 Stockham inverse FFT.
 *
 * Each row is one output slot of one step: the twiddle factor plus the two
 * input indices that feed it. Precomputing this on the CPU is what keeps the
 * GPU kernel down to two loads, a complex multiply and an add.
 *
 * The index layout follows gasgiant/FFT-Ocean (MIT), by way of the same table
 * in owenyuwono/poseidon (MIT). Twiddles are stored forward; the kernels
 * conjugate them to run the transform backwards.
 */
function butterflyTable(size: number) {
  const steps = Math.log2(size);
  const table = new Float32Array(steps * size * 4);

  for (let step = 0; step < steps; step++) {
    const span = size >> (step + 1);
    for (let j = 0; j < size / 2; j++) {
      const group = Math.floor(j / span);
      const inputA = (2 * span * group + (j % span)) % size;
      const angle = (2 * Math.PI * group * span) / size;
      const re = Math.cos(angle);
      const im = -Math.sin(angle);

      const write = (slot: number, r: number, i: number) => {
        const at = (step * size + slot) * 4;
        table[at] = r;
        table[at + 1] = i;
        table[at + 2] = inputA;
        table[at + 3] = inputA + span;
      };
      write(j, re, im);
      write(j + size / 2, -re, -im);
    }
  }

  return table;
}

/** What Fn(...)().compute(n) produces, ready for renderer.compute(). */
type Kernel = ComputeNode;

/**
 * Inverse FFT over a stack of independent N x N planes held in one buffer.
 *
 * Every element is a vec4, which the butterfly treats as two independent
 * complex numbers. Two real output fields can be packed into one complex
 * channel (real part carries one, imaginary the other) as long as both
 * spectra are Hermitian, so a single vec4 pass transports four real fields
 * for the price of one.
 *
 * WebGPU gives no memory barrier between dispatches inside a pass, so each
 * step has to be its own `renderer.compute()`. Stacking every cascade into one
 * buffer is what keeps that count at 2*log2(N)+1 for the whole ocean rather
 * than per cascade.
 */
class InverseFFT {
  readonly steps: number;
  private readonly table: Vec4Buffer;
  private readonly horizontal: Kernel[] = [];
  private readonly vertical: Kernel[] = [];
  private readonly sign: Kernel;

  constructor(
    private readonly size: number,
    planes: number,
    field: Vec4Buffer,
    scratch: Vec4Buffer,
  ) {
    this.steps = Math.log2(size);
    this.table = attributeArray(butterflyTable(size), "vec4");

    const total = planes * size * size;
    // Parity runs across both phases as one chain of 2*log2(N) swaps. Keeping
    // a separate counter per phase only lands back in `field` when log2(N) is
    // even, which silently feeds the vertical phase stale data at other sizes.
    let chain = 0;
    for (let step = 0; step < this.steps; step++) {
      this.horizontal.push(this.pass(step, chain++, field, scratch, total, true));
    }
    for (let step = 0; step < this.steps; step++) {
      this.vertical.push(this.pass(step, chain++, field, scratch, total, false));
    }

    // The spectrum is stored centred on DC, so the transform comes out shifted
    // by half a period in both axes. Multiplying by (-1)^(x+y) puts it back.
    this.sign = Fn(() => {
      const cell = instanceIndex.mod(uint(size * size));
      const x = cell.mod(uint(size));
      const y = cell.div(uint(size));
      const flip = float(1).sub(float(x.add(y).mod(uint(2))).mul(2));
      field.element(instanceIndex).assign(field.element(instanceIndex).mul(vec4(flip)));
    })().compute(total) as Kernel;
  }

  private pass(
    step: number,
    chain: number,
    field: Vec4Buffer,
    scratch: Vec4Buffer,
    total: number,
    alongX: boolean,
  ) {
    const size = this.size;
    // 2*log2(N) swaps is always even, so the last write always lands in field.
    const source = chain % 2 === 0 ? field : scratch;
    const target = chain % 2 === 0 ? scratch : field;
    const table = this.table;

    return Fn(() => {
      const plane = instanceIndex.div(uint(size * size));
      const base = plane.mul(uint(size * size));
      const cell = instanceIndex.mod(uint(size * size));
      const x = cell.mod(uint(size));
      const y = cell.div(uint(size));

      const entry = table.element(uint(step * size).add(alongX ? x : y));
      // Conjugating the forward twiddle is what makes this the inverse.
      const twiddle = vec2(entry.x, entry.y.negate());
      const indexA = uint(entry.z);
      const indexB = uint(entry.w);

      const offsetA = alongX ? y.mul(size).add(indexA) : indexA.mul(size).add(x);
      const offsetB = alongX ? y.mul(size).add(indexB) : indexB.mul(size).add(x);
      const a = source.element(base.add(offsetA));
      const b = source.element(base.add(offsetB));

      const lo = a.xy.add(cmul(twiddle, b.xy));
      const hi = a.zw.add(cmul(twiddle, b.zw));
      target.element(instanceIndex).assign(vec4(lo.x, lo.y, hi.x, hi.y));
    })().compute(total) as Kernel;
  }

  run(renderer: WebGPURenderer) {
    for (const kernel of this.horizontal) renderer.compute(kernel);
    for (const kernel of this.vertical) renderer.compute(kernel);
    renderer.compute(this.sign);
  }
}

/**
 * Proves the transform against results that can be worked out by hand, once at
 * startup. An FFT that is subtly wrong still produces plausible looking waves,
 * which is the worst possible failure mode to debug through a shader.
 */
export async function validateInverseFFT(
  renderer: WebGPURenderer,
  size = 32,
): Promise<{ pass: boolean; dcError: number; toneError: number }> {
  const run = async (fill: (data: Float32Array) => void) => {
    const field = attributeArray(size * size, "vec4");
    const scratch = attributeArray(size * size, "vec4");
    const fft = new InverseFFT(size, 1, field, scratch);
    const array = field.value.array as Float32Array;
    array.fill(0);
    fill(array);
    field.value.needsUpdate = true;
    fft.run(renderer);
    return new Float32Array(await renderer.getArrayBufferAsync(field.value));
  };

  // A single unit at centred DC must transform to a constant 1 everywhere.
  const dc = await run((data) => {
    data[((size / 2) * size + size / 2) * 4] = 1;
  });
  let dcError = 0;
  for (let i = 0; i < size * size; i++) {
    dcError = Math.max(dcError, Math.abs(dc[i * 4] - 1), Math.abs(dc[i * 4 + 1]));
  }

  // One step off DC in x must give a single cosine across the row.
  const tone = await run((data) => {
    data[((size / 2) * size + size / 2 + 1) * 4] = 1;
  });
  let toneError = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const at = (y * size + x) * 4;
      toneError = Math.max(
        toneError,
        Math.abs(tone[at] - Math.cos((2 * Math.PI * x) / size)),
        Math.abs(tone[at + 1] - Math.sin((2 * Math.PI * x) / size)),
      );
    }
  }

  return { pass: dcError < 1e-3 && toneError < 1e-3, dcError, toneError };
}

export type Cascade = {
  /** Metres across one wrap of this tile. */
  tile: number;
  /** Multiplies the whole spectrum for this band. */
  gain: number;
};

export type OceanOptions = {
  size?: number;
  windSpeed?: number;
  windAngle?: number;
  /** 0 lets waves run against the wind, 1 forbids it. */
  alignment?: number;
  cascades?: Cascade[];
  choppiness?: number;
  waveHeight?: number;
};

const DEFAULTS = {
  size: 256,
  windSpeed: 11,
  windAngle: 28,
  alignment: 0.85,
  choppiness: 1.75,
  // Three disjoint bands. Each tile resolves wavenumbers from 2*pi/tile up to
  // the next tile's floor, and the sizes share no common factor so the three
  // never line up into a findable repeat.
  // Three disjoint bands, sized so the longest wave is one the scene can
  // actually show and the shortest lands near the aliasing cutoff. Energy in a
  // Phillips band falls roughly as 1/k^2, so the gains are what stop the top
  // band from swallowing the other two: without them the sea is nothing but
  // enormous smooth dunes.
  cascades: [
    { tile: 173, gain: 1 },
    { tile: 39.1, gain: 1.5 },
    { tile: 7.7, gain: 4.2 },
  ] as Cascade[],
  /** Significant wave height in metres, the sea state you actually want. */
  waveHeight: 3.1,
};

/** Box-Muller, so the spectrum gets genuine Gaussian amplitudes. */
function gaussianPair(): [number, number] {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const radius = Math.sqrt(-2 * Math.log(u));
  return [radius * Math.cos(2 * Math.PI * v), radius * Math.sin(2 * Math.PI * v)];
}

/**
 * Tessendorf's ocean: a Phillips spectrum evolved in the frequency domain and
 * inverse transformed to a height field every frame.
 *
 * Two cascades cover disjoint wavenumber bands. One tile alone repeats
 * visibly the moment the camera can see more than a couple of wraps; two tiles
 * whose sizes share no common factor beat against each other and the repeat
 * stops being findable.
 */
export class OceanSimulation {
  readonly size: number;
  readonly cascades: Cascade[];
  readonly displacement: StorageTexture[];
  readonly choppiness: number;

  private readonly field: Vec4Buffer;
  private readonly scratch: Vec4Buffer;
  private readonly spectrum: Vec4Buffer;
  private readonly fft: InverseFFT;
  private readonly time = uniform(0);
  private readonly evolve: Kernel;
  private readonly unpack: Kernel[];

  constructor(options: OceanOptions = {}) {
    const settings = { ...DEFAULTS, ...options };
    const size = settings.size;
    const cascades = settings.cascades;

    this.size = size;
    this.cascades = cascades;
    this.choppiness = settings.choppiness;

    const planes = cascades.length;
    const cells = size * size;

    this.spectrum = attributeArray(
      this.buildSpectrum(size, cascades, settings),
      "vec4",
    );
    this.field = attributeArray(planes * cells, "vec4");
    this.scratch = attributeArray(planes * cells, "vec4");
    this.fft = new InverseFFT(size, planes, this.field, this.scratch);

    this.displacement = cascades.map(() => {
      const texture = new StorageTexture(size, size);
      texture.type = HalfFloatType;
      texture.format = RGBAFormat;
      // The tile is sampled by world position and has to repeat; half float so
      // the sampler can filter it, which rgba32float cannot on WebGPU.
      texture.wrapS = RepeatWrapping;
      texture.wrapT = RepeatWrapping;
      texture.magFilter = LinearFilter;
      texture.minFilter = LinearFilter;
      texture.generateMipmaps = false;
      return texture;
    });

    this.evolve = this.buildEvolve(size, cascades);
    this.unpack = cascades.map((_, index) => this.buildUnpack(size, index));
  }

  /**
   * h0(k), the sea state at t = 0, built once on the CPU.
   *
   * Phillips gives the energy at each wavenumber for a given wind; multiplying
   * by a complex Gaussian is what turns a smooth energy curve into an actual
   * random sea. Both h0(k) and the conjugate of h0(-k) are stored, because the
   * per-frame evolution needs the pair to keep the spectrum Hermitian, and a
   * spectrum that is not Hermitian transforms to a complex height field.
   */
  private buildSpectrum(
    size: number,
    cascades: Cascade[],
    settings: typeof DEFAULTS,
  ) {
    const data = new Float32Array(cascades.length * size * size * 4);
    const windRadians = (settings.windAngle * Math.PI) / 180;
    const windX = Math.cos(windRadians);
    const windZ = Math.sin(windRadians);
    // The longest wave the wind can raise.
    const fetch = (settings.windSpeed * settings.windSpeed) / GRAVITY;
    // Softens the last octave before Nyquist so the smallest waves fade out
    // instead of aliasing. Set anywhere near a metre and it erases the whole
    // fine cascade, whose waves are all shorter than that.
    const smallest = 0.028;

    const phillips = (kx: number, kz: number) => {
      const kSq = kx * kx + kz * kz;
      if (kSq < 1e-9) return 0;
      const k = Math.sqrt(kSq);
      const alignment = (kx / k) * windX + (kz / k) * windZ;
      // |k.w|^2 is symmetric, so waves would run upwind as readily as down.
      // Damping the upwind half is what gives the sea a direction.
      let directional = alignment * alignment;
      if (alignment < 0) directional *= 1 - settings.alignment;
      return (
        (0.0002 *
          Math.exp(-1 / (kSq * fetch * fetch)) *
          directional *
          Math.exp(-kSq * smallest * smallest)) /
        (kSq * kSq)
      );
    };

    let variance = 0;

    cascades.forEach((cascade, plane) => {
      // Disjoint bands: this cascade stops where the next one starts, so the
      // two never carry the same wave twice.
      const next = cascades[plane + 1];
      const low = plane === 0 ? 0 : (2 * Math.PI) / cascade.tile;
      const high = next ? (2 * Math.PI) / next.tile : Number.POSITIVE_INFINITY;
      const base = plane * size * size * 4;

      for (let n = 0; n < size; n++) {
        for (let m = 0; m < size; m++) {
          const kx = (2 * Math.PI * (m - size / 2)) / cascade.tile;
          const kz = (2 * Math.PI * (n - size / 2)) / cascade.tile;
          const k = Math.hypot(kx, kz);
          const at = base + (n * size + m) * 4;

          if (k < low || k >= high) continue;

          const [a, b] = gaussianPair();
          const [c, d] = gaussianPair();
          const amp = Math.sqrt(phillips(kx, kz) / 2) * cascade.gain;
          const conj = Math.sqrt(phillips(-kx, -kz) / 2) * cascade.gain;

          data[at] = a * amp;
          data[at + 1] = b * amp;
          // Already conjugated here so the kernel does not have to.
          data[at + 2] = c * conj;
          data[at + 3] = -d * conj;

          for (let i = 0; i < 4; i++) variance += data[at + i] * data[at + i];
        }
      }
    });

    // The transform is the raw synthesis sum with no 1/N^2, so the Phillips
    // constant alone says nothing about how tall the result will be. Parseval
    // does: the variance of the height field is the sum of the squared
    // spectrum, so scaling by the ratio of target to actual RMS gives a sea of
    // exactly the significant wave height asked for.
    const rms = Math.sqrt(variance);
    if (rms > 0) {
      const target = settings.waveHeight / 4;
      const scale = target / rms;
      for (let i = 0; i < data.length; i++) data[i] *= scale;
    }

    return data;
  }

  /**
   * Marches the spectrum to time t and packs four real fields into two complex
   * channels: height with x displacement, z displacement with the spare.
   */
  private buildEvolve(size: number, cascades: Cascade[]) {
    const spectrum = this.spectrum;
    const field = this.field;
    const time = this.time;
    const choppiness = this.choppiness;
    const tiles = cascades.map((cascade) => cascade.tile);

    return Fn(() => {
      const plane = instanceIndex.div(uint(size * size));
      const cell = instanceIndex.mod(uint(size * size));
      const m = cell.mod(uint(size));
      const n = cell.div(uint(size));

      // A per-plane tile size without a branch: index into a constant.
      let tile: Node<"float"> = float(tiles[0]);
      for (let i = 1; i < tiles.length; i++) {
        const isPlane = float(plane.equal(uint(i)));
        tile = tile.mul(isPlane.oneMinus()).add(float(tiles[i]).mul(isPlane));
      }

      const half = float(size / 2);
      const scale = float(2 * Math.PI).div(tile);
      const kx = float(m).sub(half).mul(scale);
      const kz = float(n).sub(half).mul(scale);
      const k = kx.mul(kx).add(kz.mul(kz)).sqrt().max(1e-6);

      // Deep water dispersion. Long waves outrun short ones, and that spread
      // is most of why a real sea never looks like it is on a loop.
      const omega = k.mul(GRAVITY).sqrt().mul(time);
      const rotate = vec2(cos(omega), sin(omega));

      const seed = spectrum.element(instanceIndex);
      const forward = cmul(seed.xy, rotate);
      const backward = cmul(seed.zw, vec2(rotate.x, rotate.y.negate()));
      const height = forward.add(backward);

      // Horizontal displacement is the height spectrum turned a quarter turn
      // and scaled by the unit wavevector. It is what sharpens the crests, and
      // it has to roll off with wavenumber: at full strength on metre-long
      // ripples it pinches them into spikes rather than sharpening anything.
      const chop = smoothstep(
        float(CHOP_ROLLOFF_END),
        float(CHOP_ROLLOFF_START),
        k,
      ).mul(choppiness);
      const quarterTurn = vec2(height.y, height.x.negate());
      const dx = quarterTurn.mul(kx.div(k).mul(chop));
      const dz = quarterTurn.mul(kz.div(k).mul(chop));

      // Packed: one complex channel carries height and x displacement, the
      // other carries z displacement. Both spectra are Hermitian, so the
      // transform returns them cleanly split across real and imaginary parts.
      field
        .element(instanceIndex)
        .assign(
          vec4(
            height.x.sub(dx.y),
            height.y.add(dx.x),
            dz.x,
            dz.y,
          ),
        );
    })().compute(cascades.length * size * size) as Kernel;
  }

  /** Moves one finished plane out of the buffer and into a sampleable texture. */
  private buildUnpack(size: number, plane: number) {
    const field = this.field;
    const target = this.displacement[plane];

    return Fn(() => {
      const x = instanceIndex.mod(uint(size));
      const y = instanceIndex.div(uint(size));
      const value = field.element(uint(plane * size * size).add(instanceIndex));
      // Real part of channel one is height, imaginary is x displacement; real
      // part of channel two is z displacement.
      textureStore(
        target,
        uvec2(x, y),
        vec4(value.y, value.x, value.z, 0),
      ).toWriteOnly();
    })().compute(size * size) as Kernel;
  }

  step(renderer: WebGPURenderer, elapsed: number) {
    this.time.value = elapsed;
    renderer.compute(this.evolve);
    this.fft.run(renderer);
    for (const kernel of this.unpack) renderer.compute(kernel);
  }

  dispose() {
    for (const texture of this.displacement) texture.dispose();
  }
}
