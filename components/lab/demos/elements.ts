import {
  AdditiveBlending,
  DoubleSide,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  Mesh,
  MeshBasicNodeMaterial,
  MeshPhysicalNodeMaterial,
  MeshStandardNodeMaterial,
  PointLight,
  Vector3,
} from "three/webgpu";
import {
  cameraPosition,
  cross,
  float,
  Fn,
  fract,
  mix,
  mx_fractal_noise_float,
  mx_worley_noise_float,
  normalize,
  normalLocal,
  normalWorld,
  positionLocal,
  positionWorld,
  pow,
  saturate,
  sin,
  smoothstep,
  time,
  transformNormalToView,
  vec3,
} from "three/tsl";
import type Node from "three/src/nodes/core/Node.js";
import type { ThreeSetup } from "../useThreeCanvas";

type Vec3Node = Node<"vec3">;

/** A displacement field: object-space point in, height along the normal out. */
type Field = (position: Vec3Node) => Node<"float">;

/**
 * Shading normal for a surface displaced along its own normal by `field`.
 *
 * Displacing vertices without this leaves the lighting flat: the geometry has
 * waves, the shading does not. Two tangential samples give the slope of the
 * field, and tilting the normal against that slope is what makes the ripples
 * and the rock actually catch the light.
 */
function normalFromField(
  field: Field,
  position: Vec3Node,
  normal: Vec3Node,
  eps: number,
  strength: number,
) {
  // Any vector not parallel to the normal works; an off-axis one keeps the
  // cross product from collapsing at the poles.
  const tangent = normalize(cross(normal, vec3(0.31, 0.83, 0.46)));
  const bitangent = cross(normal, tangent);
  const here = field(position);
  const alongT = field(position.add(tangent.mul(eps))).sub(here);
  const alongB = field(position.add(bitangent.mul(eps))).sub(here);
  const slope = tangent.mul(alongT).add(bitangent.mul(alongB));
  return normalize(normal.sub(slope.mul(strength / eps)));
}

/**
 * Thin filaments along the zero crossing of a fractal field.
 *
 * `1 - abs(noise)` looks like the same idea and is not: fractal noise clusters
 * near zero, so that version sits close to 1 nearly everywhere and floods the
 * surface. Measuring the distance to the crossing and thresholding it gives
 * lines with a width you actually control.
 */
const seam = (p: Vec3Node, octaves: number, width: number) =>
  smoothstep(width, 0, mx_fractal_noise_float(p, octaves, 2, 0.5, 1).abs());

/** Rim term, bright where the surface turns away from the camera. */
const fresnel = (power: number) =>
  pow(
    saturate(normalWorld.dot(normalize(cameraPosition.sub(positionWorld)))).oneMinus(),
    power,
  );

// ---------------------------------------------------------------- fire

/**
 * Basalt crust with molten seams. The noise field drifts downward in object
 * space, so the seams read as heat climbing the surface rather than the rock
 * sliding around.
 */
function fire() {
  const material = new MeshStandardNodeMaterial();

  const crust: Field = (p) => {
    const drift = vec3(0, time.mul(-0.16), 0);
    const plates = mx_fractal_noise_float(p.mul(1.6).add(drift), 3, 2, 0.5, 1);
    const grain = mx_fractal_noise_float(p.mul(7.0), 3, 2, 0.5, 1);
    return plates.mul(0.075).add(grain.mul(0.012));
  };

  const heat = Fn(() => {
    const drift = vec3(0, time.mul(-0.24), 0);
    const p = positionLocal.mul(2.1).add(drift);
    // Warping the sample point before the ridge is what bends the seams into
    // channels instead of leaving a regular web.
    const warp = mx_fractal_noise_float(p.mul(0.7), 2, 2, 0.5, 1).mul(0.55);
    const seams = seam(p.add(warp), 4, 0.075);
    // A wider, dimmer field under the seams: rock warmed by what runs through it.
    const bloom = seam(p.mul(0.55), 3, 0.42).mul(0.22);
    const breath = sin(time.mul(0.8)).mul(0.5).add(0.5).mul(0.25).add(0.82);
    return saturate(seams.add(bloom).mul(breath));
  })();

  // Incandescence ramp: black through deep red and orange into yellow-white.
  const blackbody = mix(
    mix(vec3(0.22, 0.02, 0.0), vec3(1.0, 0.22, 0.02), smoothstep(0.0, 0.45, heat)),
    vec3(1.0, 0.82, 0.5),
    smoothstep(0.5, 1.0, heat),
  ).mul(heat);

  material.positionNode = positionLocal.add(normalLocal.mul(crust(positionLocal)));
  material.normalNode = transformNormalToView(
    normalFromField(crust, positionLocal, normalLocal, 0.03, 0.9),
  );
  material.colorNode = mix(vec3(0.032, 0.027, 0.03), vec3(0.14, 0.07, 0.05), heat);
  material.emissiveNode = blackbody.mul(4.5);
  material.roughnessNode = mix(float(0.95), float(0.45), heat);
  material.metalnessNode = float(0.0);

  return material;
}

