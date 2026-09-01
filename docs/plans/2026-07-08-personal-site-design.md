# Personal Site Design

Date: 2026-07-08, v3 on 2026-07-09 (liquid metal blob + longer page)
Origin: X article "个人网站，是你上手 Codex 的最好项目" and Rauch's "you need a
page describing what you shipped."

## Goal

A beautiful, memorable one-page personal site for YingYen Liu, Frontend
Engineer. v2 direction per user: light palette (no black/dark theme), no
portfolio list for now, a Blender-authored 3D centerpiece, "single exquisite
page" over content volume.

## Direction: digital atelier

Porcelain-light gallery page with one glazed cobalt sculpture as the signature.

### Tokens

- paper `#f6f7f9` cool porcelain background
- ink `#20242e` deep slate text (never pure black)
- muted `#6a7080`, faint `#9aa1b0`, line `#e4e7ed`
- accent `#2742e8` ultramarine
- Washes: pale periwinkle (top right) + whisper of peach (bottom left),
  as radial gradients (`.atelier-bg`)
- Type: Fraunces (display, light weight, italic accent line) + Geist Sans
  body + Geist Mono for eyebrow/labels

### Signature (v3): the liquid-metal slime

One fixed full-viewport R3F canvas lives for the whole page
(`components/blob/`). The blob is an icosphere displaced in a custom vertex
shader (simplex noise injected into MeshPhysicalMaterial via
onBeforeCompile, normals recomputed numerically with a wide epsilon for a
soft waxy look): a strong low-frequency octave keeps the silhouette
irregular and always flowing (never a sphere), a faint second octave adds
drift, and a click rings a decaying high-frequency ripple through the
surface. Material is soft metal (metalness 0.85, roughness 0.34,
envMapIntensity 0.55) after "reflections too strong" feedback.

Normals are seam-free: tangential gradient of the displacement field via
central differences along fixed world axes (an earlier tangent-branch
method left a visible crease line across the body).

Locomotion is slime-physics: the body stretches hard along its velocity
(factor 0.34, up to 2.1x) and squashes perpendicular (shortest-path angle
blend), takes springy squash impulses on touch. Clicks rotate through four
reactions: flinch (shove away + surface ring), boil (whole surface erupts
in place), spin (whips around its axis, random direction), and jump
(springy hop upward).
Movement (v4, 2026-07-11): the blob is small (BASE_SCALE 0.34) and lives in
viewport space like a creature. It crawls along a superellipse rim path
pressed into the screen edges at a randomized pace. Snail adhesion
(2026-07-13): the viewport is a glass box in the vertex shader — vertices
soft-clamp (polynomial smin, k 0.22) against all four screen-edge planes
in world space via modelMatrix, then return to object space through a
per-frame uModelInv uniform. The rim path centers the body only 0.55 of
the mean radius from the edge, so the pressed side flattens into a wide
contact patch (foot) while the free side keeps its lobes. Sine drift is
damped to 45% while rim-crawling so the foot stays planted (direction flips,
occasional excursions: ~35% of mode switches send it gliding to a random
point in the middle where it dwells 2.5-5.5s before returning to the rim
where it left off). A soft sum-of-sines drift rides on top; damping is
loose (lambda 2.1) so travel reads as gliding through water. Scroll
anchors are gone; scroll velocity still agitates the surface. Canvas is
pointer-events-none; hit testing runs on window pointer events. The
material/uniforms live in a module-level store to stay outside React
Compiler's immutability rules. Reduced motion parks it at the lower-right
rim, frozen.

Hard-won bug: r3f can deliver delta=0 on a frame; dividing by it NaN'd the
velocity/spring refs and the NaN reached the mesh matrix, blanking the
blob permanently. dt is now clamped to [1e-4, 0.05].

The hero name is set huge in Fraunces, two staggered lines ("YingYen" offset
left, italic ultramarine "Liu" offset right); the blob floats in front of the
name (name z-0, canvas z-10) but behind all section copy (z-20). On mobile
the name shifts up 14svh and the blob scales down.

### Page structure

Hero (100svh) → About → Craft (3 items, content right-aligned so the blob
can sit left) → Now (UIPrompt, Practical AI Stack) → Contact
("Say hi." + email, blob hovers small above) → footer (blob credit line).

v2 signature (removed): Blender-generated trefoil GLB; the bpy generator
script survives in the session scratchpad if ever needed again.

### Fallbacks

- No WebGL: typographic hero still renders (name is real DOM text always)
- Reduced motion: static sculpture, frameloop demand, no rise animations
- GLB loads via Suspense; the page is complete without it

## History

v1 (earlier today): dark Linear/Vercel-style one-pager with a 15k-particle
"YINGYEN LIU" text hero and a hover-preview work list. Rejected as too plain
and stiff wanting more visual impact; then direction changed to light + no
work section. v1 components remain in the repo but unrendered: `Whoami.tsx`,
`hero/ParticleName.tsx`, `WorkList.tsx`, `public/previews/*`,
`public/models/sculpture.glb` is v2.

## Open items (need real values)

- GitHub / X handles and email are placeholders in `lib/site.ts`
- Favicon is still the Next.js default
