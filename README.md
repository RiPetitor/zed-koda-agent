# KODA Agent for Zed

[English](#english) | [Русский](#русский)

---

## English

AI coding agent that runs KODA CLI through the Agent Client Protocol (ACP) with GitHub authentication, dynamic model selection, and slash commands.

### Features

- **Full ACP Integration** — Runs KODA CLI in ACP mode for seamless Zed integration
- **GitHub Authentication** — Login via `/auth` command to unlock premium models
- **Dynamic Model List** — Models fetched from KODA API based on auth status
- **Slash Commands** — Built-in commands for auth, models, modes, and more
- **Permission Control** — Ask before file edits and command execution
- **Session Modes** — Default, Accept Edits, Plan Mode, Don't Ask, Bypass

### Slash Commands

| Command | Description |
|---------|-------------|
| `/help` | Show all available commands |
| `/auth` | Login via GitHub to access premium models |
| `/logout` | Logout from GitHub account |
| `/models` | Show available models |
| `/model <id>` | Switch to a specific model |
| `/mode <mode>` | Change session mode |
| `/status` | Show current session status |

### Requirements

- Zed Editor
- KODA CLI installed (`koda` on PATH)
- Node.js 18+

### Quick Start

1. Install dependencies:

```bash
npm install
```

2. Add to Zed settings (`zed: open settings`):

```json
{
  "agent": {
    "profiles": {
      "koda-agent": {
        "name": "KODA Agent",
        "provider": {
          "type": "agent_server",
          "server": "KODA Agent"
        }
      }
    }
  },
  "agent_servers": {
    "KODA Agent": {
      "type": "custom",
      "command": "node",
      "args": ["/path/to/koda_zed/agent_server.mjs"]
    }
  }
}
```

3. Open Agent panel in Zed and select **KODA Agent**.

### Authentication

**Free model:** KodaAgent — available without login

**Premium models:** Use `/auth` to login via GitHub:
1. Type `/auth` in chat
2. Enter the displayed code in browser
3. Premium models become available

Use `/models` to see available models.

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `KODA_DEBUG` | Enable debug output | `false` |
| `KODA_DEFAULT_MODE` | Default session mode | `default` |
| `KODA_DEFAULT_MODEL` | Default model | `KodaAgent` |

---

## Русский

AI агент для программирования, запускающий KODA CLI через Agent Client Protocol (ACP) с GitHub авторизацией, динамическим выбором моделей и slash-командами.

### Возможности

- **Полная интеграция ACP** — Запуск KODA CLI в режиме ACP для работы с Zed
- **GitHub авторизация** — Вход через `/auth` для доступа к премиум моделям
- **Динамический список моделей** — Модели загружаются из KODA API
- **Slash-команды** — Встроенные команды для авторизации, моделей, режимов
- **Контроль разрешений** — Запрос перед редактированием файлов
- **Режимы сессии** — Default, Accept Edits, Plan Mode, Don't Ask, Bypass

### Slash-команды

| Команда | Описание |
|---------|----------|
| `/help` | Показать все доступные команды |
| `/auth` | Войти через GitHub для премиум моделей |
| `/logout` | Выйти из аккаунта |
| `/models` | Показать доступные модели |
| `/model <id>` | Переключить модель |
| `/mode <mode>` | Изменить режим сессии |
| `/status` | Показать статус сессии |

### Требования

- Zed Editor
- KODA CLI (`koda` в PATH)
- Node.js 18+

### Быстрый старт

1. Установить зависимости:

```bash
npm install
```

2. Добавить в настройки Zed (`zed: open settings`):

```json
{
  "agent": {
    "profiles": {
      "koda-agent": {
        "name": "KODA Agent",
        "provider": {
          "type": "agent_server",
          "server": "KODA Agent"
        }
      }
    }
  },
  "agent_servers": {
    "KODA Agent": {
      "type": "custom",
      "command": "node",
      "args": ["/path/to/koda_zed/agent_server.mjs"]
    }
  }
}
```

3. Открыть панель Agent в Zed и выбрать **KODA Agent**.

### Авторизация

**Бесплатная модель:** KodaAgent — доступна без входа

**Премиум модели:** Используйте `/auth` для входа через GitHub:
1. Введите `/auth` в чате
2. Введите отображённый код в браузере
3. Премиум модели станут доступны

Используйте `/models` для просмотра доступных моделей.

### Переменные окружения

| Переменная | Описание | По умолчанию |
|------------|----------|--------------|
| `KODA_DEBUG` | Включить отладку | `false` |
| `KODA_DEFAULT_MODE` | Режим по умолчанию | `default` |
| `KODA_DEFAULT_MODEL` | Модель по умолчанию | `KodaAgent` |

---

## Architecture / Архитектура

```
┌─────────┐      ACP       ┌──────────────┐      ACP       ┌──────────┐
│   Zed   │ ◄────────────► │ agent_server │ ◄────────────► │ KODA CLI │
└─────────┘                └──────────────┘                └──────────┘
```

## Project Structure / Структура проекта

```
koda_zed/
├── agent_server.mjs    # Entry point / Точка входа
├── src/
│   ├── agent.js        # Main agent class / Главный класс
│   ├── bridge.js       # KODA ACP Bridge / Мост к KODA CLI
│   ├── models.js       # Models & GitHub Auth / Модели и авторизация
│   ├── modes.js        # Session modes / Режимы сессии
│   ├── slash.js        # Slash commands / Slash-команды
│   ├── permissions.js  # Permission handler / Обработка разрешений
│   ├── interceptor.js  # Tool call interceptor / Перехватчик вызовов
│   ├── plan.js         # Plan collector / Сборщик планов
│   └── utils.js        # Utilities / Утилиты
└── extension.toml
```

## Author / Автор

[RiPetitor](https://github.com/RiPetitor)

## License / Лицензия

MIT

## Troubleshooting Dev Extension

### Slash Commands Not Working

If slash commands don't appear after installing the dev extension, Zed may be using a cached version. To fix:

```bash
# Clean Zed caches
npm run clean:zed

# Or manually:
bash scripts/clean-zed-cache.sh
```

Then:
1. Restart Zed completely
2. Reinstall the dev extension

### Changes Not Taking Effect

Zed caches compiled extensions in `~/.var/app/dev.zed.Zed/data/zed/external_agents/`. When developing:

1. **After making changes:**
   ```bash
   npm run clean:zed
   ```

2. **In Zed:**
   - `Ctrl+Shift+P` → "zed: reload extensions"
   - Or restart Zed

### Development Workflow

```bash
# 1. Make your changes
vim src/agent/koda-agent.js

# 2. Test locally
npm test

# 3. Clean caches
npm run clean:zed

# 4. Reload in Zed
# Ctrl+Shift+P → "zed: reload extensions"
```
