// Outdoor world building: real-world sizes, layout along the character's route,
// and scenery (trees, grass, a trail) that covers the whole route and grows with it.
// Units are centimeters, the same as the BVH skeleton (the character is ~175 tall).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------- sizes ----------

// Real-world height in cm for each library model (models/<file>.glb), plus
// how wide its footprint is relative to its height and how it should face the route.
// face: 'path' turns its front toward the route, 'along' runs it parallel, 'any' is random.
export const ASSETS = {
    barrel: [90, 0.7, 'any'], basketball_hoop: [305, 0.5, 'path'], bathtub: [60, 2.6, 'any'],
    bed: [60, 3.2, 'any'], bench: [85, 1.9, 'path'], bicycle: [100, 1.7, 'along'],
    bird_bath: [80, 0.6, 'any'], boat: [120, 3.5, 'along'], bookshelf: [190, 0.5, 'path'],
    bridge: [300, 3, 'along'], building: [1100, 0.8, 'path'], bus_stop_shelter: [260, 1.6, 'path'],
    bush: [90, 1.3, 'any'], campfire: [50, 2, 'any'], car: [145, 3.1, 'along'],
    castle: [2500, 1.2, 'path'], chair: [90, 0.6, 'path'], computer_desk: [75, 1.8, 'path'],
    crane: [120, 0.8, 'any'], dog_house: [100, 1.1, 'path'], dumpster: [150, 1.3, 'along'],
    fence_post: [110, 0.3, 'any'], filing_cabinet: [130, 0.4, 'path'], fire_escape_ladder: [400, 0.4, 'path'],
    forklift: [210, 1.2, 'along'], fountain: [180, 1.6, 'any'], gazebo: [350, 1.2, 'any'],
    grave_tombstone: [90, 0.7, 'path'], hay_bale: [100, 1.4, 'any'], hot_dog_cart: [200, 1, 'path'],
    house: [750, 1.4, 'path'], hydrant: [80, 0.5, 'any'], ice_cream_truck: [280, 2.2, 'along'],
    lamp: [55, 0.6, 'any'], log: [50, 4, 'along'], mailbox: [120, 0.4, 'path'],
    motorcycle: [115, 1.8, 'along'], office_chair: [110, 0.6, 'path'], oven: [90, 0.8, 'path'],
    park_fountain: [200, 1.8, 'any'], phone_booth: [240, 0.45, 'path'], piano: [100, 1.5, 'path'],
    picnic_table: [75, 2.4, 'along'], police_car: [150, 3.1, 'along'], pumpkin: [35, 1.2, 'any'],
    punching_bag: [180, 0.3, 'any'], refrigerator: [180, 0.45, 'path'], rock: [60, 1.6, 'any'],
    satellite_dish: [150, 0.9, 'any'], shop: [600, 1.3, 'path'], shopping_cart: [100, 0.9, 'any'],
    soccer_goal: [244, 3, 'path'], sofa: [85, 2.3, 'path'], statue: [250, 0.5, 'path'],
    stop_sign: [230, 0.3, 'path'], street_lamp: [450, 0.15, 'any'], streetlight: [500, 0.15, 'any'],
    swing_set: [240, 1.5, 'along'], table: [75, 1.6, 'any'], taxi_cab: [150, 3.1, 'along'],
    television: [70, 1.5, 'path'], tent: [150, 1.6, 'path'], toilet: [75, 0.6, 'path'],
    tractor: [280, 1.4, 'along'], traffic_cone: [70, 0.5, 'any'], trash_can: [100, 0.6, 'any'],
    treadmill: [140, 1.4, 'along'], tree: [700, 0.6, 'any'], truck: [300, 2.6, 'along'],
    vending_machine: [185, 0.5, 'path'], water_tower: [1500, 0.5, 'any'], wheelbarrow: [70, 2, 'along'],
    windmill: [1200, 0.6, 'any'],
};

// Keywords the procedural vegetation handles, with a height range in cm.
const VEGETATION = [
    [/\b(pine|spruce|fir|conifer|evergreen|cedar)\b/, 'conifer', 650, 1100],
    [/\b(palm)\b/, 'palm', 600, 900],
    [/\b(tree|oak|maple|willow|birch|elm|cypress|orchard)\b/, 'broadleaf', 550, 900],
    [/\b(bush|shrub|hedge|fern)\b/, 'bush', 60, 120],
    [/\b(rock|boulder|stone)\b/, 'rock', 35, 110],
];
export function vegetationFor(keyword) {
    const kw = keyword.toLowerCase();
    for (const [re, kind, lo, hi] of VEGETATION) if (re.test(kw)) return { kind, lo, hi };
    return null;
}

