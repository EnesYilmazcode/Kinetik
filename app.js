import * as THREE from 'three';
import { BVHLoader } from 'three/addons/loaders/BVHLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createCharacter } from './character.js';

// Kimodo motion server on Modal (scripts/modal_app.py). Override with ?api=<url>.
const API = new URLSearchParams(location.search).get('api')
    || 'https://enesyilmaz5157--kinetik-kimodo-web.modal.run';
const GEMINI_KEY = ''; // Set your Gemini API key here (see .env)
if (!GEMINI_KEY) console.warn('GEMINI_KEY not set — scene generation will not work (see .env)');
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;
const viewport = document.getElementById('viewport');

// Three.js setup
const scene = new THREE.Scene();
const IS_SMALL = Math.min(window.innerWidth, window.innerHeight) < 600;

const camera = new THREE.PerspectiveCamera(50, viewport.clientWidth / viewport.clientHeight, 5, 12000);
camera.position.set(380, 300, 560);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(viewport.clientWidth, viewport.clientHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
viewport.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 30, 0);
// The empty stage turns slowly until there is a scene to look at.
controls.autoRotate = true;
controls.autoRotateSpeed = 0.35;
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 90;
controls.maxDistance = 2500;
controls.maxPolarAngle = Math.PI * 0.48; // stay above the ground
controls.update();

// Grid (empty state only; hidden once a scene is built)
const grid = new THREE.GridHelper(1200, 24, 0xbdb9ad, 0xcfccc2);
grid.material.transparent = true;
grid.material.opacity = 0.6;
scene.add(grid);

// ========== ENVIRONMENT: sky, fog, sun + hemisphere ==========
// Mood presets. Colors are what you see on screen (the sky skips tone mapping).
const ENV_PRESETS = {
    studio: { top: '#e9e6de', horizon: '#f2f0ea', below: '#e4e1d8', sun: '#fff6ea', sunI: 2.4, sky: '#eef0f6', ground: '#b3ab98', hemiI: 1.9, fog: [900, 3200], exposure: 1.0 },
    day:    { top: '#7fa6d6', horizon: '#e6e4da', below: '#cfcbbd', sun: '#fff1dc', sunI: 2.8, sky: '#dce7f5', ground: '#9a8e76', hemiI: 2.0, fog: [900, 3600], exposure: 1.0 },
    dusk:   { top: '#5a6aa0', horizon: '#f1c9a2', below: '#b99a84', sun: '#ffc489', sunI: 2.6, sky: '#c8c4e0', ground: '#7d6858', hemiI: 1.6, fog: [800, 3200], exposure: 1.05 },
    night:  { top: '#0f1729', horizon: '#34405f', below: '#20263a', sun: '#b4c6ff', sunI: 2.4, sky: '#7b8bc0', ground: '#3b3a4c', hemiI: 1.6, fog: [600, 2800], exposure: 1.25 },
    indoor: { top: '#ddd6cb', horizon: '#eee8de', below: '#d6cfc3', sun: '#fff0dc', sunI: 2.2, sky: '#f4ede2', ground: '#9c8d79', hemiI: 2.0, fog: [900, 3000], exposure: 1.0 },
};

const sky = new THREE.Mesh(
    new THREE.SphereGeometry(5000, 32, 16),
    new THREE.ShaderMaterial({
        uniforms: {
            top: { value: new THREE.Color() },
            horizon: { value: new THREE.Color() },
            below: { value: new THREE.Color() },
        },
        vertexShader: `varying vec3 vWorld;
            void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 below; varying vec3 vWorld;
            void main() { float h = normalize(vWorld - cameraPosition).y;
            vec3 c = h > 0.0 ? mix(horizon, top, pow(min(h * 1.6, 1.0), 0.7)) : mix(horizon, below, min(-h * 6.0, 1.0));
            gl_FragColor = vec4(c, 1.0);
            #include <colorspace_fragment>
            }`,
        side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
    })
);
sky.renderOrder = -1;
sky.frustumCulled = false;
scene.add(sky);

const hemiLight = new THREE.HemisphereLight(0xffffff, 0x888888, 1.2);
scene.add(hemiLight);

const sun = new THREE.DirectionalLight(0xffffff, 2.5);
const SUN_OFFSET = new THREE.Vector3(320, 560, 260);
sun.position.copy(SUN_OFFSET);
sun.castShadow = true;
sun.shadow.mapSize.set(IS_SMALL ? 1024 : 2048, IS_SMALL ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -520, right: 520, top: 520, bottom: -520, near: 50, far: 2000 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.8;
scene.add(sun, sun.target);

// Soft contact shadow under the character, so feet read as grounded
// even where the shadow map is coarse.
const contactShadow = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0.22)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const m = new THREE.Mesh(
        new THREE.PlaneGeometry(90, 90),
        new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, opacity: 0.6 })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.6;
    m.renderOrder = 1;
    m.visible = false;
    scene.add(m);
    return m;
})();

let envName = 'studio';
function applyEnvironment(name) {
    const p = ENV_PRESETS[name] || ENV_PRESETS.day;
    envName = name;
    sky.material.uniforms.top.value.set(p.top);
    sky.material.uniforms.horizon.value.set(p.horizon);
    sky.material.uniforms.below.value.set(p.below);
    scene.fog = new THREE.Fog(p.horizon, p.fog[0], p.fog[1]);
    sun.color.set(p.sun);
    sun.intensity = p.sunI;
    hemiLight.color.set(p.sky);
    hemiLight.groundColor.set(p.ground);
    hemiLight.intensity = p.hemiI;
    renderer.toneMappingExposure = p.exposure;
}
applyEnvironment('studio');

// Pick a mood from the prompt and scene type.
function environmentFor(prompt, sceneType) {
    const p = (prompt || '').toLowerCase();
    if (/\b(night|midnight|spooky|haunted|graveyard|cemetery|moon|moonlit|dark)\b/.test(p)) return 'night';
    if (/\b(sunset|sunrise|dusk|dawn|evening|golden hour)\b/.test(p)) return 'dusk';
    if (sceneType === 'indoor') return 'indoor';
    return 'day';
}

// Every mesh under obj casts and receives shadows.
function enableShadows(obj) {
    obj.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
}

// The BVH root bone stays at the origin; Hips carries the actual travel.
let _hipsBone = null, _hipsRoot = null;
function characterAnchor(out) {
    if (!currentBones) return null;
    if (_hipsRoot !== currentBones) { _hipsRoot = currentBones; _hipsBone = findBone(currentBones, 'Hips') || currentBones; }
    return _hipsBone.getWorldPosition(out);
}

let mixer = null;
let currentBones = null;
let currentHelper = null;
let characterGroup = null;
let bodyMeshes = [];
// Selection & animation control state
let selectedObject = null, selectedType = null;
let selectionBox = null; // purple wireframe box around selected object

function showSelectionBox(obj) {
    removeSelectionBox();
    const box = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    // Add a little padding
    size.multiplyScalar(1.08);
    const geo = new THREE.BoxGeometry(size.x, size.y, size.z);
    const edges = new THREE.EdgesGeometry(geo);
    const mat = new THREE.LineBasicMaterial({ color: 0x9b7fd4, transparent: true, opacity: 1 });
    selectionBox = new THREE.LineSegments(edges, mat);
    selectionBox.position.copy(center);
    selectionBox.userData._isSelectionBox = true;
    scene.add(selectionBox);
}

function removeSelectionBox() {
    if (selectionBox) {
        scene.remove(selectionBox);
        selectionBox.geometry.dispose();
        selectionBox.material.dispose();
        selectionBox = null;
    }
}
let skinnedCharMesh = null;
let character = null;

let currentClip = null, currentAction = null;
let isPlaying = true, isScrubbing = false;
let lastBvhText = null;
let timelineClips = [];
let totalDuration = 0;
let groundMesh = null; // Reference to ground plane for dynamic repositioning
const clock = new THREE.Clock();

// Body segments: [fromBone, toBone, radiusTop, radiusBottom]
// Modeled after a wooden drawing mannequin
const BODY_SEGMENTS = [
    // Full torso — one smooth piece, broader at top
    ['Hips', 'Neck1', 10, 7],
    // Neck
    ['Neck1', 'Head', 3, 3],
    // Shoulders
    ['Chest', 'LeftShoulder', 5, 4],
    ['Chest', 'RightShoulder', 5, 4],
    // Left arm
    ['LeftShoulder', 'LeftArm', 4, 3.5],
    ['LeftArm', 'LeftForeArm', 3.5, 3],
    ['LeftForeArm', 'LeftHand', 3, 2],
    // Right arm
    ['RightShoulder', 'RightArm', 4, 3.5],
    ['RightArm', 'RightForeArm', 3.5, 3],
    ['RightForeArm', 'RightHand', 3, 2],
    // Left leg
    ['LeftLeg', 'LeftShin', 5.5, 4],
    ['LeftShin', 'LeftFoot', 4, 3],
    ['LeftFoot', 'LeftToeBase', 3, 2],
    // Right leg
    ['RightLeg', 'RightShin', 5.5, 4],
    ['RightShin', 'RightFoot', 4, 3],
    ['RightFoot', 'RightToeBase', 3, 2],
    // Hip to leg — thin peg connectors
    ['Hips', 'LeftLeg', 3.5, 3.5],
    ['Hips', 'RightLeg', 3.5, 3.5],
];

const bodyColor = 0xd4b896; // wooden mannequin color

function findBone(root, name) {
    if (root.name === name) return root;
    for (const child of root.children) {
        const found = findBone(child, name);
        if (found) return found;
    }
    return null;
}

function createBodyMeshes(rootBone) {
    bodyMeshes.forEach(m => scene.remove(m));
    bodyMeshes = [];

    const mat = new THREE.MeshStandardMaterial({
        color: bodyColor, roughness: 0.75, metalness: 0.0,
    });

    // Head — elongated sphere
    const headBone = findBone(rootBone, 'HeadEnd');
    if (headBone) {
        const geo = new THREE.SphereGeometry(1, 24, 20);
        const mesh = new THREE.Mesh(geo, mat.clone());
        mesh.userData.type = 'head';
        mesh.userData.bone = headBone;
        mesh.userData.baseBone = findBone(rootBone, 'Head');
        scene.add(mesh);
        bodyMeshes.push(mesh);
    }

    // Smooth tapered cylinders between bone pairs
    const tv1 = new THREE.Vector3();
    const tv2 = new THREE.Vector3();

    for (const [fromName, toName, rTop, rBot] of BODY_SEGMENTS) {
        const fromBone = findBone(rootBone, fromName);
        const toBone = findBone(rootBone, toName);
        if (!fromBone || !toBone) continue;

        fromBone.getWorldPosition(tv1);
        toBone.getWorldPosition(tv2);
        const dist = tv1.distanceTo(tv2);

        // Tapered cylinder with hemisphere caps via LatheGeometry
        const height = Math.max(dist, 1);
        const segments = 20; // smoother capsules
        // Create smooth profile: bottom cap → cylinder → top cap
        const points = [];
        const capSteps = 8;
        // Bottom hemisphere cap
        for (let i = 0; i <= capSteps; i++) {
            const angle = (Math.PI / 2) * (i / capSteps);
            points.push(new THREE.Vector2(
                Math.sin(angle) * rBot,
                -height / 2 - Math.cos(angle) * rBot + rBot
            ));
        }
        // Tapered body
        points.push(new THREE.Vector2(rBot, -height / 2 + rBot));
        points.push(new THREE.Vector2(rTop, height / 2 - rTop));
        // Top hemisphere cap
        for (let i = 0; i <= capSteps; i++) {
            const angle = (Math.PI / 2) * (i / capSteps);
            points.push(new THREE.Vector2(
                Math.cos(angle) * rTop,
                height / 2 + Math.sin(angle) * rTop - rTop
            ));
        }

        const geo = new THREE.LatheGeometry(points, segments);
        const mesh = new THREE.Mesh(geo, mat.clone());
        mesh.userData.type = 'capsule';
        mesh.userData.fromBone = fromBone;
        mesh.userData.toBone = toBone;
        mesh.castShadow = true;
        scene.add(mesh);
        bodyMeshes.push(mesh);
    }

    // Hands — slightly flattened spheres
    for (const handName of ['LeftHand', 'RightHand']) {
        const bone = findBone(rootBone, handName);
        if (bone) {
            const geo = new THREE.SphereGeometry(4, 12, 10);
            const mesh = new THREE.Mesh(geo, mat.clone());
            mesh.userData.type = 'joint';
            mesh.userData.bone = bone;
            scene.add(mesh);
            bodyMeshes.push(mesh);
        }
    }
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();
const _dir = new THREE.Vector3();

function updateBodyMeshes() {
    for (const mesh of bodyMeshes) {
        if (mesh.userData.type === 'head') {
            // Position between Head and HeadEnd, scale as ellipsoid
            const base = mesh.userData.baseBone;
            const top = mesh.userData.bone;
            base.getWorldPosition(_v1);
            top.getWorldPosition(_v2);
            _mid.lerpVectors(_v1, _v2, 0.5);
            mesh.position.copy(_mid);
            const h = _v1.distanceTo(_v2);
            mesh.scale.set(8, h * 0.6, 8.5);
            _dir.subVectors(_v2, _v1).normalize();
            if (_dir.lengthSq() > 0.0001) {
                _quat.setFromUnitVectors(_up, _dir);
                mesh.quaternion.copy(_quat);
            }
            continue;
        }

        if (mesh.userData.type === 'joint') {
            mesh.userData.bone.getWorldPosition(_v1);
            mesh.position.copy(_v1);
            continue;
        }

        // Capsule — position at midpoint, orient along bone axis
        const from = mesh.userData.fromBone;
        const to = mesh.userData.toBone;
        from.getWorldPosition(_v1);
        to.getWorldPosition(_v2);

        _mid.lerpVectors(_v1, _v2, 0.5);
        mesh.position.copy(_mid);

        _dir.subVectors(_v2, _v1).normalize();
        if (_dir.lengthSq() > 0.0001) {
            _quat.setFromUnitVectors(_up, _dir);
            mesh.quaternion.copy(_quat);
        }
    }
}

// Extract the character's root path from a BVH clip (sample every N frames)
// Silently rewrite the user's prompt to produce better, more dynamic motion.
// Always biases toward locomotion (walking/moving forward) and exaggerated body movement.
function enhanceMotionPrompt(userPrompt) {
    let p = userPrompt;

    // Replace common verbs with more dynamic versions
    // Convert terrain-related prompts to actions Kimodo handles better
    p = p.replace(/\bclimb(?:s|ing)?\s+(?:a\s+)?(?:hill|mountain|slope|incline|ridge)\b/gi, 'climbs up a long staircase steadily, one step at a time');
    p = p.replace(/\b(?:go|goes|going|walk|walks|walking)\s+up(?:hill| a hill| the hill| a slope)\b/gi, 'walks up stairs steadily');
    p = p.replace(/\b(?:go|goes|going|walk|walks|walking)\s+down(?:hill| a hill| the hill| a slope)\b/gi, 'walks down stairs carefully');
    p = p.replace(/\bhike(?:s|ing)?\b/gi, 'walks up and down stairs while moving forward');

    const replacements = {
        'walks': 'walks forward confidently with long strides and arm swings',
        'walk': 'walk forward with long exaggerated strides, swinging arms',
        'runs': 'runs forward fast with high knees, pumping arms, covering ground',
        'run': 'run forward fast with high knees, pumping arms, covering distance',
        'jogs': 'jogs forward energetically with bouncy steps, moving across the space',
        'jog': 'jog forward energetically with bouncy steps covering ground',
        'dances': 'dances with large expressive full-body movements, stepping side to side',
        'dance': 'dance with big expressive full-body movements, stepping around the space',
        'stands': 'shifts weight and moves around slowly while standing',
        'stand': 'shift weight and sway while moving slightly forward',
        'sits': 'sits down then gets up and moves around',
        'sit': 'sit down briefly then stand and walk forward',
        'does karate': 'performs karate kicks and punches while stepping forward aggressively',
        'does kung fu': 'performs kung fu strikes and kicks moving across the floor',
        'fights': 'fights with punches and kicks, advancing forward aggressively',
        'trips': 'trips and stumbles forward dramatically, arms flailing',
        'falls': 'falls forward dramatically with arms reaching out',
        'sneaks': 'sneaks forward in a low crouch, moving carefully across the space',
        'sneak': 'sneak forward in a low crouch, tiptoeing across the room',
        'explores': 'walks around exploring, looking in different directions while moving',
        'relaxes': 'stretches and moves around lazily, shifting positions',
        'celebrates': 'jumps and pumps fists while moving around excitedly',
        'shops': 'walks forward browsing, stopping briefly then moving on',
    };

    // Apply replacements (case-insensitive, whole word)
    for (const [from, to] of Object.entries(replacements)) {
        const regex = new RegExp('\\b' + from + '\\b', 'gi');
        p = p.replace(regex, to);
    }

    // If no movement verb was found, append locomotion bias
    const hasMovement = /walk|run|jog|step|move|kick|punch|jump|dance|sneak|strid|crawl/i.test(p);
    if (!hasMovement) {
        p += '. The person should walk forward while doing this, covering distance across the space';
    }

    // Always append quality suffix
    p += '. Make all movements large, exaggerated, and continuous. The person should travel forward through space, not stay in place.';

    return p;
}

function extractPathFromBVH(text) {
    const loader = new BVHLoader();
    const result = loader.parse(text);
    const clip = result.clip;
    const root = result.skeleton.bones[0];

    // Find the Hips position track (Root stays at 0,0,0 — Hips has the actual movement)
    const posTrack = clip.tracks.find(t => t.name.includes('Hips') && t.name.endsWith('.position'))
        || clip.tracks.find(t => t.name.endsWith('.position'));
    if (!posTrack) return { path: [[0, 0]], result };

    const values = posTrack.values;
    const totalFrames = values.length / 3;
    const path = [];
    const numSamples = Math.min(30, totalFrames); // More samples for smoother path
    const step = Math.max(1, Math.floor(totalFrames / numSamples));
    for (let i = 0; i < totalFrames; i += step) {
        const x = values[i * 3];
        const y = values[i * 3 + 1]; // height
        const z = values[i * 3 + 2];
        path.push([Math.round(x), Math.round(y), Math.round(z)]);
    }
    if (totalFrames > 0) {
        const lx = values[(totalFrames - 1) * 3];
        const ly = values[(totalFrames - 1) * 3 + 1];
        const lz = values[(totalFrames - 1) * 3 + 2];
        path.push([Math.round(lx), Math.round(ly), Math.round(lz)]);
    }
    return { path, result };
}

async function loadBVH(text) {
    // Clear previous
    if (characterGroup) scene.remove(characterGroup);
    if (currentHelper) scene.remove(currentHelper);
    if (character) { character.dispose(); character = null; }
    skinnedCharMesh = null;
    bodyMeshes.forEach(m => scene.remove(m));
    bodyMeshes = [];

    const loader = new BVHLoader();
    const result = loader.parse(text);

    characterGroup = new THREE.Group();
    currentBones = result.skeleton.bones[0];
    characterGroup.add(currentBones);
    scene.add(characterGroup);
    currentHelper = null;

    // Skinned human; the capsule mannequin is only a fallback if it fails to load.
    const group = characterGroup;
    let footClearance = 2;
    try {
        const c = await createCharacter(currentBones, THREE, GLTFLoader);
        if (group !== characterGroup) { c.dispose(); return; } // a newer clip replaced this one
        character = c;
        skinnedCharMesh = c.object;
        group.add(c.object);
        footClearance = c.footClearance;
    } catch (e) {
        console.warn('Character failed to load, using mannequin', e);
        createBodyMeshes(currentBones);
    }

    // Use a SINGLE mixer for both sampling and playback.
    // Previous approach (tempMixer + setTime + uncacheRoot) was unreliable.
    mixer = new THREE.AnimationMixer(currentBones);
    mixer.timeScale = 1.5;
    currentClip = result.clip;
    currentAction = mixer.clipAction(currentClip);
    currentAction.play();

    // Sample foot bone positions across the animation to find the lowest Y.
    // Use mixer.update(dt) — the standard Three.js way to evaluate tracks —
    // instead of setTime() which may not reliably apply all track types.
    let globalMinY = Infinity;
    const bonePos = new THREE.Vector3();
    const clipDuration = result.clip.duration;
    const samples = 20;
    const dt = clipDuration / samples;
    const footNames = ['LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase'];

    for (let s = 0; s <= samples; s++) {
        mixer.update(s === 0 ? 0.0001 : dt);
        characterGroup.updateMatrixWorld(true);
        for (const name of footNames) {
            const bone = findBone(currentBones, name);
            if (bone) {
                bone.getWorldPosition(bonePos);
                if (bonePos.y < globalMinY) globalMinY = bonePos.y;
            }
        }
    }

    // Ground the character so the lowest sole touches Y=0.
    characterGroup.position.y = -(globalMinY - footClearance);

    // Reset to beginning for clean playback
    currentAction.reset();
    currentAction.play();
    isPlaying = true;
    mixer.setTime(0);
    clock.getDelta(); // drain clock so first frame gets a small delta

    document.getElementById('gen-info').textContent =
        `${result.skeleton.bones.length} joints — ${result.clip.duration.toFixed(1)}s @ 30fps`;
}

// ========== GEMINI SCENE AGENT ==========

// Gemini only picks WHAT objects — client code handles WHERE to place them
const SCENE_SYSTEM_PROMPT = `You are a creative 3D scene designer. Given a user prompt, pick objects that belong in the scene. Output ONLY valid JSON (no markdown, no backticks).

You do NOT need to specify positions — the engine handles placement automatically. Just pick the right objects.

JSON structure:
{"scene":{"type":"outdoor"|"indoor","models":[{"keyword":"search term","category":number,"size":"large"|"medium"|"small"}],"ground":{"color":"#hex"},"lights":[{"type":"ambient"|"directional"|"point","intensity":0-3,"color":"#hex","position":[x,y,z]}]},"motion_prompt":"A person ..."}

POLY PIZZA CATEGORIES: 0=Food, 1=Clutter, 3=Transport, 4=Furniture, 5=Objects, 6=Nature, 7=Animals, 8=Buildings, 11=Other

CRITICAL — THEMATIC RELEVANCE:
Every model MUST belong in the scene. "Would this object exist in this real-world location?"
- Living room: sofa, table, lamp, bookshelf, TV, plant. NOT: car, building, tree, hydrant
- City street: building, apartment, car, lamp, bench. NOT: sofa, bed, campfire
- Forest: tree, rock, log, mushroom, campfire. NOT: skyscraper, car, desk
- Beach: palm, umbrella, boat, rock. NOT: building, bookshelf
Think carefully. Every object must make sense for the specific scene.

BANNED KEYWORDS (NEVER use): "fence", "gate", "wall", "barrier", "shelter", "bus stop", "bus shelter", "canopy", "awning", "stop sign", "road barrier", "barricade"

SIZE GUIDE:
- "large": buildings, houses, large trees, skyscrapers (background structures)
- "medium": cars, street lamps, small trees, sofas, bookshelves (mid-sized objects)
- "small": bench, chair, hydrant, trash can, flower, cone, barrel, crate (small props)

RULES:
- 6-8 models. Mix: 2-3 large + 2-3 medium + 2-3 small
- Each keyword must be UNIQUE — no repeats
- Be CREATIVE with keywords! Don't use the same objects every time. Examples:
  Buildings: apartment, church, castle, tower, warehouse, factory, hotel, restaurant, bakery, cinema, museum, cottage, cabin
  Nature: oak, pine, palm, willow, cactus, bush, boulder, stump, mushroom
  Vehicles: sedan, truck, motorcycle, bicycle, taxi, ambulance, van, boat, scooter
  Props: lamppost, hydrant, mailbox, barrel, crate, statue, fountain, well, windmill, flag, phone booth, umbrella, trashcan, planter
  Furniture: sofa, armchair, bookshelf, desk, bed, dresser, TV, piano, rug, clock
- motion_prompt MUST start with "A person" and describe expressive, continuous motion
- 2-3 lights, always include ambient (0.8-1.5). No fog.`;

// A readable reason for a Gemini call that came back without text.
function geminiProblem(res, data) {
    if (!GEMINI_KEY) return 'No Gemini API key set (GEMINI_KEY in app.js)';
    if (data?.error?.message) return `Gemini: ${data.error.message}`;
    return `Gemini returned no text (HTTP ${res.status})`;
}

async function callGemini(userPrompt, characterPath = null) {
    let fullPrompt = SCENE_SYSTEM_PROMPT + '\n\nUser prompt: ' + userPrompt;
    if (characterPath && characterPath.length > 0) {
        // Send only x,z to Gemini (it doesn't need Y)
        const flatPath = characterPath.map(p => [p[0], p[2] || p[1]]);
        fullPrompt += `\n\nCHARACTER PATH (the character moves through these [x,z] points — DO NOT place any object within 150 units of this path):\n${JSON.stringify(flatPath)}`;
    }
    const res = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: fullPrompt }] }],
            generationConfig: { temperature: 0.7 }
        })
    });
    const data = await res.json().catch(() => ({}));
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error(geminiProblem(res, data));
    // Strip markdown code fences if present
    const clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    return JSON.parse(clean);
}

