#!/usr/bin/env node
import { main } from '../dist/index.js';

main()
  .then(() => {
    // @inquirer/prompts leaves stdin open - unref it so Node can exit
    process.stdin.unref();
  })
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
