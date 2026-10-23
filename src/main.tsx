import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import 'katex/dist/katex.min.css';
import './styles/global.css';
import { parseDocsHash } from './components/Docs/hash';

// Links into the short-lived in-app docs panel (#docs/<section>) now go to the
// docs page (docs/#<section>).
const legacyDocs = parseDocsHash(location.hash);
if (legacyDocs) location.replace(`docs/${legacyDocs.section ? `#${legacyDocs.section}` : ''}`);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
