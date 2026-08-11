import { describe, expect, it } from 'vitest';
import { filterRuns, parseStatusParam, statusBucket } from '../src/lib/run-filters';

interface RunFixture {
  id: string;
  status: string;
  ticket: {
    title?: string | null;
    externalKey?: string | null;
  };
}

const runs: RunFixture[] = [
  {
    id: '1',
    status: 'created',
    ticket: { title: 'Add multiply function', externalKey: 'ENG-123' },
  },
  {
    id: '2',
    status: 'awaiting_plan_approval',
    ticket: { title: 'Document API', externalKey: 'DOC-9' },
  },
  { id: '3', status: 'paused', ticket: { title: 'Retry imports', externalKey: 'OPS-42' } },
  { id: '4', status: 'failed', ticket: { title: 'Repair checkout', externalKey: 'ENG-404' } },
  { id: '5', status: 'completed', ticket: { title: 'Ship search', externalKey: 'WEB-81' } },
  { id: '6', status: 'cancelled', ticket: { title: 'Old task', externalKey: 'OLD-1' } },
  { id: '7', status: 'future_status', ticket: { title: 'Future task', externalKey: 'FUT-1' } },
];

describe('filterRuns search', () => {
  it('matches ticket titles case-insensitively and trims whitespace', () => {
    expect(filterRuns(runs, { query: '  MULTIPLY  ', status: 'all' }).map((run) => run.id)).toEqual(
      ['1'],
    );
  });

  it('matches external keys case-insensitively', () => {
    expect(filterRuns(runs, { query: 'eng-404', status: 'all' }).map((run) => run.id)).toEqual([
      '4',
    ]);
  });

  it('returns no runs for a query that does not match', () => {
    expect(filterRuns(runs, { query: 'not here', status: 'all' })).toEqual([]);
  });

  it('tolerates null and undefined searchable fields', () => {
    const incomplete: RunFixture[] = [
      { id: 'null-fields', status: 'created', ticket: { title: null, externalKey: null } },
      {
        id: 'undefined-fields',
        status: 'created',
        ticket: {},
      },
    ];

    expect(filterRuns(incomplete, { query: 'anything', status: 'all' })).toEqual([]);
  });
});

describe('filterRuns status buckets', () => {
  it('maps every declared non-terminal status to running', () => {
    const nonTerminal = [
      'created',
      'classifying',
      'awaiting_split',
      'researching',
      'planning',
      'awaiting_plan_approval',
      'decomposing',
      'executing',
      'integrating',
      'awaiting_pre_merge',
      'reviewing',
      'testing',
      'awaiting_iteration_gate',
      'documenting',
      'packaging',
      'awaiting_final_approval',
      'paused',
    ];

    expect(nonTerminal.map(statusBucket)).toEqual(nonTerminal.map(() => 'running'));
  });

  it('returns only running runs', () => {
    expect(filterRuns(runs, { query: '', status: 'running' }).map((run) => run.id)).toEqual([
      '1',
      '2',
      '3',
      '7',
    ]);
  });

  it('returns only failed runs', () => {
    expect(filterRuns(runs, { query: '', status: 'failed' }).map((run) => run.id)).toEqual(['4']);
  });

  it('returns only completed runs', () => {
    expect(filterRuns(runs, { query: '', status: 'completed' }).map((run) => run.id)).toEqual([
      '5',
    ]);
  });

  it('keeps cancelled in All but leaves it out of the named buckets', () => {
    expect(statusBucket('cancelled')).toBeNull();
    expect(filterRuns(runs, { query: '', status: 'all' })).toEqual(runs);
  });

  it('defaults an unknown future status to running', () => {
    expect(statusBucket('future_status')).toBe('running');
  });

  it('combines query and status conditions', () => {
    expect(filterRuns(runs, { query: 'ENG', status: 'failed' }).map((run) => run.id)).toEqual([
      '4',
    ]);
    expect(filterRuns(runs, { query: 'ENG', status: 'completed' })).toEqual([]);
  });

  it('returns the full input when filters are cleared', () => {
    expect(filterRuns(runs, { query: '   ', status: 'all' })).toEqual(runs);
  });
});

describe('parseStatusParam', () => {
  it.each(['all', 'running', 'failed', 'completed'] as const)('passes through %s', (status) => {
    expect(parseStatusParam(status)).toBe(status);
  });

  it('falls back to all for a missing value', () => {
    expect(parseStatusParam(null)).toBe('all');
  });

  it('falls back to all for an unrecognized value', () => {
    expect(parseStatusParam('garbage')).toBe('all');
  });
});
