#!/usr/bin/env node
import { main } from '../dist/index.js';
import { printDebugInfo } from '../dist/debug.js';

const args = process.argv.slice(2);

if (args.includes('--debug') || args.includes('-d')) {
  printDebugInfo()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Debug failed:', err.message);
      process.exit(1);
    });
} else {
  main()
    .then(() => {
      // @inquirer/prompts leaves stdin open - unref it so Node can exit.
      // Guarded: stdin is not always a stream with unref (a pipe or file in a
      // non-interactive run has none), and an exception here would replace a
      // deliberate exit status with 1.
      if (typeof process.stdin.unref === 'function') {
        process.stdin.unref();
      }
    })
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
