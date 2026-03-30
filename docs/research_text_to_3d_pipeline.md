# Text-to-3D Pipeline Research — fal.ai

## The Goal

Replace Poly Pizza's limited pre-made asset library with AI-generated 3D models. Type a description, get a custom GLB model loaded into Three.js.

## Why Not Nanobanana?

- Nanobanana (Gemini Flash Image) takes **25-40 seconds per image** — too slow
- Can't self-host to speed it up
- For this pipeline, we only need a clean render of an object on a white background — overkill to use Gemini for that

## Why fal.ai?

- Hosts **both** image generation (FLUX) and 3D reconstruction (TripoSR, Trellis 2, etc.) under one API
- No GPU needed on our end — fully serverless
- Sub-second to seconds latency
- One account, one billing system
- 985+ endpoints, well-documented API
- 99.99% claimed uptime, auto-scales
- Developer sentiment is very positive (praised for speed, reliability, API design)
- $140M raised at $4.5B valuation (Dec 2025) — not going anywhere
- **Caution:** Some users reported API key compromise issues with no fraud protection — keep keys secure

---

## The Pipeline (Recommended)

```
Text prompt (e.g. "medieval castle")
    |
    v
FLUX.1 Schnell (fal.ai)  ←  ~1-2 seconds, $0.003/image
    |  generates a clean 3D object render on white background
    v
Trellis v1 (fal.ai)  ←  fast, $0.02/model
    |  reconstructs a textured 3D mesh from the image
    v
GLB file URL  →  Three.js GLTFLoader  →  rendered in scene
```

**Total time per object: ~2-4 seconds**
**Total cost per object: ~$0.023**
**Total cost per scene (8 objects): ~$0.18**

