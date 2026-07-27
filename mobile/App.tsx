import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StripeTerminalProvider } from '@stripe/stripe-terminal-react-native';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator, StyleSheet } from 'react-native';

import LoginScreen from './src/screens/LoginScreen';
import POSScreen from './src/screens/POSScreen';
import * as api from './src/api';

export type RootStackParamList = {
  Login: undefined;
  POS: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

async function fetchConnectionToken(): Promise<string> {
  return api.getConnectionToken();
}

export default function App() {
  const [initialRoute, setInitialRoute] = useState<'Login' | 'POS' | null>(null);

  useEffect(() => {
    api.getToken().then((token) => {
      setInitialRoute(token ? 'POS' : 'Login');
    });
  }, []);

  if (initialRoute === null) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StripeTerminalProvider
        logLevel="verbose"
        tokenProvider={fetchConnectionToken}
      >
        <NavigationContainer>
          <Stack.Navigator
            initialRouteName={initialRoute}
            screenOptions={{ headerShown: false }}
          >
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="POS" component={POSScreen} />
          </Stack.Navigator>
        </NavigationContainer>
        <StatusBar style="light" />
      </StripeTerminalProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: '#1a3a5c',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
