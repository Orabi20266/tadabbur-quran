import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/app.css';
import { registerSW } from 'virtual:pwa-register';

if (import.meta.env.PROD) {
  registerSW({ immediate: true });

  // Deployments must reach readers who keep the app open for a whole session.
  // A page that was already controlled reloads once when the new worker takes
  // over; the first visit does not reload.
  if ('serviceWorker' in navigator) {
    const hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) window.location.reload();
    });

    const checkForUpdate = () => {
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (reg) void reg.update();
      });
    };
    window.setInterval(checkForUpdate, 30 * 60 * 1000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkForUpdate();
    });
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
