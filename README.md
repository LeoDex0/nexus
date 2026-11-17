# NEXUS

Concept website for a fictional computing company. Project 04 of the LeoDex portfolio.

Live: https://nexus-chi-eight-45.vercel.app

NEXUS is not a real company. Its products, figures, offices and people are invented. The briefing form runs in the browser only and sends nothing.

## What is inside

| Part | Description |
| --- | --- |
| Core | A procedural 3D object in Three.js: five machined rings (titanium bezel with a light channel, anodised segments, chrome gear, titanium truss, optical ring with six lenses) on bearings around a faceted glass lattice |
| Interaction | Hover names each part, click opens Inspect mode where the parts separate and are labelled, press and hold spins the rings up and settles them into a new configuration |
| Motion | Opening sequence, idle calibration cycles, scroll-driven camera from hero to the core section, a dive into the lattice, an exploded view for the architecture |
| Intelligence | A 3D network of four shells; signals travel inward and back out, the routes they use get stronger; four stages to step through |
| Architecture | The same object as a five-layer stack; layers are picked from the index or by clicking them in 3D |
| Capabilities | Four canvases: isometric load grid, freight streams around a closure, a 3D crystal lattice, optical sensor channels |
| Live system | Three optimisers that really run in the browser: 2-opt routing with a storm, DC power flow with redispatch and load shedding, k-means site placement |
| Vision | A light editorial section with a technical drawing that draws itself on scroll |

## Stack

Vite, TypeScript, Three.js, GSAP with ScrollTrigger and SplitText, Lenis. No framework, no backend.

## Run

```
npm install
npm run dev
npm run build && npm run preview
```

## Structure

- `index.html` all sections
- `src/main.ts` boot: device profile, loader, 3D stage, sections, one shared ticker
- `src/gl` renderer and camera poses, the core model, materials, studio lighting, atmosphere, particles, callouts
- `src/intel` the Intelligence network
- `src/viz` Grid, Flow, Matter and Signal
- `src/live` the live console and its three optimisers
- `src/sections` hero, scroll story, navigation, reveals, vision, call to action
- `src/styles` tokens and section styles

## Performance

One WebGL canvas is shared by the hero, core, architecture and final sections and stops rendering while hidden. The Intelligence network and the 3D Matter specimen load only when their sections come near. Phones get simpler glass, fewer particles and a lower pixel ratio. Reduced motion is respected, and the page still works without WebGL.
