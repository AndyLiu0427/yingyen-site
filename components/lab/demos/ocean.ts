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
  mx_fractal_noise_float,
  normalize,
  positionLocal,
  pow,
  reflect,
  saturate,
  smoothstep,
  texture,
  time,
  varying,
  vec2,
  vec3,
} from "three/tsl";
import type Node from "three/src/nodes/core/Node.js";
import type { ThreeSetup } from "../useThreeCanvas";
import { OceanSimulation, validateInverseFFT } from "./ocean-sim";

type Vec3Node = Node<"vec3">;
type Vec2Node = Node<"vec2">;

/** Direction the light comes from, low and ahead for a long glitter path. */
const SUN = (() => {
  const [x, y, z] = [-0.3, 0.11, -0.95];
  const l = Math.hypot(x, y, z);
  return { x: x / l, y: y / l, z: z / l };
})();

const SUN_NODE = vec3(SUN.x, SUN.y, SUN.z);

const PLANE_SIZE = 600;
const PLANE_SEGMENTS = 640;
const EYE_HEIGHT = 3.6;
const HAZE_NEAR = 85;
const HAZE_FAR = 300;
/**
 * Roughly how much world a pixel covers per unit of distance, head on. Only
 * the order of magnitude matters; it sets where detail hands over to roughness.
 */
const PIXEL_ANGLE = 0.00085;

