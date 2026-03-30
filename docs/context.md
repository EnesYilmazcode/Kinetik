# KINETIK — Complete Project Briefing for Claude Code

## WHO I AM

I'm Enes Yilmaz, a CS & Engineering junior at Ohio State University. I'm at the GLITCH x Google DeepMind hackathon at UCLA right now. I've won multiple hackathons before — 1st place at HackIllinois (Open Reality, browser-based spatial AI using VGGT-1B + SAM3 + Three.js), 1st place at Voice HackSprint (Gridion), 1st place at IBM SkillsBuild (Sparky with Colin Lee). I know how to ship under pressure.

My tech stack: Python, JavaScript/TypeScript, React, Three.js, FastAPI, LangChain, Firebase. I have experience with computer vision, LLM agents, and 3D rendering in the browser.

## THE HACKATHON

This is the GLITCH UCLA hackathon, sponsored by Google DeepMind. It's a ~24 hour build sprint focused on building with Google's AI tools. There are multiple tracks and prize categories:

**Tracks:**
- Veo (video generation)
- Nanobanana (image generation)
- Lyria (music generation)
- Live (real-time interaction)
- Best Overall
- 10 runner-up teams

**Judging Criteria (from the Gemini 3 hackathon framework these events follow):**
- Technical Execution: 40% — code quality, Gemini usage, functionality
- Innovation / Wow Factor: 30% — novelty, originality
- Potential Impact: 20% — real-world usefulness, scalability
- Presentation / Demo: 10% — clear problem definition, effective demo

**What they explicitly DON'T want:** Simple prompt wrappers, baseline RAG, single-prompt solutions. They said "in the Action Era, if a single prompt can solve it, it is not an application."

**We get ~$100 of Gemini API credits from the hackathon.**

**I'm submitting to: Lyria track + Best Overall.**

## WHAT I'M BUILDING: KINETIK

Kinetik is an agentic scene generation platform. You type one sentence describing a scene, and it generates a full 3D animated scene with a character performing the described action, placed in a generated environment, with a dynamically generated soundtrack — all from that single prompt.

**The pitch:** "Pre-vis for the rest of us. Describe a scene in English, watch it come to life as an interactive 3D animation with a soundtrack. No mocap studio, no animators, no Blender. Just language in, cinematic animation out."

**The problem it solves:** 3D character animation costs $5K-$50K per minute. Indie game devs, filmmakers, and content creators are completely locked out. Motion capture requires $10K+ hardware. Text-to-image and text-to-video exist, but text-to-interactive-3D-animation does not exist yet. Kinetik fills that gap.

## THE ARCHITECTURE

```
User: "A person sneaks through a dark warehouse then runs"
                    │
                    ▼
        ┌─────────────────────┐
        │   GEMINI 3 PRO      │
        │   (Orchestrator)     │
        │                     │
        │ Outputs structured  │
        │ JSON with:          │
        │ • SceneConfig       │
        │ • motion_prompt     │
        │ • music_prompt      │
        │ • music_params      │
        └─────┬───┬───┬───────┘
              │   │   │
     ┌────────┘   │   └────────┐
     ▼            ▼            ▼
┌──────────┐ ┌──────────┐ ┌──────────────┐
│ GEMINI   │ │ KIMODO   │ │ LYRIA        │
│ Scene    │ │ (RunPod) │ │ REALTIME     │
│ Agent    │ │          │ │              │
│          │ │ Text →   │ │ Streams      │
│ JSON →   │ │ Motion   │ │ matching     │
│ Three.js │ │ BVH/NPZ  │ │ soundtrack   │
│ objects  │ │ output   │ │ via WebSocket│
└────┬─────┘ └────┬─────┘ └──────┬───────┘
     │            │              │
     └─────┬──────┘              │
           ▼                     │
  ┌─────────────────┐           │
  │ THREE.JS        │◄──────────┘
  │ RENDERER        │
  │                 │
  │ Scene + Animated│
  │ Character +     │
  │ Synced Audio    │
  └─────────────────┘
```

## THE THREE CORE TECHNOLOGIES

### 1. NVIDIA Kimodo (Motion Generation) — Running on RunPod

Kimodo is a kinematic motion diffusion model released by NVIDIA literally 2 weeks ago (March 16, 2026). It's trained on 700 hours of professional optical motion capture data. It takes a text prompt like "A person walks forward casually" and generates high-quality 3D skeletal animation in 2-5 seconds.

