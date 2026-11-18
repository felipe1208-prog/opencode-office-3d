import * as THREE from "three";
import { configureTexture } from "./SceneOptimizer.js";

let _cache = null;
const _signCache = new Map();
const _artCache = new Map();

function createCanvas(w, h) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext("2d") };
}

function makeNoiseValue(x, y, seed = 1) {
  const n = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453;
  return n - Math.floor(n);
}

/**
 * Genera y cachea en memoria todas las texturas PBR potencia-de-dos (PO2)
 * compartidas entre suelo, alfombras, muros, escritorios, metales, vidrio y Contact AO.
 */
export function getProceduralPBRTextures() {
  if (_cache) return _cache;

  // 1. PARQUET DE ROBLE NÓRDICO CÁLIDO (1024x1024 PO2): Color + Roughness + Bump
  const oakSize = 1024;
  const oakCol = createCanvas(oakSize, oakSize);
  const oakRough = createCanvas(oakSize, oakSize);
  const oakBump = createCanvas(oakSize, oakSize);

  const plankH = 32;
  const plankW = 256;

  oakCol.ctx.fillStyle = "#C3915E";
  oakCol.ctx.fillRect(0, 0, oakSize, oakSize);
  oakRough.ctx.fillStyle = "rgb(118, 118, 118)";
  oakRough.ctx.fillRect(0, 0, oakSize, oakSize);
  oakBump.ctx.fillStyle = "rgb(185, 185, 185)";
  oakBump.ctx.fillRect(0, 0, oakSize, oakSize);

  for (let y = 0; y < oakSize; y += plankH) {
    const rowIdx = y / plankH;
    const offsetX = rowIdx % 2 === 0 ? 0 : plankW / 2;
    for (let x = -plankW; x < oakSize + plankW; x += plankW) {
      const px = x + offsetX;
      const hash = makeNoiseValue(px * 0.03, y * 0.07, 3);
      const toneShift = (hash - 0.5) * 24;

      const r = Math.min(255, Math.max(0, Math.round(195 + toneShift)));
      const g = Math.min(255, Math.max(0, Math.round(145 + toneShift * 0.78)));
      const b = Math.min(255, Math.max(0, Math.round(94 + toneShift * 0.55)));
      oakCol.ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      oakCol.ctx.fillRect(px, y, plankW - 1.5, plankH - 1.5);

      // Roughness por listón (satinado nórdico entre 0.34 y 0.50 -> 88..128)
      const roughVal = Math.round(96 + hash * 36);
      oakRough.ctx.fillStyle = `rgb(${roughVal}, ${roughVal}, ${roughVal})`;
      oakRough.ctx.fillRect(px, y, plankW - 1.5, plankH - 1.5);

      // Altura base del listón
      const bumpBase = Math.round(178 + hash * 22);
      oakBump.ctx.fillStyle = `rgb(${bumpBase}, ${bumpBase}, ${bumpBase})`;
      oakBump.ctx.fillRect(px, y, plankW - 1.5, plankH - 1.5);

      // Vetas orgánicas de roble
      for (let s = 0; s < 5; s++) {
        const sy = y + 4 + s * 5.5 + (makeNoiseValue(px, s, 9) - 0.5) * 2;
        const grainAlpha = 0.045 + makeNoiseValue(px + s, y, 5) * 0.06;
        oakCol.ctx.fillStyle =
          s % 2 === 0
            ? `rgba(88, 48, 20, ${grainAlpha})`
            : `rgba(232, 198, 152, ${grainAlpha * 0.8})`;
        oakCol.ctx.fillRect(px + 2, sy, plankW - 5, 1.2);

        oakRough.ctx.fillStyle = s % 2 === 0 ? "rgba(155,155,155,0.22)" : "rgba(80,80,80,0.18)";
        oakRough.ctx.fillRect(px + 2, sy, plankW - 5, 1.2);

        oakBump.ctx.fillStyle = s % 2 === 0 ? "rgba(135,135,135,0.28)" : "rgba(215,215,215,0.2)";
        oakBump.ctx.fillRect(px + 2, sy, plankW - 5, 1.2);
      }

      // Junta vertical entre testas
      oakCol.ctx.fillStyle = "rgba(62, 34, 14, 0.52)";
      oakCol.ctx.fillRect(px + plankW - 1.5, y, 1.5, plankH);
      oakRough.ctx.fillStyle = "rgb(218, 218, 218)";
      oakRough.ctx.fillRect(px + plankW - 1.5, y, 1.5, plankH);
      oakBump.ctx.fillStyle = "rgb(60, 60, 60)";
      oakBump.ctx.fillRect(px + plankW - 1.5, y, 1.5, plankH);
    }

    // Junta horizontal entre hileras
    oakCol.ctx.fillStyle = "rgba(58, 31, 13, 0.52)";
    oakCol.ctx.fillRect(0, y, oakSize, 1.4);
    oakRough.ctx.fillStyle = "rgb(220, 220, 220)";
    oakRough.ctx.fillRect(0, y, oakSize, 1.4);
    oakBump.ctx.fillStyle = "rgb(55, 55, 55)";
    oakBump.ctx.fillRect(0, y, oakSize, 1.4);
  }

  const oakColorMap = configureTexture(new THREE.CanvasTexture(oakCol.canvas), {
    isColor: true,
    mipmaps: true,
    anisotropy: 4,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
  });
  oakColorMap.repeat.set(0.25, 0.25);

  const oakRoughnessMap = configureTexture(new THREE.CanvasTexture(oakRough.canvas), {
    isColor: false,
    mipmaps: true,
    anisotropy: 4,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
  });
  oakRoughnessMap.repeat.set(0.25, 0.25);

  const oakBumpMap = configureTexture(new THREE.CanvasTexture(oakBump.canvas), {
    isColor: false,
    mipmaps: true,
    anisotropy: 4,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
  });
  oakBumpMap.repeat.set(0.25, 0.25);

  // 2. TRAMA TEXTIL DE ALFOMBRAS Y TAPICERÍA (512x512 PO2)
  const carpSize = 512;
  const carpCol = createCanvas(carpSize, carpSize);
  const carpRough = createCanvas(carpSize, carpSize);
  const carpBump = createCanvas(carpSize, carpSize);

  carpCol.ctx.fillStyle = "#F1EFEA";
  carpCol.ctx.fillRect(0, 0, carpSize, carpSize);
  carpRough.ctx.fillStyle = "rgb(218, 218, 218)";
  carpRough.ctx.fillRect(0, 0, carpSize, carpSize);
  carpBump.ctx.fillStyle = "rgb(128, 128, 128)";
  carpBump.ctx.fillRect(0, 0, carpSize, carpSize);

  for (let x = 0; x < carpSize; x += 4) {
    for (let y = 0; y < carpSize; y += 4) {
      const n = makeNoiseValue(x, y, 17);
      const isWarp = ((x >> 2) + (y >> 2)) % 2 === 0;
      const shade = isWarp ? 245 - n * 16 : 216 - n * 22;
      carpCol.ctx.fillStyle = `rgb(${shade}, ${shade - 1}, ${shade - 3})`;
      carpCol.ctx.fillRect(x, y, 3, 3);

      const rVal = isWarp ? Math.round(206 + n * 24) : Math.round(228 + n * 20);
      carpRough.ctx.fillStyle = `rgb(${rVal}, ${rVal}, ${rVal})`;
      carpRough.ctx.fillRect(x, y, 3, 3);

      const bVal = isWarp ? Math.round(168 + n * 35) : Math.round(92 + n * 30);
      carpBump.ctx.fillStyle = `rgb(${bVal}, ${bVal}, ${bVal})`;
      carpBump.ctx.fillRect(x, y, 3, 3);
    }
  }

  const carpetColorMap = configureTexture(new THREE.CanvasTexture(carpCol.canvas), {
    isColor: true,
    mipmaps: true,
    anisotropy: 4,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
  });
  carpetColorMap.repeat.set(3, 3);

  const carpetRoughnessMap = configureTexture(new THREE.CanvasTexture(carpRough.canvas), {
    isColor: false,
    mipmaps: true,
    anisotropy: 4,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
  });
  carpetRoughnessMap.repeat.set(3, 3);

  const carpetBumpMap = configureTexture(new THREE.CanvasTexture(carpBump.canvas), {
    isColor: false,
    mipmaps: true,
    anisotropy: 4,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
  });
  carpetBumpMap.repeat.set(3, 3);

  // 3. PINTURA ARQUITECTÓNICA / ESTUCO SUAVE EN MUROS (512x512 PO2)
  const stSize = 512;
  const stRough = createCanvas(stSize, stSize);
  const stBump = createCanvas(stSize, stSize);

  stRough.ctx.fillStyle = "rgb(228, 228, 228)";
  stRough.ctx.fillRect(0, 0, stSize, stSize);
  stBump.ctx.fillStyle = "rgb(128, 128, 128)";
  stBump.ctx.fillRect(0, 0, stSize, stSize);

  for (let x = 0; x < stSize; x += 4) {
    for (let y = 0; y < stSize; y += 4) {
      const n = makeNoiseValue(x * 0.5, y * 0.5, 29);
      const rVal = Math.round(216 + n * 28);
      const bVal = Math.round(114 + n * 32);
      stRough.ctx.fillStyle = `rgb(${rVal}, ${rVal}, ${rVal})`;
      stRough.ctx.fillRect(x, y, 4, 4);
      stBump.ctx.fillStyle = `rgb(${bVal}, ${bVal}, ${bVal})`;
      stBump.ctx.fillRect(x, y, 4, 4);
    }
  }

  const stuccoRoughnessMap = configureTexture(new THREE.CanvasTexture(stRough.canvas), {
    isColor: false,
    mipmaps: true,
    anisotropy: 4,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
  });
  stuccoRoughnessMap.repeat.set(2, 1);

  const stuccoBumpMap = configureTexture(new THREE.CanvasTexture(stBump.canvas), {
    isColor: false,
    mipmaps: true,
    anisotropy: 4,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
  });
  stuccoBumpMap.repeat.set(2, 1);

  // 4. MADERA SATINADA PARA ESCRITORIOS, MESAS Y ESTANTES (256x256 PO2)
  const dwSize = 256;
  const dwCol = createCanvas(dwSize, dwSize);
  const dwRough = createCanvas(dwSize, dwSize);
  const dwBump = createCanvas(dwSize, dwSize);

  dwCol.ctx.fillStyle = "#E8DFD3"; // Base neutra cálida para tintado exacto
  dwCol.ctx.fillRect(0, 0, dwSize, dwSize);
  dwRough.ctx.fillStyle = "rgb(115, 115, 115)";
  dwRough.ctx.fillRect(0, 0, dwSize, dwSize);
  dwBump.ctx.fillStyle = "rgb(132, 132, 132)";
  dwBump.ctx.fillRect(0, 0, dwSize, dwSize);

  for (let y = 0; y < dwSize; y += 2) {
    const wave = Math.sin(y * 0.08) * 0.5 + 0.5;
    const n = makeNoiseValue(1, y, 41);
    const alpha = 0.03 + wave * 0.045 + n * 0.03;
    dwCol.ctx.fillStyle = `rgba(92, 56, 28, ${alpha})`;
    dwCol.ctx.fillRect(0, y, dwSize, 2);

    const rVal = Math.round(98 + wave * 32 + n * 18);
    dwRough.ctx.fillStyle = `rgb(${rVal}, ${rVal}, ${rVal})`;
    dwRough.ctx.fillRect(0, y, dwSize, 2);

    const bVal = Math.round(118 + wave * 24 + n * 14);
    dwBump.ctx.fillStyle = `rgb(${bVal}, ${bVal}, ${bVal})`;
    dwBump.ctx.fillRect(0, y, dwSize, 2);
  }

  const deskWoodColorMap = configureTexture(new THREE.CanvasTexture(dwCol.canvas), {
    isColor: true,
    mipmaps: true,
    anisotropy: 4,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
  });
  const deskWoodRoughnessMap = configureTexture(new THREE.CanvasTexture(dwRough.canvas), {
    isColor: false,
    mipmaps: true,
    anisotropy: 4,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
  });
  const deskWoodBumpMap = configureTexture(new THREE.CanvasTexture(dwBump.canvas), {
    isColor: false,
    mipmaps: true,
    anisotropy: 4,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
  });

  // 5. MICRO-GRANO MATE (ESCRITORIOS LAMINADOS, CERÁMICA, PAPELERÍA) (256x256 PO2)
  const mmSize = 256;
  const mmRough = createCanvas(mmSize, mmSize);
  const mmBump = createCanvas(mmSize, mmSize);

  for (let x = 0; x < mmSize; x += 4) {
    for (let y = 0; y < mmSize; y += 4) {
      const n = makeNoiseValue(x, y, 53);
      const rVal = Math.round(168 + n * 38);
      const bVal = Math.round(120 + n * 24);
      mmRough.ctx.fillStyle = `rgb(${rVal}, ${rVal}, ${rVal})`;
      mmRough.ctx.fillRect(x, y, 4, 4);
      mmBump.ctx.fillStyle = `rgb(${bVal}, ${bVal}, ${bVal})`;
      mmBump.ctx.fillRect(x, y, 4, 4);
    }
  }

  const matteMicroRoughnessMap = configureTexture(new THREE.CanvasTexture(mmRough.canvas), {
    isColor: false,
    mipmaps: true,
    anisotropy: 4,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
  });
  const matteMicroBumpMap = configureTexture(new THREE.CanvasTexture(mmBump.canvas), {
    isColor: false,
    mipmaps: true,
    anisotropy: 4,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
  });

  // 6. METAL CEPILLADO ARQUITECTÓNICO (256x256 PO2)
  const bmSize = 256;
  const bmRough = createCanvas(bmSize, bmSize);
  const bmBump = createCanvas(bmSize, bmSize);

  for (let y = 0; y < bmSize; y++) {
    const n = makeNoiseValue(13, y, 67);
    const rVal = Math.round(78 + n * 44);
    const bVal = Math.round(115 + n * 28);
    bmRough.ctx.fillStyle = `rgb(${rVal}, ${rVal}, ${rVal})`;
    bmRough.ctx.fillRect(0, y, bmSize, 1);
    bmBump.ctx.fillStyle = `rgb(${bVal}, ${bVal}, ${bVal})`;
    bmBump.ctx.fillRect(0, y, bmSize, 1);
  }

  const brushedMetalRoughnessMap = configureTexture(new THREE.CanvasTexture(bmRough.canvas), {
    isColor: false,
    mipmaps: true,
    anisotropy: 4,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
  });
  const brushedMetalBumpMap = configureTexture(new THREE.CanvasTexture(bmBump.canvas), {
    isColor: false,
    mipmaps: true,
    anisotropy: 4,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
  });

  // 7. BANDA ESMERILADA SUTIL PARA VIDRIO ARQUITECTÓNICO (256x256 PO2)
  const frSize = 256;
  const fr = createCanvas(frSize, frSize);
  fr.ctx.clearRect(0, 0, frSize, frSize);
  const frGrad = fr.ctx.createLinearGradient(0, 0, 0, frSize);
  frGrad.addColorStop(0.0, "rgba(232, 240, 245, 0.0)");
  frGrad.addColorStop(0.12, "rgba(235, 242, 247, 0.28)");
  frGrad.addColorStop(0.5, "rgba(242, 247, 250, 0.34)");
  frGrad.addColorStop(0.88, "rgba(235, 242, 247, 0.28)");
  frGrad.addColorStop(1.0, "rgba(232, 240, 245, 0.0)");
  fr.ctx.fillStyle = frGrad;
  fr.ctx.fillRect(0, 0, frSize, frSize);
  // Finas líneas arquitectónicas en los bordes de la banda
  fr.ctx.fillStyle = "rgba(255, 255, 255, 0.36)";
  fr.ctx.fillRect(0, 24, frSize, 2);
  fr.ctx.fillRect(0, frSize - 26, frSize, 2);

  const frostedBandTexture = configureTexture(new THREE.CanvasTexture(fr.canvas), {
    isColor: true,
    mipmaps: true,
    anisotropy: 4,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
  });

  // 8. TEXTURA DE SOMBRA DE CONTACTO / AMBIENT OCCLUSION (256x256 PO2)
  const aoSize = 256;
  const ao = createCanvas(aoSize, aoSize);
  const aoCtx = ao.ctx;
  aoCtx.clearRect(0, 0, aoSize, aoSize);

  const radial = aoCtx.createRadialGradient(
    aoSize / 2,
    aoSize / 2,
    aoSize * 0.08,
    aoSize / 2,
    aoSize / 2,
    aoSize * 0.49,
  );
  radial.addColorStop(0.0, "rgba(18, 13, 10, 0.42)");
  radial.addColorStop(0.45, "rgba(18, 13, 10, 0.24)");
  radial.addColorStop(0.78, "rgba(18, 13, 10, 0.08)");
  radial.addColorStop(1.0, "rgba(18, 13, 10, 0.0)");
  aoCtx.fillStyle = radial;
  aoCtx.fillRect(0, 0, aoSize, aoSize);

  const contactShadowTexture = configureTexture(new THREE.CanvasTexture(ao.canvas), {
    isColor: true,
    mipmaps: true,
    anisotropy: 2,
  });

  const contactShadowGeo = new THREE.PlaneGeometry(1, 1);
  const contactShadowMat = new THREE.MeshBasicMaterial({
    map: contactShadowTexture,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });

  // 9. HALO ÁMBAR SUAVE PARA LÁMPARAS PRÁCTICAS EN NOCHE/TARDE (128x128 PO2)
  const haloSize = 128;
  const halo = createCanvas(haloSize, haloSize);
  const hGrad = halo.ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  hGrad.addColorStop(0.0, "rgba(253, 224, 138, 0.75)");
  hGrad.addColorStop(0.35, "rgba(251, 191, 36, 0.34)");
  hGrad.addColorStop(0.75, "rgba(245, 158, 11, 0.09)");
  hGrad.addColorStop(1.0, "rgba(245, 158, 11, 0.0)");
  halo.ctx.fillStyle = hGrad;
  halo.ctx.fillRect(0, 0, haloSize, haloSize);

  const warmHaloTexture = configureTexture(new THREE.CanvasTexture(halo.canvas), {
    isColor: true,
    mipmaps: false,
    anisotropy: 2,
  });

  // 10. HALO TRASERO SUAVE (BIAS GLOW) PARA TV DE REUNIONES (256x128 PO2)
  const bias = createCanvas(256, 128);
  const bGrad = bias.ctx.createRadialGradient(128, 64, 12, 128, 64, 124);
  bGrad.addColorStop(0.0, "rgba(186, 230, 253, 0.58)");
  bGrad.addColorStop(0.45, "rgba(125, 211, 252, 0.24)");
  bGrad.addColorStop(1.0, "rgba(56, 189, 248, 0.0)");
  bias.ctx.fillStyle = bGrad;
  bias.ctx.fillRect(0, 0, 256, 128);

  const tvBiasGlowTexture = configureTexture(new THREE.CanvasTexture(bias.canvas), {
    isColor: true,
    mipmaps: false,
    anisotropy: 2,
  });

  _cache = {
    oakColorMap,
    oakRoughnessMap,
    oakBumpMap,
    carpetColorMap,
    carpetRoughnessMap,
    carpetBumpMap,
    stuccoRoughnessMap,
    stuccoBumpMap,
    deskWoodColorMap,
    deskWoodRoughnessMap,
    deskWoodBumpMap,
    matteMicroRoughnessMap,
    matteMicroBumpMap,
    brushedMetalRoughnessMap,
    brushedMetalBumpMap,
    frostedBandTexture,
    contactShadowTexture,
    contactShadowGeo,
    contactShadowMat,
    warmHaloTexture,
    tvBiasGlowTexture,
  };

  return _cache;
}

