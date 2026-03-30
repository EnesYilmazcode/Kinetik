# server.py — Deploy this on your RunPod pod
# Run: pip install fastapi uvicorn && uvicorn server:app --host 0.0.0.0 --port 8000

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
import subprocess
import os
import hashlib

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

@app.get("/health")
def health():
    return {"status": "ok", "model": "kimodo"}

@app.post("/generate-motion")
def generate_motion(data: dict):
    prompt = data["prompt"]
    duration = data.get("duration", 5.0)

    prompt_hash = hashlib.md5(prompt.encode()).hexdigest()[:8]
    output_path = f"/tmp/motion_{prompt_hash}"

    # Kimodo: prompt is POSITIONAL (at the end), use --no-postprocess
    result = subprocess.run([
        "kimodo_gen",
        "--duration", str(duration),
        "--output", output_path,
        "--no-postprocess",
        "--bvh",
        prompt
    ], capture_output=True, text=True)

    if result.returncode != 0:
        return {"error": result.stderr}

    bvh_path = f"{output_path}.bvh"
    if os.path.exists(bvh_path):
        return FileResponse(bvh_path, media_type="text/plain", filename="motion.bvh")

    return {"error": "BVH file not generated"}
