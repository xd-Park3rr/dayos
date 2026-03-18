import { Linking } from 'react-native';
import { calendarService } from '../calendar/calendarService';
import { contactsService } from '../contacts/contactsService';
import { appControlService } from '../app/appControlService';
import { taskNotificationService } from '../task/taskNotificationService';

export type PermissionSnapshot = {
  calendar: { granted: boolean; status: string };
  contacts: { granted: boolean; status: string };
  notifications: { granted: boolean; status: string };
  usageAccess: { granted: boolean; status: string };
  overlay: { granted: boolean; status: string };
};

export const permissionService = {
  getSnapshot: async (): Promise<PermissionSnapshot> => {
    const [calendar, contacts, notifications, usageAccess, overlay] = await Promise.all([
      calendarService.ensurePermission(false),
      contactsService.ensurePermission(false),
      taskNotificationService.ensurePermission(false),
      appControlService.hasUsageAccess(),
      appControlService.hasOverlayPermission(),
    ]);

    return {
      calendar: { granted: calendar.granted, status: calendar.status },
      contacts: { granted: contacts.granted, status: contacts.status },
      notifications: { granted: notifications.granted, status: notifications.status },
      usageAccess: {
        granted: usageAccess,
        status: usageAccess ? 'granted' : 'missing',
      },
      overlay: {
        granted: overlay,
        status: overlay ? 'granted' : 'missing',
      },
    };
  },

  openSettings: async (target: string): Promise<boolean> => {
    switch (target) {
      case 'usage_access':
        return appControlService.openUsageAccessSettings();
      case 'overlay':
        return appControlService.openOverlaySettings();
      case 'contacts':
      case 'calendar':
      case 'notifications':
      default:
        try {
          await Linking.openSettings();
          return true;
        } catch {
          return false;
        }
    }
  },
};
