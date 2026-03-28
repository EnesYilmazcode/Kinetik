import httpx
import sys

RUNPOD_URL = "https://c8sh4j1k8nkzp9-8000.proxy.runpod.net"

# 1. Health check
print("Checking health...")
r = httpx.get(f"{RUNPOD_URL}/health", timeout=30)
print("Health:", r.json())

# 2. Generate motion
prompt = sys.argv[1] if len(sys.argv) > 1 else "A person walks forward casually"
duration = float(sys.argv[2]) if len(sys.argv) > 2 else 5.0

print(f"\nGenerating: \"{prompt}\" ({duration}s)")
r = httpx.post(f"{RUNPOD_URL}/generate-motion", json={
    "prompt": prompt,
    "duration": duration
}, timeout=120)

if r.status_code == 200 and "error" not in r.headers.get("content-type", ""):
    with open("test_motion.bvh", "wb") as f:
        f.write(r.content)
    print("SUCCESS! Saved to test_motion.bvh")
    print("Open viewer.html in your browser to see the animation")
else:
    print("Error:", r.status_code, r.text)