// Height for any keyword: vegetation range midpoint, library table, or a guess from the size label.
export function realHeight(keyword, file, sizeLabel, rand = Math.random) {
    const veg = vegetationFor(keyword);
    if (veg) return veg.lo + rand() * (veg.hi - veg.lo);
    if (file && ASSETS[file]) return ASSETS[file][0];
    return { large: 600, medium: 180, small: 80 }[sizeLabel] || 150;
}

function assetInfo(m, resolveFile) {
    const file = resolveFile(m.keyword);
    const veg = vegetationFor(m.keyword);
    const [h, aspect, face] = (file && ASSETS[file]) || [null, 0.8, 'any'];
    return { file, veg, height: h, aspect: veg ? 0.6 : aspect, face: veg ? 'any' : face };
}

// ---------- settings ----------

const SETTING_RE = [
    ['indoor', /\b(room|kitchen|bedroom|office|gym|hall|indoor|inside|studio|library|apartment interior)\b/],
    ['urban', /\b(city|street|downtown|urban|town|alley|road|avenue|neighborhood|plaza|square)\b/],
    ['beach', /\b(beach|shore|coast|ocean|sea|island)\b/],
    ['desert', /\b(desert|canyon|dune|wasteland)\b/],
    ['snow', /\b(snow|winter|arctic|ice|frozen|tundra)\b/],
    ['forest', /\b(forest|woods|jungle|woodland|grove|camp|campsite|trail)\b/],
    ['park', /\b(park|garden|meadow|field|lawn|playground|backyard|farm|countryside|graveyard|cemetery)\b/],
];
export const SETTINGS = ['park', 'forest', 'urban', 'beach', 'desert', 'snow', 'indoor', 'plain'];
export function settingFor(prompt, given, sceneType) {
    if (sceneType === 'indoor') return 'indoor';
    if (SETTINGS.includes(given)) return given;
    const p = (prompt || '').toLowerCase();
    for (const [name, re] of SETTING_RE) if (re.test(p)) return name;
    return 'plain';
}

// Ground and trail colors per setting.
export const LOOK = {
    park:   { ground: ['#6f9a45', '#5d8a3a', '#86a957'], trail: '#c8b48c', trailW: 130, grass: 1, flowers: 1 },
    forest: { ground: ['#4f6b33', '#5b4a32', '#3f5a2c'], trail: '#7b5f42', trailW: 100, grass: 0.8, flowers: 0.15 },
    urban:  { ground: ['#8c8a85', '#7d7b77', '#97948e'], trail: '#b9b6ae', trailW: 220, grass: 0, flowers: 0 },
    beach:  { ground: ['#e3d3a5', '#d8c592', '#ecdcb3'], trail: '#cdb98a', trailW: 0, grass: 0.12, flowers: 0 },
    desert: { ground: ['#d6b383', '#c9a26f', '#dcc095'], trail: '#c4a273', trailW: 0, grass: 0.06, flowers: 0 },
    snow:   { ground: ['#eef2f6', '#e2e8ef', '#f6f8fa'], trail: '#d3dbe4', trailW: 110, grass: 0, flowers: 0 },
    plain:  { ground: ['#7c9a52', '#6b8a46', '#8aa760'], trail: '#b9a57e', trailW: 110, grass: 0.7, flowers: 0.4 },
};

// ---------- the route ----------

