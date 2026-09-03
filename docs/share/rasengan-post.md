# Sharing the Rasengan sketch

Live: https://yingyen.com/lab/rasengan
The rebuild prompt lives on the page itself (lib/lab.ts, `prompt`), with a
copy button. Both posts send readers there.

Video: `rasengan-clip.mp4` (1884x942, 11s) and `rasengan-clip-720.mp4`
(1280x640, smaller). Both are H.264 in mp4, which is what X and LinkedIn
take. The clip runs: 2s at rest, the pointer arrives and it charges for 6s,
then it settles for 3s. Recorded straight off the canvas, no screen capture,
so it is clean.

Push before posting. The page 404s on production until it ships, and a link
to a 404 shows no card at all.

## X (under 280 characters)

The text as posted lives in `x-post.txt`, ready to paste. X counts a URL as
23 characters whatever its length, which is what makes it fit.

Naruto's Rasengan in one WebGPU fragment shader. No noise, no textures: 144 circles on a sphere, dot(n, a) = h, one multiply each.

Hover to charge it. The whole recipe is on the page as a prompt you can copy: yingyen.com/lab/rasengan

#WebGPU #shaders

Attach `rasengan-clip-720.mp4` to this post, not to a reply: a post with no
media and no link is invisible in a timeline.

### Tags

X counts hashtags toward the 280, so two or three at most. The post above
is 266 characters, which leaves room for one short tag; trim a clause if
you want two. In rough order of usefulness here:

- #WebGPU        the smallest, most on-topic audience. Use this one.
- #WGSL          tiny but exactly the right people.
- #shaders       broad, active, full of this kind of work.
- #creativecoding  large and friendly to sketches like this.
- #glsl          not literally correct but where the shader crowd lives.
- #Naruto        huge reach, wrong audience: expect fans, not engineers.

Recommended: end with "#WebGPU #shaders" and drop "no noise." to make room.
Put @naruto_official or fandom tags nowhere; this is fan work and tagging
a rights holder invites trouble.

LinkedIn treats hashtags as topic follows rather than search, so three to
five broad ones work better there: #WebGPU #ComputerGraphics #Shaders
#CreativeCoding #Frontend

## LinkedIn (technical only)

The text as posted lives in `linkedin-post.txt`, ready to paste. Attach the
same clip. LinkedIn hides everything after about 210 characters behind "see
more", so the first two sentences carry the post.

A ball of chakra in one WebGPU fragment shader, and how little maths it took.

The lines are circles on a sphere: the set of directions n where dot(n, a) = h, for an axis a and an offset h. One multiply per line. 144 of them in four groups, each group rotated about its own axis at its own speed, evaluated on four nested shells front and back, and the net is done. No noise, no textures.

The rest is the same habit: reduce every effect to a number per pixel.

- The arcs that orbit the ball are ray-plane intersections, with a per-lap hash so no two passes match.
- The body is a density field that thins with radius, so the glow has no edge.
- The background is a real HDRI, log-encoded into an 8-bit WebP so eight bits carry seventeen stops, with mip-based depth of field and a bloom pass on top.

Straight WGSL on vgpu, no engine. Hover the ball and it charges: bigger, brighter, faster.

Live at yingyen.com/lab/rasengan. The whole recipe is on the page as a prompt with a copy button, so you can hand it to an AI and rebuild it yourself.

#WebGPU #ComputerGraphics #Shaders #CreativeCoding #Frontend

## Is it appropriate to share

Yes, with two cautions.

- It is fan work on a trademarked, copyrighted property. Say "inspired by"
  or "from Boruto: Naruto the Movie", do not imply affiliation, and do not
  post the film frames. Your own renders are yours.
- The Poly Haven HDRIs are CC0, no credit required, but a line of credit is
  good manners and costs nothing.
