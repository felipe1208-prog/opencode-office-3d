import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export const DYNAMIC_SHADOW_LAYER = 2;
export const STATIC_SHADOW_LAYER = 3;

const _color = new THREE.Color();

export function configureTexture(
  texture,
  {
    isColor = true,
    mipmaps = true,
    anisotropy = 4,
    wrapS = THREE.ClampToEdgeWrapping,
    wrapT = THREE.ClampToEdgeWrapping,
  } = {},
) {
  if (!texture) return texture;
  texture.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = wrapS;
  texture.wrapT = wrapT;

  if (mipmaps) {
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
  } else {
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
  }

  texture.anisotropy = anisotropy;
  return texture;
}

export class MaterialPool {
  constructor() {
    this.cache = new Map();
  }

  _key(prefix, opts = {}) {
    const parts = [prefix];
    const keys = Object.keys(opts).sort();
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const v = opts[k];
      if (v === undefined) continue;
      if (v && typeof v === "object" && v.isTexture) {
        parts.push(`${k}:tex(${v.uuid})`);
      } else if (v && typeof v === "object" && v.isColor) {
        parts.push(`${k}:col(${v.getHexString()})`);
      } else {
        parts.push(`${k}:${String(v)}`);
      }
    }
    return parts.join("|");
  }

  getStandard(opts = {}) {
    const normalized = {
      color: opts.color ?? "#FFFFFF",
      roughness: opts.roughness ?? 0.5,
      metalness: opts.metalness ?? 0.0,
      side: opts.side ?? THREE.FrontSide,
      transparent: Boolean(opts.transparent),
      opacity: opts.opacity ?? 1.0,
      depthWrite: opts.depthWrite ?? true,
      flatShading: Boolean(opts.flatShading),
      emissive: opts.emissive ?? "#000000",
      emissiveIntensity: opts.emissiveIntensity ?? 1.0,
      envMapIntensity: opts.envMapIntensity ?? 1.0,
      bumpScale: opts.bumpScale ?? 1.0,
      polygonOffset: Boolean(opts.polygonOffset),
      polygonOffsetFactor: opts.polygonOffsetFactor ?? 0,
      polygonOffsetUnits: opts.polygonOffsetUnits ?? 0,
      map: opts.map || null,
      emissiveMap: opts.emissiveMap || null,
      roughnessMap: opts.roughnessMap || null,
      metalnessMap: opts.metalnessMap || null,
      bumpMap: opts.bumpMap || null,
      normalMap: opts.normalMap || null,
      alphaMap: opts.alphaMap || null,
    };

    const key = this._key("std", {
      ...normalized,
      color: new THREE.Color(normalized.color).getHexString(),
      emissive: new THREE.Color(normalized.emissive).getHexString(),
      map: normalized.map?.uuid || "none",
      emissiveMap: normalized.emissiveMap?.uuid || "none",
      roughnessMap: normalized.roughnessMap?.uuid || "none",
      metalnessMap: normalized.metalnessMap?.uuid || "none",
      bumpMap: normalized.bumpMap?.uuid || "none",
      normalMap: normalized.normalMap?.uuid || "none",
      alphaMap: normalized.alphaMap?.uuid || "none",
    });

    if (this.cache.has(key)) {
      return this.cache.get(key);
    }

    const mat = new THREE.MeshStandardMaterial({
      color: normalized.color,
      roughness: normalized.roughness,
      metalness: normalized.metalness,
      side: normalized.side,
      transparent: normalized.transparent,
      opacity: normalized.opacity,
      depthWrite: normalized.depthWrite,
      flatShading: normalized.flatShading,
      emissive: new THREE.Color(normalized.emissive),
      emissiveIntensity: normalized.emissiveIntensity,
      envMapIntensity: normalized.envMapIntensity,
      bumpScale: normalized.bumpScale,
      polygonOffset: normalized.polygonOffset,
      polygonOffsetFactor: normalized.polygonOffsetFactor,
      polygonOffsetUnits: normalized.polygonOffsetUnits,
      map: normalized.map,
      emissiveMap: normalized.emissiveMap,
      roughnessMap: normalized.roughnessMap,
      metalnessMap: normalized.metalnessMap,
      bumpMap: normalized.bumpMap,
      normalMap: normalized.normalMap,
      alphaMap: normalized.alphaMap,
    });
    this.cache.set(key, mat);
    return mat;
  }

  getBasic(opts = {}) {
    const normalized = {
      color: opts.color ?? "#FFFFFF",
      side: opts.side ?? THREE.FrontSide,
      transparent: Boolean(opts.transparent),
      opacity: opts.opacity ?? 1.0,
      depthWrite: opts.depthWrite ?? true,
      polygonOffset: Boolean(opts.polygonOffset),
      polygonOffsetFactor: opts.polygonOffsetFactor ?? 0,
      polygonOffsetUnits: opts.polygonOffsetUnits ?? 0,
      map: opts.map || null,
      alphaMap: opts.alphaMap || null,
    };
    const key = this._key("basic", {
      ...normalized,
      color: new THREE.Color(normalized.color).getHexString(),
      map: normalized.map?.uuid || "none",
      alphaMap: normalized.alphaMap?.uuid || "none",
    });
    if (this.cache.has(key)) return this.cache.get(key);

    const mat = new THREE.MeshBasicMaterial(normalized);
    this.cache.set(key, mat);
    return mat;
  }

  /**
   * Vidrio físico sin pase extra de `transmission` (evita doble render de escena por frame)
   */
  getGlass(opts = {}) {
    const normalized = {
      color: opts.color ?? "#E6F0F5",
      opacity: opts.opacity ?? 0.24,
      roughness: opts.roughness ?? 0.04,
      metalness: opts.metalness ?? 0.08,
      clearcoat: opts.clearcoat ?? 1.0,
      clearcoatRoughness: opts.clearcoatRoughness ?? 0.03,
      reflectivity: opts.reflectivity ?? 0.92,
      envMapIntensity: opts.envMapIntensity ?? 1.35,
      side: opts.side ?? THREE.DoubleSide,
      depthWrite: opts.depthWrite ?? false,
    };

    const key = this._key("glass", {
      ...normalized,
      color: new THREE.Color(normalized.color).getHexString(),
    });
    if (this.cache.has(key)) return this.cache.get(key);

    const mat = new THREE.MeshPhysicalMaterial({
      color: normalized.color,
      transparent: true,
      opacity: normalized.opacity,
      transmission: 0,
      roughness: normalized.roughness,
      metalness: normalized.metalness,
      clearcoat: normalized.clearcoat,
      clearcoatRoughness: normalized.clearcoatRoughness,
      reflectivity: normalized.reflectivity,
      envMapIntensity: normalized.envMapIntensity,
      side: normalized.side,
      depthWrite: normalized.depthWrite,
    });
    this.cache.set(key, mat);
    return mat;
  }

  getCanonicalForMeshMaterial(mat, { tintable = false } = {}) {
    if (!mat) return null;

    if (mat.isMeshPhysicalMaterial && (mat.transmission > 0 || mat.clearcoat > 0.2)) {
      return this.getGlass({
        color: `#${mat.color.getHexString()}`,
        opacity: mat.transparent ? Math.min(mat.opacity, 0.48) : 0.36,
        roughness: Math.max(0.03, mat.roughness),
        clearcoat: mat.clearcoat ?? 1.0,
        clearcoatRoughness: mat.clearcoatRoughness ?? 0.03,
        envMapIntensity: mat.envMapIntensity ?? 1.35,
        side: mat.side,
      });
    }

    if (mat.isMeshBasicMaterial) {
      return this.getBasic({
        color: tintable ? "#FFFFFF" : `#${mat.color.getHexString()}`,
        side: mat.side,
        transparent: mat.transparent,
        opacity: mat.opacity,
        depthWrite: mat.depthWrite,
        polygonOffset: Boolean(mat.polygonOffset),
        polygonOffsetFactor: mat.polygonOffsetFactor ?? 0,
        polygonOffsetUnits: mat.polygonOffsetUnits ?? 0,
        map: mat.map || null,
        alphaMap: mat.alphaMap || null,
      });
    }

    if (mat.isMeshStandardMaterial) {
      return this.getStandard({
        color: tintable ? "#FFFFFF" : `#${mat.color.getHexString()}`,
        roughness: Math.round((mat.roughness ?? 0.5) * 20) / 20,
        metalness: Math.round((mat.metalness ?? 0.0) * 20) / 20,
        side: mat.side,
        transparent: mat.transparent,
        opacity: mat.opacity,
        depthWrite: mat.depthWrite,
        flatShading: Boolean(mat.flatShading),
        emissive: mat.emissive ? `#${mat.emissive.getHexString()}` : "#000000",
        emissiveIntensity: mat.emissiveIntensity ?? 1.0,
        envMapIntensity: mat.envMapIntensity ?? 1.0,
        bumpScale: mat.bumpScale ?? 1.0,
        polygonOffset: Boolean(mat.polygonOffset),
        polygonOffsetFactor: mat.polygonOffsetFactor ?? 0,
        polygonOffsetUnits: mat.polygonOffsetUnits ?? 0,
        map: mat.map || null,
        emissiveMap: mat.emissiveMap || null,
        roughnessMap: mat.roughnessMap || null,
        metalnessMap: mat.metalnessMap || null,
        bumpMap: mat.bumpMap || null,
        normalMap: mat.normalMap || null,
        alphaMap: mat.alphaMap || null,
      });
    }

    return mat;
  }

  dispose() {
    for (const mat of this.cache.values()) {
      mat.dispose?.();
    }
    this.cache.clear();
  }
}

