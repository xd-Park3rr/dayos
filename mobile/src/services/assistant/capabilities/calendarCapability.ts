import { calendarService } from '../../calendar/calendarService';
import type { AssistantCapability } from '../types';
import {
  getObjectParam,
  getRangeFromParams,
  getStringParam,
} from './common';

const ensureCalendarAccess = async () => {
  const permission = await calendarService.ensurePermission(true);
  if (!permission.granted) {
    return {
      blocked: true as const,
      reply: 'Calendar access is not granted on this device.',
      evidence: { permission },
    };
  }

  return {
    blocked: false as const,
  };
};

export const calendarCapability: AssistantCapability = {
  namespace: 'calendar',

  readContext: async (step) => {
    if (step.command === 'query_range' || step.command === 'find_free_slots') {
      const range = getRangeFromParams(step.params, 1);
      const events = await calendarService.queryRange({
        startAt: range.startAt,
        endAt: range.endAt,
        syncFirst: true,
      });

      return {
        summary: `Loaded ${events.length} calendar events.`,
        data: { events },
      };
    }

    if (step.command === 'get_event' || step.command === 'update_event' || step.command === 'delete_event') {
      const titleQuery = getStringParam(step.params, 'titleQuery');
      const eventId = getStringParam(step.params, 'eventId');
      const matches = await calendarService.findMatchingEvent({ eventId, titleQuery });
      return {
        summary: `Resolved ${matches.length} matching calendar events.`,
        data: { matches },
      };
    }

    return null;
  },

  execute: async (step) => {
    const access = await ensureCalendarAccess();
    if (access.blocked) {
      return {
        reply: access.reply,
        status: 'blocked_by_permission',
        evidence: access.evidence,
      };
    }

    switch (step.command) {
      case 'list_calendars': {
        const calendars = await calendarService.listCalendars();
        return {
          reply: `Found ${calendars.length} calendars.`,
          evidence: {
            calendars: calendars.map((calendar) => ({
              id: calendar.id,
              title: calendar.title,
              writable: calendar.allowsModifications,
              isPrimary: calendar.isPrimary || false,
            })),
          },
        };
      }

      case 'query_range': {
        const range = getRangeFromParams(step.params, 1);
        const events = await calendarService.queryRange({
          startAt: range.startAt,
          endAt: range.endAt,
          syncFirst: true,
        });
        return {
          reply: `Loaded ${events.length} calendar events in range.`,
          evidence: { events },
        };
      }

      case 'get_event': {
        const matches = await calendarService.findMatchingEvent({
          eventId: getStringParam(step.params, 'eventId'),
          titleQuery: getStringParam(step.params, 'titleQuery'),
        });

        if (matches.length === 0) {
          return {
            reply: 'No matching calendar event was found.',
            status: 'failed',
          };
        }

        if (matches.length > 1) {
          return {
            reply: `I found multiple calendar events matching this request: ${matches
              .slice(0, 3)
              .map((item) => `${item.title} at ${item.startAt}`)
              .join(', ')}.`,
            status: 'needs_confirmation',
            evidence: { matches },
          };
        }

        return {
          reply: `Found ${matches[0].title}.`,
          evidence: { event: matches[0] },
        };
      }

      case 'find_free_slots': {
        const range = getRangeFromParams(step.params, 1);
        const durationMinutes =
          typeof step.params.durationMinutes === 'number' ? step.params.durationMinutes : 30;
        const slots = await calendarService.findFreeSlots({
          startAt: range.startAt,
          endAt: range.endAt,
          durationMinutes,
        });
        return {
          reply: `Found ${slots.length} free slots.`,
          evidence: { slots },
        };
      }

      case 'create_event': {
        const title = getStringParam(step.params, 'title');
        const startAt = getStringParam(step.params, 'startAt');
        const endAt = getStringParam(step.params, 'endAt');
        if (!title || !startAt || !endAt) {
          return {
            reply: 'Calendar creation needs a title, start time, and end time.',
            status: 'failed',
          };
        }

        const created = await calendarService.createEvent({
          calendarId: getStringParam(step.params, 'calendarId'),
          title,
          startAt,
          endAt,
          notes: getStringParam(step.params, 'notes') || null,
          location: getStringParam(step.params, 'location') || null,
          allDay: step.params.allDay === true,
        });
        return {
          reply: `${created.title} was created on your calendar.`,
          evidence: { event: created },
        };
      }

      case 'update_event': {
        const matches = await calendarService.findMatchingEvent({
          eventId: getStringParam(step.params, 'eventId'),
          titleQuery: getStringParam(step.params, 'titleQuery'),
        });
        if (matches.length === 0) {
          return {
            reply: 'No matching calendar event was found to update.',
            status: 'failed',
          };
        }
        if (matches.length > 1) {
          return {
            reply: `I found multiple calendar events to update: ${matches
              .slice(0, 3)
              .map((item) => `${item.title} at ${item.startAt}`)
              .join(', ')}.`,
            status: 'needs_confirmation',
            evidence: { matches },
          };
        }

        const patch = getObjectParam(step.params, 'patch') || {};
        const updated = await calendarService.updateEvent({
          eventId: matches[0].eventId,
          patch: {
            title: getStringParam(patch, 'title') || getStringParam(step.params, 'title'),
            startAt: getStringParam(patch, 'startAt') || getStringParam(step.params, 'startAt'),
            endAt: getStringParam(patch, 'endAt') || getStringParam(step.params, 'endAt'),
            notes:
              getStringParam(patch, 'notes') ||
              getStringParam(step.params, 'notes') ||
              undefined,
            location:
              getStringParam(patch, 'location') ||
              getStringParam(step.params, 'location') ||
              undefined,
          },
        });

        return {
          reply: `${updated.title} was updated.`,
          evidence: { event: updated },
        };
      }

      case 'delete_event': {
        const matches = await calendarService.findMatchingEvent({
          eventId: getStringParam(step.params, 'eventId'),
          titleQuery: getStringParam(step.params, 'titleQuery'),
        });
        if (matches.length === 0) {
          return {
            reply: 'No matching calendar event was found to delete.',
            status: 'failed',
          };
        }
        if (matches.length > 1) {
          return {
            reply: `I found multiple calendar events to delete: ${matches
              .slice(0, 3)
              .map((item) => `${item.title} at ${item.startAt}`)
              .join(', ')}.`,
            status: 'needs_confirmation',
            evidence: { matches },
          };
        }

        await calendarService.deleteEvent(matches[0].eventId);
        return {
          reply: `${matches[0].title} was deleted from your calendar.`,
          evidence: { eventId: matches[0].eventId, deleted: true },
        };
      }

      default:
        return {
          reply: `Calendar command ${step.command} is not implemented.`,
          status: 'failed',
        };
    }
  },

  verify: async (step, execution) => {
    if (
      execution.status === 'failed' ||
      execution.status === 'blocked_by_permission' ||
      execution.status === 'needs_confirmation'
    ) {
      return execution;
    }

    if (step.command === 'create_event' || step.command === 'update_event') {
      const event = execution.evidence?.event as { eventId?: string; title?: string; startAt?: string; endAt?: string } | undefined;
      if (!event?.eventId) {
        return {
          ...execution,
          status: 'failed',
          error: 'Missing calendar event identifier for verification.',
        };
      }

      const reloaded = await calendarService.getEventById(event.eventId);
      if (!reloaded) {
        return {
          ...execution,
          status: 'failed',
          error: 'Calendar event could not be reloaded after write.',
        };
      }

      return {
        ...execution,
        status: 'verified',
        evidence: { event: reloaded },
      };
    }

    if (step.command === 'delete_event') {
      const eventId = execution.evidence?.eventId;
      if (typeof eventId !== 'string') {
        return {
          ...execution,
          status: 'failed',
          error: 'Missing calendar event identifier for delete verification.',
        };
      }

      const deleted = await calendarService.getEventById(eventId);
      if (deleted) {
        return {
          ...execution,
          status: 'failed',
          error: 'Calendar event still exists after delete.',
          evidence: { event: deleted },
        };
      }

      return {
        ...execution,
        status: 'verified',
      };
    }

    return {
      ...execution,
      status: execution.status || 'unverified',
    };
  },
};
