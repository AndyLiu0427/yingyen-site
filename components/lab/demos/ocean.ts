import {
  BackSide,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  SphereGeometry,
} from "three/webgpu";
import {
  cameraPosition,
  cos,
  float,
  length,
  mix,
  mx_fractal_noise_float,
  normalize,
  positionLocal,
  pow,
  reflect,
  saturate,
  sin,
  smoothstep,
  time,
  varying,
  vec2,
  vec3,
} from "three/tsl";
import type Node from "three/src/nodes/core/Node.js";
import type { ThreeSetup } from "../useThreeCanvas";

type Vec3Node = Node<"vec3">;
type FloatNode = Node<"float">;

const GRAVITY = 9.81;

/** Direction the light comes from, low and ahead of the camera for glitter. */
const SUN = (() => {
  const [x, y, z] = [-0.34, 0.15, -0.93];
  const l = Math.hypot(x, y, z);
  return { x: x / l, y: y / l, z: z / l };
})();

/**
 * A rough wind spectrum: two swells, three mid waves, four bands of chop.
 *
 * `steepness` rolls off with wavelength on purpose. Full choppiness on the long
 * swell is what gives the sharp crests; the same value on the short waves
 * pinches the ripples into visible spikes.
 */
const WAVES = [
  { angle: 18, length: 90, amplitude: 2.2, steepness: 0.9 },
  { angle: -12, length: 62, amplitude: 1.5, steepness: 0.88 },
  { angle: 41, length: 34, amplitude: 0.75, steepness: 0.82 },
  { angle: -33, length: 21, amplitude: 0.42, steepness: 0.75 },
  { angle: 62, length: 14, amplitude: 0.24, steepness: 0.68 },
  { angle: -57, length: 9, amplitude: 0.13, steepness: 0.6 },
  { angle: 8, length: 6.5, amplitude: 0.08, steepness: 0.52 },
  { angle: -74, length: 4.5, amplitude: 0.05, steepness: 0.45 },
  { angle: 29, length: 3.2, amplitude: 0.03, steepness: 0.4 },
] as const;

type Surface = {
  offset: Vec3Node;
  normal: Vec3Node;
  /** Determinant of the horizontal displacement Jacobian. Below 1 the surface
   *  is compressing; near zero it is folding over, which is where foam is. */
  fold: FloatNode;
  height: FloatNode;
};

/**
 * Sum of Gerstner (trochoidal) waves.
 *
 * A sine wave only moves the surface up and down, which is why a sum of sines
 * reads as wobbling rather than water. A Gerstner wave also moves each point
 * horizontally, against the direction of travel at the crest, so the water
 * piles up into a sharp peak and spreads into a wide flat trough. Every
 * derivative here is closed form (Finch, GPU Gems 1, chapter 1), so the normal
 * and the fold term are exact rather than sampled.
 */
function gerstner(ground: Node<"vec2">): Surface {
  let dispX: FloatNode = float(0);
  let dispY: FloatNode = float(0);
  let dispZ: FloatNode = float(0);
  let slopeX: FloatNode = float(0);
  let slopeY: FloatNode = float(0);
  let slopeZ: FloatNode = float(0);
  let foldX: FloatNode = float(0);
  let foldZ: FloatNode = float(0);
  let foldXZ: FloatNode = float(0);

  for (const wave of WAVES) {
    const radians = (wave.angle * Math.PI) / 180;
    const dx = Math.cos(radians);
    const dz = Math.sin(radians);
    const w = (2 * Math.PI) / wave.length;
    // Deep water dispersion: long waves genuinely travel faster than short
    // ones, and matching that is most of why the surface stops looking looped.
    const omega = Math.sqrt(GRAVITY * w);
    const steep = wave.steepness;
    const amp = wave.amplitude;
    const wa = w * amp;

    const phase = ground.x
      .mul(dx * w)
      .add(ground.y.mul(dz * w))
      .add(time.mul(omega));
    const s = sin(phase);
    const c = cos(phase);

    dispX = dispX.add(c.mul(steep * amp * dx));
    dispZ = dispZ.add(c.mul(steep * amp * dz));
    dispY = dispY.add(s.mul(amp));

    slopeX = slopeX.add(c.mul(dx * wa));
    slopeZ = slopeZ.add(c.mul(dz * wa));
    slopeY = slopeY.add(s.mul(steep * wa));

    foldX = foldX.add(s.mul(steep * wa * dx * dx));
    foldZ = foldZ.add(s.mul(steep * wa * dz * dz));
    foldXZ = foldXZ.add(s.mul(steep * wa * dx * dz));
  }

  const jxx = float(1).sub(foldX);
  const jzz = float(1).sub(foldZ);

  return {
    offset: vec3(dispX, dispY, dispZ),
    normal: normalize(vec3(slopeX.negate(), float(1).sub(slopeY), slopeZ.negate())),
    fold: jxx.mul(jzz).sub(foldXZ.mul(foldXZ)),
    height: dispY,
  };
}

