import type { ChatMessage, ChatSource } from './chatTypes';
import { assistantOrchestrator } from '../assistant/assistantOrchestrator';

let isInitialized = false;

export type IntentExecutionResult = {
  intent: string;
  params: Record<string, unknown>;
  reply: string;
  metadata?: Record<string, unknown> | null;
};

export const osIntentRouter = {
  initialize: () => {
    if (isInitialized) {
      return;
    }

    isInitialized = true;
    console.log('[Intent Router] Initialized.');
  },

  processText: async (
    text: string,
    history: ChatMessage[],
    source: ChatSource
  ): Promise<IntentExecutionResult> => {
    try {
      const result = await assistantOrchestrator.handleText(text, history, source);
      return {
        intent: result.intent,
        params: { rawText: text },
        reply: result.reply,
        metadata: result.metadata || null,
      };
    } catch (error) {
      console.error('[Intent Router] Execution error:', error);
      return {
        intent: 'assistant.error',
        params: { rawText: text },
        reply: 'Something went wrong processing your request.',
      };
    }
  },
};
