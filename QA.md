# Kinetik — Judge Q&A Cheat Sheet

---

## THE ELEVATOR PITCH

"Kinetik is a text-to-animated-3D-scene engine. You type a sentence like 'a person sneaks through a dark warehouse' and it generates a full animated 3D scene in your browser — animated character, 3D objects, lighting, terrain, and a cinematic video export with AI-generated music. No Blender, no mocap, no animators. I chain together 4 AI models as agents — Gemini plans the scene, Nano Banana generates 3D assets, Lyria scores the soundtrack, and NVIDIA Kimodo animates the character."

---

## GENERAL QUESTIONS

### Q: What is Kinetik?
A text-to-animated-3D-scene engine. You type a natural language prompt and get a full 3D scene with an animated character, placed objects, custom lighting, terrain, and background music — all rendered live in the browser with Three.js.

### Q: What problem does this solve?
Creating animated 3D scenes today requires Blender, motion capture studios, and professional animators. It's slow, expensive, and inaccessible. Kinetik lets anyone describe a scene in plain English and get a production-quality animated 3D scene in seconds. It democratizes 3D animation.

### Q: Who is this for?
- Content creators who need quick 3D animations
- Game designers prototyping scenes
- Filmmakers doing storyboard visualization
- Educators building visual content
- Anyone who has a scene in their head but doesn't know Blender

### Q: How long did you build this?
Built in ~24 hours at the GLITCH x Google DeepMind hackathon at UCLA.

### Q: What's the tech stack?
- **Frontend:** Vanilla JS, Three.js — single index.html file, no build tools
- **Backend:** FastAPI on RunPod (RTX 5000 Ada GPU)
- **Motion:** NVIDIA Kimodo (text-to-skeletal-animation)
- **Scene Planning:** Gemini 2.5 Flash
- **3D Assets:** Nano Banana (Gemini Flash Image) + Trellis v1 (fal.ai)
- **Music:** Lyria 3 Clip Preview
- **Rendering:** Three.js with BVHLoader, GLTFLoader, AnimationMixer

---

## HOW THE FULL PIPELINE WORKS (step by step)

### Q: Walk me through what happens when I type a prompt.

1. **Prompt Enhancement** — The user's prompt is silently rewritten to produce better motion. For example, "walks" becomes "walks forward confidently with long strides and arm swings." This is invisible to the user but dramatically improves Kimodo's output because the model responds better to descriptive, locomotion-focused prompts.

2. **Motion Generation (Kimodo on RunPod)** — The enhanced prompt is sent to my FastAPI backend running on a RunPod GPU. NVIDIA Kimodo generates skeletal animation data — 77 joints at 30fps — and exports it as a BVH file (standard motion capture format). This takes 2-5 seconds on an RTX 5000 Ada.

3. **Path Extraction** — The client parses the BVH file to extract the character's root trajectory (the Hips bone positions over time). This gives us a path of [x, y, z] waypoints that the character will walk through. This path is critical — it tells us WHERE the character goes so we can place objects around it.

4. **Scene Planning (Gemini Flash)** — The original user prompt PLUS the character path are sent to Gemini 2.5 Flash. Gemini acts as a scene designer — it reads the prompt, picks 6-8 thematically appropriate objects (with keywords, sizes, and categories), chooses a ground color, and sets up lighting. It outputs structured JSON. Importantly, Gemini does NOT decide positions — it just picks WHAT belongs in the scene. My layout engine handles WHERE.

5. **Layout Engine (client-side)** — My layout engine takes Gemini's object list and the character path and computes positions using golden-angle distribution (for natural scatter), collision avoidance, path clearance (nothing blocks the character), and size consistency (same objects are the same scale, trees vary naturally). For outdoor scenes, it also auto-fills 60+ background trees, rocks, and bushes in rings around the scene.

6. **Model Loading** — Each object keyword is matched against my MODEL_MAP (a reverse lookup of 70+ pre-generated GLB files). Models load concurrently with animated pulsing placeholders shown while loading.

