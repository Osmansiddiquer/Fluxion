/**
 * Copy text that is still being produced (a share link built from IndexedDB +
 * compression). Safari only allows a clipboard write during the click's user
 * activation, so hand it a *pending* ClipboardItem right away (the same pattern
 * as GraphMenu.share); fall back to writeText where ClipboardItem promises
 * aren't supported.
 */
interface ClipboardEnv {
  navigator?: { clipboard?: Partial<Pick<Clipboard, 'write' | 'writeText'>> };
  ClipboardItem?: typeof ClipboardItem;
}

export async function copyPendingText(text: Promise<string>, env: ClipboardEnv = globalThis as ClipboardEnv): Promise<void> {
  const cb = env.navigator?.clipboard;
  if (!cb) throw new Error('Clipboard unavailable');
  const Item = env.ClipboardItem;
  if (Item && cb.write) {
    const blob = text.then((s) => new Blob([s], { type: 'text/plain' }));
    await cb.write([new Item({ 'text/plain': blob })]);
    return;
  }
  if (!cb.writeText) throw new Error('Clipboard unavailable');
  await cb.writeText(await text);
}