const gltfLoader = new GLTFLoader();
let sceneObjects = [];
let pathLine = null;
let pathVisible = false;

// ========== PROCEDURAL GROUND TEXTURE ==========
function createTexturedGround(size, baseColor) {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 512;
    const ctx = canvas.getContext('2d');

    // Parse base color
    const tmp = new THREE.Color(baseColor);
    const r = Math.floor(tmp.r * 255), g = Math.floor(tmp.g * 255), b = Math.floor(tmp.b * 255);

    // Fill base
    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, 512, 512);

    // Add noise variation — multiple passes for organic feel
    for (let pass = 0; pass < 3; pass++) {
        const blockSize = [16, 8, 4][pass];
        const strength = [25, 15, 8][pass];
        for (let y = 0; y < 512; y += blockSize) {
            for (let x = 0; x < 512; x += blockSize) {
                const vary = (Math.random() - 0.5) * strength;
                const nr = Math.min(255, Math.max(0, r + vary));
                const ng = Math.min(255, Math.max(0, g + vary * 0.9));
                const nb = Math.min(255, Math.max(0, b + vary * 0.7));
                ctx.fillStyle = `rgba(${nr|0},${ng|0},${nb|0},${[0.6, 0.4, 0.3][pass]})`;
                ctx.fillRect(x, y, blockSize, blockSize);
            }
        }
    }

    // Add subtle grid lines for spatial reference
    ctx.strokeStyle = `rgba(${Math.max(0,r-30)},${Math.max(0,g-30)},${Math.max(0,b-30)},0.08)`;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 512; i += 64) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 512); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(512, i); ctx.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(size / 200, size / 200);

    const geo = new THREE.PlaneGeometry(size, size, 64, 64); // 64x64 subdivisions for terrain
    const mat = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.92 });
    const plane = new THREE.Mesh(geo, mat);
    plane.rotation.x = -Math.PI / 2;
    plane.receiveShadow = true;
    return plane;
}

// Displace terrain vertices based on path Y values
function applyTerrainFromPath(terrainMesh, pathPoints) {
    if (!pathPoints || pathPoints.length < 2) return;
    const baseY = pathPoints[0][1] || 94;

    // Detect sustained elevation: look at the trend, not spikes (jumps)
    // Smooth the Y values first to filter out jumps
    const smoothedY = pathPoints.map((p, i) => {
        const y = p[1] || 94;
        // Average with neighbors (3-point moving average)
        const prev = (pathPoints[i - 1]?.[1] || y);
        const next = (pathPoints[i + 1]?.[1] || y);
        return (prev + y + next) / 3;
    });

    // Check if there's a sustained trend (not just bouncing)
    const maxSmoothedDelta = Math.max(...smoothedY.map(y => Math.abs(y - baseY)));
    if (maxSmoothedDelta < 3) return; // No meaningful elevation

    const posAttr = terrainMesh.geometry.getAttribute('position');

    for (let i = 0; i < posAttr.count; i++) {
        // PlaneGeometry is created in XY plane, then rotated -90° on X.
        // Before rotation: local X = world X, local Y = world -Z
        const vx = posAttr.getX(i);   // world X
        const vz = -posAttr.getY(i);  // world Z (negated!)

        // Find two closest path points and interpolate — allows both incline AND decline
        let best1 = { d: Infinity, h: 0 }, best2 = { d: Infinity, h: 0 };

        for (let j = 0; j < pathPoints.length; j++) {
            const p = pathPoints[j];
            const px = p[0], pz = p[2] || 0;
            const d = Math.sqrt((vx - px) ** 2 + (vz - pz) ** 2);
            const h = smoothedY[j] - baseY;
            if (d < best1.d) {
                best2 = { ...best1 };
                best1 = { d, h };
            } else if (d < best2.d) {
                best2 = { d, h };
            }
        }

        // Interpolate between two nearest for smooth slopes
        const totalD = best1.d + best2.d;
        const height = totalD > 0.1
            ? (best1.h * (1 - best1.d / totalD) + best2.h * (1 - best2.d / totalD))
            : best1.h;

        // Wider falloff near the path, tight enough to look like terrain
        const influence = Math.exp(-(best1.d * best1.d) / (120 * 120));
        posAttr.setZ(i, height * influence * 1.2);
    }
    posAttr.needsUpdate = true;
    terrainMesh.geometry.computeVertexNormals();
}

// ========== PATH VISUALIZATION ==========
// Extract path from an AnimationClip directly (not BVH text)
function extractPathFromClip(clip) {
    const posTrack = clip.tracks.find(t => t.name.includes('Hips') && t.name.endsWith('.position'));
    if (!posTrack) return [[0, 0, 0]];
    const values = posTrack.values;
    const totalFrames = values.length / 3;
    const path = [];
    const numSamples = Math.min(40, totalFrames);
    const step = Math.max(1, Math.floor(totalFrames / numSamples));
    for (let i = 0; i < totalFrames; i += step) {
        path.push([Math.round(values[i * 3]), Math.round(values[i * 3 + 1]), Math.round(values[i * 3 + 2])]);
    }
    if (totalFrames > 0) {
        path.push([Math.round(values[(totalFrames - 1) * 3]), Math.round(values[(totalFrames - 1) * 3 + 1]), Math.round(values[(totalFrames - 1) * 3 + 2])]);
    }
    return path;
}

// Spawn fill objects around new path areas that don't have coverage yet
function extendEnvironmentAlongPath(newPath) {
    const MIN_DIST = 60;
    const existingPositions = [];
    sceneObjects.forEach(obj => {
        if (obj.userData._isGround) return;
        existingPositions.push([obj.position.x, obj.position.z]);
    });

    const fillKeywords = ['tree', 'pine', 'bush', 'rock'];
    let added = 0;

    for (const [px, , pz] of newPath) {
        // Spawn objects on both sides of the path at this waypoint
        for (let attempt = 0; attempt < 8; attempt++) {
            const side = attempt % 2 === 0 ? -1 : 1;
            const offsetX = side * (120 + Math.random() * 250);
            const offsetZ = (Math.random() - 0.5) * 200;
            const fx = px + offsetX;
            const fz = (pz || 0) + offsetZ;

            // Check distance from existing objects
            let tooClose = false;
            for (const [ex, ez] of existingPositions) {
                if (Math.sqrt((fx - ex) ** 2 + (fz - ez) ** 2) < MIN_DIST) {
                    tooClose = true; break;
                }
            }
            // Check distance from path
            for (const [ppx, , ppz] of newPath) {
                if (Math.sqrt((fx - ppx) ** 2 + (fz - (ppz||0)) ** 2) < 100) {
                    tooClose = true; break;
                }
            }
            if (tooClose) continue;

            existingPositions.push([fx, fz]);
            const kw = fillKeywords[Math.floor(Math.random() * fillKeywords.length)];
            const scale = kw === 'rock' ? 15 + Math.random() * 15
                : kw === 'bush' ? 25 + Math.random() * 15
                : 120 + Math.random() * 40;

            const proc = tryProceduralModel(kw, scale);
            if (proc) {
                proc.position.set(fx, 0, fz);
                proc.rotation.y = Math.random() * Math.PI * 2;
                enableShadows(proc);
                scene.add(proc);
                sceneObjects.push(proc);
                added++;
            }
        }
    }
    if (added > 0) log(`Extended environment (${added} objects)`, 'scene');
}

function updatePathVisualization(charPath) {
    // Remove old path
    if (pathLine) { scene.remove(pathLine); pathLine = null; }
    if (!charPath || charPath.length < 2) return;

    const group = new THREE.Group();

    // Main path line
    const baseY = charPath[0]?.[1] || 94;
    const points = charPath.map(p => {
        const elevation = (p[1] || 94) - baseY; // height relative to baseline
        return new THREE.Vector3(p[0], elevation + 3, p[2] || 0); // slightly above terrain
    });
    const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x7c5cbf });
    const line = new THREE.Line(lineGeo, lineMat);
    group.add(line);

    // Dashed ground shadow of the path
    const shadowPoints = charPath.map(p => {
        const elevation = (p[1] || 94) - baseY;
        return new THREE.Vector3(p[0], elevation + 0.5, p[2] || 0);
    });
    const shadowGeo = new THREE.BufferGeometry().setFromPoints(shadowPoints);
    const shadowMat = new THREE.LineDashedMaterial({ color: 0x7c5cbf, dashSize: 8, gapSize: 6, opacity: 0.3, transparent: true });
    const shadowLine = new THREE.Line(shadowGeo, shadowMat);
    shadowLine.computeLineDistances();
    group.add(shadowLine);

    // Waypoint markers
    const markerGeo = new THREE.SphereGeometry(3, 8, 6);
    const markerMat = new THREE.MeshStandardMaterial({ color: 0x7c5cbf, emissive: 0x4a3080, emissiveIntensity: 0.3 });
    charPath.forEach((p, i) => {
        const marker = new THREE.Mesh(markerGeo, markerMat);
        const elev = (p[1] || 94) - baseY;
        marker.position.set(p[0], elev + 3, p[2] || 0);
        group.add(marker);

        // Start/end labels — larger markers
        if (i === 0 || i === charPath.length - 1) {
            const big = new THREE.Mesh(
                new THREE.SphereGeometry(5, 10, 8),
                new THREE.MeshStandardMaterial({
                    color: i === 0 ? 0x2d8a4e : 0xc53030,
                    emissive: i === 0 ? 0x1a5530 : 0x801a1a,
                    emissiveIntensity: 0.4
                })
            );
            const bigElev = (p[1] || 94) - baseY;
            big.position.set(p[0], bigElev + 5, p[2] || 0);
            group.add(big);
        }
    });

    // Direction arrows along the path
    const arrowMat = new THREE.MeshStandardMaterial({ color: 0x7c5cbf });
    for (let i = 0; i < points.length - 1; i += 2) {
        const from = points[i], to = points[Math.min(i + 1, points.length - 1)];
        const dir = new THREE.Vector3().subVectors(to, from);
        if (dir.length() < 5) continue;
        const mid = new THREE.Vector3().lerpVectors(from, to, 0.5);
        const arrow = new THREE.Mesh(new THREE.ConeGeometry(2.5, 8, 4), arrowMat);
        arrow.position.copy(mid);
        arrow.position.y = 3;
        arrow.lookAt(to);
        arrow.rotateX(Math.PI / 2);
        group.add(arrow);
    }

    group.visible = pathVisible;
    pathLine = group;
    scene.add(group);
}

function togglePath() {
    pathVisible = !pathVisible;
    if (pathLine) pathLine.visible = pathVisible;
    const btn = document.getElementById('path-toggle');
    btn.classList.toggle('active', pathVisible);
    btn.textContent = pathVisible ? 'Hide path' : 'Show path';
}
document.getElementById('path-toggle').addEventListener('click', togglePath);

// ========== BOUNDING BOX DEBUG ==========
let bboxHelpers = [];
let bboxVisible = false;

function showBoundingBoxes() {
    // Clear old
    bboxHelpers.forEach(h => scene.remove(h));
    bboxHelpers = [];

    for (const obj of sceneObjects) {
        if (obj.userData._isGround) continue;
        if (!obj.isGroup && !obj.isMesh && !obj.children?.length) continue;

        const box = new THREE.Box3().setFromObject(obj);
        if (box.isEmpty()) continue;

        const helper = new THREE.Box3Helper(box, 0x00ff88);
        helper.userData._isBbox = true;
        scene.add(helper);
        bboxHelpers.push(helper);
    }
}

function toggleBBox() {
    bboxVisible = !bboxVisible;
    if (bboxVisible) {
        showBoundingBoxes();
    } else {
        bboxHelpers.forEach(h => scene.remove(h));
        bboxHelpers = [];
    }
    const bboxBtn = document.getElementById('bbox-toggle');
    if (bboxBtn) bboxBtn.classList.toggle('active', bboxVisible);
}
const bboxBtn = document.getElementById('bbox-toggle');
if (bboxBtn) bboxBtn.addEventListener('click', toggleBBox);

// ========== PROCEDURAL FALLBACK MODELS ==========
// Used when Poly Pizza doesn't have a good match

function _mat(color, opts = {}) {
    return new THREE.MeshStandardMaterial({ color, roughness: opts.r || 0.8, metalness: opts.m || 0, emissive: opts.e || 0, emissiveIntensity: opts.ei || 0 });
}

function makeTrainingDummy(h) {
    const g = new THREE.Group();
    const wood = _mat(0x8B6914);
    // Base
    const base = new THREE.Mesh(new THREE.CylinderGeometry(12, 14, h * 0.05, 12), _mat(0x5C3A1E));
    base.position.y = h * 0.025;
    g.add(base);
    // Main post
    const post = new THREE.Mesh(new THREE.CylinderGeometry(4, 5, h * 0.7, 10), wood);
    post.position.y = h * 0.4;
    g.add(post);
    // Head target (padded cylinder)
    const head = new THREE.Mesh(new THREE.SphereGeometry(8, 12, 10), _mat(0xcc3333));
    head.position.y = h * 0.85;
    g.add(head);
    // Cross arms at different heights
    for (let i = 0; i < 3; i++) {
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 25, 8), wood);
        arm.rotation.z = Math.PI / 2;
        arm.rotation.y = i * 1.2;
        arm.position.y = h * 0.4 + i * h * 0.15;
        arm.position.x = (i % 2 === 0 ? 1 : -1) * 5;
        g.add(arm);
        // Pad on arm end
        const pad = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 3.5, 6, 8), _mat(0xcc3333));
        pad.rotation.z = Math.PI / 2;
        pad.rotation.y = i * 1.2;
        pad.position.set(arm.position.x + (i % 2 === 0 ? 14 : -14), arm.position.y, 0);
        g.add(pad);
    }
    return g;
}

function makeTatamiMat(h) {
    const g = new THREE.Group();
    // Large floor mat with tatami texture pattern
    const size = 250;
    const base = new THREE.Mesh(new THREE.BoxGeometry(size, 3, size), _mat(0xC2B280));
    base.position.y = 1.5;
    g.add(base);
    // Individual tatami rectangles with borders
    const matW = size / 3 - 2, matD = size / 3 - 2;
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
            const border = new THREE.Mesh(new THREE.BoxGeometry(matW, 0.5, matD),
                _mat(r % 2 === c % 2 ? 0xB8A870 : 0xC4B888));
            border.position.set(-size/3 + c * (size/3), 3.5, -size/3 + r * (size/3));
            g.add(border);
            // Edge trim
            const trim = new THREE.Mesh(new THREE.BoxGeometry(matW, 1, 2), _mat(0x2d4a1e));
            trim.position.set(border.position.x, 3.5, border.position.z - matD/2);
            g.add(trim);
        }
    }
    return g;
}

function makePunchingBag(h) {
    const g = new THREE.Group();
    // Ceiling mount bracket
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(8, 3, 8), _mat(0x555555, {m: 0.8}));
    bracket.position.y = h;
    g.add(bracket);
    // Chains (3 of them)
    for (let i = 0; i < 3; i++) {
        const angle = (i / 3) * Math.PI * 2;
        const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, h * 0.2, 4), _mat(0x888888, {m: 0.8}));
        chain.position.set(Math.cos(angle) * 3, h * 0.88, Math.sin(angle) * 3);
        g.add(chain);
    }
    // Bag body (tapered cylinder + rounded bottom)
    const bag = new THREE.Mesh(new THREE.CylinderGeometry(11, 9, h * 0.55, 16), _mat(0x8B1A1A));
    bag.position.y = h * 0.52;
    g.add(bag);
    const bottom = new THREE.Mesh(new THREE.SphereGeometry(9, 16, 8), _mat(0x8B1A1A));
    bottom.scale.y = 0.5;
    bottom.position.y = h * 0.24;
    g.add(bottom);
    // Stitching lines
    for (let i = 0; i < 4; i++) {
        const stitch = new THREE.Mesh(new THREE.BoxGeometry(0.5, h * 0.5, 0.5), _mat(0x440000));
        const a = (i / 4) * Math.PI * 2;
        stitch.position.set(Math.cos(a) * 10.5, h * 0.52, Math.sin(a) * 10.5);
        g.add(stitch);
    }
    return g;
}

function makeLantern(h) {
    const g = new THREE.Group();
    // Hanging cord
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, h * 0.15, 4), _mat(0x333333));
    cord.position.y = h * 0.93;
    g.add(cord);
    // Top cap
    const topCap = new THREE.Mesh(new THREE.CylinderGeometry(h * 0.12, h * 0.18, h * 0.08, 6), _mat(0x222222));
    topCap.position.y = h * 0.82;
    g.add(topCap);
    // Paper body (glowing)
    const body = new THREE.Mesh(new THREE.CylinderGeometry(h * 0.2, h * 0.18, h * 0.5, 12),
        _mat(0xdd4444, {e: 0xff6633, ei: 0.4}));
    body.position.y = h * 0.55;
    g.add(body);
    // Ribs
    for (let i = 0; i < 4; i++) {
        const rib = new THREE.Mesh(new THREE.BoxGeometry(0.8, h * 0.5, 0.8), _mat(0x5C3A1E));
        const a = (i / 4) * Math.PI * 2;
        rib.position.set(Math.cos(a) * h * 0.19, h * 0.55, Math.sin(a) * h * 0.19);
        g.add(rib);
    }
    // Bottom cap
    const botCap = new THREE.Mesh(new THREE.CylinderGeometry(h * 0.15, h * 0.08, h * 0.06, 6), _mat(0x222222));
    botCap.position.y = h * 0.28;
    g.add(botCap);
    // Tassel
    const tassel = new THREE.Mesh(new THREE.ConeGeometry(2, h * 0.1, 6), _mat(0xcc2222));
    tassel.position.y = h * 0.2;
    tassel.rotation.x = Math.PI;
    g.add(tassel);
    return g;
}

