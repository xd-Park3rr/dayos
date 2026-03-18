import { activityCapability } from './capabilities/activityCapability';
import { appCapability } from './capabilities/appCapability';
import { calendarCapability } from './capabilities/calendarCapability';
import { contactsCapability } from './capabilities/contactsCapability';
import { insightCapability } from './capabilities/insightCapability';
import { permissionCapability } from './capabilities/permissionCapability';
import { taskCapability } from './capabilities/taskCapability';
import { communicationCapability } from './capabilities/communicationCapability';
import type { AssistantCapability, AssistantNamespace } from './types';

const capabilities: Record<AssistantNamespace, AssistantCapability> = {
  activity: activityCapability,
  app: appCapability,
  calendar: calendarCapability,
  communication: communicationCapability,
  contacts: contactsCapability,
  insight: insightCapability,
  permission: permissionCapability,
  task: taskCapability,
};

export const capabilityRegistry = {
  get(namespace: AssistantNamespace): AssistantCapability {
    return capabilities[namespace];
  },

  getAll(): AssistantCapability[] {
    return Object.values(capabilities);
  },
};
