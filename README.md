# KODA Agent for Zed

[English](#english) | [Русский](#русский)

---

## English

AI coding agent for Zed Editor with GitHub authentication, dynamic model selection, and slash commands. Works through the Agent Client Protocol (ACP).

### Features

- **Full ACP Integration** — Native Zed agent integration
- **GitHub Authentication** — Login via `/auth` command to unlock premium models
- **Dynamic Model List** — Models fetched from KODA API based on auth status
- **Slash Commands** — Built-in commands for auth, models, modes, and more
- **Permission Control** — Ask before file edits and command execution
- **Session Modes** — Default, Auto Edit, Plan, Professional, YOLO, Bypass

### Installation

1. Open Zed Editor
2. Press `Ctrl+Shift+X` (or `Cmd+Shift+X` on macOS) to open Extensions
3. Search for "KODA Agent"
4. Click Install

### Slash Commands

| Command | Description |
|---------|-------------|
| `/help` | Show all available commands |
| `/auth` | Login via GitHub to access premium models |
| `/logout` | Logout from GitHub account |
| `/models` | Show available models |
| `/model <id>` | Switch to a specific model |
| `/modes` | Show available modes |
| `/mode <mode>` | Change session mode |
| `/status` | Show current session status |
| `/clear` | Clear session history |
| `/plan` | Show current plan |
| `/retry` | Retry last request |
| `/cancel` | Cancel current operation |

#### Professional Mode Commands

| Command | Description |
|---------|-------------|
| `/approve` | Approve plan or current step |
| `/skip` | Skip current step |
| `/reject` | Reject plan |
| `/progress` | Show plan execution progress |

### Requirements

- Zed Editor
- Node.js 18+ (for dev extension)

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

AI агент для Zed Editor с GitHub авторизацией, динамическим выбором моделей и slash-командами. Работает через Agent Client Protocol (ACP).

### Возможности

- **Полная интеграция ACP** — Нативная интеграция с Zed
- **GitHub авторизация** — Вход через `/auth` для доступа к премиум моделям
- **Динамический список моделей** — Модели загружаются из KODA API
- **Slash-команды** — Встроенные команды для авторизации, моделей, режимов
- **Контроль разрешений** — Запрос перед редактированием файлов
- **Режимы сессии** — Default, Auto Edit, Plan, Professional, YOLO, Bypass

### Установка

1. Откройте Zed Editor
2. Нажмите `Ctrl+Shift+X` (или `Cmd+Shift+X` на macOS) для открытия Extensions
3. Найдите "KODA Agent"
4. Нажмите Install

### Slash-команды

| Команда | Описание |
|---------|----------|
| `/help` | Показать все доступные команды |
| `/auth` | Войти через GitHub для премиум моделей |
| `/logout` | Выйти из аккаунта |
| `/models` | Показать доступные модели |
| `/model <id>` | Переключить модель |
| `/modes` | Показать доступные режимы |
| `/mode <mode>` | Изменить режим сессии |
| `/status` | Показать статус сессии |
| `/clear` | Очистить историю сессии |
| `/plan` | Показать текущий план |
| `/retry` | Повторить последний запрос |
| `/cancel` | Отменить текущую операцию |

#### Команды режима Professional

| Команда | Описание |
|---------|----------|
| `/approve` | Одобрить план или текущий шаг |
| `/skip` | Пропустить текущий шаг |
| `/reject` | Отклонить план |
| `/progress` | Показать прогресс выполнения плана |

### Требования

- Zed Editor
- Node.js 18+ (для dev-расширения)

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
┌─────────┐      ACP       ┌──────────────┐      HTTP      ┌──────────┐
│   Zed   │ ◄────────────► │ KODA Agent   │ ◄────────────► │ KODA API │
└─────────┘                └──────────────┘                └──────────┘
```

## Project Structure / Структура проекта

```
zed-koda-agent/
├── agent_server.mjs         # Entry point / Точка входа
├── extension.toml           # Zed extension config
├── src/
│   ├── index.js             # Main entry / Главный модуль
│   ├── agent/
│   │   └── koda-agent.js    # Main agent class / Главный класс агента
│   ├── auth/
│   │   ├── github-oauth.js  # GitHub OAuth flow
│   │   └── token-storage.js # Token persistence
│   ├── bridge/
│   │   └── koda-bridge.js   # KODA API bridge / Мост к KODA API
│   ├── commands/
│   │   └── slash-commands.js # Slash command handlers
│   ├── config/
│   │   └── constants.js     # Configuration / Конфигурация
│   ├── models/
│   │   ├── api-client.js    # API client / API клиент
│   │   └── model-manager.js # Model management / Управление моделями
│   ├── session/
│   │   ├── mode-manager.js  # Session modes / Режимы сессии
│   │   ├── plan-collector.js # Plan collection / Сбор планов
│   │   └── professional-handler.js # Professional mode
│   ├── tools/
│   │   ├── interceptor.js   # Tool call interceptor / Перехватчик
│   │   └── permission-handler.js # Permission control
│   └── utils/
│       └── index.js         # Utilities / Утилиты
└── scripts/
    ├── package-agent.mjs    # Build script / Скрипт сборки
    └── clean-zed-cache.sh   # Cache cleanup / Очистка кэша
```

## Development / Разработка

### Local Development / Локальная разработка

```bash
# Install dependencies / Установка зависимостей
npm install

# Run tests / Запуск тестов
npm test

# Lint code / Проверка кода
npm run lint

# Build release archives / Сборка архивов
npm run package -- --target linux-x86_64
```

### Dev Extension in Zed / Dev-расширение в Zed

1. Clone the repo / Клонируйте репозиторий
2. In Zed: `Ctrl+Shift+P` → "zed: install dev extension"
3. Select the project folder / Выберите папку проекта

### Troubleshooting / Решение проблем

If changes don't take effect after rebuild:

```bash
# Clean Zed caches / Очистить кэши Zed
npm run clean:zed

# Then restart Zed and rebuild the extension
```

## Author / Автор

[RiPetitor](https://github.com/RiPetitor)

## License / Лицензия

MIT
