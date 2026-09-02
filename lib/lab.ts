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
    slug: "drop",
    preview: "/previews/lab-drop.webp",
    name: "Free Water",
    blurb: "A drop with nothing holding it, ray traced in a fragment shader.",
    detail:
      "The shape is not animated by hand. Rayleigh worked out in 1879 that a drop held only by surface tension can wobble in a fixed set of modes, and how fast each one rings: the square root of surface tension over density times the cube of the radius. This drop is six centimetres across, so it swings between egg and pancake once every four seconds and its three lobed mode about twice as fast, which is what the same drop does on the space station. Each mode is kept as a tensor rather than an axis and an amplitude, so pokes from different directions add up instead of replacing each other. Run the pointer across it and it sways; tap it and a capillary ripple runs out from the point of contact at the speed the dispersion relation gives it, thins as its ring widens, gathers again as it closes on the far side, and comes back. It is a wave a quarter of a millimetre high, and it shows up only because it tilts the reflections. The light is traced rather than faked: Fresnel at the first surface, Snell's law into the water, a march to the far side, then part of it out and part reflected back in to try the next face, with total internal reflection when Snell has no answer. The path length feeds Beer-Lambert with Pope and Fry's measured absorption for pure water, and red, green and blue are traced as three separate rays with water's real dispersion, parting company at the first surface, which is where the thin fringe on the rim comes from. The world it sits in is a photograph. Click the world rather than the drop and it becomes another one: a country road, the Shanghai waterfront at night, a photo studio, a desert at dawn, all Poly Haven HDRIs kept in high dynamic range by storing the log of the light in an ordinary WebP, so the sun still glints on the surface and the city lights bloom. The camera is treated as a camera too: the road behind is out of focus because the lens is on the drop, and the glint blooms because that is what glass in front of a sensor does.",
    technique: "Ray-marched SDF, Rayleigh modes, Fresnel, Beer-Lambert, HDRI",
  },
  {
    slug: "rasengan",
    preview: "/previews/lab-rasengan.webp",
    name: "Rasengan!",
    blurb: "Naruto's Rasengan: chakra spun several ways at once, held in a ball.",
    detail:
      "Built from one frame: the Parent and Child Rasengan at the end of Boruto: Naruto the Movie, where the ball is wound with hundreds of thin, smooth, bright lines at every angle, crossing into a net that thickens toward the rim, around a core too bright to see into. Each line here is a circle on the sphere, the set of directions whose dot product with some axis equals some offset: one multiply per line, no noise anywhere, so every thread is clean. A hundred and forty-four of them in four groups, each group turning about its own axis at its own speed, one against the others, so the net shears the way chakra spun several ways at once would. Four concentric shells of it, front and back faces each, give the cage depth, and by projection alone the lines crowd toward the rim as they do in the film. Each thread breathes in brightness on its own clock, which is the flicker. A few brighter arcs orbit outside the ball on tilted circles, dimmed where they pass behind it. The body is a soft luminous volume that thins out with radius rather than stopping, so the glow has no edge; the net does, because in the film it does. The world behind is bent, dimmed and tinted the way a bright translucent sphere would, and just outside the shell it shimmers and is dragged into a spiral while chakra peels off in soft tongues. Press and hold it and it charges: bigger, brighter, faster, up to 1.6 times, and it settles when you let go. The world behind it changes every twelve seconds, or when you click it: a field under the moon, a pine forest, a meadow at dusk, a rocky valley at dawn, the kind of places these fights happen in. The lens and bloom are the same as the water drop's.",
    technique: "A cage of 144 circles on four shells, orbiting arcs, HDR bloom",
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
