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
  /** Still frame, shown where the browser cannot run the live version. */
  preview: string;
};

export const labSketches: LabSketchMeta[] = [
  {
    slug: "ocean",
    preview: "/previews/lab-ocean.webp",
    name: "Open Water",
    blurb: "A Tessendorf FFT ocean, simulated on the GPU every frame.",
    detail:
      "Real ocean renderers do not add waves together, they inverse transform a spectrum. A Phillips spectrum says how much energy the wind puts into each wavenumber; multiplying it by a complex Gaussian turns that smooth curve into an actual random sea; and an inverse FFT turns the whole spectrum into a height field in one shot. That is Tessendorf's method, and it is what film and game oceans have used for twenty years. Here it runs as WebGPU compute in three cascades, stacked in one buffer so the whole ocean transforms at once for twenty three dispatches a frame, with tile sizes that share no common factor so the repeat is not findable. The colour is not chosen either. Water absorbs red about seventy times more strongly than blue, which is the entire reason the sea is blue, and feeding the measured absorption and scattering coefficients through the standard deep water reflectance gives the palette directly. One number, the chlorophyll concentration, walks the whole Jerlov scale: raise it and the blue is eaten first, exactly as real water turns green near a coast. Most of what separates this from a grainy version is filtering rather than simulation, though. A pixel at the horizon covers metres of water, so the surface is differenced over its own footprint, each cascade drops out where its texels fall below a pixel, and the detail that falls through is added back as roughness instead of being thrown away.",
    technique: "Tessendorf FFT, three cascades, Jerlov optics",
    dark: true,
  },
  {
    slug: "particles",
    preview: "/previews/lab-particles.webp",
    name: "Curl Field",
    blurb: "163,840 particles, one compute dispatch per frame.",
    detail:
      "Every particle is four floats in a single storage buffer, advected through a curl noise field. Curl noise is the perpendicular of a noise gradient, and a perpendicular field has zero divergence, so the particles circulate indefinitely instead of draining into sinks. The compute pass rewrites the buffer in place and the render pass reads the same memory as instance data, so nothing travels back to the CPU. Move the pointer and they fall toward it.",
    technique: "Compute shader, instanced draw, additive blending",
    dark: true,
  },
  {
    slug: "ripple",
    preview: "/previews/lab-ripple.webp",
    name: "Still Water",
    blurb: "A wave equation solved in a ping-pong texture pair.",
    detail:
      "Two floating-point textures swap roles every frame. The red channel holds the surface now, green holds where it was last frame, and that second channel is the entire reason a wave keeps travelling rather than snapping flat. Each step is the discrete wave equation over the four neighbours; the shading pass turns the height slope into a normal and lights it. Drag across it, or leave it alone and it rains on itself.",
    technique: "Ping-pong render targets, rgba16float, wave equation",
  },
  {
    slug: "aurora",
    preview: "/previews/lab-aurora.webp",
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