/**
 * The vertical part of the same wave sum, on the CPU.
 *
 * The camera has to ride the swell rather than sit at a fixed height, or a
 * crest simply swallows it: the amplitudes here add up to more than five units
 * and an eye at two is underwater half the time. This duplicates the shader,
 * which is the usual price of buoyancy without reading the GPU back; the wave
 * table above stays the single source of truth for both.
 */
function surfaceHeight(x: number, z: number, t: number) {
  let height = 0;
  for (const wave of WAVES) {
    const radians = (wave.angle * Math.PI) / 180;
    const w = (2 * Math.PI) / wave.length;
    const omega = Math.sqrt(GRAVITY * w);
    height +=
      wave.amplitude *
      Math.sin(Math.cos(radians) * w * x + Math.sin(radians) * w * z + omega * t);
  }
  return height;
}

/** Analytic sky: haze at the horizon, deep blue overhead, a sun with a halo. */
function skyColor(direction: Vec3Node) {
  const up = saturate(direction.y);
  const sky = mix(
    vec3(0.66, 0.74, 0.83),
    vec3(0.12, 0.3, 0.6),
    pow(up, 0.52),
  );
  const toSun = saturate(direction.dot(vec3(SUN.x, SUN.y, SUN.z)));
  const disc = pow(toSun, 2400).mul(14);
  const halo = pow(toSun, 40).mul(0.22).add(pow(toSun, 6).mul(0.035));
  return sky.add(vec3(1.0, 0.9, 0.76).mul(disc.add(halo)));
}