Trellis v1 is the primary choice — outputs simple textured GLB meshes that match
our low-poly art style. No PBR materials or 4K textures (those are v2 features we
don't need). If a specific model looks bad, selectively upgrade that one object to
TripoSR ($0.07) or Trellis 2 ($0.25).

---

## Step 1: Image Generation — FLUX.1 Schnell

| Detail | Value |
|--------|-------|
| Endpoint | `fal-ai/flux/schnell` |
| Price | **$0.003 per megapixel** (~$0.003 per 1024x1024 image) |
| Speed | **0.4 - 2 seconds** |
| Steps | 1-4 (default 4) |
| Model size | 12B parameters |
| Commercial use | Yes |

**Why FLUX Schnell?**
- 10-20x faster than Nanobanana
- Great prompt adherence — reliably generates isolated objects on plain backgrounds
- Cheapest option on fal.ai
- Produces clean renders suitable for mesh reconstruction

**Ideal prompt format:**
```
"low poly 3D render of a [object], white background, studio lighting, isometric view, game asset"
```

**Upgrade options (if quality isn't good enough):**
- FLUX.1 Dev: ~$0.025/image, 5-10 seconds, better quality
- FLUX.1 Pro: ~$0.05/image, 5-15 seconds, best quality
- FLUX.2 Turbo: newer, reportedly 10x cheaper and 6x faster than FLUX.1

---

## Step 2: Image-to-3D Mesh Reconstruction

### Option A: Trellis v1 (RECOMMENDED — Cheapest)

| Detail | Value |
|--------|-------|
| Endpoint | `fal-ai/trellis` |
| Price | **$0.02 per model** |
| Speed | **Fast** |
| Output | GLB with baked textures |

Best for: low-poly stylized content, budget-friendly, matches our current art style. No PBR
materials or high-res textures — which is fine since our scene is already cartoonish low-poly.

### Option B: TripoSR (Upgrade if v1 looks bad)

| Detail | Value |
|--------|-------|
| Endpoint | `fal-ai/triposr` |
| Price | **$0.07 per model** |
| Speed | **< 0.5 seconds** |
| Output | GLB or OBJ |
| Resolution | Up to 1024 marching cubes |

Best for: when Trellis v1 output isn't clean enough for a specific object.

### Option C: Trellis 2 (Best Quality)

| Detail | Value |
|--------|-------|
| Endpoint | `fal-ai/trellis-2` |
| Price | **$0.25** (512p) / **$0.30** (1024p) / **$0.35** (1536p) |
| Speed | **3-17 seconds** depending on resolution |
| Output | GLB with PBR materials (base color, roughness, metallic, opacity) |
| Texture size | Up to 4096 |
| Input | Single or multiple images |

Best for: higher quality models, PBR materials that look good with Three.js lighting.

### Option C: Tripo3D v2.5 (Middle Ground)

| Detail | Value |
|--------|-------|
| Endpoint | `tripo3d/tripo/v2.5/image-to-3d` |
| Price | **$0.20 - $0.40 per model** |
| Speed | **< 0.5 seconds** |
| Output | GLB, FBX |
| Extras | PBR materials, quad mesh option (+$0.05), style transfer |

### Option D: Pre-built Workflow (One Call Does Everything)

fal.ai has a **flux-to-trellis workflow** that chains text → image → 3D in a single API call:
- URL: `fal.ai/workflows/gokayfem/flux-to-trellis`
- One call in, GLB out
- Simplest integration

---

## Comparison: All 3D Options on fal.ai

| Model | Price/model | Speed | Quality | PBR Materials | Best For |
|-------|-----------|-------|---------|---------------|----------|
| TripoSR | $0.07 | <0.5s | Good | No | Speed, low-poly |
| Trellis (v1) | $0.02 | Fast | OK | No | Cheapest possible |
| Trellis 2 | $0.25-0.35 | 3-17s | Excellent | Yes | Quality scenes |
| Tripo3D v2.5 | $0.20-0.40 | <0.5s | Very Good | Yes | Balance |
| Hunyuan3D v2 | $0.16-0.48 | Slower | Very Good | Partial | Geometric precision |
| Meshy v6 | ~$0.40 | 5-10 min | Excellent | Yes | If time doesn't matter |

---

## Cost Estimates

### Per scene (8 objects)

| Pipeline | Image Cost | 3D Cost | Total | Time |
|----------|-----------|---------|-------|------|
| FLUX + Trellis v1 | $0.02 | $0.16 | **$0.18** | ~3-4s (parallel) |
| FLUX + TripoSR | $0.02 | $0.56 | **$0.58** | ~3-4s (parallel) |
| FLUX + Trellis 2 (512p) | $0.02 | $2.00 | **$2.02** | ~5-6s (parallel) |

### At scale

| Volume | FLUX + Trellis v1 | FLUX + TripoSR | FLUX + Trellis 2 |
|--------|------------------|---------------|-----------------|
| 50 scenes (~400 objects) | **$9** | **$29** | **$120** |
| 100 scenes (~800 objects) | **$18** | **$58** | **$240** |
| 500 scenes (~4000 objects) | **$92** | **$292** | **$1,200** |

---

## Code Integration

### JavaScript (browser — call from frontend or proxy through RunPod)

```javascript
// Step 1: Generate image with FLUX Schnell
const imageResponse = await fetch('https://queue.fal.run/fal-ai/flux/schnell', {
    method: 'POST',
    headers: {
        'Authorization': 'Key YOUR_FAL_KEY',
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({
        prompt: 'low poly 3D render of a medieval castle, white background, isometric view, game asset',
        image_size: 'square',
        num_images: 1
    })
});
const imageData = await imageResponse.json();
const imageUrl = imageData.images[0].url;

// Step 2: Convert to 3D mesh with TripoSR
const meshResponse = await fetch('https://queue.fal.run/fal-ai/triposr', {
    method: 'POST',
    headers: {
        'Authorization': 'Key YOUR_FAL_KEY',
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({
        image_url: imageUrl,
        output_format: 'glb'
    })
});
const meshData = await meshResponse.json();
const glbUrl = meshData.model_mesh.url;

// Step 3: Load into Three.js
const loader = new GLTFLoader();
loader.load(glbUrl, (gltf) => {
    scene.add(gltf.scene);
});
```

### Python (fal-client SDK — for RunPod server proxy)

```python
import fal_client

# Step 1: Generate image
image_result = fal_client.subscribe("fal-ai/flux/schnell", arguments={
    "prompt": "low poly 3D render of a medieval castle, white background, isometric view",
    "image_size": "square",
    "num_images": 1
})
image_url = image_result["images"][0]["url"]

# Step 2: Image to 3D
mesh_result = fal_client.subscribe("fal-ai/triposr", arguments={
    "image_url": image_url,
    "output_format": "glb"
})
glb_url = mesh_result["model_mesh"]["url"]
```

---

## vs Poly Pizza (Current Setup)

| | Poly Pizza | fal.ai Pipeline |
|---|---|---|
| Speed | ~2s (instant lookup) | ~2-5s per object |
| Cost | Free | $0.07-0.30 per object |
| Variety | Limited library | Unlimited — anything you describe |
| Style consistency | Varies (different artists) | Consistent (same FLUX prompt style) |
| Unique objects | No | Yes |
| Scene-specific | Generic search by keyword | Tailored to exact scene |
| Setup | API key + proxy | API key + 2 fetch calls |
| Offline/no-API | No | No |

**Recommendation:** Keep Poly Pizza as a fast fallback. Use fal.ai for objects Poly Pizza doesn't have or when you want style-matched custom assets.

---

## Alternatives Considered

| Platform | Price | Speed | Why Not Primary |
|----------|-------|-------|-----------------|
| **Nanobanana + TRELLIS on RunPod** | Free (pod cost) | 30-45s | Too slow, pod VRAM full |
| **Meshy.ai API** | ~$0.40/model | 5-10 min | Way too slow |
| **Replicate** | ~$0.05/model | Moderate | Cold starts add 5-15s latency |
| **CSM API** | ~$0.75/model | Unknown | Most expensive |
| **Tripo3D direct API** | ~$0.21/model | Fast | Good but fal.ai bundles everything |
| **Sloyd** | $15/mo unlimited | Fast | Only low-poly, limited styles |
| **Self-host FLUX + TRELLIS on RunPod** | Pod cost | 3-5s | RunPod VRAM already full with Kimodo |

---

## Conclusion

**Use fal.ai with FLUX Schnell + Trellis v1 as the primary pipeline.**

- Total ~2-4 seconds per object
- **~$0.023 per object** / ~$0.18 per scene
- No GPU needed — fully serverless
- GLB output loads directly into Three.js
- Low-poly baked textures match our current art style
- Selectively upgrade individual objects to TripoSR ($0.07) or Trellis 2 ($0.25) if needed
- Keep Poly Pizza as instant fallback for common objects

**Next steps:**
1. Sign up for fal.ai, get API key
2. Test FLUX Schnell with 3D object render prompts
3. Test Trellis v1 with those renders — verify low-poly quality is acceptable
4. Integrate into Kinetik — modify Gemini scene agent to trigger fal.ai pipeline
5. Load GLB results into Three.js scene