7. **BVH Playback** — The BVH is loaded into Three.js, the character is grounded (foot bones sampled to find the lowest Y, then offset so feet touch Y=0), and body meshes are created as smooth LatheGeometry capsules between bone pairs — like a wooden drawing mannequin.

8. **Terrain** — The ground mesh deforms based on the character path's Y values, creating hills and valleys that match the motion.

9. **Timeline** — The animation clip appears on a video-editor-style timeline at the bottom. Users can add more clips via the chat, and they get merged with 0.4s blend transitions.

---

## GOOGLE MODELS (what judges care about most)

### Q: How do you use Gemini?
I use Gemini 2.5 Flash in THREE different roles:

1. **Scene Planner Agent** — Given a user prompt, Gemini picks thematically appropriate objects, ground color, and lighting. It has a detailed system prompt with rules about thematic relevance ("Would this object exist in this real-world location?"), banned keywords, size guides, and creativity instructions. It outputs structured JSON.

2. **Chat Intent Classifier** — When users type things like "add a tree on the left" or "make the character dance," Gemini classifies the intent into action types (add_object, add_motion, modify_scene) and extracts structured parameters. This makes the chat editor work with natural language.

3. **Prompt Enhancer for Custom Models** — When generating 3D assets with Nano Banana, Gemini is the image generation backbone. The prompt is carefully crafted: "A single {keyword}, 3D render, three-quarter front view, bright even lighting, clean solid light gray background, low poly style, natural muted colors, no pure white, centered in frame."

### Q: How do you use Nano Banana?
Nano Banana (Gemini Flash Image generation) is the first step in my 3D asset pipeline. It generates a clean, controlled reference image of each object — three-quarter view, gray background, low-poly style. This image is then passed to Trellis v1 (fal.ai) which reconstructs a textured 3D mesh (GLB file) from that single image.

I used this pipeline in two ways:
- **Offline batch generation:** I ran generate_models.py to pre-generate 70+ GLB models for common objects (trees, cars, buildings, furniture, etc.) at about $0.02 per model
- **Live in-editor creation:** Users can type ANY object name in the Add panel, and the Nano Banana + Trellis pipeline runs live, generating a brand new 3D model in ~30 seconds

### Q: How do you use Lyria?
Lyria 3 Clip Preview generates cinematic soundtracks that match each scene's mood. When the user hits the Render button, the scene prompt is sent to Lyria with instructions to create atmospheric, instrumental music. It generates a 30-second clip that loops. The audio plays with a fade-in effect and gets mixed into the final video export through the Web Audio API (MediaStream + AudioContext). Dark scenes get tense minor-key music, action scenes get upbeat tempo.

### Q: Why these specific Google models?
- **Gemini Flash** — It's fast, cheap, and great at structured JSON output. I need sub-second planning responses for a good UX. It also handles three different agent roles without any fine-tuning.
- **Nano Banana** — The only way to get clean, controlled 3D reference images at scale. The prompt engineering for consistent three-quarter views and gray backgrounds is what makes Trellis reconstruction work well.
- **Lyria** — Adds a cinematic layer that makes exports feel polished. Mood-matched music is the difference between a tech demo and something that feels like a real product.

---

## TECHNICAL DEEP DIVES

### Q: How does the character animation work?
NVIDIA Kimodo generates a 77-joint skeleton at 30fps from text. The output is a BVH file (Biovision Hierarchy — standard mocap format). Three.js loads it with BVHLoader, which creates Bone objects and an AnimationClip with position/rotation tracks for each joint. I build a "wooden mannequin" character on top using LatheGeometry — smooth tapered capsules between each bone pair (like a drawing reference model). Each frame, I read the bone world positions and orient the capsules accordingly.

