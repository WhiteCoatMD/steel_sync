// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import BuildingDesigner from '../BuildingDesigner';
import { useDesignerStore } from '@/lib/store/designerStore';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('../ThreeScene', () => ({ ThreeScene: () => null }));

beforeEach(() => {
  useDesignerStore.getState().initialize('tejasmex');
});
afterEach(() => {
  cleanup();
  useDesignerStore.setState({ isQuoteFormOpen: false, selectedOpeningId: null });
});

describe('the combo type', () => {
  it('is offered in the type picker', () => {
    render(<BuildingDesigner dealerId="tejasmex" dealer={null} />);
    expect(screen.getByRole('button', { name: /combo/i })).toBeTruthy();
  });

  it('shows no depth buttons until a combo is chosen', () => {
    render(<BuildingDesigner dealerId="tejasmex" dealer={null} />);
    expect(screen.queryByRole('group', { name: /enclosed depth/i })).toBeNull();
  });
});

describe('the depth buttons', () => {
  // BuildingDesigner's mount effect calls the store's `initialize`
  // unconditionally (see the useEffect around line 50 of BuildingDesigner.tsx),
  // which replaces `config` with a fresh default building. A store mutation
  // made *before* render() is therefore wiped out the instant the component
  // mounts. BuildingDesigner.rootgate.test.tsx works around the identical
  // issue by driving the store only after render, inside `act()` — this file
  // follows the same convention rather than setting up state in a
  // pre-render beforeEach.
  function makeCombo() {
    act(() => {
      useDesignerStore.getState().updateBuilding({ type: 'combo', lengthFt: 30 });
    });
  }

  it('offers every 5ft step that leaves some carport', () => {
    render(<BuildingDesigner dealerId="tejasmex" dealer={null} />);
    makeCombo();
    const group = screen.getByRole('group', { name: /enclosed depth/i });
    const labels = Array.from(group.querySelectorAll('button')).map(b => b.textContent?.trim());
    expect(labels).toEqual(['5', '10', '15', '20', '25']);
  });

  it('sets the depth when one is tapped', () => {
    render(<BuildingDesigner dealerId="tejasmex" dealer={null} />);
    makeCombo();
    const group = screen.getByRole('group', { name: /enclosed depth/i });
    fireEvent.click(Array.from(group.querySelectorAll('button')).find(b => b.textContent?.trim() === '20')!);
    expect(useDesignerStore.getState().config!.building.combo!.enclosedDepthFt).toBe(20);
  });

  it('marks the chosen depth as pressed', () => {
    render(<BuildingDesigner dealerId="tejasmex" dealer={null} />);
    makeCombo();
    act(() => {
      useDesignerStore.getState().updateBuilding({ combo: { enclosedDepthFt: 15, end: 'front' } });
    });
    const group = screen.getByRole('group', { name: /enclosed depth/i });
    const pressed = Array.from(group.querySelectorAll('button')).filter(
      b => b.getAttribute('aria-pressed') === 'true',
    );
    expect(pressed).toHaveLength(1);
    expect(pressed[0].textContent?.trim()).toBe('15');
  });
});