// ---------------------------------------------------------------- water

/** Travelling swell. Three sines crossing at odd angles never quite repeat. */
function water() {
  const material = new MeshPhysicalNodeMaterial();

  const swell: Field = (p) => {
    const t = time.mul(0.85);
    const a = sin(p.x.mul(19.0).add(t.mul(2.1)));
    const b = sin(p.y.mul(15.0).sub(t.mul(2.7)));
    const c = sin(p.z.mul(23.0).add(t.mul(1.6)));
    const drift = mx_fractal_noise_float(
      p.mul(1.9).add(vec3(0, t.mul(0.25), 0)),
      3,
      2,
      0.5,
      1,
    );
    return a.add(b).add(c).mul(0.0075).add(drift.mul(0.03));
  };

  const crest = saturate(swell(positionLocal).mul(22.0).add(0.42));
  const rim = fresnel(2.6);

  material.positionNode = positionLocal.add(normalLocal.mul(swell(positionLocal)));
  material.normalNode = transformNormalToView(
    normalFromField(swell, positionLocal, normalLocal, 0.012, 1.6),
  );
  material.colorNode = mix(
    mix(vec3(0.008, 0.045, 0.13), vec3(0.05, 0.3, 0.55), crest),
    vec3(0.45, 0.78, 0.95),
    rim.mul(0.75),
  );
  material.roughnessNode = mix(float(0.16), float(0.03), crest);
  material.metalnessNode = float(0.0);
  material.clearcoatNode = float(1.0);
  material.clearcoatRoughnessNode = float(0.04);
  // A little light of its own, so the crests still read against a dark scene.
  material.emissiveNode = vec3(0.02, 0.14, 0.22).mul(rim.mul(0.6));

  return material;
}

// ---------------------------------------------------------------- earth

/**
 * Voronoi plates over sedimentary banding. The plate field drifts slowly
 * enough to read as tectonics rather than animation; the bands stay locked to
 * the rock so the drift is legible against them.
 */
function earth() {
  const material = new MeshStandardNodeMaterial();

  const rock: Field = (p) => {
    const drift = time.mul(0.035);
    const plates = mx_worley_noise_float(
      p.mul(1.9).add(vec3(drift, drift.mul(-0.4), drift.mul(0.7))),
      1,
    );
    const rubble = mx_fractal_noise_float(p.mul(5.5), 4, 2, 0.5, 1);
    return plates.mul(0.13).add(rubble.mul(0.018));
  };

  const strata = fract(
    positionLocal.y
      .mul(11.0)
      .add(mx_fractal_noise_float(positionLocal.mul(1.5), 4, 2, 0.5, 1).mul(2.4)),
  );
  const band = smoothstep(0.42, 0.58, strata);
  const dust = mx_fractal_noise_float(positionLocal.mul(11.0), 3, 2, 0.5, 1)
    .mul(0.5)
    .add(0.5);

  material.positionNode = positionLocal.add(normalLocal.mul(rock(positionLocal)));
  material.normalNode = transformNormalToView(
    normalFromField(rock, positionLocal, normalLocal, 0.028, 1.0),
  );
  material.colorNode = mix(
    mix(vec3(0.1, 0.093, 0.086), vec3(0.235, 0.2, 0.163), band),
    vec3(0.3, 0.305, 0.315),
    dust.mul(0.34),
  );
  material.roughnessNode = mix(float(0.98), float(0.72), band);
  material.metalnessNode = float(0.04);

  return material;
}

// ---------------------------------------------------------------- wind

/**
 * Three nested additive shells rather than a solid body. Sampling the noise on
 * a coordinate squashed along Y stretches it into streaks, and the shells run
 * at different speeds so the parallax between them reads as depth in the flow.
 */
