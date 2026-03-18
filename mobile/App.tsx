import { useEffect } from 'react';
import { StyleSheet, ActivityIndicator, View } from 'react-native';
import { runMigrations } from './src/db/client';
import { profileRepo } from './src/db/repositories';
import { useAppStore, useChatStore } from './src/store';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { OnboardingFlow } from './src/features/onboarding/OnboardingFlow';
import { HomeScreen } from './src/features/home/HomeScreen';
import { COLORS } from './src/constants';

import { ChatScreen } from './src/features/chat/ChatScreen';
import { CategoryEditor } from './src/features/categories/CategoryEditor';
import { JarvisOverlay } from './src/components/JarvisOverlay';
import { ToastHost } from './src/components/ToastHost';

import { consequenceEngine } from './src/services/guard/consequenceEngine';
import { calendarService } from './src/services/calendar/calendarService';
import { screentimeService } from './src/services/screentime/screentimeService';
import { bluetoothContext } from './src/services/context/bluetoothContext';
import { contextEngine } from './src/services/context/contextEngine';
import { BluetoothMappingScreen } from './src/features/settings/BluetoothMappingScreen';
import { SettingsScreen } from './src/features/settings/SettingsScreen';
import { jarvisService } from './src/services/ai/jarvisService';
import { MomentumDetailScreen } from './src/features/momentum/MomentumDetailScreen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { taskNotificationService } from './src/services/task/taskNotificationService';

import { 
  useFonts, 
  DMSans_400Regular, 
  DMSans_500Medium, 
  DMSans_700Bold 
} from '@expo-google-fonts/dm-sans';
import { 
  DMSerifDisplay_400Regular, 
  DMSerifDisplay_400Regular_Italic 
} from '@expo-google-fonts/dm-serif-display';

const Stack = createNativeStackNavigator();

export default function App() {
  const { isBooted, onboardingComplete, setBooted, setOnboardingComplete } = useAppStore();
  const hydrateChat = useChatStore((state) => state.hydrate);
  const [fontsLoaded] = useFonts({
    DMSans: DMSans_400Regular,
    DMSans_Medium: DMSans_500Medium,
    DMSans_Bold: DMSans_700Bold,
    DMSerifDisplay: DMSerifDisplay_400Regular,
    DMSerifDisplay_Italic: DMSerifDisplay_400Regular_Italic
  });

  useEffect(() => {
    const boot = async () => {
      try {
        runMigrations();
        hydrateChat();
        consequenceEngine.start();
        screentimeService.startMonitoring();
        await taskNotificationService.initialize();
        void calendarService.syncCalendarCache();
        bluetoothContext.startMonitoring();
        contextEngine.start();
        await jarvisService.initialize();

        const profile = profileRepo.get();
        if (profile?.onboardingComplete) {
          setOnboardingComplete(true);
        } else {
          setOnboardingComplete(false);
        }
      } catch(e) {
        console.error('[DB Boot Failed]', e);
      } finally {
        setBooted(true);
      }
    };

    void boot();
  }, [hydrateChat, setBooted, setOnboardingComplete]);

  if (!isBooted || !fontsLoaded) {
    return (
      <View style={styles.container}>
        <ActivityIndicator color={COLORS.accent} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: COLORS.background } }}>
          {!onboardingComplete ? (
            <Stack.Screen name="Onboarding" component={OnboardingFlow} />
          ) : (
            <Stack.Group>
              <Stack.Screen name="Home" component={HomeScreen} />
              <Stack.Screen name="Chat" component={ChatScreen} />
              <Stack.Screen name="MomentumDetail" component={MomentumDetailScreen} />
              <Stack.Screen name="CategoryEditor" component={CategoryEditor} />
              <Stack.Screen name="Settings" component={SettingsScreen} />
              <Stack.Screen name="BluetoothMappingScreen" component={BluetoothMappingScreen} />
            </Stack.Group>
          )}
        </Stack.Navigator>
      </NavigationContainer>
      <ToastHost />
      <JarvisOverlay />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background, alignItems: 'center', justifyContent: 'center' },
});