function makeWeaponRack(h) {
    const g = new THREE.Group();
    const wood = _mat(0x5C3A1E);
    // Vertical posts
    const postL = new THREE.Mesh(new THREE.BoxGeometry(4, h, 4), wood);
    postL.position.set(-25, h/2, 0);
    g.add(postL);
    const postR = new THREE.Mesh(new THREE.BoxGeometry(4, h, 4), wood);
    postR.position.set(25, h/2, 0);
    g.add(postR);
    // Horizontal supports
    for (let i = 0; i < 3; i++) {
        const support = new THREE.Mesh(new THREE.BoxGeometry(54, 3, 6), wood);
        support.position.y = h * 0.2 + i * h * 0.3;
        g.add(support);
        // Weapon on each shelf
        const weaponColor = [0xaa8844, 0x666666, 0x8B6914][i];
        const weapon = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.2, 45, 6), _mat(weaponColor));
        weapon.rotation.z = Math.PI / 2;
        weapon.position.set(0, h * 0.25 + i * h * 0.3, 5);
        g.add(weapon);
    }
    // Top ornament
    const orn = new THREE.Mesh(new THREE.BoxGeometry(58, 3, 8), _mat(0x3a2210));
    orn.position.y = h * 0.95;
    g.add(orn);
    return g;
}

function makeCushion(h) {
    const g = new THREE.Group();
    // Round meditation cushion (zafu)
    const cushion = new THREE.Mesh(new THREE.CylinderGeometry(14, 16, h * 0.4, 16), _mat(0x4a0080));
    cushion.position.y = h * 0.2;
    g.add(cushion);
    // Pleated sides
    for (let i = 0; i < 12; i++) {
        const pleat = new THREE.Mesh(new THREE.BoxGeometry(1, h * 0.35, 3), _mat(0x3a0060));
        const a = (i / 12) * Math.PI * 2;
        pleat.position.set(Math.cos(a) * 14.5, h * 0.2, Math.sin(a) * 14.5);
        pleat.rotation.y = -a;
        g.add(pleat);
    }
    // Flat mat underneath (zabuton)
    const mat = new THREE.Mesh(new THREE.BoxGeometry(40, 3, 40), _mat(0x222244));
    mat.position.y = 1.5;
    g.add(mat);
    return g;
}

function makeShoji(h) {
    const g = new THREE.Group();
    const wood = _mat(0x8B7355);
    const paper = _mat(0xF5F0E0, {e: 0xFFEECC, ei: 0.1});
    // Outer frame
    const frameL = new THREE.Mesh(new THREE.BoxGeometry(3, h, 3), wood);
    frameL.position.set(-40, h/2, 0); g.add(frameL);
    const frameR = new THREE.Mesh(new THREE.BoxGeometry(3, h, 3), wood);
    frameR.position.set(40, h/2, 0); g.add(frameR);
    const frameT = new THREE.Mesh(new THREE.BoxGeometry(83, 3, 3), wood);
    frameT.position.set(0, h - 1.5, 0); g.add(frameT);
    const frameB = new THREE.Mesh(new THREE.BoxGeometry(83, 3, 3), wood);
    frameB.position.set(0, 1.5, 0); g.add(frameB);
    // Inner grid (3x4 panels)
    for (let c = 0; c < 3; c++) {
        for (let r = 0; r < 4; r++) {
            const pw = 24, ph = h * 0.22;
            const panel = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), paper);
            panel.position.set(-25 + c * 25, h * 0.15 + r * h * 0.23, 0.5);
            g.add(panel);
            const panelB = panel.clone();
            panelB.position.z = -0.5;
            panelB.rotation.y = Math.PI;
            g.add(panelB);
        }
        // Vertical divider
        if (c < 2) {
            const div = new THREE.Mesh(new THREE.BoxGeometry(2, h - 6, 2), wood);
            div.position.set(-13 + c * 25, h/2, 0);
            g.add(div);
        }
    }
    // Horizontal dividers
    for (let r = 1; r < 4; r++) {
        const hdiv = new THREE.Mesh(new THREE.BoxGeometry(77, 2, 2), wood);
        hdiv.position.set(0, h * 0.14 + r * h * 0.23 - h * 0.11, 0);
        g.add(hdiv);
    }
    return g;
}

function makeScroll(h) {
    const g = new THREE.Group();
    // Hanging scroll (kakejiku)
    const scrollBody = new THREE.Mesh(new THREE.PlaneGeometry(h * 0.4, h * 0.8),
        _mat(0xF5F0E0, {e: 0xFFEECC, ei: 0.05}));
    scrollBody.position.y = h * 0.5;
    g.add(scrollBody);
    // Top roller
    const topRoll = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, h * 0.45, 8), _mat(0x3a2210));
    topRoll.rotation.z = Math.PI / 2;
    topRoll.position.y = h * 0.92;
    g.add(topRoll);
    // Bottom roller
    const botRoll = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, h * 0.48, 8), _mat(0x3a2210));
    botRoll.rotation.z = Math.PI / 2;
    botRoll.position.y = h * 0.1;
    g.add(botRoll);
    // Calligraphy mark (simple rectangle as character)
    const mark = new THREE.Mesh(new THREE.PlaneGeometry(h * 0.15, h * 0.3), _mat(0x111111));
    mark.position.set(0, h * 0.5, 0.3);
    g.add(mark);
    return g;
}

function makeGenericBox(h, color) {
    const g = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(h * 0.6, h, h * 0.6), _mat(color || 0x888888));
    mesh.position.y = h / 2;
    g.add(mesh);
    return g;
}

// Keywords that should use procedural fallback instead of Poly Pizza
// Basic nature procedural models (used for fill and welcome scene)
function makeTree(h) {
    const g = new THREE.Group();
    // Trunk
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(h*0.04, h*0.06, h*0.45, 6), _mat(0x6B4226));
    trunk.position.y = h * 0.22;
    g.add(trunk);
    // Foliage layers (3 cones stacked)
    const leafMat = _mat(0x3a7a2a);
    for (let i = 0; i < 3; i++) {
        const r = h * (0.25 - i * 0.05);
        const cone = new THREE.Mesh(new THREE.ConeGeometry(r, h * 0.28, 7), leafMat);
        cone.position.y = h * (0.42 + i * 0.18);
        g.add(cone);
    }
    return g;
}

function makePine(h) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(h*0.03, h*0.05, h*0.5, 5), _mat(0x5C3A1E));
    trunk.position.y = h * 0.25;
    g.add(trunk);
    // Tall narrow pine shape (4 cones)
    const leafMat = _mat(0x2d5a1e);
    for (let i = 0; i < 4; i++) {
        const r = h * (0.18 - i * 0.03);
        const cone = new THREE.Mesh(new THREE.ConeGeometry(r, h * 0.22, 6), leafMat);
        cone.position.y = h * (0.4 + i * 0.15);
        g.add(cone);
    }
    return g;
}

function makeBush(h) {
    h = Math.min(h, 20);
    const g = new THREE.Group();
    const mat = _mat(0x4a8a3a);
    // Cluster of spheres
    for (let i = 0; i < 3; i++) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(h * (0.35 + Math.random() * 0.15), 7, 5), mat);
        s.position.set((Math.random() - 0.5) * h * 0.3, h * 0.3, (Math.random() - 0.5) * h * 0.3);
        g.add(s);
    }
    return g;
}

function makeRock(h) {
    const g = new THREE.Group();
    const geo = new THREE.DodecahedronGeometry(h * 0.4, 1);
    // Slightly deform vertices for organic look
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        pos.setY(i, pos.getY(i) * 0.6);
        pos.setX(i, pos.getX(i) * (0.8 + Math.random() * 0.4));
        pos.setZ(i, pos.getZ(i) * (0.8 + Math.random() * 0.4));
    }
    geo.computeVertexNormals();
    const rock = new THREE.Mesh(geo, _mat(0x888078));
    rock.position.y = h * 0.2;
    g.add(rock);
    return g;
}

const PROCEDURAL_KEYWORDS = {
    'tree': makeTree,
    'oak': makeTree,
    'oak tree': makeTree,
    'willow': makeTree,
    'pine': makePine,
    'pine tree': makePine,
    'bush': makeBush,
    'flowering bush': makeBush,
    'rock': makeRock,
    'boulder': makeRock,
    'training dummy': makeTrainingDummy,
    'dummy': makeTrainingDummy,
    'punching bag': makePunchingBag,
    'heavy bag': makePunchingBag,
    'tatami': makeTatamiMat,
    'tatami mat': makeTatamiMat,
    'lantern': makeLantern,
    'paper lantern': makeLantern,
    'weapon rack': makeWeaponRack,
    'rack': makeWeaponRack,
    'cushion': makeCushion,
    'meditation cushion': makeCushion,
    'shoji': makeShoji,
    'shoji screen': makeShoji,
    'scroll': makeScroll,
    'calligraphy': makeScroll,
    'banner': makeScroll,
};

function tryProceduralModel(keyword, height) {
    const kw = keyword.toLowerCase();
    for (const [key, builder] of Object.entries(PROCEDURAL_KEYWORDS)) {
        if (kw.includes(key)) return builder(height);
    }
    return null;
}

// Model lookup + GLB loading (with client-side layout for positioning)
const modelCache = {};

// Pre-generated GLB models are served from local /models/ folder
// Map keywords to local model files — multiple keywords per model
const MODEL_MAP = {
    'tree': ['tree','oak','maple','willow','birch','elm','pine','spruce','fir','palm','cypress'],
    'bush': ['bush','shrub','hedge','plant','fern'],
    'rock': ['rock','boulder','stone','pebble'],
    'building': ['building','apartment','office','skyscraper','tower','warehouse','factory','hospital','school','museum','library','hotel','cinema'],
    'house': ['house','cottage','cabin','hut','villa','home','bungalow'],
    'shop': ['shop','store','cafe','bakery','restaurant','pizzeria','pharmacy','market','bar'],
    'car': ['car','sedan','taxi','vehicle','automobile'],
    'truck': ['truck','van','bus','pickup','ambulance'],
    'street_lamp': ['lamp','lamppost','street lamp','light','pole','streetlight','floor lamp'],
    'bench': ['bench','park bench','seat'],
    'hydrant': ['hydrant','fire hydrant'],
    'trash_can': ['trash','trash can','dumpster','bin','garbage'],
    'sofa': ['sofa','couch','armchair','loveseat','sectional'],
    'bookshelf': ['bookshelf','shelf','bookcase','cabinet'],
    'table': ['table','desk','counter','coffee table'],
    'lamp': ['lamp','lantern','candle','torch'],
    'chair': ['chair','stool','ottoman'],
    'statue': ['statue','sculpture','monument','figure'],
    'fountain': ['fountain','well','birdbath','pond'],
    'barrel': ['barrel','crate','box','container','wooden crate'],
    // New models
    'fence_post': ['fence','fence post','railing'],
    'mailbox': ['mailbox','mail','postbox'],
    'stop_sign': ['stop sign','sign','road sign'],
    'traffic_cone': ['cone','traffic cone','pylon'],
    'dumpster': ['dumpster','skip'],
    'picnic_table': ['picnic table','picnic','outdoor table'],
    'swing_set': ['swing','swing set','playground'],
    'slide': ['slide','playground slide'],
    'gazebo': ['gazebo','pavilion','pergola'],
    'bridge': ['bridge','overpass','footbridge'],
    'boat': ['boat','canoe','kayak','ship'],
    'motorcycle': ['motorcycle','motorbike','scooter'],
    'bicycle': ['bicycle','bike','cycle'],
    'castle': ['castle','fortress','keep'],
    'windmill': ['windmill','mill'],
    'tent': ['tent','camping','canopy'],
    'campfire': ['campfire','fire','bonfire'],
    'log': ['log','fallen tree','timber'],
    'grave_tombstone': ['grave','tombstone','gravestone','headstone','cemetery'],
    'pumpkin': ['pumpkin','jack o lantern','gourd'],
    'soccer_goal': ['soccer goal','goal','goalpost','football goal'],
    'basketball_hoop': ['basketball hoop','basketball','hoop','backboard'],
    'punching_bag': ['punching bag','heavy bag','boxing bag'],
    'treadmill': ['treadmill','exercise','gym equipment'],
    'piano': ['piano','grand piano','keyboard'],
    'bed': ['bed','mattress','bedroom'],
    'bathtub': ['bathtub','tub','bath'],
    'toilet': ['toilet','bathroom','wc'],
    'refrigerator': ['refrigerator','fridge','freezer'],
    'oven': ['oven','stove','range','cooker'],
    'television': ['television','tv','monitor','screen'],
    'computer_desk': ['computer desk','workstation','pc desk'],
    'office_chair': ['office chair','swivel chair','desk chair'],
    'filing_cabinet': ['filing cabinet','file cabinet','drawer'],
    'vending_machine': ['vending machine','vending','snack machine'],
    'phone_booth': ['phone booth','telephone','call box'],
    'bus_stop_shelter': ['bus stop','bus shelter','transit stop'],
    'water_tower': ['water tower','tower tank'],
    'satellite_dish': ['satellite dish','dish','antenna','satellite'],
    'crane': ['crane','construction crane','tower crane'],
    'forklift': ['forklift','lift truck','pallet jack'],
    'shopping_cart': ['shopping cart','cart','trolley'],
    'streetlight': ['streetlight','street light','lamp post'],
    'park_fountain': ['park fountain','water fountain'],
    'bird_bath': ['bird bath','birdbath'],
    'dog_house': ['dog house','kennel','doghouse'],
    'wheelbarrow': ['wheelbarrow','barrow'],
    'hay_bale': ['hay bale','hay','straw bale'],
    'tractor': ['tractor','farm vehicle','harvester'],
    'hot_dog_cart': ['hot dog cart','food cart','street food'],
    'ice_cream_truck': ['ice cream truck','ice cream van'],
    'police_car': ['police car','cop car','patrol car'],
    'taxi_cab': ['taxi','taxi cab','cab','yellow cab'],
};

// Build reverse lookup: keyword -> filename
const KEYWORD_TO_FILE = {};
for (const [file, keywords] of Object.entries(MODEL_MAP)) {
    for (const kw of keywords) {
        KEYWORD_TO_FILE[kw] = `models/${file}.glb`;
    }
}

async function findLocalModel(keyword, category) {
    const kw = keyword.toLowerCase().trim();
    // Exact match
    if (KEYWORD_TO_FILE[kw]) return KEYWORD_TO_FILE[kw];
    // Partial match — check if any mapped keyword is contained in the request
    for (const [mapped, file] of Object.entries(KEYWORD_TO_FILE)) {
        if (kw.includes(mapped) || mapped.includes(kw)) return file;
    }
    return null;
}

async function loadGLBModel(url, position, targetHeight, rotationY) {
    return new Promise((resolve) => {
        gltfLoader.load(url, (gltf) => {
            const model = gltf.scene;
            // Only hide untextured meshes that are pure white or very dark (Trellis artifacts)
            // Textured meshes (with .map) should never be hidden
            model.traverse(child => {
                if (child.isMesh && child.material && !child.material.map) {
                    const c = child.material.color;
                    if (!c) return;
                    if (c.r > 0.95 && c.g > 0.95 && c.b > 0.95) child.visible = false;
                    if (c.r < 0.08 && c.g < 0.08 && c.b < 0.08) child.visible = false;
                }
            });
            const box = new THREE.Box3().setFromObject(model);
            const size = new THREE.Vector3();
            box.getSize(size);
            const s = targetHeight / (size.y || 1);
            model.scale.setScalar(s);
            const scaledBox = new THREE.Box3().setFromObject(model);
            model.position.set(position[0], position[1] - scaledBox.min.y, position[2]);
            if (rotationY) model.rotation.y = rotationY;
            enableShadows(model);
            scene.add(model);
            sceneObjects.push(model);
            resolve(model);
        }, undefined, (err) => { console.error('GLB load error:', err); resolve(null); });
    });
}

// Client-side layout engine — positions objects based on size and character path
const BANNED = ['fence','gate','wall','barrier','shelter','bus stop','bus shelter','canopy','awning','stop sign','road barrier','barricade'];

// Outdoor objects that should NEVER appear indoors
const OUTDOOR_ONLY = ['building','apartment','skyscraper','tower','factory','warehouse','church','castle','hotel','hospital','school','museum','house','cottage','cabin','car','sedan','truck','bus','taxi','van','ambulance','motorcycle','bicycle','scooter','boat','hydrant','mailbox','lamppost','traffic','road','highway','bridge','crane','windmill','container'];

const SIZE_SCALES = {
    outdoor: { large: 435, medium: 120, small: 60 },
    indoor:  { large: 175, medium: 80, small: 50 }
};

