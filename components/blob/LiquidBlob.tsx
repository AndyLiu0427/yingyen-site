"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";

const BASE_AMP = 0.3;
const BASE_SCALE = 0.34;

// Ashima simplex noise, the standard GLSL implementation
const SIMPLEX = /* glsl */ `
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }
`;

/**
 * A water-like blob. Big low-frequency noise lobes keep the silhouette
 * irregular and always changing; a click sends a decaying ripple through
 * the surface. Displacement runs in the vertex shader (injected into
 * MeshPhysicalMaterial) with numerically recomputed normals.
 *
 * It lives in viewport space like a small creature: it drifts along the
 * screen edges on a rounded-rectangle path, occasionally glides into the
 * middle, dwells, then returns to the rim. The body stretches along its
 * velocity and squashes perpendicular to it, takes springy squash
 * impulses on touch, and cycles four click reactions.
 */
type BlobStore = {
  uniforms: {
    uTime: { value: number };
    uAmp: { value: number };
    uRipple: { value: number };
    uHalf: { value: THREE.Vector2 };
    uModelInv: { value: THREE.Matrix4 };
  };
  material: THREE.MeshPhysicalMaterial;
};

// Module-level singleton: the material and its uniforms are mutable
// three.js objects, deliberately outside React's render data flow
let blobStore: BlobStore | null = null;

function getBlobStore(): BlobStore {
  if (blobStore) return blobStore;
  const uniforms = {
    uTime: { value: 0 },
    uAmp: { value: BASE_AMP },
    uRipple: { value: 0 },
    uHalf: { value: new THREE.Vector2(100, 100) },
    uModelInv: { value: new THREE.Matrix4() },
  };
  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color("#c2c7d4"),
    metalness: 0.85,
    roughness: 0.34,
    clearcoat: 0.15,
    clearcoatRoughness: 0.4,
    envMapIntensity: 0.55,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uAmp = uniforms.uAmp;
    shader.uniforms.uRipple = uniforms.uRipple;
    shader.uniforms.uHalf = uniforms.uHalf;
    shader.uniforms.uModelInv = uniforms.uModelInv;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         uniform float uTime;
         uniform float uAmp;
         uniform float uRipple;
         uniform vec2 uHalf;
         uniform mat4 uModelInv;
         ${SIMPLEX}
         float blobSmin(float a, float b, float k) {
           float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
           return mix(b, a, h) - k * h * (1.0 - h);
         }
         float blobDisp(vec3 dir) {
           float lobes = snoise(dir * 0.8 + vec3(0.0, uTime * 0.24, uTime * 0.09));
           float flow = snoise(dir * 1.5 + vec3(uTime * 0.34, uTime * 0.1, 0.0));
           float wave = snoise(dir * 2.6 - vec3(0.0, uTime * 1.6, 0.0));
           return uAmp * (0.86 * lobes + 0.14 * flow) + uRipple * 0.26 * wave;
         }`,
      )
      .replace(
        "#include <beginnormal_vertex>",
        // Seam-free normals: tangential gradient of the displacement field
        // sampled along fixed world axes (no per-vertex tangent branch)
        `vec3 blobDir = normalize(position);
         float blobR = length(position);
         float blobH = blobDisp(blobDir);
         vec3 blobP = blobDir * (blobR + blobH);
         const float blobE = 0.12;
         vec3 blobGrad = vec3(
           blobDisp(normalize(position + vec3(blobE, 0.0, 0.0))) -
             blobDisp(normalize(position - vec3(blobE, 0.0, 0.0))),
           blobDisp(normalize(position + vec3(0.0, blobE, 0.0))) -
             blobDisp(normalize(position - vec3(0.0, blobE, 0.0))),
           blobDisp(normalize(position + vec3(0.0, 0.0, blobE))) -
             blobDisp(normalize(position - vec3(0.0, 0.0, blobE)))
         ) / (2.0 * blobE);
         vec3 blobGradT = blobGrad - dot(blobGrad, blobDir) * blobDir;
         vec3 objectNormal = normalize(blobDir - blobGradT / (blobR + blobH));
         #ifdef USE_TANGENT
           vec3 objectTangent = vec3(tangent.xyz);
         #endif`,
      )
      .replace(
        "#include <begin_vertex>",
        // The viewport is a glass box: vertices soft-clamp against the
        // four screen edges in world space, so a body pressed against an
        // edge flattens into a snail-foot contact patch instead of
        // sliding out of view round
        `vec3 transformed = blobP;
         vec4 blobW = modelMatrix * vec4(transformed, 1.0);
         const float blobK = 0.22;
         blobW.x = blobSmin(blobW.x, uHalf.x, blobK);
         blobW.x = -blobSmin(-blobW.x, uHalf.x, blobK);
         blobW.y = blobSmin(blobW.y, uHalf.y, blobK);
         blobW.y = -blobSmin(-blobW.y, uHalf.y, blobK);
         transformed = (uModelInv * blobW).xyz;`,
      );
  };
  blobStore = { uniforms, material: mat };
  return blobStore;
}

