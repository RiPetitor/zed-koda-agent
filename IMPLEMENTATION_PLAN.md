# KODA Agent Implementation Plan / План реализации KODA Agent

## Overview / Обзор

Transform the current KODA CLI proxy bridge into a full-featured Agent Server that can edit files, run commands, and plan tasks — similar to Claude Code.

Преобразовать текущий прокси-мост KODA CLI в полноценный Agent Server, который может редактировать файлы, выполнять команды и планировать задачи — аналогично Claude Code.

---

# Option A: KODA CLI in ACP Mode (SELECTED) / Вариант A: KODA CLI в ACP режиме (ВЫБРАН)

## Architecture / Архитектура

```
┌─────────────┐       ACP/JSON-RPC        ┌──────────────────┐       ACP/JSON-RPC        ┌──────────────┐
│     Zed     │ ◄───────────────────────► │   agent_server   │ ◄───────────────────────► │   KODA CLI   │
│   (Client)  │                           │   (Middleware)   │                           │ --experimental-acp │
└─────────────┘                           └──────────────────┘                           └──────────────┘
                                                   │
                                                   ▼
                                    ┌──────────────────────────────┐
                                    │     Middleware Functions     │
                                    ├──────────────────────────────┤
                                    │ • Permission Handler         │
                                    │ • Mode Manager               │
                                    │ • Plan Collector             │
                                    │ • Tool Call Interceptor      │
                                    └──────────────────────────────┘
```

**How it works / Как это работает:**

1. Zed sends ACP requests to our `agent_server.mjs`
2. We forward requests to KODA CLI (running with `--experimental-acp`)
3. KODA CLI processes prompts using its LLM and built-in tools
4. We intercept `session/update` notifications from KODA CLI
5. For tool calls that require permission, we use `connection.requestPermission()`
6. Based on user response and current mode, we allow or block the tool execution

---

## What Already Exists / Что уже есть

### Current `agent_server.mjs` (≈400 lines)

| Component | Description | Status |
|-----------|-------------|--------|
| `KodaAgent` class | Main agent class | ✅ Exists, needs refactoring |
| `initialize()` | Returns agent capabilities | ✅ Exists, needs updates |
| `newSession()` | Creates new session | ✅ Exists, needs modes support |
| `prompt()` | Handles user prompts | ✅ Exists, needs ACP proxy |
| `cancel()` | Cancels ongoing operations | ✅ Exists |
| `syncMcpServers()` | Syncs MCP servers to KODA | ✅ Exists |
| `spawnKoda()` | Spawns KODA CLI process | ✅ Exists, needs ACP mode |
| `formatPrompt()` | Formats prompt blocks | ✅ Exists |
| `buildConversation()` | Builds conversation history | ⚠️ Not needed in Option A |

### ACP SDK Features Used

| Feature | Current Usage | New Usage |
|---------|---------------|-----------|
| `connection.sessionUpdate()` | Send text chunks | Forward from KODA CLI |
| `connection.requestPermission()` | ❌ Not used | ✅ Permission dialogs |
| `connection.readTextFile()` | ❌ Not used | ❌ Not needed (KODA handles) |
| `connection.writeTextFile()` | ❌ Not used | ❌ Not needed (KODA handles) |
| `connection.createTerminal()` | ❌ Not used | ❌ Not needed (KODA handles) |

---

## New Components to Implement / Новые компоненты для реализации

### 1. ACP Bidirectional Proxy / Двунаправленный ACP прокси

```javascript
// NEW: Class to manage KODA CLI as ACP subprocess
class KodaAcpBridge {
  constructor(config) {
    this.kodaProcess = null;
    this.pendingRequests = new Map();
    this.requestIdCounter = 0;
  }

  // Spawn KODA CLI in ACP mode
  async spawn(cwd, options) {
    this.kodaProcess = spawn('koda', [
      '--experimental-acp',
      '--approval-mode', 'yolo', // We handle permissions ourselves
      ...(options.model ? ['--model', options.model] : []),
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd,
    });
    
    // Set up ndjson stream parsing
    this.setupStreamHandlers();
  }

  // Forward request to KODA CLI and wait for response
  async sendRequest(method, params) { ... }

  // Forward notification to KODA CLI (no response expected)
  async sendNotification(method, params) { ... }

  // Handle incoming messages from KODA CLI
  onMessage(message) { ... }
}
```