// A smoothed polyline along the character's ground path. pointAt(s) also
// works before the start and after the end by extending the end directions,
// so scenery can run past where the character stops.
export function makePathFrame(charPath) {
    const raw = (charPath && charPath.length ? charPath : [[0, 94, 0]]).map(p => [p[0], p[2] || 0]);
    // Resample every 40 cm, then smooth sideways wobble from the walk cycle.
    const pts = [raw[0]];
    for (const p of raw) {
        const q = pts[pts.length - 1];
        const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
        const n = Math.floor(d / 40);
        for (let k = 1; k <= n; k++) pts.push([q[0] + (p[0] - q[0]) * k / n, q[1] + (p[1] - q[1]) * k / n]);
    }
    const sm = pts.map((_, i) => {
        let x = 0, z = 0, c = 0;
        for (let j = Math.max(0, i - 3); j <= Math.min(pts.length - 1, i + 3); j++) { x += pts[j][0]; z += pts[j][1]; c++; }
        return [x / c, z / c];
    });
    sm[0] = pts[0]; sm[sm.length - 1] = pts[pts.length - 1];
    const S = [0];
    for (let i = 1; i < sm.length; i++) S.push(S[i - 1] + Math.hypot(sm[i][0] - sm[i - 1][0], sm[i][1] - sm[i - 1][1]));
    const L = S[S.length - 1];

    const dirOver = (from, to) => {
        const dx = to[0] - from[0], dz = to[1] - from[1], d = Math.hypot(dx, dz);
        return d > 1 ? [dx / d, dz / d] : null;
    };
    const idxAt = s => { let i = 1; while (i < S.length - 1 && S[i] < s) i++; return i; };
    const startDir = (L > 60 && dirOver(sm[0], sm[idxAt(Math.min(L, 150))])) || [0, 1];
    const endDir = (L > 60 && dirOver(sm[idxAt(Math.max(0, L - 150)) - 1], sm[sm.length - 1])) || startDir;

    function pointAt(s) {
        let x, z, t;
        if (s <= 0 || sm.length < 2) {
            t = startDir; x = sm[0][0] + t[0] * s; z = sm[0][1] + t[1] * s;
        } else if (s >= L) {
            t = endDir; x = sm[sm.length - 1][0] + t[0] * (s - L); z = sm[sm.length - 1][1] + t[1] * (s - L);
        } else {
            const i = idxAt(s), a = sm[i - 1], b = sm[i], u = (s - S[i - 1]) / ((S[i] - S[i - 1]) || 1);
            x = a[0] + (b[0] - a[0]) * u; z = a[1] + (b[1] - a[1]) * u;
            t = dirOver(a, b) || startDir;
        }
        return { x, z, tx: t[0], tz: t[1], nx: -t[1], nz: t[0] }; // n points to the left of travel
    }

    // Distance from (x, z) to the route, including its extensions out to `pad`.
    function distanceTo(x, z, pad = 1500) {
        let best = Infinity;
        for (let s = -pad; s <= L + pad; s += 30) {
            const p = pointAt(s);
            best = Math.min(best, Math.hypot(x - p.x, z - p.z));
        }
        return best;
    }
    return { pointAt, distanceTo, length: L };
}

// Small seeded PRNG so a scene is stable while it is being extended.
export function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// ---------- layout of the scene's chosen objects ----------

// Bands are distances from the route's center line to the object's center.
function bandFor(info, setting) {
    const h = info.height || 150;
    const r = Math.max(30, h * info.aspect * 0.5);
    if (info.veg && (info.veg.kind === 'broadleaf' || info.veg.kind === 'conifer' || info.veg.kind === 'palm')) return [320, 700];
    if (info.veg) return [120 + r, 260 + r];
    if (h >= 1000) return [900 + r, 1400 + r];
    if (h >= 500) return setting === 'urban' ? [380 + r, 460 + r] : [650 + r, 1000 + r];
    if (info.face === 'along' && h > 100) return setting === 'urban' ? [190, 230] : [260 + r, 420 + r];
    if (h >= 300) return [110, 130]; // lamps sit at the trail edge
    if (h >= 130) return [260 + r, 480 + r];
    return [95 + r, 150 + r];
}

const REPEATS = {
    park: [['bench', 650, 'path'], ['street_lamp', 520, 'any'], ['trash_can', 1400, 'any']],
    urban: [['streetlight', 600, 'any'], ['hydrant', 1500, 'any'], ['trash_can', 1100, 'any']],
};
const BUILDINGS = ['building', 'house', 'shop', 'castle'];

