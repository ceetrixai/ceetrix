#!/usr/bin/env node
import { main } from '../dist/index.js';
import whyIsNodeRunning from 'why-is-node-running';

console.log('[DEBUG] ceetrix.js: calling main()...');
main()
  .then(() => {
    console.log('[DEBUG] ceetrix.js: main() resolved successfully');
    // @inquirer/prompts leaves stdin open - unref it so Node can exit
    process.stdin.unref();
    console.log('[DEBUG] stdin unref() called');
    // Check what's keeping Node alive after 2 seconds
    setTimeout(() => {
      console.log('[DEBUG] 2s after main() completed - checking why Node is still running...');
      whyIsNodeRunning();
    }, 2000).unref();
  })
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