/**
 * Crea una calcomanía ligera de Contact AO usando geometría y material compartidos
 * para que `batchStaticZones` las fusione automáticamente sin sumar draw calls.
 */
export function createContactShadowDecal(x, z, width, depth, y = 0.0135) {
  const { contactShadowGeo, contactShadowMat } = getProceduralPBRTextures();
  const decal = new THREE.Mesh(contactShadowGeo, contactShadowMat);
  decal.name = "contact-ao-decal";
  decal.rotation.x = -Math.PI / 2;
  decal.scale.set(width, depth, 1);
  decal.position.set(x, y, z);
  decal.castShadow = false;
  decal.receiveShadow = false;
  decal.userData.sharedGeometry = true;
  return decal;
}

/**
 * Paleta curada nórdica cálida para variación tonal con `setColorAt`
 */
export const NORDIC_PALETTE = {
  books: [
    "#8C4A32",
    "#3E566E",
    "#4B6B56",
    "#B68A56",
    "#353B45",
    "#9E7B66",
    "#576675",
    "#C8B9A6",
  ],
  folders: ["#2F3640", "#4A5A6A", "#68584A", "#4A6054"],
  mugs: ["#F2EDE4", "#C97A57", "#6B8276", "#586E82", "#D8C8B4"],
  planters: ["#ECE6DC", "#DDD4C6", "#C8BFB0", "#B9A995"],
  chairsDev: ["#333944", "#3B424E", "#2C313A"],
  chairsMeeting: ["#D6CFC4", "#CEC6BA", "#DFD9CF"],
};