// Lay the chosen objects out along the route.
// Returns [{keyword, file, position:[x,0,z], scale:heightCm, rotationY, footprint}].
export function layoutAlongRoute(models, { frame, setting, resolveFile, rand }) {
    const placed = [];
    const L = frame.length;
    const fits = (x, z, r) => placed.every(p => Math.hypot(p.position[0] - x, p.position[2] - z) > p.footprint + r);

    function put(m, info, s, side, band, heightOverride) {
        const h = heightOverride || (info.veg ? info.veg.lo + rand() * (info.veg.hi - info.veg.lo) : realHeight(m.keyword, info.file, m.size, rand));
        const r = Math.max(25, h * info.aspect * 0.5);
        for (let attempt = 0; attempt < 10; attempt++) {
            const ss = s + attempt * 70 * (attempt % 2 ? 1 : -1);
            const d = band[0] + rand() * (band[1] - band[0]) + attempt * 30;
            const p = frame.pointAt(ss);
            const x = p.x + p.nx * d * side, z = p.z + p.nz * d * side;
            if (!fits(x, z, r)) continue;
            // Face the route, run along it, or turn at random.
            const toPath = Math.atan2(-p.nx * side, -p.nz * side);
            const rotationY = info.face === 'path' ? toPath
                : info.face === 'along' ? Math.atan2(p.tx, p.tz) + (rand() < 0.5 ? 0 : Math.PI)
                : rand() * Math.PI * 2;
            const o = { ...m, file: info.file, position: [x, 0, z], scale: h, rotationY, footprint: r };
            placed.push(o);
            return o;
        }
        return null;
    }

    // Unique objects first, spread along the route and alternating sides.
    const uniques = models.map(m => ({ m, info: assetInfo(m, resolveFile) }));
    uniques.sort((a, b) => (b.info.height || 0) - (a.info.height || 0));
    const from = -150, to = L + 450;
    uniques.forEach(({ m, info }, i) => {
        const s = from + (to - from) * ((i + 0.5) / uniques.length) + (rand() - 0.5) * 120;
        put(m, info, s, i % 2 ? 1 : -1, bandFor(info, setting));
    });

    // Street furniture repeated at a steady rhythm makes a route read as designed.
    for (const [file, every, face] of REPEATS[setting] || []) {
        const info = { file, veg: null, height: ASSETS[file][0], aspect: ASSETS[file][1], face };
        let side = rand() < 0.5 ? 1 : -1;
        for (let s = -400 + rand() * every; s < L + 1200; s += every) {
            put({ keyword: file.replace('_', ' '), category: 5, size: 'small', _isFill: true }, info, s, side, bandFor(info, setting));
            side = -side;
        }
    }

    // In a city, buildings line both sides of the street.
    if (setting === 'urban') {
        const kinds = uniques.filter(u => BUILDINGS.includes(u.info.file)).map(u => u.m);
        const pool = kinds.length ? kinds : [{ keyword: 'building', category: 8, size: 'large' }, { keyword: 'shop', category: 8, size: 'large' }];
        for (const side of [-1, 1]) {
            let k = side === 1 ? 1 : 0;
            for (let s = -900; s < L + 1600; s += 620 + rand() * 120) {
                const m = pool[k++ % pool.length];
                const info = assetInfo(m, resolveFile);
                const h = (info.height || 1200) * (0.7 + rand() * 0.6);
                put({ ...m, _isFill: true }, info, s, side, [430 + h * info.aspect * 0.5, 470 + h * info.aspect * 0.5], h);
            }
        }
    }
    return placed;
}

// ---------- vegetation ----------

const _mats = new Map();
function mat(color, flat = true) {
    const key = color + flat;
    if (!_mats.has(key)) _mats.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: flat }));
    return _mats.get(key);
}
const LEAF = ['#4f8a34', '#5e9a3c', '#3f7a2e', '#6aa444', '#76a94a'];
const CONIFER = ['#2f5a2a', '#3a6a30', '#28502a'];
const SNOWY = ['#dfe7ea', '#cfd9dd'];

function blob(r, detail = 0) {
    const g = new THREE.IcosahedronGeometry(r, detail);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const k = 0.85 + Math.random() * 0.3;
        pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.85, pos.getZ(i) * k);
    }
    g.computeVertexNormals();
    return g;
}

