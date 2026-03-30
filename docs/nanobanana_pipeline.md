# Nanobanana + Trellis v1 — Model Generation Pipeline

## Overview

Generate a library of 3D models (GLB files) by:
1. Using **Nanobanana** (Gemini image gen) to create a clean render of each object
2. Passing that image to **fal.ai Trellis v1** to reconstruct a 3D mesh
3. Saving the GLB file locally for use in Kinetik scenes

## API Keys

Set in `.env` file:
- **Gemini (Nanobanana):** `GEMINI_KEY`
- **fal.ai (Trellis v1):** `FAL_KEY`

## Step 1: Generate Image with Nanobanana

**Model ID:** `gemini-2.5-flash-image`

```
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${GEMINI_KEY}

{
  "contents": [{
    "parts": [{
      "text": "Generate an image of a low poly 3D [OBJECT NAME], white background, studio lighting, isometric view, game asset, simple geometric shapes, stylized"
    }]
  }],
  "generationConfig": {
    "responseModalities": ["IMAGE", "TEXT"]
  }
}
```

**Response:** Image is at `candidates[0].content.parts[].inlineData.data` (base64 PNG)

```javascript
const data = await response.json();
const imagePart = data.candidates[0].content.parts.find(p => p.inlineData);
const base64 = imagePart.inlineData.data;     // raw base64 string
const mimeType = imagePart.inlineData.mimeType; // "image/png"
```

## Step 2: Convert Image to 3D with Trellis v1

**Endpoint:** `https://fal.run/fal-ai/trellis` (synchronous — blocks until done)

Trellis accepts data URIs directly — no upload step needed.

```
POST https://fal.run/fal-ai/trellis

Headers:
  Authorization: Key ${FAL_KEY}
  Content-Type: application/json

Body:
{
  "image_url": "data:image/png;base64,{BASE64_FROM_STEP_1}"
}
```

**Optional parameters:**
| Parameter | Default | Description |
|-----------|---------|-------------|
| `ss_guidance_strength` | 7.5 | Guidance for shape (0-10) |
| `ss_sampling_steps` | 12 | Shape sampling steps (1-50) |
| `slat_guidance_strength` | 3.0 | Guidance for texture (0-10) |
| `slat_sampling_steps` | 12 | Texture sampling steps (1-50) |
| `mesh_simplify` | 0.95 | Mesh simplification (0.9-0.98) |
| `texture_size` | 1024 | Texture resolution: 512, 1024, or 2048 |

**Response:**
```json
{
  "model_mesh": {
    "url": "https://v3.fal.media/files/.../model.glb",
    "content_type": "model/gltf-binary",
    "file_name": "output.glb",
    "file_size": 12345678
  }
}
```

GLB URL is at `response.model_mesh.url`

## Step 3: Download and Save GLB

Download the GLB from the fal.ai URL and save it locally:
```
models/{keyword}.glb
```

## Full Pipeline Script (Python)