/**
 * Textura PO2 cacheada de señalética arquitectónica minimalista (512x128)
 */
export function createZoneSignPlaque(title, subtitle = "", width = 0.82, height = 0.2) {
  const cacheKey = `${title}|${subtitle}`;
  let tex = _signCache.get(cacheKey);
  if (!tex) {
    const { canvas, ctx } = createCanvas(512, 128);
    ctx.fillStyle = "#232730";
    ctx.fillRect(0, 0, 512, 128);

    // Borde sutil aluminio/roble
    ctx.strokeStyle = "#B68A56";
    ctx.lineWidth = 4;
    ctx.strokeRect(6, 6, 500, 116);

    ctx.fillStyle = "#F3EDE2";
    ctx.font = "600 34px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(title.toUpperCase(), 256, subtitle ? 60 : 76);

    if (subtitle) {
      ctx.fillStyle = "#B6AFA4";
      ctx.font = "500 20px monospace";
      ctx.fillText(subtitle.toUpperCase(), 256, 98);
    }

    tex = configureTexture(new THREE.CanvasTexture(canvas), {
      isColor: true,
      mipmaps: true,
      anisotropy: 4,
    });
    _signCache.set(cacheKey, tex);
  }

  const plaque = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, 0.014),
    new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.42,
      metalness: 0.15,
    }),
  );
  plaque.castShadow = false;
  return plaque;
}