**I JUST got Llama 3 access approved on HuggingFace** (this was blocking me for hours — Kimodo uses LLM2Vec which requires Meta-Llama-3-8B-Instruct as its text encoder, and that model is gated behind a license approval). My HF token now has access.

**My setup:**
- RunPod GPU pod (RTX 4090 24GB or L40S 48GB)
- Kimodo requires ~17GB VRAM (mostly for the text encoder)
- Install: `pip install "kimodo[all] @ git+https://github.com/nv-tlabs/kimodo.git"`
- Login: `huggingface-cli login --token <my_token>`
- Generate: `kimodo_gen --prompt "A person walks forward" --duration 5 --output /tmp/motion --bvh`
- First run downloads models (~15-20 min for text encoder). After that, 2-5 sec per generation.
- Output: NPZ files containing `posed_joints [T, 77, 3]` (global joint positions per frame at 30fps) and BVH files (standard motion capture format that Three.js can load with BVHLoader)

**My HuggingFace token is saved in a local file called kimodo.txt. The key starts with hf_vP...**

**Kimodo limitations to know:**
- Max 10 seconds per prompt
- Prompts should start with "A person..."
- Works best with: locomotion, gestures, everyday activities, combat, dancing, styles (tired, angry, happy, drunk, injured, stealthy)
- Does NOT work for: sports-specific actions (baseball, tennis), actions outside training data
- Can chain multiple prompts for longer sequences
- Post-processing helps with foot skating artifacts

**NPZ output format:**
- `posed_joints`: Global joint positions [T, 77, 3]
- `global_rot_mats`: Global joint rotation matrices [T, 77, 3, 3]
- `local_rot_mats`: Local rotation matrices [T, 77, 3, 3]
- `foot_contacts`: Foot contact labels [T, 4]
- `root_positions`: Root joint trajectory [T, 3]

**BVH output:** Standard BVH format using the 77-joint SOMA skeleton. Three.js has a built-in BVHLoader that creates a Skeleton + AnimationClip directly from BVH files.

### 2. Google Gemini 3 Pro (Orchestrator + Scene Generation)

Gemini is the brain of the system. It does TWO things:

**A) Orchestration:** Takes the user's natural language prompt and decomposes it into structured JSON:
```json
{
  "scene": {
    "objects": [
      {"type": "box", "position": [0, 0, 0], "size": [20, 0.1, 20], "color": "#333333", "name": "floor"},
      {"type": "box", "position": [-5, 1.5, 0], "size": [2, 3, 2], "color": "#8B4513", "name": "crate"},
      ...
    ],
    "lights": [
      {"type": "ambient", "intensity": 0.3, "color": "#1a1a2e"},
      {"type": "directional", "position": [5, 8, 3], "intensity": 0.7, "color": "#ffffff"}
    ],
    "camera": {"position": [8, 5, 8], "lookAt": [0, 1, 0]},
    "fog": {"color": "#0a0a14", "near": 5, "far": 30}
  },
  "character": {
    "position": [0, 0, 0],
    "scale": 1.0
  },
  "motion_prompt": "A person sneaks forward cautiously in a crouched position",
  "music_prompt": "dark tense ambient suspenseful cinematic",
  "music_params": {
    "bpm": 70,
    "brightness": 0.2,
    "density": 0.3
  }
}
```

IMPORTANT: Gemini outputs a SceneConfig JSON object, NOT raw Three.js code. This is more reliable than code generation — my frontend parses the JSON and creates Three.js objects deterministically. No syntax errors, no debugging generated code.

**B) Scene code generation:** The frontend takes the SceneConfig JSON and creates Three.js meshes, lights, camera, fog, etc. This is deterministic code that I write, not Gemini-generated code.

**Gemini API usage:**
```python
import google.generativeai as genai
genai.configure(api_key="HACKATHON_API_KEY")
model = genai.GenerativeModel("gemini-3-pro")
```

### 3. Lyria RealTime (Dynamic Soundtrack)

This is my secret weapon for the Lyria track. Lyria RealTime is Google's experimental real-time streaming music generation model. Unlike Lyria 3 Clip (which always generates fixed 30-second clips), RealTime streams music continuously via WebSocket in 2-second chunks.

**Why RealTime is perfect for this project:**
- Music starts instantly (no waiting for a full clip to generate)
- I can dynamically steer the music as the scene progresses
- If the animation goes from "sneaking" to "running", I morph the music from "tense ambient" to "fast chase" using `set_weighted_prompts`
- It's free to use right now (experimental)