function computeLayout(models, sceneType, charPath) {
    const isIndoor = sceneType === 'indoor';

    // Filter banned keywords
    models = models.filter(m => !BANNED.some(b => m.keyword.toLowerCase().includes(b)));

    // For indoor scenes, also filter out outdoor-only objects
    if (isIndoor) {
        models = models.filter(m => !OUTDOOR_ONLY.some(o => m.keyword.toLowerCase().includes(o)));
    }

    // Separate by size
    const large = models.filter(m => m.size === 'large');
    const medium = models.filter(m => m.size === 'medium');
    const small = models.filter(m => m.size === 'small');
    const scales = SIZE_SCALES[isIndoor ? 'indoor' : 'outdoor'];

    const placed = [];

    if (isIndoor) {
        // Indoor: arrange furniture around the character in a room-like layout
        // Back wall items (large)
        large.forEach((m, i) => {
            const spread = large.length > 1 ? (i / (large.length - 1) - 0.5) * 300 : 0;
            placed.push({
                ...m,
                position: [spread, 0, 250],
                scale: scales.large,
                rotationY: 3.14 // face toward character
            });
        });

        // Side items (medium) — alternate left and right
        medium.forEach((m, i) => {
            const side = i % 2 === 0 ? -1 : 1;
            const z = 50 + (i % 3) * 80;
            placed.push({
                ...m,
                position: [side * 200, 0, z],
                scale: scales.medium,
                rotationY: side === -1 ? 1.57 : 4.71
            });
        });

        // Front/scattered items (small)
        small.forEach((m, i) => {
            const angle = (i / small.length) * Math.PI - Math.PI * 0.3;
            const r = 120 + i * 30;
            placed.push({
                ...m,
                position: [Math.cos(angle) * r, 0, Math.sin(angle) * r + 100],
                scale: scales.small,
                rotationY: 0
            });
        });
    } else {
        // Outdoor: compact layout — models close together so scene feels full
        const MAP_RANGE = 500;

        // Place large objects in a wide spread using golden-angle distribution
        large.forEach((m, i) => {
            const angle = i * 2.399963 + Math.random() * 0.3; // golden angle + jitter
            const r = 150 + (i / Math.max(large.length, 1)) * (MAP_RANGE - 200) + Math.random() * 80;
            placed.push({
                ...m,
                position: [Math.cos(angle) * r, 0, Math.sin(angle) * r],
                scale: scales.large,
                rotationY: Math.random() * Math.PI * 2
            });
        });

        // Medium objects: spread across mid-range, avoid center cluster
        medium.forEach((m, i) => {
            const angle = i * 2.399963 + 1.2 + Math.random() * 0.4; // offset from large
            const r = 100 + (i / Math.max(medium.length, 1)) * (MAP_RANGE - 150) + Math.random() * 80;
            placed.push({
                ...m,
                position: [Math.cos(angle) * r, 0, Math.sin(angle) * r],
                scale: scales.medium,
                rotationY: Math.random() * Math.PI * 2
            });
        });

        // Small objects: distribute across full range with good spacing
        small.forEach((m, i) => {
            const angle = i * 2.399963 + 2.5 + Math.random() * 0.5; // offset from medium
            const r = 80 + (i / Math.max(small.length, 1)) * (MAP_RANGE - 120) + Math.random() * 60;
            placed.push({
                ...m,
                position: [Math.cos(angle) * r, 0, Math.sin(angle) * r],
                scale: scales.small,
                rotationY: Math.random() * Math.PI * 2
            });
        });

        // === AUTO-FILL: scatter randomly across the map, avoid character path ===
        const fillPositions = [];
        const MIN_FILL_DIST = 50; // min distance between fill objects
        const PATH_FILL_CLEARANCE = 80; // clearance around character path

        function canPlaceFill(x, z) {
            // Don't place at the very center where character spawns
            if (Math.sqrt(x * x + z * z) < 80) return false;
            // Keep clear of character path
            for (const [px, , pz] of charPath) {
                const d = Math.sqrt((x - px) ** 2 + (z - pz) ** 2);
                if (d < PATH_FILL_CLEARANCE) return false;
            }
            // Min spacing from other fill objects
            for (const [fx, fz] of fillPositions) {
                const d = Math.sqrt((x - fx) ** 2 + (z - fz) ** 2);
                if (d < MIN_FILL_DIST) return false;
            }
            // Min spacing from placed scene objects
            for (const obj of placed) {
                const d = Math.sqrt((x - obj.position[0]) ** 2 + (z - obj.position[2]) ** 2);
                if (d < 50) return false;
            }
            return true;
        }

        function addFill(x, z, kw) {
            if (!canPlaceFill(x, z)) return false;
            fillPositions.push([x, z]);
            const fillScale = kw === 'rock' ? 15 + Math.random() * 15
                : kw === 'bush' ? 25 + Math.random() * 15
                : 120 + Math.random() * 40;
            placed.push({
                keyword: kw, category: 6, size: 'large',
                position: [x, 0, z], scale: fillScale,
                rotationY: Math.random() * Math.PI * 2, _isFill: true
            });
            return true;
        }

        // Scatter fill objects randomly across the map
        const FILL_TYPES = ['tree', 'tree', 'pine', 'pine', 'bush', 'rock'];
        const MAP_EXTENT = 550;
        for (let i = 0; i < 60; i++) {
            const x = (Math.random() - 0.5) * 2 * MAP_EXTENT;
            const z = (Math.random() - 0.5) * 2 * MAP_EXTENT;
            const kw = FILL_TYPES[Math.floor(Math.random() * FILL_TYPES.length)];
            addFill(x, z, kw);
        }
    }

    // Push objects away from character path (wider clearance)
    const PATH_CLEARANCE = 100;
    for (const obj of placed) {
        for (const [px, , pz] of charPath) {
            const dx = obj.position[0] - px;
            const dz = obj.position[2] - pz;
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist < PATH_CLEARANCE && dist > 0) {
                const push = (PATH_CLEARANCE - dist) / dist;
                obj.position[0] += dx * push;
                obj.position[2] += dz * push;
            }
        }
    }

    // Extra: clear a wide corridor in front of the character (Z > 0, near X=0)
    for (const obj of placed) {
        const [ox, , oz] = obj.position;
        if (oz > -50 && oz < 300 && Math.abs(ox) < 150) {
            // Push outward from center
            const side = ox >= 0 ? 1 : -1;
            obj.position[0] = side * (150 + Math.random() * 50);
        }
    }

    // Same-keyword consistency:
    // - Trees/shrubs: vary within 40% of each other
    // - Everything else: exact same size
    const keywordScales = {};
    const TREE_KEYWORDS = ['tree','pine','oak','willow','palm','cactus'];
    const NATURE_KEYWORDS = [...TREE_KEYWORDS, 'bush','rock','boulder','flower','mushroom','stump'];
    for (const obj of placed) {
        if (obj._isFill) continue;
        const kw = obj.keyword.toLowerCase();
        const isTree = TREE_KEYWORDS.some(n => kw.includes(n));

        if (isTree) {
            // Trees: first one sets baseline, others within ±20% (40% range)
            if (keywordScales[kw] === undefined) {
                keywordScales[kw] = obj.scale;
            } else {
                const base = keywordScales[kw];
                obj.scale = base * (0.8 + Math.random() * 0.4);
            }
        } else {
            // Everything else: exact same size
            if (keywordScales[kw] === undefined) {
                keywordScales[kw] = obj.scale;
            } else {
                obj.scale = keywordScales[kw];
            }
        }
    }

    // Bounding box collision resolution
    // Trees can overlap slightly, everything else gets relocated
    const mapRange = isIndoor ? 250 : 500;
    function getRadius(obj) {
        const isNature = NATURE_KEYWORDS.some(n => obj.keyword.toLowerCase().includes(n));
        return (obj.scale || 50) * (isNature ? 0.2 : 0.4);
    }
    function getVolume(obj) {
        const s = obj.scale || 50;
        return s * s * s;
    }
    function isOnPath(x, z) {
        for (const [px, , pz] of charPath) {
            const d = Math.sqrt((x - px) ** 2 + (z - (pz || 0)) ** 2);
            if (d < 100) return true;
        }
        return false;
    }
    function collidesWithAny(obj, others, skipIdx) {
        const r1 = getRadius(obj);
        for (let i = 0; i < others.length; i++) {
            if (i === skipIdx) continue;
            const other = others[i];
            const r2 = getRadius(other);
            const dx = obj.position[0] - other.position[0];
            const dz = obj.position[2] - other.position[2];
            const dist = Math.sqrt(dx * dx + dz * dz);
            const bothNature = NATURE_KEYWORDS.some(n => obj.keyword.toLowerCase().includes(n))
                && NATURE_KEYWORDS.some(n => other.keyword.toLowerCase().includes(n));
            if (bothNature) continue; // trees can overlap
            if (dist < r1 + r2) return true;
        }
        return false;
    }

    // Find collisions and relocate the smaller object
    const MAX_RELOCATE_ATTEMPTS = 15;
    for (let i = 0; i < placed.length; i++) {
        for (let j = i + 1; j < placed.length; j++) {
            const a = placed[i], b = placed[j];
            const aIsNature = NATURE_KEYWORDS.some(n => a.keyword.toLowerCase().includes(n));
            const bIsNature = NATURE_KEYWORDS.some(n => b.keyword.toLowerCase().includes(n));
            if (aIsNature && bIsNature) continue; // both nature = allow overlap

            const r1 = getRadius(a), r2 = getRadius(b);
            const dx = a.position[0] - b.position[0];
            const dz = a.position[2] - b.position[2];
            const dist = Math.sqrt(dx * dx + dz * dz);

            if (dist < r1 + r2) {
                // Relocate the smaller volume object
                const smaller = getVolume(a) < getVolume(b) ? a : b;
                const smallerIdx = smaller === a ? i : j;
                let relocated = false;

                for (let attempt = 0; attempt < MAX_RELOCATE_ATTEMPTS; attempt++) {
                    // Random position within map range
                    const nx = (Math.random() - 0.5) * 2 * mapRange;
                    const nz = (Math.random() - 0.5) * 2 * mapRange;

                    // Skip if on character path
                    if (isOnPath(nx, nz)) continue;
                    // Skip if too close to center
                    if (Math.sqrt(nx * nx + nz * nz) < 80) continue;

                    smaller.position[0] = nx;
                    smaller.position[2] = nz;

                    if (!collidesWithAny(smaller, placed, smallerIdx)) {
                        relocated = true;
                        break;
                    }
                }

                // If still can't find a spot, push it far out
                if (!relocated) {
                    const angle = Math.random() * Math.PI * 2;
                    smaller.position[0] = Math.cos(angle) * (mapRange - 50);
                    smaller.position[2] = Math.sin(angle) * (mapRange - 50);
                }
            }
        }
    }

    return placed;
}

async function buildScene(config) {
    clearFades();
    sceneObjects.forEach(obj => scene.remove(obj));
    sceneObjects = [];
    grid.visible = false;
    Object.keys(modelCache).forEach(k => delete modelCache[k]);

    // Ground created after layout so we know the world extent.
    // Gemini's color, lifted a little toward a warm gray so asphalt and soil
    // read as surfaces instead of holes under tone mapping.
    const groundBase = '#' + new THREE.Color((config.scene.ground && config.scene.ground.color) || '#888877')
        .lerp(new THREE.Color('#d9d4c7'), 0.22).getHexString();

    // Lights: the sun and sky light come from the environment preset.
    // Only Gemini's point lights (campfires, lamps) are added on top.
    for (const light of (config.scene.lights || [])) {
        let l;
        const color = light.color || '#ffffff';
        const intensity = light.intensity || 1;
        if (light.type === 'point') {
            l = new THREE.PointLight(color, intensity, 2000);
            const p = light.position || [0, 200, 0];
            l.position.set(p[0], p[1], p[2]);
        }
        if (l) { scene.add(l); sceneObjects.push(l); }
    }

    applyEnvironment(environmentFor(config._prompt, config.scene.type));

    // Layout engine: Gemini picks objects, code positions them
    const charPath = config._characterPath || [[0, 0]];
    const sceneType = config.scene.type || 'outdoor';
    const rawModels = config.scene.models || [];
    const placedModels = computeLayout(rawModels, sceneType, charPath);

    // Size ground to match the furthest object + small margin
    let maxExtent = 200; // minimum
    for (const m of placedModels) {
        const dist = Math.sqrt(m.position[0] ** 2 + m.position[2] ** 2) + (m.scale || 50);
        if (dist > maxExtent) maxExtent = dist;
    }
    // Also include character path
    for (const [px, , pz] of charPath) {
        const dist = Math.sqrt(px * px + (pz || 0) * (pz || 0)) + 100;
        if (dist > maxExtent) maxExtent = dist;
    }
    const groundSize = maxExtent * 2 + 100; // diameter + margin
    groundMesh = createTexturedGround(groundSize, groundBase);
    groundMesh.userData._isGround = true;
    scene.add(groundMesh);
    sceneObjects.push(groundMesh);

    // A wide ring with the same texture runs from under the ground's edge out
    // to the fog, so the ground has no visible edge against the sky.
    const SKIRT_R = 6000;
    const skirtMap = groundMesh.material.map.clone();
    skirtMap.repeat.set(SKIRT_R / 100, SKIRT_R / 100);
    const phase = (groundSize / 2 - SKIRT_R) / 200; // line the texture up with the ground's
    skirtMap.offset.set(phase, phase);
    skirtMap.needsUpdate = true;
    const skirt = new THREE.Mesh(
        new THREE.RingGeometry(groundSize * 0.42, SKIRT_R, 96, 1),
        new THREE.MeshStandardMaterial({ map: skirtMap, roughness: 0.92 })
    );
    skirt.rotation.x = -Math.PI / 2;
    skirt.position.y = -1.5;
    skirt.receiveShadow = true;
    skirt.userData._isGround = true;
    scene.add(skirt);
    sceneObjects.push(skirt);

    // Place loading placeholders at computed positions BEFORE loading models
    const placeholders = [];
    const phMat = new THREE.MeshStandardMaterial({
        color: 0x7c5cbf, transparent: true, opacity: 0.2, roughness: 1
    });
    placedModels.forEach(m => {
        if (m._isFill) return; // No placeholders for background fill
        const h = m.scale || 100;
        const phGeo = new THREE.BoxGeometry(h * 0.4, h, h * 0.4);
        const ph = new THREE.Mesh(phGeo, phMat.clone());
        ph.position.set(m.position[0], h / 2, m.position[2]);
        // Pulse animation via userData
        ph.userData._phaseOffset = Math.random() * Math.PI * 2;
        scene.add(ph);
        placeholders.push(ph);
    });

    // Animate placeholders with pulsing
    let phAnimId = null;
    function animatePlaceholders() {
        const t = Date.now() * 0.003;
        placeholders.forEach(ph => {
            if (ph.parent) { // still in scene
                ph.material.opacity = 0.15 + Math.sin(t + ph.userData._phaseOffset) * 0.1;
            }
        });
        phAnimId = requestAnimationFrame(animatePlaceholders);
    }
    if (placeholders.length > 0) animatePlaceholders();

    // Load actual models, replacing placeholders
    let phIdx = 0;
    const mainModels = placedModels.filter(m => !m._isFill);
    const fillModels = placedModels.filter(m => m._isFill);
    let loadedCount = 0, missingCount = 0;
    const totalMain = mainModels.length;

    log(`Placing models... (0/${totalMain})`, 'scene', 'model-progress');

    async function loadModel(m, myPhIdx) {
        const isFill = m._isFill;
        const procedural = tryProceduralModel(m.keyword, m.scale);
        if (procedural) {
            procedural.position.set(m.position[0], 0, m.position[2]);
            if (m.rotationY) procedural.rotation.y = m.rotationY;
            procedural.userData._keyword = m.keyword;
            if (myPhIdx >= 0 && placeholders[myPhIdx]) scene.remove(placeholders[myPhIdx]);
            enableShadows(procedural);
            scene.add(procedural);
            sceneObjects.push(procedural);
            if (!isFill) {
                loadedCount++;
                log(`Placing models... (${loadedCount}/${totalMain}) — ${m.keyword}`, 'scene', 'model-progress');
                currentRun?.detail('models', `${loadedCount} of ${totalMain} placed`);
            }
            return;
        }

        const glbUrl = await findLocalModel(m.keyword, m.category);
        if (glbUrl) {
            const loaded = await loadGLBModel(glbUrl, m.position, m.scale, m.rotationY || 0);
            if (loaded) loaded.userData._keyword = m.keyword;
            if (myPhIdx >= 0 && placeholders[myPhIdx]) scene.remove(placeholders[myPhIdx]);
            if (!isFill) {
                if (loaded) loadedCount++; else missingCount++;
                log(`Placing models... (${loadedCount}/${totalMain}) — ${m.keyword}`, 'scene', 'model-progress');
                currentRun?.detail('models', `${loadedCount} of ${totalMain} placed`);
            }
        } else if (!isFill) {
            missingCount++;
            log(`No model for "${m.keyword}"`, 'scene');
        }
    }

    // Load main models and fill models concurrently
    let mainPhIdx = 0;
    const loadPromises = [
        ...mainModels.map(m => loadModel(m, mainPhIdx++)),
        ...fillModels.map(m => loadModel(m, -1))
    ];
    await Promise.all(loadPromises);

    log(`${loadedCount} of ${totalMain} models placed`, 'scene', 'model-progress');

    // Clean up remaining placeholders and stop animation
    if (phAnimId) cancelAnimationFrame(phAnimId);
    placeholders.forEach(ph => { if (ph.parent) scene.remove(ph); ph.geometry.dispose(); ph.material.dispose(); });
    return { placed: loadedCount, missing: missingCount, total: totalMain };
}

// ========== ACTIVITY: run tracker, GPU state, detail log ==========
const PAGE_T0 = performance.now();
function fmtSecs(ms) {
    const sec = Math.max(0, ms) / 1000;
    if (sec < 60) return sec.toFixed(1) + 's';
    return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
}
function h(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
}

// Detail log: plain lines under the "Details" disclosure.
function log(msg, type = 'system', id = null) {
    const list = document.getElementById('log-list');
    if (id) {
        const existing = document.getElementById('log-' + id);
        if (existing) { existing.querySelector('.log-msg').textContent = msg; return existing; }
    }
    const line = h('div', `log-line log-${type}`);
    if (id) line.id = 'log-' + id;
    const sec = Math.floor((performance.now() - PAGE_T0) / 1000);
    line.append(h('span', 'log-t', `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`), h('span', 'log-msg', msg));
    list.appendChild(line);
    while (list.children.length > 300) list.firstChild.remove();
    return line;
}

function setPill() {} // legacy no-op

// --- Motion server (GPU) state ---
// /health only answers once the model is loaded, so a slow reply means a cold GPU.
const gpu = { state: 'checking', since: performance.now(), info: null, lastOk: 0 };
const COLD_START_NOTE = 'The motion model runs on a Modal L4 GPU that sleeps when idle. Waking it can take up to two minutes; after that a motion takes about 7 seconds.';

function setGpu(state, info) {
    if (state !== gpu.state) gpu.since = performance.now();
    gpu.state = state;
    if (info) gpu.info = info;
    if (state === 'ready') gpu.lastOk = performance.now();
    renderGpu();
}

function renderGpu() {
    const secs = Math.floor((performance.now() - gpu.since) / 1000);
    const name = gpu.info?.gpu || 'L4';
    const pillText = {
        checking: 'Connecting',
        warming: `Warming up GPU ${secs}s`,
        ready: `${name} GPU ready`,
        offline: 'Motion server offline',
    }[gpu.state];
    const longText = {
        checking: 'Connecting to the motion model',
        warming: `The motion model is waking up on a Modal ${name} GPU (${secs}s). A cold start can take up to two minutes.`,
        ready: `Motion model ready on a Modal ${name} GPU`,
        offline: 'Motion server unreachable. Generation will fail until it is back.',
    }[gpu.state];
    const pill = document.getElementById('gpu-pill');
    pill.dataset.state = gpu.state;
    document.getElementById('gpu-text').textContent = pillText;
    pill.title = gpu.state === 'offline' ? 'Retry' : longText;
    const w = document.getElementById('w-status');
    w.dataset.state = gpu.state;
    document.getElementById('w-status-text').textContent = longText;
}

async function checkHealth() {
    setGpu('checking');
    const slow = setTimeout(() => { if (gpu.state === 'checking') setGpu('warming'); }, 2500);
    try {
        const res = await fetch(`${API}/health`);
        if (!res.ok) throw new Error(`health ${res.status}`);
        const info = await res.json();
        setGpu('ready', info);
        log(`Motion model ready: ${info.model} on Modal ${info.gpu}` , 'success');
    } catch (e) {
        if (gpu.state !== 'ready') setGpu('offline');
        log('Motion server unreachable, generation will fail', 'error');
    }
    clearTimeout(slow);
}
document.getElementById('gpu-pill').addEventListener('click', () => { if (gpu.state === 'offline') checkHealth(); });

// What the motion step says while it waits on the server.
function motionWaitText() {
    const idle = gpu.lastOk && performance.now() - gpu.lastOk > 290000; // Modal scales down after 300 s idle
    if (gpu.state === 'ready' && !idle) return `Kimodo on a Modal ${gpu.info?.gpu || 'L4'} GPU`;
    if (gpu.state === 'offline') return 'Trying the motion server';
    return 'Waiting for the GPU to warm up, up to two minutes on a cold start';
}
function motionReceived() {
    if (gpu.state !== 'ready') setGpu('ready');
    else gpu.lastOk = performance.now();
}

// --- Runs: one per prompt, each a short list of honest steps ---
const STEP_ICON = {
    done: '<svg viewBox="0 0 10 10"><path d="M2.2 5.3l1.9 1.9L7.9 3.2" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    failed: '<svg viewBox="0 0 10 10"><path d="M3 3l4 4M7 3l-4 4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
};
const runs = [];
let currentRun = null;

class Run {
    constructor(title, steps, kind) {
        this.title = title;
        this.kind = kind;
        this.t0 = performance.now();
        this.t1 = null;
        this.state = 'running';
        this.summary = '';
        this.steps = steps.map(([id, label]) => ({ id, label, state: 'pending', detail: '', t0: 0, t1: 0 }));
        runs.push(this);
        currentRun = this;
        renderRuns();
    }
    step(id) { return this.steps.find(s => s.id === id); }
    add(id, label) {
        if (!this.step(id)) this.steps.push({ id, label, state: 'pending', detail: '', t0: 0, t1: 0 });
        renderRuns();
    }
    start(id, detail = '') {
        const s = this.step(id); if (!s) return;
        Object.assign(s, { state: 'active', detail, t0: performance.now() });
        renderRuns();
    }
    detail(id, detail) {
        const s = this.step(id); if (!s || s.detail === detail) return;
        s.detail = detail;
        renderRuns();
    }
    done(id, detail) {
        const s = this.step(id); if (!s) return;
        Object.assign(s, { state: 'done', t1: performance.now() });
        if (!s.t0) s.t0 = s.t1;
        if (detail != null) s.detail = detail;
        renderRuns();
    }
    fail(id, detail) {
        const s = this.step(id); if (!s) return;
        Object.assign(s, { state: 'failed', t1: performance.now(), detail });
        if (!s.t0) s.t0 = s.t1;
        renderRuns();
    }
    failActive(detail) {
        const s = this.steps.find(x => x.state === 'active') || this.steps.find(x => x.state === 'pending');
        if (s) this.fail(s.id, detail);
    }
    finish(summary = '') {
        this.t1 = performance.now();
        this.state = this.steps.some(s => s.state === 'failed') ? 'failed' : 'done';
        this.summary = summary;
        this.steps.forEach(s => { if (s.state === 'pending') s.state = 'skipped'; });
        renderRuns();
        if (this.kind === 'chat') {
            clearTimeout(this._hide);
            this._hide = setTimeout(() => { if (currentRun === this) renderPromptStatus(true); }, this.state === 'failed' ? 7000 : 2600);
        }
    }
}

function stepTime(s) {
    if (s.state === 'active') return fmtSecs(performance.now() - s.t0);
    if (s.state === 'done' || s.state === 'failed') return fmtSecs(s.t1 - s.t0);
    return '';
}
function runMeta(r) {
    if (r.state === 'running') return `Running ${fmtSecs(performance.now() - r.t0)}`;
    if (r.state === 'failed') return `Failed after ${fmtSecs(r.t1 - r.t0)}`;
    return `Done in ${fmtSecs(r.t1 - r.t0)}` + (r.summary ? ` · ${r.summary}` : '');
}

function buildSteps(run) {
    const list = h('div', 'steps');
    run.steps.forEach((s, i) => {
        const row = h('div', `step ${s.state}`);
        const icon = h('div', 'step-icon');
        icon.innerHTML = STEP_ICON[s.state] || '';
        const body = h('div', 'step-body');
        body.append(h('div', 'step-label', s.label));
        const det = h('div', 'step-detail', s.detail);
        if (!s.detail) det.style.display = 'none';
        det.dataset.detail = `${runs.indexOf(run)}:${i}`;
        body.append(det);
        const time = h('div', 'step-time', stepTime(s));
        time.dataset.tick = `${runs.indexOf(run)}:${i}`;
        row.append(icon, body, time);
        list.append(row);
    });
    return list;
}

function renderRuns() {
    const runsEl = document.getElementById('runs');
    runsEl.replaceChildren();
    const latest = runs[runs.length - 1];
    if (latest) {
        const card = h('div', 'run');
        card.append(h('div', 'run-title', latest.title));
        const meta = h('div', `run-meta ${latest.state}`, runMeta(latest));
        meta.dataset.meta = String(runs.length - 1);
        card.append(meta, buildSteps(latest));
        runsEl.append(card);
    }
    const prev = runs.slice(0, -1).slice(-6).reverse();
    if (prev.length) {
        const hist = h('div', 'run-history');
        for (const r of prev) {
            const row = h('div', `run-prev ${r.state}`);
            row.append(h('span', 'rp-dot'), h('span', 'rp-title', r.title), h('span', 'rp-time', r.t1 ? fmtSecs(r.t1 - r.t0) : ''));
            row.title = r.title;
            hist.append(row);
        }
        runsEl.append(hist);
    }
    const reopen = document.getElementById('panel-reopen');
    reopen.dataset.state = latest ? latest.state : '';
    renderGenOverlay();
    renderPromptStatus();
}

