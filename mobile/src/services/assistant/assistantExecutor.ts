import {
  assistantRunRepo,
  assistantStepRepo,
} from '../../db/repositories';
import type {
  AssistantRunStatus,
  AssistantStepRecord,
  AssistantStepStatus,
} from '../../types';
import { capabilityRegistry } from './capabilityRegistry';
import type {
  CommandPlan,
  CommandStep,
  ExecutorContext,
  PlanExecutionResult,
  StepResult,
} from './types';
import {
  buildExecutionReply,
  isAffirmation,
  isCancellation,
  shouldRequireConfirmation,
  summarizeStepLabel,
} from './utils';

const determineRunStatus = (results: StepResult[]): AssistantRunStatus => {
  if (results.some((result) => result.status === 'needs_confirmation')) {
    return 'awaiting_confirmation';
  }

  if (results.every((result) => result.status === 'cancelled')) {
    return 'cancelled';
  }

  if (results.some((result) => result.status === 'failed' || result.status === 'blocked_by_permission')) {
    return results.some((result) => result.status === 'verified' || result.status === 'unverified')
      ? 'partial'
      : 'failed';
  }

  if (results.some((result) => result.status === 'unverified')) {
    return 'partial';
  }

  if (results.some((result) => result.status === 'verified')) {
    return 'completed';
  }

  return 'pending';
};