**Key Lyria RealTime details:**
- Uses WebSocket connection
- Generates 48kHz stereo audio in 2-second chunks
- Control via: weighted prompts, BPM, brightness (0-1), density (0-1), scale
- IMPORTANT: Changing BPM or Scale requires `reset_context()` which causes a tiny audio gap. For smooth transitions, only change Weights, Density, and Brightness during the scene.
- The model needs ~5-10 seconds to "settle" into a stable groove when starting
- Instrumental only (no lyrics/vocals)
- Session limit: 10 minutes, then restart

**Lyria RealTime API pattern:**
```python
import asyncio
from google import genai

client = genai.Client()

async def stream_music(prompt, bpm=120):
    async with client.aio.live.music.connect(
        model="models/lyria-realtime-exp"
    ) as session:
        await session.set_weighted_prompts([
            {"text": prompt, "weight": 1.0}
        ])
        await session.set_music_generation_config({
            "bpm": bpm,
            "density": 0.5,
            "brightness": 0.5
        })
        await session.play()
        async for chunk in session:
            # chunk contains raw audio bytes
            yield chunk.data
```

## THE FRONTEND UI

The UI should look like a professional IDE / animation tool. NOT a chatbot. Think VSCode meets After Effects.

**Layout:**
- **Main area (70% of screen):** Full Three.js 3D viewport showing the animated scene
- **Right panel (30%):** Agent Console — a chat-like interface showing the orchestrator's thought process as it decomposes the prompt and delegates to sub-agents (Scene Agent, Motion Agent, Audio Agent). Users type their scene descriptions here.
- **Bottom bar:** Timeline with playback controls (play/pause/scrub), showing clips for motion, scene, and audio tracks. Playhead indicator.
- **Top bar:** App name "KINETIK", version badge, agent status pills showing which agents are working

