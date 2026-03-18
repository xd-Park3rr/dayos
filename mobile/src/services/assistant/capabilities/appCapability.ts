import { appBlockRuleRepo, repoUtils } from '../../../db/repositories';
import { appControlService } from '../../app/appControlService';
import type { AssistantCapability } from '../types';
import { getNumberParam, getStringParam } from './common';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const loadUsageStats = async (): Promise<any | null> => {
  try {
    return (await import('react-native-usage-stats')).default;
  } catch {
    return null;
  }
};

const resolveApps = async (params: Record<string, unknown>) => {
  const packageName = getStringParam(params, 'packageName');
  if (packageName) {
    return [{ packageName, label: getStringParam(params, 'appLabel') || packageName }];
  }

  const query = getStringParam(params, 'appQuery') || getStringParam(params, 'query');
  if (!query) {
    return [];
  }

  return appControlService.searchInstalledApps(query);
};

export const appCapability: AssistantCapability = {
  namespace: 'app',

  execute: async (step) => {
    switch (step.command) {
      case 'list_installed': {
        const apps = await appControlService.listInstalledApps();
        return {
          reply: `Found ${apps.length} launchable Android apps.`,
          evidence: { apps },
        };
      }

      case 'search': {
        const query = getStringParam(step.params, 'query') || getStringParam(step.params, 'appQuery');
        if (!query) {
          return {
            reply: 'App search needs a query.',
            status: 'failed',
          };
        }

        const apps = await appControlService.searchInstalledApps(query);
        return {
          reply: `Found ${apps.length} apps matching ${query}.`,
          evidence: { apps },
        };
      }

      case 'launch': {
        const matches = await resolveApps(step.params);
        if (matches.length === 0) {
          return {
            reply: 'No matching Android app was found to launch.',
            status: 'failed',
          };
        }
        if (matches.length > 1) {
          return {
            reply: `I found multiple apps to launch: ${matches
              .slice(0, 4)
              .map((app) => app.label)
              .join(', ')}.`,
            status: 'needs_confirmation',
            evidence: { matches },
          };
        }

        const rule = appBlockRuleRepo.getByPackageName(matches[0].packageName);
        if (rule) {
          return {
            reply: `${matches[0].label} has an active DayOS block rule.`,
            status: 'failed',
            evidence: { rule },
          };
        }

        const opened = await appControlService.launchApp(matches[0].packageName);
        return {
          reply: opened
            ? `Launching ${matches[0].label}.`
            : `I could not launch ${matches[0].label}.`,
          status: opened ? undefined : 'failed',
          evidence: { app: matches[0] },
        };
      }

      case 'open_settings': {
        const matches = await resolveApps(step.params);
        if (matches.length !== 1) {
          return {
            reply:
              matches.length === 0
                ? 'No matching Android app was found to open settings for.'
                : `I found multiple apps: ${matches
                    .slice(0, 4)
                    .map((app) => app.label)
                    .join(', ')}.`,
            status: matches.length === 0 ? 'failed' : 'needs_confirmation',
            evidence: matches.length > 1 ? { matches } : null,
          };
        }

        const opened = await appControlService.openAppSettings(matches[0].packageName);
        return {
          reply: opened
            ? `Opened Android settings for ${matches[0].label}.`
            : `I could not open settings for ${matches[0].label}.`,
          status: opened ? undefined : 'failed',
          evidence: { app: matches[0] },
        };
      }

      case 'usage_query': {
        const UsageStats = await loadUsageStats();
        if (!UsageStats?.getUsageStats) {
          return {
            reply: 'Android usage stats are unavailable in this runtime.',
            status: 'failed',
          };
        }

        const stats = ((await UsageStats.getUsageStats('daily')) || []) as Array<{
          packageName: string;
          totalTimeInForeground?: number;
        }>;

        const packageName = getStringParam(step.params, 'packageName');
        const query = getStringParam(step.params, 'appQuery') || getStringParam(step.params, 'query');
        const filtered = packageName
          ? stats.filter((item) => item.packageName === packageName)
          : query
            ? stats.filter((item) => item.packageName.toLowerCase().includes(query.toLowerCase()))
            : stats;

        return {
          reply: `Loaded usage stats for ${filtered.length} Android app${filtered.length === 1 ? '' : 's'}.`,
          evidence: { stats: filtered },
        };
      }

      case 'block': {
        const matches = await resolveApps(step.params);
        if (matches.length !== 1) {
          return {
            reply:
              matches.length === 0
                ? 'No matching Android app was found to block.'
                : `I found multiple apps to block: ${matches
                    .slice(0, 4)
                    .map((app) => app.label)
                    .join(', ')}.`,
            status: matches.length === 0 ? 'failed' : 'needs_confirmation',
            evidence: matches.length > 1 ? { matches } : null,
          };
        }

        const durationMinutes = getNumberParam(step.params, 'durationMinutes');
        const now = new Date();
        const endsAt =
          durationMinutes && durationMinutes > 0
            ? new Date(now.getTime() + durationMinutes * 60_000).toISOString()
            : null;
        const rule = appBlockRuleRepo.upsert({
          id: repoUtils.createId('apprule'),
          packageName: matches[0].packageName,
          appLabel: matches[0].label,
          reason: getStringParam(step.params, 'reason') || null,
          startsAt: now.toISOString(),
          endsAt,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        });

        return {
          reply: `Saved a DayOS block rule for ${matches[0].label}.`,
          evidence: { rule },
        };
      }

      case 'unblock': {
        const matches = await resolveApps(step.params);
        if (matches.length !== 1) {
          return {
            reply:
              matches.length === 0
                ? 'No matching Android app was found to unblock.'
                : `I found multiple apps to unblock: ${matches
                    .slice(0, 4)
                    .map((app) => app.label)
                    .join(', ')}.`,
            status: matches.length === 0 ? 'failed' : 'needs_confirmation',
            evidence: matches.length > 1 ? { matches } : null,
          };
        }

        appBlockRuleRepo.removeByPackageName(matches[0].packageName);
        return {
          reply: `Removed the DayOS block rule for ${matches[0].label}.`,
          evidence: { packageName: matches[0].packageName },
        };
      }

      default:
        return {
          reply: `App command ${step.command} is not implemented.`,
          status: 'failed',
        };
    }
  },

  verify: async (step, execution) => {
    if (execution.status === 'failed' || execution.status === 'needs_confirmation') {
      return execution;
    }

    if (step.command === 'launch') {
      const app = execution.evidence?.app as { packageName?: string } | undefined;
      if (!app?.packageName) {
        return {
          ...execution,
          status: 'failed',
          error: 'Missing package name for launch verification.',
        };
      }

      const hasUsageAccess = await appControlService.hasUsageAccess();
      if (!hasUsageAccess) {
        return {
          ...execution,
          status: 'unverified',
          error: 'Usage access is missing, so foreground app verification is unavailable.',
        };
      }

      await sleep(500);
      const foregroundPackage = await appControlService.getForegroundApp();
      return {
        ...execution,
        status: foregroundPackage === app.packageName ? 'verified' : 'failed',
        evidence: {
          ...execution.evidence,
          foregroundPackage,
        },
        error:
          foregroundPackage === app.packageName
            ? null
            : `Foreground app did not match ${app.packageName}.`,
      };
    }

    if (step.command === 'block') {
      const rule = execution.evidence?.rule as { packageName?: string } | undefined;
      const verifiedRule = rule?.packageName
        ? appBlockRuleRepo.getByPackageName(rule.packageName)
        : null;
      return {
        ...execution,
        status: verifiedRule ? 'verified' : 'failed',
        evidence: verifiedRule ? { rule: verifiedRule } : execution.evidence,
      };
    }

    if (step.command === 'unblock') {
      const packageName = execution.evidence?.packageName;
      return {
        ...execution,
        status:
          typeof packageName === 'string' && !appBlockRuleRepo.getByPackageName(packageName)
            ? 'verified'
            : 'failed',
      };
    }

    return {
      ...execution,
      status: execution.status || 'verified',
    };
  },
};
