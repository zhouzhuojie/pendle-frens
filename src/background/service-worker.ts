/**
 * MV3 service worker — it exists for one line.
 *
 * `sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` can only be
 * called from the worker, and it must happen at install/startup or the toolbar
 * button does nothing.
 *
 * That is the whole job. No network, no badge, no timers, no `alarms`. The
 * panel fetches and caches for itself (see `lib/api/client.ts`).
 */

/** Toolbar click opens the side panel instead of a transient popup. */
async function configureSidePanel(): Promise<void> {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch {
    // Older Chrome builds reject this; the panel is still reachable from the
    // side-panel picker, so failing here must not break the extension.
  }
}

chrome.runtime.onInstalled.addListener(() => void configureSidePanel());
chrome.runtime.onStartup.addListener(() => void configureSidePanel());

// The manifest declares this worker as `"type": "module"`; the empty export keeps
// the file an explicit module so it can be imported by the end-to-end test.
export {};
