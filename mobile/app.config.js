module.exports = ({ config }) => ({
  ...config,
  name: "Don't Get Caught",
  slug: 'dont-get-caught-gps',
  scheme: 'dontgetcaught',
  ios: { ...config.ios, bundleIdentifier: 'com.dontgetcaught.gpsspike', infoPlist: {
    NSLocalNetworkUsageDescription: 'Connect to your private GPS test server on the local network.',
    // Development-only: permits numeric LAN addresses for the private test server.
    NSAppTransportSecurity: { NSAllowsLocalNetworking: true, NSAllowsArbitraryLoads: true }
  } },
  android: { ...config.android, package: 'com.dontgetcaught.gpsspike' },
  extra: { androidMapsEnabled: Boolean(process.env.GOOGLE_MAPS_ANDROID_API_KEY) },
  plugins: [
    'expo-router',
    'expo-secure-store',
    ['expo-build-properties', { android: { usesCleartextTraffic: true } }],
    ['react-native-maps', { androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY || '' }],
    ['expo-location', {
      locationWhenInUsePermission: 'Show your position during a private chase test.',
      locationAlwaysAndWhenInUsePermission: 'Share runner GPS during an active test, including when the screen is locked.',
      isIosBackgroundLocationEnabled: true,
      isAndroidBackgroundLocationEnabled: true,
      isAndroidForegroundServiceEnabled: true
    }]
  ]
});
