import { activityRepo } from '../../../db/repositories';
import { adminService } from '../../admin/adminService';
import type { AssistantCapability } from '../types';
import { getStringParam } from './common';

const findActivityMatches = (query?: string) => {
  const blocks = activityRepo.getTodaysBlocks();
  if (!query) {
    return blocks;
  }

  const normalized = query.toLowerCase();
  return blocks.filter((block) => block.title.toLowerCase().includes(normalized));
};

export const activityCapability: AssistantCapability = {
  namespace: 'activity',

  execute: async (step) => {
    switch (step.command) {
      case 'query_today': {
        const blocks = activityRepo.getTodaysBlocks();
        return {
          reply: `Loaded ${blocks.length} DayOS block${blocks.length === 1 ? '' : 's'} for today.`,
          evidence: { blocks },
        };
      }

      case 'checkin': {
        const target = getStringParam(step.params, 'targetActivity') || getStringParam(step.params, 'titleQuery');
        const matches = findActivityMatches(target);
        if (matches.length === 0) {
          return {
            reply: 'No matching DayOS block was found to check in to.',
            status: 'failed',
          };
        }
        if (matches.length > 1) {
          return {
            reply: `I found multiple DayOS blocks to check in to: ${matches
              .slice(0, 3)
              .map((item) => item.title)
              .join(', ')}.`,
            status: 'needs_confirmation',
            evidence: { matches },
          };
        }
        return {
          reply: `Checked in to ${matches[0].title}.`,
          evidence: { block: matches[0] },
        };
      }

      case 'mark_done':
      case 'mark_deferred':
      case 'mark_skipped': {
        const status =
          step.command === 'mark_done'
            ? 'done'
            : step.command === 'mark_deferred'
              ? 'deferred'
              : 'skipped';
        const result = await adminService.updateActivityStatus({
          status,
          rawText: getStringParam(step.params, 'rawText'),
          targetRef: step.params.targetRef as 'current' | 'next' | 'title' | undefined,
          titleQuery: getStringParam(step.params, 'titleQuery'),
          reason: getStringParam(step.params, 'reason'),
        });
        return {
          reply: result.reply,
          status: result.ok ? undefined : 'failed',
          evidence: result.metadata || null,
        };
      }

      case 'reschedule': {
        const result = await adminService.rescheduleActivityBlock({
          rawText: getStringParam(step.params, 'rawText'),
          targetRef: step.params.targetRef as 'current' | 'next' | 'title' | undefined,
          titleQuery: getStringParam(step.params, 'titleQuery'),
          dateTimePhrase: getStringParam(step.params, 'dateTimePhrase') || getStringParam(step.params, 'startAt'),
        });
        return {
          reply: result.reply,
          status: result.ok ? undefined : 'failed',
          evidence: result.metadata || null,
        };
      }

      default:
        return {
          reply: `Activity command ${step.command} is not implemented.`,
          status: 'failed',
        };
    }
  },

  verify: async (step, execution) => {
    if (execution.status === 'failed' || execution.status === 'needs_confirmation') {
      return execution;
    }

    if (step.command === 'query_today' || step.command === 'checkin') {
      return {
        ...execution,
        status: 'verified',
      };
    }

    const activityId = execution.evidence?.activityId;
    const blocks = activityRepo.getTodaysBlocks();
    const block = typeof activityId === 'string'
      ? blocks.find((item) => item.activityId === activityId)
      : undefined;

    if (!block) {
      return {
        ...execution,
        status: 'failed',
        error: 'DayOS block could not be reloaded for verification.',
      };
    }

    if (step.command === 'mark_done' && block.status !== 'done') {
      return {
        ...execution,
        status: 'failed',
        error: 'DayOS block was not marked done.',
      };
    }

    if (step.command === 'mark_deferred' && block.status !== 'deferred') {
      return {
        ...execution,
        status: 'failed',
        error: 'DayOS block was not deferred.',
      };
    }

    if (step.command === 'mark_skipped' && block.status !== 'skipped') {
      return {
        ...execution,
        status: 'failed',
        error: 'DayOS block was not skipped.',
      };
    }

    return {
      ...execution,
      status: 'verified',
      evidence: {
        ...execution.evidence,
        block,
      },
    };
  },
};
