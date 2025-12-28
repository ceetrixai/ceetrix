/**
 * Browser launch utilities
 */

import open from 'open';

/**
 * Open the system browser to the specified URL.
 *
 * @param url - URL to open
 * @returns true if browser was opened, false otherwise
 */
export async function openBrowser(url: string): Promise<boolean> {
  try {
    console.log('[DEBUG] openBrowser: calling open()...');
    const childProcess = await open(url);
    console.log('[DEBUG] openBrowser: open() returned, pid:', childProcess.pid);
    // Detach the child process so Node.js can exit cleanly
    // without waiting for the browser to close
    childProcess.unref();
    console.log('[DEBUG] openBrowser: unref() called');
    return true;
  } catch (err) {
    console.log('[DEBUG] openBrowser: error:', err);
    return false;
  }
}
