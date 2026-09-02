import {
  BackSide,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  SphereGeometry,
} from "three/webgpu";
import {
  abs,
  cameraPosition,
  cross,
  float,
  length,
  max,
  mix,
  normalize,
  positionLocal,
  pow,
  reflect,
  saturate,
  smoothstep,
  texture,
  varying,
  vec2,
  vec3,
} from "three/tsl";
import type Node from "three/src/nodes/core/Node.js";
import type { ThreeSetup } from "../useThreeCanvas";
import { OceanSimulation, validateInverseFFT } from "./ocean-sim";
import { transmittance, waterOptics } from "./ocean-optics";

type Vec3Node = Node<"vec3">;
type Vec2Node = Node<"vec2">;
type FloatNode = Node<"float">;

/** Direction the light comes from, low and ahead for a long glitter path. */
const SUN = (() => {
  const [x, y, z] = [-0.3, 0.11, -0.95];
  const l = Math.hypot(x, y, z);
  return { x: x / l, y: y / l, z: z / l };
})();

const SUN_NODE = vec3(SUN.x, SUN.y, SUN.z);

const PLANE_SIZE = 600;
const PLANE_SEGMENTS = 640;
const VERTEX_SPACING = PLANE_SIZE / PLANE_SEGMENTS;
const EYE_HEIGHT = 3.6;
const HAZE_NEAR = 85;
const HAZE_FAR = 300;

/**
 * Roughly how much world a pixel covers per unit of distance, head on. Only
 * the order of magnitude matters; it sets where detail hands over to roughness.
 */
const PIXEL_ANGLE = 0.00085;

/**
 * Milligrams of chlorophyll per cubic metre. Morel tied Jerlov's water types
 * to this one number, so it walks the whole scale: under 0.01 is the clearest
 * mid-ocean blue, 0.5 is Jerlov II, 2 is where the sea turns green.
 */
const CHLOROPHYLL = 0.55;

const OPTICS = waterOptics(CHLOROPHYLL);

/**
 * Reflectance is a fraction of downwelling irradiance; the sky here is a
 * radiance in arbitrary units. One scalar converts between them, and it is the
 * only number in the water colour not derived from the coefficients.
 */
const IRRADIANCE_GAIN = 14;

/** Typical path through a crest for light arriving from behind it, in metres. */
const CREST_PATH = 2.2;

const WATER_BODY = (() => {
  // Downwelling averaged crudely over the hemisphere: the sky a little above
  // halfway up, which is close enough for a term this soft.
  const down = [0.101, 0.219, 0.484];
  return OPTICS.reflectance.map((r, i) => r * down[i] * IRRADIANCE_GAIN);
})();

/**
 * Hue of light that crossed a crest and scattered back out: what survives the
 * path, times what scatters. Red is nearly gone by two metres, which is why a
 * backlit wave glows cyan rather than white.
 */
const CREST_GLOW = (() => {
  const through = transmittance(OPTICS, CREST_PATH);
  const raw = through.map((t, i) => t * OPTICS.backscatter[i]);
  const peak = Math.max(...raw);
  return raw.map((v) => v / peak);
})();

/** Analytic sky: haze at the horizon, deep blue overhead, a sun with a halo. */
function skyColor(direction: Vec3Node) {
  const up = saturate(direction.y);
  const sky = mix(vec3(0.44, 0.58, 0.75), vec3(0.045, 0.16, 0.44), pow(up, 0.42));
  const toSun = saturate(direction.dot(SUN_NODE));
  const disc = pow(toSun, 5000).mul(30);
  const halo = pow(toSun, 120)
    .mul(0.5)
    .add(pow(toSun, 14).mul(0.16))
    .add(pow(toSun, 3).mul(0.04));
  return sky.add(vec3(1.0, 0.9, 0.75).mul(disc.add(halo)));
}

/**
 * GGX, rather than a raised cosine.
 *
 * The long tail is the point. A Blinn-Phong highlight either blooms into a
 * plastic blob at low exponents or shrinks to a hard dot at high ones, while
 * GGX keeps a tight core and a wide skirt, which is what makes sun glitter
 * scatter across chop instead of sitting on top of it.
 */