/** Analytic sky: haze at the horizon, deep blue overhead, a sun with a halo. */
function skyColor(direction: Vec3Node) {
  const up = saturate(direction.y);
  const sky = mix(vec3(0.44, 0.58, 0.75), vec3(0.045, 0.16, 0.44), pow(up, 0.42));
  const toSun = saturate(direction.dot(SUN_NODE));
  const disc = pow(toSun, 5000).mul(30);
  const halo = pow(toSun, 120).mul(0.5).add(pow(toSun, 14).mul(0.16)).add(pow(toSun, 3).mul(0.04));
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
function ggx(normal: Vec3Node, view: Vec3Node, roughness: Node<"float">) {
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
  const [coarse, fine] = sim.displacement;
  const [coarseTile, fineTile] = sim.cascades.map((cascade) => cascade.tile);

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

  /** Both cascades summed at a ground position, as (x, height, z). */
  const displacementAt = (
    ground: Vec2Node,
    fineWeight: Node<"float">,
    lod?: number,
  ) => {
    const a = texture(coarse, ground.div(coarseTile));
    const b = texture(fine, ground.div(fineTile));
    const sampleA = lod === undefined ? a : a.level(float(lod));
    const sampleB = lod === undefined ? b : b.level(float(lod));
    return sampleA.xyz.add(sampleB.xyz.mul(fineWeight));
  };

  // The fine cascade is 0.1m per texel against a 0.9m vertex spacing, so the
  // grid cannot represent most of it anywhere, and out at the horizon it cannot
  // represent any of it. Displacing vertices by a signal the grid cannot carry
  // does not add detail, it adds aliasing, so the cascade fades out with
  // distance in the geometry and is picked up by the normal below instead.
  const VERTEX_FINE = 0.55;
  const ground = vec2(positionLocal.x, positionLocal.z);
  const vertexFine = smoothstep(
    float(160),
    float(30),
    length(cameraPosition.sub(positionLocal)),
  ).mul(VERTEX_FINE);
  const displaced = positionLocal.add(displacementAt(ground, vertexFine, 0));
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

    const fineTexel = fineTile / sim.size;
    // Differences taken over a pixel, never under one.
    const step = max(float(fineTexel), footprint);
    // What is left of the fine cascade at this footprint.
    const resolved = saturate(float(fineTexel * 5).div(footprint));

    // Central differences of the displaced surface. Because the water moves
    // sideways as well as up, the slope of the height alone is not the surface
    // normal: the horizontal terms have to come along.
    const px = displacementAt(flat.add(vec2(step, 0)), resolved);
    const nx = displacementAt(flat.sub(vec2(step, 0)), resolved);
    const pz = displacementAt(flat.add(vec2(0, step)), resolved);
    const nz = displacementAt(flat.sub(vec2(0, step)), resolved);

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

    const geometric = normalize(cross(dPdz, dPdx));

    // Capillary detail below the tile resolution, folded into the normal only.
    const drift = time.mul(0.16);
    const rippleX = mx_fractal_noise_float(
      vec3(flat.x.mul(2.6).add(drift), flat.y.mul(2.6), 0.0),
      3,
      2,
      0.5,
      1,
    );
    const rippleZ = mx_fractal_noise_float(
      vec3(flat.x.mul(2.6), flat.y.mul(2.6).sub(drift), 7.0),
      3,
      2,
      0.5,
      1,
    );
    const capillary = resolved.mul(0.06);
    const normal = normalize(
      geometric.add(vec3(rippleX.mul(capillary), 0.0, rippleZ.mul(capillary))),
    );

    // Schlick against water's real index of refraction: two percent straight
    // on, almost a mirror at grazing angles. This one term is most of the look.
    const facing = saturate(normal.dot(view));
    const fresnel = float(0.02).add(pow(facing.oneMinus(), 5).mul(0.98));

    const reflected = skyColor(reflect(view.negate(), normal));

    // Light that scattered inside the water and left again. Absorption takes
    // the red out first, which is why deep water reads blue rather than dim.
    const body = vec3(0.004, 0.042, 0.088).mul(saturate(normal.y).mul(0.7).add(0.3));

    // Light that entered the back of a crest and came out toward the eye. Only
    // when the sun is behind the wave, and only near the top of one.
    const through = pow(saturate(view.dot(SUN_NODE.negate())), 4.5);
    const lift = saturate(worldPosition.y.mul(0.34).sub(0.12));
    const scatter = vec3(0.04, 0.22, 0.22).mul(through.mul(lift).mul(0.6));

    // Detail a pixel cannot resolve has not disappeared, it has turned into
    // roughness. Folding it into the highlight instead of dropping it is what
    // stops the far water from sparkling like tinsel.
    const roughness = float(0.045).add(resolved.oneMinus().mul(0.24));
    const glitter = vec3(1.0, 0.94, 0.82).mul(
      ggx(normal, view, roughness).mul(fresnel).mul(1.6),
    );

    let color: Vec3Node = mix(body.add(scatter), reflected, fresnel).add(glitter);

    // Foam where the surface folds over itself. The determinant of the
    // horizontal displacement Jacobian drops below one where water is being
    // compressed and through zero where it is breaking, which is why this
    // catches breaking crests and leaves smooth swell alone.
    const jacobian = dPdx.x.mul(dPdz.z).sub(dPdx.z.mul(dPdz.x));
    const foamNoise = mx_fractal_noise_float(
      vec3(flat.x.mul(1.7), flat.y.mul(1.7), time.mul(0.25)),
      4,
      2,
      0.5,
      1,
    )
      .mul(0.5)
      .add(0.5);
    const foam = smoothstep(0.78, 0.1, jacobian).mul(
      foamNoise.mul(resolved.mul(0.8).add(0.1)).add(0.15),
    );
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

    // Above the crests rather than among them: the wave field is the subject
    // here, and there is no cheap way to ask the GPU how high the water is.
    const bob = reducedMotion
      ? 0
      : Math.sin(t * 0.42) * 0.35 + Math.sin(t * 0.27) * 0.22;
    const SUN_BEARING = Math.atan2(-0.3, 0.95);
    const yaw = SUN_BEARING + Math.sin(t * 0.021) * 0.42;

    camera.position.set(0, EYE_HEIGHT + bob, 0);
    camera.lookAt(
      Math.sin(yaw) * 60,
      EYE_HEIGHT + bob - 2.3,
      -Math.cos(yaw) * 60,
    );
  };
};