### 2. Permission Handler / Обработчик разрешений

```javascript
// NEW: Permission management system
class PermissionHandler {
  constructor(connection) {
    this.connection = connection;
    this.alwaysAllowed = new Set(); // Tool types always allowed
    this.alwaysAllowedPaths = new Map(); // Paths always allowed for specific operations
  }

  // Check if permission is needed based on current mode and tool type
  needsPermission(mode, toolCall) {
    if (mode === 'bypass' || mode === 'yolo') return false;
    if (mode === 'plan') return true; // Always block in plan mode
    if (mode === 'auto_edit' && toolCall.kind === 'edit') return false;
    if (this.alwaysAllowed.has(this.getToolType(toolCall))) return false;
    return toolCall.kind !== 'read'; // Read operations don't need permission
  }

  // Request permission from user
  async requestPermission(sessionId, toolCall) {
    const response = await this.connection.requestPermission({
      sessionId,
      toolCall,
      options: [
        { optionId: 'allow', name: 'Allow / Разрешить', kind: 'allow_once' },
        { optionId: 'allow_always', name: 'Allow Always / Разрешать всегда', kind: 'allow_always' },
        { optionId: 'reject', name: 'Reject / Отклонить', kind: 'reject_once' },
      ],
    });
    
    if (response.outcome.optionId === 'allow_always') {
      this.alwaysAllowed.add(this.getToolType(toolCall));
    }
    
    return response.outcome;
  }

  getToolType(toolCall) {
    // Classify tool call: file_edit, file_create, file_delete, command_execute, etc.
  }
}
```

### 3. Mode Manager / Менеджер режимов

```javascript
// NEW: Session mode management
class ModeManager {
  static MODES = [
    { 
      id: 'default', 
      name: 'Default / По умолчанию',
      description: 'Ask permission for all write operations'
    },
    { 
      id: 'auto_edit', 
      name: 'Accept Edits / Авто-правки',
      description: 'Auto-approve file edits, ask for commands'
    },
    { 
      id: 'plan', 
      name: 'Plan Mode / Режим плана',
      description: 'Read-only planning, no execution'
    },
    { 
      id: 'yolo', 
      name: "Don't Ask / Без вопросов",
      description: 'Auto-approve everything except dangerous commands'
    },
    { 
      id: 'bypass', 
      name: 'Bypass Permissions / Обход',
      description: 'Skip all permission checks'
    },
  ];

  constructor() {
    this.sessionModes = new Map();
  }

  getMode(sessionId) {
    return this.sessionModes.get(sessionId) || 'default';
  }

  setMode(sessionId, modeId) {
    this.sessionModes.set(sessionId, modeId);
  }

  getModeConfig() {
    return {
      availableModes: ModeManager.MODES,
      currentModeId: 'default',
    };
  }
}
```

### 4. Plan Collector / Сборщик плана

```javascript
// NEW: Collect and manage execution plans
class PlanCollector {
  constructor() {
    this.plans = new Map(); // sessionId -> PlanEntry[]
  }

  addEntry(sessionId, entry) {
    if (!this.plans.has(sessionId)) {
      this.plans.set(sessionId, []);
    }
    this.plans.get(sessionId).push({
      content: entry.title || entry.content,
      status: 'pending',
      priority: entry.priority || 'medium',
    });
  }

  updateEntry(sessionId, index, status) {
    const plan = this.plans.get(sessionId);
    if (plan && plan[index]) {
      plan[index].status = status;
    }
  }

  getPlan(sessionId) {
    return this.plans.get(sessionId) || [];
  }

  // Convert blocked tool calls to plan entries in plan mode
  toolCallToPlanEntry(toolCall) {
    return {
      content: toolCall.title,
      status: 'pending',
      priority: toolCall.kind === 'execute' ? 'high' : 'medium',
    };
  }
}
```