```python
import httpx
import base64
import os
import time

GEMINI_KEY = "${GEMINI_KEY}"
FAL_KEY = "${FAL_KEY}"
GEMINI_URL = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key={GEMINI_KEY}"
FAL_URL = "https://fal.run/fal-ai/trellis"

OUTPUT_DIR = "models"
os.makedirs(OUTPUT_DIR, exist_ok=True)

OBJECTS = [
    # Nature
    "oak tree", "pine tree", "palm tree", "bush", "rock", "boulder",
    "mushroom", "flower", "cactus", "stump",
    # Buildings
    "apartment building", "church", "warehouse", "cottage", "castle tower",
    # Vehicles
    "sedan car", "pickup truck", "bicycle",
    # Street props
    "street lamp", "park bench", "fire hydrant", "trash can", "mailbox",
    "barrel", "wooden crate",
    # Indoor
    "sofa", "bookshelf", "desk", "floor lamp", "potted plant",
]

def generate_model(keyword):
    print(f"\n{'='*50}")
    print(f"Generating: {keyword}")

    # Step 1: Nanobanana image
    print("  [1/3] Nanobanana generating image...")
    prompt = f"Generate an image of a low poly 3D {keyword}, white background, studio lighting, isometric view, game asset, simple geometric shapes, flat shading, stylized"

    res = httpx.post(GEMINI_URL, json={
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseModalities": ["IMAGE", "TEXT"]}
    }, timeout=120)

    data = res.json()
    candidates = data.get("candidates", [])
    if not candidates:
        print(f"  ERROR: No candidates returned. Response: {data}")
        return False

    parts = candidates[0]["content"]["parts"]
    image_part = next((p for p in parts if "inlineData" in p), None)
    if not image_part:
        print(f"  ERROR: No image in response")
        return False

    b64 = image_part["inlineData"]["data"]
    mime = image_part["inlineData"].get("mimeType", "image/png")
    print(f"  Got image ({len(b64) // 1024}KB base64)")

    # Save the image too for reference
    img_bytes = base64.b64decode(b64)
    img_path = os.path.join(OUTPUT_DIR, f"{keyword.replace(' ', '_')}.png")
    with open(img_path, "wb") as f:
        f.write(img_bytes)
    print(f"  Saved image: {img_path}")

    # Step 2: Trellis v1 → GLB
    print("  [2/3] Trellis v1 generating 3D mesh...")
    data_uri = f"data:{mime};base64,{b64}"

    mesh_res = httpx.post(FAL_URL, json={
        "image_url": data_uri
    }, headers={
        "Authorization": f"Key {FAL_KEY}",
        "Content-Type": "application/json"
    }, timeout=120)

    mesh_data = mesh_res.json()
    if "model_mesh" not in mesh_data:
        print(f"  ERROR: No mesh returned. Response: {mesh_data}")
        return False

    glb_url = mesh_data["model_mesh"]["url"]
    file_size = mesh_data["model_mesh"].get("file_size", 0)
    print(f"  Got GLB ({file_size // 1024}KB)")

    # Step 3: Download GLB
    print("  [3/3] Downloading GLB...")
    glb_res = httpx.get(glb_url, timeout=60)
    glb_path = os.path.join(OUTPUT_DIR, f"{keyword.replace(' ', '_')}.glb")
    with open(glb_path, "wb") as f:
        f.write(glb_res.content)
    print(f"  Saved: {glb_path} ({len(glb_res.content) // 1024}KB)")

    return True


if __name__ == "__main__":
    success = 0
    failed = []

    for obj in OBJECTS:
        try:
            if generate_model(obj):
                success += 1
            else:
                failed.append(obj)
        except Exception as e:
            print(f"  EXCEPTION: {e}")
            failed.append(obj)
        # Small delay to avoid rate limits
        time.sleep(2)

    print(f"\n{'='*50}")
    print(f"Done! {success}/{len(OBJECTS)} models generated")
    if failed:
        print(f"Failed: {', '.join(failed)}")
```

## Cost Estimate

- Nanobanana: Free (uses hackathon Gemini credits)
- Trellis v1: $0.02 per model
- 30 models = **$0.60 total**

## Loading Pre-generated Models in Kinetik

Once models are saved in `models/`, update `fetchPolyModel` to look up local files:

```javascript
async function fetchPolyModel(keyword, category) {
    // Look up pre-generated Nanobanana model
    const filename = keyword.toLowerCase().replace(/ /g, '_') + '.glb';
    const url = `models/${filename}`;
    try {
        const res = await fetch(url, { method: 'HEAD' });
        if (res.ok) return url;
    } catch(e) {}
    return null; // fall back to procedural
}
```

## Prompt Tips for Best Results

- Always include "white background" — Trellis needs clean object isolation
- "isometric view" gives the best angle for 3D reconstruction
- "low poly, simple geometric shapes, flat shading" matches the art style
- "game asset" helps the model understand you want a single clean object
- Avoid prompts with multiple objects — one object per image
