# Ceetrix Setup CLI

One-command installer that connects your coding agent to the
[Ceetrix](https://ceetrix.com) backlog management service.

## Usage

```bash
npx ceetrix
```

Run this in a git repository with a GitHub remote. The installer will:

1. Tell you what it will run and what it will install, and ask once
2. Find which supported coding agents you have
3. Authenticate you via GitHub OAuth
4. Install the Ceetrix GitHub App on your repository
5. Configure each agent you choose to connect to the Ceetrix MCP server

Restart the agent afterwards. Your backlog tools will be available immediately.

## Supported coding agents

You do not have to switch tools to use Ceetrix. The installer finds what you
already have and offers it.

| Agent | Notes |
|---|---|
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | Requires v2.0 or later |
| [OpenAI Codex CLI](https://github.com/openai/codex) | |
| [pi](https://pi.dev) | See the note below — pi needs an extra package |
| [omp (Oh My Pi)](https://omp.sh) | |
| [OpenCode](https://opencode.ai) | |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | A developer preview; expect breaking changes |

Choosing several configures all of them. If one fails, the others still get
configured and the installer tells you which did not.

### pi needs a package published by someone else

pi has no support for MCP, the protocol Ceetrix speaks, and its authors have
said it will not be added. Support comes from `pi-mcp-adapter`, published to
npm by a third party rather than by pi's authors or by Ceetrix.

The installer names that package before installing anything and asks. Declining
leaves nothing behind. DeepSeek Harness likewise needs a plugin, published by
DeepSeek themselves, and it is named on the same screen.

### Checking it worked

| Agent | How |
|---|---|
| Claude Code | `claude mcp list` |
| OpenAI Codex CLI | `codex mcp list` |
| OpenCode | `opencode mcp list` |
| DeepSeek Harness | `dsh --profile <name> --dump-config` |
| pi | start `pi`, then `/mcp tools` |
| omp | start `omp`, then `/mcp list` |

pi and omp have no equivalent you can run from a shell, so those two are
checked from inside the agent.

## Requirements

- macOS or Linux
- Node.js >= 18
- At least one of the coding agents above
- A GitHub repository

## What is Ceetrix?

Ceetrix is a hosted backlog management service for AI-assisted development. It
provides MCP tools that let your coding agent help you create stories, break
down tasks, and track progress.

This package is the setup CLI only. The MCP server is hosted at `ceetrix.com`.

## Removing it

Run `npx ceetrix` again and choose to remove. Ceetrix is taken out of every
agent it was added to, and each agent's other settings are left exactly as they
were. Packages installed for pi or DeepSeek Harness are left in place, since
other servers you added may rely on them.

## Support

- Issues: [github.com/ceetrixai/ceetrix/issues](https://github.com/ceetrixai/ceetrix/issues)
- Discord: [ceetrix.com/discord](https://ceetrix.com/discord)

## License

MIT - This installer is open source. The Ceetrix service has separate [terms](https://ceetrix.com/terms).
