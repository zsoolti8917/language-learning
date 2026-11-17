// Minimal entry from F1, replaced by package F6.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <main className="p-4">Slovak app</main>
    </StrictMode>,
  );
}