// First-scene loading card in the middle of the viewport.
let overlayRun = null;
function renderGenOverlay() {
    const ov = document.getElementById('gen-overlay');
    if (!overlayRun) { ov.classList.remove('visible'); return; }
    ov.classList.add('visible');
    document.getElementById('go-prompt').textContent = overlayRun.title;
    document.getElementById('go-steps').replaceChildren(buildSteps(overlayRun));
    const failed = overlayRun.state === 'failed';
    document.querySelector('.go-eyebrow').textContent = failed ? 'Generation failed' : 'Building your scene';
    const m = overlayRun.step('motion');
    const waitingOnGpu = m && m.state === 'active' && gpu.state !== 'ready';
    document.getElementById('go-note').textContent = waitingOnGpu ? COLD_START_NOTE : '';
    document.getElementById('go-actions').classList.toggle('visible', failed);
}

// One-line status above the prompt bar for follow-up requests.
function renderPromptStatus(hide = false) {
    const el = document.getElementById('prompt-status');
    const r = currentRun;
    if (hide || !r || r.kind !== 'chat') { el.classList.remove('visible', 'failed'); return; }
    const active = r.steps.find(s => s.state === 'active');
    const failedStep = r.steps.find(s => s.state === 'failed');
    let text;
    if (failedStep) text = `${failedStep.label} failed: ${failedStep.detail}`;
    else if (active) text = active.detail ? `${active.label}: ${active.detail}` : `${active.label}...`;
    else if (r.state === 'done') text = r.summary || 'Done';
    else text = 'Working...';
    el.replaceChildren();
    if (r.state === 'running' || failedStep) el.append(h('span', 'ps-spin'));
    el.append(h('span', 'ps-text', text));
    if (r.state === 'running') { const t = h('span', 'ps-time', fmtSecs(performance.now() - r.t0)); t.dataset.psTime = '1'; el.append(t); }
    el.classList.add('visible');
    el.classList.toggle('failed', !!failedStep);
}

// Live clocks: update only the time text so spinners keep spinning.
setInterval(() => {
    if (gpu.state === 'warming') renderGpu();
    const running = runs.some(r => r.state === 'running');
    if (!running) return;
    document.querySelectorAll('[data-tick]').forEach(el => {
        const [ri, si] = el.dataset.tick.split(':').map(Number);
        const s = runs[ri]?.steps[si];
        if (s) el.textContent = stepTime(s);
    });
    document.querySelectorAll('[data-meta]').forEach(el => {
        const r = runs[Number(el.dataset.meta)];
        if (r) el.textContent = runMeta(r);
    });
    const ps = document.querySelector('[data-ps-time]');
    if (ps && currentRun) ps.textContent = fmtSecs(performance.now() - currentRun.t0);
    // Keep the motion step's wait message in step with the GPU state.
    const r = currentRun;
    const m = r && r.step('motion');
    if (m && m.state === 'active' && !m.detail.startsWith('Take ')) r.detail('motion', motionWaitText());
}, 200);

// Generate
const btn = document.getElementById('generate-btn');
const input = document.getElementById('prompt-input');

let isGenerating = false;
async function generate() {
    const prompt = input.value.trim();
    if (!prompt || isGenerating) return;
    isGenerating = true;

    const duration = 5; // Default duration for initial generation

    btn.disabled = true;
    document.getElementById('welcome').classList.add('hidden');
    setPanelOpen(false);
    document.getElementById('panel-reopen').classList.remove('visible');

    log(`> "${prompt}"`, 'agent');
    const run = new Run(prompt, [['motion', 'Motion'], ['scene', 'Scene plan'], ['models', 'Models'], ['animate', 'Animation']], 'generate');
    overlayRun = run;
    renderGenOverlay();

    try {
        // === STEP 1: Generate motion FIRST to get character path ===
        // Silently enhance the motion prompt for better demo results.
        // Bias toward locomotion and exaggerated movement — never shown to user.
        const motionPrompt = enhanceMotionPrompt(prompt);
        run.start('motion', motionWaitText());
        log(`Generating motion (${duration}s)...`, 'motion');

        const MIN_TRAVEL_DIST = 50; // minimum distance between start and end
        const MAX_RETRIES = 3;
        let bvhText = null;
        let characterPath = null;
        let clipSeconds = duration;
        let travelDist = 0;

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            const motionStart = Date.now();
            const motionRes = await fetch(`${API}/generate-motion`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: motionPrompt, duration, variant: attempt })
            });
            if (!motionRes.ok) throw new Error(await motionError(motionRes));
            bvhText = await motionRes.text();
            motionReceived();

            const motionElapsed = ((Date.now() - motionStart) / 1000).toFixed(1);

            // Check if character actually moved
            const { path, result } = extractPathFromBVH(bvhText);
            characterPath = path;
            clipSeconds = result.clip.duration;

            if (path.length >= 2) {
                const startPt = path[0];
                const endPt = path[path.length - 1];
                travelDist = Math.sqrt(
                    (endPt[0] - startPt[0]) ** 2 + (endPt[2] - startPt[2]) ** 2
                );

                if (travelDist >= MIN_TRAVEL_DIST || attempt === MAX_RETRIES) {
                    log(`Motion received (${(bvhText.length / 1024).toFixed(0)}KB, ${motionElapsed}s)`, 'motion');
                    break;
                }
                log(`Take ${attempt + 1} only moved ${Math.round(travelDist)}cm, asking for another`, 'motion');
                run.detail('motion', `Take ${attempt + 2} of ${MAX_RETRIES + 1}: the last one barely moved`);
            } else {
                break;
            }
        }

        log(`Extracted ${characterPath.length} waypoints`, 'path');
        run.done('motion', `${clipSeconds.toFixed(1)} s clip, travels ${(travelDist / 100).toFixed(1)} m`);

        // === STEP 3: Plan scene AROUND the path ===
        run.start('scene', 'Gemini picks what belongs in the scene');
        log('Planning scene layout...', 'scene');

        const config = await callGemini(prompt, characterPath);
        config._characterPath = characterPath;
        config._prompt = prompt;
        const modelCount = (config.scene.models || []).length;
        log(`Planned ${modelCount} models`, 'scene');
        run.done('scene', `${modelCount} objects, ${config.scene.type || 'outdoor'}`);

        // === STEP 4: Build scene + load animation ===
        run.start('models', 'Loading models');
        const stats = await buildScene(config);
        log('Scene built', 'scene');
        run.done('models', `${stats.placed} placed` + (stats.missing ? `, ${stats.missing} not in the library` : ''));

        run.start('animate', 'Putting the motion on the character');
        log('Loading animation...', 'render');
        await loadBVH(bvhText);
        prepareCharacter();
        lastBvhText = bvhText;

        // Build path visualization and apply terrain
        updatePathVisualization(characterPath);
        if (groundMesh) applyTerrainFromPath(groundMesh, characterPath);
        pathVisible = false;
        if (pathLine) pathLine.visible = false;
        const pathBtn = document.getElementById('path-toggle');
        pathBtn.style.display = '';
        pathBtn.classList.remove('active');
        pathBtn.textContent = 'Show path';

        // Initialize timeline with first clip
        timelineClips = [{ prompt: prompt, duration: currentClip.duration, clip: currentClip }];
        totalDuration = currentClip.duration;
        renderTimelineClips();
        showTimeline();
        setPlayIcon(true);
        isPlaying = true;

        log('Scene complete', 'render');
        cam.active = true;
        controls.autoRotate = false;
        frameCharacter(true);
        showEditor();
        showPromptDock();
        run.done('animate', 'Playing');
        run.finish(`${stats.placed} models`);

        log(`Total generation time: ${fmtSecs(run.t1 - run.t0)}`, 'system');
        overlayRun = null;
        renderGenOverlay();
        // Desktop keeps the tracker in view; phones keep the scene clear.
        setPanelOpen(window.innerWidth > 860);

        // Generate soundtrack in background (non-blocking)
        // Music disabled during live playback — only plays during video render
        // generateMusic(prompt);

    } catch (err) {
        log(`Error: ${err.message}`, 'error');
        run.failActive(err.message);
        run.finish();
    }

    btn.disabled = false;
    isGenerating = false;
}

// Failed first scene: try the same prompt again, or go back to the start.
document.getElementById('go-retry').addEventListener('click', () => { overlayRun = null; generate(); });
document.getElementById('go-back').addEventListener('click', () => {
    overlayRun = null;
    renderGenOverlay();
    if (currentClip) setPanelOpen(window.innerWidth > 860);
    else showWelcome();
});

btn.addEventListener('click', generate);
input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); generate(); }
});

// Welcome screen
function showWelcome() {
    document.getElementById('welcome').classList.remove('hidden');
    document.getElementById('welcome-input').value = '';
    document.getElementById('welcome-input').focus();
}
document.getElementById('logo-btn').addEventListener('click', () => { if (!isGenerating) showWelcome(); });

function dismissWelcome(prompt) {
    input.value = prompt;
    document.getElementById('welcome').classList.add('hidden');
    generate();
}

document.querySelectorAll('.w-ex').forEach(card => {
    card.addEventListener('click', () => dismissWelcome(card.dataset.prompt));
});

const welcomeInputEl = document.getElementById('welcome-input');
const welcomeArrow = document.querySelector('.w-input-arrow');
if (welcomeArrow) {
    welcomeInputEl.addEventListener('input', () => {
        welcomeArrow.classList.toggle('visible', welcomeInputEl.value.trim().length > 0);
    });
    welcomeArrow.addEventListener('click', () => {
        const v = welcomeInputEl.value.trim();
        if (v) dismissWelcome(v);
    });
}
welcomeInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const v = e.target.value.trim();
        if (v) dismissWelcome(v);
    }
});

// Render loop
const _charWorldPos = new THREE.Vector3();

// ========== CAMERA: frame the character, follow it, see past models ==========
const cam = {
    active: false,     // follow once a character exists
    locked: false,     // render capture drives the camera itself
    interacting: false,
    userMoved: false,
    focusY: 95,
    lastCheck: 0,
    boxes: [], boxStamp: -1, boxTime: 0,
    fading: new Set(),
    tween: null,
    vel: new THREE.Vector3(), prevHips: null,
};
const _camFocus = new THREE.Vector3(), _camStep = new THREE.Vector3();
const _segRay = new THREE.Ray(), _segHit = new THREE.Vector3(), _segDir = new THREE.Vector3();
const FADED_OPACITY = 0.16;

controls.addEventListener('start', () => {
    cam.interacting = true;
    cam.userMoved = true;
    cam.tween = null;
});
controls.addEventListener('end', () => { cam.interacting = false; });

// World boxes of placed models, refreshed when the scene changes.
function modelBoxes() {
    const now = performance.now();
    if (cam.boxStamp !== sceneObjects.length || now - cam.boxTime > 2000) {
        cam.boxes = [];
        for (const o of sceneObjects) {
            if (o.userData._isGround || o.isLight || !o.visible) continue;
            const box = new THREE.Box3().setFromObject(o);
            if (!box.isEmpty()) cam.boxes.push({ obj: o, box });
        }
        cam.boxStamp = sceneObjects.length;
        cam.boxTime = now;
    }
    return cam.boxes;
}

// Models that sit between the camera and the character's head, hips or feet,
// or that the camera is inside.
function blockersBetween(camPos, focus) {
    const pts = [
        focus,
        new THREE.Vector3(focus.x, 15, focus.z),
        new THREE.Vector3(focus.x, focus.y + 75, focus.z),
    ];
    const out = [];
    for (const { obj, box } of modelBoxes()) {
        if (obj === selectedObject) continue;
        if (box.distanceToPoint(camPos) < 25) { out.push(obj); continue; } // the camera is (nearly) inside it
        for (const p of pts) {
            if (box.containsPoint(p)) continue; // character is inside this box (under a canopy)
            const len = camPos.distanceTo(p);
            _segRay.set(camPos, _segDir.subVectors(p, camPos).normalize());
            if (_segRay.intersectBox(box, _segHit) && camPos.distanceTo(_segHit) < len - 20) { out.push(obj); break; }
        }
    }
    return out;
}

function setFaded(obj, faded) {
    if (!!obj.userData._fadeTarget === faded && (faded || !cam.fading.has(obj))) return;
    obj.userData._fadeTarget = faded;
    obj.traverse(c => {
        if (!c.isMesh || Array.isArray(c.material)) return;
        if (!c.userData._fadeMat) {
            c.userData._origMat = c.material;
            const m = c.material.clone();
            m.transparent = true;
            m.opacity = 1;
            c.userData._fadeMat = m;
        }
        c.material = c.userData._fadeMat;
    });
    cam.fading.add(obj);
}

// Ease faded models toward their target opacity, restoring the original
// material once a model is fully visible again.
function updateFades(dt) {
    const k = 1 - Math.exp(-dt * 8);
    for (const obj of cam.fading) {
        const target = obj.userData._fadeTarget ? FADED_OPACITY : 1;
        let done = true;
        obj.traverse(c => {
            const m = c.userData && c.userData._fadeMat;
            if (!m || c.material !== m) return;
            m.opacity += (target - m.opacity) * k;
            if (Math.abs(target - m.opacity) > 0.01) done = false;
            else m.opacity = target;
        });
        if (done && target === 1) {
            obj.traverse(c => { if (c.userData && c.userData._origMat && c.material === c.userData._fadeMat) c.material = c.userData._origMat; });
            cam.fading.delete(obj);
        }
    }
}

function clearFades() {
    for (const obj of cam.fading) {
        obj.traverse(c => { if (c.userData && c.userData._origMat) c.material = c.userData._origMat; });
        obj.userData._fadeTarget = false;
    }
    cam.fading.clear();
}

// Pick a front three-quarter view of the character with the fewest models in the way.
function frameCharacter(animateIt = true) {
    if (!characterAnchor(_camFocus)) return;
    const focus = _camFocus.clone();
    focus.y = cam.focusY = THREE.MathUtils.clamp(focus.y * 0.92, 50, 140);

    // Orient on the direction of travel so the walk reads from the front-side.
    let heading = 0;
    if (currentClip) {
        const p = extractPathFromClip(currentClip);
        const a = p[0], b = p[p.length - 1];
        if (a && b && Math.hypot(b[0] - a[0], b[2] - a[2]) > 20) heading = Math.atan2(b[0] - a[0], b[2] - a[2]);
    }
    const dist = IS_SMALL ? 600 : 470;
    let best = null;
    // Low angles first; climb only when every low view is blocked.
    // Big blockers (buildings) cost more than small ones (bushes).
    search:
    for (const [pitch, cost] of [[0.26, 0], [0.45, 4], [0.68, 9]]) {
        for (let i = 0; i < 18; i++) {
            const step = i === 0 ? 0 : (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 9);
            const az = heading + 0.95 + step;
            const offset = new THREE.Vector3(Math.sin(az) * Math.cos(pitch), Math.sin(pitch), Math.cos(az) * Math.cos(pitch)).multiplyScalar(dist);
            let weight = 0;
            for (const o of blockersBetween(focus.clone().add(offset), focus)) {
                const box = cam.boxes.find(b => b.obj === o)?.box;
                weight += box ? THREE.MathUtils.clamp((box.max.y - box.min.y) / 80, 1, 6) : 1;
            }
            const score = weight * 10 + Math.abs(step) + cost;
            if (!best || score < best.score) best = { offset, score };
            if (weight === 0) break search;
        }
    }
    cam.userMoved = false;
    if (animateIt) {
        cam.tween = { t: 0, dur: 1.2, fromPos: camera.position.clone(), fromTarget: controls.target.clone(), offset: best.offset };
    } else {
        controls.target.copy(focus);
        camera.position.copy(focus).add(best.offset);
        controls.update();
    }
}

function updateCamera(dt) {
    const hasChar = cam.active && !cam.locked && characterAnchor(_camFocus);
    if (hasChar) {
        // Lead by the smoothed ground velocity so a fast walker stays centered.
        if (cam.prevHips && dt > 0) {
            _camStep.subVectors(_camFocus, cam.prevHips).divideScalar(dt);
            _camStep.y = 0;
            if (_camStep.lengthSq() > 1500 * 1500) cam.vel.set(0, 0, 0); // loop jump
            else cam.vel.lerp(_camStep, 1 - Math.exp(-dt * 2));
        }
        cam.prevHips = (cam.prevHips || new THREE.Vector3()).copy(_camFocus);
        _camFocus.addScaledVector(cam.vel, 0.2);
        const ty = THREE.MathUtils.clamp(cam.prevHips.y * 0.92, 50, 140);
        cam.focusY += (ty - cam.focusY) * (1 - Math.exp(-dt * 1.5));
        _camFocus.y = cam.focusY;
    }
    if (cam.tween) {
        // Ease from wherever the camera was onto the live character position.
        const tw = cam.tween;
        tw.t = Math.min(tw.t + dt / tw.dur, 1);
        const e = tw.t < 0.5 ? 4 * tw.t ** 3 : 1 - (-2 * tw.t + 2) ** 3 / 2;
        const goal = hasChar ? _camFocus : tw.fromTarget;
        controls.target.lerpVectors(tw.fromTarget, goal, e);
        _camStep.copy(goal).add(tw.offset);
        camera.position.lerpVectors(tw.fromPos, _camStep, e);
        if (tw.t >= 1) cam.tween = null;
        camera.lookAt(controls.target);
    } else if (hasChar) {
        _camStep.subVectors(_camFocus, controls.target);
        // A big jump means the clip looped back to its start: cut, don't swoop.
        if (_camStep.lengthSq() > 250 * 250) _camStep.multiplyScalar(1);
        else _camStep.multiplyScalar(1 - Math.exp(-dt * 5));
        controls.target.add(_camStep);
        camera.position.add(_camStep);
        controls.update();
    } else {
        controls.update();
    }

    if (hasChar && !cam.tween) fadeBlockers(_camFocus);
    updateFades(dt);
}

// Ghost whatever stands between the camera and the character (10 checks a second).
const _fadeFocus = new THREE.Vector3();
function fadeBlockers(focus) {
    const now = performance.now();
    if (now - cam.lastCheck < 100) return;
    cam.lastCheck = now;
    if (!focus) {
        if (!characterAnchor(_fadeFocus)) return;
        focus = _fadeFocus;
    }
    const blocking = new Set(blockersBetween(camera.position, focus));
    for (const { obj } of cam.boxes) setFaded(obj, blocking.has(obj));
}

let isRecording = false;
let selectedClipIndex = -1;
function animate() {
    requestAnimationFrame(animate);
    const dt = clock.getDelta();
    if (isRecording) return;
    if (mixer && isPlaying) mixer.update(dt);
    updateCamera(Math.min(dt, 0.1));
    if (!skinnedCharMesh) updateBodyMeshes(); // capsule fallback only
    if (timelineClips.length > 0) updatePlayhead();
    // Keep ground centered on character
    if (currentBones && characterGroup) {
        currentBones.getWorldPosition(_charWorldPos);
        if (groundMesh) {
            groundMesh.position.x = _charWorldPos.x;
            groundMesh.position.z = _charWorldPos.z;
        }
        // Extend environment when character goes far from last extension point
        if (!window._lastExtendPos) window._lastExtendPos = new THREE.Vector3();
        const distFromLastExtend = _charWorldPos.distanceTo(window._lastExtendPos);
        if (distFromLastExtend > 200) {
            window._lastExtendPos.copy(_charWorldPos);
            const nearby = [[_charWorldPos.x, 0, _charWorldPos.z]];
            extendEnvironmentAlongPath(nearby);
        }
    }
    // Pulse selection box
    if (selectionBox) {
        const pulse = 0.6 + Math.sin(Date.now() * 0.004) * 0.4;
        selectionBox.material.opacity = pulse;
    }
    updateEnvironmentFollow();
    if (welcomeOpen()) return; // fully covered; save the GPU for the preview
    renderer.render(scene, camera);
}
const _welcomeEl = document.getElementById('welcome');
function welcomeOpen() { return !_welcomeEl.classList.contains('hidden'); }

// Sun, shadow frustum, sky and contact shadow track the character.
const _envFocus = new THREE.Vector3();
function updateEnvironmentFollow() {
    if (characterAnchor(_envFocus)) {
        contactShadow.position.x = _envFocus.x;
        contactShadow.position.z = _envFocus.z;
        // Fade the blob as the hips rise (jumps, flips)
        const lift = Math.max(0, _envFocus.y - 95);
        contactShadow.material.opacity = 0.6 * Math.max(0.25, 1 - lift / 120);
    } else {
        _envFocus.copy(controls.target);
    }
    _envFocus.y = 0;
    sun.target.position.copy(_envFocus);
    sun.position.copy(_envFocus).add(SUN_OFFSET);
    sky.position.copy(camera.position);
}

// Shadows on whatever character meshes exist after a BVH load.
function prepareCharacter() {
    if (characterGroup) enableShadows(characterGroup);
    bodyMeshes.forEach(m => { m.castShadow = true; m.receiveShadow = true; });
    contactShadow.visible = !!currentBones;
}
animate();


async function motionError(res) {
    try {
        const { detail } = await res.json();
        if (typeof detail === 'string') return detail;
    } catch {}
    return `Motion failed (${res.status})`;
}

// Report what the motion server actually says instead of assuming it is up.
// This also warms a GPU container while the user is still typing.
renderGpu();
checkHealth();

// ========== WELCOME PREVIEW — separate mini renderer in a box ==========
const WELCOME_MOTIONS = [
    { file: 'assets/motions/backflip.bvh', label: 'backflip' },
    { file: 'assets/motions/silly_dance.bvh', label: 'dancing' },
    { file: 'assets/motions/spinning_kick.bvh', label: 'spinning kick', mirror: true },
    { file: 'assets/motions/sneak_forward.bvh', label: 'sneaking' },
    { file: 'assets/motions/drunk_dance.bvh', label: 'vibing' },
];
let welcomeMotionIdx = 0;
let welcomeInterval = null;