function normalizeGeometryForMerge(sourceGeo) {
  const geo = sourceGeo.index ? sourceGeo.toNonIndexed() : sourceGeo.clone();

  if (!geo.attributes.normal) {
    geo.computeVertexNormals();
  }

  const posCount = geo.attributes.position.count;
  if (!geo.attributes.uv) {
    geo.setAttribute(
      "uv",
      new THREE.BufferAttribute(new Float32Array(posCount * 2), 2),
    );
  }

  for (const attrName of Object.keys(geo.attributes)) {
    if (attrName !== "position" && attrName !== "normal" && attrName !== "uv") {
      geo.deleteAttribute(attrName);
    }
  }

  return geo;
}

/**
 * Fusiona todas las mallas estáticas de un grupo por material y propiedades de sombra.
 * Preserva materiales marcados como `userData.noMerge = true`.
 */
export function mergeStaticGroupByMaterial(
  rootGroup,
  { namePrefix = "merged", staticShadow = true } = {},
) {
  if (!rootGroup) return [];

  rootGroup.updateMatrixWorld(true);

  const buckets = new Map();
  const meshesToRemove = [];

  rootGroup.traverse((child) => {
    if (!child.isMesh || child.isInstancedMesh || child.isSkinnedMesh) return;
    if (child.userData?.noMerge || child.userData?.noBatch) return;
    if (Array.isArray(child.material)) return;
    if (!child.geometry || !child.material) return;

    const mat = child.material;
    const key = `${mat.uuid}|${child.castShadow ? 1 : 0}|${child.receiveShadow ? 1 : 0}`;
    if (!buckets.has(key)) {
      buckets.set(key, {
        material: mat,
        castShadow: child.castShadow,
        receiveShadow: child.receiveShadow,
        geometries: [],
      });
    }

    const baked = normalizeGeometryForMerge(child.geometry);
    baked.applyMatrix4(child.matrixWorld);
    buckets.get(key).geometries.push(baked);
    meshesToRemove.push(child);
  });

  if (meshesToRemove.length === 0) return [];

  for (const m of meshesToRemove) {
    m.parent?.remove(m);
    if (m.geometry && !m.userData?.sharedGeometry) {
      m.geometry.dispose();
    }
  }

  // Limpiar sub-grupos vacíos tras extraer sus mallas
  for (let i = rootGroup.children.length - 1; i >= 0; i--) {
    const c = rootGroup.children[i];
    if (c.isGroup && c.children.length === 0) {
      rootGroup.remove(c);
    }
  }

  const created = [];
  let idx = 0;

  for (const bucket of buckets.values()) {
    if (bucket.geometries.length === 0) continue;
    const mergedGeo =
      bucket.geometries.length === 1
        ? bucket.geometries[0]
        : mergeGeometries(bucket.geometries, false);

    if (bucket.geometries.length > 1) {
      for (const g of bucket.geometries) g.dispose();
    }
    if (!mergedGeo) continue;

    mergedGeo.computeBoundingBox();
    mergedGeo.computeBoundingSphere();

    const mergedMesh = new THREE.Mesh(mergedGeo, bucket.material);
    mergedMesh.name = `${namePrefix}-${idx++}`;
    mergedMesh.castShadow = bucket.castShadow;
    mergedMesh.receiveShadow = bucket.receiveShadow;
    if (bucket.castShadow && staticShadow) {
      mergedMesh.layers.enable(STATIC_SHADOW_LAYER);
    }

    rootGroup.add(mergedMesh);
    created.push(mergedMesh);
  }

  return created;
}