export function makeVegetation(kind, h, setting, rand = Math.random) {
    const g = new THREE.Group();
    const add = (geo, color, x, y, z) => { const m = new THREE.Mesh(geo, mat(color)); m.position.set(x, y, z); g.add(m); };
    const pick = arr => arr[Math.floor(rand() * arr.length)];
    if (kind === 'broadleaf') {
        add(new THREE.CylinderGeometry(h * 0.022, h * 0.036, h * 0.55, 7), '#6b4a2e', 0, h * 0.27, 0);
        const c = pick(LEAF), n = 4 + Math.floor(rand() * 3);
        for (let i = 0; i < n; i++) {
            const a = rand() * Math.PI * 2, d = h * (0.06 + rand() * 0.14);
            add(blob(h * (0.16 + rand() * 0.09), 1), i === 0 ? c : pick(LEAF), Math.cos(a) * d, h * (0.6 + rand() * 0.22), Math.sin(a) * d);
        }
    } else if (kind === 'conifer') {
        add(new THREE.CylinderGeometry(h * 0.018, h * 0.03, h * 0.3, 6), '#5a3d26', 0, h * 0.15, 0);
        const c = setting === 'snow' && rand() < 0.5 ? pick(SNOWY) : pick(CONIFER);
        for (let i = 0; i < 4; i++) {
            const cone = new THREE.ConeGeometry(h * (0.2 - i * 0.04), h * 0.3, 8);
            add(cone, i % 2 ? c : pick(CONIFER), 0, h * (0.3 + i * 0.17), 0);
        }
    } else if (kind === 'palm') {
        const trunk = new THREE.CylinderGeometry(h * 0.025, h * 0.04, h * 0.85, 6);
        trunk.translate(0, h * 0.425, 0); trunk.rotateZ(0.12);
        add(trunk, '#8a6a46', 0, 0, 0);
        for (let i = 0; i < 6; i++) {
            const leaf = new THREE.ConeGeometry(h * 0.05, h * 0.4, 4);
            leaf.rotateZ(Math.PI / 2 + 0.35); leaf.translate(h * 0.2, 0, 0); leaf.rotateY(i * Math.PI / 3);
            add(leaf, pick(LEAF), -h * 0.1, h * 0.86, 0);
        }
    } else if (kind === 'bush') {
        const c = pick(LEAF);
        for (let i = 0; i < 3; i++) add(blob(h * (0.38 + rand() * 0.15)), i ? pick(LEAF) : c, (rand() - 0.5) * h * 0.6, h * 0.35, (rand() - 0.5) * h * 0.6);
    } else if (kind === 'rock') {
        const geo = new THREE.DodecahedronGeometry(h * 0.6, 0);
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) * (0.8 + rand() * 0.5), pos.getY(i) * 0.6, pos.getZ(i) * (0.8 + rand() * 0.5));
        geo.computeVertexNormals();
        add(geo, rand() < 0.5 ? '#8b8781' : '#9a958d', 0, h * 0.2, 0);
    }
    g.userData._veg = kind;
    return g;
}

// Scenery mix per setting: [kind, min height, max height, near, far, grid step, chance].
const FILL = {
    park:   [['broadleaf', 500, 850, 480, 1900, 280, 0.2], ['conifer', 600, 950, 850, 1900, 340, 0.1], ['bush', 50, 110, 170, 900, 200, 0.16], ['rock', 30, 70, 170, 900, 300, 0.06]],
    forest: [['conifer', 650, 1150, 230, 1900, 160, 0.6], ['broadleaf', 550, 900, 260, 1900, 220, 0.25], ['bush', 60, 120, 120, 900, 140, 0.3], ['rock', 35, 110, 130, 1000, 220, 0.15]],
    plain:  [['broadleaf', 500, 850, 400, 1800, 280, 0.25], ['bush', 50, 100, 160, 900, 200, 0.15], ['rock', 30, 80, 160, 900, 300, 0.1]],
    snow:   [['conifer', 650, 1100, 260, 1900, 200, 0.45], ['rock', 40, 110, 150, 1000, 260, 0.12]],
    beach:  [['palm', 600, 900, 350, 1500, 320, 0.22], ['rock', 40, 120, 180, 1200, 300, 0.12]],
    desert: [['rock', 50, 180, 200, 1600, 300, 0.22], ['bush', 40, 80, 200, 1200, 340, 0.08]],
    urban:  [['broadleaf', 450, 650, 280, 300, 900, 0.8]],
};

