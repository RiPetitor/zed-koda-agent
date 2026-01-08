/**
 * Mock KODA CLI для тестирования
 *
 * Эмулирует поведение KODA CLI в ACP режиме
 */

import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";

/**
 * Mock процесс KODA CLI
 */
export class MockKodaProcess extends EventEmitter {
  constructor() {
    super();

    this.killed = false;
    this.stdin = new MockWritableStream();
    this.stdout = new MockReadableStream();
    this.stderr = new MockReadableStream();

    // Очередь ответов
    this.responseQueue = [];
    this.requestHandlers = new Map();

    // Обработка входящих сообщений
    this.stdin.on("data", (data) => {
      this.handleIncomingMessage(data);
    });
  }

  /**
   * Обработать входящее сообщение
   */
  handleIncomingMessage(data) {
    try {
      const message = JSON.parse(data.toString());

      // Если есть обработчик для этого метода
      if (message.method && this.requestHandlers.has(message.method)) {
        const handler = this.requestHandlers.get(message.method);
        const result = handler(message.params);

        if (message.id !== undefined) {
          this.sendResponse(message.id, result);
        }
        return;
      }

      // Если есть заготовленный ответ
      if (this.responseQueue.length > 0 && message.id !== undefined) {
        const response = this.responseQueue.shift();
        this.sendResponse(message.id, response.result, response.error);
      }
    } catch {
      // Игнорируем ошибки парсинга
    }
  }

  /**
   * Отправить ответ
   */
  sendResponse(id, result, error = null) {
    const response = error
      ? { jsonrpc: "2.0", id, error }
      : { jsonrpc: "2.0", id, result };

    this.stdout.push(JSON.stringify(response) + "\n");
  }

  /**
   * Отправить нотификацию
   */
  sendNotification(method, params) {
    const message = { jsonrpc: "2.0", method, params };
    this.stdout.push(JSON.stringify(message) + "\n");
  }

  /**
   * Добавить ответ в очередь
   */
  queueResponse(result, error = null) {
    this.responseQueue.push({ result, error });
  }

  /**
   * Установить обработчик для метода
   */
  onMethod(method, handler) {
    this.requestHandlers.set(method, handler);
  }

  /**
   * Эмулировать закрытие процесса
   */
  kill(signal = "SIGTERM") {
    this.killed = true;
    this.emit("close", 0, signal);
  }

  /**
   * Эмулировать ошибку
   */
  emitError(error) {
    this.emit("error", error);
  }
}

/**
 * Mock Writable Stream
 */
class MockWritableStream extends Writable {
  constructor() {
    super();
    this.data = [];
  }

  _write(chunk, encoding, callback) {
    this.data.push(chunk);
    this.emit("data", chunk);
    callback();
  }

  get writable() {
    return true;
  }
}

/**
 * Mock Readable Stream
 */
class MockReadableStream extends Readable {
  constructor() {
    super();
    this.buffer = [];
  }

  _read() {
    // Ничего не делаем, данные добавляются через push
  }

  push(data) {
    super.push(data);
  }
}

/**
 * Создать стандартные ответы KODA CLI
 */
export function createStandardResponses() {
  return {
    initialize: {
      protocolVersion: "0.1.0",
      agentCapabilities: {
        loadSession: false,
        promptCapabilities: { embeddedContext: true, image: true },
      },
      agentInfo: {
        name: "koda",
        title: "KODA",
        version: "1.0.0",
      },
      authMethods: [
        { id: "skip", name: "Skip" },
        { id: "github", name: "GitHub" },
      ],
    },

    authenticate: {},

    "session/new": {
      sessionId: "mock-session-id",
      modes: {
        availableModes: [
          { id: "default", name: "Default" },
          { id: "plan", name: "Plan" },
        ],
        currentModeId: "default",
      },
      models: {
        availableModels: [{ modelId: "KodaAgent", name: "KodaAgent" }],
        currentModelId: "KodaAgent",
      },
    },

    "session/prompt": {
      stopReason: "end_turn",
    },
  };
}

/**
 * Mock spawn функция
 */
export function createMockSpawn(mockProcess) {
  return (_command, _args, _options) => {
    return mockProcess;
  };
}
