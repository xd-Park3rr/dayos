import { Image } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import type { TranscribeOptions, WhisperContext, WhisperVadContext } from 'whisper.rn';
import { microphonePermission } from './microphonePermission';

const WHISPER_MODEL_PATH = process.env.EXPO_PUBLIC_WHISPER_MODEL_PATH || '';
const DEFAULT_WHISPER_MODEL_ASSET = require('../../../assets/models/ggml-base.en.bin');
const FALLBACK_WHISPER_MODEL_ASSET = require('../../../assets/models/ggml-tiny.en.bin');
const DEFAULT_VAD_MODEL_ASSET = require('../../../assets/models/ggml-silero-v6.2.0.bin');
const COMMAND_CAPTURE_MS = 6500;
const RESULT_DEBOUNCE_MS = 1100;
const MIN_VALID_MODEL_BYTES = 1024 * 1024;
const COMMAND_PROMPT =
  'The speaker is talking to a personal assistant named Jarvis. Expect short English voice commands and questions about schedule, blocks, done, defer, skip, time, calendar, today, tomorrow, and can you hear me.';

const TRANSCRIBE_OPTIONS: TranscribeOptions = {
  language: 'en',
  maxThreads: 4,
  maxContext: 256,
  beamSize: 3,
  bestOf: 3,
  temperature: 0,
  temperatureInc: 0,
  prompt: COMMAND_PROMPT,
};

type RealtimeTranscriberInstance = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  release: () => Promise<void>;
};

type WhisperModule = {
  initWhisper: (options: { filePath: string | number; isBundleAsset?: boolean }) => Promise<WhisperContext>;
  initWhisperVad?: (options: {
    filePath: string | number;
    isBundleAsset?: boolean;
    useGpu?: boolean;
    nThreads?: number;
  }) => Promise<WhisperVadContext>;
};

type RealtimeModuleBundle = {
  RealtimeTranscriber: new (
    dependencies: {
      whisperContext: WhisperContext;
      audioStream: unknown;
    },
    options?: Record<string, unknown>,
    callbacks?: {
      onTranscribe?: (event: { type: string; sliceIndex: number; data?: { result?: string } }) => void;
      onError?: (error: string) => void;
    }
  ) => RealtimeTranscriberInstance;
  AudioPcmStreamAdapter: new () => unknown;
};

let whisperContext: WhisperContext | null = null;
let whisperVadContext: WhisperVadContext | null = null;
let isTranscribing = false;
let activeStopRecording: (() => Promise<void>) | null = null;
let initializationPromise: Promise<boolean> | null = null;

const BUNDLED_MODEL_ASSETS: Record<string, number> = {
  'assets/models/ggml-base.en.bin': DEFAULT_WHISPER_MODEL_ASSET,
  './assets/models/ggml-base.en.bin': DEFAULT_WHISPER_MODEL_ASSET,
  'ggml-base.en.bin': DEFAULT_WHISPER_MODEL_ASSET,
  'assets/models/ggml-tiny.en.bin': FALLBACK_WHISPER_MODEL_ASSET,
  './assets/models/ggml-tiny.en.bin': FALLBACK_WHISPER_MODEL_ASSET,
  'ggml-tiny.en.bin': FALLBACK_WHISPER_MODEL_ASSET,
};

const pickModule = <T>(moduleValue: unknown, key?: string): T | null => {
  if (!moduleValue) {
    return null;
  }

  const candidate = moduleValue as Record<string, unknown>;
  if (key && candidate[key]) {
    return candidate[key] as T;
  }

  const defaultExport = candidate.default as Record<string, unknown> | undefined;
  if (key && defaultExport?.[key]) {
    return defaultExport[key] as T;
  }

  return moduleValue as T;
};

const loadWhisper = async (): Promise<WhisperModule | null> => {
  try {
    const commonJsModule = require('whisper.rn/lib/commonjs/index');
    const initWhisper = pickModule<WhisperModule['initWhisper']>(commonJsModule, 'initWhisper');
    if (initWhisper) {
      const initWhisperVad = pickModule<WhisperModule['initWhisperVad']>(commonJsModule, 'initWhisperVad') || undefined;
      return { initWhisper, initWhisperVad };
    }
  } catch (commonJsError) {
    try {
      const packageModule = require('whisper.rn');
      const initWhisper = pickModule<WhisperModule['initWhisper']>(packageModule, 'initWhisper');
      if (initWhisper) {
        const initWhisperVad = pickModule<WhisperModule['initWhisperVad']>(packageModule, 'initWhisperVad') || undefined;
        return { initWhisper, initWhisperVad };
      }
    } catch (packageError) {
      console.warn('[STT] Failed to load whisper.rn JS entrypoint.', packageError ?? commonJsError);
    }
  }

  console.warn('[STT] RNWhisper JS entrypoint loaded, but initWhisper was unavailable.');
  return null;
};