const toStepRecord = (
  runId: string,
  step: CommandStep,
  index: number
): AssistantStepRecord => ({
  id: step.id,
  runId,
  stepIndex: index,
  namespace: step.namespace,
  command: step.command,
  humanSummary: step.humanSummary,
  params: step.params,
  dependsOn: step.dependsOn,
  confirmationPolicy: step.confirmationPolicy,
  verificationMode: step.verificationMode,
  status: 'pending',
  evidence: null,
  error: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

const toCommandStep = (record: AssistantStepRecord): CommandStep => ({
  id: record.id,
  namespace: record.namespace as CommandStep['namespace'],
  command: record.command,
  humanSummary: record.humanSummary,
  params: record.params,
  dependsOn: record.dependsOn,
  confirmationPolicy: record.confirmationPolicy as CommandStep['confirmationPolicy'],
  verificationMode: record.verificationMode as CommandStep['verificationMode'],
});

const mergeEvidence = (
  current: Record<string, unknown> | null | undefined,
  next: Record<string, unknown> | null | undefined
): Record<string, unknown> | null => {
  if (!current && !next) {
    return null;
  }

  return {
    ...(current || {}),
    ...(next || {}),
  };
};

const executeStep = async (
  step: CommandStep,
  context: ExecutorContext
): Promise<StepResult> => {
  const capability = capabilityRegistry.get(step.namespace);
  const readContext = capability.readContext
    ? await capability.readContext(step, context)
    : null;

  if (shouldRequireConfirmation(step, context.autonomyMode)) {
    const result: StepResult = {
      stepId: step.id,
      namespace: step.namespace,
      command: step.command,
      status: 'needs_confirmation',
      reply: `Confirm ${summarizeStepLabel(step)}.`,
      evidence: readContext?.data || null,
    };
    assistantStepRepo.updateResult(step.id, result.status, result.evidence, null);
    return result;
  }

  let execution = await capability.execute(step, context);
  execution.evidence = mergeEvidence(readContext?.data, execution.evidence);

  if (
    capability.verify &&
    execution.status !== 'failed' &&
    execution.status !== 'blocked_by_permission' &&
    execution.status !== 'needs_confirmation' &&
    step.verificationMode !== 'none'
  ) {
    execution = await capability.verify(step, execution, context);
  }

  const status =
    execution.status ||
    (step.verificationMode === 'none' ? 'verified' : 'unverified');

  const result: StepResult = {
    stepId: step.id,
    namespace: step.namespace,
    command: step.command,
    status,
    reply: execution.reply,
    evidence: execution.evidence || null,
    error: execution.error || null,
  };

  assistantStepRepo.updateResult(
    step.id,
    result.status,
    result.evidence,
    result.error || null
  );
  return result;
};

const executePlanSteps = async (
  plan: CommandPlan,
  context: ExecutorContext,
  steps: CommandStep[]
): Promise<StepResult[]> => {
  const results: StepResult[] = [];

  for (const step of steps) {
    const dependencyFailure = step.dependsOn.find((dependencyId) => {
      const dependency = [...context.stepResults, ...results].find(
        (item) => item.stepId === dependencyId
      );
      return dependency && dependency.status !== 'verified';
    });

    if (dependencyFailure) {
      const skipped: StepResult = {
        stepId: step.id,
        namespace: step.namespace,
        command: step.command,
        status: 'skipped_dependency',
        reply: `${summarizeStepLabel(step)} was skipped because a dependency did not verify.`,
        evidence: { dependencyFailure },
      };
      assistantStepRepo.updateResult(step.id, skipped.status, skipped.evidence, null);
      results.push(skipped);
      continue;
    }

    const result = await executeStep(step, {
      ...context,
      stepResults: [...context.stepResults, ...results],
    });
    results.push(result);
  }

  return results;
};

export const assistantExecutor = {
  persistPlan: (
    plan: CommandPlan,
    rawText: string,
    source: 'typed' | 'voice',
    autonomyMode: 'safe_auto' | 'auto_everything'
  ): void => {
    const now = new Date().toISOString();
    assistantRunRepo.create({
      id: plan.runId,
      source,
      rawText,
      summary: plan.summary,
      autonomyMode,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    });

    assistantStepRepo.createMany(
      plan.steps.map((step, index) => toStepRecord(plan.runId, step, index))
    );
  },

  executePlan: async (
    plan: CommandPlan,
    rawText: string,
    source: 'typed' | 'voice',
    autonomyMode: 'safe_auto' | 'auto_everything',
    history: ExecutorContext['history']
  ): Promise<PlanExecutionResult> => {
    assistantExecutor.persistPlan(plan, rawText, source, autonomyMode);

    const context: ExecutorContext = {
      runId: plan.runId,
      rawText,
      source,
      history,
      autonomyMode,
      stepResults: [],
    };

    const results = await executePlanSteps(plan, context, plan.steps);
    const status = determineRunStatus(results);
    assistantRunRepo.updateStatus(plan.runId, status);

    return {
      runId: plan.runId,
      status,
      reply: buildExecutionReply(plan.summary, results, status === 'awaiting_confirmation'),
      stepResults: results,
      pendingConfirmation: status === 'awaiting_confirmation',
    };
  },

  cancelPendingRun: (): PlanExecutionResult | null => {
    const pending = assistantRunRepo.getPendingConfirmation();
    if (!pending) {
      return null;
    }

    const results = pending.steps.map<StepResult>((step) => {
      const status: AssistantStepStatus =
        step.status === 'needs_confirmation' ? 'cancelled' : step.status;
      if (step.status === 'needs_confirmation') {
        assistantStepRepo.updateResult(step.id, status, step.evidence, 'Cancelled by user.');
      }
      return {
        stepId: step.id,
        namespace: step.namespace as CommandStep['namespace'],
        command: step.command,
        status,
        reply:
          step.status === 'needs_confirmation'
            ? `${step.humanSummary} was cancelled.`
            : `${step.humanSummary} remained ${step.status}.`,
        evidence: step.evidence,
        error: step.error,
      };
    });

    assistantRunRepo.updateStatus(pending.id, 'cancelled');
    return {
      runId: pending.id,
      status: 'cancelled',
      reply: 'Cancelled the pending command run.',
      stepResults: results,
      pendingConfirmation: false,
    };
  },

  continuePendingRun: async (
    source: 'typed' | 'voice',
    history: ExecutorContext['history']
  ): Promise<PlanExecutionResult | null> => {
    const pending = assistantRunRepo.getPendingConfirmation();
    if (!pending) {
      return null;
    }

    const remainingSteps = pending.steps
      .filter((step) => step.status === 'needs_confirmation')
      .map(toCommandStep);
    const priorResults = pending.steps
      .filter((step) => step.status !== 'needs_confirmation')
      .map<StepResult>((step) => ({
        stepId: step.id,
        namespace: step.namespace as CommandStep['namespace'],
        command: step.command,
        status: step.status,
        reply: step.humanSummary,
        evidence: step.evidence,
        error: step.error,
      }));

    const plan: CommandPlan = {
      runId: pending.id,
      summary: pending.summary,
      steps: remainingSteps,
    };

    const results = await executePlanSteps(
      plan,
      {
        runId: pending.id,
        rawText: pending.rawText,
        source,
        history,
        autonomyMode: 'auto_everything',
        stepResults: priorResults,
      },
      remainingSteps
    );

    const combined = [...priorResults, ...results];
    const status = determineRunStatus(combined);
    assistantRunRepo.updateStatus(pending.id, status);

    return {
      runId: pending.id,
      status,
      reply: buildExecutionReply(pending.summary, combined, status === 'awaiting_confirmation'),
      stepResults: combined,
      pendingConfirmation: status === 'awaiting_confirmation',
    };
  },

  handleConfirmationText: async (
    text: string,
    source: 'typed' | 'voice',
    history: ExecutorContext['history']
  ): Promise<PlanExecutionResult | null> => {
    if (isAffirmation(text)) {
      return assistantExecutor.continuePendingRun(source, history);
    }

    if (isCancellation(text)) {
      return assistantExecutor.cancelPendingRun();
    }

    return null;
  },
};