/**
 * Cuadro geométrico nórdico minimalista cacheado (256x256 PO2)
 */
export function createMinimalWallArt(variant = 0, width = 1.25, height = 0.85) {
  let artTex = _artCache.get(variant);
  if (!artTex) {
    const { canvas, ctx } = createCanvas(256, 256);
    ctx.fillStyle = "#F4EFE6";
    ctx.fillRect(0, 0, 256, 256);

    // Paspartú sutil
    ctx.strokeStyle = "#DED5C7";
    ctx.lineWidth = 8;
    ctx.strokeRect(12, 12, 232, 232);

    if (variant % 3 === 0) {
      // Composición arco terracota + círculo salvia
      ctx.fillStyle = "#C97A57";
      ctx.beginPath();
      ctx.arc(105, 165, 62, Math.PI, 0);
      ctx.lineTo(167, 215);
      ctx.lineTo(43, 215);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = "#5B7466";
      ctx.beginPath();
      ctx.arc(168, 86, 36, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "#2F3640";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(50, 56);
      ctx.lineTo(198, 200);
      ctx.stroke();
    } else if (variant % 3 === 1) {
      // Líneas topográficas nórdicas en azul pizarra y arena
      ctx.fillStyle = "#3E566E";
      ctx.fillRect(36, 44, 92, 168);
      ctx.fillStyle = "#C9A276";
      ctx.beginPath();
      ctx.arc(166, 130, 52, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#F4EFE6";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(128, 128, 72, 0.2, 2.5);
      ctx.stroke();
    } else {
      // Bloques abstractos roble & carbón
      ctx.fillStyle = "#2E3540";
      ctx.fillRect(42, 42, 80, 80);
      ctx.fillStyle = "#B68A56";
      ctx.fillRect(102, 92, 112, 118);
      ctx.fillStyle = "#6B8276";
      ctx.beginPath();
      ctx.arc(82, 174, 34, 0, Math.PI * 2);
      ctx.fill();
    }

    artTex = configureTexture(new THREE.CanvasTexture(canvas), {
      isColor: true,
      mipmaps: true,
      anisotropy: 4,
    });
    _artCache.set(variant, artTex);
  }

  const pbr = getProceduralPBRTextures();
  const group = new THREE.Group();

  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, 0.032),
    new THREE.MeshStandardMaterial({
      color: "#8B5E38",
      map: pbr.deskWoodColorMap,
      roughnessMap: pbr.deskWoodRoughnessMap,
      roughness: 0.55,
      metalness: 0.04,
    }),
  );
  frame.castShadow = true;

  const canvasMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width - 0.08, height - 0.08),
    new THREE.MeshStandardMaterial({
      map: artTex,
      roughness: 0.78,
      metalness: 0.02,
    }),
  );
  canvasMesh.position.z = 0.017;

  group.add(frame, canvasMesh);
  return group;
}

