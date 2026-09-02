/**
 * Water colour from measured optics rather than from three numbers picked by
 * eye.
 *
 * The sea is blue for one reason: water absorbs red about seventy times more
 * strongly than blue. Everything else, the greens of coastal water and the
 * near-violet of the open Pacific, is that curve plus whatever is living in
 * the water. Deriving the colour from coefficients rather than choosing it
 * means the whole palette moves together and stays plausible.
 */

/** Wavelengths in nanometres that R, G and B stand in for here. */
const RGB_NM = [680, 550, 440] as const;

/**
 * Pure water absorption, Pope and Fry 1997, integrating cavity measurements.
 * Their table is in inverse centimetres; these are inverse metres.
 */
const PURE_WATER_ABSORPTION = [0.465, 0.0565, 0.00635] as const;

/** Pure water scattering at 500nm, and the exponent it falls off with. */
const PURE_WATER_SCATTER_500 = 0.00288;
const SCATTER_EXPONENT = 4.32;

/**
 * Chlorophyll-specific absorption, roughly Bricaud: a strong blue peak, a
 * second red peak, and the green window between them that everything alive in
 * the water leaves open. Simplified to three samples.
 */
const CHLOROPHYLL_ABSORPTION = [0.0203, 0.0075, 0.0378] as const;

/** Slope of the exponential fall of dissolved organic absorption, per nm. */
const CDOM_SLOPE = 0.014;

export type WaterOptics = {
  /** Absorption per channel, inverse metres. */
  absorption: [number, number, number];
  /** Backscatter per channel, inverse metres. */
  backscatter: [number, number, number];
  /** Beam attenuation, absorption plus scattering. Drives transmittance. */
  attenuation: [number, number, number];
  /** Fraction of downwelling light that leaves deep water again, per channel. */
  reflectance: [number, number, number];
};

/**
 * Case 1 water at a given chlorophyll concentration, in mg per cubic metre.
 *
 * Morel tied Jerlov's open ocean types to chlorophyll: type I is under 0.01,
 * IB around 0.1, II around 0.5, III between 1.5 and 2. So one number walks the
 * whole scale from the clearest mid-ocean blue to coastal green.
 *
 * The pure water absorption is measured. The living part is a simplified stand
 * in for the full bio-optical model: chlorophyll absorption with its blue and
 * red peaks, dissolved organics falling exponentially out of the blue, and
 * particulate backscatter. It is the shape that matters here, and the shape is
 * right: raising chlorophyll eats the blue first, which is exactly how real
 * water goes from blue to green.
 */
export function waterOptics(chlorophyll: number): WaterOptics {
  const absorption: number[] = [];
  const backscatter: number[] = [];

  // Dissolved organics scale with the biology and are anchored at 440nm.
  const cdom440 = 0.08 * Math.pow(chlorophyll, 0.63);
  // Particulate backscatter, anchored at 550nm, falling roughly as 1/lambda.
  const particles550 = 0.002 * Math.pow(chlorophyll, 0.62);

  RGB_NM.forEach((nm, channel) => {
    const water = PURE_WATER_ABSORPTION[channel];
    const phytoplankton = CHLOROPHYLL_ABSORPTION[channel] * chlorophyll;
    const dissolved = cdom440 * Math.exp(-CDOM_SLOPE * (nm - 440));
    absorption.push(water + phytoplankton + dissolved);

    const molecular =
      PURE_WATER_SCATTER_500 * Math.pow(500 / nm, SCATTER_EXPONENT);
    const particulate = particles550 * (550 / nm);
    // Molecular scattering is symmetric, so half of it goes backwards.
    backscatter.push(molecular / 2 + particulate);
  });

  const attenuation = absorption.map((a, i) => a + backscatter[i] * 2);

  // Morel and Prieur: the fraction coming back out of optically deep water is
  // proportional to backscatter over absorption. Under a tenth of a percent in
  // red, nine percent in blue, for the clearest water there is.
  const reflectance = absorption.map(
    (a, i) => (0.33 * backscatter[i]) / (a + backscatter[i]),
  );

  return {
    absorption: absorption as [number, number, number],
    backscatter: backscatter as [number, number, number],
    attenuation: attenuation as [number, number, number],
    reflectance: reflectance as [number, number, number],
  };
}

/** Beer-Lambert transmittance through a path of water, per channel. */
export function transmittance(
  optics: WaterOptics,
  metres: number,
): [number, number, number] {
  return optics.attenuation.map((k) => Math.exp(-k * metres)) as [
    number,
    number,
    number,
  ];
}
