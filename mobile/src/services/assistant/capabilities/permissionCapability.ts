import { permissionService } from '../permissionService';
import type { AssistantCapability } from '../types';
import { getStringParam } from './common';

export const permissionCapability: AssistantCapability = {
  namespace: 'permission',

  execute: async (step) => {
    switch (step.command) {
      case 'status':
      case 'setup_check': {
        const snapshot = await permissionService.getSnapshot();
        const missing = Object.entries(snapshot)
          .filter(([, value]) => !value.granted)
          .map(([key]) => key);

        return {
          reply:
            missing.length === 0
              ? 'All required Android permissions are available.'
              : `Missing Android permissions or setup: ${missing.join(', ')}.`,
          evidence: {
            snapshot,
            missing,
          },
          status: missing.length === 0 ? 'verified' : 'blocked_by_permission',
        };
      }

      case 'open_settings': {
        const target = getStringParam(step.params, 'target') || 'app';
        const opened = await permissionService.openSettings(target);
        return {
          reply: opened
            ? `Opened Android settings for ${target}.`
            : `I could not open Android settings for ${target}.`,
          status: opened ? undefined : 'failed',
          evidence: { target, opened },
        };
      }

      default:
        return {
          reply: `Permission command ${step.command} is not implemented.`,
          status: 'failed',
        };
    }
  },

  verify: async (_step, execution) => ({
    ...execution,
    status: execution.status || 'verified',
  }),
};
