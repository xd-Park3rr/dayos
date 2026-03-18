import { bus } from '../../events/bus';
import type { JarvisSessionState } from '../../types';
import { useChatStore } from '../../store';
import type { ChatMessage } from './chatTypes';
import { osIntentRouter } from './osIntentRouter';
import { sttService } from './sttService';
import { ttsService } from './ttsService';
import { wakeWordService } from './wakeWordService';

type JarvisStatus = {
  routerReady: boolean;
  sttReady: boolean;
  wakeWordReady: boolean;
  sessionState: JarvisSessionState;
};

let isInitialized = false;
let activeSessionId: string | null = null;
let sessionState: JarvisSessionState = 'idle';
let activeVoiceTask: Promise<void> | null = null;
let manualOverrideText: string | null = null;
let voiceBootstrapRetryTimer: ReturnType<typeof setTimeout> | null = null;
let voiceBootstrapRetryIndex = 0;

const VOICE_BOOTSTRAP_RETRY_DELAYS_MS = [1500, 4000, 8000];

let status: JarvisStatus = {
  routerReady: false,
  sttReady: false,
  wakeWordReady: false,
  sessionState,
};

const createSessionId = (): string =>
  `jarvis-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const clearVoiceBootstrapRetry = () => {
  if (!voiceBootstrapRetryTimer) {
    return;
  }

  clearTimeout(voiceBootstrapRetryTimer);
  voiceBootstrapRetryTimer = null;
};

const refreshVoiceServices = async (): Promise<{
  sttReady: boolean;
  wakeWordReady: boolean;
}> => {
  const sttReady = await sttService.initialize();
  const wakeWordReady =
    !activeVoiceTask && sessionState === 'idle'
      ? await wakeWordService.startListening()
      : status.wakeWordReady;

  status = {
    ...status,
    sttReady,
    wakeWordReady,
  };

  return { sttReady, wakeWordReady };
};

const scheduleVoiceBootstrapRetry = () => {
  if (voiceBootstrapRetryTimer || voiceBootstrapRetryIndex >= VOICE_BOOTSTRAP_RETRY_DELAYS_MS.length) {
    return;
  }

  const delayMs = VOICE_BOOTSTRAP_RETRY_DELAYS_MS[voiceBootstrapRetryIndex];
  voiceBootstrapRetryIndex += 1;
  voiceBootstrapRetryTimer = setTimeout(() => {
    voiceBootstrapRetryTimer = null;
    void (async () => {
      const next = await refreshVoiceServices();
      console.log('[Jarvis] Voice bootstrap retry', {
        attempt: voiceBootstrapRetryIndex,
        ...next,
      });

      if (!next.sttReady || !next.wakeWordReady) {
        scheduleVoiceBootstrapRetry();
        return;
      }

      voiceBootstrapRetryIndex = 0;
    })();
  }, delayMs);
};

const setSessionState = (nextState: JarvisSessionState) => {
  sessionState = nextState;
  status = { ...status, sessionState };
  bus.emit('jarvis.state_changed', {
    state: nextState,
    sessionId: activeSessionId,
  });
  console.log('[Jarvis] State', nextState, activeSessionId ? `(${activeSessionId})` : '');
};

const finishVoiceSession = async () => {
  activeVoiceTask = null;
  activeSessionId = null;
  setSessionState('idle');
  bus.emit('jarvis.idle', undefined);
  const wakeWordReady = await wakeWordService.startListening();
  status = { ...status, wakeWordReady };
  if (!wakeWordReady || !status.sttReady) {
    scheduleVoiceBootstrapRetry();
  }
};

const persistMessage = (message: ChatMessage) => {
  return useChatStore.getState().addMessage(message);
};

const handleText = async (
  text: string,
  source: 'typed' | 'voice'
): Promise<string> => {
  const trimmed = text.trim();
  if (!trimmed) {
    return '';
  }

  const sessionId = source === 'voice' ? activeSessionId : createSessionId();
  persistMessage({
    role: 'user',
    content: trimmed,
    source,
    sessionId,
  });
  if (source === 'voice') {
    bus.emit('intent.raw_audio_parsed', { text: trimmed });
  }

  if (source === 'voice') {
    setSessionState('thinking');
  }

  const history = useChatStore.getState().messages.slice(-20);
  const result = await osIntentRouter.processText(trimmed, history, source);

  if (source === 'voice' && result.intent !== 'coach.chat') {
    setSessionState('acting');
  }

  persistMessage({
    role: 'assistant',
    content: result.reply,
    source,
    sessionId,
    intent: result.intent,
    metadata: result.metadata || null,
  });

  bus.emit('jarvis.reply_ready', { text: result.reply });
  return result.reply;
};

const runVoiceSession = async () => {
  if (sessionState !== 'idle') {
    return;
  }

  activeSessionId = createSessionId();
  setSessionState('listening');
  await wakeWordService.stopListening();
  await sleep(180);

  try {
    setSessionState('transcribing');
    const transcript = await sttService.startRecordingAndTranscribe();
    const effectiveTranscript = manualOverrideText || transcript;
    manualOverrideText = null;

    if (!effectiveTranscript) {
      bus.emit('ui.toast', {
        kind: 'info',
        message: 'No command captured.',
      });
      return;
    }

    const reply = await handleText(effectiveTranscript, 'voice');
    if (!reply.trim()) {
      return;
    }

    setSessionState('speaking');
    const spoke = await ttsService.speak(reply);
    if (!spoke) {
      bus.emit('ui.toast', {
        kind: 'error',
        message: 'Jarvis could not speak that reply.',
      });
    }
  } catch (error) {
    console.error('[Jarvis] Voice session failed', error);
    persistMessage({
      role: 'assistant',
      content: 'Something went wrong while I was processing that request.',
      source: 'voice',
      sessionId: activeSessionId,
    });
    bus.emit('ui.toast', {
      kind: 'error',
      message: 'Jarvis hit an error and returned to idle.',
    });
  } finally {
    await finishVoiceSession();
  }
};

export const jarvisService = {
  initialize: async (): Promise<JarvisStatus> => {
    if (isInitialized) {
      return status;
    }

    osIntentRouter.initialize();

    const { sttReady, wakeWordReady } = await refreshVoiceServices();

    bus.on('wakeword.detected', () => {
      if (activeVoiceTask || sessionState !== 'idle') {
        console.log('[Jarvis] Ignoring wake-word while busy.');
        return;
      }

      activeVoiceTask = runVoiceSession();
    });

    status = {
      routerReady: true,
      sttReady,
      wakeWordReady,
      sessionState,
    };
    isInitialized = true;

    if (!sttReady || !wakeWordReady) {
      scheduleVoiceBootstrapRetry();
    }

    console.log('[Jarvis] Ready', status);
    return status;
  },

  activateManual: () => {
    if (activeVoiceTask || sessionState !== 'idle') {
      return;
    }

    bus.emit('wakeword.detected', { timestamp: Date.now() });
  },

  submitText: async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }

    if (activeVoiceTask || sessionState !== 'idle') {
      if (sessionState === 'listening' || sessionState === 'transcribing') {
        manualOverrideText = trimmed;
        if (sessionState === 'transcribing') {
          await sttService.stopRecording();
        }
      } else {
        bus.emit('ui.toast', {
          kind: 'info',
          message: 'Jarvis is finishing the current reply.',
        });
      }
      return;
    }

    if (sessionState === 'idle') {
      activeSessionId = createSessionId();
    }

    try {
      const reply = await handleText(trimmed, 'voice');
      if (!reply.trim()) {
        return;
      }

      setSessionState('speaking');
      const spoke = await ttsService.speak(reply);
      if (!spoke) {
        bus.emit('ui.toast', {
          kind: 'error',
          message: 'Jarvis could not speak that reply.',
        });
      }
    } catch (error) {
      console.error('[Jarvis] Manual text session failed', error);
      bus.emit('ui.toast', {
        kind: 'error',
        message: 'Jarvis could not process that command.',
      });
    } finally {
      await finishVoiceSession();
    }
  },

  submitChat: async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }

    const fallbackSessionId = createSessionId();
    try {
      await handleText(trimmed, 'typed');
    } catch (error) {
      console.error('[Jarvis] Typed chat failed', error);
      persistMessage({
        role: 'assistant',
        content: "I'm offline right now.",
        source: 'typed',
        sessionId: fallbackSessionId,
      });
    }
  },

  cancelSession: async () => {
    try {
      await sttService.stopRecording();
      await ttsService.stop();
    } finally {
      await finishVoiceSession();
    }
  },

  getStatus: (): JarvisStatus => status,
};
