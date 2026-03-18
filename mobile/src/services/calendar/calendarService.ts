import * as Calendar from 'expo-calendar';
import type { CalendarEventCacheItem } from '../../types';
import { calendarCacheRepo, repoUtils } from '../../db/repositories';
import { bus } from '../../events/bus';

const ROLLING_WINDOW_PAST_DAYS = 30;
const ROLLING_WINDOW_FUTURE_DAYS = 90;

const toDate = (value: string | Date): Date => {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date value: ${String(value)}`);
  }
  return parsed;
};

const mapEventToCache = (event: Calendar.Event): CalendarEventCacheItem => ({
  id: `cache-${event.id}`,
  eventId: event.id,
  calendarId: event.calendarId,
  title: event.title || 'Untitled event',
  notes: event.notes || null,
  location: event.location || null,
  startAt: toDate(event.startDate).toISOString(),
  endAt: toDate(event.endDate).toISOString(),
  isAllDay: !!event.allDay,
  source: 'android-calendar',
  lastSyncedAt: new Date().toISOString(),
});

const normalizeCalendars = async (): Promise<Calendar.Calendar[]> => {
  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  return calendars.filter((calendar) => calendar.isVisible !== false);
};

const normalizeWritableCalendars = async (): Promise<Calendar.Calendar[]> => {
  const calendars = await normalizeCalendars();
  return calendars.filter((calendar) => calendar.allowsModifications);
};

const syncRange = async (
  startAt: Date,
  endAt: Date,
  calendarIds?: string[]
): Promise<CalendarEventCacheItem[]> => {
  const calendars = await normalizeCalendars();
  const targetCalendarIds =
    calendarIds && calendarIds.length > 0
      ? calendarIds
      : calendars.map((calendar) => calendar.id);

  if (targetCalendarIds.length === 0) {
    return [];
  }

  const events = await Calendar.getEventsAsync(targetCalendarIds, startAt, endAt);
  const mapped = events.map(mapEventToCache);
  calendarCacheRepo.replaceWindow(startAt.toISOString(), endAt.toISOString(), mapped);
  bus.emit('schedule.updated', undefined);
  return mapped;
};

const fuzzyMatch = (target: string, query: string): boolean =>
  target.toLowerCase().includes(query.trim().toLowerCase());

export const calendarService = {
  ensurePermission: async (requestIfNeeded = true): Promise<{
    granted: boolean;
    canAskAgain: boolean;
    status: string;
  }> => {
    let permission = await Calendar.getCalendarPermissionsAsync();
    if (permission.status !== 'granted' && requestIfNeeded) {
      permission = await Calendar.requestCalendarPermissionsAsync();
    }

    return {
      granted: permission.status === 'granted',
      canAskAgain: permission.canAskAgain,
      status: permission.status,
    };
  },

  listCalendars: async (): Promise<Calendar.Calendar[]> => {
    return normalizeCalendars();
  },

  listWritableCalendars: async (): Promise<Calendar.Calendar[]> => {
    return normalizeWritableCalendars();
  },

  getDefaultWritableCalendar: async (): Promise<Calendar.Calendar | null> => {
    const writable = await normalizeWritableCalendars();
    return writable.find((calendar) => calendar.isPrimary) || writable[0] || null;
  },

  syncCalendarCache: async (): Promise<CalendarEventCacheItem[]> => {
    const now = new Date();
    const startAt = new Date(now);
    startAt.setDate(startAt.getDate() - ROLLING_WINDOW_PAST_DAYS);
    const endAt = new Date(now);
    endAt.setDate(endAt.getDate() + ROLLING_WINDOW_FUTURE_DAYS);

    const permission = await calendarService.ensurePermission(true);
    if (!permission.granted) {
      return [];
    }

    return syncRange(startAt, endAt);
  },

  queryRange: async (params: {
    startAt: string | Date;
    endAt: string | Date;
    calendarIds?: string[];
    syncFirst?: boolean;
  }): Promise<CalendarEventCacheItem[]> => {
    const startAt = toDate(params.startAt);
    const endAt = toDate(params.endAt);

    if (params.syncFirst !== false) {
      return syncRange(startAt, endAt, params.calendarIds);
    }

    return calendarCacheRepo.listRange(startAt.toISOString(), endAt.toISOString());
  },

  getEventById: async (eventId: string): Promise<CalendarEventCacheItem | null> => {
    try {
      const event = await Calendar.getEventAsync(eventId);
      const mapped = mapEventToCache(event);
      calendarCacheRepo.upsertMany([mapped]);
      return mapped;
    } catch (error) {
      console.warn('[Calendar] Failed to load event by id', eventId, error);
      return calendarCacheRepo.getByEventId(eventId);
    }
  },

  findMatchingEvent: async (params: {
    eventId?: string;
    titleQuery?: string;
    startAt?: string | Date;
    endAt?: string | Date;
  }): Promise<CalendarEventCacheItem[]> => {
    if (params.eventId) {
      const event = await calendarService.getEventById(params.eventId);
      return event ? [event] : [];
    }

    const now = new Date();
    const startAt = params.startAt ? toDate(params.startAt) : new Date(now.getTime() - 12 * 60 * 60 * 1000);
    const endAt = params.endAt ? toDate(params.endAt) : new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const windowItems = await calendarService.queryRange({
      startAt,
      endAt,
      syncFirst: true,
    });

    if (!params.titleQuery) {
      return windowItems;
    }

    return windowItems.filter((item) => fuzzyMatch(item.title, params.titleQuery || ''));
  },

  findFreeSlots: async (params: {
    startAt: string | Date;
    endAt: string | Date;
    durationMinutes: number;
  }): Promise<Array<{ startAt: string; endAt: string }>> => {
    const startAt = toDate(params.startAt);
    const endAt = toDate(params.endAt);
    const events = await calendarService.queryRange({ startAt, endAt, syncFirst: true });
    const sorted = [...events].sort((a, b) => a.startAt.localeCompare(b.startAt));
    const freeSlots: Array<{ startAt: string; endAt: string }> = [];
    let cursor = new Date(startAt);

    sorted.forEach((event) => {
      const eventStart = new Date(event.startAt);
      const eventEnd = new Date(event.endAt);

      if (eventStart.getTime() - cursor.getTime() >= params.durationMinutes * 60_000) {
        freeSlots.push({
          startAt: cursor.toISOString(),
          endAt: eventStart.toISOString(),
        });
      }

      if (eventEnd > cursor) {
        cursor = eventEnd;
      }
    });

    if (endAt.getTime() - cursor.getTime() >= params.durationMinutes * 60_000) {
      freeSlots.push({
        startAt: cursor.toISOString(),
        endAt: endAt.toISOString(),
      });
    }

    return freeSlots;
  },

  createEvent: async (params: {
    calendarId?: string;
    title: string;
    startAt: string | Date;
    endAt: string | Date;
    notes?: string | null;
    location?: string | null;
    allDay?: boolean;
  }): Promise<CalendarEventCacheItem> => {
    const defaultCalendar = params.calendarId
      ? { id: params.calendarId }
      : await calendarService.getDefaultWritableCalendar();

    if (!defaultCalendar?.id) {
      throw new Error('No writable calendar found on this device.');
    }

    const eventId = await Calendar.createEventAsync(defaultCalendar.id, {
      title: params.title,
      startDate: toDate(params.startAt),
      endDate: toDate(params.endAt),
      notes: params.notes || undefined,
      location: params.location || undefined,
      allDay: !!params.allDay,
    });

    const created = await calendarService.getEventById(eventId);
    if (!created) {
      throw new Error('Calendar event was created but could not be reloaded.');
    }

    return created;
  },

  updateEvent: async (params: {
    eventId: string;
    patch: {
      title?: string;
      startAt?: string | Date;
      endAt?: string | Date;
      notes?: string | null;
      location?: string | null;
      allDay?: boolean;
    };
  }): Promise<CalendarEventCacheItem> => {
    await Calendar.updateEventAsync(params.eventId, {
      title: params.patch.title,
      startDate: params.patch.startAt ? toDate(params.patch.startAt) : undefined,
      endDate: params.patch.endAt ? toDate(params.patch.endAt) : undefined,
      notes: params.patch.notes ?? undefined,
      location: params.patch.location ?? undefined,
      allDay: params.patch.allDay,
    });

    const updated = await calendarService.getEventById(params.eventId);
    if (!updated) {
      throw new Error('Calendar event was updated but could not be reloaded.');
    }

    return updated;
  },

  deleteEvent: async (eventId: string): Promise<void> => {
    await Calendar.deleteEventAsync(eventId);
    calendarCacheRepo.removeByEventId(eventId);
    bus.emit('schedule.updated', undefined);
  },

  primeCacheItem: async (event: Calendar.Event): Promise<CalendarEventCacheItem> => {
    const mapped = mapEventToCache(event);
    calendarCacheRepo.upsertMany([mapped]);
    return mapped;
  },

  createCacheId: (): string => repoUtils.createId('cache'),
};