/**
 * Optimiza mallas estáticas de múltiples zonas:
 * 1) Reemplaza materiales duplicados / transmisivos por materiales compartidos del pool.
 * 2) Agrupa mallas repetidas (misma geometría + material canónico) en InstancedMesh con setColorAt.
 * 3) Fusiona geometrías singulares que comparten exactamente el mismo material y sombra.
 */
export function batchStaticZones(
  scene,
  zoneRoots = [],
  { materialPool, minInstanceCount = 2 } = {},
) {
  if (!scene || !materialPool || zoneRoots.length === 0) {
    return { instancedCount: 0, mergedCount: 0, replacedMeshes: 0 };
  }

  scene.updateMatrixWorld(true);

  const preservedDynamicNodes = [];

  // Desacoplar temporalmente nodos dinámicos hijos (ej. planos de MonitorScreenSystem)
  // manteniendo su transformación mundial exacta en el root de su zona.
  for (const root of zoneRoots) {
    if (!root) continue;
    root.traverse((obj) => {
      if (obj.userData?.noBatch && obj.parent && obj.parent !== root && obj.parent !== scene) {
        preservedDynamicNodes.push({ node: obj, targetParent: root });
      }
    });
  }
  for (const { node, targetParent } of preservedDynamicNodes) {
    targetParent.attach(node);
  }

  scene.updateMatrixWorld(true);

  const collected = [];
  for (const root of zoneRoots) {
    if (!root) continue;
    root.traverse((obj) => {
      if (!obj.isMesh || obj.isInstancedMesh || obj.isSkinnedMesh) return;
      if (obj.userData?.noBatch) return;
      if (Array.isArray(obj.material)) return;
      if (!obj.geometry || !obj.material) return;
      if (!obj.visible) return;

      // No romper materiales dinámicos controlados por NightLightingRig o standby
      const isNightDynamicMat = Boolean(
        obj.userData?.keepMaterialInstance || obj.material?.userData?.keepMaterialInstance,
      );
      const canTint =
        !isNightDynamicMat &&
        !obj.material.vertexColors &&
        !obj.material.emissiveMap &&
        (!obj.material.emissive || obj.material.emissive.getHex() === 0);

      const canonicalMat = isNightDynamicMat
        ? obj.material
        : materialPool.getCanonicalForMeshMaterial(obj.material, {
            tintable: canTint,
          });

      if (!canonicalMat) return;

      collected.push({
        mesh: obj,
        geometry: obj.geometry,
        material: canonicalMat,
        tintable: canTint,
        colorHex: obj.material.color ? obj.material.color.getHex() : 0xffffff,
        castShadow: Boolean(obj.castShadow),
        receiveShadow: Boolean(obj.receiveShadow),
        worldMatrix: obj.matrixWorld.clone(),
      });
    });
  }

  // Agrupar por (geometry.uuid + canonicalMat.uuid + castShadow + receiveShadow) para InstancedMesh
  const instanceBuckets = new Map();
  for (const item of collected) {
    const key = `${item.geometry.uuid}|${item.material.uuid}|${item.castShadow ? 1 : 0}|${item.receiveShadow ? 1 : 0}`;
    if (!instanceBuckets.has(key)) {
      instanceBuckets.set(key, []);
    }
    instanceBuckets.get(key).push(item);
  }

  const batchGroup = new THREE.Group();
  batchGroup.name = "static-optimized-batches";

  const singletonCandidates = [];
  let instancedCount = 0;
  let mergedCount = 0;
  let replacedMeshes = 0;

  for (const items of instanceBuckets.values()) {
    if (items.length >= minInstanceCount) {
      const first = items[0];
      const instMesh = new THREE.InstancedMesh(
        first.geometry,
        first.material,
        items.length,
      );
      instMesh.name = `instanced-batch-${instancedCount}`;
      instMesh.castShadow = first.castShadow;
      instMesh.receiveShadow = first.receiveShadow;
      if (first.castShadow) {
        instMesh.layers.enable(STATIC_SHADOW_LAYER);
      }

      let needsColorAttr = false;
      const firstColor = first.colorHex;
      for (let i = 0; i < items.length; i++) {
        if (items[i].tintable && items[i].colorHex !== 0xffffff) {
          needsColorAttr = true;
          break;
        }
        if (items[i].colorHex !== firstColor) {
          needsColorAttr = true;
          break;
        }
      }

      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        instMesh.setMatrixAt(i, it.worldMatrix);
        if (needsColorAttr) {
          _color.setHex(it.tintable ? it.colorHex : 0xffffff);
          instMesh.setColorAt(i, _color);
        }
        it.mesh.parent?.remove(it.mesh);
        replacedMeshes++;
      }

      instMesh.instanceMatrix.needsUpdate = true;
      if (instMesh.instanceColor) {
        instMesh.instanceColor.needsUpdate = true;
      }
      instMesh.computeBoundingBox();
      instMesh.computeBoundingSphere();

      batchGroup.add(instMesh);
      instancedCount++;
    } else {
      singletonCandidates.push(items[0]);
    }
  }

  // Segunda pasada sobre singulares: asignar material no-tintable exacto y fusionar por material
  const mergeBuckets = new Map();
  for (const item of singletonCandidates) {
    const exactMat = item.tintable
      ? materialPool.getCanonicalForMeshMaterial(item.mesh.material, {
          tintable: false,
        })
      : item.material;

    const key = `${exactMat.uuid}|${item.castShadow ? 1 : 0}|${item.receiveShadow ? 1 : 0}`;
    if (!mergeBuckets.has(key)) {
      mergeBuckets.set(key, {
        material: exactMat,
        castShadow: item.castShadow,
        receiveShadow: item.receiveShadow,
        items: [],
      });
    }
    mergeBuckets.get(key).items.push(item);
  }

  for (const bucket of mergeBuckets.values()) {
    if (bucket.items.length >= 2) {
      const bakedGeos = [];
      for (const item of bucket.items) {
        const baked = normalizeGeometryForMerge(item.geometry);
        baked.applyMatrix4(item.worldMatrix);
        bakedGeos.push(baked);
        item.mesh.parent?.remove(item.mesh);
        replacedMeshes++;
      }
      const mergedGeo = mergeGeometries(bakedGeos, false);
      for (const g of bakedGeos) g.dispose();
      if (!mergedGeo) continue;

      mergedGeo.computeBoundingBox();
      mergedGeo.computeBoundingSphere();

      const mergedMesh = new THREE.Mesh(mergedGeo, bucket.material);
      mergedMesh.name = `merged-static-batch-${mergedCount++}`;
      mergedMesh.castShadow = bucket.castShadow;
      mergedMesh.receiveShadow = bucket.receiveShadow;
      if (bucket.castShadow) {
        mergedMesh.layers.enable(STATIC_SHADOW_LAYER);
      }
      batchGroup.add(mergedMesh);
    } else {
      const single = bucket.items[0];
      single.mesh.material = bucket.material;
      if (single.castShadow) {
        single.mesh.layers.enable(STATIC_SHADOW_LAYER);
      }
    }
  }

  scene.add(batchGroup);

  return {
    batchGroup,
    instancedCount,
    mergedCount,
    replacedMeshes,
  };
}
