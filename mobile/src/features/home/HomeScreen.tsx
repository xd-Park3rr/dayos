import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ActivityBlock } from '../../components/ActivityBlock';
import { CoachBanner } from '../../components/CoachBanner';
import { MomentumCard } from '../../components/MomentumCard';
import { COLORS } from '../../constants';
import { profileRepo } from '../../db/repositories';
import { jarvisService } from '../../services/ai/jarvisService';
import { useAppStore } from '../../store';

export function HomeScreen() {
  const { activities, momentumSummaries, loadAll } = useAppStore();
  const navigation = useNavigation<any>();

  useEffect(() => {
    const unsub = navigation.addListener('focus', () => loadAll());
    return unsub;
  }, [navigation, loadAll]);

  const profile = profileRepo.get();
  const now = new Date();
  const dayName = now.toLocaleDateString('en-US', { weekday: 'long' });
  const dateNum = now.getDate();
  const monthName = now.toLocaleDateString('en-US', { month: 'long' });
  const initials = (profile?.name || 'U').substring(0, 2).toUpperCase();

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.headerRow}>
          <View style={styles.headerTextCol}>
            <Text style={styles.greetingText}>Good morning,</Text>
            <Text style={styles.nameText}>{profile?.name || 'User'}.</Text>
            <Text style={styles.dateText}>
              {dayName} | {dateNum} {monthName} | {activities.length} items ahead
            </Text>
          </View>
          <View style={styles.headerActions}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
            <TouchableOpacity
              style={styles.settingsBtn}
              onPress={() => navigation.navigate('Settings')}
            >
              <Text style={styles.settingsIcon}>CFG</Text>
            </TouchableOpacity>
          </View>
        </View>

        <CoachBanner />

        <Text style={styles.sectionLabel}>TODAY'S BLOCKS</Text>
        <View style={styles.blocksWrapper}>
          {activities.length > 0 ? (
            activities.map((act, i) => (
              <ActivityBlock key={act.logId || `act_${i}`} activity={act} />
            ))
          ) : (
            <Text style={styles.emptyText}>No blocks scheduled today.</Text>
          )}
        </View>

        <Text style={[styles.sectionLabel, styles.momentumLabel]}>MOMENTUM</Text>
        <View style={styles.momentumColumn}>
          {momentumSummaries.length > 0 ? (
            momentumSummaries.map((summary) => (
              <MomentumCard
                key={summary.categoryId}
                summary={summary}
                onPress={() => navigation.navigate('MomentumDetail', { categoryId: summary.categoryId })}
              />
            ))
          ) : (
            <Text style={styles.emptyText}>Not enough data yet.</Text>
          )}
        </View>
        <View style={styles.bottomSpacer} />
      </ScrollView>

      <View style={styles.inputArea}>
        <View style={styles.inputRow}>
          <TouchableOpacity
            style={styles.inputTouchable}
            activeOpacity={0.9}
            onPress={() => navigation.navigate('Chat')}
          >
            <View style={styles.inputPrompt}>
              <View style={styles.inputDot} />
              <Text style={styles.inputText}>Ask your coach anything...</Text>
            </View>
            <View style={styles.inputArrowBtn}>
              <Text style={styles.arrowText}>Go</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.jarvisBtn}
            activeOpacity={0.9}
            onPress={() => jarvisService.activateManual()}
          >
            <Text style={styles.jarvisBtnText}>Talk</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 100,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 24,
  },
  headerTextCol: {
    flex: 1,
  },
  headerActions: {
    alignItems: 'flex-end',
    gap: 8,
  },
  greetingText: {
    fontFamily: 'DMSerifDisplay',
    fontSize: 28,
    color: COLORS.textPrimary,
    marginBottom: -4,
  },
  nameText: {
    fontFamily: 'DMSerifDisplay_Italic',
    fontSize: 28,
    color: COLORS.accent,
    marginBottom: 8,
  },
  dateText: {
    fontFamily: 'DMSans',
    fontSize: 11,
    color: COLORS.textMuted,
    letterSpacing: 0.5,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.accent,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
  },
  avatarText: {
    color: COLORS.background,
    fontFamily: 'DMSans_700Bold',
    fontSize: 12,
  },
  settingsBtn: {
    minWidth: 40,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 16,
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  settingsIcon: {
    color: COLORS.textMuted,
    fontSize: 10,
    fontFamily: 'DMSans_700Bold',
    letterSpacing: 0.8,
  },
  sectionLabel: {
    fontFamily: 'DMSans_700Bold',
    fontSize: 10,
    color: COLORS.textMuted,
    marginBottom: 16,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  momentumLabel: {
    marginTop: 20,
  },
  blocksWrapper: {
    marginLeft: 0,
  },
  emptyText: {
    fontFamily: 'DMSans_500Medium',
    color: COLORS.textHint,
    marginBottom: 20,
  },
  momentumColumn: {
    width: '100%',
  },
  bottomSpacer: {
    height: 40,
  },
  inputArea: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 20,
    paddingBottom: 30,
    backgroundColor: 'transparent',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  inputTouchable: {
    flex: 1,
    backgroundColor: COLORS.surface,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: COLORS.surfaceElevated,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
  },
  inputPrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  inputDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.accent,
  },
  inputText: {
    fontFamily: 'DMSans',
    color: COLORS.textMuted,
    fontSize: 14,
  },
  inputArrowBtn: {
    minWidth: 42,
    height: 28,
    borderRadius: 14,
    paddingHorizontal: 10,
    backgroundColor: COLORS.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  arrowText: {
    color: COLORS.background,
    fontSize: 12,
    fontFamily: 'DMSans_700Bold',
  },
  jarvisBtn: {
    height: 52,
    borderRadius: 26,
    paddingHorizontal: 18,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 8,
  },
  jarvisBtnText: {
    color: COLORS.background,
    fontSize: 13,
    fontFamily: 'DMSans_700Bold',
  },
});