### 5. Tool Call Interceptor / Перехватчик вызовов инструментов

```javascript
// NEW: Intercept and process tool calls from KODA CLI
class ToolCallInterceptor {
  constructor(connection, permissionHandler, modeManager, planCollector) {
    this.connection = connection;
    this.permissionHandler = permissionHandler;
    this.modeManager = modeManager;
    this.planCollector = planCollector;
    this.blockedToolCalls = new Map(); // toolCallId -> toolCall
  }

  // Process incoming session update from KODA CLI
  async processSessionUpdate(sessionId, update) {
    const mode = this.modeManager.getMode(sessionId);

    // Handle tool_call notifications
    if (update.sessionUpdate === 'tool_call') {
      return await this.handleToolCall(sessionId, mode, update);
    }

    // Handle tool_call_update notifications
    if (update.sessionUpdate === 'tool_call_update') {
      return await this.handleToolCallUpdate(sessionId, mode, update);
    }

    // Forward other updates directly
    return { forward: true, update };
  }

  async handleToolCall(sessionId, mode, toolCall) {
    // In plan mode, collect as plan entry and block execution
    if (mode === 'plan') {
      this.planCollector.addEntry(sessionId, toolCall);
      this.blockedToolCalls.set(toolCall.toolCallId, toolCall);
      
      // Send plan update to client
      await this.connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'plan',
          entries: this.planCollector.getPlan(sessionId),
        },
      });
      
      // Don't forward the tool call - return blocked status
      return { forward: false, blocked: true };
    }

    // Check if permission is needed
    if (this.permissionHandler.needsPermission(mode, toolCall)) {
      // Forward the tool call first (to show it in UI)
      await this.connection.sessionUpdate({ sessionId, update: toolCall });
      
      // Request permission
      const outcome = await this.permissionHandler.requestPermission(sessionId, toolCall);
      
      if (outcome.outcome === 'cancelled' || outcome.optionId === 'reject') {
        this.blockedToolCalls.set(toolCall.toolCallId, toolCall);
        return { forward: false, blocked: true, rejected: true };
      }
    }

    // Forward the tool call
    return { forward: true, update: toolCall };
  }

  async handleToolCallUpdate(sessionId, mode, update) {
    // If this tool call was blocked, don't forward the update
    if (this.blockedToolCalls.has(update.toolCallId)) {
      return { forward: false };
    }
    
    return { forward: true, update };
  }
}
```

---

## Session Modes Behavior / Поведение режимов сессии

| Mode | File Read | File Edit | File Create | File Delete | Command | Dangerous Command |
|------|-----------|-----------|-------------|-------------|---------|-------------------|
| `default` | ✅ Auto | ❓ Ask | ❓ Ask | ❓ Ask | ❓ Ask | ❓ Ask |
| `auto_edit` | ✅ Auto | ✅ Auto | ✅ Auto | ❓ Ask | ❓ Ask | ❓ Ask |
| `plan` | ✅ Auto | 📋 Plan | 📋 Plan | 📋 Plan | 📋 Plan | 📋 Plan |
| `yolo` | ✅ Auto | ✅ Auto | ✅ Auto | ✅ Auto | ✅ Auto | ❓ Ask |
| `bypass` | ✅ Auto | ✅ Auto | ✅ Auto | ✅ Auto | ✅ Auto | ✅ Auto |

Legend / Легенда:
- ✅ Auto — автоматически разрешено
- ❓ Ask — требуется подтверждение пользователя
- 📋 Plan — добавляется в план, не выполняется

---

## KODA CLI Tools (handled by KODA) / Инструменты KODA CLI

These tools are implemented inside KODA CLI and executed when running with `--experimental-acp`. Our middleware only intercepts them for permission handling.

Эти инструменты реализованы внутри KODA CLI и выполняются при запуске с `--experimental-acp`. Наш middleware только перехватывает их для обработки разрешений.

