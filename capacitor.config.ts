import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.orabi20266.tadabbur',
  appName: 'تدبّر',
  webDir: 'dist',
  logging: false,
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: '#f7f4ec',
      showSpinner: false,
    },
    StatusBar: {
      overlaysWebView: false,
      style: 'DARK',
      backgroundColor: '#f7f4ec',
    },
  },
};

export default config;
