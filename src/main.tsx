import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { takePairingFromLocation } from './ai/bridge-client.ts';
import { App } from './ui/App.tsx';

// A pairing code in the URL fragment is stored for this tab and removed from the address bar at once.
takePairingFromLocation();

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
