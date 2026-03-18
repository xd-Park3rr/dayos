import { COACH_SYSTEM } from '../../constants';
import type { ChatContentPart, ChatMessage } from './chatTypes';
import type { CoachTone, MomentumSummary, Severity } from '../../types';
import type { CommandPlan, CommandStep } from '../assistant/types';
import { getCatalogPrompt, withCommandDefaults } from '../assistant/commandCatalog';
import { createAssistantId } from '../assistant/utils';

const ANTHROPIC_API_KEY = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY || '';
const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

type AnthropicTextBlock = {
  type: 'text';
  text: string;
};

type AnthropicResponse = {
  content: Array<AnthropicTextBlock | { type: string; text?: string }>;
};

const normalizeMessageContent = (content: ChatMessage['content']): string | ChatContentPart[] => {
  if (typeof content === 'string') {
    return content;
  }

  return content
    .filter((part): part is ChatContentPart => part.type === 'text' && typeof part.text === 'string')
    .map((part) => ({
      type: 'text',
      text: part.text,
    }));
};

const extractTextResponse = (response: AnthropicResponse): string =>
  response.content
    .filter((part): part is AnthropicTextBlock => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();

const callAnthropic = async ({
  system,
  messages,
  maxTokens,
  assistantPrefill,
}: {
  system: string;
  messages: ChatMessage[];
  maxTokens: number;
  assistantPrefill?: string;
}): Promise<string> => {
  const requestMessages = assistantPrefill
    ? [...messages, { role: 'assistant' as const, content: assistantPrefill }]
    : messages;

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-no-training': 'true',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      system,
      messages: requestMessages.map((message) => ({
        role: message.role,
        content: normalizeMessageContent(message.content),
      })),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errorText}`);
  }

  const text = extractTextResponse(await response.json() as AnthropicResponse);
  return assistantPrefill ? `${assistantPrefill}${text}` : text;
};

export const aiService = {
  onboardingTurn: async (history: ChatMessage[], isLastTurn: boolean): Promise<string> => {
    if (!ANTHROPIC_API_KEY) {
      if (isLastTurn) {
        return JSON.stringify({
          categories: [{
            name: 'Health',
            colour: '#f27a7a',
            defaultSeverity: 'critical',
            identityAnchor: 'To live long',
            screenTimeAllowed: false,
          }],
          suggestedActivities: [],
          coachTone: 'direct',
          summary: 'We are ready.',
        });
      }
      return 'Tell me more about what your day looks like.';
    }

    try {
      return await callAnthropic({
        maxTokens: 2000,
        system: `${COACH_SYSTEM}\n\n${buildTemporalContextSnapshot()}\n\nYou are onboarding the user.
        ${
          isLastTurn
            ? 'This is the final turn. Return strictly one JSON object only with this exact top-level shape: {"categories":[{"name":"Health","colour":"#f27a7a","defaultSeverity":"high","identityAnchor":"Stay consistent in health.","screenTimeAllowed":false}],"suggestedActivities":[],"coachTone":"direct","summary":"short summary"}. Do not include markdown fences, prose, or any text before or after the JSON.'
            : 'Ask probing questions, briefly.'
        }`,
        messages: history,
        assistantPrefill: isLastTurn ? '{' : undefined,
      });
    } catch (e: unknown) {
      console.error('[AI] Onboarding error', e);
      return 'Failed to reach coach';
    }
  },

  parseOnboardingPayload: (raw: string): any => {
    const trimmed = raw
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '');

    try {
      return JSON.parse(trimmed);
    } catch (e) {
      if (trimmed.startsWith('{{') && trimmed.endsWith('}}')) {
        try {
          return JSON.parse(trimmed.slice(1, -1));
        } catch {
          // Fall through to the extraction logic below.
        }
      }

      const objectMatch = trimmed.match(/\{[\s\S]*\}/);
      if (objectMatch) {
        try {
          return JSON.parse(objectMatch[0]);
        } catch {
          // Fall through to the structured error below.
        }
      }

      throw new Error('Failed to parse onboarding JSON payload');
    }
  },

  buildOnboardingPayloadFallback: (
    selectedAreas: string[],
    history: ChatMessage[]
  ): {
    categories: Array<{
      name: string;
      colour: string;
      defaultSeverity: Severity;
      identityAnchor: string;
      screenTimeAllowed: boolean;
    }>;
    suggestedActivities: never[];
    coachTone: CoachTone;
    summary: string;
  } => {
    const palette = ['#E67E5F', '#2E6A8E', '#5E8C61', '#A65454', '#C18C2F', '#6D5EAC'];
    const latestUserSummary = history
      .filter((entry) => entry.role === 'user')
      .map((entry) => contentToText(entry.content))
      .filter(Boolean)
      .slice(-2)
      .join(' ');

    const categories = selectedAreas.map((area, index) => ({
      name: normaliseAreaName(area),
      colour: palette[index % palette.length],
      defaultSeverity: deriveSeverity(area),
      identityAnchor: `Stay consistent in ${normaliseAreaName(area).toLowerCase()}.`,
      screenTimeAllowed: false,
    }));

    return {
      categories,
      suggestedActivities: [],
      coachTone: 'direct',
      summary: latestUserSummary || `Focused on ${selectedAreas.join(', ')}.`,
    };
  },
  
  buildContextSnapshot: (): string => {
    try {
      const { activityRepo, driftRepo, diaryRepo, calendarCacheRepo, taskRepo } = require('../../db/repositories');
      const blocks = activityRepo.getTodaysBlocks();
      const themes = diaryRepo.getRecentThemes();
      const drifts = driftRepo.getSummary();
      const momentum = activityRepo.getMomentumSummaries();
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      end.setMilliseconds(end.getMilliseconds() - 1);
      const calendarEvents = calendarCacheRepo.listRange(start.toISOString(), end.toISOString());
      const tasks = taskRepo.query({ startAt: start.toISOString(), endAt: end.toISOString() });
      const normalizedBlocks = normaliseBlocksForCoach(blocks);
      
      return `${buildTemporalContextSnapshot()}

CONTEXT SNAPSHOT:
Momentum: ${JSON.stringify(momentum)}
Categories and drift: ${JSON.stringify(drifts)}
Today's Scheduled Blocks: ${JSON.stringify(normalizedBlocks)}
Today's Calendar Events: ${JSON.stringify(calendarEvents)}
Today's Tasks: ${JSON.stringify(tasks)}
Diary Themes (last 7 days): ${themes.join(', ')}
      `;
    } catch(e) {
      return 'Context missing.';
    }
  },

  planCommands: async (input: string, history: ChatMessage[] = []): Promise<CommandPlan> => {
    const localPlan = buildLocalCommandPlan(input);
    if (!ANTHROPIC_API_KEY) {
      return localPlan;
    }

    const historyContext = history.length > 0
      ? `\nRECENT CONVERSATION:\n${history
          .slice(-8)
          .map((entry) => `${entry.role.toUpperCase()}: ${contentToText(entry.content)}`)
          .join('\n')}\n`
      : '';

    const systemPrompt = `${buildTemporalContextSnapshot()}
${historyContext}

You are the Android-only command planner for DayOS.
Return strict JSON only, never markdown.

You must convert the user's single utterance into one or more command steps.
The user may ask for more than one thing at once.
Use only the command catalog below:
${getCatalogPrompt()}

Rules:
- Prefer command steps over prose when the request can be executed or queried.
- Use multiple steps when the user asked for multiple actions.
- For fuzzy targets, keep the user's query in params (for example "titleQuery", "contactQuery", "appQuery") rather than inventing IDs.
- Use ISO datetime strings when you can infer them confidently. Otherwise keep a clear phrase like "today 4 pm" in params.
- If the request is purely conversational and should not run commands, return zero steps and set coachPrompt.
- Do not create unsupported commands.
- Android only. Do not mention iOS.

Schema:
{
  "summary": "short execution summary",
  "coachPrompt": "optional fallback prompt or null",
  "steps": [
    {
      "namespace": "calendar|task|activity|insight|contacts|communication|app|permission",
      "command": "catalog command",
      "humanSummary": "short human-readable step label",
      "params": { "any": "json object" },
      "dependsOn": ["optional_step_id"]
    }
  ]
}`;

    try {
      const response = await callAnthropic({
        maxTokens: 1200,
        system: systemPrompt,
        messages: [{ role: 'user', content: input }],
      });
      const normalized = response
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      const parsed = JSON.parse(normalized) as {
        summary?: string;
        coachPrompt?: string | null;
        steps?: Array<{
          namespace: CommandStep['namespace'];
          command: string;
          humanSummary?: string;
          params?: Record<string, unknown>;
          dependsOn?: string[];
        }>;
      };

      const runId = createAssistantId('run');
      const normalizedSteps = normalizePlannedSteps(parsed.steps || [], runId);
      return {
        runId,
        summary: parsed.summary?.trim() || (normalizedSteps.length > 0 ? 'Working on your request.' : 'No device commands were planned.'),
        coachPrompt: normalizedSteps.length === 0 ? parsed.coachPrompt || input : parsed.coachPrompt || null,
        steps: normalizedSteps,
      };
    } catch (error) {
      console.error('[AI Planner] Failed to build command plan', error);
      return localPlan;
    }
  },

  chat: async (history: ChatMessage[]): Promise<string> => {
    if (!ANTHROPIC_API_KEY) {
      return aiService.getLocalCoachReply(history);
    }

    const contextHistory = history.length > 20
      ? [history[0], ...history.slice(-19)]
      : history;

    const snap = aiService.buildContextSnapshot();
    try {
      return await callAnthropic({
        maxTokens: 1000,
        system: `${COACH_SYSTEM}\n\n${snap}`,
        messages: contextHistory,
      });
    } catch (e) {
      console.error('[AI Chat] error:', e);
      return aiService.getLocalCoachReply(history);
    }
  },

  generateMorningBriefing: async (): Promise<string> => {
    if (!ANTHROPIC_API_KEY) {
      return 'A new day begins. Set your targets.';
    }
    
    const snap = aiService.buildContextSnapshot();
    try {
      return await callAnthropic({
        maxTokens: 400,
        system: `${COACH_SYSTEM}\n\nTask: Write a 3-sentence or less morning briefing. ${snap}`,
        messages: [{ role: 'user', content: 'Good morning.' }],
      });
    } catch {
      return 'Stay on path today.';
    }
  },

  generateWakeSequence: async (sleepData: any): Promise<string> => {
    if (!ANTHROPIC_API_KEY) {
      return 'Good morning. Time to start the day.';
    }

    const snap = aiService.buildContextSnapshot();
    const sleepInfo = sleepData 
      ? `User slept for ${Math.floor(sleepData.durationMinutes / 60)}h ${sleepData.durationMinutes % 60}m. Score: ${sleepData.sleepScore}/100.`
      : 'No sleep data available.';
      
    try {
      return await callAnthropic({
        maxTokens: 300,
        system: `${COACH_SYSTEM}\n\n${snap}\n\nTask: Generate a morning wake-up briefing based on the user's schedule and their sleep data: ${sleepInfo}. Keep it under 4 sentences. Speak directly.`,
        messages: [{ role: 'user', content: 'Generate my wake up sequence.' }],
      });
    } catch {
      return 'Good morning. Let us begin.';
    }
  },
  
  generateConsequenceMessage: async (activityId: string): Promise<string> => {
    if (!ANTHROPIC_API_KEY) {
      return 'You skipped this. The cost is real.';
    }

    const snap = aiService.buildContextSnapshot();
    try {
      return await callAnthropic({
        maxTokens: 400,
        system: `${COACH_SYSTEM}\n\n${snap}\n\nTask: The user just skipped activity ${activityId} and reached Escalation Level 2+. Deliver a direct, factual consequence message connecting to their identity anchor.`,
        messages: [{ role: 'user', content: 'I skipped my activity.' }],
      });
    } catch {
      return 'You skipped this. The cost is real.';
    }
  },

  generateRationalisationChallenge: async (activityId: string, reason: string): Promise<string> => {
    if (!ANTHROPIC_API_KEY) {
      return 'Does that excuse serve your identity anchor?';
    }

    const snap = aiService.buildContextSnapshot();
    try {
      return await callAnthropic({
        maxTokens: 400,
        system: `${COACH_SYSTEM}\n\n${snap}\n\nTask: The user is trying to skip activity ${activityId} and wrote a reason: "${reason}". Generate one hard question challenging this rationalisation.`,
        messages: [{ role: 'user', content: 'Skip requested: ' + reason }],
      });
    } catch {
      return 'Does that excuse serve your identity anchor?';
    }
  },

  getScheduleSummary: (_date?: string): string => {
    try {
      const { activityRepo, calendarCacheRepo, taskRepo } = require('../../db/repositories');
      const blocks = activityRepo.getTodaysBlocks();
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      end.setMilliseconds(end.getMilliseconds() - 1);
      const calendarEvents = calendarCacheRepo.listRange(start.toISOString(), end.toISOString());
      const tasks = taskRepo.query({
        startAt: start.toISOString(),
        endAt: end.toISOString(),
      });
      const normalizedBlocks = normaliseBlocksForCoach(blocks);

      if (!blocks.length && !calendarEvents.length && !tasks.length) {
        return 'You have no scheduled blocks today.';
      }

      const blockPreview = normalizedBlocks
        .slice(0, 2)
        .map((block: any) => `block ${block.title} at ${block.startsAtLocal}`);
      const calendarPreview = calendarEvents
        .slice(0, 2)
        .map((event: any) => `event ${event.title} at ${formatTimeLabel(event.startAt)}`);
      const taskPreview = tasks
        .slice(0, 2)
        .map((task: any) => `task ${task.title} at ${formatTimeLabel(task.dueAt)}`);

      const preview = [...blockPreview, ...calendarPreview, ...taskPreview]
        .slice(0, 4)
        .join(', ');

      const nextUpcoming = normalizedBlocks.find(
        (block: any) => typeof block.minutesUntilStart === 'number' && block.minutesUntilStart >= 0
      );
      const totalCount = blocks.length + calendarEvents.length + tasks.length;
      const remainingCount = totalCount - Math.min(totalCount, 4);
      const nextPrefix = nextUpcoming
        ? `Next is ${nextUpcoming.title} ${nextUpcoming.relativeStart} at ${nextUpcoming.startsAtLocal}. `
        : '';

      if (remainingCount > 0) {
        return `${nextPrefix}Today you have ${preview}, plus ${remainingCount} more block${remainingCount === 1 ? '' : 's'}.`;
      }

      return `${nextPrefix}Today you have ${preview}.`;
    } catch (e) {
      console.error('[AI] Failed to summarize schedule', e);
      return 'I could not load your schedule right now.';
    }
  },

  getDriftSummary: (): string => {
    try {
      const { activityRepo, driftRepo } = require('../../db/repositories');
      const momentum = activityRepo.getMomentumSummaries();
      const driftSummary = driftRepo.getSummary();

      if (!momentum.length && !driftSummary.length) {
        return 'There is not enough momentum data yet. Keep logging your blocks.';
      }

      const momentumCompact = momentum
        .map((item: MomentumSummary) => `${item.categoryName} at ${item.score}`)
        .join(', ');

      const driftCompact = driftSummary
        .filter((item: any) => item.categoryName)
        .map((item: any) => `${item.categoryName} drift ${Math.round(item.driftScore || 0)}`)
        .slice(0, 3)
        .join(', ');

      if (momentumCompact && driftCompact) {
        return `Momentum: ${momentumCompact}. Drift: ${driftCompact}.`;
      }

      if (momentumCompact) {
        return `Momentum: ${momentumCompact}.`;
      }

      return driftCompact
        ? `Drift: ${driftCompact}.`
        : 'There is not enough momentum data yet. Keep logging your blocks.';
    } catch (e) {
      console.error('[AI] Failed to summarize drift', e);
      return 'I could not load your drift summary right now.';
    }
  },

  generateMomentumInsight: async (
    summary: MomentumSummary
  ): Promise<{ explanation: string; actions: string[] }> => {
    const fallback = buildMomentumInsightFallback(summary);
    if (!ANTHROPIC_API_KEY) {
      return fallback;
    }

    try {
      const response = await callAnthropic({
        maxTokens: 500,
        system: `${COACH_SYSTEM}

${buildTemporalContextSnapshot()}

You are explaining the user's momentum for one life category.
Return strict JSON only with this exact shape:
{"explanation":"one short paragraph","actions":["short action 1","short action 2","short action 3"]}`,
        messages: [
          {
            role: 'user',
            content: `Momentum summary: ${JSON.stringify(summary)}`,
          },
        ],
      });

      const parsed = JSON.parse(
        response
          .replace(/^```json\s*/i, '')
          .replace(/^```\s*/i, '')
          .replace(/\s*```$/i, '')
          .trim()
      );

      return {
        explanation: parsed.explanation || fallback.explanation,
        actions: Array.isArray(parsed.actions) && parsed.actions.length > 0 ? parsed.actions : fallback.actions,
      };
    } catch (error) {
      console.error('[AI] Failed to generate momentum insight', error);
      return fallback;
    }
  },

  getLocalCoachReply: (history: ChatMessage[]): string => {
    const latestUserMessage = getLatestUserMessage(history);
    const lower = latestUserMessage.toLowerCase();

    if (!latestUserMessage) {
      return 'Tell me what needs tightening right now.';
    }

    if (isSchedulePrompt(lower)) {
      return aiService.getScheduleSummary();
    }

    if (isDriftPrompt(lower)) {
      return aiService.getDriftSummary();
    }

    if (isTimePrompt(lower)) {
      return getCurrentTimeSummary();
    }

    return 'I am running in local mode right now. I can still help with your schedule, drift, reminders, blocking apps, and activity check-ins.';
  },

  parseIntent: async (transcribedText: string, history: ChatMessage[] = []): Promise<{ intent: string, params: any } | null> => {
    if (!ANTHROPIC_API_KEY) {
      return buildLocalIntent(transcribedText);
    }

    const historyContext = history.length > 0
      ? `\nCONVERSATION HISTORY:\n${history.map(m => `${m.role.toUpperCase()}: ${contentToText(m.content)}`).join('\n')}\n`
      : '';

    const systemPrompt = `
    You are the central intent router for "DayOS" - an OS-level AI agent. 
    The user is speaking to you via a wake-word ("Hey Jarvis").

    ${buildTemporalContextSnapshot()}
    ${historyContext}
    
    Given the user's spoken command and the conversation history, classify it into one of the following exact intents and extract any necessary parameters.
    
    CRITICAL RULES:
    1. CONTEXT RESOLUTION: Use the history to resolve pronouns. If the user says "do it", "add that", or "remind me about that meeting", look at the previous 3-4 messages to identify what "it" or "that" refers to.
    2. APP REFERENCING: If the user mentions an app name (e.g., "on Instagram", "via WhatsApp"), include it in the params (e.g., targetApp) or use it to decide the intent.
    3. MULTI-STEP LOGIC: If a user command implies multiple steps, pick the most immediate one or use "coach.chat" to explain how you'll handle it.
    4. PERSONALITY: You are proactive and agentic. If an intent is clear but missing a param (like time for a meeting), you can still pick the intent and let the router/admin service handle the default or ask for it.

    Allowed Intents:
    1. "calendar.create" (params: { title, time, date }) -> e.g. "Add BJJ to Thursday at 5pm"
    2. "schedule.query" (params: { date }) -> e.g. "What's on today?"
    3. "screentime.block" (params: { durationMinutes, targetApp }) -> e.g. "Block Instagram for 2 hours"
    4. "reminder.create" (params: { text, time }) -> e.g. "Remind me to email the client at 4"
    5. "alarm.set" (params: { time, label }) -> e.g. "Set an alarm for 7am called Workout"
    6. "news.query" (params: { topic }) -> e.g. "What's the latest in AI?" or "Read me the news"
    7. "drift.query" (params: {}) -> e.g. "How's my training this week?"
    8. "activity.checkin" (params: { targetActivity }) -> e.g. "I'm heading to gym now"
    9. "activity.update_status" (params: { status, targetRef, titleQuery, rawText, reason }) -> e.g. "mark my next block done", "skip jiu jitsu"
    10. "activity.reschedule" (params: { targetRef, titleQuery, rawText, dateTimePhrase }) -> e.g. "move my next block to 4 pm"
    11. "coach.chat" (params: { prompt }) -> Fallback for conversational queries.

    CRITICAL: ALWAYS respond with standard JSON ONLY. Do NOT wrap in markdown \`\`\`json blocks.
    Schema:
    {
      "intent": "<intent_string>",
      "params": { ... }
    }
    `;

    try {
      const text = await callAnthropic({
        maxTokens: 300,
        system: systemPrompt,
        messages: [{ role: 'user', content: transcribedText }],
      });
      const jsonStr = text
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();
      const parsed = JSON.parse(jsonStr);
      if (parsed?.params && typeof parsed.params === 'object') {
        parsed.params.rawText = parsed.params.rawText || transcribedText;
      }
      return parsed;
    } catch (e) {
      console.error('[AI Intent Parser] Error parsing intent', e);
      return buildLocalIntent(transcribedText);
    }
  },
};

const getLatestUserMessage = (history: ChatMessage[]): string => {
  const latest = [...history].reverse().find((entry) => entry.role === 'user');
  if (!latest) {
    return '';
  }

  return contentToText(latest.content);
};

const contentToText = (content: ChatMessage['content']): string => {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => ('text' in part ? part.text : ''))
      .join(' ')
      .trim();
  }

  return '';
};

