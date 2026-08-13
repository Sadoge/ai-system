import { describe, expect, it } from 'vitest';
import {
  SECTION_CAPS,
  capRows,
  defaultSectionOpen,
  isTerminalStatus,
  statusTone,
  summariseRun,
} from './run-detail-view';

describe('run detail status classification', () => {
  it('fails safe for a never-seen status', () => {
    expect(isTerminalStatus('awaiting_something_new')).toBe(false);
    expect(statusTone('awaiting_something_new')).toBe('neutral');
  });
});

describe('summariseRun', () => {
  it('defensively treats missing collections as empty', () => {
    expect(summariseRun({})).toEqual({
      counts: { gates: 0, tasks: 0, artifacts: 0, events: 0 },
      needsAttention: [],
    });
  });

  it('surfaces pending gates and failed or blocked tasks', () => {
    const summary = summariseRun({
      gates: [{ id: 'g1', gate: 'plan approval', status: 'pending' }],
      tasks: [
        { id: 't1', title: 'Failed test', status: 'failed' },
        { id: 't2', title: 'Blocked merge', status: 'blocked' },
      ],
    });
    expect(summary.needsAttention).toEqual([
      { kind: 'gate', id: 'g1', label: 'plan approval' },
      { kind: 'task', id: 't1', label: 'Failed test' },
      { kind: 'task', id: 't2', label: 'Blocked merge' },
    ]);
  });

  it('has no attention items for a clean completed run', () => {
    expect(
      summariseRun({
        gates: [{ id: 'g1', gate: 'plan approval', status: 'approved' }],
        tasks: [{ id: 't1', title: 'Test', status: 'completed' }],
      }).needsAttention,
    ).toEqual([]);
  });
});

describe('defaultSectionOpen', () => {
  const base = { itemCount: 1, needsAttention: [] };

  it('collapses events for a healthy completed run and opens them for a failed run', () => {
    expect(defaultSectionOpen({ ...base, section: 'events', status: 'completed' })).toBe(false);
    expect(defaultSectionOpen({ ...base, section: 'events', status: 'failed' })).toBe(true);
  });

  it('opens gates whenever a gate is pending', () => {
    expect(
      defaultSectionOpen({
        section: 'gates',
        status: 'completed',
        itemCount: 1,
        needsAttention: [{ kind: 'gate', id: 'g1', label: 'plan approval' }],
      }),
    ).toBe(true);
  });
});

describe('capRows', () => {
  const rows = Array.from({ length: SECTION_CAPS.tasks + 2 }, (_, index) => index);

  it('handles under-cap and exact-cap boundaries', () => {
    expect(capRows(rows.slice(0, 3), 4, false)).toEqual({ visible: [0, 1, 2], remaining: 0 });
    expect(capRows(rows.slice(0, 4), 4, false)).toEqual({ visible: [0, 1, 2, 3], remaining: 0 });
  });

  it('reports over-cap rows and returns everything for show all', () => {
    expect(capRows(rows, SECTION_CAPS.tasks, false).remaining).toBe(2);
    expect(capRows(rows, SECTION_CAPS.tasks, true)).toEqual({ visible: rows, remaining: 0 });
  });
});
