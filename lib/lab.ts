export type LabSketchMeta = {
  slug: string;
  name: string;
  /** One line, on the gallery card. */
  blurb: string;
  /** The interesting part, on the sketch's own page. */
  detail: string;
  technique: string;
  /** Dark sketches get a dark card so the frame does not fight the render. */
  dark?: boolean;
};

export const labSketches: LabSketchMeta[] = [
  {
    slug: "elements",
    name: "Four Elements",
    blurb: "Fire, water, earth and wind, one shader each.",
    detail:
      "Four spheres, four node materials, no textures anywhere. Fire is basalt crust with molten seams, and because the noise field drifts downward in object space the seams read as heat climbing rather than rock sliding. Water is three sine waves crossing at odd ratios so the swell never quite repeats. Earth is voronoi plates over sedimentary banding, drifting slowly enough to read as tectonics. Wind is not a solid body at all: three nested additive shells sampling noise on a coordinate squashed along one axis, which stretches it into streaks, running at different speeds so the parallax between them reads as depth. Every displaced surface recomputes its own shading normal from two tangential samples of the field, which is the difference between geometry that has waves and lighting that knows about them.",
    technique: "three.js WebGPURenderer, TSL node materials",
    dark: true,
  },
  {
    slug: "particles",
    name: "Curl Field",
    blurb: "163,840 particles, one compute dispatch per frame.",
    detail:
      "Every particle is four floats in a single storage buffer, advected through a curl noise field. Curl noise is the perpendicular of a noise gradient, and a perpendicular field has zero divergence, so the particles circulate indefinitely instead of draining into sinks. The compute pass rewrites the buffer in place and the render pass reads the same memory as instance data, so nothing travels back to the CPU. Move the pointer and they fall toward it.",
    technique: "Compute shader, instanced draw, additive blending",
    dark: true,
  },
  {
    slug: "ripple",
    name: "Still Water",
    blurb: "A wave equation solved in a ping-pong texture pair.",
    detail:
      "Two floating-point textures swap roles every frame. The red channel holds the surface now, green holds where it was last frame, and that second channel is the entire reason a wave keeps travelling rather than snapping flat. Each step is the discrete wave equation over the four neighbours; the shading pass turns the height slope into a normal and lights it. Drag across it, or leave it alone and it rains on itself.",
    technique: "Ping-pong render targets, rgba16float, wave equation",
  },
  {
    slug: "aurora",
    name: "Paper Weather",
    blurb: "Domain-warped noise, sampled three times deep.",
    detail:
      "Fractal noise sampled at coordinates that are themselves fractal noise, twice over. One pass gives clouds; feeding the result back as the sample position gives currents, eddies, and the sense that something is moving underneath. The pointer bends the warp field rather than painting onto it, so the cursor drags the whole image around instead of leaving a mark. This one also runs behind the front page.",
    technique: "Fragment shader, fBm domain warping",
  },
];

export function findSketch(slug: string): LabSketchMeta | undefined {
  return labSketches.find((sketch) => sketch.slug === slug);
}