const formatTimeLabel = (value?: string | null): string => {
  if (!value) {
    return 'unscheduled';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

const getResolvedTimeZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'device local timezone';
  } catch {
    return 'device local timezone';
  }
};

const formatUtcOffset = (date: Date): string => {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absoluteMinutes = Math.abs(offsetMinutes);
  const hours = Math.floor(absoluteMinutes / 60);
  const minutes = absoluteMinutes % 60;

  return `UTC${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

const buildTemporalContextSnapshot = (): string => {
  const now = new Date();
  const localDate = now.toLocaleDateString([], {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const localTime = now.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
  const timezone = getResolvedTimeZone();
  const utcOffset = formatUtcOffset(now);

  return `LOCAL TIME CONTEXT:
Current local date: ${localDate}
Current local time: ${localTime}
Local timezone: ${timezone} (${utcOffset})
Interpret relative time references like "today", "tomorrow", "this morning", "tonight", and "later" using this local timezone.`;
};

const getCurrentTimeSummary = (): string => {
  const now = new Date();
  const localDate = now.toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const localTime = now.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });

  return `Local time is ${localTime} on ${localDate} in ${getResolvedTimeZone()} (${formatUtcOffset(now)}).`;
};

const normaliseBlocksForCoach = (blocks: any[]): any[] => {
  const now = new Date();

  return blocks.map((block) => {
    const scheduledValue = block.scheduledAt || block.defaultTime || null;
    const scheduledDate = scheduledValue ? new Date(scheduledValue) : null;
    const hasValidSchedule = !!scheduledDate && !Number.isNaN(scheduledDate.getTime());
    const minutesUntilStart = hasValidSchedule
      ? Math.round((scheduledDate.getTime() - now.getTime()) / 60000)
      : null;

    return {
      title: block.title,
      categoryName: block.categoryName,
      status: block.status,
      startsAtLocal: hasValidSchedule
        ? scheduledDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        : 'unscheduled',
      scheduledDateLocal: hasValidSchedule
        ? scheduledDate.toLocaleDateString([], {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
          })
        : 'unscheduled',
      minutesUntilStart,
      relativeStart: formatRelativeStart(minutesUntilStart),
      windowMinutes: block.windowMinutes,
      severity: block.severity,
    };
  });
};

const formatRelativeStart = (minutesUntilStart: number | null): string => {
  if (minutesUntilStart === null) {
    return 'with no scheduled time';
  }

  if (minutesUntilStart === 0) {
    return 'starting now';
  }

  const absoluteMinutes = Math.abs(minutesUntilStart);
  const hours = Math.floor(absoluteMinutes / 60);
  const minutes = absoluteMinutes % 60;
  const parts: string[] = [];

  if (hours > 0) {
    parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  }

  if (minutes > 0) {
    parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
  }

  const label = parts.join(' ');
  if (minutesUntilStart > 0) {
    return `in ${label}`;
  }

  return `started ${label} ago`;
};

const isSchedulePrompt = (lower: string): boolean =>
  lower.includes('schedule') ||
  lower.includes('agenda') ||
  lower.includes("what's on") ||
  lower.includes('what is on') ||
  lower.includes('plan for today');

const isDriftPrompt = (lower: string): boolean =>
  lower.includes('drift') ||
  lower.includes('momentum') ||
  lower.includes('training this week') ||
  lower.includes('consistency');

const isTimePrompt = (lower: string): boolean =>
  lower.includes('what time') ||
  lower.includes('current time') ||
  lower.includes('what day') ||
  lower.includes('what date') ||
  lower === 'time' ||
  lower === 'date';

const deriveSeverity = (area: string): Severity => {
  const lower = area.toLowerCase();

  if (lower.includes('health') || lower.includes('recovery') || lower.includes('parenting') || lower.includes('job')) {
    return 'high';
  }

  if (lower.includes('finance') || lower.includes('school') || lower.includes('university')) {
    return 'medium';
  }

  return 'medium';
};

const normaliseAreaName = (area: string): string =>
  area
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' / ');

const extractDurationMinutes = (lower: string): number => {
  const hourMatch = lower.match(/(\d+)\s*hour/);
  if (hourMatch) {
    return Number(hourMatch[1]) * 60;
  }

  const minuteMatch = lower.match(/(\d+)\s*minute/);
  if (minuteMatch) {
    return Number(minuteMatch[1]);
  }

  return 60;
};

const extractTimePhrase = (raw: string): string | undefined => {
  const match = raw.match(/\b(?:at|for)\s+([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?|\btomorrow\b|\btoday\b)/i);
  return match?.[1]?.trim();
};

const extractReminderText = (raw: string): string => {
  const cleaned = raw
    .replace(/^remind me to\s+/i, '')
    .replace(/^set a reminder to\s+/i, '')
    .replace(/\s+at\s+.+$/i, '')
    .trim();

  return cleaned || 'do this';
};

const extractCalendarTitle = (raw: string): string => {
  const cleaned = raw
    .replace(/^(add|create|schedule|put)\s+/i, '')
    .replace(/\s+(?:on|for|at)\s+.+$/i, '')
    .replace(/\s+to my calendar$/i, '')
    .trim();

  return cleaned || 'New event';
};

const extractActivityTarget = (raw: string): string => {
  const match = raw.match(/\b(?:heading to|going to|at|into)\s+(.+)$/i);
  return match?.[1]?.trim() || 'your next block';
};

const extractTargetApp = (lower: string): string => {
  const knownApps = ['instagram', 'youtube', 'tiktok', 'reddit', 'x', 'twitter', 'chrome', 'safari'];
  return knownApps.find((app) => lower.includes(app)) || 'distracting apps';
};

const detectActivityTargetRef = (lower: string): 'current' | 'next' | 'title' => {
  if (/\b(this|current)\b/.test(lower)) {
    return 'current';
  }

  if (/\bnext\b/.test(lower)) {
    return 'next';
  }

  return 'title';
};

const extractActivityTitleQuery = (raw: string): string => {
  return raw
    .replace(/\b(mark|set|move|reschedule|defer|skip|complete|done|my|the|block|activity|to|for|at|please|by|in)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const extractReschedulePhrase = (raw: string): string | undefined => {
  const match = raw.match(/\b(?:to|at|in|by)\s+(.+)$/i);
  return match?.[1]?.trim();
};

const detectStatusIntent = (
  lower: string
): 'done' | 'deferred' | 'skipped' | null => {
  if (/\b(done|complete|completed|finish|finished|mark .* done)\b/.test(lower)) {
    return 'done';
  }

  if (/\b(defer|deferred|delay|postpone)\b/.test(lower)) {
    return 'deferred';
  }

  if (/\b(skip|skipped|cancel)\b/.test(lower)) {
    return 'skipped';
  }

  return null;
};

const buildMomentumInsightFallback = (
  summary: MomentumSummary
): { explanation: string; actions: string[] } => {
  const identityAnchor = summary.identityAnchors[0] || summary.categoryName;
  const explanation = `${summary.categoryName} is at ${summary.score}% because you completed ${summary.completedCount}, deferred ${summary.deferredCount}, skipped ${summary.skippedCount}, and left ${summary.overdueCount} overdue over the last 7 days. That pattern is shaping your momentum around ${identityAnchor}.`;

  const actions = [
    `Complete the next ${summary.categoryName.toLowerCase()} block on time.`,
    `Convert one deferred ${summary.categoryName.toLowerCase()} block into a fixed start time today.`,
    `Avoid adding new skips in ${summary.categoryName.toLowerCase()} for the rest of the day.`,
  ];

  return { explanation, actions };
};

const normalizePlannedSteps = (
  steps: Array<{
    namespace: CommandStep['namespace'];
    command: string;
    humanSummary?: string;
    params?: Record<string, unknown>;
    dependsOn?: string[];
  }>,
  runId: string
): CommandStep[] => {
  return steps
    .map((step, index) =>
      withCommandDefaults({
        id: `${runId}-step-${index + 1}`,
        namespace: step.namespace,
        command: step.command,
        humanSummary: step.humanSummary?.trim() || `${step.namespace}.${step.command}`,
        params: step.params || {},
        dependsOn: Array.isArray(step.dependsOn) ? step.dependsOn : [],
      })
    )
    .filter((step): step is CommandStep => !!step);
};

const splitUserRequest = (input: string): string[] => {
  return input
    .split(/\b(?:and then|then|also)\b|,\s+|\s+\band\b\s+(?=(?:text|call|open|launch|block|create|add|schedule|move|delete|remove|complete|check|show|what|find|set|remind)\b)|[.;]/i)
    .map((part) => part.trim())
    .filter(Boolean);
};

const extractContactQuery = (raw: string): string | undefined => {
  const match = raw.match(/\b(?:text|sms|message|call)\s+([a-z][a-z\s'-]+)/i);
  return match?.[1]?.trim();
};

const extractMessageBody = (raw: string): string | undefined => {
  const match = raw.match(/\b(?:that|saying|message)\s+(.+)$/i);
  return match?.[1]?.trim();
};

const extractAppQuery = (raw: string): string | undefined => {
  const lower = raw.toLowerCase();
  const knownApps = ['instagram', 'youtube', 'tiktok', 'reddit', 'spotify', 'whatsapp', 'gmail', 'chrome', 'maps'];
  return knownApps.find((app) => lower.includes(app));
};

const buildLocalStep = (
  rawInput: string,
  runId: string,
  index: number
): CommandStep | null => {
  const raw = rawInput.trim();
  const lower = raw.toLowerCase();

  const addStep = (
    namespace: CommandStep['namespace'],
    command: string,
    humanSummary: string,
    params: Record<string, unknown>
  ): CommandStep | null =>
    withCommandDefaults({
      id: `${runId}-step-${index + 1}`,
      namespace,
      command,
      humanSummary,
      params,
      dependsOn: [],
    });

  if (isSchedulePrompt(lower)) {
    return addStep('insight', 'schedule_query', 'Check your schedule', {
      date: lower.includes('tomorrow') ? 'tomorrow' : 'today',
    });
  }

  if (isDriftPrompt(lower)) {
    return addStep('insight', 'drift_query', 'Check your drift summary', {});
  }

  if (lower.includes('sleep')) {
    return addStep('insight', 'sleep_query', 'Check your sleep data', {});
  }

  const statusIntent = detectStatusIntent(lower);
  if (statusIntent) {
    const command =
      statusIntent === 'done'
        ? 'mark_done'
        : statusIntent === 'deferred'
          ? 'mark_deferred'
          : 'mark_skipped';
    return addStep('activity', command, `Update ${extractActivityTitleQuery(raw) || 'current block'}`, {
      status: statusIntent,
      targetRef: detectActivityTargetRef(lower),
      titleQuery: extractActivityTitleQuery(raw),
      rawText: raw,
    });
  }

  if (/\b(move|reschedule|shift)\b/.test(lower) && /\b(block|activity)\b/.test(lower)) {
    return addStep('activity', 'reschedule', 'Reschedule a DayOS block', {
      targetRef: detectActivityTargetRef(lower),
      titleQuery: extractActivityTitleQuery(raw),
      rawText: raw,
      dateTimePhrase: extractReschedulePhrase(raw),
    });
  }

  if (lower.startsWith('remind me') || lower.includes('task') || lower.includes('todo')) {
    return addStep('task', 'create', 'Create a task', {
      title: extractReminderText(raw),
      dueAt: extractTimePhrase(raw),
      notes: lower.includes('about ') ? raw.split(/about /i)[1] : undefined,
    });
  }

  if (/\bcomplete\b/.test(lower) && /\btask\b/.test(lower)) {
    return addStep('task', 'complete', 'Complete a task', {
      titleQuery: extractReminderText(raw),
    });
  }

  if (/\b(delete|remove)\b/.test(lower) && /\btask\b/.test(lower)) {
    return addStep('task', 'delete', 'Delete a task', {
      titleQuery: extractReminderText(raw),
    });
  }

  if (
    /\b(add|create|schedule|put)\b/.test(lower) &&
    (lower.includes('calendar') || lower.includes('event') || lower.includes('meeting'))
  ) {
    return addStep('calendar', 'create_event', 'Create a calendar event', {
      title: extractCalendarTitle(raw),
      startAt: extractTimePhrase(raw),
      endAt: extractTimePhrase(raw),
    });
  }

  if (/\b(move|reschedule)\b/.test(lower) && /\b(meeting|event|calendar)\b/.test(lower)) {
    return addStep('calendar', 'update_event', 'Move a calendar event', {
      titleQuery: extractCalendarTitle(raw),
      startAt: extractReschedulePhrase(raw),
      patch: {
        startAt: extractReschedulePhrase(raw),
      },
    });
  }

  if (/\b(delete|remove|cancel)\b/.test(lower) && /\b(meeting|event|calendar)\b/.test(lower)) {
    return addStep('calendar', 'delete_event', 'Delete a calendar event', {
      titleQuery: extractCalendarTitle(raw),
    });
  }

  if (lower.startsWith('text ') || lower.startsWith('sms ') || lower.startsWith('message ')) {
    return addStep('communication', 'sms.draft', 'Draft an SMS', {
      contactQuery: extractContactQuery(raw),
      body: extractMessageBody(raw) || raw,
    });
  }

  if (lower.startsWith('call ')) {
    return addStep('communication', 'call.dial', 'Open the dialer', {
      contactQuery: extractContactQuery(raw),
    });
  }

  if (/\b(block|lock|stop)\b/.test(lower) && !!extractAppQuery(raw)) {
    return addStep('app', 'block', 'Save an app block rule', {
      appQuery: extractAppQuery(raw),
      durationMinutes: extractDurationMinutes(lower),
      reason: raw,
    });
  }

  if ((/\b(open|launch)\b/.test(lower) && !!extractAppQuery(raw)) || lower.startsWith('start ')) {
    return addStep('app', 'launch', 'Launch an app', {
      appQuery: extractAppQuery(raw) || raw.replace(/^(open|launch|start)\s+/i, '').trim(),
    });
  }

  if (lower.includes('permission') || lower.includes('setup')) {
    return addStep('permission', 'setup_check', 'Check Android permissions', {});
  }

  if (
    lower.includes('heading to') ||
    lower.includes('going to') ||
    lower.includes('check me in')
  ) {
    return addStep('activity', 'checkin', 'Check in to a DayOS block', {
      targetActivity: extractActivityTarget(raw),
      titleQuery: extractActivityTarget(raw),
    });
  }

  return null;
};

const buildLocalCommandPlan = (input: string): CommandPlan => {
  const runId = createAssistantId('run');
  const steps = splitUserRequest(input)
    .map((part, index) => buildLocalStep(part, runId, index))
    .filter((step): step is CommandStep => !!step);

  return {
    runId,
    summary: steps.length > 0 ? 'Working on your request.' : 'No device commands were planned.',
    coachPrompt: steps.length > 0 ? null : input,
    steps,
  };
};

const buildLocalIntent = (transcribedText: string): { intent: string; params: any } => {
  const raw = transcribedText.trim();
  const lower = raw.toLowerCase();

  if (!raw) {
    return { intent: 'coach.chat', params: { prompt: 'Hello' } };
  }

  if (isSchedulePrompt(lower)) {
    return { intent: 'schedule.query', params: { date: 'today' } };
  }

  if (isDriftPrompt(lower)) {
    return { intent: 'drift.query', params: {} };
  }

  const statusIntent = detectStatusIntent(lower);
  if (statusIntent) {
    return {
      intent: 'activity.update_status',
      params: {
        status: statusIntent,
        targetRef: detectActivityTargetRef(lower),
        titleQuery: extractActivityTitleQuery(raw),
        rawText: raw,
      },
    };
  }

  if (/\b(move|reschedule|shift)\b/.test(lower) && (/\b(next|current|this)\b/.test(lower) || /\bto\b/.test(lower))) {
    return {
      intent: 'activity.reschedule',
      params: {
        targetRef: detectActivityTargetRef(lower),
        titleQuery: extractActivityTitleQuery(raw),
        rawText: raw,
        dateTimePhrase: extractReschedulePhrase(raw),
      },
    };
  }

  if (
    lower.includes('block ') ||
    lower.includes('lock ') ||
    (lower.includes('stop ') && ['instagram', 'youtube', 'tiktok', 'reddit', 'x', 'twitter', 'chrome', 'safari'].some((app) => lower.includes(app)))
  ) {
    return {
      intent: 'screentime.block',
      params: {
        durationMinutes: extractDurationMinutes(lower),
        targetApp: extractTargetApp(lower),
      },
    };
  }

  if (lower.startsWith('remind me') || lower.includes('set a reminder')) {
    return {
      intent: 'reminder.create',
      params: {
        text: extractReminderText(raw),
        time: extractTimePhrase(raw),
      },
    };
  }

  if (
    (lower.startsWith('add ') || lower.startsWith('create ') || lower.startsWith('schedule ') || lower.startsWith('put ')) &&
    (lower.includes('calendar') || lower.includes('event') || lower.includes('today') || lower.includes('tomorrow') || lower.includes('am') || lower.includes('pm'))
  ) {
    return {
      intent: 'calendar.create',
      params: {
        title: extractCalendarTitle(raw),
        time: extractTimePhrase(raw),
        date: lower.includes('tomorrow') ? 'tomorrow' : 'today',
      },
    };
  }

  if (
    lower.includes('heading to') ||
    lower.includes('going to') ||
    lower.includes('check me in') ||
    lower.includes("i'm at") ||
    lower.includes('im at')
  ) {
    return {
      intent: 'activity.checkin',
      params: {
        targetActivity: extractActivityTarget(raw),
      },
    };
  }

  return {
    intent: 'coach.chat',
    params: {
      prompt: transcribedText,
    },
  };
};