**Design direction:** Dark theme, IDE aesthetic. Think deep navy/charcoal backgrounds (#0a0a14), purple accent colors (#a78bfa), monospace fonts for technical elements (JetBrains Mono), sans-serif for body text (IBM Plex Sans). Status pills glow when agents are active. Animated shimmer loading bars instead of spinners.

**I already have a React prototype of this UI (motionforge.jsx) that simulates the agent flow. It needs to be wired to real API calls.**

## THE TECH STACK

| Component | Technology |
|-----------|-----------|
| Frontend | React + Three.js (r128 from CDN) |
| 3D Rendering | Three.js BVHLoader + SkeletonHelper + AnimationMixer |
| Motion Generation | NVIDIA Kimodo on RunPod (FastAPI wrapper) |
| Scene Orchestration | Gemini 3 Pro API |
| Soundtrack | Lyria RealTime (WebSocket) |
| Backend | FastAPI (Python) on RunPod |
| Deployment | Vercel (frontend) or local dev server |

## THE BACKEND (FastAPI on RunPod)

This runs on the same RunPod GPU pod as Kimodo:

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
import subprocess
import numpy as np
import json
import os

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

@app.post("/generate-motion")
def generate_motion(data: dict):
    prompt = data["prompt"]
    duration = data.get("duration", 5.0)
    
    output_path = f"/tmp/motion_{hash(prompt)}"
    
    subprocess.run([
        "kimodo_gen",
        "--prompt", prompt,
        "--duration", str(duration),
        "--output", output_path,
        "--bvh"
    ], check=True)
    
    # Return the BVH file for Three.js to load
    bvh_path = f"{output_path}.bvh"
    if os.path.exists(bvh_path):
        return FileResponse(bvh_path, media_type="text/plain", filename="motion.bvh")
    
    # Fallback: return NPZ joint data as JSON
    npz_path = f"{output_path}.npz"
    data = np.load(npz_path)
    return {
        "posed_joints": data["posed_joints"].tolist(),
        "root_positions": data["root_positions"].tolist(),
        "fps": 30,
        "num_frames": len(data["posed_joints"])
    }

@app.get("/health")
def health():
    return {"status": "ok", "model": "kimodo-soma-rp-v1"}
```

Run with: `uvicorn server:app --host 0.0.0.0 --port 8000`

The endpoint will be accessible at: `https://PODID-8000.proxy.runpod.net`

## THREE.JS RENDERING

**For BVH (preferred — easier):**
```javascript
import { BVHLoader } from 'three/addons/loaders/BVHLoader.js';

const loader = new BVHLoader();
const result = await loader.loadAsync(bvhUrl);

// Create skeleton visualization
const skeletonHelper = new THREE.SkeletonHelper(result.skeleton.bones[0]);
scene.add(result.skeleton.bones[0]);
scene.add(skeletonHelper);

// Play animation
const mixer = new THREE.AnimationMixer(result.skeleton.bones[0]);
mixer.clipAction(result.clip).play();

// In render loop:
function animate() {
    requestAnimationFrame(animate);
    mixer.update(clock.getDelta());
    renderer.render(scene, camera);
}
```

**For NPZ joint positions (fallback — stick figure):**
Draw lines between joint positions each frame using THREE.BufferGeometry. Update positions in the render loop based on frame index.

## THE DEMO FLOW

1. Open Kinetik — show the IDE-like interface
2. Type: "A person sneaks through a dark warehouse then starts running"
3. Agent Console shows Gemini decomposing the prompt in real-time:
   - Orchestrator: "Analyzing prompt... decomposing into scene, motion, and audio..."
   - Scene Agent: "Generating warehouse environment... crates, dim lighting, fog..."
   - Motion Agent: "Calling Kimodo API... generating sneaking motion..."
   - Audio Agent: "Starting Lyria RealTime stream... tense ambient soundtrack..."
4. Three.js viewport populates with the environment
5. Character appears and starts the sneaking animation
6. Lyria music streams in — dark, tense, ambient
7. (If time allows) Show the music morphing when the action changes
8. Close with: "This entire animated scene was generated from one sentence. No mocap. No animators. No Blender."

## WIREFRAME CONSTRUCTION MODE (cool detail)

Instead of showing a loading spinner while waiting for generation, show a "wireframe construction" mode in Three.js where the scene physically assembles itself:
- Objects fade in as wireframes first, then fill with color
- The grid floor draws itself
- The character skeleton appears joint by joint
- Music starts to swell as the scene builds

This makes the loading time feel intentional and cinematic rather than broken.

## PRIORITY ORDER FOR BUILDING

1. **Hour 0-1:** Set up RunPod, install Kimodo, run first test generation, confirm BVH output works
2. **Hour 1-3:** Get Three.js rendering a BVH animation in the browser (this is the riskiest unknown)
3. **Hour 3-5:** Gemini orchestrator — system prompt that outputs SceneConfig JSON, parse it into Three.js objects
4. **Hour 5-7:** Wire everything together — user prompt → Gemini → Kimodo API + scene rendering
5. **Hour 7-9:** Lyria RealTime integration — WebSocket music streaming synced to animation
6. **Hour 9-11:** Frontend polish — Agent Console with real messages, timeline, playback controls
7. **Hour 11-12:** Demo prep, pitch deck, backup video recording

## RISK MITIGATION

| Risk | Mitigation |
|------|-----------|
| Kimodo first-run model download takes 15-20 min | Start RunPod and run first generation IMMEDIATELY. Do this before anything else. |
| BVH loading in Three.js doesn't work | Fall back to stick figure rendering from NPZ posed_joints data |
| Gemini SceneConfig JSON is malformed | Have 2-3 hardcoded template scenes as fallback. Gemini fills in parameters. |
| Lyria RealTime WebSocket drops | Pre-generate one 30-sec Lyria Clip as backup audio |
| RunPod pod crashes | Keep the pod running, don't restart. Have pre-generated BVH files as emergency fallback. |
| Network issues at venue | Record a screen capture of working demo before presenting |

## WHAT MAKES THIS WIN

1. **Novelty:** Kimodo is 2 weeks old. Nobody at this hackathon knows it exists. Combining it with Gemini scene generation and Lyria RealTime is genuinely first-of-its-kind.
2. **Visual impact:** 3D animation from text is inherently jaw-dropping as a demo.
3. **Gemini is central:** Not a wrapper. It's the orchestration brain that decomposes, plans, and generates scene structure.
4. **Lyria RealTime dynamic steering:** Music morphs with the scene — showcases what makes RealTime special vs static clip generation.
5. **Technical depth:** Multi-agent architecture, GPU inference pipeline, real-time 3D rendering, motion data parsing, WebSocket audio streaming.
6. **Real-world impact:** Clear path to a product. $25B animation market.

## PITCH DECK (4 slides)

Slide 1: "3D character animation costs $5K-$50K per minute. 99% of creators are locked out."
Slide 2: "Kinetik: describe a scene → get interactive 3D animation with soundtrack. Powered by Gemini 3 + NVIDIA Kimodo + Lyria RealTime."
Slide 3: LIVE DEMO
Slide 4: Architecture diagram + "First-ever text-to-animated-3D-scene platform."