// Entry of the design system gallery: apps/web/gallery.html (dev server: /gallery.html).
// Independent of the app's router and data layer.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './gallery.css';
import { Gallery, readTheme } from './Gallery';

const theme = readTheme(window.location.search);
if (theme !== 'system') document.documentElement.dataset.theme = theme;

const root = document.getElementById('gallery');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Gallery initialTheme={theme} />
    </StrictMode>,
  );
}
