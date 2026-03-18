import * as Notifications from 'expo-notifications';

let isInitialized = false;

export const taskNotificationService = {
  initialize: async (): Promise<void> => {
    if (isInitialized) {
      return;
    }

    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });

    await Notifications.setNotificationChannelAsync('tasks', {
      name: 'Tasks',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 200, 100, 200],
      lightColor: '#c8f27a',
    });

    isInitialized = true;
  },

  ensurePermission: async (requestIfNeeded = true): Promise<{
    granted: boolean;
    canAskAgain: boolean;
    status: string;
  }> => {
    let permission = await Notifications.getPermissionsAsync();
    if (!permission.granted && requestIfNeeded) {
      permission = await Notifications.requestPermissionsAsync();
    }

    return {
      granted: permission.granted,
      canAskAgain: permission.canAskAgain,
      status: permission.status,
    };
  },

  scheduleTaskReminder: async (params: {
    title: string;
    body: string;
    dueAt: string;
  }): Promise<string> => {
    await taskNotificationService.initialize();
    const dueAt = new Date(params.dueAt);
    return Notifications.scheduleNotificationAsync({
      content: {
        title: params.title,
        body: params.body,
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: dueAt,
      },
    });
  },

  cancelTaskReminder: async (scheduledNotificationId: string | null | undefined): Promise<void> => {
    if (!scheduledNotificationId) {
      return;
    }

    await Notifications.cancelScheduledNotificationAsync(scheduledNotificationId);
  },

  listScheduledNotifications: async (): Promise<Notifications.NotificationRequest[]> => {
    return Notifications.getAllScheduledNotificationsAsync();
  },
};