export const ocean: ThreeSetup = ({ scene, camera, onCleanup, reducedMotion }) => {
  camera.far = 5000;
  camera.updateProjectionMatrix();

  // --- sky dome, also the source of every reflection below
  const skyGeometry = new SphereGeometry(2400, 32, 16);
  const skyMaterial = new MeshBasicNodeMaterial();
  skyMaterial.side = BackSide;
  skyMaterial.depthWrite = false;
  // On a unit sphere the local position is the view direction.
  skyMaterial.colorNode = skyColor(normalize(positionLocal));
  const sky = new Mesh(skyGeometry, skyMaterial);
  sky.renderOrder = -1;
  scene.add(sky);

  // --- water
  const geometry = new PlaneGeometry(300, 300, 512, 512);
  // Pre-rotated so the shader can work in xz/y and never think about the
  // mesh transform. The mesh sits at the origin, so local space is world space.
  geometry.rotateX(-Math.PI / 2);

  const material = new MeshBasicNodeMaterial();
  const surface = gerstner(vec2(positionLocal.x, positionLocal.z));
  const displaced = positionLocal.add(surface.offset);

  material.positionNode = displaced;

  const worldPosition = varying(displaced);
  const waveNormal = varying(surface.normal);
  const fold = varying(surface.fold);
  const height = varying(surface.height);

  material.colorNode = (() => {
    // Ripples too small to spend vertices on, added straight to the normal.
    const ripple = vec2(worldPosition.x, worldPosition.z).mul(0.9);
    const scroll = time.mul(0.35);
    const detailX = mx_fractal_noise_float(
      vec3(ripple.x.add(scroll), ripple.y, 0.0),
      3,
      2,
      0.5,
      1,
    );
    const detailZ = mx_fractal_noise_float(
      vec3(ripple.x, ripple.y.sub(scroll), 11.0),
      3,
      2,
      0.5,
      1,
    );
    const normal = normalize(
      waveNormal.add(vec3(detailX.mul(0.09), 0.0, detailZ.mul(0.09))),
    );

    const toCamera = cameraPosition.sub(worldPosition);
    const distance = length(toCamera);
    const view = toCamera.div(distance);
    const sun = vec3(SUN.x, SUN.y, SUN.z);

    // Schlick against water's real index of refraction: 2% straight on,
    // almost a mirror at grazing angles. This single term is most of the look.
    const facing = saturate(normal.dot(view));
    const fresnel = float(0.02).add(pow(facing.oneMinus(), 5).mul(0.98));

    const reflected = skyColor(reflect(view.negate(), normal));

    // What comes back out of the water: dark absorbed blue, lifting where the
    // surface tilts up toward the sky.
    const body = vec3(0.006, 0.058, 0.112).mul(saturate(normal.y).mul(0.6).add(0.4));

    // Light that entered the back of a crest and left toward the eye. It only
    // shows when the sun is behind the wave, and only near the top of it.
    const through = pow(saturate(view.dot(sun.negate())), 3.5);
    const lift = saturate(height.mul(0.42).add(0.15));
    const scatter = vec3(0.06, 0.36, 0.33).mul(through.mul(lift).mul(1.5));

    // Sun glitter. The high exponent is the point: a broad highlight reads as
    // plastic, a tight one that breaks up across the chop reads as water.
    const halfway = normalize(view.add(sun));
    const glitter = vec3(1.0, 0.93, 0.8).mul(
      pow(saturate(normal.dot(halfway)), 900).mul(fresnel).mul(26),
    );

    let color: Vec3Node = mix(body.add(scatter), reflected, fresnel).add(glitter);

    // Foam where the horizontal displacement folds the surface over itself.
    // Threshold on the Jacobian rather than on height: a tall smooth swell has
    // no foam, a small breaking crest does.
    const foamNoise = mx_fractal_noise_float(
      vec3(worldPosition.x.mul(2.2), worldPosition.z.mul(2.2), time.mul(0.4)),
      3,
      2,
      0.5,
      1,
    )
      .mul(0.5)
      .add(0.5);
    const foam = smoothstep(0.4, 0.04, fold).mul(foamNoise.mul(0.85).add(0.15));
    color = mix(color, vec3(0.86, 0.91, 0.94), saturate(foam));

    // Fade into the sky well before the geometry runs out, so the plane edge
    // is never the horizon.
    const haze = smoothstep(28.0, 125.0, distance);
    return mix(color, skyColor(view.negate()), haze);
  })();

  const water = new Mesh(geometry, material);
  scene.add(water);

  onCleanup(() => {
    geometry.dispose();
    material.dispose();
    skyGeometry.dispose();
    skyMaterial.dispose();
  });

  const EYE_ABOVE_SURFACE = 2.7;

  return (elapsed) => {
    const t = reducedMotion ? 0 : elapsed;
    // A slow wander, so the view is never the same two swells twice.
    const x = Math.sin(t * 0.05) * 3.2;
    const z = Math.cos(t * 0.037) * 3.2;
    const y = surfaceHeight(x, z, t) + EYE_ABOVE_SURFACE;
    const yaw = Math.sin(t * 0.031) * 0.26;

    camera.position.set(x, y, z);
    camera.lookAt(
      x + Math.sin(yaw) * 40,
      y - 2.2,
      z - Math.cos(yaw) * 40,
    );
  };
};