(function initWelcomePreview() {
    const container = document.getElementById('w-preview');
    if (!container) return;

    // Separate scene, camera, renderer for the preview box.
    // Transparent canvas: the card's CSS gradient is the backdrop.
    const wScene = new THREE.Scene();

    const wCamera = new THREE.PerspectiveCamera(42, 460 / 520, 1, 2000);
    wCamera.position.set(0, 125, 330);
    wCamera.lookAt(0, 82, 0);

    const wRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    wRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    wRenderer.outputColorSpace = THREE.SRGBColorSpace;
    wRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    wRenderer.toneMappingExposure = 1.05;
    wRenderer.shadowMap.enabled = true;
    wRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(wRenderer.domElement);

    // Fit the canvas to the card (it changes size on phones).
    function wResize() {
        const w = container.clientWidth || 460, hgt = container.clientHeight || 520;
        wRenderer.setSize(w, hgt, false);
        wCamera.aspect = w / hgt;
        // Narrow cards pull the camera back so a backflip still fits.
        wCamera.position.z = 330 * Math.max(1, 0.9 / wCamera.aspect);
        wCamera.updateProjectionMatrix();
    }
    wResize();
    if (window.ResizeObserver) new ResizeObserver(wResize).observe(container);

    // Lights: soft sky light plus a warm key that casts the floor shadow
    wScene.add(new THREE.HemisphereLight(0xf6f3fb, 0x9a90a8, 1.9));
    const wKey = new THREE.DirectionalLight(0xfff3e6, 2.6);
    wKey.position.set(120, 280, 180);
    wKey.castShadow = true;
    wKey.shadow.mapSize.set(1024, 1024);
    Object.assign(wKey.shadow.camera, { left: -160, right: 160, top: 160, bottom: -160, near: 50, far: 700 });
    wKey.shadow.normalBias = 0.6;
    wScene.add(wKey);
    const wRim = new THREE.DirectionalLight(0xc9b8f0, 0.9);
    wRim.position.set(-160, 140, -200);
    wScene.add(wRim);

    // Floor: a soft lavender pool plus a shadow-only plane, no hard disc edge
    const poolCanvas = document.createElement('canvas');
    poolCanvas.width = poolCanvas.height = 256;
    const pg = poolCanvas.getContext('2d');
    const grad = pg.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, 'rgba(124,92,191,0.16)');
    grad.addColorStop(0.6, 'rgba(124,92,191,0.06)');
    grad.addColorStop(1, 'rgba(124,92,191,0)');
    pg.fillStyle = grad;
    pg.fillRect(0, 0, 256, 256);
    const poolTex = new THREE.CanvasTexture(poolCanvas);
    poolTex.colorSpace = THREE.SRGBColorSpace;
    const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(420, 420),
        new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, toneMapped: false })
    );
    floor.rotation.x = -Math.PI / 2;
    wScene.add(floor);
    const shadowFloor = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.ShadowMaterial({ opacity: 0.16 }));
    shadowFloor.rotation.x = -Math.PI / 2;
    shadowFloor.position.y = 0.2;
    shadowFloor.receiveShadow = true;
    wScene.add(shadowFloor);

    // State
    let wMixer = null;
    let wBones = null;
    let wGroup = null;
    let wBodyMeshes = [];
    const wClock = new THREE.Clock();

    let wCharacter = null;

    async function wLoadBVH(text) {
        // Clear previous
        if (wGroup) wScene.remove(wGroup);
        if (wCharacter) { wCharacter.dispose(); wCharacter = null; }
        wBodyMeshes.forEach(m => wScene.remove(m));
        wBodyMeshes = [];

        const loader = new BVHLoader();
        const result = loader.parse(text);

        wGroup = new THREE.Group();
        wBones = result.skeleton.bones[0];
        wGroup.add(wBones);
        wScene.add(wGroup);

        let wFootClearance = 2;
        try {
            const group = wGroup;
            const c = await createCharacter(wBones, THREE, GLTFLoader);
            if (group !== wGroup) { c.dispose(); return 0; }
            wCharacter = c;
            group.add(c.object);
            wFootClearance = c.footClearance;
        } catch (e) {
            // Create body meshes using the same LatheGeometry approach as main scene
            const mat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.6, metalness: 0.1 });
            const tv1 = new THREE.Vector3(), tv2 = new THREE.Vector3();

            // Head
            const headBone = findBone(wBones, 'HeadEnd');
            const headBase = findBone(wBones, 'Head');
            if (headBone && headBase) {
                const hMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 16), mat.clone());
                hMesh.userData.type = 'head';
                hMesh.userData.bone = headBone;
                hMesh.userData.baseBone = headBase;
                wScene.add(hMesh);
                wBodyMeshes.push(hMesh);
            }

            // Body segments with LatheGeometry
            for (const [fromName, toName, rTop, rBot] of BODY_SEGMENTS) {
                const fromBone = findBone(wBones, fromName);
                const toBone = findBone(wBones, toName);
                if (!fromBone || !toBone) continue;

                fromBone.getWorldPosition(tv1);
                toBone.getWorldPosition(tv2);
                const height = Math.max(tv1.distanceTo(tv2), 1);
                const segments = 12;
                const capSteps = 8;
                const points = [];
                for (let i = 0; i <= capSteps; i++) {
                    const angle = (Math.PI / 2) * (i / capSteps);
                    points.push(new THREE.Vector2(Math.sin(angle) * rBot, -height / 2 - Math.cos(angle) * rBot + rBot));
                }
                points.push(new THREE.Vector2(rBot, -height / 2 + rBot));
                points.push(new THREE.Vector2(rTop, height / 2 - rTop));
                for (let i = 0; i <= capSteps; i++) {
                    const angle = (Math.PI / 2) * (i / capSteps);
                    points.push(new THREE.Vector2(Math.cos(angle) * rTop, height / 2 + Math.sin(angle) * rTop - rTop));
                }
                const geo = new THREE.LatheGeometry(points, segments);
                const mesh = new THREE.Mesh(geo, mat.clone());
                mesh.userData.type = 'capsule';
                mesh.userData.fromBone = fromBone;
                mesh.userData.toBone = toBone;
                wScene.add(mesh);
                wBodyMeshes.push(mesh);
            }

            // Hands
            for (const handName of ['LeftHand', 'RightHand']) {
                const bone = findBone(wBones, handName);
                if (bone) {
                    const hMesh = new THREE.Mesh(new THREE.SphereGeometry(3.5, 10, 8), mat.clone());
                    hMesh.userData.type = 'joint';
                    hMesh.userData.bone = bone;
                    wScene.add(hMesh);
                    wBodyMeshes.push(hMesh);
                }
            }

        }

        wMixer = new THREE.AnimationMixer(wBones);

        // Sample to find ground offset
        const action = wMixer.clipAction(result.clip);
        action.play();
        let minY = Infinity;
        const bp = new THREE.Vector3();
        const dur = result.clip.duration;
        for (let s = 0; s <= 20; s++) {
            wMixer.update(s === 0 ? 0.0001 : dur / 20);
            wGroup.updateMatrixWorld(true);
            for (const fn of ['LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase']) {
                const b = findBone(wBones, fn);
                if (b) { b.getWorldPosition(bp); if (bp.y < minY) minY = bp.y; }
            }
        }
        wGroup.position.y = -(minY - wFootClearance);
        action.reset();
        action.setLoop(THREE.LoopOnce);
        action.clampWhenFinished = true;
        action.play();
        wMixer.setTime(0);
        wClock.getDelta();
        return dur;
    }

    // Reuse the exact same update logic as the main scene
    function wUpdateBodyMeshes() {
        const up = new THREE.Vector3(0, 1, 0);
        const v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
        const mid = new THREE.Vector3(), dir = new THREE.Vector3();
        const q = new THREE.Quaternion();

        for (const mesh of wBodyMeshes) {
            if (mesh.userData.type === 'head') {
                mesh.userData.baseBone.getWorldPosition(v1);
                mesh.userData.bone.getWorldPosition(v2);
                mid.lerpVectors(v1, v2, 0.5);
                mesh.position.copy(mid);
                const h = v1.distanceTo(v2);
                mesh.scale.set(7, h * 0.55, 7.5);
                dir.subVectors(v2, v1).normalize();
                if (dir.lengthSq() > 0.0001) { q.setFromUnitVectors(up, dir); mesh.quaternion.copy(q); }
            } else if (mesh.userData.type === 'joint') {
                mesh.userData.bone.getWorldPosition(v1);
                mesh.position.copy(v1);
            } else {
                mesh.userData.fromBone.getWorldPosition(v1);
                mesh.userData.toBone.getWorldPosition(v2);
                mid.lerpVectors(v1, v2, 0.5);
                mesh.position.copy(mid);
                dir.subVectors(v2, v1).normalize();
                if (dir.lengthSq() > 0.0001) { q.setFromUnitVectors(up, dir); mesh.quaternion.copy(q); }
            }
        }
    }

    // Render loop for preview; it idles while the welcome screen is hidden
    // so the logo can bring it back.
    const welcomeEl = document.getElementById('welcome');
    function wAnimate() {
        requestAnimationFrame(wAnimate);
        const dt = wClock.getDelta();
        if (welcomeEl.classList.contains('hidden')) return;
        if (wMixer) wMixer.update(dt);
        wUpdateBodyMeshes();
        wRenderer.render(wScene, wCamera);
    }
    wAnimate();

    const castAll = () => wBodyMeshes.forEach(m => { m.castShadow = true; });

    // Schedule next motion when current clip ends
    async function playNextWelcomeMotion() {
        if (welcomeEl.classList.contains('hidden')) {
            setTimeout(playNextWelcomeMotion, 1000);
            return;
        }
        welcomeMotionIdx = (welcomeMotionIdx + 1) % WELCOME_MOTIONS.length;
        const m = WELCOME_MOTIONS[welcomeMotionIdx];
        try {
            const r = await fetch(m.file);
            if (r.ok) {
                const dur = await wLoadBVH(await r.text());
                castAll();
                // Mirror on X if flagged
                if (wGroup) wGroup.scale.x = m.mirror ? -1 : 1;
                const label = document.getElementById('w-motion-label');
                if (label) {
                    label.style.opacity = '0';
                    setTimeout(() => { label.textContent = m.label; label.style.opacity = '1'; }, 300);
                }
                // Schedule next before clip ends (cut last 0.5s of stillness)
                setTimeout(playNextWelcomeMotion, Math.max(dur - 0.5, 1) * 1000);
            }
        } catch(e) {}
    }
    // Schedule first transition after initial clip ends
    fetch(WELCOME_MOTIONS[0].file)
        .then(r => r.ok ? r.text() : null)
        .then(async text => {
            if (text) {
                try {
                    const dur = await wLoadBVH(text);
                    castAll();
                    setTimeout(playNextWelcomeMotion, Math.max(dur - 0.5, 1) * 1000);
                } catch(e) { console.error('Welcome BVH parse error:', e); }
            }
        })
        .catch(e => { console.error('Welcome BVH fetch failed:', e); });

})();

// Resize
window.addEventListener('resize', () => {
    if (timelineClips.length) renderTimelineRuler();
    camera.aspect = viewport.clientWidth / viewport.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(viewport.clientWidth, viewport.clientHeight);
});

// ========== TIMELINE & INTERACTION SYSTEM ==========
const raycaster = new THREE.Raycaster();
const ptrStart = new THREE.Vector2();
let ptrDownTime = 0;

// Track animation clips as timeline segments
// (timelineClips and totalDuration declared with other state vars above)

// Merge two AnimationClips into one continuous clip with a smooth blend transition
function mergeClips(clipA, clipB, blendTime) {
    blendTime = blendTime || 0.4;
    const offsetTime = clipA.duration;
    const mergedTracks = [];

    // CRITICAL: Find root position offset so clip B continues from where clip A ended.
    // The Hips bone has a position track with absolute XYZ — we need to offset clip B's
    // Hips position so it starts where clip A's Hips ended.
    const hipsTrackA = clipA.tracks.find(t => t.name.includes('Hips') && t.name.endsWith('.position'));
    const hipsTrackB = clipB.tracks.find(t => t.name.includes('Hips') && t.name.endsWith('.position'));
    let posOffsetX = 0, posOffsetZ = 0;
    if (hipsTrackA && hipsTrackB) {
        const vA = hipsTrackA.values;
        const vB = hipsTrackB.values;
        // End of clip A: last XYZ triplet
        const endAx = vA[vA.length - 3], endAz = vA[vA.length - 1];
        // Start of clip B: first XYZ triplet
        const startBx = vB[0], startBz = vB[2];
        posOffsetX = endAx - startBx;
        posOffsetZ = endAz - startBz;
    }

    for (const trackA of clipA.tracks) {
        const trackB = clipB.tracks.find(t => t.name === trackA.name);
        if (!trackB) {
            mergedTracks.push(trackA.clone());
            continue;
        }

        const timesA = Array.from(trackA.times);
        const timesB = Array.from(trackB.times).map(t => t + offsetTime);

        const valuesA = Array.from(trackA.values);
        let valuesB = Array.from(trackB.values);

        const valSize = trackA.getValueSize();
        const isPositionTrack = trackA.name.endsWith('.position');

        // Offset position tracks for Hips so character doesn't teleport
        if (isPositionTrack && trackA.name.includes('Hips') && (posOffsetX !== 0 || posOffsetZ !== 0)) {
            for (let i = 0; i < valuesB.length; i += valSize) {
                valuesB[i] += posOffsetX;       // X
                valuesB[i + 2] += posOffsetZ;   // Z
            }
        }

        // Blend keyframes at the junction for smooth transition
        const lastA = valuesA.slice(-valSize);
        const firstB = valuesB.slice(0, valSize);
        const blendTimes = [offsetTime - 0.001, offsetTime + blendTime];
        const blendVals = [];
        blendVals.push(...lastA);
        for (let i = 0; i < valSize; i++) {
            blendVals.push(lastA[i] * 0.3 + firstB[i] * 0.7);
        }

        const allTimes = new Float32Array([...timesA, ...blendTimes, ...timesB]);
        const allValues = new Float32Array([...valuesA, ...blendVals, ...valuesB]);

        mergedTracks.push(new trackA.constructor(trackA.name, allTimes, allValues));
    }

    // Include any tracks only in clipB
    for (const trackB of clipB.tracks) {
        if (!clipA.tracks.find(t => t.name === trackB.name)) {
            const clone = trackB.clone();
            clone.times = new Float32Array(Array.from(clone.times).map(t => t + offsetTime));
            mergedTracks.push(clone);
        }
    }

    return new THREE.AnimationClip('merged', clipA.duration + clipB.duration, mergedTracks);
}

function setPlayIcon(playing) {
    document.getElementById('tl-playpause').innerHTML = playing ? '<svg width="10" height="12" viewBox="0 0 10 12"><rect x="1" y="0" width="2.5" height="12" rx="0.5" fill="currentColor"/><rect x="6.5" y="0" width="2.5" height="12" rx="0.5" fill="currentColor"/></svg>' : '<svg width="10" height="12" viewBox="0 0 10 12"><path d="M1 0.5v11l8.5-5.5z" fill="currentColor"/></svg>';
}

function showTimeline() {
    document.getElementById('timeline-bar').classList.add('visible');
}

// Clip blocks share the track in proportion to their length.
function renderTimelineClips() {
    const container = document.getElementById('timeline-clips');
    container.innerHTML = '';
    timelineClips.forEach((seg, i) => {
        const el = document.createElement('div');
        el.className = 'timeline-clip';
        if (i === selectedClipIndex) el.classList.add('selected');
        el.style.flex = `${seg.duration} 1 0`;
        el.title = `${seg.prompt} (${seg.duration.toFixed(1)}s)`;
        el.append(h('span', 'clip-name', seg.prompt), h('span', 'clip-dur', seg.duration.toFixed(1) + 's'));
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            if (tl.dragged) return; // that was a scrub, not a click
            selectedClipIndex = selectedClipIndex === i ? -1 : i;
            renderTimelineClips();
        });
        container.appendChild(el);
    });
    tl.activeIdx = -1;
    requestAnimationFrame(renderTimelineRuler);
}

// Time ruler with a tick spacing that fits the track width.
function renderTimelineRuler() {
    const ruler = document.getElementById('timeline-ruler');
    const width = document.getElementById('timeline-clips').clientWidth;
    tl.width = width;
    ruler.replaceChildren();
    if (!totalDuration || !width) return;
    const step = [0.5, 1, 2, 5, 10, 20].find(st => (width / (totalDuration / st)) >= 90) || 30;
    for (let t = 0; t <= totalDuration - step * 0.35; t += step) {
        const tick = h('div', 'tl-tick', `${+t.toFixed(1)}s`);
        tick.style.left = `${(t / totalDuration) * 100}%`;
        ruler.append(tick);
    }
}

// Timeline scrub state; times are clip seconds (the mixer runs them at timeScale).
const tl = { width: 0, activeIdx: -1, dragging: false, dragged: false, wasPlaying: true, startX: 0, lastLabel: '' };

function seekTimeline(t) {
    if (!mixer || !totalDuration) return;
    t = THREE.MathUtils.clamp(t, 0, totalDuration - 1e-3);
    mixer.setTime(t / (mixer.timeScale || 1));
}

(() => {
    const track = document.getElementById('timeline-track');
    const timeAt = (e) => {
        const r = document.getElementById('timeline-clips').getBoundingClientRect();
        return ((e.clientX - r.left) / r.width) * totalDuration;
    };
    track.addEventListener('pointerdown', (e) => {
        if (!mixer || !totalDuration) return;
        tl.dragging = true;
        tl.dragged = false;
        tl.startX = e.clientX;
        tl.wasPlaying = isPlaying;
        isPlaying = false;
        isScrubbing = true;
        track.setPointerCapture(e.pointerId);
        seekTimeline(timeAt(e));
    });
    track.addEventListener('pointermove', (e) => {
        if (!tl.dragging) return;
        if (Math.abs(e.clientX - tl.startX) > 4) tl.dragged = true;
        seekTimeline(timeAt(e));
    });
    const end = () => {
        if (!tl.dragging) return;
        tl.dragging = false;
        isScrubbing = false;
        isPlaying = tl.wasPlaying;
        setPlayIcon(isPlaying);
        setTimeout(() => { tl.dragged = false; }, 0);
    };
    track.addEventListener('pointerup', end);
    track.addEventListener('pointercancel', end);
})();

// Rebuild merged clip from all timeline segments
function rebuildMergedClip() {
    if (timelineClips.length === 0) return;
    let merged = timelineClips[0].clip;
    for (let i = 1; i < timelineClips.length; i++) {
        merged = mergeClips(merged, timelineClips[i].clip, 0.4);
    }
    mixer.stopAllAction();
    mixer.uncacheRoot(currentBones);
    mixer = new THREE.AnimationMixer(currentBones);
    mixer.timeScale = 1.5;
    currentClip = merged;
    currentAction = mixer.clipAction(merged);
    currentAction.play();
    totalDuration = merged.duration;
}

function updatePlayhead() {
    if (!mixer || totalDuration === 0) return;
    // Loop the merged clip
    const t = mixer.time % totalDuration;
    if (!tl.width) tl.width = document.getElementById('timeline-clips').clientWidth;
    const frac = Math.min(t / totalDuration, 1);
    document.getElementById('timeline-playhead').style.transform = `translateX(${(frac * tl.width).toFixed(1)}px)`;
    const label = `${t.toFixed(1)}s`;
    if (label !== tl.lastLabel) {
        tl.lastLabel = label;
        document.getElementById('tl-time').innerHTML = `${label} <span class="tl-total">/ ${totalDuration.toFixed(1)}s</span>`;
    }

    // Highlight active clip
    let elapsed = 0, idx = -1;
    for (let i = 0; i < timelineClips.length; i++) {
        if (t >= elapsed && t < elapsed + timelineClips[i].duration) { idx = i; break; }
        elapsed += timelineClips[i].duration;
    }
    if (idx !== tl.activeIdx) {
        tl.activeIdx = idx;
        document.querySelectorAll('.timeline-clip').forEach((el, i) => el.classList.toggle('active', i === idx));
    }
}

// Click to select/delete scene objects (silent — no panel)
renderer.domElement.addEventListener('pointerdown', (e) => {
    ptrStart.set(e.clientX, e.clientY);
    ptrDownTime = Date.now();
});

