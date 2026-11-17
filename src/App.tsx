import { useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Reader } from './pages/Reader';
import { Tracker } from './pages/Tracker';
import { Activity } from './pages/Activity';
import { Settings } from './pages/Settings';
import { Onboarding } from './pages/Onboarding';
import { Tajweed } from './pages/Tajweed';
import { HadithPage } from './pages/Hadith';
import { Tafsir } from './pages/Tafsir';
import { Ask } from './pages/Ask';
import { useApp } from './lib/store';

function useTheme() {
  const theme = useApp((s) => s.settings.theme);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', dark ? '#0b1210' : '#1e6b4a');
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
}

function Shell() {
  useTheme();
  const onboarded = useApp((s) => s.onboarded);
  const { pathname } = useLocation();

  if (!onboarded && pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />;
  }

  return (
    <Routes>
      <Route path="/onboarding" element={<Onboarding />} />
      <Route path="/read/:surah" element={<Reader />} />
      <Route
        path="/"
        element={
          <Layout>
            <Dashboard />
          </Layout>
        }
      />
      <Route
        path="/memorize"
        element={
          <Layout>
            <Tracker />
          </Layout>
        }
      />
      <Route
        path="/activity"
        element={
          <Layout>
            <Activity />
          </Layout>
        }
      />
      <Route
        path="/tajweed"
        element={
          <Layout>
            <Tajweed />
          </Layout>
        }
      />
      <Route
        path="/hadith"
        element={
          <Layout>
            <HadithPage />
          </Layout>
        }
      />
      <Route
        path="/ask"
        element={
          <Layout>
            <Ask />
          </Layout>
        }
      />
      <Route
        path="/tafsir"
        element={
          <Layout>
            <Tafsir />
          </Layout>
        }
      />
      <Route
        path="/tafsir/:surah/:ayah"
        element={
          <Layout>
            <Tafsir />
          </Layout>
        }
      />
      <Route
        path="/settings"
        element={
          <Layout>
            <Settings />
          </Layout>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}
