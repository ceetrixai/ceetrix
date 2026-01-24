import { describe, it, expect, afterEach } from 'vitest';
import { startCallbackServer, CallbackServer, getSuccessHtml } from '../src/server.js';

describe('getSuccessHtml', () => {
  it('includes redirect script when webAppUrl is provided', () => {
    const html = getSuccessHtml('https://app.ceetrix.com?source=cli&auth=success');
    expect(html).toContain('window.location.href');
    expect(html).toContain('app.ceetrix.com');
    expect(html).toContain('setTimeout');
    expect(html).toContain('Redirecting to Ceetrix');
  });

  it('does not include redirect when webAppUrl is not provided', () => {
    const html = getSuccessHtml();
    expect(html).not.toContain('window.location.href');
    expect(html).not.toContain('setTimeout');
    expect(html).toContain('Return to your terminal');
  });

  it('does not include redirect when webAppUrl is undefined', () => {
    const html = getSuccessHtml(undefined);
    expect(html).not.toContain('window.location.href');
    expect(html).toContain('Return to your terminal');
  });

  it('escapes webAppUrl properly in the script', () => {
    // URL with query params should be included correctly
    const html = getSuccessHtml('https://staging-app.ceetrix.com?source=cli&auth=success');
    expect(html).toContain('staging-app.ceetrix.com');
    expect(html).toContain('source=cli');
    expect(html).toContain('auth=success');
  });
});

describe('CallbackServer', () => {
  let server: CallbackServer | null = null;

  afterEach(() => {
    if (server) {
      server.close();
      server = null;
    }
  });

  it('starts on a port in the expected range', async () => {
    server = await startCallbackServer();
    expect(server.port).toBeGreaterThanOrEqual(54321);
    expect(server.port).toBeLessThanOrEqual(54325);
  });

  it('receives callback with all parameters', async () => {
    server = await startCallbackServer();

    // Make callback request
    const callbackUrl = `http://127.0.0.1:${server.port}/callback?api_key=test_key&username=testuser&repos=repo1,repo2`;

    // Start waiting for callback before making request
    const resultPromise = server.waitForCallback();

    const response = await fetch(callbackUrl);
    expect(response.status).toBe(200);

    const result = await resultPromise;
    expect(result.apiKey).toBe('test_key');
    expect(result.username).toBe('testuser');
    expect(result.repos).toEqual(['repo1', 'repo2']);
  });

  it('handles empty repos parameter', async () => {
    server = await startCallbackServer();

    const callbackUrl = `http://127.0.0.1:${server.port}/callback?api_key=test_key&username=testuser&repos=`;

    const resultPromise = server.waitForCallback();

    const response = await fetch(callbackUrl);
    expect(response.status).toBe(200);

    const result = await resultPromise;
    expect(result.repos).toEqual([]);
  });

  it('handles missing repos parameter', async () => {
    server = await startCallbackServer();

    const callbackUrl = `http://127.0.0.1:${server.port}/callback?api_key=test_key&username=testuser`;

    const resultPromise = server.waitForCallback();

    const response = await fetch(callbackUrl);
    expect(response.status).toBe(200);

    const result = await resultPromise;
    expect(result.repos).toEqual([]);
  });

  it('returns 400 when api_key is missing', async () => {
    server = await startCallbackServer();

    const callbackUrl = `http://127.0.0.1:${server.port}/callback?username=testuser`;
    const response = await fetch(callbackUrl);

    expect(response.status).toBe(400);
  });

  it('returns 400 when username is missing', async () => {
    server = await startCallbackServer();

    const callbackUrl = `http://127.0.0.1:${server.port}/callback?api_key=test_key`;
    const response = await fetch(callbackUrl);

    expect(response.status).toBe(400);
  });

  it('returns 404 for unknown paths', async () => {
    server = await startCallbackServer();

    const response = await fetch(`http://127.0.0.1:${server.port}/other`);
    expect(response.status).toBe(404);
  });

  it('returns HTML success page without redirect when no web_app_url', async () => {
    server = await startCallbackServer();

    const callbackUrl = `http://127.0.0.1:${server.port}/callback?api_key=test_key&username=testuser`;

    const resultPromise = server.waitForCallback();
    const response = await fetch(callbackUrl);
    await resultPromise;

    const html = await response.text();
    expect(html).toContain('Setup complete');
    expect(html).toContain('Return to your terminal');
    expect(html).not.toContain('window.location.href');
  });

  it('returns HTML with redirect when web_app_url is provided', async () => {
    server = await startCallbackServer();

    const webAppUrl = 'https://app.ceetrix.com?source=cli&auth=success';
    const callbackUrl = `http://127.0.0.1:${server.port}/callback?api_key=test_key&username=testuser&web_app_url=${encodeURIComponent(webAppUrl)}`;

    const resultPromise = server.waitForCallback();
    const response = await fetch(callbackUrl);
    await resultPromise;

    const html = await response.text();
    expect(html).toContain('Setup complete');
    expect(html).toContain('Redirecting to Ceetrix');
    expect(html).toContain('window.location.href');
    expect(html).toContain('app.ceetrix.com');
  });

  it('closes cleanly', async () => {
    server = await startCallbackServer();
    const port = server.port;
    server.close();
    server = null;

    // Port should be available again (may take a moment)
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Try to start a new server on the same port range
    const newServer = await startCallbackServer();
    expect(newServer.port).toBe(port); // Should get the same port
    newServer.close();
  });
});
