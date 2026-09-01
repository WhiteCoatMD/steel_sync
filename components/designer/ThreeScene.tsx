'use client';

import { useMemo, useEffect, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, AdaptiveDpr } from '@react-three/drei';
import * as THREE from 'three';
import { useDesignerStore } from '@/lib/store/designerStore';
import { buildBuilding, type BuildingResult } from '@/lib/building/buildBuilding';
import type { Opening, BuildingConfig, BuildingDimensions } from '@/lib/building/types';
import { buildRoofProfile } from '@/lib/building/roof';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const WALL_THICKNESS = 0.08;
const ROOF_OVERHANG = 0.5;
const RAFTER_T = 0.20;
const GIRT_SPACING = 4;
const PURLIN_SPACING = 3;
const RIBS_PER_FOOT = 1.33; // 9" rib spacing, standard R-panel
const WAINSCOT_HEIGHT = 3; // standard 36" wainscot band

/**
 * Painted steel, not bare metal.
 *
 * The panels used metalness 0.45 with no environment map in the scene, and a
 * metallic surface takes almost all of its brightness from what it reflects —
 * with nothing to reflect, it renders dark. That, not the lighting, is why the
 * whole building looked dim (owner, 2026-08-30).
 *
 * Low metalness is also the truer description: these panels are painted, so
 * they are mostly diffuse with a slight sheen, nothing like chrome.
 */
const STEEL_METALNESS = 0.15;
const STEEL_ROUGHNESS = 0.55;

// ─── Procedural Panel Normal Maps ────────────────────────────
// Generates a tangent-space normal map with sinusoidal corrugation.
// dir='v' → ribs run vertically (normal varies in U/X)
// dir='h' → ribs run horizontally (normal varies in V/Y)

function makePanelNormalMap(dir: 'v' | 'h'): THREE.DataTexture {
  const SZ = 512; // higher res for sharp lines
  const data = new Uint8Array(SZ * SZ * 4);
  const A = 1.8; // strong but thin rib
  const ribWidth = 0.04; // 4% of spacing = very thin line (like real R-panel seams)

  for (let row = 0; row < SZ; row++) {
    for (let col = 0; col < SZ; col++) {
      const t = dir === 'v' ? col / SZ : row / SZ;
      // Distance from nearest rib center (at t=0.5 in each tile)
      const distFromRib = Math.abs(t - 0.5);
      let dh = 0;
      if (distFromRib < ribWidth) {
        // Sharp V-groove: linear slope through the rib
        const s = (t - 0.5) / ribWidth; // -1 to 1 across rib
        dh = -A * s;
      }
      const nx = dir === 'v' ? -dh : 0;
      const ny = dir === 'h' ? -dh : 0;
      const nz = 1.0;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      const idx = (row * SZ + col) * 4;
      data[idx]     = Math.round(((nx / len) + 1) * 127.5);
      data[idx + 1] = Math.round(((ny / len) + 1) * 127.5);
      data[idx + 2] = Math.round(((nz / len) + 1) * 127.5);
      data[idx + 3] = 255;
    }
  }

  const tex = new THREE.DataTexture(data, SZ, SZ, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

// Lazy singletons — created on first use (avoids SSR issues with THREE)
let _panelNormalV: THREE.DataTexture | null = null;
let _panelNormalH: THREE.DataTexture | null = null;
function getPanelNormal(dir: 'v' | 'h'): THREE.DataTexture {
  if (dir === 'v') return _panelNormalV ?? (_panelNormalV = makePanelNormalMap('v'));
  return _panelNormalH ?? (_panelNormalH = makePanelNormalMap('h'));
}

// Returns a cloned texture with the given repeat + offset for world-space alignment
function usePanelNormal(
  dir: 'horizontal' | 'vertical',
  repeatU: number,
  repeatV: number,
  offsetU: number = 0,
  offsetV: number = 0,
): THREE.Texture {
  return useMemo(() => {
    const base = getPanelNormal(dir === 'vertical' ? 'v' : 'h');
    const t = base.clone();
    t.repeat.set(repeatU, repeatV);
    t.offset.set(offsetU % 1, offsetV % 1);
    t.needsUpdate = true;
    return t;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir, Math.round(repeatU * 10), Math.round(repeatV * 10),
      Math.round(offsetU * 100), Math.round(offsetV * 100)]);
}

/**
 * Slat shading for a roll-up door.
 *
 * A normal map alone did not read: the door was a flat white box and the
 * grooves vanished at any distance (owner, 2026-08-30). This is a real
 * light/dark texture, so the slats show up regardless of viewing angle.
 *
 * One slat is drawn into a tall thin canvas and repeated up the door — a
 * gradient across the slat's face for the curve of the steel, then a hard dark
 * line at the joint where it meets the next one.
 *
 * White with grey lines, used as `map`, which three multiplies by the material
 * colour — so a coloured door stays its colour and gains the slats.
 */
// 6in slats. Real rolling steel is nearer 3in, but at that size a 10ft door
// carries 40 lines, each a pixel or two on screen at normal zoom — and
// mipmapping averages them straight back into flat grey, which is why the
// first attempt showed nothing. Same trade the roof eave radius makes: the
// customer has to be able to SEE which door they picked.
const SLAT_HEIGHT_FT = 0.5;

function useRollupSlatTexture(heightFt: number): THREE.Texture {
  return useMemo(() => {
    const CELL = 32;
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = CELL;
    const ctx = canvas.getContext('2d')!;

    // Face of the slat: brightest just below the joint, falling away downward,
    // the way light catches a convex slat.
    const grad = ctx.createLinearGradient(0, 0, 0, CELL);
    grad.addColorStop(0.0, '#ffffff');
    grad.addColorStop(0.25, '#f2f2f2');
    grad.addColorStop(0.80, '#cfcfcf');
    grad.addColorStop(1.0, '#b4b4b4');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 4, CELL);

    // The joint — a hard shadow line, which is what actually reads as "this
    // door is made of slats". Two of 32 rows, so it survives being scaled down.
    ctx.fillStyle = '#6e6e6e';
    ctx.fillRect(0, CELL - 2, 4, 2);

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, Math.max(4, Math.round(heightFt / SLAT_HEIGHT_FT)));
    // Anisotropy keeps the lines from smearing away when the door is seen at a
    // glancing angle, which is most of the time on a 3/4 view.
    tex.anisotropy = 8;
    tex.needsUpdate = true;
    return tex;
  }, [Math.round(heightFt * 4)]);
}

