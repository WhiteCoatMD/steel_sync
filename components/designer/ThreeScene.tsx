'use client';

import { useMemo, useEffect, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, ContactShadows, AdaptiveDpr } from '@react-three/drei';
import * as THREE from 'three';
import { useDesignerStore } from '@/lib/store/designerStore';
import { buildBuilding, type BuildingResult } from '@/lib/building/buildBuilding';
import type { Opening, BuildingConfig } from '@/lib/building/types';

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

// ═══════════════════════════════════════════════════════════════
// ENTRY — Canvas wrapper
// ═══════════════════════════════════════════════════════════════

export function ThreeScene() {
  return (
    <div className="h-full w-full">
      <Canvas
        shadows
        camera={{ position: [30, 25, -40], fov: 40, near: 0.1, far: 1000 }}
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.1;
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

function SceneContents() {
  const building = useDesignerStore((s) => s.config?.building);
  const controlsRef = useRef<any>(null);

  const shadowSize = building
    ? Math.max(building.widthFt, building.lengthFt) * 1.2
    : 60;

  return (
    <>
      <color attach="background" args={['#5a6878']} />
      <ambientLight intensity={0.8} />
      <directionalLight
        position={[shadowSize * 0.5, shadowSize * 1.0, -shadowSize * 0.3]}
        intensity={1.2}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-far={shadowSize * 3}
        shadow-camera-left={-shadowSize}
        shadow-camera-right={shadowSize}
        shadow-camera-top={shadowSize}
        shadow-camera-bottom={-shadowSize}
        shadow-bias={-0.0005}
      />
      <directionalLight position={[-shadowSize * 0.4, shadowSize * 0.5, -shadowSize * 0.6]} intensity={0.4} />
      <hemisphereLight args={['#ffffff', '#d0ccc8', 0.3]} />

      <BuildingModel />

      <mesh rotation-x={-Math.PI / 2} position-y={-0.02} receiveShadow
        onClick={() => useDesignerStore.getState().selectOpening(null)}>
        <planeGeometry args={[500, 500]} />
        <meshStandardMaterial color="#d4d2c4" roughness={0.9} metalness={0} />
      </mesh>
      <ContactShadows
        position={[0, 0.01, 0]}
        opacity={0.2}
        scale={shadowSize * 2}
        blur={2.5}
        far={shadowSize}
      />

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
      <RoofMeshes result={result} color={config.colors.roof.hex} panelDir={roofPanelDir} roofStyle={config.building.roofStyle} />
      {/* Trim temporarily simplified — only ridge cap */}
      <RidgeCapMesh result={result} color={config.colors.trim.hex} />
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
    <mesh position={p} receiveShadow castShadow>
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
    <mesh position={pos} rotation={rot} castShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color="#d8d8d4" metalness={0.5} roughness={0.4} />
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
          castShadow
        >
          <boxGeometry args={[RAFTER_T * 0.5, RAFTER_T * 0.5, L]} />
          <meshStandardMaterial color="#d0d0cc" metalness={0.45} roughness={0.45} />
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
          <meshStandardMaterial color="#d0d0cc" metalness={0.45} roughness={0.45} />
        </mesh>
      ))}
      {girtYs.map((y, i) => (
        <mesh key={`girt-R-${i}`} position={[W - inset, y, L / 2]}>
          <boxGeometry args={[girtDepth, 0.075, L]} />
          <meshStandardMaterial color="#d0d0cc" metalness={0.45} roughness={0.45} />
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
    <mesh geometry={geometry} castShadow>
      <meshStandardMaterial color={color} side={THREE.DoubleSide} metalness={0.3} roughness={0.6} />
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
  return (
    <mesh position={[x + w / 2, y + h / 2, zOff / 2]} castShadow receiveShadow>
      <boxGeometry args={[w + 0.04, h + 0.02, WALL_THICKNESS]} />
      <meshStandardMaterial
        color={color}
        metalness={0.45}
        roughness={0.5}
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
  const hasWainscot = wainscotColor !== null && seg.y < 0.05 && seg.h > WAINSCOT_HEIGHT + 0.5;

  if (hasWainscot) {
    return (
      <group>
        <PanelPanel x={seg.x} y={0} w={seg.w} h={WAINSCOT_HEIGHT} zOff={zOff} color={wainscotColor!} panelDir="horizontal" />
        <PanelPanel x={seg.x} y={WAINSCOT_HEIGHT} w={seg.w} h={seg.h - WAINSCOT_HEIGHT} zOff={zOff} color={color} panelDir={panelDir} />
      </group>
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
  const updateOpening = useDesignerStore((s) => s.updateOpening);
  const selectedId = useDesignerStore((s) => s.selectedOpeningId);
  const isSelected = selectedId === opening.id;
  const dragRef = useRef(false);
  const cx = ox + ow / 2;
  const depthOff = Math.sign(zOff) * (Math.abs(zOff) + 0.05);
  const { gl, camera } = useThree();

  // Click to select (single click without drag)
  const handleClick = (e: any) => {
    e.stopPropagation();
    selectOpening(opening.id);
  };

  // Double-click to start drag mode
  const handleDoubleClick = (e: any) => {
    e.stopPropagation();
    selectOpening(opening.id);
    dragRef.current = true;
    useDesignerStore.setState({ isDraggingOpening: true });

    const cam = camera; // capture for closure
    const onMove = (evt: PointerEvent) => {
      if (!dragRef.current) return;
      const rect = gl.domElement.getBoundingClientRect();
      const mouseX = ((evt.clientX - rect.left) / rect.width) * 2 - 1;
      const mouseY = -((evt.clientY - rect.top) / rect.height) * 2 + 1;
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(mouseX, mouseY), cam);

      // Intersect with a horizontal plane at the opening's height
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -oh / 2);
      const hitPoint = new THREE.Vector3();
      raycaster.ray.intersectPlane(plane, hitPoint);
      if (!hitPoint) return;

      // Convert to wall-local position (approximate — works for front/back walls)
      const store = useDesignerStore.getState();
      const config = store.config;
      if (!config) return;
      const wallW = opening.wall === 'front' || opening.wall === 'back' ? config.building.widthFt : config.building.lengthFt;
      // hitPoint.x is in world coords, building is centered
      const localX = hitPoint.x + wallW / 2;
      const newPos = Math.max(0, Math.min(wallW - ow, Math.round(localX - ow / 2)));
      updateOpening(opening.id, { positionFt: newPos });
    };

    const onUp = () => {
      dragRef.current = false;
      useDesignerStore.setState({ isDraggingOpening: false });
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  if (type === 'window') {
    const sillY = 3.5; // must match SILL_HEIGHT in SegmentedWall
    return (
      <group position={[cx, sillY + oh / 2, depthOff]}
        onClick={handleClick} onDoubleClick={handleDoubleClick}>
        <mesh position={[0, 0, 0.01]}>
          <boxGeometry args={[ow + 0.3, oh + 0.3, 0.08]} />
          <meshStandardMaterial color="#d0d0d0" metalness={0.4} roughness={0.5} />
        </mesh>
        <mesh position={[0, 0, 0.06]}>
          <planeGeometry args={[ow - 0.15, oh - 0.15]} />
          <meshPhysicalMaterial color="#8ec8e8" transparent opacity={0.3} roughness={0.05} metalness={0.1} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, 0, 0.07]}>
          <boxGeometry args={[0.1, oh - 0.2, 0.04]} />
          <meshStandardMaterial color="#c0c0c0" metalness={0.5} roughness={0.4} />
        </mesh>
        <mesh position={[0, 0, 0.07]}>
          <boxGeometry args={[ow - 0.2, 0.1, 0.04]} />
          <meshStandardMaterial color="#c0c0c0" metalness={0.5} roughness={0.4} />
        </mesh>
      </group>
    );
  }

  if (type === 'rollup') {
    const ribCount = Math.max(2, Math.floor(oh / 1.2));
    return (
      <group position={[cx, oh / 2, depthOff]}
        onClick={handleClick} onDoubleClick={handleDoubleClick}>
        <mesh castShadow>
          <boxGeometry args={[ow - 0.3, oh - 0.15, 0.12]} />
          <meshStandardMaterial color="#d8d8d8" metalness={0.5} roughness={0.4} />
        </mesh>
        <mesh position={[-ow / 2, 0, 0]} castShadow>
          <boxGeometry args={[0.3, oh + 0.1, 0.2]} />
          <meshStandardMaterial color="#404040" metalness={0.65} roughness={0.35} />
        </mesh>
        <mesh position={[ow / 2, 0, 0]} castShadow>
          <boxGeometry args={[0.3, oh + 0.1, 0.2]} />
          <meshStandardMaterial color="#404040" metalness={0.65} roughness={0.35} />
        </mesh>
        <mesh position={[0, oh / 2 + 0.1, 0]} castShadow>
          <boxGeometry args={[ow + 0.3, 0.3, 0.22]} />
          <meshStandardMaterial color="#404040" metalness={0.65} roughness={0.35} />
        </mesh>
        <mesh position={[0, -oh / 2, 0]}>
          <boxGeometry args={[ow, 0.15, 0.15]} />
          <meshStandardMaterial color="#505050" metalness={0.6} roughness={0.4} />
        </mesh>
        {Array.from({ length: ribCount }).map((_, i) => {
          const ribY = -oh / 2 + 0.5 + (i * (oh - 1)) / Math.max(1, ribCount - 1);
          return (
            <mesh key={`rib-${i}`} position={[0, ribY, 0.07]}>
              <boxGeometry args={[ow - 0.5, 0.04, 0.015]} />
              <meshStandardMaterial color="#b0b0b0" metalness={0.4} roughness={0.5} />
            </mesh>
          );
        })}
        <mesh position={[0, -oh / 2 + 1.5, 0.1]}>
          <boxGeometry args={[1.2, 0.15, 0.06]} />
          <meshStandardMaterial color="#909090" metalness={0.6} roughness={0.3} />
        </mesh>
      </group>
    );
  }

  // Walk-in door
  return (
    <group position={[cx, oh / 2, depthOff]}
      onClick={handleClick} onDoubleClick={handleDoubleClick}>
      <mesh castShadow>
        <boxGeometry args={[ow - 0.15, oh - 0.1, 0.1]} />
        <meshStandardMaterial color="#6b5b45" roughness={0.75} metalness={0.1} />
      </mesh>
      <mesh position={[-ow / 2, 0, 0]} castShadow>
        <boxGeometry args={[0.2, oh + 0.1, 0.15]} />
        <meshStandardMaterial color="#404040" metalness={0.5} roughness={0.5} />
      </mesh>
      <mesh position={[ow / 2, 0, 0]} castShadow>
        <boxGeometry args={[0.2, oh + 0.1, 0.15]} />
        <meshStandardMaterial color="#404040" metalness={0.5} roughness={0.5} />
      </mesh>
      <mesh position={[0, oh / 2 + 0.05, 0]} castShadow>
        <boxGeometry args={[ow + 0.2, 0.2, 0.15]} />
        <meshStandardMaterial color="#404040" metalness={0.5} roughness={0.5} />
      </mesh>
      <mesh position={[ow / 2 - 0.4, -0.3, 0.08]}>
        <sphereGeometry args={[0.1, 12, 8]} />
        <meshStandardMaterial color="#c0a060" metalness={0.8} roughness={0.2} />
      </mesh>
      <mesh position={[ow / 2 - 0.4, 0.3, 0.07]}>
        <cylinderGeometry args={[0.06, 0.06, 0.05, 12]} />
        <meshStandardMaterial color="#b0a060" metalness={0.7} roughness={0.3} />
      </mesh>
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════
// ROOF — driven by buildBuilding().roof
// ═══════════════════════════════════════════════════════════════

function RoofMeshes({ result, color, panelDir, roofStyle }: {
  result: BuildingResult; color: string; panelDir: 'horizontal' | 'vertical';
  roofStyle: 'regular' | 'aframe' | 'vertical';
}) {
  const { width: W, length: L, height: H, rise } = result.dimensions;
  const ovh = ROOF_OVERHANG;
  const slopeLen = Math.sqrt((W / 2) * (W / 2) + rise * rise);
  const roofLen = L + ovh * 2;
  const isRegular = roofStyle === 'regular';

  // UV: U = across slope (eave→ridge), V = along building length (front→back)
  // Vertical panels: ribs run eave-to-ridge (along U) → corrugation repeats along V
  // Horizontal panels: ribs run along ridge (along V) → corrugation repeats along U
  const roofNormalDir = panelDir === 'vertical' ? 'horizontal' : 'vertical';
  const ribsU = panelDir === 'horizontal' ? slopeLen * RIBS_PER_FOOT : 1;
  const ribsV = panelDir === 'vertical' ? roofLen * RIBS_PER_FOOT : 1;
  const normalMap = usePanelNormal(roofNormalDir, ribsU, ribsV);

  // Build roof geometry directly — no rotation matrices.
  // Regular style: eave edge curves down 6" (same ridge height as A-Frame).
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const hw = W / 2;
    const zF = -ovh;
    const zB = L + ovh;

    if (!isRegular) {
      // A-Frame / Vertical: simple straight slopes, 4 verts per side
      const verts = new Float32Array([
        0,  H,        zF,   0,  H,        zB,   hw, H+rise, zB,   hw, H+rise, zF,
        W,  H,        zF,   W,  H,        zB,   hw, H+rise, zB,   hw, H+rise, zF,
      ]);
      const uvs = new Float32Array([
        0,0, 0,1, 1,1, 1,0,
        0,0, 0,1, 1,1, 1,0,
      ]);
      geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      geo.setIndex([0,2,1, 0,3,2, 4,5,6, 4,6,7]);
    } else {
      // Regular: curved eave — add intermediate verts for the curve
      // Curve happens in the bottom 20% of the slope, dropping 6"
      const DROOP = 0.5; // 6 inches
      const curveFrac = 0.15; // curve zone = bottom 15% of slope
      // Transition point: 15% of the way from eave toward ridge
      const tX = hw * curveFrac;       // x offset from eave toward ridge
      const tY = rise * curveFrac;     // y offset from eave height
      // 6 verts per slope: eave (drooped), transition, ridge
      const verts = new Float32Array([
        // Left slope: eave(0,1) → transition(2,3) → ridge(4,5)
        0,         H - DROOP,     zF,  // 0: eave front (drooped)
        0,         H - DROOP,     zB,  // 1: eave back
        tX,        H + tY,        zF,  // 2: transition front
        tX,        H + tY,        zB,  // 3: transition back
        hw,        H + rise,      zF,  // 4: ridge front
        hw,        H + rise,      zB,  // 5: ridge back
        // Right slope: eave(6,7) → transition(8,9) → ridge(10,11)
        W,         H - DROOP,     zF,  // 6
        W,         H - DROOP,     zB,  // 7
        W - tX,    H + tY,        zF,  // 8
        W - tX,    H + tY,        zB,  // 9
        hw,        H + rise,      zF,  // 10
        hw,        H + rise,      zB,  // 11
      ]);
      const uvs = new Float32Array([
        0,0, 0,1, curveFrac,0, curveFrac,1, 1,0, 1,1,
        0,0, 0,1, curveFrac,0, curveFrac,1, 1,0, 1,1,
      ]);
      geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      geo.setIndex([
        // Left: eave quad + main quad
        0,3,1, 0,2,3,   2,5,3, 2,4,5,
        // Right: eave quad + main quad
        6,7,9, 6,9,8,   8,9,11, 8,11,10,
      ]);
    }
    geo.computeVertexNormals();
    return geo;
  }, [W, L, H, rise, ovh, isRegular]);

  useEffect(() => {
    return () => { geometry.dispose(); };
  }, [geometry]);

  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial
        color={color}
        metalness={0.5}
        roughness={0.45}
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

  return (
    <group>
      {pieces.map((piece) => (
        <mesh key={piece.id} position={piece.position} rotation={piece.rotation}>
          <boxGeometry args={piece.size} />
          <meshStandardMaterial color={color} metalness={0.3} roughness={0.6} />
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
      <meshStandardMaterial color={color} metalness={0.3} roughness={0.6} />
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
              castShadow
              receiveShadow
            >
              <boxGeometry args={m.size} />
              <meshStandardMaterial
                color={m.color}
                side={m.part === 'roof' ? THREE.DoubleSide : undefined}
                metalness={m.part === 'slab' ? 0 : 0.35}
                roughness={m.part === 'slab' ? 0.92 : 0.65}
              />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

