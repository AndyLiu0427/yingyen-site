"use client";

import { Canvas, type RootState } from "@react-three/fiber";
import { useEffect, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import LiquidBlob from "./LiquidBlob";

// Procedural studio reflections for the liquid metal; no HDRI download
function setupEnvironment({ gl, scene }: RootState) {
  const pmrem = new THREE.PMREMGenerator(gl);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
}

function webglSupported() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

/**
 * One fixed, full-viewport canvas that lives for the whole page. The blob
 * inside follows [data-blob] anchors as you scroll. pointer-events stay off
 * so the page underneath remains fully interactive; the blob does its own
 * hit-testing from window pointer events.
 */
export default function BlobCanvas() {
  const [state, setState] = useState<"pending" | "ready" | "unsupported">(
    "pending",
  );
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setReducedMotion(
        window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      );
      setState(webglSupported() ? "ready" : "unsupported");
    }, 0);
    return () => clearTimeout(t);
  }, []);

  if (state !== "ready") return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-10">
      <Canvas
        camera={{ position: [0, 0, 5.2], fov: 42 }}
        dpr={[1, 2]}
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: "high-performance",
        }}
        frameloop={reducedMotion ? "demand" : "always"}
        onCreated={setupEnvironment}
      >
        <directionalLight position={[4, 6, 3]} intensity={0.6} />
        <directionalLight
          position={[-5, -2, -4]}
          intensity={0.3}
          color="#dfe6ff"
        />
        <LiquidBlob reducedMotion={reducedMotion} />
      </Canvas>
    </div>
  );
}
