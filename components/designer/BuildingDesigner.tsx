'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useDesignerStore } from '@/lib/store/designerStore';
import { STANDARD_COLORS, findColor } from '@/lib/building/defaultConfig';
import { DIMENSION_CONSTRAINTS } from '@/lib/building/types';
import { ThreeScene } from './ThreeScene';
import type { BuildingType, ColorOption, CustomerInfo, LeanTo, Opening, RoofPitch, RoofStyle, WallId } from '@/lib/building/types';

// ═══════════════════════════════════════════════════════════════
// ROOT COMPONENT
// ═══════════════════════════════════════════════════════════════

export default function BuildingDesigner() {
  const searchParams = useSearchParams();
  const dealerId = searchParams.get('dealer') ?? 'default';
  const designParam = searchParams.get('design');
  const initialize = useDesignerStore((s) => s.initialize);
  const loadDesign = useDesignerStore((s) => s.loadDesign);
  const config = useDesignerStore((s) => s.config);
  const isQuoteFormOpen = useDesignerStore((s) => s.isQuoteFormOpen);

  useEffect(() => {
    initialize(dealerId);
    // If a shared design is in the URL, load it
    if (designParam) {
      loadDesign(designParam);
    }
  }, [dealerId, designParam, initialize, loadDesign]);

  if (!config) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <p className="text-gray-500">Initializing...</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-gray-50">
      <Header />
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="order-2 w-full shrink-0 overflow-y-auto border-r bg-white lg:order-1 lg:w-72">
          <ConfigPanel />
        </aside>
        <main className="order-1 min-h-[55vh] flex-1 lg:order-2 lg:min-h-0">
          <ThreeScene />
        </main>
      </div>
      {isQuoteFormOpen && <QuoteFormModal />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// HEADER
// ═══════════════════════════════════════════════════════════════

function Header() {
  const building = useDesignerStore((s) => s.config?.building);
  const pricing = useDesignerStore((s) => s.config?.pricing);
  const openQuoteForm = useDesignerStore((s) => s.openQuoteForm);
  const saveDesign = useDesignerStore((s) => s.saveDesign);
  const [shareMsg, setShareMsg] = useState('');

  const handleShare = useCallback(() => {
    const encoded = saveDesign();
    if (!encoded) return;
    const url = `${window.location.origin}/designer?design=${encoded}`;
    navigator.clipboard.writeText(url).then(() => {
      setShareMsg('Copied!');
      setTimeout(() => setShareMsg(''), 2000);
    }).catch(() => {
      window.prompt('Copy this link:', url);
    });
  }, [saveDesign]);

  return (
    <header className="flex h-13 shrink-0 items-center justify-between border-b bg-gray-900 px-4 py-2">
      <div className="flex items-center gap-3">
        <h1 className="text-base font-bold text-white">Steel Sync</h1>
        {pricing && (
          <>
            <span className="text-gray-500">|</span>
            <span className="text-sm text-gray-300">
              Estimate: <span className="font-semibold text-white">${pricing.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </span>
          </>
        )}
      </div>
      <div className="flex items-center gap-2">
        <div className="relative">
          <button onClick={handleShare} className="rounded border border-gray-600 px-3 py-1 text-xs text-gray-300 hover:border-gray-400 hover:text-white">
            {shareMsg || 'Share'}
          </button>
        </div>
        <button
          onClick={openQuoteForm}
          className="rounded bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-500"
        >
          Get Quote
        </button>
      </div>
    </header>
  );
}

// ═══════════════════════════════════════════════════════════════
// CONFIG PANEL — left sidebar with all controls
// ═══════════════════════════════════════════════════════════════

function ConfigPanel() {
  const config = useDesignerStore((s) => s.config);
  if (!config) return null;

  return (
    <div className="divide-y">
      <AIConfigInput />
      <BuildingTypeSection />
      <DimensionSection />
      <RoofSection />
      <ColorSection />
      <OpeningSection />
      <LeanToSection />
      <OptionsSection />
    </div>
  );
}

// ── AI Config Input ─────────────────────────────────────────

function AIConfigInput() {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const applyAIConfig = useDesignerStore((s) => s.applyAIConfig);

  const handleSubmit = useCallback(async () => {
    if (!input.trim() || loading) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/ai-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: input.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      const config = await res.json();
      applyAIConfig(config);
      setInput('');
    } catch (err: any) {
      setError(err.message || 'Failed to generate config');
    } finally {
      setLoading(false);
    }
  }, [input, loading, applyAIConfig]);

  return (
    <div className="px-4 py-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
        Describe Your Building
      </div>
      <div className="flex gap-1.5">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          placeholder="e.g. 18x40x10 enclosed, 3 windows, 10x10 roll-up door"
          className="flex-1 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs placeholder:text-gray-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
          disabled={loading}
        />
        <button
          onClick={handleSubmit}
          disabled={loading || !input.trim()}
          className="shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:bg-gray-300"
        >
          {loading ? '...' : 'Go'}
        </button>
      </div>
      {error && <p className="mt-1 text-[10px] text-red-500">{error}</p>}
      <p className="mt-1.5 text-[10px] text-gray-400">
        AI will configure dimensions, doors, windows, and colors from your description
      </p>
    </div>
  );
}

// ── Building Type ───────────────────────────────────────────

const BUILDING_TYPES: { value: BuildingType; label: string; icon: string }[] = [
  { value: 'garage', label: 'Garage', icon: 'M4 20V10L12 4L20 10V20H14V14H10V20Z' },
  { value: 'carport', label: 'Carport', icon: 'M4 18V16H6V10L12 5L18 10V16H20V18ZM9 16H15V10.5L12 8L9 10.5Z' },
  { value: 'barn', label: 'Barn', icon: 'M4 20V10L8 6L12 4L16 6L20 10V20H14V14H10V20Z' },
  { value: 'shop', label: 'Shop', icon: 'M3 20V9L12 3L21 9V20H15V13H9V20ZM10 9H14V7H10Z' },
  { value: 'warehouse', label: 'Warehouse', icon: 'M2 20V10L12 4L22 10V20ZM6 16H10V12H6ZM14 16H18V12H14Z' },
  { value: 'rv-cover', label: 'RV Cover', icon: 'M3 18V16H5V10L12 5L19 10V16H21V18ZM8 16H16V11L12 8L8 11Z' },
];

function BuildingTypeSection() {
  const buildingType = useDesignerStore((s) => s.config!.building.type);
  const update = useDesignerStore((s) => s.updateBuilding);

  return (
    <Section title="Building Type" defaultOpen>
      <div className="grid grid-cols-3 gap-1.5">
        {BUILDING_TYPES.map(opt => (
          <button
            key={opt.value}
            onClick={() => update({ type: opt.value })}
            className={`flex flex-col items-center gap-1 rounded-lg border p-2 transition ${
              buildingType === opt.value
                ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-400'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d={opt.icon} stroke={buildingType === opt.value ? '#2563eb' : '#9ca3af'} strokeWidth="1.5" fill="none" />
            </svg>
            <span className={`text-[10px] font-medium ${buildingType === opt.value ? 'text-blue-700' : 'text-gray-500'}`}>
              {opt.label}
            </span>
          </button>
        ))}
      </div>
    </Section>
  );
}

// ── Dimensions ──────────────────────────────────────────────

function DimensionSection() {
  const b = useDesignerStore((s) => s.config!.building);
  const update = useDesignerStore((s) => s.updateBuilding);
  const c = DIMENSION_CONSTRAINTS;

  return (
    <Section title="Dimensions" defaultOpen>
      <Slider label="Width" value={b.widthFt} {...c.width} unit="ft" onChange={v => update({ widthFt: v })} />
      <Slider label="Length" value={b.lengthFt} {...c.length} unit="ft" onChange={v => update({ lengthFt: v })} />
      <Slider label="Leg Height" value={b.legHeightFt} {...c.legHeight} unit="ft" onChange={v => update({ legHeightFt: v })} />
    </Section>
  );
}

// ── Roof Style ──────────────────────────────────────────────

function RoofSection() {
  const roofStyle = useDesignerStore((s) => s.config!.building.roofStyle);
  const roofPitch = useDesignerStore((s) => s.config!.building.roofPitch);
  const wallPanelDir = useDesignerStore((s) => s.config!.building.panelDirection.walls);
  const panelDirection = useDesignerStore((s) => s.config!.building.panelDirection);
  const update = useDesignerStore((s) => s.updateBuilding);

  const options: { value: RoofStyle; label: string; desc: string }[] = [
    { value: 'regular', label: 'Regular', desc: 'Economy — rounded profile' },
    { value: 'aframe', label: 'A-Frame', desc: 'Boxed eave — classic look' },
    { value: 'vertical', label: 'Vertical', desc: 'Premium — best rain/snow shed' },
  ];

  const pitches: RoofPitch[] = ['2:12', '3:12', '4:12', '5:12', '6:12'];

  return (
    <Section title="Roof Style" defaultOpen>
      <div className="space-y-2">
        {options.map(opt => (
          <button
            key={opt.value}
            onClick={() => update({ roofStyle: opt.value })}
            className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition ${
              roofStyle === opt.value
                ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <RoofIcon style={opt.value} active={roofStyle === opt.value} />
            <div>
              <div className="text-sm font-medium text-gray-900">{opt.label}</div>
              <div className="text-xs text-gray-500">{opt.desc}</div>
            </div>
          </button>
        ))}
      </div>
      <div className="mt-3">
        <div className="mb-1.5 text-xs text-gray-500">Pitch</div>
        <div className="flex gap-1">
          {pitches.map(p => (
            <button
              key={p}
              onClick={() => update({ roofPitch: p })}
              className={`flex-1 rounded border py-1 text-[11px] font-medium transition ${
                roofPitch === p
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3">
        <div className="mb-1.5 text-xs text-gray-500">Wall Panels</div>
        <div className="flex gap-1">
          {(['horizontal', 'vertical'] as const).map(d => (
            <button
              key={d}
              onClick={() => update({ panelDirection: { ...panelDirection, walls: d } })}
              className={`flex-1 rounded border py-1 text-[11px] font-medium transition ${
                wallPanelDir === d
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              {d.charAt(0).toUpperCase() + d.slice(1)}
            </button>
          ))}
        </div>
      </div>
    </Section>
  );
}

function RoofIcon({ style, active }: { style: RoofStyle; active: boolean }) {
  const stroke = active ? '#2563eb' : '#9ca3af';
  const pitches: Record<RoofStyle, number> = { regular: 3, aframe: 6, vertical: 8 };
  const p = pitches[style];
  return (
    <svg width="40" height="28" viewBox="0 0 40 28" fill="none">
      <polyline points={`4,24 4,14 20,${14 - p} 36,14 36,24`} stroke={stroke} strokeWidth="2" fill="none" />
      <line x1="4" y1="24" x2="36" y2="24" stroke={stroke} strokeWidth="2" />
    </svg>
  );
}

// ── Colors ──────────────────────────────────────────────────

function ColorSection() {
  const colors = useDesignerStore((s) => s.config!.colors);
  const setColor = useDesignerStore((s) => s.setColor);
  const wainscotOn = colors.wainscot !== null;

  return (
    <Section title="Colors" defaultOpen>
      <ColorPicker label="Roof" current={colors.roof} onChange={c => setColor('roof', c)} />
      <ColorPicker label="Walls" current={colors.walls} onChange={c => setColor('walls', c)} />
      <ColorPicker label="Trim" current={colors.trim} onChange={c => setColor('trim', c)} />

      {/* Wainscot toggle */}
      <div className="mb-2 flex items-center justify-between rounded-md bg-gray-50 px-3 py-2">
        <span className="text-sm text-gray-600">Wainscot</span>
        <button
          onClick={() => setColor('wainscot', wainscotOn ? null : findColor('barn-red'))}
          className={`relative h-5 w-9 rounded-full transition ${wainscotOn ? 'bg-blue-500' : 'bg-gray-300'}`}
        >
          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${wainscotOn ? 'left-[18px]' : 'left-0.5'}`} />
        </button>
      </div>
      {wainscotOn && colors.wainscot && (
        <ColorPicker label="Wainscot" current={colors.wainscot} onChange={c => setColor('wainscot', c)} />
      )}
    </Section>
  );
}

function ColorPicker({ label, current, onChange }: {
  label: string; current: ColorOption; onChange: (c: ColorOption) => void;
}) {
  return (
    <div className="mb-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        <span className="flex items-center gap-1.5 text-xs text-gray-500">
          <span
            className="inline-block h-3 w-3 rounded-sm border border-gray-300"
            style={{ backgroundColor: current.hex }}
          />
          {current.name}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1">
        {STANDARD_COLORS.map(c => (
          <button
            key={c.id}
            title={c.name}
            onClick={() => onChange(c)}
            className={`flex flex-col items-center gap-0.5 rounded-md border p-1 transition ${
              c.id === current.id
                ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-400'
                : 'border-transparent hover:border-gray-200 hover:bg-gray-50'
            }`}
          >
            <div
              className="h-6 w-full rounded border border-gray-200"
              style={{ backgroundColor: c.hex }}
            />
            <span className={`truncate w-full text-center text-[9px] leading-tight ${
              c.id === current.id ? 'font-semibold text-blue-700' : 'text-gray-500'
            }`}>
              {c.name}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Openings (Doors & Windows) ──────────────────────────────

function OpeningSection() {
  const openings = useDesignerStore((s) => s.config!.openings);
  const addOpening = useDesignerStore((s) => s.addOpening);
  const removeOpening = useDesignerStore((s) => s.removeOpening);
  const updateOpening = useDesignerStore((s) => s.updateOpening);
  const selectedId = useDesignerStore((s) => s.selectedOpeningId);
  const selectOpening = useDesignerStore((s) => s.selectOpening);

  const handleAdd = useCallback((type: Opening['type']) => {
    const id = `${type}_${Date.now()}`;
    const defaults: Record<Opening['type'], Omit<Opening, 'id'>> = {
      rollup:   { type: 'rollup',   widthFt: 10, heightFt: 10, wall: 'front', positionFt: 3, color: null },
      walkin:   { type: 'walkin',    widthFt: 3,  heightFt: 7,  wall: 'front', positionFt: 2, color: null },
      window:   { type: 'window',    widthFt: 3,  heightFt: 3,  wall: 'left',  positionFt: 10, color: null },
      frameout: { type: 'frameout',  widthFt: 10, heightFt: 10, wall: 'front', positionFt: 3, color: null },
    };
    addOpening({ id, ...defaults[type] });
  }, [addOpening]);

  return (
    <Section title="Doors & Windows" defaultOpen>
      {/* Existing openings */}
      {openings.length === 0 && (
        <p className="mb-2 text-xs text-gray-400">No openings added yet.</p>
      )}
      {openings.map(op => (
        <div key={op.id} onClick={() => selectOpening(op.id)}
          className={`mb-2 flex cursor-pointer items-center gap-2 rounded-md border p-2 transition ${
            selectedId === op.id ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-400' : 'border-gray-200 hover:border-gray-300'
          }`}>
          <div className="flex-1">
            <div className="text-xs font-medium text-gray-800">
              {op.type === 'rollup' ? 'Roll-Up Door' : op.type === 'walkin' ? 'Walk-In Door' : op.type === 'window' ? 'Window' : 'Frame-Out'}
            </div>
            <div className="mt-0.5 flex gap-2 text-[10px] text-gray-500">
              <span>{op.widthFt}x{op.heightFt}ft</span>
              <span>|</span>
              <select
                value={op.wall}
                onChange={e => updateOpening(op.id, { wall: e.target.value as WallId })}
                className="bg-transparent text-[10px]"
              >
                <option value="front">Front</option>
                <option value="back">Back</option>
                <option value="left">Left</option>
                <option value="right">Right</option>
              </select>
              <span>|</span>
              <label className="flex items-center gap-1">
                Pos:
                <input
                  type="number"
                  value={op.positionFt}
                  onChange={e => updateOpening(op.id, { positionFt: Number(e.target.value) })}
                  className="w-10 bg-transparent text-[10px]"
                  min={0}
                  step={1}
                />
                ft
              </label>
            </div>
          </div>
          <button
            onClick={() => removeOpening(op.id)}
            className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500"
            title="Remove"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 14 14">
              <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
        </div>
      ))}

      {/* Add buttons */}
      <div className="mt-2 grid grid-cols-2 gap-2">
        {([
          ['rollup', 'Roll-Up Door'],
          ['walkin', 'Walk-In Door'],
          ['window', 'Window'],
        ] as const).map(([type, label]) => (
          <button
            key={type}
            onClick={() => handleAdd(type)}
            className="flex items-center justify-center gap-1 rounded-md border border-dashed border-gray-300 px-2 py-1.5 text-xs text-gray-500 hover:border-blue-400 hover:text-blue-600"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 12 12">
              <path d="M6 2V10M2 6H10" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            {label}
          </button>
        ))}
      </div>
    </Section>
  );
}

// ── Lean-Tos ──────────────────────────────────────────────

function LeanToSection() {
  const leanTos = useDesignerStore((s) => s.config!.leanTos);
  const colors = useDesignerStore((s) => s.config!.colors);
  const building = useDesignerStore((s) => s.config!.building);
  const addLeanTo = useDesignerStore((s) => s.addLeanTo);
  const removeLeanTo = useDesignerStore((s) => s.removeLeanTo);

  const handleAdd = useCallback((wall: WallId) => {
    const lt: LeanTo = {
      id: `lean_${Date.now()}`,
      wall,
      widthFt: 10,
      lengthFt: building.lengthFt,
      heightFt: Math.min(building.legHeightFt - 2, 8),
      roofColor: colors.roof,
      wallColor: colors.walls,
      openings: [],
    };
    addLeanTo(lt);
  }, [addLeanTo, building, colors]);

  // Walls that already have a lean-to
  const usedWalls = new Set(leanTos.map(lt => lt.wall));

  return (
    <Section title="Lean-Tos">
      {leanTos.length === 0 && (
        <p className="mb-2 text-xs text-gray-400">No lean-tos added yet.</p>
      )}
      {leanTos.map(lt => (
        <div key={lt.id} className="mb-2 flex items-center gap-2 rounded-md border border-gray-200 p-2">
          <div className="flex-1">
            <div className="text-xs font-medium text-gray-800">
              Lean-To ({lt.wall} wall)
            </div>
            <div className="mt-0.5 text-[10px] text-gray-500">
              {lt.widthFt}ft out x {lt.lengthFt}ft long, {lt.heightFt}ft tall
            </div>
          </div>
          <button
            onClick={() => removeLeanTo(lt.id)}
            className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500"
            title="Remove"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 14 14">
              <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
        </div>
      ))}

      <div className="mt-2 grid grid-cols-2 gap-2">
        {(['left', 'right'] as const).map(wall => (
          <button
            key={wall}
            onClick={() => handleAdd(wall)}
            disabled={usedWalls.has(wall)}
            className={`flex items-center justify-center gap-1 rounded-md border border-dashed px-2 py-1.5 text-xs ${
              usedWalls.has(wall)
                ? 'border-gray-200 text-gray-300 cursor-not-allowed'
                : 'border-gray-300 text-gray-500 hover:border-blue-400 hover:text-blue-600'
            }`}
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 12 12">
              <path d="M6 2V10M2 6H10" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            {wall.charAt(0).toUpperCase() + wall.slice(1)} Side
          </button>
        ))}
      </div>
    </Section>
  );
}

// ── Options ─────────────────────────────────────────────────

function OptionsSection() {
  const options = useDesignerStore((s) => s.config!.options);
  const certs = useDesignerStore((s) => s.config!.certifications);
  const updateOptions = useDesignerStore((s) => s.updateOptions);
  const updateCertifications = useDesignerStore((s) => s.updateCertifications);

  return (
    <Section title="Options">
      {/* Insulation */}
      <div className="mb-3">
        <div className="mb-1.5 text-xs font-medium text-gray-600">Insulation</div>
        <div className="flex gap-3">
          {(['roof', 'walls'] as const).map(part => (
            <label key={part} className="flex items-center gap-1.5 text-xs text-gray-700">
              <input
                type="checkbox"
                checked={options.insulation[part]}
                onChange={e => updateOptions({
                  insulation: { ...options.insulation, [part]: e.target.checked },
                })}
                className="h-3.5 w-3.5 rounded border-gray-300 accent-blue-600"
              />
              {part.charAt(0).toUpperCase() + part.slice(1)}
            </label>
          ))}
        </div>
      </div>

      {/* Anchoring */}
      <div className="mb-3">
        <div className="mb-1.5 text-xs font-medium text-gray-600">Anchoring</div>
        <div className="flex gap-1">
          {(['ground', 'concrete', 'asphalt'] as const).map(opt => (
            <button
              key={opt}
              onClick={() => updateOptions({ anchoring: opt })}
              className={`flex-1 rounded border py-1 text-[11px] font-medium transition ${
                options.anchoring === opt
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              {opt.charAt(0).toUpperCase() + opt.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Installation */}
      <div className="mb-3">
        <div className="mb-1.5 text-xs font-medium text-gray-600">Installation</div>
        <div className="flex gap-1">
          {([['included', 'Included'], ['diy', 'DIY']] as const).map(([val, label]) => (
            <button
              key={val}
              onClick={() => updateOptions({ installation: val })}
              className={`flex-1 rounded border py-1 text-[11px] font-medium transition ${
                options.installation === val
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Certifications */}
      <Slider label="Wind Rating" value={certs.windSpeedMph} min={90} max={170} step={5} unit="mph" onChange={v => updateCertifications({ windSpeedMph: v })} />
      <label className="flex items-center gap-1.5 text-xs text-gray-700">
        <input
          type="checkbox"
          checked={certs.engineered}
          onChange={e => updateCertifications({ engineered: e.target.checked })}
          className="h-3.5 w-3.5 rounded border-gray-300 accent-blue-600"
        />
        Engineered Drawings
      </label>
    </Section>
  );
}

// ═══════════════════════════════════════════════════════════════
// PRICE SUMMARY — right sidebar
// ═══════════════════════════════════════════════════════════════

function PriceSummary() {
  const pricing = useDesignerStore((s) => s.config?.pricing);
  const openQuoteForm = useDesignerStore((s) => s.openQuoteForm);

  return (
    <div className="flex h-full flex-col p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
        Price Estimate
      </h2>

      {pricing ? (
        <div className="flex-1 space-y-1.5">
          {pricing.lineItems.map((item, i) => (
            <div key={i} className="flex justify-between text-xs">
              <span className="text-gray-600">{item.label}</span>
              <span className="font-medium text-gray-800">
                ${item.amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              </span>
            </div>
          ))}
          <div className="!mt-3 border-t pt-2">
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">Tax ({(pricing.taxRate * 100).toFixed(2)}%)</span>
              <span className="text-gray-700">${pricing.tax.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
          </div>
          <div className="!mt-2 flex justify-between text-base font-bold">
            <span className="text-gray-900">Total</span>
            <span className="text-blue-700">
              ${pricing.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
          </div>
        </div>
      ) : (
        <p className="text-xs text-gray-400">Configure your building to see pricing.</p>
      )}

      <button
        onClick={openQuoteForm}
        className="mt-4 w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 active:bg-blue-800"
      >
        Get Your Quote
      </button>
      <p className="mt-2 text-center text-[10px] text-gray-400">
        No obligation. A dealer will follow up within 24 hours.
      </p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MOBILE BOTTOM BAR
// ═══════════════════════════════════════════════════════════════

function MobileBottomBar() {
  const pricing = useDesignerStore((s) => s.config?.pricing);
  const openQuoteForm = useDesignerStore((s) => s.openQuoteForm);

  return (
    <div className="flex items-center justify-between border-t bg-white px-4 py-2.5 xl:hidden">
      <div>
        <p className="text-[10px] text-gray-500">Estimated Total</p>
        <p className="text-base font-bold text-gray-900">
          {pricing ? `$${pricing.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '---'}
        </p>
      </div>
      <button
        onClick={openQuoteForm}
        className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white"
      >
        Get Quote
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// QUOTE FORM MODAL
// ═══════════════════════════════════════════════════════════════

function QuoteFormModal() {
  const closeQuoteForm = useDesignerStore((s) => s.closeQuoteForm);
  const submitQuote = useDesignerStore((s) => s.submitQuote);
  const pricing = useDesignerStore((s) => s.config?.pricing);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [form, setForm] = useState<CustomerInfo>({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    zipCode: '',
    timeline: 'asap',
    notes: '',
  });

  const update = useCallback((field: keyof CustomerInfo, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setErrors(prev => { const next = { ...prev }; delete next[field]; return next; });
  }, []);

  const validate = useCallback((): boolean => {
    const errs: Record<string, string> = {};
    if (!form.firstName.trim()) errs.firstName = 'Required';
    if (!form.email.trim()) errs.email = 'Required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = 'Invalid email';
    if (!form.phone.trim()) errs.phone = 'Required';
    else if (form.phone.replace(/\D/g, '').length < 10) errs.phone = 'Enter 10+ digits';
    if (!form.zipCode.trim()) errs.zipCode = 'Required';
    else if (!/^\d{5}(-\d{4})?$/.test(form.zipCode)) errs.zipCode = 'Invalid zip';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }, [form]);

  const handleSubmit = useCallback(async () => {
    if (!validate()) return;
    setSubmitting(true);
    await submitQuote(form);
    setSubmitting(false);
    setSubmitted(true);
  }, [validate, submitQuote, form]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') closeQuoteForm(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [closeQuoteForm]);

  if (submitted) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={closeQuoteForm}>
        <div className="mx-4 w-full max-w-md rounded-xl bg-white p-8 text-center shadow-2xl" onClick={e => e.stopPropagation()}>
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
            <svg className="h-7 w-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h3 className="mb-2 text-lg font-bold text-gray-900">Quote Submitted!</h3>
          <p className="mb-6 text-sm text-gray-500">A dealer will follow up within 24 hours.</p>
          <button onClick={closeQuoteForm} className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-semibold text-white hover:bg-blue-700">
            Back to Designer
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={closeQuoteForm}>
      <div className="mx-4 w-full max-w-lg rounded-xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h3 className="text-lg font-bold text-gray-900">Get Your Free Quote</h3>
            {pricing && (
              <p className="text-sm text-gray-500">
                Estimated total: <span className="font-semibold text-blue-600">${pricing.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              </p>
            )}
          </div>
          <button onClick={closeQuoteForm} className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 20 20">
              <path d="M5 5L15 15M15 5L5 15" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
        </div>
        <div className="space-y-4 px-6 py-5">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="First Name" value={form.firstName} error={errors.firstName} onChange={v => update('firstName', v)} />
            <FormField label="Last Name" value={form.lastName} error={errors.lastName} onChange={v => update('lastName', v)} />
          </div>
          <FormField label="Email" type="email" value={form.email} error={errors.email} onChange={v => update('email', v)} />
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Phone" type="tel" value={form.phone} error={errors.phone} onChange={v => update('phone', v)} />
            <FormField label="Zip Code" value={form.zipCode} error={errors.zipCode} onChange={v => update('zipCode', v)} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Timeline</label>
            <select
              value={form.timeline}
              onChange={e => update('timeline', e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="asap">As Soon As Possible</option>
              <option value="1-3 months">1-3 Months</option>
              <option value="3-6 months">3-6 Months</option>
              <option value="6-12 months">6-12 Months</option>
              <option value="just-browsing">Just Browsing</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Notes <span className="text-gray-400">(optional)</span></label>
            <textarea
              value={form.notes}
              onChange={e => update('notes', e.target.value)}
              rows={2}
              className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="Any special requirements..."
            />
          </div>
        </div>
        <div className="border-t px-6 py-4">
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 active:bg-blue-800 disabled:bg-blue-400"
          >
            {submitting ? 'Submitting...' : 'Submit Quote Request'}
          </button>
          <p className="mt-2 text-center text-[10px] text-gray-400">
            No obligation. Your information is only shared with your local dealer.
          </p>
        </div>
      </div>
    </div>
  );
}

function FormField({ label, value, error, type = 'text', onChange }: {
  label: string; value: string; error?: string; type?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 ${
          error
            ? 'border-red-300 focus:border-red-500 focus:ring-red-500'
            : 'border-gray-300 focus:border-blue-500 focus:ring-blue-500'
        }`}
      />
      {error && <p className="mt-0.5 text-xs text-red-500">{error}</p>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SHARED UI ATOMS
// ═══════════════════════════════════════════════════════════════

function Section({ title, defaultOpen = false, children }: {
  title: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="px-4 py-3">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between"
      >
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">{title}</h3>
        <svg className={`h-4 w-4 text-gray-400 transition ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 16 16">
          <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

function Slider({ label, value, min, max, step, unit, onChange }: {
  label: string; value: number; min: number; max: number;
  step: number; unit: string; onChange: (v: number) => void;
}) {
  return (
    <div className="mb-3">
      <div className="mb-1 flex items-baseline justify-between">
        <label className="text-sm text-gray-600">{label}</label>
        <div className="flex items-baseline gap-1">
          <input
            type="number"
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={e => {
              const v = Number(e.target.value);
              if (v >= min && v <= max) onChange(v);
            }}
            className="w-12 rounded border border-gray-200 px-1 py-0.5 text-right text-sm font-semibold text-gray-900"
          />
          <span className="text-xs text-gray-400">{unit}</span>
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full accent-blue-600"
      />
      <div className="flex justify-between text-[10px] text-gray-400">
        <span>{min}{unit}</span>
        <span>{max}{unit}</span>
      </div>
    </div>
  );
}
