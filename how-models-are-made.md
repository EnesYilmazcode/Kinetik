# How models are made

Every `.glb` file in `/models/` was generated with this pipeline. No manual Blender work, no downloading from asset stores.

## The pipeline

```
"medieval castle"
       |
       v
  Nano Banana (Gemini Flash Image)
  Prompt: "A single medieval castle, 3D render, three-quarter
           front view, bright even lighting, clean solid light
           gray background, low poly style, natural muted colors,
           no pure white, centered in frame"
       |
       v
  PNG image (saved to temp folder for reference)
       |
       v
  Trellis v1 (fal.ai)
  Sends the image as a base64 data URI
  Returns a GLB mesh URL
       |
       v
  Download GLB to temp folder
       |
       v
  Copy to models/ when all done
```

## Why temp folder first?

If you generate directly into `models/`, every new file triggers your dev server's live-reload. The browser flickers constantly as 50+ models get written one by one. Generating to `%TEMP%/kinetik_models/` first, then copying everything at the end, avoids that.

## Running it

### 1. Edit the model list

Open `new_models.txt` and add/remove objects. One per line. Lines starting with `#` are comments.

```
mushroom
cactus
treasure chest
fire truck
```

### 2. Update generate_models.py

Copy your approved list into the `OBJECTS` array in `generate_models.py`. The script reads from that array, not from the text file directly (so you have a chance to review before burning API credits).

### 3. Run it

```bash
python generate_models.py
```

Each model takes about 5-15 seconds. The script sleeps 2 seconds between models to avoid rate limits.

You'll see output like:
```
==================================================
Generating: mushroom
  [1/3] Generating image...
  Got image (142KB)
  [2/3] Converting to 3D mesh...
  Got GLB URL
  [3/3] Downloading GLB...
  Saved: C:\Users\...\kinetik_models\mushroom.glb (847KB)
```

### 4. Register the model

After generation, add the model to `MODEL_MAP` in `index.html` so the layout engine knows about it:

```javascript
const MODEL_MAP = {
    // ...existing models...
    'mushroom': ['mushroom','fungi','toadstool'],
};
```

The key is the filename (without `.glb`), the array is all the keywords that should match to this model.

## API keys needed

- **Gemini API key** -- for Nano Banana image generation (set in `GEMINI_KEY`)
- **fal.ai API key** -- for Trellis v1 mesh reconstruction (set in `FAL_KEY`)

## Prompt tips

The image prompt matters a lot for mesh quality. Things that help:

- **"three-quarter front view"** -- gives Trellis enough depth info to reconstruct the back
- **"clean solid light gray background"** -- prevents background from becoming part of the mesh
- **"low poly style"** -- matches the scene aesthetic, and simpler geometry reconstructs better
- **"natural muted colors, no pure white"** -- pure white meshes get hidden by the artifact filter in `loadGLBModel`
- **"centered in frame"** -- keeps the object centered in the GLB output
- **"bright even lighting"** -- avoids baked-in shadows that look weird when the scene has its own lighting

Things that break it:
- Multiple objects in one image (Trellis reconstructs them as one blob)
- Dark backgrounds (get baked into the mesh)
- Overhead/top-down views (not enough depth info)
- Text or labels on objects (becomes messy geometry)

## Cost

- Nano Banana: ~$0.13 per image
- Trellis v1: ~$0.02 per model
- **Total: ~$0.15 per model, ~$0.18/scene (8 objects)**

For 80 models: roughly $12.

## Current model count

~71 models across categories: nature, urban, indoor, vehicles, sports, spooky, food carts. See `MODEL_MAP` in `index.html` for the full list.