function ggx(normal: Vec3Node, view: Vec3Node, roughness: FloatNode) {
  const halfway = normalize(view.add(SUN_NODE));
  const cosine = saturate(normal.dot(halfway));
  const alpha = roughness.mul(roughness);
  const a2 = alpha.mul(alpha);
  const d = cosine.mul(cosine).mul(a2.sub(1)).add(1);
  return a2.div(d.mul(d).mul(Math.PI)).min(4000);
}

export const ocean: ThreeSetup = ({
  scene,
  camera,
  renderer,
  onCleanup,
  reducedMotion,
}) => {
  camera.far = 6000;
  camera.updateProjectionMatrix();

  if (process.env.NODE_ENV === "development") {
    // A transform that is subtly wrong still makes plausible looking waves,
    // which is the worst thing to have to debug through a shader.
    void validateInverseFFT(renderer).then((result) => {
      if (!result.pass) console.error("inverse FFT failed", result);
    });
  }

  const sim = new OceanSimulation();
  const bands = sim.cascades.map((cascade, index) => ({
    tile: cascade.tile,
    map: sim.displacement[index],
    texel: cascade.tile / sim.size,
  }));
  const finestTexel = Math.min(...bands.map((band) => band.texel));

  // --- sky dome, also the source of every reflection below
  const skyGeometry = new SphereGeometry(3000, 32, 16);
  const skyMaterial = new MeshBasicNodeMaterial();
  skyMaterial.side = BackSide;
  skyMaterial.depthWrite = false;
  skyMaterial.colorNode = skyColor(normalize(positionLocal));
  const sky = new Mesh(skyGeometry, skyMaterial);
  sky.renderOrder = -1;
  scene.add(sky);

  // --- water
  const geometry = new PlaneGeometry(
    PLANE_SIZE,
    PLANE_SIZE,
    PLANE_SEGMENTS,
    PLANE_SEGMENTS,
  );
  // Pre-rotated so the shader works in xz/y and never thinks about the mesh
  // transform. The mesh sits at the origin, so local space is world space.
  geometry.rotateX(-Math.PI / 2);

  const material = new MeshBasicNodeMaterial();

  /** Every cascade summed at a ground position, as (x, height, z). */
  const displacementAt = (
    ground: Vec2Node,
    weights: FloatNode[],
    lod?: number,
  ) =>
    bands
      .map((band, index) => {
        const sample = texture(band.map, ground.div(band.tile));
        const fetched = lod === undefined ? sample : sample.level(float(lod));
        return fetched.xyz.mul(weights[index]);
      })
      .reduce((total, part) => total.add(part));

  // A cascade finer than the vertex spacing cannot be carried by the grid
  // anywhere, and one finer than the grid at this distance cannot be carried
  // here. Displacing vertices by a signal they cannot represent adds aliasing,
  // not detail, so each band earns its place in the geometry on its own terms.
  const vertexDistance = length(cameraPosition.sub(positionLocal));
  const vertexWeights = bands.map((band) => {
    const carried = Math.min(1, (band.texel * 2.5) / VERTEX_SPACING);
    const reach = 40 + band.tile * 2.2;
    return smoothstep(float(reach * 3), float(reach), vertexDistance).mul(carried);
  });

  const ground = vec2(positionLocal.x, positionLocal.z);
  const displaced = positionLocal.add(displacementAt(ground, vertexWeights, 0));
  material.positionNode = displaced;

  const worldPosition = varying(displaced);

  material.colorNode = (() => {
    const flat = vec2(worldPosition.x, worldPosition.z);

    const toCamera = cameraPosition.sub(worldPosition);
    const distance = length(toCamera);
    const view = toCamera.div(distance);

    // How much world one pixel covers where it lands on the water. A grazing
    // ray stretches that footprint enormously, which is exactly where the
    // sparkle comes from: a fixed sampling step out at the horizon reads far
    // below the pixel and hands back a normal that changes wildly between
    // neighbours.
    const grazing = max(abs(view.y), float(0.04));
    const footprint = distance.mul(PIXEL_ANGLE).div(grazing);

    // Each band survives as far out as its own texels stay above a pixel.
    const bandWeights = bands.map((band) =>
      saturate(float(band.texel * 5).div(footprint)),
    );
    // Differences taken over a pixel, never under the finest texel.
    const step = max(float(finestTexel), footprint);

    // Central differences of the displaced surface. Because the water moves
    // sideways as well as up, the slope of the height alone is not the surface
    // normal: the horizontal terms have to come along.
    const px = displacementAt(flat.add(vec2(step, 0)), bandWeights);
    const nx = displacementAt(flat.sub(vec2(step, 0)), bandWeights);
    const pz = displacementAt(flat.add(vec2(0, step)), bandWeights);
    const nz = displacementAt(flat.sub(vec2(0, step)), bandWeights);

    const inv = float(0.5).div(step);
    const dPdx = vec3(
      px.x.sub(nx.x).mul(inv).add(1),
      px.y.sub(nx.y).mul(inv),
      px.z.sub(nx.z).mul(inv),
    );
    const dPdz = vec3(
      pz.x.sub(nz.x).mul(inv),
      pz.y.sub(nz.y).mul(inv),
      pz.z.sub(nz.z).mul(inv).add(1),
    );

    const normal = normalize(cross(dPdz, dPdx));

    // Schlick against water's real index of refraction: two percent straight
    // on, almost a mirror at grazing angles. This one term is most of the look.
    const facing = saturate(normal.dot(view));
    const fresnel = float(0.02).add(pow(facing.oneMinus(), 5).mul(0.98));

    const reflected = skyColor(reflect(view.negate(), normal));

    // Light that went into the water and came back out. The ratio between
    // these three numbers is measured rather than chosen: water absorbs red
    // about seventy times harder than blue, and that is the whole reason the
    // sea has a colour at all.
    const body = vec3(WATER_BODY[0], WATER_BODY[1], WATER_BODY[2]).mul(
      saturate(normal.y).mul(0.7).add(0.3),
    );

    // Light that crossed the back of a crest and left toward the eye. Only
    // when the sun is behind the wave, and only near the top of one.
    const through = pow(saturate(view.dot(SUN_NODE.negate())), 4.5);
    const lift = saturate(worldPosition.y.mul(0.34).sub(0.12));
    const scatter = vec3(CREST_GLOW[0], CREST_GLOW[1], CREST_GLOW[2]).mul(
      through.mul(lift).mul(0.26),
    );

    // Detail a pixel cannot resolve has not disappeared, it has turned into
    // roughness. Folding it into the highlight instead of dropping it is what
    // stops the far water sparkling like tinsel.
    const finest = bandWeights[bandWeights.length - 1];
    const roughness = float(0.045).add(finest.oneMinus().mul(0.24));
    const glitter = vec3(1.0, 0.94, 0.82).mul(
      ggx(normal, view, roughness).mul(fresnel).mul(1.6),
    );

    let color: Vec3Node = mix(body.add(scatter), reflected, fresnel).add(glitter);

    // Foam where the surface folds over itself. The determinant of the
    // horizontal displacement Jacobian drops below one where water is being
    // compressed and through zero where it is breaking, which is why this
    // catches breaking crests and leaves smooth swell alone.
    const jacobian = dPdx.x.mul(dPdz.z).sub(dPdx.z.mul(dPdz.x));
    const foam = smoothstep(0.72, 0.05, jacobian);
    color = mix(color, vec3(0.88, 0.93, 0.96), saturate(foam));

    // Aerial perspective. Fading into the same sky the reflections come from
    // is what lets the plane end without the horizon ending with it.
    const haze = smoothstep(HAZE_NEAR, HAZE_FAR, distance);
    return mix(color, skyColor(view.negate()), haze);
  })();

  const water = new Mesh(geometry, material);
  // The horizon is haze, not geometry, so nothing may cull the far edge early.
  water.frustumCulled = false;
  scene.add(water);

  onCleanup(() => {
    geometry.dispose();
    material.dispose();
    skyGeometry.dispose();
    skyMaterial.dispose();
    sim.dispose();
  });

  return (elapsed) => {
    const t = reducedMotion ? 12 : elapsed;
    sim.step(renderer, t);

    const bob = reducedMotion
      ? 0
      : Math.sin(t * 0.42) * 0.35 + Math.sin(t * 0.27) * 0.22;
    // The sun sits at this bearing; the sweep swings either side of it so the
    // glitter path stays in shot.
    const sunBearing = Math.atan2(SUN.x, -SUN.z);
    const yaw = sunBearing + Math.sin(t * 0.021) * 0.42;

    camera.position.set(0, EYE_HEIGHT + bob, 0);
    camera.lookAt(
      Math.sin(yaw) * 60,
      EYE_HEIGHT + bob - 2.3,
      -Math.cos(yaw) * 60,
    );
  };
};