/**
 * Portátil minimalista cerrado o semiabierto (bajo conteo de polígonos)
 */
export function createLaptopProp(x, y, z, rotY = 0, isOpen = true) {
  const pbr = getProceduralPBRTextures();
  const group = new THREE.Group();
  group.position.set(x, y, z);
  group.rotation.y = rotY;

  const chassisMat = new THREE.MeshStandardMaterial({
    color: "#B4BAC4",
    roughnessMap: pbr.brushedMetalRoughnessMap,
    roughness: 0.35,
    metalness: 0.78,
  });

  const base = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.01, 0.21), chassisMat);
  base.position.y = 0.005;
  base.castShadow = true;
  group.add(base);

  if (isOpen) {
    const kb = new THREE.Mesh(
      new THREE.PlaneGeometry(0.25, 0.11),
      new THREE.MeshStandardMaterial({ color: "#1E232C", roughness: 0.75 }),
    );
    kb.rotation.x = -Math.PI / 2;
    kb.position.set(0, 0.0105, -0.025);
    group.add(kb);

    const lidPivot = new THREE.Group();
    lidPivot.position.set(0, 0.01, -0.102);
    lidPivot.rotation.x = -0.32;

    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.19, 0.007), chassisMat);
    lid.position.set(0, 0.095, 0);
    lid.castShadow = true;

    const display = new THREE.Mesh(
      new THREE.PlaneGeometry(0.275, 0.165),
      new THREE.MeshStandardMaterial({
        color: "#1B2538",
        emissive: new THREE.Color("#293B5C"),
        emissiveIntensity: 0.24,
        roughness: 0.16,
      }),
    );
    display.position.set(0, 0.095, 0.004);
    lidPivot.add(lid, display);
    group.add(lidPivot);
  } else {
    const closedLid = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.007, 0.21), chassisMat);
    closedLid.position.y = 0.013;
    closedLid.castShadow = true;
    group.add(closedLid);
  }

  return group;
}

