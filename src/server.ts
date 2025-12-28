/**
 * Local callback server for receiving OAuth results
 */

import { createServer, IncomingMessage, ServerResponse, Server } from 'http';
import { PORT_RANGE } from './constants.js';

/** Result received from OAuth callback */
export interface CallbackResult {
  apiKey: string;
  username: string;
  repos: string[];
}

/** Callback server interface */
export interface CallbackServer {
  port: number;
  waitForCallback: () => Promise<CallbackResult>;
  close: () => void;
}

/**
 * Start a local HTTP server to receive the OAuth callback.
 * Tries ports in PORT_RANGE until one is available.
 *
 * @returns Server interface with port, waitForCallback promise, and close function
 * @throws Error if no ports are available
 */
export async function startCallbackServer(): Promise<CallbackServer> {
  let resolveCallback: (result: CallbackResult) => void;
  const callbackPromise = new Promise<CallbackResult>((resolve) => {
    resolveCallback = resolve;
  });

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    handleRequest(req, res, resolveCallback);
  });

  const port = await findAvailablePort(server);

  return {
    port,
    waitForCallback: () => callbackPromise,
    close: () => {
      console.log('[DEBUG] server.close() called');
      // closeAllConnections() ensures all keep-alive connections are terminated
      // so Node.js can exit cleanly (available in Node 18.2+)
      server.closeAllConnections();
      console.log('[DEBUG] closeAllConnections() done');
      server.close(() => {
        console.log('[DEBUG] server.close() callback - server fully closed');
      });
      console.log('[DEBUG] server.close() initiated');
    },
  };
}

/**
 * Handle incoming HTTP requests to the callback server.
 */
function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  resolveCallback: (result: CallbackResult) => void
): void {
  const reqUrl = req.url || '';

  if (!reqUrl.startsWith('/callback')) {
    res.writeHead(404);
    res.end();
    return;
  }

  const url = new URL(reqUrl, 'http://localhost');
  const apiKey = url.searchParams.get('api_key');
  const username = url.searchParams.get('username');
  const reposParam = url.searchParams.get('repos');
  const repos = reposParam ? reposParam.split(',').filter(Boolean) : [];

  if (!apiKey || !username) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Missing required parameters');
    return;
  }

  // Return success page
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(getSuccessHtml());

  resolveCallback({ apiKey, username, repos });
}

/**
 * HTML page shown in browser after successful callback.
 */
function getSuccessHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Ceetrix Setup</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      text-align: center;
      padding: 3rem;
      background: #f8f9fa;
    }
    .container {
      max-width: 400px;
      margin: 0 auto;
      background: white;
      padding: 2rem;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    h1 { color: #22c55e; margin-bottom: 1rem; }
    p { color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Setup complete!</h1>
    <p>Return to your terminal.</p>
    <p style="color: #999;">You can close this tab.</p>
  </div>
</body>
</html>`;
}

/**
 * Try to bind server to ports in PORT_RANGE until one succeeds.
 *
 * @param server - HTTP server instance
 * @returns The port that was successfully bound
 * @throws Error if all ports are in use
 */
async function findAvailablePort(server: Server): Promise<number> {
  for (const port of PORT_RANGE) {
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          server.removeListener('error', reject);
          resolve();
        });
      });
      return port;
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      if (error.code !== 'EADDRINUSE') {
        throw err;
      }
      // Port in use, try next
    }
  }
  throw new Error(
    `No available ports. Tried: ${PORT_RANGE.join(', ')}. ` +
      'Close other applications using these ports and try again.'
  );
}