// ═══════════════════════════════════════════════════════════════
// ENTRY — Canvas wrapper
// ═══════════════════════════════════════════════════════════════

export function ThreeScene() {
  return (
    // The wrapper carries the scene's own background, and a spinner sits behind
    // the canvas until it paints.
    //
    // The sidebar mounts as soon as the designer chunk lands, but three.js still
    // has to compile shaders and build the geometry, and this area used to be
    // stark white for the whole of that — a blank panel next to a working
    // sidebar, which reads as broken rather than loading. Measured at several
    // seconds on a cold dev load; a production build is far quicker, but the
    // first paint is never instant (2026-08-31). The canvas is opaque
    // (alpha: false) and drawn after this, so it covers the placeholder the
    // moment it has a frame.
    <div className="relative h-full w-full bg-[#8291a3]">
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div
          className="h-10 w-10 animate-spin rounded-full border-4 border-white/40 border-t-white/90"
          role="status"
          aria-label="Preparing the 3D view"
        />
      </div>
      <Canvas
        camera={{ position: [30, 25, -40], fov: 40, near: 0.1, far: 1000 }}
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.25;
        }}
      >
        <SceneContents />
      </Canvas>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SCENE — lighting, environment, building, ground, controls
// ═══════════════════════════════════════════════════════════════

/**
 * The ground takes the look of whatever the building is being anchored to, so
 * the surface choice is visible rather than only priced (owner, 2026-08-29).
 *
 * Roughness carries as much of it as colour: gravel and dirt scatter light,
 * asphalt and a finished slab do not.
 */
const GROUND_BY_ANCHOR: Record<string, { color: string; roughness: number }> = {
  ground: { color: '#8a6a4a', roughness: 1.0 },   // rough brown — dirt or gravel
  asphalt: { color: '#3a3a3d', roughness: 0.55 }, // smooth dark grey
  concrete: { color: '#b8b8b4', roughness: 0.6 }, // smooth light grey
};
const GROUND_DEFAULT = GROUND_BY_ANCHOR.ground;

