import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { sim } from './simulator/controller';
import { useSim } from './state/simStore';
import { useApp } from './state/store';
import './styles/app.css';

// acceso de depuración desde la consola del navegador (solo en desarrollo)
if (import.meta.env.DEV) Object.assign(window, { __esp32sim: { useApp, useSim, sim } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