| Tool | Kind | Description EN | Description RU |
|------|------|----------------|----------------|
| `Read` | read | Read file contents | Чтение содержимого файла |
| `Write` | edit | Write/create file | Запись/создание файла |
| `Edit` | edit | Edit file with search/replace | Редактирование файла поиском/заменой |
| `Bash` | execute | Execute shell command | Выполнение команды shell |
| `Glob` | read | Find files by pattern | Поиск файлов по шаблону |
| `Grep` | read | Search in files | Поиск в файлах |
| `LS` | read | List directory contents | Список файлов в директории |
| `Tree` | read | Show directory tree | Показать дерево директорий |

---

## Implementation Steps / Этапы реализации

### Step 1: Refactor KodaAgent class

```javascript
// BEFORE (current)
class KodaAgent {
  constructor(connection, config) {
    this.connection = connection;
    this.config = config;
    this.sessions = new Map();
  }
  // ... spawns KODA CLI in stdin/stdout mode
}

// AFTER (new)
class KodaAgent {
  constructor(connection, config) {
    this.connection = connection;
    this.config = config;
    this.sessions = new Map();
    this.modeManager = new ModeManager();
    this.permissionHandler = new PermissionHandler(connection);
    this.planCollector = new PlanCollector();
    this.interceptor = new ToolCallInterceptor(
      connection, 
      this.permissionHandler, 
      this.modeManager, 
      this.planCollector
    );
  }
  // ... spawns KODA CLI in ACP mode and proxies messages
}
```

### Step 2: Update initialize() method

```javascript
// BEFORE
async initialize() {
  return {
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: {
      loadSession: false,
      promptCapabilities: { embeddedContext: true },
      mcpCapabilities: {},
    },
    agentInfo: { name: "koda_cli", title: "KODA CLI", version: "0.1.0" },
    authMethods: [],
  };
}

// AFTER
async initialize() {
  return {
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: {
      loadSession: false,
      promptCapabilities: { embeddedContext: true, image: true },
      mcpCapabilities: { http: false, sse: false },
    },
    agentInfo: { 
      name: "koda_agent", 
      title: "KODA Agent", 
      version: "0.2.0" 
    },
    authMethods: [],
  };
}
```

### Step 3: Update newSession() method

```javascript
// BEFORE
async newSession(params) {
  const sessionId = randomUUID();
  const cwd = params?.cwd || process.cwd();
  this.sessions.set(sessionId, { history: [], pendingPrompt: null, cwd });
  await this.syncMcpServers(sessionId, cwd, params?.mcpServers || []);
  return { sessionId };
}

// AFTER
async newSession(params) {
  const sessionId = randomUUID();
  const cwd = params?.cwd || process.cwd();
  
  // Spawn KODA CLI in ACP mode for this session
  const kodaBridge = new KodaAcpBridge(this.config);
  await kodaBridge.spawn(cwd, {
    model: this.config.defaultModel,
    mcpServers: params?.mcpServers || [],
  });
  
  this.sessions.set(sessionId, {
    kodaBridge,
    cwd,
    pendingPrompt: null,
  });
  
  this.modeManager.setMode(sessionId, 'default');
  
  return {
    sessionId,
    modes: this.modeManager.getModeConfig(),
  };
}
```

### Step 4: Implement setSessionMode() method

```javascript
// NEW METHOD
async setSessionMode(params) {
  const { sessionId, modeId } = params;
  
  if (!ModeManager.MODES.find(m => m.id === modeId)) {
    throw new Error(`Unknown mode: ${modeId}`);
  }
  
  this.modeManager.setMode(sessionId, modeId);
  
  // Notify client about mode change
  await this.connection.sessionUpdate({
    sessionId,
    update: {
      sessionUpdate: 'current_mode_update',
      currentModeId: modeId,
    },
  });
  
  return {};
}
```

### Step 5: Rewrite prompt() method