function SceneContents() {
  const building = useDesignerStore((s) => s.config?.building);
  const anchoring = useDesignerStore((s) => s.config?.options?.anchoring);
  const ground = GROUND_BY_ANCHOR[anchoring ?? ''] ?? GROUND_DEFAULT;
  const controlsRef = useRef<any>(null);

  // Roughly how big the scene is, used to place the lights far enough out that
  // they read as directional. Named for shadows once; there are none now.
  const sceneScale = building
    ? Math.max(building.widthFt, building.lengthFt) * 1.2
    : 60;

  return (
    <>
      {/* A lighter backdrop lifts the whole scene; the old slate read as dusk. */}
      <color attach="background" args={['#8291a3']} />

      {/*
        Lit evenly on purpose (owner, 2026-08-30). One strong directional left
        the faces turned away from it visibly darker — one eave and one side
        wall — which reads as a rendering fault rather than as form, and makes
        a customer think the colour differs from panel to panel.

        So most of the light is ambient, with four weak directionals from
        opposing sides for just enough definition to tell the surfaces apart.
        Shadows are off entirely; they are not wanted here.
      */}
      <ambientLight intensity={1.75} />
      <hemisphereLight args={['#ffffff', '#e8e6e2', 0.55]} />
      <directionalLight position={[sceneScale, sceneScale, sceneScale]} intensity={0.28} />
      <directionalLight position={[-sceneScale, sceneScale, -sceneScale]} intensity={0.28} />
      <directionalLight position={[sceneScale, sceneScale * 0.6, -sceneScale]} intensity={0.22} />
      <directionalLight position={[-sceneScale, sceneScale * 0.6, sceneScale]} intensity={0.22} />

      <BuildingModel />

      <mesh rotation-x={-Math.PI / 2} position-y={-0.02}
        onClick={() => useDesignerStore.getState().selectOpening(null)}>
        <planeGeometry args={[500, 500]} />
        <meshStandardMaterial color={ground.color} roughness={ground.roughness} metalness={0} />
      </mesh>
      <CameraController controlsRef={controlsRef} />
      <OrbitControlsWrapper controlsRef={controlsRef} />
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// CAMERA CONTROLLER
// ═══════════════════════════════════════════════════════════════

function CameraController({ controlsRef }: { controlsRef: React.RefObject<any> }) {
  const building = useDesignerStore((s) => s.config?.building);
  const { camera } = useThree();
  const prevDims = useRef<string>('');

  useEffect(() => {
    if (!building) return;
    const key = `${building.widthFt}-${building.lengthFt}-${building.legHeightFt}`;
    if (prevDims.current === key) return;

    const isFirst = prevDims.current === '';
    prevDims.current = key;

    const rise = (building.widthFt / 2) * ({ '2:12': 2/12, '3:12': 3/12, '4:12': 4/12, '5:12': 5/12, '6:12': 6/12 }[building.roofPitch] ?? 3/12);
    const H = building.legHeightFt;
    const targetY = (H + rise) / 2;
    const maxDim = Math.max(building.widthFt, building.lengthFt, H + rise);
    const distance = maxDim * 1.6;

    if (controlsRef.current) {
      controlsRef.current.target.set(0, targetY, 0);
    }

    if (isFirst) {
      // View from front-right so both slopes + front gable are visible
      camera.position.set(
        distance * 0.55,
        targetY + distance * 0.45,
        -distance * 0.7,
      );
    }
  }, [building, camera, controlsRef]);

  return null;
}

function OrbitControlsWrapper({ controlsRef }: { controlsRef: React.RefObject<any> }) {
  const isDragging = useDesignerStore((s) => s.isDraggingOpening);
  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enablePan
      enabled={!isDragging}
      maxPolarAngle={Math.PI / 2 - 0.02}
      minDistance={8}
      maxDistance={250}
    />
  );
}

// ═══════════════════════════════════════════════════════════════
// BUILDING MODEL — uses buildBuilding() orchestrator
// ═══════════════════════════════════════════════════════════════

function BuildingModel() {
  const config = useDesignerStore((s) => s.config);
  if (!config) return null;

  // Single useMemo generates the entire building geometry description
  const result = useMemo(() => buildBuilding(config), [config]);
  const { dimensions: d, walls } = result;

  const wallPanelDir = config.building.panelDirection.walls;
  const roofPanelDir = config.building.panelDirection.roof;
  const wainscotHex = config.colors.wainscot?.hex ?? null;
  const isOpen = config.building.type === 'carport' || config.building.type === 'rv-cover';

  return (
    <group position={[-d.width / 2, 0, -d.length / 2]}>
      <SlabMesh result={result} />
      {isOpen && <FrameMeshes result={result} />}
      {!isOpen && <SideWalls result={result} color={config.colors.walls.hex} openings={config.openings} panelDir={wallPanelDir} wainscotColor={wainscotHex} />}
      {!isOpen && <GableWalls result={result} color={config.colors.walls.hex} openings={config.openings} panelDir={wallPanelDir} wainscotColor={wainscotHex} />}
      <RoofMeshes result={result} color={config.colors.roof.hex} panelDir={roofPanelDir} building={config.building} />
      <TrimMeshes result={result} color={config.colors.trim.hex} />
      <LeanToMeshes result={result} />
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════
// SLAB
// ═══════════════════════════════════════════════════════════════

function SlabMesh({ result }: { result: BuildingResult }) {
  const { position: p, size: s } = result.slab;
  return (
    <mesh position={p}>
      <boxGeometry args={s} />
      <meshStandardMaterial color="#c8c8c4" roughness={0.95} metalness={0} />
    </mesh>
  );
}

// ═══════════════════════════════════════════════════════════════
// STEEL FRAME — driven by buildBuilding().frame
// ═══════════════════════════════════════════════════════════════

function FrameMeshes({ result }: { result: BuildingResult }) {
  const { columns, eaveBeams, ridgeBeam, rafters, baseBeams } = result.frame;
  return (
    <group>
      {columns.map((c, i) => (
        <FrameBox key={`col-${i}`} pos={c.position} size={c.size} />
      ))}
      {eaveBeams.map((b, i) => (
        <FrameBox key={`eave-${i}`} pos={b.position} size={b.size} />
      ))}
      <FrameBox pos={ridgeBeam.position} size={ridgeBeam.size} />
      {baseBeams.map((b, i) => (
        <FrameBox key={`base-${i}`} pos={b.position} size={b.size} />
      ))}
    </group>
  );
}

function FrameBox({ pos, size, rot }: {
  pos: [number, number, number];
  size: [number, number, number];
  rot?: [number, number, number];
}) {
  return (
    <mesh position={pos} rotation={rot}>
      <boxGeometry args={size} />
      <meshStandardMaterial color="#d8d8d4" metalness={STEEL_METALNESS} roughness={STEEL_ROUGHNESS} />
    </mesh>
  );
}

// ═══════════════════════════════════════════════════════════════
// PURLINS — roof members along the length
// ═══════════════════════════════════════════════════════════════

function PurlinMeshes({ result }: { result: BuildingResult }) {
  const { width: W, length: L, height: H, rise } = result.dimensions;
  const halfW = W / 2;
  const angle = result.dimensions.slopeAngle;

  const purlins = useMemo(() => {
    const slopeLen = Math.sqrt(rise * rise + halfW * halfW);
    const count = Math.max(1, Math.floor(slopeLen / PURLIN_SPACING));
    const purlinSize = RAFTER_T * 0.5;
    // Offset purlins downward perpendicular to roof surface
    const offsetX = (purlinSize / 2 + 0.04) * Math.sin(angle);
    const offsetY = (purlinSize / 2 + 0.04) * Math.cos(angle);
    const items: { x: number; y: number; side: 'L' | 'R' }[] = [];
    for (let i = 1; i <= count; i++) {
      const t = i / (count + 1);
      items.push({ x: t * halfW + offsetX, y: H + t * rise - offsetY, side: 'L' });
      items.push({ x: W - t * halfW - offsetX, y: H + t * rise - offsetY, side: 'R' });
    }
    return items;
  }, [W, L, H, rise, halfW, angle]);

  return (
    <group>
      {purlins.map((p, i) => (
        <mesh
          key={`purlin-${i}`}
          position={[p.x, p.y, L / 2]}
          rotation={[0, 0, p.side === 'L' ? angle : -angle]}
         
        >
          <boxGeometry args={[RAFTER_T * 0.5, RAFTER_T * 0.5, L]} />
          <meshStandardMaterial color="#d0d0cc" metalness={STEEL_METALNESS} roughness={STEEL_ROUGHNESS} />
        </mesh>
      ))}
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════
// WALL GIRTS
// ═══════════════════════════════════════════════════════════════

function WallGirtMeshes({ result }: { result: BuildingResult }) {
  const { width: W, length: L, height: H } = result.dimensions;
  const girtCount = Math.max(1, Math.floor(H / GIRT_SPACING) - 1);
  const girtDepth = 0.15;
  // Inset girts so they sit fully inside the wall panels
  const inset = WALL_THICKNESS + girtDepth / 2 + 0.02;

  const girtYs = useMemo(() => {
    const ys: number[] = [];
    for (let i = 1; i <= girtCount; i++) ys.push((i / (girtCount + 1)) * H);
    return ys;
  }, [girtCount, H]);

  return (
    <group>
      {girtYs.map((y, i) => (
        <mesh key={`girt-L-${i}`} position={[inset, y, L / 2]}>
          <boxGeometry args={[girtDepth, 0.075, L]} />
          <meshStandardMaterial color="#d0d0cc" metalness={STEEL_METALNESS} roughness={STEEL_ROUGHNESS} />
        </mesh>
      ))}
      {girtYs.map((y, i) => (
        <mesh key={`girt-R-${i}`} position={[W - inset, y, L / 2]}>
          <boxGeometry args={[girtDepth, 0.075, L]} />
          <meshStandardMaterial color="#d0d0cc" metalness={STEEL_METALNESS} roughness={STEEL_ROUGHNESS} />
        </mesh>
      ))}
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════
// SIDE WALLS (left + right)
// ═══════════════════════════════════════════════════════════════

function SideWalls({ result, color, openings, panelDir, wainscotColor }: {
  result: BuildingResult; color: string; openings: Opening[];
  panelDir: 'horizontal' | 'vertical'; wainscotColor: string | null;
}) {
  const { width: W, length: L, height: H } = result.dimensions;
  const leftOps = useMemo(() => openings.filter(o => o.wall === 'left'), [openings]);
  const rightOps = useMemo(() => openings.filter(o => o.wall === 'right'), [openings]);

  return (
    <group>
      <group position={[0, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <SegmentedWall wallLength={L} wallHeight={H} color={color} openings={leftOps} zOff={-WALL_THICKNESS} panelDir={panelDir} wainscotColor={wainscotColor} />
      </group>
      <group position={[W, 0, L]} rotation={[0, Math.PI / 2, 0]}>
        <SegmentedWall wallLength={L} wallHeight={H} color={color} openings={rightOps} zOff={-WALL_THICKNESS} panelDir={panelDir} wainscotColor={wainscotColor} />
      </group>
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════
// GABLE WALLS (front + back)
// ═══════════════════════════════════════════════════════════════

function GableWalls({ result, color, openings, panelDir, wainscotColor }: {
  result: BuildingResult; color: string; openings: Opening[];
  panelDir: 'horizontal' | 'vertical'; wainscotColor: string | null;
}) {
  const { width: W, length: L, height: H, rise } = result.dimensions;
  const frontOps = useMemo(() => openings.filter(o => o.wall === 'front'), [openings]);
  const backOps = useMemo(() => openings.filter(o => o.wall === 'back'), [openings]);

  return (
    <group>
      <group>
        <SegmentedWall wallLength={W} wallHeight={H} color={color} openings={frontOps} zOff={-WALL_THICKNESS} panelDir={panelDir} wainscotColor={wainscotColor} />
        <GableTriangle width={W} height={H} rise={rise} color={color} side="front" />
      </group>
      <group position={[W, 0, L]} rotation={[0, Math.PI, 0]}>
        <SegmentedWall wallLength={W} wallHeight={H} color={color} openings={backOps} zOff={WALL_THICKNESS} panelDir={panelDir} wainscotColor={wainscotColor} />
        <GableTriangle width={W} height={H} rise={rise} color={color} side="back" />
      </group>
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════
// GABLE TRIANGLE
// ═══════════════════════════════════════════════════════════════

function GableTriangle({ width, height, rise, color, side }: {
  width: number; height: number; rise: number; color: string; side: 'front' | 'back';
}) {
  // Simple flat triangle at the wall face
  const zOff = side === 'front' ? -WALL_THICKNESS : WALL_THICKNESS;

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const verts = new Float32Array([
      0, height, zOff,
      width, height, zOff,
      width / 2, height + rise, zOff,
    ]);
    const nz = zOff > 0 ? 1 : -1;
    const normals = new Float32Array([0, 0, nz, 0, 0, nz, 0, 0, nz]);
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setIndex([0, 1, 2]);
    return geo;
  }, [width, height, rise, zOff]);

  useEffect(() => {
    return () => { geometry.dispose(); };
  }, [geometry]);

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color={color} side={THREE.DoubleSide} metalness={STEEL_METALNESS} roughness={STEEL_ROUGHNESS} />
    </mesh>
  );
}

// ═══════════════════════════════════════════════════════════════
// SEGMENTED WALL — splits around openings
// ═══════════════════════════════════════════════════════════════

interface WallSeg { x: number; y: number; w: number; h: number; }

function PanelPanel({ x, y, w, h, zOff, color, panelDir }: {
  x: number; y: number; w: number; h: number;
  zOff: number; color: string; panelDir: 'horizontal' | 'vertical';
}) {
  const ribsU = panelDir === 'vertical' ? w * RIBS_PER_FOOT : 1;
  const ribsV = panelDir === 'horizontal' ? h * RIBS_PER_FOOT : 1;
  // World-space offset so ribs align across adjacent wall segments
  const offU = panelDir === 'vertical' ? x * RIBS_PER_FOOT : 0;
  const offV = panelDir === 'horizontal' ? y * RIBS_PER_FOOT : 0;
  const normalMap = usePanelNormal(panelDir, ribsU, ribsV, offU, offV);
  // Box height is inflated 0.02ft beyond the segment's nominal h so stacked
  // segments (sill/header/etc.) overlap at their seams instead of leaving a
  // hairline gap. That inflation must NOT extend above the segment's top —
  // for the topmost, full-height segment the top edge IS the eave line
  // (y=wallHeight), and the roof profile's wall-face vertex sits at exactly
  // that height (see buildRegularRoofProfile's `shoulder` point in
  // lib/building/roof.ts). Centering the inflated box on y+h/2 pushed the
  // wall 0.01ft above the eave line, showing as a thin sliver of wall color
  // above/through the roof edge. Shifting the center down by 0.01ft keeps
  // the same total overlap (now all below) while making the top land
  // exactly at y+h, so the roof fully caps the wall with no gap.
  return (
    <mesh position={[x + w / 2, y + h / 2 - 0.01, zOff / 2]}>
      <boxGeometry args={[w + 0.04, h + 0.02, WALL_THICKNESS]} />
      <meshStandardMaterial
        color={color}
        metalness={STEEL_METALNESS}
        roughness={STEEL_ROUGHNESS}
        normalMap={normalMap}
        normalScale={new THREE.Vector2(1, 1)}
      />
    </mesh>
  );
}

function WallSegMesh({ seg, zOff, color, panelDir, wainscotColor }: {
  seg: WallSeg; zOff: number; color: string; panelDir: 'horizontal' | 'vertical';
  wainscotColor: string | null;
}) {
  // Any segment standing on the ground carries the wainscot, including the
  // short one under a window. The old guard wanted the segment to be TALLER
  // than the band plus half a foot — and a window sill is at 3.5ft, exactly the
  // band plus half a foot, so it failed by a hair and the wall colour ran to
  // the ground under every window (owner, 2026-08-29).
  const onTheGround = wainscotColor !== null && seg.y < 0.05;
  const remainder = seg.h - WAINSCOT_HEIGHT;

  if (onTheGround && remainder > 0.05) {
    return (
      <group>
        <PanelPanel x={seg.x} y={0} w={seg.w} h={WAINSCOT_HEIGHT} zOff={zOff} color={wainscotColor!} panelDir="horizontal" />
        <PanelPanel x={seg.x} y={WAINSCOT_HEIGHT} w={seg.w} h={remainder} zOff={zOff} color={color} panelDir={panelDir} />
      </group>
    );
  }

  // Shorter than the band itself — under a low window, say. The whole segment
  // is wainscot rather than a sliver of it.
  if (onTheGround) {
    return (
      <PanelPanel x={seg.x} y={seg.y} w={seg.w} h={seg.h} zOff={zOff} color={wainscotColor!} panelDir="horizontal" />
    );
  }

  return <PanelPanel x={seg.x} y={seg.y} w={seg.w} h={seg.h} zOff={zOff} color={color} panelDir={panelDir} />;
}

function SegmentedWall({ wallLength, wallHeight, color, openings, zOff, panelDir, wainscotColor }: {
  wallLength: number; wallHeight: number; color: string;
  openings: Opening[]; zOff: number; panelDir: 'horizontal' | 'vertical';
  wainscotColor: string | null;
}) {
  const SILL_HEIGHT = 3.5; // window sill at 3.5ft (42")

  const segments = useMemo((): WallSeg[] => {
    if (openings.length === 0) {
      return [{ x: 0, y: 0, w: wallLength, h: wallHeight }];
    }
    const sorted = [...openings].sort((a, b) => a.positionFt - b.positionFt);
    const segs: WallSeg[] = [];
    let cursor = 0;

    for (const op of sorted) {
      const ox = op.positionFt;
      const ow = op.widthFt;
      // Full-height segment to the LEFT of this opening
      if (ox > cursor + 0.01) {
        segs.push({ x: cursor, y: 0, w: ox - cursor, h: wallHeight });
      }
      if (op.type === 'window') {
        // Window: wall is continuous — add segments BELOW sill and ABOVE header
        const sillY = SILL_HEIGHT;
        const headerY = sillY + op.heightFt;
        // Below window (sill panel)
        if (sillY > 0.05) {
          segs.push({ x: ox, y: 0, w: ow, h: sillY });
        }
        // Above window (header panel)
        if (headerY < wallHeight - 0.05) {
          segs.push({ x: ox, y: headerY, w: ow, h: wallHeight - headerY });
        }
      } else {
        // Door: segment above the door
        if (op.heightFt < wallHeight - 0.01) {
          segs.push({ x: ox, y: op.heightFt, w: ow, h: wallHeight - op.heightFt });
        }
      }
      cursor = ox + ow;
    }
    if (cursor < wallLength - 0.01) {
      segs.push({ x: cursor, y: 0, w: wallLength - cursor, h: wallHeight });
    }
    return segs;
  }, [openings, wallLength, wallHeight]);

  return (
    <group>
      {/* Invisible drag surface — captures pointer during opening drag */}
      <mesh
        position={[wallLength / 2, wallHeight / 2, zOff / 2]}
        onPointerMove={(e: any) => {
          const s = useDesignerStore.getState();
          if (!s.isDraggingOpening || !s.selectedOpeningId) return;
          e.stopPropagation();
          // e.point → wall-local coords via parent group
          const local = e.object.parent!.worldToLocal(e.point.clone());
          const op = s.config?.openings.find((o: Opening) => o.id === s.selectedOpeningId);
          if (!op) return;
          const newPos = Math.max(0, Math.min(wallLength - op.widthFt, local.x - op.widthFt / 2));
          s.updateOpening(op.id, { positionFt: Math.round(newPos * 2) / 2 }); // snap to 0.5ft
        }}
        onPointerUp={() => {
          useDesignerStore.setState({ isDraggingOpening: false });
        }}
      >
        <planeGeometry args={[wallLength + 4, wallHeight + 4]} />
        <meshBasicMaterial colorWrite={false} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>

      {segments.map((seg, i) => (
        <WallSegMesh
          key={`wseg-${i}-${seg.x.toFixed(1)}-${seg.y.toFixed(1)}`}
          seg={seg} zOff={zOff} color={color} panelDir={panelDir} wainscotColor={wainscotColor}
        />
      ))}
      {openings.map((op) => (
        <OpeningMesh key={op.id} opening={op} wallHeight={wallHeight} wallLength={wallLength} zOff={zOff} wallColor={color} panelDir={panelDir} />
      ))}
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════
// OPENING MESH — roll-up door, walk-in door, window
// ═══════════════════════════════════════════════════════════════

function OpeningMesh({ opening, wallHeight, wallLength, zOff, wallColor, panelDir }: {
  opening: Opening; wallHeight: number; wallLength: number; zOff: number;
  wallColor: string; panelDir: 'horizontal' | 'vertical';
}) {
  const { positionFt: ox, widthFt: ow, heightFt: oh, type } = opening;
  const selectOpening = useDesignerStore((s) => s.selectOpening);
  const selectedId = useDesignerStore((s) => s.selectedOpeningId);
  const trimColor = useDesignerStore((s) => s.config?.colors.trim.hex ?? '#ffffff');

  // Roll-up textures, built here rather than inside the `type === 'rollup'`
  // branch below. Hooks must run in the same order every render, and an
  // opening's type can be changed in the designer — calling these
  // conditionally means the hook order shifts on that change and React throws.
  // They cost nothing for a window or a walk-in; both are memoised.
  const doorNormal = usePanelNormal('horizontal', 1, oh * 2.5);
  const slatTexture = useRollupSlatTexture(oh);

  const isSelected = selectedId === opening.id;
  const cx = ox + ow / 2;
  const depthOff = Math.sign(zOff) * (Math.abs(zOff) + 0.05);

  const handlePointerDown = (e: any) => {
    e.stopPropagation();
    selectOpening(opening.id);
    // Start drag — the invisible wall plane in SegmentedWall handles movement
    useDesignerStore.setState({ isDraggingOpening: true });
  };

  // Selection highlight — blue glow behind the opening
  const highlight = isSelected ? (
    <mesh position={[0, 0, -0.02]}>
      <boxGeometry args={[ow + 0.8, oh + 0.8, 0.02]} />
      <meshBasicMaterial color="#3b82f6" transparent opacity={0.4} />
    </mesh>
  ) : null;

  if (type === 'window') {
    const sillY = 3.5; // must match SILL_HEIGHT in SegmentedWall
    const trimT = 0.3;  // 3.5" wide trim
    const trimD = 0.15; // sticks out visibly
    // Grid: 2 columns x 3 rows of panes
    const paneRows = 3;
    const paneCols = 2;
    const mullionW = 0.08;
    const paneW = (ow - mullionW * (paneCols + 1)) / paneCols;
    const paneH = (oh - mullionW * (paneRows + 1)) / paneRows;

    return (
      <group position={[cx, sillY + oh / 2, depthOff]}
        onPointerDown={handlePointerDown}>
        {highlight}

        {/*
          The backing behind the glass. What shows between the panes IS this
          panel, so its colour is the mullion colour — at near-white the grid
          washed out against the glass and the panes did not read as panes
          (owner, 2026-08-30). A dark sash gives the glass something to sit
          against.

          Its outer edge is covered by the trim on all four sides, so darkening
          it changes the dividers and nothing else.
        */}
        <mesh position={[0, 0, 0.01]}>
          <boxGeometry args={[ow + 0.1, oh + 0.1, 0.06]} />
          <meshStandardMaterial color="#4a5058" metalness={STEEL_METALNESS} roughness={0.7} />
        </mesh>

        {/* Glass panes in grid */}
        {Array.from({ length: paneRows }).map((_, r) =>
          Array.from({ length: paneCols }).map((_, c) => {
            const px = -ow / 2 + mullionW + paneW / 2 + c * (paneW + mullionW);
            const py = -oh / 2 + mullionW + paneH / 2 + r * (paneH + mullionW);
            return (
              <mesh key={`pane-${r}-${c}`} position={[px, py, 0.045]}>
                <planeGeometry args={[paneW, paneH]} />
                {/* Slightly more opaque than before, so each pane reads as a
                    pane against the dark sash rather than as a tint. */}
                <meshPhysicalMaterial color="#a8d4ea" transparent opacity={0.55} roughness={0.05} metalness={0.1} side={THREE.DoubleSide} />
              </mesh>
            );
          })
        )}

        {/* Trim frame — pushed forward to sit on wall surface */}
        <mesh position={[-ow / 2 - trimT / 2, 0, 0.04]}>
          <boxGeometry args={[trimT, oh + trimT * 2, trimD]} />
          <meshStandardMaterial color={trimColor} metalness={STEEL_METALNESS} roughness={STEEL_ROUGHNESS} />
        </mesh>
        <mesh position={[ow / 2 + trimT / 2, 0, 0.04]}>
          <boxGeometry args={[trimT, oh + trimT * 2, trimD]} />
          <meshStandardMaterial color={trimColor} metalness={STEEL_METALNESS} roughness={STEEL_ROUGHNESS} />
        </mesh>
        <mesh position={[0, oh / 2 + trimT / 2, 0.04]}>
          <boxGeometry args={[ow + trimT * 2, trimT, trimD]} />
          <meshStandardMaterial color={trimColor} metalness={STEEL_METALNESS} roughness={STEEL_ROUGHNESS} />
        </mesh>
        <mesh position={[0, -oh / 2 - trimT / 2, 0.04]}>
          <boxGeometry args={[ow + trimT * 2, trimT, trimD]} />
          <meshStandardMaterial color={trimColor} metalness={STEEL_METALNESS} roughness={STEEL_ROUGHNESS} />
        </mesh>
      </group>
    );
  }

  if (type === 'rollup') {
    // Slats are real light and shade, not just a normal map — see
    // useRollupSlatTexture. Both textures come from the top of the component.
    const trimT = 0.3;
    const trimD = 0.15;

    return (
      <group position={[cx, oh / 2, depthOff]}
        onPointerDown={handlePointerDown}>
        {highlight}

        {/*
          Slats on EVERY face, not just the one I guessed was the front.
          Openings sit on all four walls and the group is rotated to suit, so
          +Z is the outward face for some of them and the inward face for
          others — putting the texture on material-4 alone left half the doors
          plain, which is exactly what it looked like (owner, 2026-08-30). The
          box is 0.06ft thick, so the edges carrying it too costs nothing.
        */}
        <mesh>
          <boxGeometry args={[ow, oh, 0.06]} />
          <meshStandardMaterial
            color="#f2f2f2"
            metalness={STEEL_METALNESS}
            roughness={STEEL_ROUGHNESS}
            map={slatTexture}
            normalMap={doorNormal}
            normalScale={new THREE.Vector2(0.8, 0.8)}
          />
        </mesh>

        {/* Trim frame — pushed forward */}
        <mesh position={[-ow / 2 - trimT / 2, 0, 0.04]}>
          <boxGeometry args={[trimT, oh + trimT, trimD]} />
          <meshStandardMaterial color={trimColor} metalness={STEEL_METALNESS} roughness={STEEL_ROUGHNESS} />
        </mesh>
        <mesh position={[ow / 2 + trimT / 2, 0, 0.04]}>
          <boxGeometry args={[trimT, oh + trimT, trimD]} />
          <meshStandardMaterial color={trimColor} metalness={STEEL_METALNESS} roughness={STEEL_ROUGHNESS} />
        </mesh>
        <mesh position={[0, oh / 2 + trimT / 2, 0.04]}>
          <boxGeometry args={[ow + trimT * 2, trimT, trimD]} />
          <meshStandardMaterial color={trimColor} metalness={STEEL_METALNESS} roughness={STEEL_ROUGHNESS} />
        </mesh>
      </group>
    );
  }

  // Walk-in door
  const trimT = 0.12;
  const trimD = 0.08;
  return (
    <group position={[cx, oh / 2, depthOff]}
      onPointerDown={handlePointerDown}>
      {highlight}
      {/* Door panel */}
      <mesh>
        <boxGeometry args={[ow, oh, 0.08]} />
        <meshStandardMaterial color="#f0f0f0" metalness={0.25} roughness={STEEL_ROUGHNESS} />
      </mesh>
      {/* Door knob */}
      <mesh position={[ow / 2 - 0.3, -0.2, 0.06]}>
        <sphereGeometry args={[0.08, 12, 8]} />
        <meshStandardMaterial color="#b0a060" metalness={0.8} roughness={0.2} />
      </mesh>
      {/* Trim — pushed forward */}
      <mesh position={[-ow / 2 - trimT / 2, 0, 0.04]}>
        <boxGeometry args={[trimT, oh + trimT, trimD]} />
        <meshStandardMaterial color={trimColor} metalness={STEEL_METALNESS} roughness={STEEL_ROUGHNESS} />
      </mesh>
      <mesh position={[ow / 2 + trimT / 2, 0, 0.04]}>
        <boxGeometry args={[trimT, oh + trimT, trimD]} />
        <meshStandardMaterial color={trimColor} metalness={STEEL_METALNESS} roughness={STEEL_ROUGHNESS} />
      </mesh>
      <mesh position={[0, oh / 2 + trimT / 2, 0.04]}>
        <boxGeometry args={[ow + trimT * 2, trimT, trimD]} />
        <meshStandardMaterial color={trimColor} metalness={STEEL_METALNESS} roughness={STEEL_ROUGHNESS} />
      </mesh>
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════
// ROOF — driven by buildBuilding().roof
// ═══════════════════════════════════════════════════════════════

function RoofMeshes({ result, color, panelDir, building }: {
  result: BuildingResult; color: string; panelDir: 'horizontal' | 'vertical';
  building: BuildingDimensions;
}) {
  const { width: W, length: L, rise } = result.dimensions;
  const ovh = ROOF_OVERHANG;
  const slopeLen = Math.sqrt((W / 2) * (W / 2) + rise * rise);
  const roofLen = L + ovh * 2;

  // UV: U = across slope (eave→ridge), V = along building length (front→back)
  // Vertical panels: ribs run eave-to-ridge (along U) → corrugation repeats along V
  // Horizontal panels: ribs run along ridge (along V) → corrugation repeats along U
  const roofNormalDir = panelDir === 'vertical' ? 'horizontal' : 'vertical';
  const ribsU = panelDir === 'horizontal' ? slopeLen * RIBS_PER_FOOT : 1;
  const ribsV = panelDir === 'vertical' ? roofLen * RIBS_PER_FOOT : 1;
  const normalMap = usePanelNormal(roofNormalDir, ribsU, ribsV);

  // Vertex/UV/index generation lives in lib/building/roof.ts (buildRoofProfile)
  // as a pure, testable function — this component only turns that data into
  // a BufferGeometry.
  const geometry = useMemo(() => {
    const profile = buildRoofProfile(building, ovh);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(profile.positions), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(profile.uvs), 2));
    geo.setIndex(profile.indices);
    geo.computeVertexNormals();
    return geo;
  }, [building, ovh]);

  useEffect(() => {
    return () => { geometry.dispose(); };
  }, [geometry]);

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        color={color}
        metalness={STEEL_METALNESS}
        roughness={STEEL_ROUGHNESS}
        side={THREE.DoubleSide}
        normalMap={normalMap}
        normalScale={new THREE.Vector2(1, 1)}
      />
    </mesh>
  );
}

// ═══════════════════════════════════════════════════════════════
// TRIM — driven by buildBuilding().trim
// ═══════════════════════════════════════════════════════════════

function TrimMeshes({ result, color }: { result: BuildingResult; color: string }) {
  const { pieces } = result.trim;
  // Render all trim except rake (overlaps with roof edges)
  const filtered = pieces.filter(p => p.category !== 'rake');

  return (
    <group>
      {filtered.map((piece) => (
        <mesh key={piece.id} position={piece.position} rotation={piece.rotation}>
          <boxGeometry args={piece.size} />
          <meshStandardMaterial color={color} metalness={STEEL_METALNESS} roughness={STEEL_ROUGHNESS} />
        </mesh>
      ))}
    </group>
  );
}

function RidgeCapMesh({ result, color }: { result: BuildingResult; color: string }) {
  const ridgePiece = result.trim.pieces.find(p => p.category === 'ridge');
  if (!ridgePiece) return null;
  return (
    <mesh position={ridgePiece.position} rotation={ridgePiece.rotation}>
      <boxGeometry args={ridgePiece.size} />
      <meshStandardMaterial color={color} metalness={STEEL_METALNESS} roughness={STEEL_ROUGHNESS} />
    </mesh>
  );
}

// ═══════════════════════════════════════════════════════════════
// LEAN-TOS — driven by buildBuilding().leanTos
// ═══════════════════════════════════════════════════════════════

function LeanToMeshes({ result }: { result: BuildingResult }) {
  if (result.leanTos.length === 0) return null;

  return (
    <group>
      {result.leanTos.map((lt) => (
        <group
          key={lt.leanTo.id}
          position={lt.groupPosition}
          rotation={[0, lt.groupRotationY, 0]}
        >
          {lt.meshes.map((m) => (
            <mesh
              key={m.id}
              position={m.position}
              rotation={m.rotation}
             
             
            >
              <boxGeometry args={m.size} />
              <meshStandardMaterial
                color={m.color}
                side={m.part === 'roof' ? THREE.DoubleSide : undefined}
                metalness={m.part === 'slab' ? 0 : m.part === 'post' ? 0.5 : 0.35}
                roughness={m.part === 'slab' ? 0.92 : m.part === 'post' ? 0.4 : 0.65}
              />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

