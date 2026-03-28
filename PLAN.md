# Kinetik — Build Plan

## Status: Phase 2b COMPLETE, Phase 3 IN PROGRESS

### Phase 1: Core Pipeline — DONE
- [x] RunPod pod running (RTX 5000 Ada 32GB, pod ID: c8sh4j1k8nkzp9)
- [x] Kimodo installed on /workspace (persistent)
- [x] Model weights cached at /workspace/hf_cache (~16GB)
- [x] **Fast server** — model loaded in memory, 2-3 sec per generation
- [x] FastAPI server with /health, /generate-motion, /exec, CORS enabled
- [x] API proxy: https://c8sh4j1k8nkzp9-8000.proxy.runpod.net
- [x] BVH generation working (338KB, valid 77-joint SOMA skeleton)
- [x] **Kinetik UI** — index.html with 3D viewport + agent console
- [x] End-to-end: type prompt → API call → BVH → animated skeleton in browser

### Phase 2: Gemini Scene Agent — DONE
- [x] Gemini 2.5 Flash decomposes prompt → SceneConfig JSON
- [x] Motion-first pipeline: generate BVH → extract path → plan scene around it
- [x] Layout engine with path clearance, collision resolution, bounding box separation
- [x] Agent Console shows real-time status for each agent
- [x] Status pills glow during generation
- [x] Motion prompt enhancement (silently rewrite for better Kimodo results)
- [x] Motion retry — if character doesn't travel >50 units, regenerates (up to 3 retries)

### Phase 2b: 3D Model System — DONE
- [x] **Poly Pizza DISABLED** — replaced by custom pipeline
- [x] **Nanobanana + Trellis v1 pipeline** — Gemini image gen → fal.ai 3D reconstruction
- [x] ~73 pre-generated GLB models in `models/` folder
- [x] MODEL_MAP keyword matching for scene objects
- [x] Procedural fallback models for trees, pines, bushes, rocks (geometric generators)
- [x] Custom model creation in editor (type name → Nanobanana → Trellis → place)
- [x] fal.ai API key configured (see .env)
- [x] Cost: ~$0.02 per model (Trellis v1)

### Phase 2c: Scene Polish — DONE
- [x] Compact world layout (MAP_RANGE 500, not 1500)
- [x] Dynamic ground sizing — ground fits to furthest object, not fixed size
- [x] Auto-fill trees/rocks scattered randomly with path clearance
- [x] Dynamic world extension — new trees spawn as character moves (every 200 units)
- [x] Ground follows character position
- [x] Same-keyword size consistency (duplicate objects = same size, trees vary ±20%)
- [x] Bounding box collision resolution (objects push apart if overlapping)
- [x] Bush size capped at 20, trees minimum 120
- [x] Large objects (buildings) scaled to 435 outdoor, 175 indoor

### Phase 2d: Editor & UI — DONE
- [x] Welcome screen with 3D character preview (separate renderer)
- [x] Preview cycles through 5 BVH animations (backflip, dancing, spinning kick, sneaking, vibing)
- [x] Left-aligned welcome with tagline + right-side preview box
- [x] Example scene pills (City, Park, Spooky, Victory)
- [x] Scene editor: Add, Move, Rotate, Scale modes
- [x] Model picker panel (left side, collapsible, 2-column grid with emoji icons)
- [x] Cursor-following placement (model follows mouse, click to place, Escape to cancel)
- [x] Motion timeline with clip merging and blend transitions
- [x] Timeline append (type prompt in timeline to add more motion)
- [x] Click-to-select scene objects, Delete to remove
- [x] Path visualization with waypoints, direction arrows, start/end markers
- [x] Keyboard shortcuts (Space, M, R, S, Escape, Delete)

### Phase 3: Lyria RealTime (Soundtrack) — NOT STARTED
- [ ] Connect to Lyria RealTime WebSocket (model: `models/lyria-realtime-exp`)
- [ ] Use same Gemini API key, apiVersion: `v1alpha`
- [ ] Use music_prompt + music_params from Gemini's SceneConfig
- [ ] Stream 48kHz stereo PCM audio → Web Audio API playback
- [ ] Dynamic mood steering (brightness, density, weighted prompts)
- [ ] Do NOT change BPM mid-session (causes hard audio cut)
- [ ] 10-minute session limit
- [ ] Can connect directly from browser (WebSocket, no CORS issues)

### Phase 4: Polish & Demo Prep
- [ ] .kinetik file export (JSON scene state)
- [ ] Camera orbit recording (click point → 5s spin → download MP4)
- [ ] Pre-warm one generation for demo
- [ ] Record backup video
- [ ] Pitch deck

---

## Architecture
```
User prompt
    │
    ▼
Gemini 2.5 Flash (orchestrator)
    ├──→ SceneConfig JSON ──→ Layout engine ──→ Three.js renders environment
    ├──→ motion_prompt ──→ Kimodo on RunPod ──→ BVH ──→ Three.js skeleton
    ├──→ music_prompt ──→ Lyria RealTime ──→ streaming audio (TODO)
    └──→ model keywords ──→ MODEL_MAP ──→ pre-generated GLB assets
```

## Google Products Used
| Product | Purpose |
|---------|---------|
| Gemini 2.5 Flash | Scene decomposition & orchestration |
| Nanobanana (Gemini Flash Image) | 3D asset concept image generation |
| Lyria RealTime (TODO) | Dynamic streaming soundtrack |

## Key Endpoints
| Endpoint | URL |
|----------|-----|
| Kimodo API | https://c8sh4j1k8nkzp9-8000.proxy.runpod.net |
| Health | GET /health |
| Generate | POST /generate-motion {prompt, duration} |
| Remote exec | POST /exec {cmd} |

## Key Constraints
- Kimodo max 10 sec per prompt, prompts start with "A person..."
- Kimodo cannot do full body inversions (backflips don't actually flip)
- Use --no-postprocess (no C++ module)
- Lyria RealTime: 10 min session limit, BPM changes need reset_context()
- Don't restart the pod — everything is installed and cached
- ~$100 Gemini API credits from hackathon
- $10 fal.ai balance (~500 Trellis v1 generations)