renderer.domElement.addEventListener('pointerup', (e) => {
    const dx = e.clientX - ptrStart.x, dy = e.clientY - ptrStart.y;
    if (Math.sqrt(dx*dx + dy*dy) > 5 || Date.now() - ptrDownTime > 300) return;

    const rect = renderer.domElement.getBoundingClientRect();
    const ptr = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(ptr, camera);

    const targets = [];
    sceneObjects.forEach(obj => {
        if (obj.userData._isGround) return; // skip ground
        if (obj.isMesh) targets.push(obj);
        else if (obj.isGroup || obj.children) obj.traverse(c => { if (c.isMesh) targets.push(c); });
    });

    const hits = raycaster.intersectObjects(targets, false);
    if (hits.length > 0) {
        let root = hits[0].object;
        while (root.parent && !sceneObjects.includes(root)) root = root.parent;
        if (sceneObjects.includes(root)) {
            // Clear previous selection
            if (selectedObject) {
                selectedObject.traverse(c => {
                    if (c.isMesh && c.userData._oe) c.material.emissive.copy(c.userData._oe);
                });
            }
            selectedObject = root;
            selectedType = 'scene';
            // Purple emissive tint
            root.traverse(c => {
                if (c.isMesh && c.material && c.material.emissive) {
                    c.userData._oe = c.material.emissive.clone();
                    c.material.emissive.set(0x553399);
                }
            });
            // Purple wireframe box
            showSelectionBox(root);
            enterBuildMode();
        }
    } else {
        // Deselect
        if (selectedObject) {
            selectedObject.traverse(c => {
                if (c.isMesh && c.userData._oe) c.material.emissive.copy(c.userData._oe);
            });
            selectedObject = null;
            selectedType = null;
            removeSelectionBox();
            exitBuildMode();
        }
    }
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

    // Spacebar = play/pause
    if (e.key === ' ') {
        e.preventDefault();
        isPlaying = !isPlaying;
        setPlayIcon(isPlaying);
        return;
    }

    if (e.key !== 'Delete' && e.key !== 'Backspace') return;

    // Delete selected timeline clip
    if (selectedClipIndex >= 0 && timelineClips.length > 1) {
        timelineClips.splice(selectedClipIndex, 1);
        selectedClipIndex = -1;
        rebuildMergedClip();
        renderTimelineClips();
        return;
    }

    // Delete selected scene object
    if (selectedObject && selectedType === 'scene') {
        scene.remove(selectedObject);
        const idx = sceneObjects.indexOf(selectedObject);
        if (idx !== -1) sceneObjects.splice(idx, 1);
        selectedObject.traverse(c => {
            if (c.geometry) c.geometry.dispose();
            if (c.material) (Array.isArray(c.material) ? c.material : [c.material]).forEach(m => m.dispose());
        });
        selectedObject = null;
        selectedType = null;
        removeSelectionBox();
    }
});

// Play/Pause button
document.getElementById('tl-playpause').addEventListener('click', () => {
    isPlaying = !isPlaying;
    setPlayIcon(isPlaying);
});

// Deselect timeline clip when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.timeline-clip')) {
        if (selectedClipIndex >= 0) {
            selectedClipIndex = -1;
            renderTimelineClips();
        }
    }
});

// ========== CHAT INTERFACE ==========
const chatInput = document.getElementById('chat-input');

// Find nearest scene object matching a keyword
function findNearestObject(keyword) {
    const kw = keyword.toLowerCase();
    let best = null, bestDist = Infinity;
    // Get character's current position
    const charPos = new THREE.Vector3();
    characterAnchor(charPos);
    for (const obj of sceneObjects) {
        if (obj.userData._isGround) continue;
        const objKw = (obj.userData._keyword || '').toLowerCase();
        // Match by keyword stored in userData, or by checking child names
        const nameMatch = objKw.includes(kw) || kw.includes(objKw);
        if (!nameMatch && objKw) continue;
        if (!nameMatch && !objKw) continue; // skip unknown objects
        const d = charPos.distanceTo(obj.position);
        if (d < bestDist) { bestDist = d; best = obj; }
    }
    return best;
}

// Rotate a BVH clip's root motion to face a target angle
function rotateBVHToward(bvhText, targetAngle) {
    const loader = new BVHLoader();
    const result = loader.parse(bvhText);
    const clip = result.clip;
    const hipsTrack = clip.tracks.find(t => t.name.includes('Hips') && t.name.endsWith('.position'));
    if (!hipsTrack) return { clip, skeleton: result.skeleton };

    const v = hipsTrack.values;
    // Compute the current direction of travel from BVH
    const startX = v[0], startZ = v[2];
    const endX = v[v.length - 3], endZ = v[v.length - 1];
    const currentAngle = Math.atan2(endX - startX, endZ - startZ);
    const rotation = targetAngle - currentAngle;
    const cos = Math.cos(rotation), sin = Math.sin(rotation);

    // Rotate all Hips positions around the start point
    for (let i = 0; i < v.length; i += 3) {
        const dx = v[i] - startX;
        const dz = v[i + 2] - startZ;
        v[i] = startX + dx * cos - dz * sin;
        v[i + 2] = startZ + dx * sin + dz * cos;
    }
    return { clip, skeleton: result.skeleton };
}

// Classify user chat intent via Gemini
const CHAT_CLASSIFY_PROMPT = `You are a scene editing assistant. Classify the user's request into ONE action type and extract parameters. Output ONLY valid JSON (no markdown).

ACTION TYPES:
1. "add_motion" — user wants the character to do something (walk, run, dance, jump, etc.)
   Output: {"action":"add_motion","prompt":"A person ...","duration":5,"target_object":null}
   If they reference an object ("run towards the tree"), set target_object to that object name.

2. "add_object" — user wants to add a prop/object to the scene
   Output: {"action":"add_object","keyword":"search term","category":number,"size":"large"|"medium"|"small","direction":"left"|"right"|"front"|"behind"|"near <object>"|"random"}
   CATEGORIES: 0=Food, 1=Clutter, 3=Transport, 4=Furniture, 5=Objects, 6=Nature, 7=Animals, 8=Buildings, 11=Other
   If user says where to place it, use that direction. Otherwise "random".

3. "modify_scene" — user wants to change lighting, ground color, time of day, weather
   Output: {"action":"modify_scene","changes":{"ground_color":"#hex","ambient_intensity":number,"fog":bool}}

Respond with ONLY the JSON object.`;

async function classifyChat(userMsg) {
    const res = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: CHAT_CLASSIFY_PROMPT + '\n\nUser says: ' + userMsg }] }],
            generationConfig: { temperature: 0.2 }
        })
    });
    const data = await res.json().catch(() => ({}));
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error(geminiProblem(res, data));
    const clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    return JSON.parse(clean);
}

// Resolve a direction string to [x, z] coordinates
function resolveDirection(direction, scale = 400) {
    const charPos = new THREE.Vector3();
    characterAnchor(charPos);
    const cx = charPos.x, cz = charPos.z;

    if (direction.startsWith('near ')) {
        const target = findNearestObject(direction.replace('near ', ''));
        if (target) {
            // Place near the target with some offset
            const offset = 80 + Math.random() * 60;
            const angle = Math.random() * Math.PI * 2;
            return [target.position.x + Math.cos(angle) * offset, target.position.z + Math.sin(angle) * offset];
        }
    }

    const jitter = () => (Math.random() - 0.5) * 150;
    const dist = 200 + Math.random() * scale;
    switch (direction) {
        case 'left':   return [cx - dist + jitter(), cz + jitter()];
        case 'right':  return [cx + dist + jitter(), cz + jitter()];
        case 'front':  return [cx + jitter(), cz + dist + jitter()];
        case 'behind': return [cx + jitter(), cz - dist + jitter()];
        default: {
            const a = Math.random() * Math.PI * 2;
            return [cx + Math.cos(a) * dist, cz + Math.sin(a) * dist];
        }
    }
}

// Handle add_object action
async function handleAddObject(params) {
    const [x, z] = resolveDirection(params.direction || 'random');
    const position = [x, 0, z];
    const sizeScales = { large: 250, medium: 100, small: 30 };
    const targetScale = sizeScales[params.size] || 100;

    log(`Adding "${params.keyword}" (${params.direction || 'random'})...`, 'scene', 'chat-action');
    const run = currentRun;
    run?.add('place', 'Place object');
    run?.start('place', `${params.keyword}, ${params.direction || 'anywhere'}`);

    // Try procedural first
    const procedural = tryProceduralModel(params.keyword, targetScale);
    if (procedural) {
        procedural.position.set(x, 0, z);
        procedural.userData._keyword = params.keyword;
        enableShadows(procedural);
        scene.add(procedural);
        sceneObjects.push(procedural);
        log(`Placed "${params.keyword}" to the ${params.direction || 'scene'}`, 'success', 'chat-action');
        run?.done('place', `Placed ${params.keyword}`);
        return;
    }

    // Fetch from Poly Pizza
    const glbUrl = await findLocalModel(params.keyword, params.category || 11);
    if (glbUrl) {
        const loaded = await loadGLBModel(glbUrl, position, targetScale, Math.random() * Math.PI * 2);
        if (loaded) loaded.userData._keyword = params.keyword;
        if (loaded) {
            log(`Placed "${params.keyword}" to the ${params.direction || 'scene'}`, 'success', 'chat-action');
            run?.done('place', `Placed ${params.keyword}`);
        } else {
            log(`Could not load "${params.keyword}" model`, 'error', 'chat-action');
            run?.fail('place', `Could not load the ${params.keyword} model`);
        }
    } else {
        log(`Could not find "${params.keyword}" model`, 'error', 'chat-action');
        run?.fail('place', `No ${params.keyword} in the model library`);
    }
}

// Handle add_motion action (with optional target object for BVH rotation)
async function handleAddMotion(params) {
    const dur = params.duration || 5;
    let targetAngle = null;

    // If targeting an object, find it and compute angle
    if (params.target_object) {
        const target = findNearestObject(params.target_object);
        if (target) {
            const charPos = new THREE.Vector3();
            characterAnchor(charPos);
            targetAngle = Math.atan2(
                target.position.x - charPos.x,
                target.position.z - charPos.z
            );
            log(`Targeting nearest "${params.target_object}" at [${Math.round(target.position.x)}, ${Math.round(target.position.z)}]`, 'path');
        } else {
            log(`No "${params.target_object}" found in scene, generating motion anyway`, 'system');
        }
    }

    log(`Generating motion (${dur}s)...`, 'motion', 'chat-action');
    const run = currentRun;
    run?.add('motion', 'Motion');
    run?.add('blend', 'Timeline');
    run?.start('motion', motionWaitText());

    try {
        const res = await fetch(`${API}/generate-motion`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: enhanceMotionPrompt(params.prompt), duration: dur })
        });
        if (!res.ok) throw new Error(await motionError(res));
        const bvh = await res.text();
        motionReceived();
        run?.done('motion', `${Number(dur).toFixed(1)} s clip`);
        run?.start('blend', 'Blending onto the end of the timeline');

        let newClip;
        if (targetAngle !== null) {
            // Rotate the BVH root motion to face the target
            const rotated = rotateBVHToward(bvh, targetAngle);
            newClip = rotated.clip;
        } else {
            const loader = new BVHLoader();
            newClip = loader.parse(bvh).clip;
        }

        const mergedClip = mergeClips(currentClip, newClip, 0.4);
        mixer.stopAllAction();
        mixer.uncacheRoot(currentBones);
        mixer = new THREE.AnimationMixer(currentBones);
        mixer.timeScale = 1.5;
        currentClip = mergedClip;
        currentAction = mixer.clipAction(mergedClip);
        currentAction.play();

        timelineClips.push({ prompt: params.prompt, duration: newClip.duration, clip: newClip });
        totalDuration = mergedClip.duration;
        renderTimelineClips();

        const fullPath = extractPathFromClip(mergedClip);
        updatePathVisualization(fullPath);
        // Update terrain for the new extended path
        if (groundMesh) applyTerrainFromPath(groundMesh, fullPath);

        log(`Added motion: "${params.prompt}" (${newClip.duration.toFixed(1)}s)`, 'success', 'chat-action');
        run?.done('blend', `Clip ${timelineClips.length} added, ${newClip.duration.toFixed(1)} s`);
    } catch (err) {
        log(`Error: ${err.message}`, 'error', 'chat-action');
        run?.failActive(err.message);
    }
}

// Handle modify_scene action
function handleModifyScene(params) {
    const changes = params.changes || {};
    const run = currentRun;
    run?.add('apply', 'Scene change');
    run?.start('apply');
    const did = [];
    if (changes.ground_color && groundMesh) {
        groundMesh.material.color.set(changes.ground_color);
        log(`Ground color changed to ${changes.ground_color}`, 'scene');
        did.push('ground color');
    }
    if (changes.ambient_intensity !== undefined) {
        const base = (ENV_PRESETS[envName] || ENV_PRESETS.day).hemiI;
        hemiLight.intensity = THREE.MathUtils.clamp(base * changes.ambient_intensity, 0.2, 4);
        log(`Ambient light set to ${changes.ambient_intensity}`, 'scene');
        did.push('light');
    }
    if (typeof changes.fog === 'boolean' && scene.fog) {
        const f = (ENV_PRESETS[envName] || ENV_PRESETS.day).fog;
        scene.fog.near = changes.fog ? 150 : f[0];
        scene.fog.far = changes.fog ? 1400 : f[1];
        did.push(changes.fog ? 'fog on' : 'fog off');
    }
    log('Scene updated', 'success');
    run?.done('apply', did.length ? `Changed ${did.join(', ')}` : 'Nothing to change');
}

// Main chat handler
async function handleChat(userMsg) {
    if (!userMsg.trim() || !currentClip) return;

    chatInput.disabled = true;
    chatInput.placeholder = 'Working on it...';
    syncChatSend();
    log(`> ${userMsg}`, 'user');
    const run = new Run(userMsg, [['understand', 'Understand']], 'chat');
    run.start('understand', 'Gemini reads the request');

    try {
        const intent = await classifyChat(userMsg);
        const what = { add_motion: 'A new motion', add_object: 'An object to add', modify_scene: 'A scene change' }[intent.action];
        if (what) run.done('understand', what);
        else run.fail('understand', 'Not sure what that means. Try a motion, an object, or a scene change.');

        switch (intent.action) {
            case 'add_motion':
                await handleAddMotion(intent);
                break;
            case 'add_object':
                await handleAddObject(intent);
                break;
            case 'modify_scene':
                handleModifyScene(intent);
                break;
            default:
                log('Not sure what to do with that — try adding a motion, object, or scene change', 'system');
        }
    } catch (err) {
        log(`Error: ${err.message}`, 'error');
        run.failActive(err.message);
    }
    const last = run.steps[run.steps.length - 1];
    run.finish(run.steps.some(s => s.state === 'failed') ? '' : (last.detail || 'Done'));

    chatInput.disabled = false;
    chatInput.placeholder = CHAT_PLACEHOLDER;
    syncChatSend();
    if (!IS_SMALL) chatInput.focus();
}

if (window.innerWidth < 600) chatInput.placeholder = 'What happens next?';
const CHAT_PLACEHOLDER = chatInput.placeholder;
const chatSend = document.getElementById('chat-send');
function syncChatSend() { chatSend.disabled = chatInput.disabled || !chatInput.value.trim(); }
function submitChat() {
    const msg = chatInput.value.trim();
    if (!msg || chatInput.disabled) return;
    chatInput.value = '';
    syncChatSend();
    handleChat(msg);
}
chatInput.addEventListener('input', syncChatSend);
chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitChat(); });
chatSend.addEventListener('click', submitChat);
syncChatSend();

function showPromptDock() {
    document.getElementById('prompt-dock').classList.add('visible');
    document.getElementById('render-btn').style.display = '';
}

// Panel collapse/reopen
function setPanelOpen(open) {
    document.getElementById('panel').classList.toggle('collapsed', !open);
    document.getElementById('panel-reopen').classList.toggle('visible', !open);
}
document.getElementById('panel-collapse').addEventListener('click', () => setPanelOpen(false));
document.getElementById('panel-reopen').addEventListener('click', () => setPanelOpen(true));

// ?debug exposes camera state for automated checks.
if (new URLSearchParams(location.search).has('debug')) {
    window.__kinetik = { camera, controls, cam, characterAnchor, THREE, scene, renderer, sun, getGround: () => groundMesh };
}

// Recenter button: shows once the user has moved the camera themselves.
const resetBtn = document.getElementById('reset-view');
resetBtn.addEventListener('click', () => frameCharacter(true));
setInterval(() => {
    resetBtn.classList.toggle('visible', cam.active && cam.userMoved && !cam.locked);
}, 300);

// ========== SCENE EDITOR ==========
const edToolbar = document.getElementById('editor-toolbar');
const edInfo = document.getElementById('editor-info');
const modelPicker = document.getElementById('model-picker');
let editorMode = null; // 'move' | 'rotate' | 'scale' | null
let dragObject = null;
let dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let dragOffset = new THREE.Vector3();

// Show editor toolbar after first generation
function showEditor() { edToolbar.classList.add('visible'); }

function enterBuildMode() {
    document.querySelectorAll('.ed-build-only').forEach(b => b.style.display = 'flex');
}
function exitBuildMode() {
    document.querySelectorAll('.ed-build-only').forEach(b => b.style.display = 'none');
    setEditorMode(null);
}

function showEditorInfo(msg) {
    edInfo.textContent = msg;
    edInfo.classList.add('visible');
    clearTimeout(edInfo._t);
    edInfo._t = setTimeout(() => edInfo.classList.remove('visible'), 2000);
}

// === Panel tabs: Activity / Add ===
const tabActivity = document.getElementById('tab-activity');
const tabAdd = document.getElementById('tab-add');
const consoleEl = document.getElementById('console');
const addContent = document.getElementById('add-tab-content');

function switchTab(tab) {
    const lib = tab !== 'activity';
    tabActivity.classList.toggle('active', !lib);
    tabAdd.classList.toggle('active', lib);
    consoleEl.style.display = lib ? 'none' : '';
    addContent.classList.toggle('visible', lib);
    document.getElementById('panel').classList.toggle('tall', lib);
}
tabActivity.addEventListener('click', () => switchTab('activity'));
tabAdd.addEventListener('click', () => switchTab('add'));

// Custom model creation input (in Add tab)
const addGrid = document.getElementById('add-tab-grid');
const createInput = document.getElementById('add-create-input');
const createStatus = document.getElementById('add-create-status');

const GEMINI_IMG_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${GEMINI_KEY}`;
const FAL_KEY = ''; // Set your fal.ai API key here (see .env)
// Custom models need both keys; hide the input instead of letting it fail.
if (!FAL_KEY || !GEMINI_KEY) document.getElementById('add-create-wrap').style.display = 'none';

createInput.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    const keyword = createInput.value.trim();
    if (!keyword) return;
    createInput.disabled = true;
    createStatus.style.display = 'block';
    createStatus.textContent = 'Generating image...';

    try {
        // Step 1: Nanobanana image
        const imgRes = await fetch(GEMINI_IMG_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: `A single ${keyword}, 3D render, three-quarter front view, bright even lighting, clean solid light gray background, low poly style, natural muted colors, no pure white, centered in frame` }] }],
                generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
            })
        });
        const imgData = await imgRes.json();
        const imgPart = imgData.candidates[0].content.parts.find(p => p.inlineData);
        if (!imgPart) throw new Error('No image generated');
        const b64 = imgPart.inlineData.data;
        const mime = imgPart.inlineData.mimeType || 'image/png';

        createStatus.textContent = 'Building 3D mesh (~30s)...';

        // Step 2: Trellis
        const meshRes = await fetch('https://fal.run/fal-ai/trellis', {
            method: 'POST',
            headers: { 'Authorization': `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ image_url: `data:${mime};base64,${b64}` })
        });
        const meshData = await meshRes.json();
        if (!meshData.model_mesh) throw new Error('3D conversion failed');
        const glbUrl = meshData.model_mesh.url;

        createStatus.textContent = 'Placing model...';

        // Place it
        const pos = [
            (_charWorldPos.x || 0) + (Math.random() - 0.5) * 200,
            0,
            (_charWorldPos.z || 0) + (Math.random() - 0.5) * 200
        ];
        await loadGLBModel(glbUrl, pos, 100, 0);
        log(`Created & placed "${keyword}"`, 'scene');

        // Add to picker for future use
        addModelToPicker(keyword.replace(/ /g, '_'), `data:image/png;base64,${b64.slice(0, 100)}`);

        switchTab('activity');
    } catch(err) {
        createStatus.textContent = `Error: ${err.message}`;
        setTimeout(() => { createStatus.style.display = 'none'; }, 3000);
    }

    createInput.disabled = false;
    createInput.value = '';
});

// Populate model picker with thumbnails
const AVAILABLE_MODELS = Object.keys(MODEL_MAP);

// Models that ship a thumbnail in models/; the rest get a lettered tile.
const MODEL_THUMBS = new Set(['barrel','bench','bookshelf','building','bush','car','chair','dumpster','fence_post','fountain','house','hydrant','lamp','mailbox','rock','shop','sofa','statue','stop_sign','street_lamp','table','traffic_cone','trash_can','tree','truck']);

function addModelToPicker(name, thumbUrl) {
    const div = document.createElement('div');
    div.className = 'mp-item';

    const label = document.createElement('span');
    label.textContent = name.replace(/_/g, ' ');
    const monogram = () => {
        const icon = document.createElement('div');
        icon.className = 'mp-icon';
        icon.textContent = name.charAt(0);
        return icon;
    };
    const src = thumbUrl || (MODEL_THUMBS.has(name) ? `models/${name}.png` : null);
    if (src) {
        const img = document.createElement('img');
        img.className = 'mp-thumb';
        img.loading = 'lazy';
        img.alt = '';
        img.src = src;
        img.onerror = () => img.replaceWith(monogram());
        div.appendChild(img);
    } else {
        div.appendChild(monogram());
    }
    div.appendChild(label);
    div.addEventListener('click', () => {
        enterPlaceMode(name);
        switchTab('activity');
    });
    addGrid.appendChild(div);
}

AVAILABLE_MODELS.forEach(name => addModelToPicker(name));

// Add button → switch to Add tab
if (document.getElementById('ed-add')) document.getElementById('ed-add').addEventListener('click', () => {
    switchTab('add');
});

// ========== PLACE MODE — model follows cursor until clicked ==========
let placeMode = false;
let placePreview = null;
let placeName = null;
const placeRaycaster = new THREE.Raycaster();
const placeMouse = new THREE.Vector2();
const placeGroundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const placeIntersect = new THREE.Vector3();