```javascript
// AFTER - Complete rewrite
async prompt(params) {
  const session = this.sessions.get(params.sessionId);
  if (!session) throw new Error(`Session ${params.sessionId} not found`);

  // Cancel previous prompt if any
  if (session.pendingPrompt?.abortController) {
    session.pendingPrompt.abortController.abort();
  }

  const abortController = new AbortController();
  session.pendingPrompt = { abortController };

  try {
    // Forward prompt to KODA CLI
    const kodaResponse = await session.kodaBridge.sendRequest('session/prompt', {
      sessionId: params.sessionId, // KODA's internal session
      prompt: params.prompt,
    });

    // The response streaming is handled by onKodaMessage callback
    return { stopReason: kodaResponse.stopReason || 'end_turn' };
    
  } catch (error) {
    if (abortController.signal.aborted) {
      return { stopReason: 'cancelled' };
    }
    throw error;
  } finally {
    session.pendingPrompt = null;
  }
}

// Handle messages from KODA CLI
async onKodaMessage(sessionId, message) {
  // Handle notifications (session/update)
  if (message.method === 'session/update') {
    const result = await this.interceptor.processSessionUpdate(
      sessionId, 
      message.params.update
    );
    
    if (result.forward) {
      await this.connection.sessionUpdate({
        sessionId,
        update: result.update,
      });
    }
    return;
  }

  // Handle requests from KODA CLI (e.g., fs/read_text_file)
  if (message.id !== undefined && message.method) {
    // Forward to Zed client
    const response = await this.forwardRequestToClient(message);
    // Send response back to KODA CLI
    session.kodaBridge.sendResponse(message.id, response);
  }
}
```

---

## Files to Modify / Файлы для изменения

| File | Action | Changes |
|------|--------|---------|
| `agent_server.mjs` | Rewrite | Add all new components, refactor KodaAgent |
| `extension.toml` | Update | Change name to "KODA Agent", update description |
| `README.md` | Update | Document new features and modes |
| `package.json` | Update | Update name, version, add description |

---

## Testing Plan / План тестирования

1. **Basic connectivity** — проверить запуск KODA CLI в ACP режиме
2. **Message forwarding** — проверить пересылку сообщений в обе стороны
3. **Permission dialogs** — проверить появление диалогов разрешений
4. **Mode switching** — проверить переключение режимов
5. **Plan mode** — проверить сбор плана без выполнения
6. **Allow always** — проверить запоминание разрешений

---

---

# Option B: Custom Tools Implementation / Вариант B: Собственная реализация инструментов

> **Note:** This option is documented for reference but NOT selected for implementation.
> 
> **Примечание:** Этот вариант задокументирован для справки, но НЕ выбран для реализации.

## Architecture / Архитектура

```
┌─────────────┐       ACP/JSON-RPC        ┌──────────────────┐
│     Zed     │ ◄───────────────────────► │   agent_server   │
│   (Client)  │                           │   (Full Agent)   │
└─────────────┘                           └──────────────────┘
                                                   │
                          ┌────────────────────────┼────────────────────────┐
                          ▼                        ▼                        ▼
                 ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
                 │   KODA CLI      │    │   Tool System   │    │   Permission    │
                 │   (LLM only)    │    │   (Node.js)     │    │   Handler       │
                 └─────────────────┘    └─────────────────┘    └─────────────────┘
                          │                        │
                          ▼                        ▼
                 ┌─────────────────┐    ┌─────────────────────────────────────┐
                 │  Prompts only   │    │ Tools:                              │
                 │  No tools       │    │ • ReadTool (fs.readFile)            │
                 └─────────────────┘    │ • WriteTool (fs.writeFile)          │
                                        │ • EditTool (string replace)         │
                                        │ • BashTool (child_process.spawn)    │
                                        │ • GlobTool (fast-glob)              │
                                        │ • GrepTool (ripgrep)                │
                                        │ • ListTool (fs.readdir)             │
                                        └─────────────────────────────────────┘
```

## Tools to Implement / Инструменты для реализации

### 1. ReadTool

```javascript
class ReadTool {
  name = 'Read';
  kind = 'read';
  
  async execute({ path, offset = 1, limit = 2000 }) {
    const content = await fs.readFile(path, 'utf-8');
    const lines = content.split('\n');
    const selected = lines.slice(offset - 1, offset - 1 + limit);
    return {
      content: selected.join('\n'),
      totalLines: lines.length,
      truncated: lines.length > limit,
    };
  }
}
```