const loadRealtimeModules = async (): Promise<RealtimeModuleBundle | null> => {
  try {
    const transcriberModule = require('whisper.rn/lib/commonjs/realtime-transcription/index');
    const adapterModule = require('whisper.rn/lib/commonjs/realtime-transcription/adapters/AudioPcmStreamAdapter');
    const RealtimeTranscriber = pickModule<RealtimeModuleBundle['RealtimeTranscriber']>(
      transcriberModule,
      'RealtimeTranscriber'
    );
    const AudioPcmStreamAdapter = pickModule<RealtimeModuleBundle['AudioPcmStreamAdapter']>(
      adapterModule,
      'AudioPcmStreamAdapter'
    );

    if (RealtimeTranscriber && AudioPcmStreamAdapter) {
      return {
        RealtimeTranscriber,
        AudioPcmStreamAdapter,
      };
    }
  } catch (commonJsError) {
    try {
      const transcriberModule = require('whisper.rn/realtime-transcription');
      const adapterModule = require('whisper.rn/realtime-transcription/adapters/AudioPcmStreamAdapter');
      const RealtimeTranscriber = pickModule<RealtimeModuleBundle['RealtimeTranscriber']>(
        transcriberModule,
        'RealtimeTranscriber'
      );
      const AudioPcmStreamAdapter = pickModule<RealtimeModuleBundle['AudioPcmStreamAdapter']>(
        adapterModule,
        'AudioPcmStreamAdapter'
      );

      if (RealtimeTranscriber && AudioPcmStreamAdapter) {
        return {
          RealtimeTranscriber,
          AudioPcmStreamAdapter,
        };
      }
    } catch (packageError) {
      console.error('[STT] Failed to load RealtimeTranscriber modules.', packageError ?? commonJsError);
    }
  }

  return null;
};

const isDirectModelPath = (value: string): boolean =>
  value.startsWith('file://') || value.startsWith('/') || /^[A-Za-z]:\\/.test(value);

const normalizeBundledModelKey = (value: string): string =>
  value.replace(/\\/g, '/').replace(/^\.\//, '').trim();

const resolveConfiguredModelOptions = (): { filePath: string | number; isBundleAsset?: boolean } | null => {
  if (!WHISPER_MODEL_PATH) {
    return null;
  }

  const bundledAsset = BUNDLED_MODEL_ASSETS[normalizeBundledModelKey(WHISPER_MODEL_PATH)];
  if (bundledAsset) {
    return {
      filePath: bundledAsset,
    };
  }

  if (isDirectModelPath(WHISPER_MODEL_PATH)) {
    return { filePath: WHISPER_MODEL_PATH };
  }

  console.warn(
    '[STT] EXPO_PUBLIC_WHISPER_MODEL_PATH is not a direct runtime file path. Falling back to the bundled Whisper asset.'
  );

  return null;
};

const resolveModelCandidates = (): Array<{
  label: string;
  options: { filePath: string | number; isBundleAsset?: boolean };
}> => {
  const configured = resolveConfiguredModelOptions();
  if (configured) {
    return [{ label: 'configured', options: configured }];
  }

  return [
    {
      label: 'bundled base.en',
      options: { filePath: DEFAULT_WHISPER_MODEL_ASSET },
    },
    {
      label: 'bundled tiny.en fallback',
      options: { filePath: FALLBACK_WHISPER_MODEL_ASSET },
    },
  ];
};

const getCandidateLocalUri = (options: { filePath: string | number; isBundleAsset?: boolean }): string | null => {
  if (typeof options.filePath === 'number') {
    try {
      const source = Image.resolveAssetSource(options.filePath);
      if (!source?.uri || source.uri.startsWith('http://') || source.uri.startsWith('https://')) {
        return null;
      }
      return source.uri;
    } catch {
      return null;
    }
  }

  if (typeof options.filePath === 'string' && options.filePath.startsWith('file://')) {
    return options.filePath;
  }

  if (typeof options.filePath === 'string' && options.filePath.startsWith('/')) {
    return `file://${options.filePath}`;
  }

  return null;
};

const validateModelCandidate = async (
  label: string,
  options: { filePath: string | number; isBundleAsset?: boolean }
): Promise<boolean> => {
  const localUri = getCandidateLocalUri(options);
  if (!localUri) {
    return true;
  }

  try {
    const info = await FileSystem.getInfoAsync(localUri);
    if (!info.exists || typeof info.size !== 'number') {
      return true;
    }

    if (info.size >= MIN_VALID_MODEL_BYTES) {
      return true;
    }

    console.warn(
      `[STT] Whisper model "${label}" is only ${info.size} bytes. This is not a valid Whisper model. ` +
        'The dev client likely cached a stale Metro asset or a Git LFS pointer. Restart Metro with ' +
        '`npx expo start --dev-client -c`, clear the app cache if needed, and reopen DayOS.'
    );
    return false;
  } catch (error) {
    console.warn(`[STT] Failed to inspect Whisper model candidate ${label}. Continuing anyway.`, error);
    return true;
  }
};

const combineTranscriptSegments = (segments: Map<number, string>): string => {
  return Array.from(segments.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, value]) => value.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
};

