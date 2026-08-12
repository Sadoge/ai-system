export interface DiffArtifactContent {
  diff: string;
  baseBranch?: string;
  branch?: string;
  task?: string;
  stage?: string;
  iteration?: number;
}

export function readDiffArtifactContent(content: unknown): DiffArtifactContent | null {
  if (!content || typeof content !== 'object') return null;
  const value = content as Record<string, unknown>;
  if (typeof value.diff !== 'string') return null;

  return {
    diff: value.diff,
    ...(typeof value.baseBranch === 'string' ? { baseBranch: value.baseBranch } : {}),
    ...(typeof value.branch === 'string' ? { branch: value.branch } : {}),
    ...(typeof value.task === 'string' ? { task: value.task } : {}),
    ...(typeof value.stage === 'string' ? { stage: value.stage } : {}),
    ...(typeof value.iteration === 'number' ? { iteration: value.iteration } : {}),
  };
}
