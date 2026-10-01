"""Kimodo motion generation on Modal.

Deploy:  modal deploy scripts/modal_app.py
Test:    modal run scripts/modal_app.py --prompt "a person waves"

Serves the same two routes the frontend already calls:
GET /health and POST /generate-motion (returns a BVH file).
"""

import hashlib
import time

import modal

MODEL = "Kimodo-SOMA-RP-v1"
CACHE = "/cache"

image = (
    modal.Image.debian_slim(python_version="3.10")
    .apt_install("git", "build-essential", "cmake")
    .pip_install("torch==2.5.1", "numpy<2")
    .pip_install(
        "git+https://github.com/nv-tlabs/kimodo.git",
        "fastapi[standard]",
    )
    .env({"HF_HOME": f"{CACHE}/hf"})
)

app = modal.App("kinetik", image=image)
volume = modal.Volume.from_name("kinetik-cache", create_if_missing=True)


@app.cls(
    gpu="L4",
    volumes={CACHE: volume},
    secrets=[modal.Secret.from_name("kinetik-hf")],
    scaledown_window=300,
    timeout=600,
    # Snapshot the container after the model is on the GPU, so later cold
    # starts restore it instead of reloading 16 GB of weights.
    enable_memory_snapshot=True,
    experimental_options={"enable_gpu_snapshot": True},
)
@modal.concurrent(max_inputs=4)
class Kimodo:
    @modal.enter(snap=True)
    def load(self):
        from kimodo import load_model
        from kimodo.skeleton import SOMASkeleton30

        t = time.time()
        self.model, self.name = load_model(
            MODEL,
            device="cuda:0",
            default_family="Kimodo",
            return_resolved_name=True,
        )
        skeleton = self.model.skeleton
        if isinstance(skeleton, SOMASkeleton30):
            skeleton = skeleton.somaskel77.to("cuda:0")
        self.skeleton = skeleton
        self.load_seconds = round(time.time() - t, 1)
        # Weights downloaded on the first cold start stay on the volume.
        volume.commit()

    def generate(self, prompt: str, duration: float, variant: int = 0) -> bytes:
        import os

        import torch
        from kimodo.exports.bvh import save_motion_bvh
        from kimodo.skeleton import global_rots_to_local_rots

        key = hashlib.sha256(f"{MODEL}|{prompt}|{duration}|{variant}".encode()).hexdigest()[:16]
        path = f"{CACHE}/bvh/{key}.bvh"
        if os.path.exists(path):
            with open(path, "rb") as f:
                return f.read()

        fps = self.model.fps
        output = self.model(
            [prompt],
            [int(duration * fps)],
            constraint_lst=[],
            num_denoising_steps=100,
            num_samples=1,
            multi_prompt=True,
            num_transition_frames=10,
            post_processing=False,
            return_numpy=True,
        )
        joints_pos = torch.from_numpy(output["posed_joints"][0]).to("cuda:0")
        joints_rot = torch.from_numpy(output["global_rot_mats"][0]).to("cuda:0")
        local_rots = global_rots_to_local_rots(joints_rot, self.skeleton)
        root_pos = joints_pos[:, self.skeleton.root_idx, :]

        os.makedirs(os.path.dirname(path), exist_ok=True)
        save_motion_bvh(path, local_rots, root_pos, skeleton=self.skeleton, fps=fps)
        volume.commit()
        with open(path, "rb") as f:
            return f.read()

    @modal.method()
    def generate_remote(self, prompt: str, duration: float = 5.0) -> bytes:
        return self.generate(prompt, duration)

    @modal.asgi_app()
    def web(self):
        from fastapi import FastAPI, HTTPException
        from fastapi.middleware.cors import CORSMiddleware
        from fastapi.responses import Response
        from pydantic import BaseModel, Field

        api = FastAPI()
        api.add_middleware(
            CORSMiddleware, allow_origins=["*"], allow_methods=["GET", "POST"]
        )

        class MotionRequest(BaseModel):
            prompt: str = Field(min_length=1, max_length=500)
            duration: float = Field(default=5.0, ge=1.0, le=12.0)
            # Retries ask for a new variant so the cache does not hand back the same take.
            variant: int = Field(default=0, ge=0, le=9)

        @api.get("/health")
        def health():
            return {
                "status": "ok",
                "model": self.name,
                "gpu": "L4",
                "load_seconds": self.load_seconds,
            }

        @api.post("/generate-motion")
        def generate_motion(req: MotionRequest):
            try:
                bvh = self.generate(req.prompt.strip(), req.duration, req.variant)
            except Exception as e:
                raise HTTPException(500, f"motion generation failed: {e}")
            return Response(bvh, media_type="text/plain")

        return api


@app.local_entrypoint()
def main(prompt: str = "a person waves hello", duration: float = 5.0):
    t = time.time()
    bvh = Kimodo().generate_remote.remote(prompt, duration)
    out = "test_motion_modal.bvh"
    with open(out, "wb") as f:
        f.write(bvh)
    print(f"{len(bvh) / 1024:.0f} KB BVH in {time.time() - t:.1f}s -> {out}")
