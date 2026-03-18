import { activityRepo, taskRepo } from '../../../db/repositories';
import { sleepService } from '../../sleep/sleepService';
import { aiService } from '../../ai/aiService';
import { calendarService } from '../../calendar/calendarService';
import type { AssistantCapability } from '../types';
import { formatShortDateTime, getRangeFromParams, getStringParam } from './common';

export const insightCapability: AssistantCapability = {
  namespace: 'insight',

  execute: async (step) => {
    switch (step.command) {
      case 'schedule_query': {
        const range = getRangeFromParams(step.params, 1);
        const [calendarEvents, tasks] = await Promise.all([
          calendarService.queryRange({
            startAt: range.startAt,
            endAt: range.endAt,
            syncFirst: true,
          }),
          Promise.resolve(
            taskRepo.query({
              startAt: range.startAt.toISOString(),
              endAt: range.endAt.toISOString(),
            })
          ),
        ]);
        const blocks = activityRepo.getTodaysBlocks();

        const summaryLines = [
          ...blocks.slice(0, 3).map((block) => `Block: ${block.title} at ${formatShortDateTime(block.scheduledAt)}`),
          ...calendarEvents.slice(0, 3).map((event) => `Calendar: ${event.title} at ${formatShortDateTime(event.startAt)}`),
          ...tasks.slice(0, 3).map((task) => `Task: ${task.title} at ${formatShortDateTime(task.dueAt)}`),
        ];

        return {
          reply:
            summaryLines.length > 0
              ? summaryLines.join('\n')
              : 'There are no scheduled blocks, calendar events, or due tasks in that range.',
          evidence: {
            blocks,
            calendarEvents,
            tasks,
          },
        };
      }

      case 'drift_query': {
        return {
          reply: aiService.getDriftSummary(),
          evidence: null,
        };
      }

      case 'momentum_query': {
        const categoryId = getStringParam(step.params, 'categoryId');
        if (!categoryId) {
          const summaries = activityRepo.getMomentumSummaries();
          return {
            reply:
              summaries.length > 0
                ? summaries
                    .map((summary) => `${summary.categoryName}: ${summary.score}`)
                    .join(', ')
                : 'Not enough momentum data yet.',
            evidence: { summaries },
          };
        }

        const summary = activityRepo.getMomentumSummary(categoryId);
        if (!summary) {
          return {
            reply: 'No momentum summary exists for that category.',
            status: 'failed',
          };
        }

        const insight = await aiService.generateMomentumInsight(summary);
        return {
          reply: insight.explanation,
          evidence: {
            summary,
            actions: insight.actions,
          },
        };
      }

      case 'sleep_query': {
        const sleep = await sleepService.getLastNightSleep();
        if (!sleep) {
          return {
            reply: 'Sleep data is unavailable right now.',
            status: 'failed',
          };
        }

        return {
          reply: `You slept ${Math.floor(sleep.durationMinutes / 60)}h ${sleep.durationMinutes % 60}m. Sleep score: ${sleep.sleepScore}.`,
          evidence: { sleep },
        };
      }

      default:
        return {
          reply: `Insight command ${step.command} is not implemented.`,
          status: 'failed',
        };
    }
  },

  verify: async (_step, execution) => {
    return {
      ...execution,
      status: execution.status || 'verified',
    };
  },
};