// Scenery between route positions s0 and s1. Near objects stay separate so the
// camera can fade them; far ones are merged into a few meshes.
export function makeFill(frame, setting, s0, s1, { rand, groundY, avoid }) {
    const near = [], farParts = [];
    const spots = [...avoid];
    const clear = (x, z, r) => spots.every(([ax, az, ar]) => Math.hypot(ax - x, az - z) > ar + r);
    for (const [kind, lo, hi, dMin, dMax, step, chance] of FILL[setting] || []) {
        for (let s = s0; s < s1; s += step) {
            for (let d = dMin; d <= dMax; d += step) {
                for (const side of [-1, 1]) {
                    // Thin out with distance so the foreground reads clearly.
                    if (rand() > chance * (d < 500 ? 1 : 0.85)) continue;
                    const ss = s + (rand() - 0.5) * step, dd = d + (rand() - 0.5) * step * 0.8;
                    const p = frame.pointAt(ss);
                    const x = p.x + p.nx * dd * side, z = p.z + p.nz * dd * side;
                    if (frame.distanceTo(x, z) < dMin * 0.85) continue; // keep curves clear
                    const h = lo + rand() * (hi - lo);
                    const r = kind === 'bush' || kind === 'rock' ? h * 0.5 : h * 0.12;
                    if (!clear(x, z, r)) continue;
                    spots.push([x, z, r]);
                    const obj = makeVegetation(kind, h, setting, rand);
                    obj.position.set(x, groundY(x, z) - 2, z);
                    obj.rotation.y = rand() * Math.PI * 2;
                    if (dd < 750) near.push(obj); else farParts.push(obj);
                }
            }
        }
    }
    return { near, far: mergeStatic(farParts), spots };
}

// Merge many small groups into one mesh per material.
export function mergeStatic(objects) {
    const byMat = new Map();
    for (const o of objects) {
        o.updateMatrixWorld(true);
        o.traverse(c => {
            if (!c.isMesh) return;
            const g = c.geometry.index ? c.geometry.toNonIndexed() : c.geometry.clone();
            g.applyMatrix4(c.matrixWorld);
            for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
            if (!byMat.has(c.material)) byMat.set(c.material, []);
            byMat.get(c.material).push(g);
        });
    }
    const group = new THREE.Group();
    for (const [m, geos] of byMat) {
        const mesh = new THREE.Mesh(mergeGeometries(geos), m);
        mesh.castShadow = true; mesh.receiveShadow = true;
        group.add(mesh);
        geos.forEach(g => g.dispose());
    }
    group.userData._mergedFill = true;
    return group;
}

// ---------- ground cover and trail ----------

// Grass tufts and flowers as instanced meshes, denser near the trail.
export function makeGroundCover(frame, setting, s0, s1, { rand, groundY, avoid }) {
    const look = LOOK[setting] || LOOK.plain;
    const group = new THREE.Group();
    if (!look.grass && !look.flowers) return group;
    const half = (look.trailW || 0) / 2;

    const tuft = new THREE.ConeGeometry(2.2, 14, 3, 1, true);
    tuft.translate(0, 7, 0);
    const blades = [0, 1, 2].map(i => tuft.clone().rotateZ((i - 1) * 0.35).rotateY(i * 2.1).translate((i - 1) * 2, 0, 0));
    const tuftGeo = mergeGeometries(blades);
    const flowerGeo = new THREE.IcosahedronGeometry(2.6, 0).translate(0, 11, 0);

    const grassN = Math.round(((s1 - s0) / 100) * 140 * look.grass);
    const flowerN = Math.round(((s1 - s0) / 100) * 16 * look.flowers);
    const grass = new THREE.InstancedMesh(tuftGeo, new THREE.MeshStandardMaterial({ roughness: 1, side: THREE.DoubleSide }), grassN);
    const flowers = new THREE.InstancedMesh(flowerGeo, new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: true }), flowerN);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    const col = new THREE.Color();
    const base = new THREE.Color(look.ground[0]);
    const PETALS = ['#f2d14b', '#f4f1ea', '#e98bb0', '#b48be0', '#f08a4b'];
    const blocked = (x, z) => avoid.some(([ax, az, ar]) => Math.hypot(ax - x, az - z) < ar * 0.8);

    function scatter(mesh, n, near, far, colorFn, scaleFn) {
        let k = 0;
        for (let tries = 0; k < n && tries < n * 4; tries++) {
            const s = s0 + rand() * (s1 - s0);
            // Squared falloff puts most tufts near the trail.
            const d = near + Math.pow(rand(), 1.8) * (far - near);
            const side = rand() < 0.5 ? -1 : 1;
            const p = frame.pointAt(s);
            const x = p.x + p.nx * d * side, z = p.z + p.nz * d * side;
            if (blocked(x, z)) continue;
            e.set(0, rand() * Math.PI * 2, 0); q.setFromEuler(e);
            const k3 = scaleFn();
            sc.set(k3, k3 * (0.8 + rand() * 0.6), k3);
            m4.compose(v.set(x, groundY(x, z) - 0.5, z), q, sc);
            mesh.setMatrixAt(k, m4);
            mesh.setColorAt(k, colorFn());
            k++;
        }
        mesh.count = k;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    if (grassN) {
        scatter(grass, grassN, half + 8, 1100,
            () => col.copy(base).offsetHSL((rand() - 0.5) * 0.04, 0.05 + rand() * 0.1, (rand() - 0.3) * 0.12).clone(),
            () => 0.7 + rand() * 0.9);
        group.add(grass);
    }
    if (flowerN) {
        scatter(flowers, flowerN, half + 15, 700, () => col.set(PETALS[Math.floor(rand() * PETALS.length)]).clone(), () => 0.8 + rand() * 0.6);
        group.add(flowers);
    }
    group.userData._cover = true;
    return group;
}

