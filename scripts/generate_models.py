import httpx
import base64
import os
import time
from dotenv import load_dotenv

load_dotenv()

GEMINI_KEY = os.environ["GEMINI_KEY"]
FAL_KEY = os.environ["FAL_KEY"]
GEMINI_URL = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key={GEMINI_KEY}"
FAL_URL = "https://fal.run/fal-ai/trellis"

# Generate to temp folder to avoid triggering browser live-reload
import tempfile, shutil
TEMP_DIR = os.path.join(tempfile.gettempdir(), "kinetik_models")
OUTPUT_DIR = TEMP_DIR
FINAL_DIR = "models"
os.makedirs(TEMP_DIR, exist_ok=True)
os.makedirs(FINAL_DIR, exist_ok=True)

OBJECTS = [
    # New approved models from new_models.txt
    "fence post","mailbox","stop sign","traffic cone","dumpster","picnic table",
    "swing set","slide","gazebo","bridge","boat","motorcycle","bicycle",
    "castle","windmill","tent","campfire","log","grave tombstone","pumpkin",
    "soccer goal","basketball hoop","punching bag","treadmill","piano","bed",
    "bathtub","toilet","refrigerator","oven","television","computer desk",
    "office chair","filing cabinet","vending machine","phone booth",
    "bus stop shelter","fire escape ladder","water tower","satellite dish",
    "crane","forklift","shopping cart","streetlight","park fountain",
    "bird bath","dog house","wheelbarrow","hay bale","tractor",
    "hot dog cart","ice cream truck","police car","taxi cab",
]

def generate_model(keyword):
    print(f"\n{'='*50}")
    print(f"Generating: {keyword}")

    # Step 1: Nanobanana image
    print("  [1/3] Generating image...")
    prompt = f"A single {keyword}, 3D render, three-quarter front view, bright even lighting, clean solid light gray background, low poly style, natural muted colors, no pure white, centered in frame"

    res = httpx.post(GEMINI_URL, json={
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseModalities": ["IMAGE", "TEXT"]}
    }, timeout=120)

    data = res.json()
    candidates = data.get("candidates", [])
    if not candidates:
        print(f"  ERROR: No candidates. Response: {data}")
        return False

    parts = candidates[0]["content"]["parts"]
    image_part = next((p for p in parts if "inlineData" in p), None)
    if not image_part:
        print(f"  ERROR: No image in response")
        return False

    b64 = image_part["inlineData"]["data"]
    mime = image_part["inlineData"].get("mimeType", "image/png")
    print(f"  Got image ({len(b64) // 1024}KB)")

    # Save image for reference
    img_bytes = base64.b64decode(b64)
    img_path = os.path.join(OUTPUT_DIR, f"{keyword.replace(' ', '_')}.png")
    with open(img_path, "wb") as f:
        f.write(img_bytes)

    # Step 2: Trellis v1 -> GLB
    print("  [2/3] Converting to 3D mesh...")
    data_uri = f"data:{mime};base64,{b64}"

    mesh_res = httpx.post(FAL_URL, json={
        "image_url": data_uri
    }, headers={
        "Authorization": f"Key {FAL_KEY}",
        "Content-Type": "application/json"
    }, timeout=120)

    mesh_data = mesh_res.json()
    if "model_mesh" not in mesh_data:
        print(f"  ERROR: No mesh. Response: {mesh_data}")
        return False

    glb_url = mesh_data["model_mesh"]["url"]
    print(f"  Got GLB URL")

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
        time.sleep(2)

    print(f"\n{'='*50}")
    print(f"Done! {success}/{len(OBJECTS)} models generated")
    if failed:
        print(f"Failed: {', '.join(failed)}")

    # Copy all GLBs from temp to project models/ folder
    print(f"\nCopying GLBs to {FINAL_DIR}/...")
    for f in os.listdir(TEMP_DIR):
        if f.endswith('.glb'):
            shutil.copy2(os.path.join(TEMP_DIR, f), os.path.join(FINAL_DIR, f))
            print(f"  Copied {f}")
    print("All models copied!")
