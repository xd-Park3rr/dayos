import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { COLORS } from '../../constants';
import {
  assistantRunRepo,
  assistantSettingRepo,
} from '../../db/repositories';
import type {
  AssistantAutonomyMode,
  AssistantRunWithSteps,
} from '../../types';
import {
  permissionService,
  type PermissionSnapshot,
} from '../../services/assistant/permissionService';

const permissionTargets: Record<keyof PermissionSnapshot, string> = {
  calendar: 'calendar',
  contacts: 'contacts',
  notifications: 'notifications',
  usageAccess: 'usage_access',
  overlay: 'overlay',
};

export function SettingsScreen() {
  const navigation = useNavigation<any>();
  const [autonomyMode, setAutonomyMode] = useState<AssistantAutonomyMode>('safe_auto');
  const [runs, setRuns] = useState<AssistantRunWithSteps[]>([]);
  const [permissions, setPermissions] = useState<PermissionSnapshot | null>(null);

  const load = async () => {
    setAutonomyMode(assistantSettingRepo.getAutonomyMode());
    setRuns(assistantRunRepo.getRecent(8));
    setPermissions(await permissionService.getSnapshot());
  };

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      void load();
    });
    void load();
    return unsubscribe;
  }, [navigation]);

  const toggleAutonomy = (enabled: boolean) => {
    const nextMode: AssistantAutonomyMode = enabled ? 'auto_everything' : 'safe_auto';
    assistantSettingRepo.setAutonomyMode(nextMode);
    setAutonomyMode(nextMode);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>{'< Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Settings</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Assistant autonomy</Text>
          <Text style={styles.cardBody}>
            Safe auto verifies reads and low-risk writes automatically. Auto everything runs outbound
            and destructive steps without confirmation, but still requires verification before it
            reports success.
          </Text>
          <View style={styles.settingRow}>
            <View>
              <Text style={styles.settingLabel}>Auto everything</Text>
              <Text style={styles.settingHint}>
                Current mode: {autonomyMode === 'auto_everything' ? 'Auto everything' : 'Safe auto'}
              </Text>
            </View>
            <Switch
              value={autonomyMode === 'auto_everything'}
              onValueChange={toggleAutonomy}
              trackColor={{ false: '#333', true: COLORS.accent }}
            />
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Android setup</Text>
          <Text style={styles.cardBody}>
            These permissions and Android settings gate verified command execution.
          </Text>
          {permissions &&
            Object.entries(permissions).map(([key, value]) => (
              <View key={key} style={styles.permissionRow}>
                <View style={styles.permissionInfo}>
                  <Text style={styles.permissionName}>{key}</Text>
                  <Text style={styles.permissionStatus}>
                    {value.granted ? 'Granted' : `Missing (${value.status})`}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.permissionBtn}
                  onPress={() => permissionService.openSettings(permissionTargets[key as keyof PermissionSnapshot])}
                >
                  <Text style={styles.permissionBtnText}>Open</Text>
                </TouchableOpacity>
              </View>
            ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Context devices</Text>
          <Text style={styles.cardBody}>
            Bluetooth mapping remains under settings, but it now lives beside assistant controls.
          </Text>
          <TouchableOpacity
            style={styles.linkBtn}
            onPress={() => navigation.navigate('BluetoothMappingScreen')}
          >
            <Text style={styles.linkBtnText}>Manage Bluetooth mappings</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Command history</Text>
          <Text style={styles.cardBody}>
            Recent command runs include step-level verification evidence.
          </Text>
          {runs.length === 0 && <Text style={styles.emptyText}>No command history yet.</Text>}
          {runs.map((run) => (
            <View key={run.id} style={styles.runCard}>
              <View style={styles.runHeader}>
                <Text style={styles.runSummary}>{run.summary}</Text>
                <Text style={styles.runStatus}>{run.status}</Text>
              </View>
              <Text style={styles.runMeta}>
                {new Date(run.createdAt).toLocaleString()} | {run.source}
              </Text>
              {run.steps.slice(0, 4).map((step) => (
                <View key={step.id} style={styles.stepRow}>
                  <Text style={styles.stepTitle}>
                    {step.namespace}.{step.command}
                  </Text>
                  <Text style={styles.stepStatus}>{step.status}</Text>
                  <Text style={styles.stepBody}>{step.humanSummary}</Text>
                  {step.error ? <Text style={styles.stepError}>{step.error}</Text> : null}
                  {step.evidence ? (
                    <Text style={styles.stepEvidence}>
                      {JSON.stringify(step.evidence).slice(0, 180)}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  backBtn: {
    paddingVertical: 8,
  },
  backText: {
    color: COLORS.textMuted,
    fontFamily: 'DMSans_500Medium',
  },
  title: {
    color: COLORS.textPrimary,
    fontSize: 18,
    fontFamily: 'DMSans_700Bold',
    marginLeft: 12,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    gap: 16,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardTitle: {
    color: COLORS.textPrimary,
    fontFamily: 'DMSans_700Bold',
    fontSize: 15,
    marginBottom: 8,
  },
  cardBody: {
    color: COLORS.textMuted,
    fontFamily: 'DMSans',
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 12,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  settingLabel: {
    color: COLORS.textPrimary,
    fontFamily: 'DMSans_500Medium',
  },
  settingHint: {
    color: COLORS.textHint,
    fontFamily: 'DMSans',
    fontSize: 12,
    marginTop: 4,
  },
  permissionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.04)',
  },
  permissionInfo: {
    flex: 1,
  },
  permissionName: {
    color: COLORS.textPrimary,
    fontFamily: 'DMSans_500Medium',
    textTransform: 'capitalize',
  },
  permissionStatus: {
    color: COLORS.textMuted,
    fontFamily: 'DMSans',
    fontSize: 12,
    marginTop: 2,
  },
  permissionBtn: {
    backgroundColor: COLORS.accent,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  permissionBtnText: {
    color: COLORS.background,
    fontFamily: 'DMSans_700Bold',
    fontSize: 12,
  },
  linkBtn: {
    backgroundColor: COLORS.accent,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    alignSelf: 'flex-start',
  },
  linkBtnText: {
    color: COLORS.background,
    fontFamily: 'DMSans_700Bold',
  },
  emptyText: {
    color: COLORS.textHint,
    fontFamily: 'DMSans',
  },
  runCard: {
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.04)',
  },
  runHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  runSummary: {
    flex: 1,
    color: COLORS.textPrimary,
    fontFamily: 'DMSans_500Medium',
  },
  runStatus: {
    color: COLORS.accent,
    fontFamily: 'DMSans_700Bold',
    fontSize: 11,
    textTransform: 'uppercase',
  },
  runMeta: {
    color: COLORS.textHint,
    fontFamily: 'DMSans',
    fontSize: 11,
    marginTop: 4,
    marginBottom: 8,
  },
  stepRow: {
    backgroundColor: '#1d1f24',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  stepTitle: {
    color: COLORS.textPrimary,
    fontFamily: 'DMSans_700Bold',
    fontSize: 12,
  },
  stepStatus: {
    color: COLORS.textMuted,
    fontFamily: 'DMSans_500Medium',
    fontSize: 11,
    marginTop: 2,
    textTransform: 'uppercase',
  },
  stepBody: {
    color: COLORS.textMuted,
    fontFamily: 'DMSans',
    fontSize: 12,
    marginTop: 6,
  },
  stepError: {
    color: COLORS.red,
    fontFamily: 'DMSans',
    fontSize: 11,
    marginTop: 6,
  },
  stepEvidence: {
    color: COLORS.textHint,
    fontFamily: 'DMSans',
    fontSize: 10,
    marginTop: 6,
  },
});