### Q: Why BVH format? Why not something else?
BVH is the standard for skeletal animation data. Three.js has a built-in BVHLoader, and Kimodo exports to it natively. It's human-readable (you can open it in a text editor), lightweight (a 5-second clip is ~50KB), and contains both the skeleton hierarchy and the motion data.

### Q: How does the character stay grounded (not float or sink)?
This was a tricky problem. I sample the foot bone positions (LeftFoot, RightFoot, LeftToeBase, RightToeBase) across 20 frames of the animation, find the global minimum Y value, then offset the entire character group so that lowest foot position sits at Y=0 minus the capsule radius. This means even during a backflip, when the character lands, their feet touch the ground.

### Q: How does the motion timeline work?
It's like a video editor. Each prompt generates an animation clip. When you add a second motion via the chat (like "now do a backflip"), I merge the two clips:
1. Find where clip A's Hips bone ends (position XYZ)
2. Offset clip B's Hips positions so it starts where A ended (prevents teleporting)
3. Create blend keyframes at the junction — 0.4 seconds of interpolation between the end pose of A and the start pose of B
4. Concatenate all the tracks into one merged AnimationClip

Users can click clips to select them, press Backspace to delete, and the playhead shows current position.

### Q: What was the teleporting bug?
When chaining two clips, the character would teleport back to origin because clip B's Hips positions start at [0, 0, 0]. I fixed it by computing posOffsetX/posOffsetZ — the difference between clip A's ending position and clip B's starting position — and adding that offset to every frame of clip B's Hips track. Now the character continues seamlessly from where it stopped.

### Q: How does the layout engine work?
Gemini picks WHAT objects belong in the scene. My client-side layout engine decides WHERE to put them:
- **Golden angle distribution** — Objects are placed using the golden angle (2.399963 radians) which naturally avoids clustering. Each size category (large/medium/small) uses a different angular offset so they don't overlap.
- **Path clearance** — Every object is pushed away from the character's trajectory. If an object is within 100 units of any waypoint, it gets pushed outward.
- **Corridor clearing** — A wide corridor in front of the character (Z > -50 to 300, |X| < 150) is kept clear so the character isn't walking through objects.
- **Collision resolution** — Bounding-box collision detection checks all object pairs. The smaller object gets relocated up to 15 times to find a clear spot. Nature objects (trees, bushes) are allowed to overlap slightly for realism.
- **Auto-fill** — For outdoor scenes, 60 random background objects (trees, pines, bushes, rocks) are scattered across the map with minimum spacing and path avoidance.
- **Scale consistency** — Same keyword = same scale. Trees vary within ±20% for natural variety. Everything else is exact.

### Q: How does the 3D model matching work?
I have a MODEL_MAP — a dictionary where each key is a filename (like "car") and the value is an array of keywords that should match (["car", "sedan", "taxi", "vehicle", "automobile"]). When Gemini says "sedan," the reverse lookup finds `models/car.glb`. It tries exact match first, then partial match (substring check).

### Q: What are procedural models?
For common nature objects (trees, pines, bushes, rocks), I have procedural geometry generators instead of loading GLBs. A "tree" is a brown CylinderGeometry trunk + green SphereGeometry canopy. This is instant (no network request) and used for the auto-fill background objects. It saves loading 60+ GLB files for background filler.

### Q: How does the custom model creation work (live in editor)?
1. User types "dragon" in the Add panel
2. Nano Banana (Gemini Flash Image) generates a reference image with the prompt: "A single dragon, 3D render, three-quarter front view, bright even lighting, clean solid light gray background, low poly style..."
3. The base64 image is sent as a data URI to Trellis v1 (fal.ai), which reconstructs a textured GLB mesh
4. The GLB URL is loaded with GLTFLoader, scaled, and placed in the scene
5. Total time: ~30 seconds, cost: ~$0.02