/**
 * Lámpara articulada de escritorio estilo estudio nórdico con soporte para NightLightingRig
 */
export function createDeskLamp(x, y, z, rotY = 0, nightRig = null, scale = 1.0) {
  const pbr = getProceduralPBRTextures();
  const group = new THREE.Group();
  group.position.set(x, y, z);
  group.rotation.y = rotY;
  if (scale !== 1.0) group.scale.setScalar(scale);

  const metalMat = new THREE.MeshStandardMaterial({
    color: "#22262E",
    roughnessMap: pbr.brushedMetalRoughnessMap,
    roughness: 0.38,
    metalness: 0.78,
  });
  const brassMat = new THREE.MeshStandardMaterial({
    color: "#C49A6C",
    roughness: 0.34,
    metalness: 0.82,
  });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.072, 0.016, 16), metalMat);
  base.position.y = 0.008;
  base.castShadow = true;

  const lowerArm = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.18, 8), metalMat);
  lowerArm.position.set(0, 0.095, -0.015);
  lowerArm.rotation.x = -0.22;
  lowerArm.castShadow = true;

  const joint = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 10), brassMat);
  joint.position.set(0, 0.18, -0.035);

  const upperArm = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.16, 8), metalMat);
  upperArm.position.set(0, 0.23, 0.018);
  upperArm.rotation.x = 0.75;
  upperArm.castShadow = true;

  const shadeMat = new THREE.MeshStandardMaterial({
    color: "#2F3640",
    roughness: 0.45,
    metalness: 0.35,
  });
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.062, 0.085, 16), shadeMat);
  shade.position.set(0, 0.265, 0.075);
  shade.rotation.x = 0.35;
  shade.castShadow = true;

  // Difusor cálido interior registrado en NightLightingRig para encender halo ámbar de noche
  const diffuserMat = new THREE.MeshStandardMaterial({
    color: "#FFF4D6",
    roughness: 0.4,
  });
  if (nightRig) {
    nightRig.registerLampShadeMaterial(diffuserMat);
  }
  const diffuser = new THREE.Mesh(new THREE.CircleGeometry(0.054, 16), diffuserMat);
  diffuser.position.set(0, 0.228, 0.088);
  diffuser.rotation.x = Math.PI / 2 + 0.35;
  diffuser.userData.noBatch = true;
  diffuser.userData.keepMaterialInstance = true;

  group.add(base, lowerArm, joint, upperArm, shade, diffuser);
  return group;
}

export function disposeProceduralPBRTextures() {
  if (_cache) {
    Object.values(_cache).forEach((v) => {
      if (v && typeof v.dispose === "function") v.dispose();
    });
    _cache = null;
  }
  for (const tex of _signCache.values()) tex.dispose();
  _signCache.clear();
  for (const tex of _artCache.values()) tex.dispose();
  _artCache.clear();
}
