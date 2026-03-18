import { repoUtils, taskNotificationRepo, taskRepo } from '../../../db/repositories';
import type { TaskItem, TaskNotification, TaskStatus } from '../../../types';
import { taskNotificationService } from '../../task/taskNotificationService';
import type { AssistantCapability } from '../types';
import {
  getObjectParam,
  getStringParam,
  parseDateLike,
} from './common';

const findTaskMatches = (params: Record<string, unknown>): TaskItem[] => {
  const taskId = getStringParam(params, 'taskId');
  if (taskId) {
    const task = taskRepo.getById(taskId);
    return task ? [task] : [];
  }

  const titleQuery = getStringParam(params, 'titleQuery') || getStringParam(params, 'search');
  return taskRepo.query({
    search: titleQuery,
  });
};

const scheduleNotificationIfNeeded = async (
  task: TaskItem
): Promise<{ task: TaskItem; notification: TaskNotification | null }> => {
  const permission = await taskNotificationService.ensurePermission(true);
  if (!task.dueAt || !permission.granted) {
    return { task, notification: null };
  }

  if (task.notificationId) {
    await taskNotificationService.cancelTaskReminder(task.notificationId);
  }

  const scheduledId = await taskNotificationService.scheduleTaskReminder({
    title: 'DayOS task due',
    body: task.title,
    dueAt: task.dueAt,
  });

  const updatedTask = taskRepo.update({
    ...task,
    notificationId: scheduledId,
    updatedAt: new Date().toISOString(),
  });

  const notification: TaskNotification = {
    id: repoUtils.createId('tasknotif'),
    taskId: updatedTask.id,
    scheduledNotificationId: scheduledId,
    scheduledAt: updatedTask.dueAt,
    status: 'scheduled',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  taskNotificationRepo.upsert(notification);

  return {
    task: updatedTask,
    notification,
  };
};

export const taskCapability: AssistantCapability = {
  namespace: 'task',

  execute: async (step) => {
    switch (step.command) {
      case 'query': {
        const tasks = taskRepo.query({
          search: getStringParam(step.params, 'search'),
          status: getStringParam(step.params, 'status') as TaskStatus | undefined,
        });
        return {
          reply: `Found ${tasks.length} task${tasks.length === 1 ? '' : 's'}.`,
          evidence: { tasks },
        };
      }

      case 'create': {
        const title = getStringParam(step.params, 'title');
        if (!title) {
          return {
            reply: 'Task creation needs a title.',
            status: 'failed',
          };
        }

        const task: TaskItem = {
          id: repoUtils.createId('task'),
          title,
          notes: getStringParam(step.params, 'notes') || null,
          dueAt: getStringParam(step.params, 'dueAt') || null,
          status: 'pending',
          notificationId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        taskRepo.create(task);
        const scheduled = await scheduleNotificationIfNeeded(task);
        return {
          reply: `${scheduled.task.title} was added as a task.`,
          evidence: {
            task: scheduled.task,
            notification: scheduled.notification,
          },
        };
      }

      case 'update': {
        const matches = findTaskMatches(step.params);
        if (matches.length === 0) {
          return {
            reply: 'No matching task was found to update.',
            status: 'failed',
          };
        }
        if (matches.length > 1) {
          return {
            reply: `I found multiple tasks to update: ${matches
              .slice(0, 3)
              .map((item) => item.title)
              .join(', ')}.`,
            status: 'needs_confirmation',
            evidence: { matches },
          };
        }

        const patch = getObjectParam(step.params, 'patch') || {};
        const current = matches[0];
        const updated = taskRepo.update({
          ...current,
          title: getStringParam(patch, 'title') || getStringParam(step.params, 'title') || current.title,
          notes:
            getStringParam(patch, 'notes') ||
            getStringParam(step.params, 'notes') ||
            current.notes,
          dueAt:
            getStringParam(patch, 'dueAt') ||
            getStringParam(step.params, 'dueAt') ||
            current.dueAt,
          updatedAt: new Date().toISOString(),
        });
        const scheduled = await scheduleNotificationIfNeeded(updated);
        return {
          reply: `${scheduled.task.title} was updated.`,
          evidence: {
            task: scheduled.task,
            notification: scheduled.notification,
          },
        };
      }

      case 'complete': {
        const matches = findTaskMatches(step.params);
        if (matches.length !== 1) {
          return {
            reply:
              matches.length === 0
                ? 'No matching task was found to complete.'
                : `I found multiple tasks to complete: ${matches
                    .slice(0, 3)
                    .map((item) => item.title)
                    .join(', ')}.`,
            status: matches.length === 0 ? 'failed' : 'needs_confirmation',
            evidence: matches.length > 1 ? { matches } : null,
          };
        }

        await taskNotificationService.cancelTaskReminder(matches[0].notificationId);
        const completed = taskRepo.update({
          ...matches[0],
          status: 'completed',
          notificationId: null,
          updatedAt: new Date().toISOString(),
        });
        return {
          reply: `${completed.title} is marked complete.`,
          evidence: { task: completed },
        };
      }

      case 'snooze': {
        const matches = findTaskMatches(step.params);
        if (matches.length !== 1) {
          return {
            reply:
              matches.length === 0
                ? 'No matching task was found to snooze.'
                : `I found multiple tasks to snooze: ${matches
                    .slice(0, 3)
                    .map((item) => item.title)
                    .join(', ')}.`,
            status: matches.length === 0 ? 'failed' : 'needs_confirmation',
            evidence: matches.length > 1 ? { matches } : null,
          };
        }

        const explicitDue = getStringParam(step.params, 'dueAt');
        const delayMinutes =
          typeof step.params.delayMinutes === 'number' ? step.params.delayMinutes : 30;
        const nextDue = explicitDue
          ? parseDateLike(explicitDue)
          : new Date(Date.now() + delayMinutes * 60_000);

        if (!nextDue) {
          return {
            reply: 'Task snooze needs a valid new time.',
            status: 'failed',
          };
        }

        const updated = taskRepo.update({
          ...matches[0],
          dueAt: nextDue.toISOString(),
          updatedAt: new Date().toISOString(),
        });
        const scheduled = await scheduleNotificationIfNeeded(updated);
        return {
          reply: `${scheduled.task.title} was snoozed.`,
          evidence: { task: scheduled.task, notification: scheduled.notification },
        };
      }

      case 'delete': {
        const matches = findTaskMatches(step.params);
        if (matches.length !== 1) {
          return {
            reply:
              matches.length === 0
                ? 'No matching task was found to delete.'
                : `I found multiple tasks to delete: ${matches
                    .slice(0, 3)
                    .map((item) => item.title)
                    .join(', ')}.`,
            status: matches.length === 0 ? 'failed' : 'needs_confirmation',
            evidence: matches.length > 1 ? { matches } : null,
          };
        }

        await taskNotificationService.cancelTaskReminder(matches[0].notificationId);
        taskRepo.delete(matches[0].id);
        return {
          reply: `${matches[0].title} was deleted.`,
          evidence: { taskId: matches[0].id },
        };
      }

      default:
        return {
          reply: `Task command ${step.command} is not implemented.`,
          status: 'failed',
        };
    }
  },

  verify: async (step, execution) => {
    if (
      execution.status === 'failed' ||
      execution.status === 'needs_confirmation'
    ) {
      return execution;
    }

    if (
      step.command === 'create' ||
      step.command === 'update' ||
      step.command === 'complete' ||
      step.command === 'snooze'
    ) {
      const task = execution.evidence?.task as TaskItem | undefined;
      if (!task?.id) {
        return {
          ...execution,
          status: 'failed',
          error: 'Missing task id for verification.',
        };
      }

      const verifiedTask = taskRepo.getById(task.id);
      if (!verifiedTask) {
        return {
          ...execution,
          status: 'failed',
          error: 'Task could not be reloaded after write.',
        };
      }

      return {
        ...execution,
        status: 'verified',
        evidence: { task: verifiedTask },
      };
    }

    if (step.command === 'delete') {
      const taskId = execution.evidence?.taskId;
      if (typeof taskId !== 'string') {
        return {
          ...execution,
          status: 'failed',
          error: 'Missing task id for delete verification.',
        };
      }

      return {
        ...execution,
        status: taskRepo.getById(taskId) ? 'failed' : 'verified',
      };
    }

    return {
      ...execution,
      status: execution.status || 'unverified',
    };
  },
};
