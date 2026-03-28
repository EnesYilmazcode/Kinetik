import os
import sys
from dotenv import load_dotenv

load_dotenv()

os.environ["HF_TOKEN"] = os.environ.get("HF_TOKEN", "")
os.environ["HF_HOME"]="/workspace/hf_cache"
# Add kimodo repo to path so the package resolves correctly
sys.path.insert(0, "/workspace/kimodo")

import hashlib
import numpy as np
import torch
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse
import subprocess

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# Load model ONCE at startup — stays in GPU memory for fast inference
print("Loading Kimodo model...")
from kimodo import load_model
from kimodo.model.registry import get_model_info
from kimodo.exports.bvh import save_motion_bvh
from kimodo.skeleton import global_rots_to_local_rots, SOMASkeleton30

device = "cuda:0"
model, resolved_model = load_model(
    "Kimodo-SOMA-RP-v1",
    device=device,
    default_family="Kimodo",
    return_resolved_name=True,
)
skeleton = model.skeleton
if isinstance(skeleton, SOMASkeleton30):
    skeleton = skeleton.somaskel77.to(device)
print(f"Model loaded: {resolved_model}")

@app.get("/health")
def health():
    return {"status": "ok", "model": resolved_model, "gpu": str(device)}

@app.post("/exec")
def ex(data: dict):
    r = subprocess.run(data["cmd"], shell=True, capture_output=True, text=True, timeout=300)
    return {"out": r.stdout[-2000:], "err": r.stderr[-2000:], "code": r.returncode}

@app.post("/generate-motion")
def generate_motion(data: dict):
    prompt = data["prompt"]
    duration = data.get("duration", 5.0)
    fps = model.fps
    num_frames = [int(duration * fps)]
    texts = [prompt]

    output = model(
        texts,
        num_frames,
        constraint_lst=[],
        num_denoising_steps=100,
        num_samples=1,
        multi_prompt=True,
        num_transition_frames=10,
        post_processing=False,
        return_numpy=True,
    )

    h = hashlib.md5(prompt.encode()).hexdigest()[:8]
    bvh_path = f"/tmp/m_{h}.bvh"

    joints_pos = torch.from_numpy(output["posed_joints"][0]).to(device)
    joints_rot = torch.from_numpy(output["global_rot_mats"][0]).to(device)
    local_rot_mats = global_rots_to_local_rots(joints_rot, skeleton)
    root_positions = joints_pos[:, skeleton.root_idx, :]
    save_motion_bvh(bvh_path, local_rot_mats, root_positions, skeleton=skeleton, fps=fps)

    return FileResponse(bvh_path)

@app.get("/poly-search")
def poly_search(category: int = 8, limit: int = 5):
    import httpx
    r = httpx.get(
        f"https://api.poly.pizza/v1.1/search?Category={category}&License=0&Limit={limit}",
        headers={"x-auth-token": os.environ["POLY_PIZZA_KEY"]},
        timeout=10
    )
    return r.json()
