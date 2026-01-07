# KODA Agent for Zed

AI coding agent that runs KODA CLI through the Agent Client Protocol (ACP) with full permission control and planning modes.

## Features

- **Full ACP Integration**: Runs KODA CLI in ACP mode for seamless Zed integration
- **Permission Control**: Ask before file edits, command execution, and dangerous operations
- **Session Modes**: Switch between Default, Accept Edits, Plan Mode, Don't Ask, and Bypass
- **Plan Mode**: Collect planned actions without execution for review
- **MCP Support**: Syncs Zed MCP server definitions to KODA

## Session Modes

| Mode | Description |
|------|-------------|
| **Default** | Ask permission for all write operations |
| **Accept Edits** | Auto-approve file edits, ask for commands |
| **Plan Mode** | Read-only planning, no execution |
| **Don't Ask** | Auto-approve everything except dangerous commands |
| **Bypass** | Skip all permission checks |

## Requirements

- Zed Editor
- KODA CLI installed and authenticated (`koda` on PATH)
- Node.js 18+

## Quick Start (Local Development)

1. Install dependencies:

```bash
npm install
```

2. Add agent configuration to Zed settings (`zed: open settings`):

```json
{
  "agent_servers": {
    "KODA Agent": {
      "type": "custom",
      "command": "node",
      "args": ["/absolute/path/to/koda_zed/agent_server.mjs"],
      "env": {
        "KODA_DEFAULT_MODE": "default",
        "KODA_DEFAULT_MODEL": ""
      }
    }
  }
}
```

3. Open the Agent panel in Zed and select **KODA Agent**.

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `KODA_CLI_PATH` | Path to koda binary | `koda` |
| `KODA_CLI_ARGS` | Extra arguments (JSON array or space-separated) | |
| `KODA_DEFAULT_MODE` | Default session mode | `default` |
| `KODA_DEFAULT_MODEL` | Default model to use | |
| `KODA_DEBUG` | Enable debug output | `false` |

### CLI Options

```
node agent_server.mjs [options]

Options:
  --koda-path <path>      Path to the koda CLI
  --koda-args <args>      Extra args as JSON array or space-separated string
  --default-mode <mode>   Default session mode
  --default-model <model> Default model to use
  --debug                 Enable debug output
  --help                  Show help
```

## Architecture

```
┌─────────┐      ACP       ┌──────────────┐      ACP       ┌──────────┐
│   Zed   │ ◄────────────► │ agent_server │ ◄────────────► │ KODA CLI │
│ (Client)│                │ (Middleware) │                │ (Agent)  │
└─────────┘                └──────────────┘                └──────────┘
                                  │
                                  ▼
                    ┌─────────────────────────┐
                    │ • Permission Handler    │
                    │ • Mode Manager          │
                    │ • Plan Collector        │
                    │ • Tool Call Interceptor │
                    └─────────────────────────┘
```

The agent server acts as a middleware between Zed and KODA CLI:

1. Receives ACP requests from Zed
2. Forwards them to KODA CLI (running with `--experimental-acp`)
3. Intercepts tool calls for permission handling
4. Manages session modes and plan collection

## Permission Flow

When a tool call requires permission:

1. Tool call is shown in Zed UI as "pending"
2. Permission dialog appears with options:
   - **Allow** - Approve this operation once
   - **Allow Always** - Always approve this type of operation
   - **Reject** - Deny the operation
3. Based on response, tool is executed or blocked

## Packaging for Distribution

Build archives for each platform:

```bash
npm run package-agent -- --target linux-x86_64
npm run package-agent -- --target darwin-aarch64
npm run package-agent -- --target darwin-x86_64
npm run package-agent -- --target windows-x86_64
```

Upload archives to a release and update `extension.toml` with archive URLs.

## KODA CLI Tools

KODA CLI provides these tools when running in ACP mode:

| Tool | Type | Description |
|------|------|-------------|
| Read | read | Read file contents |
| Write | edit | Write/create files |
| Edit | edit | Edit files with search/replace |
| Bash | execute | Execute shell commands |
| Glob | read | Find files by pattern |
| Grep | read | Search in files |
| LS | read | List directory contents |
| Tree | read | Show directory tree |

## Author

[RiPetitor](https://github.com/RiPetitor)

## Repository

https://github.com/RiPetitor/zed-koda-agent

## License

MIT
