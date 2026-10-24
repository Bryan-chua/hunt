import '../game-tracking';
import { Stack } from 'expo-router';
import { GameProvider } from '../game-context';
export default function Layout() { return <GameProvider><Stack screenOptions={{ headerStyle: { backgroundColor: '#f0f4ef' }, headerTintColor: '#143f35', headerShadowVisible: false }}><Stack.Screen name="index" options={{ title: 'Don’t Get Caught' }} /><Stack.Screen name="create" options={{ title: 'Host an event' }} /><Stack.Screen name="event" options={{ title: 'Your event', headerBackVisible: false }} /><Stack.Screen name="diagnostics" options={{ title: 'GPS diagnostics' }} /></Stack></GameProvider>; }
