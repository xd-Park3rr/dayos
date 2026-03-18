import { assistantSettingRepo } from '../../db/repositories';
import type { ChatMessage, ChatSource } from '../ai/chatTypes';
import { aiService } from '../ai/aiService';
import { assistantExecutor } from './assistantExecutor';

export const assistantOrchestrator = {
  handleText: async (
    text: string,
    history: ChatMessage[],
    source: ChatSource
  ): Promise<{
    intent: string;
    reply: string;
    metadata?: Record<string, unknown> | null;
  }> => {
    const confirmation = await assistantExecutor.handleConfirmationText(text, source, history);
    if (confirmation) {
      return {
        intent: 'assistant.confirmation',
        reply: confirmation.reply,
        metadata: {
          runId: confirmation.runId,
          status: confirmation.status,
          stepResults: confirmation.stepResults,
        },
      };
    }

    const plan = await aiService.planCommands(text, history);
    if (plan.steps.length === 0) {
      const coachHistory = history.length > 0
        ? history
        : [{ role: 'user' as const, content: plan.coachPrompt || text }];
      const coachReply = await aiService.chat(coachHistory);
      return {
        intent: 'coach.chat',
        reply: coachReply,
        metadata: {
          runId: plan.runId,
          plannedSteps: [],
        },
      };
    }

    const autonomyMode = assistantSettingRepo.getAutonomyMode();
    const execution = await assistantExecutor.executePlan(
      plan,
      text,
      source,
      autonomyMode,
      history
    );

    return {
      intent: 'assistant.command_plan',
      reply: execution.reply,
      metadata: {
        runId: execution.runId,
        status: execution.status,
        stepResults: execution.stepResults,
        plannedSteps: plan.steps,
      },
    };
  },
};
