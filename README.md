# yingyen-site

Personal site for YingYen Liu, frontend engineer. One page, plus a lab of
WebGPU sketches.

**Live:** [yingyen.com](https://yingyen.com)

The page background is not an image or a CSS gradient. It is a fragment
shader running on the GPU, redrawn every frame.

## The lab

Four sketches at `/lab`. Three are raw WGSL on
[vgpu](https://github.com/vercel-labs/vgpu) with no renderer underneath. The
fourth is three.js driving WebGPU through TSL node materials.

| Sketch | What it does |
| --- | --- |
| [Open Water](https://yingyen.com/lab/ocean) | A Tessendorf FFT ocean, simulated on the GPU every frame |
| [Curl Field](https://yingyen.com/lab/particles) | 163,840 particles advected through a curl noise field |
| [Still Water](https://yingyen.com/lab/ripple) | The wave equation, solved in a ping-pong texture pair |
| [Paper Weather](https://yingyen.com/lab/aurora) | Domain-warped fBm, sampled three levels deep |

**Open Water.** Real ocean renderers do not add waves together, they inverse
transform a spectrum. A Phillips spectrum says how much energy the wind puts
into each wavenumber; multiplying it by a complex Gaussian turns that smooth
curve into an actual random sea; and an inverse FFT turns the whole spectrum
into a height field in one shot. That is Tessendorf's method, and it is what
film and game oceans have used for twenty years.

Here it runs as WebGPU compute: a radix-2 butterfly with a CPU-precomputed
twiddle table, twenty dispatches a frame, two cascades stacked in one buffer so
the entire ocean transforms at once. Four things in it are worth writing down.

Each buffer element is a `vec4` carrying two complex channels, so one butterfly
pass moves four real fields rather than one. That works because two Hermitian
spectra pack cleanly into the real and imaginary halves of a single complex
transform, and height, x displacement and z displacement are all Hermitian by
construction.

The ping-pong parity runs across the horizontal and vertical phases as one
chain of `2*log2(N)` swaps. Counting per phase instead only lands the result
back in the source buffer when `log2(N)` happens to be even, and at every other
size the vertical phase silently reads stale data. That bug survives visual
inspection perfectly well, which is why the transform is gated at startup in
development against two spectra whose results can be worked out by hand: a unit
at DC must come back as a constant, and one step off DC must come back as a
single cosine.

The spectrum is calibrated through Parseval rather than by taste. The transform
is the raw synthesis sum with no `1/N^2`, so the Phillips constant on its own
says nothing about how tall the water will be; the variance of the height field
is the sum of the squared spectrum, so scaling by the ratio of target to actual
RMS produces a sea of exactly the significant wave height asked for, in metres.

Foam comes from the determinant of the horizontal displacement Jacobian, taken
from central differences of the displaced surface. Below one the water is
compressing and near zero it is folding over itself, and folding is what
breaking is. Thresholding height instead smears foam across every tall smooth
swell.

Shading is Schlick against water's real index of refraction, GGX for the sun
glitter because a raised cosine either blooms into plastic or shrinks to a dot,
and an analytic sky that is at once the background, the only light in the scene
and every reflection in the water.

**Curl Field.** Every particle is four floats, position and velocity, in one
storage buffer. A compute pass rewrites that buffer in place each frame and
the render pass reads the same memory as instance data, so 163,840 particles
never travel back to the CPU. The flow field is curl noise, the perpendicular
of a noise gradient. A perpendicular field has zero divergence, which is why
the particles circulate forever instead of draining into sinks.

**Still Water.** Two `rgba16float` targets swap roles every frame. Red holds
the surface now, green holds where it was last frame, and that second channel
is the entire reason a wave keeps travelling rather than snapping flat. Each
step is the discrete wave equation over the four neighbours; with a wave speed
squared of 0.5 the current-height terms cancel and it reduces to
`sum * 0.5 - previous`. A second pass turns the height slope into a normal and
lights it.

**Paper Weather.** Fractal noise sampled at coordinates that are themselves
fractal noise, twice over. One pass gives clouds. Feeding the result back as
the sample position gives currents and eddies. The pointer bends the warp
field rather than painting onto it, so the cursor drags the whole image around
instead of leaving a mark.

## Notes on the build

**One hook per backend, one lifecycle.** `useVgpuCanvas` holds the vgpu
device, surface, clock and frame loop; `useThreeCanvas` does the same job for
three's `WebGPURenderer`. Both hand off to the same `whileVisible` helper and
present through the same frame component, so pausing offscreen, honouring
`prefers-reduced-motion` and disposing on unmount are written once rather than
once per sketch. A sketch only returns the function that advances a frame.

**Offscreen canvases stop.** An IntersectionObserver and a `visibilitychange`
listener stop the loop when a sketch scrolls out of view or the tab is
backgrounded. A portfolio page should not keep a laptop fan running.

**Reduced motion gets a still, not a blank.** A simulation that starts empty
renders nothing on frame one, so the reduced-motion path runs a fixed warm-up
and stops. Still Water settles at 150 frames.

**No WebGPU, no broken page.** The hero falls back to the original React Three
Fiber blob, a liquid-metal creature that crawls the rim of the viewport, so
the design that shipped first is still what non-WebGPU browsers get. The lab
sketches say plainly what they need.

Two vgpu details worth writing down. `effect()` takes a plain WGSL string, so
the Turbopack `.wgsl` loader configured in vgpu's own example turns out to be
unnecessary. And `surface.onResize` fires from inside a frame, which vgpu
refuses to open a frame within, so a redraw triggered by a resize has to defer
to the next animation frame.

## Stack

Next.js 16, React 19, Tailwind v4, TypeScript. WebGPU two ways: vgpu 0.3.x for
the raw WGSL sketches, pinned because it is pre-1.0 and its API can still move,
and three.js `WebGPURenderer` with TSL for the one that needs a scene. React
Three Fiber for the fallback blob. Static export, deployed on Vercel.

## Running it

```bash
npm install
npm run dev
```

Open [localhost:3000](http://localhost:3000). The lab needs a browser with
WebGPU: Chrome, Edge, or Safari 26.

```bash
npm run build   # static export into out/
npm run lint
```