### Q: How does the video render/export work?
1. Camera zooms out to a high cinematic angle (smooth lerp animation)
2. Lyria generates a 30-second mood-matched soundtrack
3. Animation resets to frame 0
4. Canvas capture starts: `canvas.captureStream(30)` grabs video at 30fps
5. Audio from Lyria is mixed in via `AudioContext.createMediaStreamDestination()`
6. MediaRecorder records both streams for 6 seconds while the camera orbits 360 degrees around the scene
7. Recording stops, a Blob is created, and a download link is generated

### Q: How does the chat editor work?
The chat bar at the bottom of the Activity panel lets users edit the scene with natural language:
1. User types "add a car on the left"
2. Gemini classifies intent: `{"action": "add_object", "keyword": "car", "category": 3, "size": "medium", "direction": "left"}`
3. Direction is resolved to coordinates relative to the character's current position
4. The model is loaded from the library and placed

It handles three action types:
- **add_object** — place a new 3D object with directional placement ("left", "right", "near the tree")
- **add_motion** — generate a new animation clip and merge it into the timeline, with optional BVH rotation toward a target object ("run towards the tree")
- **modify_scene** — change ground color, ambient light intensity, etc.

### Q: How does the "run towards the tree" targeting work?
When a user says "run towards the tree," Gemini extracts `target_object: "tree"`. My code:
1. Finds the nearest tree in the scene using keyword matching + distance
2. Computes the angle from the character to the tree using `atan2`
3. Generates the motion BVH normally
4. Rotates the BVH root motion — all Hips positions are rotated around the start point by the difference between the BVH's natural direction and the target angle
5. Merges the rotated clip into the timeline

### Q: What about the terrain system?
The ground isn't flat — it deforms based on the character path's Y values (elevation). I sample the character's height along the path and create gentle hills and valleys. The ground mesh follows the character (repositions every frame) so it always extends under them.

### Q: How does the welcome screen preview work?
The welcome page has an animated mannequin doing different motions (backflip, dancing, sneaking, etc.). This is a completely separate Three.js renderer, scene, camera, and animation loop — isolated from the main scene. It cycles through 5 pre-recorded BVH files, blending between them. When the user starts generating, the preview renderer is disposed.

---

## ARCHITECTURE QUESTIONS

### Q: Why is the entire frontend a single index.html?
Speed of development at a hackathon. No build tools, no bundler, no React. ES module imports for Three.js via importmap, everything else inline. This also makes deployment trivial — just serve the file.

### Q: Why RunPod for the backend?
Kimodo requires ~17GB VRAM for inference (mostly the LLM2Vec text encoder based on Meta-Llama-3-8B-Instruct). RunPod gives on-demand GPU access with RTX 5000 Ada. The model loads once at server startup and stays in GPU memory — subsequent generations take only 2-5 seconds.

### Q: Why FastAPI?
Lightweight, async, and handles the simple API I need: one POST endpoint for motion generation, one GET for health check. CORS middleware lets the browser frontend call it directly.

### Q: Why call Gemini and Lyria from the frontend instead of through a backend?
They don't need a GPU and the API is simple HTTP POST. Calling from the frontend removes a network hop, reduces backend complexity, and means the GPU server only handles the GPU-intensive work (Kimodo inference).

### Q: What APIs did you build?
| Endpoint | Method | What it does |
|----------|--------|-------------|
| `/generate-motion` | POST | Takes `{prompt, duration}`, runs Kimodo on GPU, returns BVH file |
| `/health` | GET | Returns model status and GPU info |
| `/poly-search` | GET | Proxy to Poly Pizza API (legacy, mostly unused now) |

### Q: How do you handle errors and retries?
- **Motion generation:** If the character doesn't travel enough distance (start-to-end < 50 units), it retries up to 3 times. This catches "stuck in place" animations.
- **Model loading:** GLB load errors are caught silently — the model just doesn't appear, but the scene continues loading. No single model failure breaks the whole scene.
- **Gemini responses:** JSON parsing has fallback cleanup (strips markdown fences) because Gemini sometimes wraps JSON in backticks.