function windShell(scale: number, speed: number, strength: number) {
  const material = new MeshBasicNodeMaterial();
  material.transparent = true;
  material.blending = AdditiveBlending;
  material.depthWrite = false;
  material.side = DoubleSide;

  const flow = time.mul(speed);
  // Squashing one axis before sampling is what turns blobs into streaks; the
  // shear term bends those streaks around the body rather than through it.
  const shear = positionLocal.y.mul(2.2);
  const squashed = vec3(
    positionLocal.x.mul(scale).add(shear),
    positionLocal.y.mul(scale * 0.16),
    positionLocal.z.mul(scale).sub(shear),
  ).add(vec3(flow.mul(0.35), flow, flow.mul(-0.55)));

  const streaks = seam(squashed, 4, 0.16);
  // Thin the shells where they face us, so the sphere stays hollow-looking.
  const shell = fresnel(1.6).mul(0.85).add(0.15);

  material.colorNode = mix(vec3(0.34, 0.5, 0.8), vec3(0.86, 0.94, 1.0), streaks);
  material.opacityNode = streaks.mul(shell).mul(strength);

  return material;
}

// ---------------------------------------------------------------- scene

const SLOTS = [
  { x: -1.16, y: 1.16 },
  { x: 1.16, y: 1.16 },
  { x: -1.16, y: -1.16 },
  { x: 1.16, y: -1.16 },
] as const;

const SPIN = [0.09, 0.13, 0.05, 0.16] as const;

export const elements: ThreeSetup = ({ scene, camera, onCleanup }) => {
  scene.background = new Color(0x0a0c11);

  const key = new DirectionalLight(0xfff2e2, 2.1);
  key.position.set(3.5, 4.5, 4);
  const rim = new DirectionalLight(0x9db8ff, 1.1);
  rim.position.set(-4, -1.5, -3);
  const sky = new HemisphereLight(0x8fa6d8, 0x2a2118, 0.55);
  // Stands in for the fire lighting its own corner of the group.
  const glow = new PointLight(0xff6a1e, 6, 6, 2);
  glow.position.set(SLOTS[0].x, SLOTS[0].y, 1.4);
  scene.add(key, rim, sky, glow);

  const geometry = new IcosahedronGeometry(0.95, 32);
  const shellGeometry = new IcosahedronGeometry(1, 12);
  const materials = [fire(), water(), earth()];

  const bodies: Group[] = [];

  materials.forEach((material, index) => {
    const mesh = new Mesh(geometry, material);
    const group = new Group();
    group.position.set(SLOTS[index].x, SLOTS[index].y, 0);
    group.add(mesh);
    scene.add(group);
    bodies.push(group);
  });

  const wind = new Group();
  wind.position.set(SLOTS[3].x, SLOTS[3].y, 0);
  const shells = [
    { radius: 0.7, material: windShell(2.6, 0.22, 0.5) },
    { radius: 0.85, material: windShell(3.4, 0.31, 0.4) },
    { radius: 0.98, material: windShell(4.6, 0.44, 0.3) },
  ];
  for (const shell of shells) {
    const mesh = new Mesh(shellGeometry, shell.material);
    mesh.scale.setScalar(shell.radius);
    wind.add(mesh);
  }
  scene.add(wind);
  bodies.push(wind);

  onCleanup(() => {
    geometry.dispose();
    shellGeometry.dispose();
    materials.forEach((material) => material.dispose());
    shells.forEach((shell) => shell.material.dispose());
  });

  const axes = [
    new Vector3(0.2, 1, 0.1).normalize(),
    new Vector3(-0.1, 1, 0.25).normalize(),
    new Vector3(0.35, 1, -0.2).normalize(),
    new Vector3(0, 1, 0),
  ];

  // The grid is 2.11 from centre to the far edge of a body; fit that in
  // whichever axis is tighter so the four never crop.
  const halfExtent = 2.15;

  return (elapsed) => {
    const fovRadians = (camera.fov * Math.PI) / 180;
    const forVertical = halfExtent / Math.tan(fovRadians / 2);
    camera.position.z = forVertical * Math.max(1, 1 / camera.aspect) * 1.04;

    bodies.forEach((body, index) => {
      body.setRotationFromAxisAngle(axes[index], elapsed * SPIN[index]);
    });

    // The wind shells counter-rotate against each other for extra shear.
    wind.children.forEach((shell, index) => {
      shell.rotation.y = elapsed * (0.12 + index * 0.09) * (index % 2 ? -1 : 1);
    });
  };
};