export const sttService = {
  initialize: async (): Promise<boolean> => {
    if (whisperContext) {
      return true;
    }

    if (initializationPromise) {
      return initializationPromise;
    }

    initializationPromise = (async () => {
      try {
        const whisper = await loadWhisper();
        if (!whisper) {
          return false;
        }

        for (const candidate of resolveModelCandidates()) {
          const isCandidateValid = await validateModelCandidate(candidate.label, candidate.options);
          if (!isCandidateValid) {
            continue;
          }

          try {
            whisperContext = await whisper.initWhisper(candidate.options);
            console.log(`[STT] Whisper initialized successfully using ${candidate.label}`);
            break;
          } catch (error) {
            console.warn(`[STT] Failed to initialize Whisper with ${candidate.label}`, error);
            whisperContext = null;
          }
        }

        if (!whisperContext) {
          return false;
        }

        if (whisper.initWhisperVad) {
          try {
            whisperVadContext = await whisper.initWhisperVad({
              filePath: DEFAULT_VAD_MODEL_ASSET,
              nThreads: 2,
            });
            console.log('[STT] Whisper VAD initialized successfully');
          } catch (error) {
            whisperVadContext = null;
            console.warn('[STT] Whisper VAD failed to initialize. Continuing without VAD.', error);
          }
        }

        return true;
      } catch (error) {
        console.error('[STT] Failed to initialize Whisper', error);
        whisperContext = null;
        whisperVadContext = null;
        return false;
      } finally {
        initializationPromise = null;
      }
    })();

    return initializationPromise;
  },

  startRecordingAndTranscribe: async (): Promise<string | null> => {
    if (isTranscribing) {
      return null;
    }

    if (!whisperContext) {
      const ready = await sttService.initialize();
      if (!ready || !whisperContext) {
        return null;
      }
    }

    const context = whisperContext;

    const hasMicrophoneAccess = await microphonePermission.ensure('voice commands');
    if (!hasMicrophoneAccess) {
      return null;
    }

    const realtimeModules = await loadRealtimeModules();
    if (!realtimeModules) {
      return null;
    }

    isTranscribing = true;
    console.log('[STT] Listening for command...');

    const transcriptSegments = new Map<number, string>();
    let transcriber: RealtimeTranscriberInstance | null = null;
    let stopTimer: ReturnType<typeof setTimeout> | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    return await new Promise<string | null>(async (resolve) => {
      const finish = async () => {
        if (settled) {
          return;
        }

        settled = true;
        if (stopTimer) {
          clearTimeout(stopTimer);
          stopTimer = null;
        }
        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }

        activeStopRecording = null;

        try {
          if (transcriber) {
            await transcriber.stop();
            await transcriber.release();
          }
        } catch (error) {
          console.error('[STT] Failed to stop realtime transcription', error);
        } finally {
          transcriber = null;
          isTranscribing = false;
          const transcript = combineTranscriptSegments(transcriptSegments);
          if (transcript) {
            console.log('[STT] Transcription complete:', transcript);
            resolve(transcript);
            return;
          }

          resolve(null);
        }
      };

      activeStopRecording = finish;

      try {
        const audioStream = new realtimeModules.AudioPcmStreamAdapter();
        transcriber = new realtimeModules.RealtimeTranscriber(
          {
            whisperContext: context,
            vadContext: whisperVadContext ?? undefined,
            audioStream,
          } as never,
          {
            audioSliceSec: 5,
            audioMinSec: 1,
            maxSlicesInMemory: 2,
            vadPreset: 'default',
            autoSliceOnSpeechEnd: true,
            autoSliceThreshold: 0.3,
            initialPrompt: COMMAND_PROMPT,
            promptPreviousSlices: false,
            vadThrottleMs: 250,
            transcribeOptions: TRANSCRIBE_OPTIONS,
            audioStreamConfig: {
              sampleRate: 16000,
              channels: 1,
              bitsPerSample: 16,
              audioSource: 6,
              bufferSize: 24 * 1024,
            },
            logger: (message: string) => {
              if (message.includes('error')) {
                console.warn(message);
              }
            },
          },
          {
            onTranscribe: (event) => {
              if (event.type !== 'transcribe') {
                return;
              }

              const nextTranscript = event.data?.result?.trim();
              if (!nextTranscript) {
                return;
              }

              transcriptSegments.set(event.sliceIndex, nextTranscript);
              if (debounceTimer) {
                clearTimeout(debounceTimer);
              }

              debounceTimer = setTimeout(() => {
                void finish();
              }, RESULT_DEBOUNCE_MS);
            },
            onError: (error) => {
              console.error('[STT] RealtimeTranscriber error', error);
              void finish();
            },
          }
        );

        stopTimer = setTimeout(() => {
          void finish();
        }, COMMAND_CAPTURE_MS);

        await transcriber.start();
      } catch (error) {
        console.error('[STT] Failed to start realtime transcription', error);
        await finish();
      }
    });
  },

  stopRecording: async (): Promise<void> => {
    if (!activeStopRecording) {
      isTranscribing = false;
      return;
    }

    const stop = activeStopRecording;
    activeStopRecording = null;

    try {
      await stop();
    } catch (error) {
      console.error('[STT] Failed to stop recording', error);
    } finally {
      isTranscribing = false;
    }
  },
};