async function enterPlaceMode(name) {
    placeName = name;
    log(`Click in scene to place "${name}"`, 'system');

    // Try to load the GLB as a preview
    try {
        const url = `models/${name}.glb`;
        const gltf = await new Promise((resolve, reject) => {
            gltfLoader.load(url, resolve, undefined, reject);
        });
        placePreview = gltf.scene;
        const box = new THREE.Box3().setFromObject(placePreview);
        const size = new THREE.Vector3();
        box.getSize(size);
        const s = 100 / (size.y || 1);
        placePreview.scale.setScalar(s);
        // Make it semi-transparent
        placePreview.traverse(c => {
            if (c.isMesh) {
                c.material = c.material.clone();
                c.material.transparent = true;
                c.material.opacity = 0.5;
            }
        });
        scene.add(placePreview);
    } catch(e) {
        // Use a simple box as placeholder
        const geo = new THREE.BoxGeometry(40, 80, 40);
        const mat = new THREE.MeshStandardMaterial({ color: 0x7c5cbf, transparent: true, opacity: 0.4 });
        placePreview = new THREE.Mesh(geo, mat);
        placePreview.position.y = 40;
        const group = new THREE.Group();
        group.add(placePreview);
        placePreview = group;
        scene.add(placePreview);
    }

    placeMode = true;
    renderer.domElement.style.cursor = 'crosshair';
}

// Update preview position on mouse move
renderer.domElement.addEventListener('mousemove', (e) => {
    if (!placeMode || !placePreview) return;
    const rect = renderer.domElement.getBoundingClientRect();
    placeMouse.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    placeRaycaster.setFromCamera(placeMouse, camera);
    if (placeRaycaster.ray.intersectPlane(placeGroundPlane, placeIntersect)) {
        placePreview.position.x = placeIntersect.x;
        placePreview.position.z = placeIntersect.z;
    }
});

// Place on click
renderer.domElement.addEventListener('click', async (e) => {
    if (!placeMode || !placePreview) return;

    const finalPos = [placePreview.position.x, 0, placePreview.position.z];

    // Remove the transparent preview
    scene.remove(placePreview);
    placePreview = null;
    placeMode = false;
    renderer.domElement.style.cursor = '';

    // Load the real model at this position
    const url = `models/${placeName}.glb`;
    log(`Placing "${placeName}"...`, 'scene');
    try {
        await loadGLBModel(url, finalPos, 100, 0);
        log(`Placed "${placeName}"`, 'scene');
    } catch(e) {
        log(`Failed to place "${placeName}"`, 'error');
    }
});

// Cancel with Escape
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && placeMode) {
        if (placePreview) scene.remove(placePreview);
        placePreview = null;
        placeMode = false;
        renderer.domElement.style.cursor = '';
        log('Placement cancelled', 'system');
    }
});

// Mode buttons
function setEditorMode(mode) {
    editorMode = editorMode === mode ? null : mode;
    document.querySelectorAll('.ed-btn').forEach(b => b.classList.remove('active'));
    if (editorMode) {
        document.getElementById('ed-' + editorMode).classList.add('active');
        showEditorInfo(editorMode === 'move' ? 'Click + drag to move' :
            editorMode === 'rotate' ? 'Click object, drag to rotate' :
            'Click object, drag to scale');
    }
}
document.getElementById('ed-move').addEventListener('click', () => setEditorMode('move'));
document.getElementById('ed-rotate').addEventListener('click', () => setEditorMode('rotate'));
document.getElementById('ed-scale').addEventListener('click', () => setEditorMode('scale'));

// Keyboard shortcuts for editor
document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'm') setEditorMode('move');
    if (e.key === 'r') setEditorMode('rotate');
    if (e.key === 's' && !e.ctrlKey) setEditorMode('scale');
    if (e.key === 'Escape') {
        setEditorMode(null);
        if (selectedObject) {
            selectedObject.traverse(c => {
                if (c.isMesh && c.userData._oe) c.material.emissive.copy(c.userData._oe);
            });
            selectedObject = null;
            selectedType = null;
            removeSelectionBox();
        }
        exitBuildMode();
        modelPicker.classList.remove('visible');
    }
});

// Drag handling for move/rotate/scale
let _dragStartX = 0, _dragStartY = 0;
let _dragStartRot = 0, _dragStartScale = 1;

renderer.domElement.addEventListener('pointerdown', (e) => {
    if (!editorMode || !selectedObject || selectedType !== 'scene') return;
    dragObject = selectedObject;
    _dragStartX = e.clientX;
    _dragStartY = e.clientY;
    if (editorMode === 'rotate') _dragStartRot = dragObject.rotation.y;
    if (editorMode === 'scale') _dragStartScale = dragObject.scale.x;

    if (editorMode === 'move') {
        // Calculate drag offset on ground plane
        const rect = renderer.domElement.getBoundingClientRect();
        const mouse = new THREE.Vector2(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            -((e.clientY - rect.top) / rect.height) * 2 + 1
        );
        raycaster.setFromCamera(mouse, camera);
        const hit = new THREE.Vector3();
        raycaster.ray.intersectPlane(dragPlane, hit);
        dragOffset.subVectors(dragObject.position, hit);
        controls.enabled = false; // disable orbit while dragging
    } else {
        controls.enabled = false;
    }
});

renderer.domElement.addEventListener('pointermove', (e) => {
    if (!dragObject || !editorMode) return;

    if (editorMode === 'move') {
        const rect = renderer.domElement.getBoundingClientRect();
        const mouse = new THREE.Vector2(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            -((e.clientY - rect.top) / rect.height) * 2 + 1
        );
        raycaster.setFromCamera(mouse, camera);
        const hit = new THREE.Vector3();
        if (raycaster.ray.intersectPlane(dragPlane, hit)) {
            dragObject.position.x = hit.x + dragOffset.x;
            dragObject.position.z = hit.z + dragOffset.z;
        }
    } else if (editorMode === 'rotate') {
        const dx = e.clientX - _dragStartX;
        dragObject.rotation.y = _dragStartRot + dx * 0.01;
    } else if (editorMode === 'scale') {
        const dy = _dragStartY - e.clientY;
        const s = Math.max(0.1, _dragStartScale * (1 + dy * 0.005));
        dragObject.scale.setScalar(s);
    }
});

renderer.domElement.addEventListener('pointerup', () => {
    if (dragObject) {
        dragObject = null;
        controls.enabled = true;
    }
});

// Show editor after first scene generation
const _origGenerate = generate;

// ========== LYRIA MUSIC ==========
const LYRIA_URL = `https://generativelanguage.googleapis.com/v1beta/models/lyria-3-clip-preview:generateContent?key=${GEMINI_KEY}`;
let musicAudio = null; // <audio> element for current soundtrack
let musicMuted = false;
let musicAudioCtx = null;
let musicStreamDest = null;

async function generateMusic(scenePrompt) {
    setPill('pill-music', true);
    log('Generating soundtrack...', 'music', 'music-status');

    const musicPrompt = `Create a 30-second instrumental soundtrack for this scene: "${scenePrompt}".
Make it atmospheric and cinematic. No vocals, no lyrics. Match the mood and energy of the scene.
If the scene is dark or spooky, use minor keys and tension. If it's happy or active, use upbeat tempo.
Keep it subtle enough to be background music for a 3D animation.`;

    try {
        const res = await fetch(LYRIA_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: musicPrompt }] }],
                generationConfig: { responseModalities: ['AUDIO'] }
            })
        });

        const data = await res.json();
        const parts = data?.candidates?.[0]?.content?.parts;
        if (!parts) throw new Error('No audio in response');

        const audioPart = parts.find(p => p.inlineData);
        if (!audioPart) throw new Error('No audio data returned');

        const b64 = audioPart.inlineData.data;
        const mime = audioPart.inlineData.mimeType || 'audio/mp3';

        // Create audio element from base64
        if (musicAudio) { musicAudio.pause(); musicAudio.remove(); }
        musicAudioCtx = null;
        musicStreamDest = null;
        musicAudio = document.createElement('audio');
        musicAudio.src = `data:${mime};base64,${b64}`;
        musicAudio.loop = true;
        musicAudio.volume = 0.35;
        musicAudio.muted = musicMuted;

        // Set up persistent audio capture route
        try {
            musicAudioCtx = new AudioContext();
            const source = musicAudioCtx.createMediaElementSource(musicAudio);
            musicStreamDest = musicAudioCtx.createMediaStreamDestination();
            source.connect(musicStreamDest);
            source.connect(musicAudioCtx.destination); // still plays through speakers
        } catch (e) { /* fallback: no capture */ }

        // Fade in
        musicAudio.volume = 0;
        musicAudio.play().catch(() => {}); // may need user interaction
        let fadeIn = setInterval(() => {
            if (musicAudio.volume < 0.35) {
                musicAudio.volume = Math.min(0.35, musicAudio.volume + 0.02);
            } else {
                clearInterval(fadeIn);
            }
        }, 100);

        log('Soundtrack playing', 'music', 'music-status');
    } catch (err) {
        log(`Music: ${err.message}`, 'error', 'music-status');
    }
    setPill('pill-music', false);
}

// Music toggle removed — music only used during video render

// Get audio stream for mixing into video recording
function getMusicStream() {
    if (!musicStreamDest) return null;
    return musicStreamDest.stream;
}

// ========== RENDER VIDEO (Orbit Capture) ==========
const renderOverlay = document.getElementById('render-overlay');
const renderDot = document.getElementById('render-dot');
const renderHint = document.getElementById('render-hint');
const renderProgress = document.getElementById('render-progress');
const renderFill = document.getElementById('render-fill');
const renderBtn = document.getElementById('render-btn');
let renderMode = false;

renderBtn.addEventListener('click', async () => {
    if (isRecording) return;
    if (!currentClip) { log('Nothing to render yet', 'system'); return; }

    // Find orbit center — use character position
    const orbitCenter = new THREE.Vector3();
    characterAnchor(orbitCenter);
    orbitCenter.y = 0;

    cam.locked = true;
    clearFades();
    document.body.classList.add('rendering');
    const renderLabel = document.getElementById('render-label');
    // Save original camera state
    const origPos = camera.position.clone();
    const origTarget = controls.target.clone();
    controls.enabled = false;

    // Zoom out to a high angle first
    const ORBIT_RADIUS = 700;
    const ORBIT_HEIGHT = 550;
    const startAngle = Math.atan2(
        camera.position.x - orbitCenter.x,
        camera.position.z - orbitCenter.z
    );

    // Smooth transition to zoomed-out view
    const zoomTarget = new THREE.Vector3(
        orbitCenter.x + Math.sin(startAngle) * ORBIT_RADIUS,
        ORBIT_HEIGHT,
        orbitCenter.z + Math.cos(startAngle) * ORBIT_RADIUS
    );
    const ZOOM_DURATION = 800;
    const zoomStart = Date.now();
    const zoomFrom = camera.position.clone();
    await new Promise(resolve => {
        function zoomStep() {
            const t = Math.min((Date.now() - zoomStart) / ZOOM_DURATION, 1);
            const e = t * t * (3 - 2 * t); // smoothstep
            camera.position.lerpVectors(zoomFrom, zoomTarget, e);
            camera.lookAt(orbitCenter.x, 40, orbitCenter.z);
            fadeBlockers();
            updateFades(1 / 60);
            renderer.render(scene, camera);
            if (t < 1) requestAnimationFrame(zoomStep);
            else resolve();
        }
        requestAnimationFrame(zoomStep);
    });

    // Generate music if not already available
    if (!musicAudio || musicAudio.paused) {
        const scenePrompt = timelineClips.map(c => c.prompt).join('. ') || 'ambient scene';
        renderFill.style.width = '0%';
        renderLabel.textContent = 'Composing soundtrack';
        renderProgress.style.display = 'block';
        log('Generating soundtrack...', 'music', 'render-status');
        await generateMusic(scenePrompt);
    }

    // Restart music from beginning for clean recording
    if (musicAudio) {
        musicAudio.currentTime = 0;
        musicAudio.muted = false;
        musicAudio.volume = 0.35;
        await musicAudio.play().catch(() => {});
        // Resume AudioContext if suspended (autoplay policy)
        if (musicAudioCtx && musicAudioCtx.state === 'suspended') {
            await musicAudioCtx.resume();
        }
    }

    // Show progress bar
    renderLabel.textContent = 'Recording orbit';
    renderProgress.style.display = 'block';
    renderFill.style.width = '0%';

    // Setup MediaRecorder
    const canvas = renderer.domElement;
    const videoStream = canvas.captureStream(30);
    const stream = new MediaStream([...videoStream.getTracks()]);
    if (musicStreamDest) {
        musicStreamDest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
    }

    const chunks = [];
    const recorder = new MediaRecorder(stream, {
        mimeType: 'video/webm;codecs=vp9',
        videoBitsPerSecond: 8000000
    });
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'kinetik-render.webm';
        a.click();
        URL.revokeObjectURL(url);
        log('Video saved', 'success');
    };

    // Orbit parameters
    const DURATION = 6000;
    const ROTATION_AMOUNT = Math.PI * 1.5;
    let lastFrameTime = performance.now();

    const startTime = Date.now();
    isRecording = true;
    recorder.start();
    log('Recording orbit...', 'render', 'render-status');

    function orbitFrame(now) {
        const rawDt = (now - lastFrameTime) / 1000;
        const dt = Math.min(rawDt, 0.05);
        lastFrameTime = now;
        const elapsed = Date.now() - startTime;
        const t = Math.min(elapsed / DURATION, 1);
        renderFill.style.width = (t * 100) + '%';

        const eased = t < 0.5
            ? 2 * t * t
            : 1 - Math.pow(-2 * t + 2, 2) / 2;
        const angle = startAngle + eased * ROTATION_AMOUNT;
        camera.position.set(
            orbitCenter.x + Math.sin(angle) * ORBIT_RADIUS,
            ORBIT_HEIGHT,
            orbitCenter.z + Math.cos(angle) * ORBIT_RADIUS
        );
        camera.lookAt(orbitCenter.x, 40, orbitCenter.z);

        if (mixer) mixer.update(dt);
        if (!skinnedCharMesh) updateBodyMeshes();
        fadeBlockers();
        updateFades(dt);
        renderer.render(scene, camera);

        if (t < 1) {
            requestAnimationFrame(orbitFrame);
        } else {
            isRecording = false;
            recorder.stop();
            camera.position.copy(origPos);
            controls.target.copy(origTarget);
            controls.enabled = true;
            controls.update();
            cam.locked = false;

            // Stop music after render
            if (musicAudio) { musicAudio.pause(); musicAudio.currentTime = 0; }

            renderProgress.style.display = 'none';
            document.body.classList.remove('rendering');
            log('Render complete', 'success', 'render-status');
        }
    }
    requestAnimationFrame(orbitFrame);
});

// Render mode no longer uses overlay click — renders directly on button press

// ========== .KINETIK EXPORT / IMPORT ==========

// Export removed

// Import .kinetik file
async function handleImportFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = ''; // reset for re-import

    try {
        const text = await file.text();
        const data = JSON.parse(text);

        if (data.format !== 'kinetik') {
            log('Invalid .kinetik file', 'error');
            return;
        }

        log(`Importing "${file.name}"...`, 'system');

        // Dismiss welcome if visible
        document.getElementById('welcome').classList.add('hidden');
        setPanelOpen(true);

        // Rebuild scene from saved data
        const config = {
            scene: {
                type: 'outdoor',
                models: data.scene.models.map(m => ({
                    keyword: m.keyword,
                    category: 6,
                    size: 'medium'
                })),
                ground: { color: data.scene.ground_color },
                lights: data.scene.lights || []
            },
            _characterPath: [[0, 0]]
        };

        // Build scene first
        await buildScene(config);

        // Now reposition models to their saved positions
        let modelIdx = 0;
        for (const obj of sceneObjects) {
            if (obj.userData._isGround) continue;
            if (obj.isLight) continue;
            if (modelIdx < data.scene.models.length) {
                const saved = data.scene.models[modelIdx];
                obj.position.set(saved.position[0], saved.position[1], saved.position[2]);
                obj.rotation.y = saved.rotation || 0;
                obj.scale.setScalar(saved.scale || 1);
                modelIdx++;
            }
        }

        // Load BVH animation
        if (data.bvh) {
            await loadBVH(data.bvh);
            prepareCharacter();
            lastBvhText = data.bvh;

            // Rebuild timeline
            timelineClips = data.timeline.map(t => ({
                prompt: t.prompt,
                duration: t.duration,
                clip: currentClip
            }));
            totalDuration = currentClip.duration;
            renderTimelineClips();
            showTimeline();
            setPlayIcon(true);
            isPlaying = true;
        }

        cam.active = true;
        controls.autoRotate = false;
        // Restore camera
        if (data.camera) {
            camera.position.set(...data.camera.position);
            controls.target.set(...data.camera.target);
            controls.update();
        }

        log(`Imported "${file.name}" successfully`, 'success');

    } catch (err) {
        log(`Import error: ${err.message}`, 'error');
    }
}
document.getElementById('import-file').addEventListener('change', handleImportFile);

// ========== VIDEO ORBIT RECORDING ==========
let recordMode = false, orbitMarker = null;
if (document.getElementById('ed-record')) document.getElementById('ed-record').addEventListener('click', () => {
    if (recordMode) { recordMode = false; if (orbitMarker) { scene.remove(orbitMarker); orbitMarker = null; } renderer.domElement.style.cursor = 'default'; document.getElementById('ed-record').classList.remove('active'); return; }
    recordMode = true; renderer.domElement.style.cursor = 'crosshair'; document.getElementById('ed-record').classList.add('active');
    showEditorInfo('Click where the camera should orbit');
    orbitMarker = new THREE.Mesh(new THREE.SphereGeometry(6,16,12), new THREE.MeshStandardMaterial({color:0x22c55e,emissive:0x16a34a,emissiveIntensity:0.5}));
    orbitMarker.position.y = 3; scene.add(orbitMarker);
});
renderer.domElement.addEventListener('mousemove', (ev) => {
    if (!recordMode || !orbitMarker) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const m2 = new THREE.Vector2(((ev.clientX-rect.left)/rect.width)*2-1,-((ev.clientY-rect.top)/rect.height)*2+1);
    raycaster.setFromCamera(m2, camera);
    const hp = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),0), hp)) orbitMarker.position.set(hp.x,3,hp.z);
});
renderer.domElement.addEventListener('click', async (ev2) => {
    if (!recordMode || !orbitMarker) return;
    const ctr = orbitMarker.position.clone(); ctr.y = 100;
    recordMode = false; scene.remove(orbitMarker); orbitMarker = null;
    renderer.domElement.style.cursor = 'default'; document.getElementById('ed-record').classList.remove('active');
    const dur = Math.max(5, totalDuration/1.5), fps = 30, nF = Math.round(dur*fps);
    document.getElementById('rec-badge').classList.add('visible'); controls.enabled = false;
    const strm = renderer.domElement.captureStream(fps);
    const mt = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
    const mrec = new MediaRecorder(strm, {mimeType:mt, videoBitsPerSecond:8000000});
    const chnks = []; mrec.ondataavailable = e3 => { if (e3.data.size>0) chnks.push(e3.data); };
    isRecording = true;
    mrec.start(); if (mixer) mixer.setTime(0);
    const savC = camera.position.clone(), savT = controls.target.clone();
    for (let f = 0; f < nF; f++) {
        const ang = (f/nF)*Math.PI*2;
        camera.position.set(ctr.x+Math.cos(ang)*500, ctr.y+250, ctr.z+Math.sin(ang)*500);
        camera.lookAt(ctr);
        if (mixer) mixer.update(1/fps);
        if (!skinnedCharMesh) updateBodyMeshes();
        renderer.render(scene, camera);
        await new Promise(r => requestAnimationFrame(r));
    }
    isRecording = false;
    mrec.stop(); document.getElementById('rec-badge').classList.remove('visible');
    camera.position.copy(savC); controls.target.copy(savT); controls.enabled = true; controls.update();
    mrec.onstop = () => {
        const bl = new Blob(chnks,{type:'video/webm'}); const u = URL.createObjectURL(bl);
        const dl = document.createElement('a'); dl.href = u; dl.download = 'kinetik_scene.webm'; dl.click();
        URL.revokeObjectURL(u); log('Video exported!','success');
    };
});

// ========== .KINETIK SAVE ==========
if (document.getElementById('ed-save')) document.getElementById('ed-save').addEventListener('click', () => {
    const d = {
        version:'1.0', name:'My Scene', created:new Date().toISOString(),
        timeline: timelineClips.map(c => ({prompt:c.prompt,duration:c.duration})),
        totalDuration: totalDuration,
        objects: sceneObjects.filter(o => !o.userData._isGround).map(o => ({
            pos:[Math.round(o.position.x),Math.round(o.position.y),Math.round(o.position.z)],
            rot:+(o.rotation.y).toFixed(2), scale:+(o.scale.x).toFixed(2)
        })),
        camera:{pos:[Math.round(camera.position.x),Math.round(camera.position.y),Math.round(camera.position.z)],
            target:[Math.round(controls.target.x),Math.round(controls.target.y),Math.round(controls.target.z)]},
        activity: Array.from(document.querySelectorAll('.log-msg')).slice(-50).map(el => el.textContent)
    };
    const bl = new Blob([JSON.stringify(d,null,2)],{type:'application/json'});
    const aa = document.createElement('a'); aa.href = URL.createObjectURL(bl);
    aa.download = 'my_scene.kinetik'; aa.click(); URL.revokeObjectURL(aa.href);
    log('Saved my_scene.kinetik','success');
});