export default function LiquidBlob({
  reducedMotion,
}: {
  reducedMotion: boolean;
}) {
  const material = getBlobStore().material;
  const stretchGroup = useRef<THREE.Group>(null);
  const mesh = useRef<THREE.Mesh>(null);
  const viewport = useThree((s) => s.viewport);

  const pointer = useRef({ x: 10, y: 10 });
  const hover = useRef(0);
  const squashPos = useRef(0);
  const squashVel = useRef(0);
  const wasHovered = useRef(false);
  const lastScrollY = useRef(0);
  const scrollEnergy = useRef(0);
  const ripple = useRef(0);
  const ampBurst = useRef(0);
  const spinVel = useRef(0);
  const clickCount = useRef(0);
  const kick = useRef(new THREE.Vector2(0, 0));
  const prevPos = useRef(new THREE.Vector2(0, 0));
  const stretch = useRef(0);
  const stretchAngle = useRef(0);
  const time = useRef(0);

  // Wander state: rim-crawling with occasional trips to the middle
  const theta = useRef(Math.PI * 0.75);
  const thetaDir = useRef(1);
  const wanderMode = useRef<"rim" | "center">("rim");
  const modeTimer = useRef(4);
  const paceJitter = useRef(1);
  const centerPt = useRef(new THREE.Vector2(0, 0));

  useEffect(() => {
    const toNdc = (e: PointerEvent) => ({
      x: (e.clientX / window.innerWidth) * 2 - 1,
      y: -(e.clientY / window.innerHeight) * 2 + 1,
    });
    const onMove = (e: PointerEvent) => {
      pointer.current = toNdc(e);
    };
    const onDown = (e: PointerEvent) => {
      const m = mesh.current;
      if (!m) return;
      const ndc = toNdc(e);
      const wx = (ndc.x * viewport.width) / 2;
      const wy = (ndc.y * viewport.height) / 2;
      const world = stretchGroup.current?.position ?? m.position;
      const dx = world.x - wx;
      const dy = world.y - wy;
      const dist = Math.hypot(dx, dy);
      const radius = m.scale.x * 1.05 * (1 + BASE_AMP);
      if (dist < radius * 1.35) {
        const len = Math.max(dist, 0.001);
        // Rotate through distinct click reactions
        switch (clickCount.current % 4) {
          case 0: // flinch: shove away + surface ring
            kick.current.x += (dx / len) * 2.6;
            kick.current.y += (dy / len) * 2.6;
            squashVel.current += 3.2;
            ripple.current = 1;
            break;
          case 1: // boil: the whole surface erupts, body stays put
            ampBurst.current = 1;
            squashVel.current += 1.6;
            break;
          case 2: // spin: whip it around its axis with a wobble
            spinVel.current += 10 * (Math.random() > 0.5 ? 1 : -1);
            ripple.current = 0.6;
            break;
          default: // jump: springy hop upward
            kick.current.y += 2.2;
            squashVel.current -= 3.6;
            ripple.current = 0.5;
        }
        clickCount.current += 1;
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [viewport]);

  useFrame((_, delta) => {
    const g = stretchGroup.current;
    const m = mesh.current;
    if (!g || !m) return;
    // Clamp both ways: a delta of 0 would divide-by-zero into NaN and
    // poison every spring/velocity ref permanently
    const dt = THREE.MathUtils.clamp(delta, 1e-4, 0.05);
    if (!reducedMotion) time.current += dt;

    const sizeFactor = THREE.MathUtils.clamp(viewport.width / 4.2, 0.6, 1);
    const targetS = BASE_SCALE * sizeFactor;
    const radius = 1.05 * targetS * (1 + BASE_AMP);

    // Rim path pressed into the viewport edges: the center rides closer
    // to the wall than the mean surface radius, so the glass-box clamp
    // in the shader flattens a real contact patch against the edge
    const edgeHug = 1.05 * targetS * 0.55;
    const hx = Math.max(viewport.width / 2 - edgeHug, 0.4);
    const hy = Math.max(viewport.height / 2 - edgeHug, 0.4);
    const rimPoint = (t: number) => {
      const c = Math.cos(t);
      const s = Math.sin(t);
      // Superellipse hugs the corners closer than an ellipse would
      return {
        x: hx * Math.sign(c) * Math.pow(Math.abs(c), 0.62),
        y: hy * Math.sign(s) * Math.pow(Math.abs(s), 0.62),
      };
    };

    // Mode switching: mostly crawl the rim, sometimes visit the middle
    modeTimer.current -= dt;
    if (modeTimer.current <= 0) {
      if (wanderMode.current === "rim" && Math.random() < 0.35) {
        wanderMode.current = "center";
        centerPt.current.set(
          (Math.random() - 0.5) * hx * 0.7,
          (Math.random() - 0.5) * hy * 0.7,
        );
        modeTimer.current = 2.5 + Math.random() * 3;
      } else {
        wanderMode.current = "rim";
        if (Math.random() < 0.35) thetaDir.current *= -1;
        paceJitter.current = 0.5 + Math.random() * 1.3;
        modeTimer.current = 5 + Math.random() * 6;
      }
    }

    let targetX: number;
    let targetY: number;
    if (reducedMotion) {
      // Parked at the lower-right rim, no wandering
      const p = rimPoint(-Math.PI * 0.25);
      targetX = p.x;
      targetY = p.y;
    } else if (wanderMode.current === "center") {
      targetX = centerPt.current.x;
      targetY = centerPt.current.y;
    } else {
      theta.current +=
        dt * 0.16 * paceJitter.current * thetaDir.current;
      const p = rimPoint(theta.current);
      targetX = p.x;
      targetY = p.y;
    }

    // Liquid drift on top of the path, kept small so it stays glued
    // to the wall while rim-crawling
    const driftScale = wanderMode.current === "center" ? 1 : 0.45;
    if (!reducedMotion) {
      const t = time.current;
      targetX += Math.sin(t * 0.31 + 1.7) * 0.14 * driftScale;
      targetY += Math.sin(t * 0.43) * 0.12 * driftScale;
    }

    // Pointer world position, hover state
    const pw = {
      x: (pointer.current.x * viewport.width) / 2,
      y: (pointer.current.y * viewport.height) / 2,
    };
    const dist = Math.hypot(pw.x - g.position.x, pw.y - g.position.y);
    const hovered = !reducedMotion && dist < radius * 1.2;
    if (hovered && !wasHovered.current) squashVel.current += 2.0;
    wasHovered.current = hovered;
    hover.current += ((hovered ? 1 : 0) - hover.current) * (dt * 6);

    // Lean toward the cursor while hovered
    targetX += (pw.x - targetX) * 0.22 * hover.current;
    targetY += (pw.y - targetY) * 0.22 * hover.current;

    // Scroll velocity energizes the surface
    const sv = Math.abs(window.scrollY - lastScrollY.current) / dt;
    lastScrollY.current = window.scrollY;
    scrollEnergy.current = THREE.MathUtils.damp(
      scrollEnergy.current,
      THREE.MathUtils.clamp(sv / 3500, 0, 0.2),
      3,
      dt,
    );

    // Click kick decays like a shove through goo
    targetX += kick.current.x;
    targetY += kick.current.y;
    kick.current.multiplyScalar(Math.exp(-3.5 * dt));

    // Loose damping so travel reads as gliding through water
    const lambda = reducedMotion ? 30 : 2.1;
    g.position.x = THREE.MathUtils.damp(g.position.x, targetX, lambda, dt);
    g.position.y = THREE.MathUtils.damp(g.position.y, targetY, lambda, dt);

    // Slime locomotion: stretch along velocity, squash across it
    const vx = (g.position.x - prevPos.current.x) / dt;
    const vy = (g.position.y - prevPos.current.y) / dt;
    prevPos.current.set(g.position.x, g.position.y);
    const speed = Math.hypot(vx, vy);
    const targetStretch = reducedMotion
      ? 0
      : THREE.MathUtils.clamp(speed * 0.34, 0, 1.1);
    stretch.current = THREE.MathUtils.damp(
      stretch.current,
      targetStretch,
      8,
      dt,
    );
    if (speed > 0.05) {
      const angle = Math.atan2(vy, vx);
      // Shortest-path angle blend so the body does not spin the long way
      let diff = angle - stretchAngle.current;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      stretchAngle.current += diff * Math.min(1, dt * 10);
    }
    g.rotation.z = stretchAngle.current;
    const sMain = 1 + stretch.current;
    const sSide = 1 / Math.sqrt(sMain);
    g.scale.set(sMain, sSide, sSide);

    // Springy squash on top (touch and click impulses)
    squashVel.current -= (squashPos.current * 60 + squashVel.current * 8) * dt;
    squashPos.current += squashVel.current * dt;
    const squash = reducedMotion ? 0 : squashPos.current;
    const grow = (1 + hover.current * 0.06) * targetS;
    m.scale.set(
      grow * (1 + squash * 0.1),
      grow * (1 - squash * 0.14),
      grow * (1 + squash * 0.1),
    );

    if (!reducedMotion) {
      spinVel.current *= Math.exp(-2.8 * dt);
      m.rotation.y += dt * (0.15 + hover.current * 0.35 + spinVel.current);
    }

    // Surface behavior: always irregular, livelier on hover/scroll/click
    ripple.current *= Math.exp(-2.2 * dt);
    ampBurst.current *= Math.exp(-2.6 * dt);
    const { uniforms } = getBlobStore();
    uniforms.uTime.value = time.current;
    uniforms.uAmp.value =
      BASE_AMP +
      hover.current * 0.1 +
      scrollEnergy.current * 0.5 +
      ampBurst.current * 0.45;
    uniforms.uRipple.value = reducedMotion ? 0 : ripple.current;

    // Glass-box clamp inputs: screen extents + this frame's inverse
    // model matrix (transforms just changed above)
    uniforms.uHalf.value.set(viewport.width / 2, viewport.height / 2);
    g.updateWorldMatrix(true, true);
    uniforms.uModelInv.value.copy(m.matrixWorld).invert();
  });

  return (
    <group ref={stretchGroup} position={[0, -0.05, 0]}>
      <mesh ref={mesh} material={material}>
        <icosahedronGeometry args={[1.05, 48]} />
      </mesh>
    </group>
  );
}
