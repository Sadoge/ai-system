import type { Db } from '@ai-system/db';
import type { AgentExecutionActivity } from '@ai-system/agent-execution';
import type { StageKind } from '@ai-system/domain';
import { applyEvent } from '@ai-system/orchestration';

export interface ActivityScope {
  runId: string;
  stage?: StageKind;
  stageExecutionId?: string;
  taskId?: string;
  agentRunId?: string;
}

export async function reportActivity(
  db: Db,
  scope: ActivityScope,
  activity: { kind: 'stage' | AgentExecutionActivity['kind']; message: string },
): Promise<void> {
  await applyEvent(db, {
    name: 'run.activity',
    payload: {
      runId: scope.runId,
      ...(scope.stage ? { stage: scope.stage } : {}),
      ...(scope.stageExecutionId ? { stageExecutionId: scope.stageExecutionId } : {}),
      ...(scope.taskId ? { taskId: scope.taskId } : {}),
      ...(scope.agentRunId ? { agentRunId: scope.agentRunId } : {}),
      kind: activity.kind,
      message: activity.message,
    },
  });
}

export function agentActivityReporter(db: Db, scope: ActivityScope) {
  return (activity: AgentExecutionActivity) => reportActivity(db, scope, activity);
}