function trailTexture(color) {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 256;
    const g = c.getContext('2d');
    const base = new THREE.Color(color);
    for (let y = 0; y < 256; y++) {
        for (let x = 0; x < 64; x++) {
            const edge = Math.min(x, 63 - x) / 10; // soft sides
            const a = Math.min(1, edge) * (0.85 + Math.random() * 0.15);
            const k = 1 + (Math.random() - 0.5) * 0.16;
            g.fillStyle = `rgba(${base.r * 255 * k | 0},${base.g * 255 * k | 0},${base.b * 255 * k | 0},${a.toFixed(3)})`;
            g.fillRect(x, y, 1, 1);
        }
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapT = THREE.RepeatWrapping;
    return t;
}

// A walkable strip along the route (gravel in a park, dirt in a forest, sidewalk in a city).
export function makeTrail(frame, setting, s0, s1, groundY) {
    const look = LOOK[setting] || LOOK.plain;
    if (!look.trailW) return null;
    const w = look.trailW / 2, step = 25;
    const pos = [], uv = [], idx = [];
    let row = 0;
    for (let s = s0; s <= s1; s += step, row++) {
        const p = frame.pointAt(s);
        for (const side of [-1, 1]) {
            const x = p.x + p.nx * w * side, z = p.z + p.nz * w * side;
            pos.push(x, groundY(x, z) + 0.7, z);
            uv.push(side < 0 ? 0 : 1, (s - s0) / 250);
        }
        if (row) { const a = (row - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        map: trailTexture(look.trail), transparent: true, depthWrite: false, roughness: 0.95, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -2,
    }));
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    mesh.userData._trail = true;
    return mesh;
}

// Soft mottled ground texture: low-frequency patches and fine grain, no grid.
export function groundTexture(setting, fallback) {
    const look = LOOK[setting];
    const colors = look ? look.ground : [fallback, fallback, fallback];
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const g = c.getContext('2d');
    g.fillStyle = colors[0];
    g.fillRect(0, 0, 512, 512);
    // Big soft patches, drawn wrapped so the texture tiles.
    for (let i = 0; i < 70; i++) {
        const x = Math.random() * 512, y = Math.random() * 512, r = 30 + Math.random() * 90;
        const col = new THREE.Color(colors[1 + (i % 2)]);
        for (const [ox, oy] of [[0, 0], [-512, 0], [512, 0], [0, -512], [0, 512]]) {
            const grad = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
            grad.addColorStop(0, `rgba(${col.r * 255 | 0},${col.g * 255 | 0},${col.b * 255 | 0},0.35)`);
            grad.addColorStop(1, `rgba(${col.r * 255 | 0},${col.g * 255 | 0},${col.b * 255 | 0},0)`);
            g.fillStyle = grad;
            g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
        }
    }
    // Fine grain.
    const img = g.getImageData(0, 0, 512, 512), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
        const k = (Math.random() - 0.5) * 14;
        d[i] += k; d[i + 1] += k; d[i + 2] += k * 0.8;
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t;
}