---

## DESIGN / UX QUESTIONS

### Q: Tell me about the UI design.
Minimalist, clean, professional. Inspired by creative tools like Figma and Runway:
- DM Sans + DM Mono fonts
- Purple accent (#7c5cbf) throughout
- Activity log with color-coded, icon-tagged messages
- Video editor-style timeline
- Build mode with Move/Rotate/Scale gizmos
- Welcome screen with animated mannequin preview
- Pulsing placeholder boxes while models load

### Q: What's the Activity log?
A color-coded console on the left panel. Each message has an icon and type:
- Purple (agent) — Gemini actions
- Blue (motion) — animation generation
- Orange (scene) — object placement
- Green (success) — completed actions
- Red (error) — failures
- Pink (music) — Lyria/soundtrack

Messages with the same ID update in-place (like a progress counter) instead of flooding the log.

### Q: How does the object picker work?
The "Add" tab shows a grid of all 70+ available models with emoji icons and thumbnails. Click one to enter "place mode" — a semi-transparent preview follows your cursor, and clicking places the real model. You can also type any name in the search bar to create a brand new model with the Nano Banana + Trellis pipeline.

---

## CHALLENGES / WHAT WENT WRONG

### Q: What was the hardest part?
**The teleporting bug.** When chaining two animations, the character would snap back to origin because each BVH clip starts at [0,0,0]. I had to compute position offsets between clip endpoints and apply them to every frame of the new clip's Hips track. Getting the blend transition smooth (0.4s interpolation) while also handling the position offset correctly took significant debugging.

### Q: What else was tricky?
- **Foot grounding** — Characters would float or sink depending on the animation. Had to sample foot positions across the entire clip to find the true minimum Y.
- **Fence models** — Certain 3D models (fences, barriers, shelters) would generate as massive flat planes that blocked the entire scene. Had to ban them entirely.
- **Kimodo text encoder** — Requires Meta-Llama-3-8B-Instruct from HuggingFace, which is gated behind a license approval. Was blocked for hours waiting for access.
- **BVH rotation for targeting** — Rotating root motion so the character walks toward a specific object required rotating all Hips positions around the start point using sin/cos transforms.
- **Scale consistency** — Same object appearing multiple times at wildly different sizes looked terrible. Had to enforce keyword-based scale caching with special variance rules for natural objects.

### Q: What would you improve with more time?
- Multiplayer / collaborative editing
- More animation variety (Kimodo is limited to ~10s clips)
- Better character mesh (currently a mannequin — could use a proper skinned mesh)
- Real-time AI voice narration over the scene
- Save/load scenes (the data model supports it, just needs serialization)
- Mobile support

---

## COMPETITION-SPECIFIC

### Q: What tracks are you targeting?
- **Best Nano Banana app** — 70+ models generated with Nano Banana, plus live creation in the editor
- **Best Multi Model app** — Chains Gemini + Nano Banana + Lyria + Kimodo as agents
- **Best Lyria app** — AI-generated mood-matched soundtracks for video export

### Q: How is this different from existing tools?
- **Blender/Maya** — Requires expertise, manual work, hours/days per scene
- **Text-to-video (Sora, Veo)** — Generates flat video, not interactive 3D. Can't edit, can't explore, can't change camera angle
- **Kinetik** — Interactive 3D scene you can explore, edit, and extend. Full editor with timeline, object manipulation, chat-based editing, and video export. It's a creation tool, not just a generation tool.

### Q: How many Google APIs/models do you use?
Four:
1. Gemini 2.5 Flash (scene planning + chat classification + prompt enhancement)
2. Gemini Flash Image / Nano Banana (3D asset image generation)
3. Lyria 3 Clip Preview (music generation)
4. Gemini (prompt enhancement for motion — rewriting user prompts)

Plus NVIDIA Kimodo for the actual motion generation (non-Google, runs on my own GPU).
