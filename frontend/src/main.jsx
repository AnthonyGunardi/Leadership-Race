import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';

/* v8 ignore start -- startup/bootstrap code: DOM mount entry point executed only in real browser index.html */
/* c8 ignore start -- startup/bootstrap code: DOM mount entry point executed only in real browser index.html */
const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
/* c8 ignore stop */
/* v8 ignore stop */
