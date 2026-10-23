/**
 * Where the Scripting reference is mounted. Inside the app (Script mode's
 * panel) its buttons drive the editor; on the standalone docs page there is no
 * store or editor, so "Try it" becomes a link that opens the app with the
 * snippet. Dependency-free on purpose: the docs page imports it.
 */
let inApp = false;

/** Called by the Script mode panel when it loads. */
export function markScriptApp(): void {
  inApp = true;
}

export function isScriptApp(): boolean {
  return inApp;
}

/** The app, relative to the docs page (dist/docs/ → dist/). */
export const APP_FROM_DOCS = '../';
