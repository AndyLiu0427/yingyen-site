"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

const TEXT_WORLD_WIDTH = 10;
const FORM_DURATION_S = 2.0;
const FORM_DELAY_S = 0.35;

type Sampled = {
  targets: Float32Array;
  scatter: Float32Array;
  rand: Float32Array;
  count: number;
};

/**
 * Rasterizes the name into an offscreen canvas and samples filled pixels
 * into world-space particle targets. Runs after document fonts load so the
 * letterforms use Geist, not a fallback face.
 */
function sampleText(lines: string[], step: number): Sampled {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const fontSize = 160;
  const fontFamily = getComputedStyle(document.body).fontFamily;
  const font = `700 ${fontSize}px ${fontFamily}`;
  const lineHeight = fontSize * 1.08;

  ctx.font = font;
  const width = Math.ceil(
    Math.max(...lines.map((l) => ctx.measureText(l).width)),
  );
  canvas.width = width + 8;
  canvas.height = Math.ceil(lineHeight * lines.length) + 8;

  // Canvas state resets after resize; set everything again
  ctx.font = font;
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  lines.forEach((line, i) => {
    ctx.fillText(
      line,
      canvas.width / 2,
      canvas.height / 2 + (i - (lines.length - 1) / 2) * lineHeight,
    );
  });

  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const scale = TEXT_WORLD_WIDTH / canvas.width;
  const points: number[] = [];
  for (let y = 0; y < canvas.height; y += step) {
    for (let x = 0; x < canvas.width; x += step) {
      if (data[(y * canvas.width + x) * 4 + 3] > 128) {
        points.push(
          (x - canvas.width / 2 + Math.random() * step) * scale,
          -(y - canvas.height / 2 + Math.random() * step) * scale,
          (Math.random() - 0.5) * 0.12,
        );
      }
    }
  }

  const count = points.length / 3;
  const targets = new Float32Array(points);
  const scatter = new Float32Array(count * 3);
  const rand = new Float32Array(count);
  const spreadX = TEXT_WORLD_WIDTH * 0.9;
  const spreadY = ((canvas.height * scale) / 2) * 6;
  for (let i = 0; i < count; i++) {
    scatter[i * 3] = (Math.random() - 0.5) * spreadX * 2;
    scatter[i * 3 + 1] = (Math.random() - 0.5) * spreadY;
    scatter[i * 3 + 2] = (Math.random() - 0.5) * 5;
    rand[i] = Math.random();
  }
  return { targets, scatter, rand, count };
}

const vertexShader = /* glsl */ `
  attribute vec3 aTarget;
  attribute float aRand;
  uniform float uProgress;
  uniform float uTime;
  uniform vec2 uMouse;
  uniform float uMouseActive;
  uniform float uSize;
  varying float vRand;
  varying float vAlpha;

  float easeOutCubic(float t) {
    return 1.0 - pow(1.0 - t, 3.0);
  }

  void main() {
    float p = easeOutCubic(clamp(uProgress * 1.35 - aRand * 0.35, 0.0, 1.0));
    vec3 pos = mix(position, aTarget, p);

    pos.x += sin(uTime * (0.5 + aRand * 0.6) + aRand * 43.0) * 0.014;
    pos.y += cos(uTime * (0.6 + aRand * 0.4) + aRand * 61.0) * 0.014;

    vec2 d = pos.xy - uMouse;
    float force = smoothstep(1.0, 0.0, length(d)) * uMouseActive;
    pos.xy += normalize(d + 0.0001) * force * 0.6;
    pos.z += force * 0.4;

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * (0.6 + aRand * 0.8) * (7.0 / -mv.z);
    vRand = aRand;
    vAlpha = 0.2 + 0.8 * p;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  varying float vRand;
  varying float vAlpha;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.12, d);
    vec3 color = mix(uColorA, uColorB, step(0.86, vRand));
    gl_FragColor = vec4(color, a * vAlpha * (0.65 + 0.35 * vRand));
  }
`;

export default function ParticleName({
  lines,
  reducedMotion,
}: {
  lines: string[];
  reducedMotion: boolean;
}) {
  const [sampled, setSampled] = useState<Sampled | null>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const elapsed = useRef(0);
  const mouseActive = useRef(0);
  const pointerIdle = useRef(true);
  const viewport = useThree((s) => s.viewport);

  useEffect(() => {
    let cancelled = false;
    const step = window.innerWidth < 640 ? 3 : 2;
    document.fonts.ready.then(() => {
      if (!cancelled) setSampled(sampleText(lines, step));
    });
    return () => {
      cancelled = true;
    };
  }, [lines]);

  const uniforms = useMemo(
    () => ({
      uProgress: { value: reducedMotion ? 1 : 0 },
      uTime: { value: 0 },
      uMouse: { value: new THREE.Vector2(999, 999) },
      uMouseActive: { value: 0 },
      uSize: { value: 3 },
      uColorA: { value: new THREE.Color("#9caeff") },
      uColorB: { value: new THREE.Color("#e8eaf0") },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useFrame((state, delta) => {
    const u = materialRef.current?.uniforms;
    if (!u) return;
    u.uSize.value = 1.6 * state.gl.getPixelRatio();
    if (reducedMotion) {
      u.uProgress.value = 1;
      return;
    }
    elapsed.current += delta;
    u.uTime.value = elapsed.current;
    if (elapsed.current > FORM_DELAY_S && u.uProgress.value < 1) {
      u.uProgress.value = Math.min(
        1,
        u.uProgress.value + delta / FORM_DURATION_S,
      );
    }
    // Pointer position in world units at the text plane
    u.uMouse.value.set(
      (state.pointer.x * state.viewport.width) / 2,
      (state.pointer.y * state.viewport.height) / 2,
    );
    const target = pointerIdle.current ? 0 : 1;
    mouseActive.current += (target - mouseActive.current) * 0.08;
    u.uMouseActive.value = mouseActive.current;
    pointerIdle.current = true;
  });

  // R3F pointer events fire on the canvas; mark activity each frame it moves
  useEffect(() => {
    const onMove = () => {
      pointerIdle.current = false;
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  if (!sampled) return null;

  const scale = Math.min(1, (viewport.width * 0.92) / TEXT_WORLD_WIDTH);

  return (
    <group scale={scale} position={[0, 0.4 * scale, 0]}>
      <points>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[sampled.scatter, 3]}
          />
          <bufferAttribute
            attach="attributes-aTarget"
            args={[sampled.targets, 3]}
          />
          <bufferAttribute
            attach="attributes-aRand"
            args={[sampled.rand, 1]}
          />
        </bufferGeometry>
        <shaderMaterial
          ref={materialRef}
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          uniforms={uniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </group>
  );
}
