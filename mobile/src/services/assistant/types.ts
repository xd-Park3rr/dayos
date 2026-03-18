import type { ChatMessage, ChatSource } from '../ai/chatTypes';
import type {
  AssistantAutonomyMode,
  AssistantStepStatus,
} from '../../types';

export type AssistantNamespace =
  | 'calendar'
  | 'task'
  | 'activity'
  | 'insight'
  | 'contacts'
  | 'communication'
  | 'app'
  | 'permission';

export type ConfirmationPolicy =
  | 'auto'
  | 'always'
  | 'destructive'
  | 'outbound';

export type VerificationMode =
  | 'none'
  | 'read_after_write'
  | 'intent_launch'
  | 'local_record';

export interface CommandStep {
  id: string;
  namespace: AssistantNamespace;
  command: string;
  humanSummary: string;
  params: Record<string, unknown>;
  dependsOn: string[];
  confirmationPolicy: ConfirmationPolicy;
  verificationMode: VerificationMode;
}

export interface CommandPlan {
  runId: string;
  summary: string;
  steps: CommandStep[];
  coachPrompt?: string | null;
}

export interface StepResult {
  stepId: string;
  namespace: AssistantNamespace;
  command: string;
  status: AssistantStepStatus;
  reply: string;
  evidence: Record<string, unknown> | null;
  error?: string | null;
}

export interface ExecutorContext {
  runId: string;
  rawText: string;
  source: ChatSource;
  history: ChatMessage[];
  autonomyMode: AssistantAutonomyMode;
  stepResults: StepResult[];
}

export interface CapabilityReadResult {
  summary: string;
  data: Record<string, unknown> | null;
}

export interface CapabilityExecutionResult {
  reply: string;
  status?: AssistantStepStatus;
  evidence?: Record<string, unknown> | null;
  error?: string | null;
}

export interface AssistantCapability {
  namespace: AssistantNamespace;
  readContext?: (
    step: CommandStep,
    context: ExecutorContext
  ) => Promise<CapabilityReadResult | null>;
  execute: (
    step: CommandStep,
    context: ExecutorContext
  ) => Promise<CapabilityExecutionResult>;
  verify?: (
    step: CommandStep,
    execution: CapabilityExecutionResult,
    context: ExecutorContext
  ) => Promise<CapabilityExecutionResult>;
}

export interface PlanExecutionResult {
  runId: string;
  status: 'pending' | 'completed' | 'partial' | 'awaiting_confirmation' | 'failed' | 'cancelled';
  reply: string;
  stepResults: StepResult[];
  pendingConfirmation: boolean;
}
