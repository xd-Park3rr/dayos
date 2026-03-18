import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useChatStore } from '../../store';
import { COLORS } from '../../constants';
import { jarvisService } from '../../services/ai/jarvisService';
import { ConsequenceCard } from '../../components/ConsequenceCard';

const COMPOSER_MIN_HEIGHT = 48;
const COMPOSER_MAX_HEIGHT = 140;
const CHAT_MAX_WIDTH = 720;

export function ChatScreen() {
  const navigation = useNavigation<any>();
  const { messages } = useChatStore();
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [composerHeight, setComposerHeight] = useState(COMPOSER_MIN_HEIGHT);
  const scrollRef = useRef<ScrollView>(null);

  const scrollToBottom = (animated: boolean) => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated });
    });
  };

  useEffect(() => {
    scrollToBottom(true);
  }, [messages.length, loading]);

  const handleSend = async (overrideText?: string) => {
    const textToSend = overrideText || input;
    if (!textToSend.trim() || loading) {
      return;
    }

    setInput('');
    setComposerHeight(COMPOSER_MIN_HEIGHT);
    setLoading(true);

    try {
      await jarvisService.submitChat(textToSend.trim());
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
      scrollToBottom(true);
    }
  };

  const isLastMessageAssistant =
    messages.length > 0 && messages[messages.length - 1].role === 'assistant';
  const lastAssistantMetadata =
    isLastMessageAssistant ? messages[messages.length - 1].metadata || null : null;
  const awaitingConfirmation =
    !!lastAssistantMetadata &&
    typeof lastAssistantMetadata === 'object' &&
    lastAssistantMetadata.status === 'awaiting_confirmation';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 24 : 0}
      >
        <View style={styles.shell}>
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.avatar}>
                <View style={styles.avatarInner} />
              </View>
              <View style={styles.headerInfo}>
                <Text style={styles.name}>Coach</Text>
                <Text style={styles.status}>Active - watching your day</Text>
              </View>
            </View>

            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
              <Text style={styles.backText}>{'Home ->'}</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            ref={scrollRef}
            style={styles.messageScroll}
            contentContainerStyle={styles.messageList}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => scrollToBottom(true)}
          >
            {messages.length === 0 && (
              <Text style={styles.emptyText}>Ask your coach anything about your day.</Text>
            )}

            {messages.map((message, index) => {
              const content = String(message.content);

              if (content.startsWith('[CONSEQUENCE:drift]')) {
                return (
                  <ConsequenceCard
                    key={index}
                    type="Drift"
                    message={content.replace('[CONSEQUENCE:drift]', '').trim()}
                  />
                );
              }

              return (
                <View
                  key={index}
                  style={message.role === 'user' ? styles.msgUser : styles.msgCoach}
                >
                  {message.source === 'voice' && (
                    <Text style={styles.sourceLabel}>
                      {message.role === 'user' ? 'Voice command' : 'Voice reply'}
                    </Text>
                  )}
                  <Text
                    style={message.role === 'user' ? styles.msgTextUser : styles.msgTextCoach}
                  >
                    {content}
                  </Text>
                </View>
              );
            })}

            {loading && <ActivityIndicator color={COLORS.accent} style={styles.loadingIndicator} />}
          </ScrollView>

          <View style={styles.bottomArea}>
            {isLastMessageAssistant && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.quickReplies}
                contentContainerStyle={styles.quickReplyContent}
              >
                {awaitingConfirmation ? (
                  <>
                    <TouchableOpacity style={styles.chip} onPress={() => handleSend('Confirm')}>
                      <Text style={styles.chipText}>Confirm</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.chip} onPress={() => handleSend('Cancel')}>
                      <Text style={styles.chipText}>Cancel</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <TouchableOpacity style={styles.chip} onPress={() => handleSend("What's next?")}>
                      <Text style={styles.chipText}>{"What's next?"}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.chip} onPress={() => handleSend('Show my schedule')}>
                      <Text style={styles.chipText}>Show schedule</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.chip} onPress={() => handleSend('Check permissions')}>
                      <Text style={styles.chipText}>Check setup</Text>
                    </TouchableOpacity>
                  </>
                )}
              </ScrollView>
            )}

            <View style={styles.inputContainer}>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={[styles.input, { height: composerHeight }]}
                  value={input}
                  onChangeText={setInput}
                  placeholder="Reply to your coach..."
                  placeholderTextColor={COLORS.textHint}
                  multiline
                  textAlignVertical="top"
                  scrollEnabled={composerHeight >= COMPOSER_MAX_HEIGHT}
                  onContentSizeChange={(event) => {
                    const nextHeight = Math.min(
                      COMPOSER_MAX_HEIGHT,
                      Math.max(COMPOSER_MIN_HEIGHT, event.nativeEvent.contentSize.height + 18)
                    );
                    setComposerHeight(nextHeight);
                  }}
                  onFocus={() => scrollToBottom(true)}
                />

                <TouchableOpacity style={styles.sendBtn} onPress={() => handleSend()}>
                  <Text style={styles.sendIcon}>{'->'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  shell: {
    flex: 1,
    width: '100%',
    maxWidth: CHAT_MAX_WIDTH,
    alignSelf: 'center',
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 12,
    paddingBottom: 16,
    backgroundColor: COLORS.background,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(200, 242, 122, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInner: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: COLORS.accent,
  },
  headerInfo: {
    justifyContent: 'center',
  },
  name: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontFamily: 'DMSans_700Bold',
  },
  status: {
    color: COLORS.accent,
    fontSize: 10,
    fontFamily: 'DMSans_500Medium',
  },
  backBtn: {
    paddingVertical: 5,
  },
  backText: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontFamily: 'DMSans_500Medium',
  },
  messageScroll: {
    flex: 1,
  },
  messageList: {
    paddingBottom: 20,
  },
  msgCoach: {
    alignSelf: 'flex-start',
    backgroundColor: '#1e2025',
    padding: 16,
    borderRadius: 12,
    borderBottomLeftRadius: 4,
    marginBottom: 12,
    maxWidth: '85%',
  },
  msgUser: {
    alignSelf: 'flex-end',
    backgroundColor: COLORS.accent,
    padding: 16,
    borderRadius: 12,
    borderBottomRightRadius: 4,
    marginBottom: 12,
    maxWidth: '85%',
  },
  msgTextCoach: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontFamily: 'DMSans',
    lineHeight: 22,
  },
  msgTextUser: {
    color: COLORS.background,
    fontSize: 14,
    fontFamily: 'DMSans_500Medium',
    lineHeight: 22,
  },
  sourceLabel: {
    color: COLORS.textMuted,
    fontSize: 10,
    fontFamily: 'DMSans_700Bold',
    letterSpacing: 0.5,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  emptyText: {
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: 40,
    fontFamily: 'DMSans',
  },
  bottomArea: {
    backgroundColor: COLORS.background,
    paddingTop: 12,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  quickReplies: {
    marginBottom: 12,
    maxHeight: 40,
  },
  quickReplyContent: {
    gap: 8,
    paddingRight: 4,
  },
  chip: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  chipText: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontFamily: 'DMSans_500Medium',
  },
  inputContainer: {
    paddingHorizontal: 4,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: '#1e2025',
    borderRadius: 30,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  input: {
    flex: 1,
    color: COLORS.textPrimary,
    fontFamily: 'DMSans',
    fontSize: 14,
    paddingHorizontal: 0,
    paddingVertical: 10,
    maxHeight: COMPOSER_MAX_HEIGHT,
  },
  sendBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.accent,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 10,
  },
  sendIcon: {
    color: COLORS.background,
    fontWeight: 'bold',
    fontSize: 18,
    marginTop: -2,
  },
  loadingIndicator: {
    alignSelf: 'flex-start',
    marginVertical: 8,
  },
});
