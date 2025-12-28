# Ceetrix Setup CLI

One-command installer that connects Claude Code to the [Ceetrix](https://ceetrix.com) backlog management service.

## Usage

```bash
npx ceetrix
```

Run this in a git repository with a GitHub remote. The installer will:

1. Authenticate you via GitHub OAuth
2. Install the Ceetrix GitHub App on your repository
3. Configure Claude Code to connect to the Ceetrix MCP server

After setup, restart Claude Code. Your backlog tools will be available immediately.

## Requirements

- macOS (Windows/Linux coming soon)
- Node.js >= 18
- [Claude Code](https://claude.ai/download) installed
- A GitHub repository

## What is Ceetrix?

Ceetrix is a hosted backlog management service for AI-assisted development. It provides MCP tools that let Claude Code help you create stories, break down tasks, and track progress.

This package is the setup CLI only. The MCP server is hosted at `ceetrix.com`.

## Support

- Issues: [github.com/ceetrixai/ceetrix/issues](https://github.com/ceetrixai/ceetrix/issues)
- Discord: [ceetrix.com/discord](https://ceetrix.com/discord)

## License

MIT - This installer is open source. The Ceetrix service has separate [terms](https://ceetrix.com/terms).
