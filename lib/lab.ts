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
    slug: "ocean",
    name: "Open Water",
    blurb: "Nine Gerstner waves, with foam where the surface folds.",
    detail:
      "A sine wave only moves the surface up and down, which is why a sum of sines reads as wobbling rather than water. A Gerstner wave also moves each point horizontally, against the direction of travel at the crest, so the water piles into a sharp peak and spreads into a wide flat trough. Nine of them run here across a rough wind spectrum, each travelling at the speed deep water actually gives its wavelength, which is most of why the surface never appears to loop. Their derivatives are closed form, so the normal is exact and so is the Jacobian of the horizontal displacement. That second one is what places the foam: below one the surface is compressing, near zero it is folding over itself, and folding is what breaking is. Shading is Schlick against water's real index of refraction, two percent reflective head on and almost a mirror at grazing angles, over an analytic sky that is also the only light in the scene.",
    technique: "Gerstner waves, TSL node material, analytic sky",
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