### 2. WriteTool

```javascript
class WriteTool {
  name = 'Write';
  kind = 'edit';
  
  async execute({ path, content }) {
    await fs.writeFile(path, content, 'utf-8');
    return { success: true, path };
  }
}
```

### 3. EditTool

```javascript
class EditTool {
  name = 'Edit';
  kind = 'edit';
  
  async execute({ path, old_string, new_string, replace_all = false }) {
    let content = await fs.readFile(path, 'utf-8');
    
    if (replace_all) {
      content = content.replaceAll(old_string, new_string);
    } else {
      const index = content.indexOf(old_string);
      if (index === -1) throw new Error('old_string not found');
      content = content.slice(0, index) + new_string + content.slice(index + old_string.length);
    }
    
    await fs.writeFile(path, content, 'utf-8');
    return { success: true, path };
  }
}
```

### 4. BashTool

```javascript
class BashTool {
  name = 'Bash';
  kind = 'execute';
  
  async execute({ command, cwd, timeout = 30000 }) {
    return new Promise((resolve, reject) => {
      const child = spawn('bash', ['-c', command], {
        cwd,
        timeout,
        env: { ...process.env, NO_COLOR: '1' },
      });
      
      let stdout = '', stderr = '';
      child.stdout.on('data', d => stdout += d);
      child.stderr.on('data', d => stderr += d);
      child.on('close', code => resolve({ code, stdout, stderr }));
      child.on('error', reject);
    });
  }
}
```

### 5. GlobTool

```javascript
import fg from 'fast-glob';

class GlobTool {
  name = 'Glob';
  kind = 'read';
  
  async execute({ pattern, path = '.', ignore = ['node_modules/**'] }) {
    const files = await fg(pattern, {
      cwd: path,
      ignore,
      onlyFiles: true,
      stats: true,
    });
    
    return files
      .sort((a, b) => b.stats.mtime - a.stats.mtime)
      .map(f => f.path);
  }
}
```

### 6. GrepTool

```javascript
class GrepTool {
  name = 'Grep';
  kind = 'read';
  
  async execute({ pattern, path = '.', type, glob, limit = 100 }) {
    const args = ['--json', pattern];
    if (type) args.push('--type', type);
    if (glob) args.push('--glob', glob);
    args.push(path);
    
    const { stdout } = await this.spawn('rg', args);
    const matches = stdout.split('\n')
      .filter(Boolean)
      .map(JSON.parse)
      .slice(0, limit);
    
    return matches;
  }
}
```

## Additional Dependencies / Дополнительные зависимости

```json
{
  "dependencies": {
    "@agentclientprotocol/sdk": "^0.12.0",
    "fast-glob": "^3.3.0"
  }
}
```

## Complexity / Сложность

- **Much more code** — significantly more implementation work
- **Tool schema definitions** — need to define JSON schemas for all tools
- **Error handling** — comprehensive error handling for each tool
- **Testing** — extensive testing for each tool
- **Maintenance** — ongoing maintenance of tool implementations

**Estimated Lines of Code:** 1500-2000 lines

---

# Comparison / Сравнение

| Aspect | Option A (ACP Proxy) | Option B (Custom Tools) |
|--------|---------------------|------------------------|
| Complexity | Medium | High |
| Code Size | ~600 lines | ~2000 lines |
| Dependencies | None new | fast-glob |
| KODA CLI Updates | Automatic | Manual sync needed |
| Tool Quality | KODA's implementation | Our implementation |
| Maintenance | Low | High |
| Flexibility | Limited to KODA tools | Full control |
| Risk | Depends on --experimental-acp | Stable |

---

# Decision / Решение

**Selected: Option A** — Use KODA CLI in ACP mode with permission middleware.

**Выбран: Вариант A** — Использование KODA CLI в ACP режиме с middleware для разрешений.

**Rationale / Обоснование:**
1. Less code to write and maintain
2. KODA CLI tools are already battle-tested
3. Automatic updates when KODA CLI improves
4. Focus on permission UX rather than tool implementation
5. `--experimental-acp` is already available and working
