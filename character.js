// Skinned human for Kimodo BVH clips.
//
// The GLB's joints carry the SOMA bone names and its inverse bind matrices are
// already expressed in the BVH rest frames, so we skip the GLB's own joint
// nodes and bind the mesh straight to the bones BVHLoader created.
//
//   const char = await createCharacter(rootBone, THREE, GLTFLoader);
//   characterGroup.add(char.object);   // same parent as the BVH root bone
//   ...
//   char.dispose();

const cache = new Map(); // url -> Promise<{ geometry, material, jointNames, inverses, footClearance }>

function loadTemplate(url, THREE, GLTFLoader) {
    if (cache.has(url)) return cache.get(url);
    const p = new GLTFLoader().loadAsync(url).then((gltf) => {
        let src = null;
        gltf.scene.traverse((o) => { if (!src && o.isSkinnedMesh) src = o; });
        if (!src) throw new Error(`${url}: no skinned mesh`);
        const material = src.material;
        material.vertexColors = !!src.geometry.getAttribute('color');
        // GLB is in meters, BVH is in centimeters.
        const toCm = new THREE.Matrix4().makeScale(100, 100, 100);
        const inverses = src.skeleton.boneInverses.map((m) => toCm.clone().multiply(m));
        // Height of the lowest foot joint above the sole in the rest pose (cm),
        // so the app can ground the mesh on the sole instead of the joint.
        src.geometry.computeBoundingBox();
        const soleY = src.geometry.boundingBox.min.y;
        let toeY = Infinity;
        src.skeleton.bones.forEach((b, i) => {
            if (/^(Left|Right)(Foot|ToeBase)$/.test(b.name)) {
                const y = src.skeleton.boneInverses[i].clone().invert().elements[13];
                toeY = Math.min(toeY, y);
            }
        });
        // Rigid parts (hair, props) parented to a joint in the GLB.
        const attachments = [];
        src.skeleton.bones.forEach((b) => {
            b.children.forEach((c) => { if (!c.isBone) attachments.push({ joint: b.name, object: c }); });
        });
        return {
            attachments,
            geometry: src.geometry,
            material,
            jointNames: src.skeleton.bones.map((b) => b.name),
            inverses,
            footClearance: (toeY - soleY) * 100,
        };
    });
    cache.set(url, p);
    return p;
}

/**
 * @param {THREE.Bone} bvhRootBone  root bone from BVHLoader (result.skeleton.bones[0])
 * @param {object} THREE            the three module
 * @param {Function} GLTFLoader     GLTFLoader class
 * @param {object} [opts]
 * @param {string} [opts.url]       character GLB
 * @returns {Promise<{object: THREE.SkinnedMesh, footClearance: number, dispose: Function}>}
 */
export async function createCharacter(bvhRootBone, THREE, GLTFLoader, opts = {}) {
    const url = opts.url || 'assets/character/character.glb';
    const t = await loadTemplate(url, THREE, GLTFLoader);

    const byName = new Map();
    bvhRootBone.traverse((o) => { if (o.isBone) byName.set(o.name, o); });

    const bones = [];
    const inverses = [];
    t.jointNames.forEach((name, i) => {
        const bone = byName.get(name);
        if (!bone) throw new Error(`BVH has no bone "${name}"`);
        bones.push(bone);
        inverses.push(t.inverses[i]);
    });

    const mesh = new THREE.SkinnedMesh(t.geometry, t.material);
    mesh.name = 'Character';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false; // bounds come from the rest pose, not the animation
    mesh.bind(new THREE.Skeleton(bones, inverses), new THREE.Matrix4());

    const attached = t.attachments.map(({ joint, object }) => {
        const o = object.clone();
        o.position.multiplyScalar(100); // joint space is meters in the GLB, cm on BVH bones
        o.scale.multiplyScalar(100);
        o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.frustumCulled = false; } });
        byName.get(joint)?.add(o);
        return o;
    });

    return {
        object: mesh,
        footClearance: t.footClearance,
        dispose() {
            mesh.removeFromParent();
            attached.forEach((o) => o.removeFromParent());
            mesh.skeleton.dispose();
            // geometry and material are cached and shared between clips
        },
    };
}
