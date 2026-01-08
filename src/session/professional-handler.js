/**
 * Professional Mode Handler
 * Обработчик режима "Профессионал" - пошаговое выполнение с планированием
 */

/**
 * Состояния плана в Professional режиме
 */
export const PLAN_STATUS = {
  NONE: "none", // Нет активного плана
  PLANNING: "planning", // Идёт создание плана
  PENDING_APPROVAL: "pending_approval", // Ожидает одобрения пользователя
  EXECUTING: "executing", // Выполняется
  PAUSED: "paused", // Приостановлен (ожидает одобрения шага)
  COMPLETED: "completed", // Завершён
  CANCELLED: "cancelled", // Отменён
};

/**
 * Статусы отдельного шага плана
 */
export const STEP_STATUS = {
  PENDING: "pending", // Ожидает выполнения
  AWAITING_APPROVAL: "awaiting_approval", // Ожидает одобрения
  IN_PROGRESS: "in_progress", // Выполняется
  COMPLETED: "completed", // Завершён
  SKIPPED: "skipped", // Пропущен
  FAILED: "failed", // Ошибка
};

/**
 * @typedef {Object} PlanStep
 * @property {string} id - Уникальный ID шага
 * @property {string} title - Заголовок шага
 * @property {string} description - Описание действий
 * @property {string} status - Статус шага (STEP_STATUS)
 * @property {string|null} result - Результат выполнения
 */

/**
 * @typedef {Object} ExecutionPlan
 * @property {string} id - Уникальный ID плана
 * @property {string} taskDescription - Описание исходной задачи
 * @property {PlanStep[]} steps - Шаги плана
 * @property {string} status - Статус плана (PLAN_STATUS)
 * @property {number} currentStepIndex - Индекс текущего шага
 * @property {Date} createdAt - Время создания
 * @property {Date|null} completedAt - Время завершения
 */

/**
 * Обработчик Professional режима
 */
export class ProfessionalModeHandler {
  constructor() {
    /** @type {ExecutionPlan|null} */
    this.currentPlan = null;

    /** @type {boolean} */
    this.autoApproveSteps = false;
  }

  /**
   * Проверяет, активен ли режим Professional
   * @param {string} currentMode - Текущий режим сессии
   * @returns {boolean}
   */
  isActive(currentMode) {
    return currentMode === "professional";
  }

  /**
   * Проверяет, есть ли активный план
   * @returns {boolean}
   */
  hasPlan() {
    return this.currentPlan !== null && this.currentPlan.status !== PLAN_STATUS.NONE;
  }

  /**
   * Проверяет, ожидает ли план одобрения
   * @returns {boolean}
   */
  isPlanPendingApproval() {
    return this.currentPlan?.status === PLAN_STATUS.PENDING_APPROVAL;
  }

  /**
   * Проверяет, ожидает ли текущий шаг одобрения
   * @returns {boolean}
   */
  isStepAwaitingApproval() {
    if (!this.currentPlan || this.currentPlan.status !== PLAN_STATUS.PAUSED) {
      return false;
    }
    const currentStep = this.getCurrentStep();
    return currentStep?.status === STEP_STATUS.AWAITING_APPROVAL;
  }

  /**
   * Получает текущий шаг
   * @returns {PlanStep|null}
   */
  getCurrentStep() {
    if (!this.currentPlan) return null;
    return this.currentPlan.steps[this.currentPlan.currentStepIndex] || null;
  }

  /**
   * Создаёт новый план выполнения
   * @param {string} taskDescription - Описание задачи
   * @param {Array<{title: string, description: string}>} steps - Шаги плана
   * @returns {ExecutionPlan}
   */
  createPlan(taskDescription, steps) {
    const planId = `plan_${Date.now()}`;

    this.currentPlan = {
      id: planId,
      taskDescription,
      steps: steps.map((step, index) => ({
        id: `${planId}_step_${index}`,
        title: step.title,
        description: step.description,
        status: STEP_STATUS.PENDING,
        result: null,
      })),
      status: PLAN_STATUS.PENDING_APPROVAL,
      currentStepIndex: 0,
      createdAt: new Date(),
      completedAt: null,
    };

    return this.currentPlan;
  }

  /**
   * Одобряет план и запускает выполнение
   * @returns {boolean} - Успешность операции
   */
  approvePlan() {
    if (!this.currentPlan || this.currentPlan.status !== PLAN_STATUS.PENDING_APPROVAL) {
      return false;
    }

    this.currentPlan.status = PLAN_STATUS.PAUSED;
    if (this.currentPlan.steps.length > 0) {
      this.currentPlan.steps[0].status = STEP_STATUS.AWAITING_APPROVAL;
    }

    return true;
  }

  /**
   * Отклоняет/отменяет план
   * @returns {boolean}
   */
  rejectPlan() {
    if (!this.currentPlan) return false;

    this.currentPlan.status = PLAN_STATUS.CANCELLED;
    return true;
  }

  /**
   * Одобряет текущий шаг для выполнения
   * @returns {PlanStep|null} - Шаг для выполнения
   */
  approveCurrentStep() {
    const step = this.getCurrentStep();
    if (!step || step.status !== STEP_STATUS.AWAITING_APPROVAL) {
      return null;
    }

    step.status = STEP_STATUS.IN_PROGRESS;
    this.currentPlan.status = PLAN_STATUS.EXECUTING;
    return step;
  }

  /**
   * Пропускает текущий шаг
   * @returns {boolean}
   */
  skipCurrentStep() {
    const step = this.getCurrentStep();
    if (!step) return false;

    step.status = STEP_STATUS.SKIPPED;
    return this.moveToNextStep();
  }

  /**
   * Отмечает текущий шаг как завершённый
   * @param {string} result - Результат выполнения
   * @returns {boolean}
   */
  completeCurrentStep(result = "") {
    const step = this.getCurrentStep();
    if (!step || step.status !== STEP_STATUS.IN_PROGRESS) {
      return false;
    }

    step.status = STEP_STATUS.COMPLETED;
    step.result = result;
    return this.moveToNextStep();
  }

  /**
   * Отмечает текущий шаг как неудавшийся
   * @param {string} error - Описание ошибки
   * @returns {boolean}
   */
  failCurrentStep(error = "") {
    const step = this.getCurrentStep();
    if (!step) return false;

    step.status = STEP_STATUS.FAILED;
    step.result = error;
    this.currentPlan.status = PLAN_STATUS.PAUSED;
    return true;
  }

  /**
   * Переходит к следующему шагу
   * @returns {boolean} - true если есть следующий шаг
   */
  moveToNextStep() {
    if (!this.currentPlan) return false;

    const nextIndex = this.currentPlan.currentStepIndex + 1;

    if (nextIndex >= this.currentPlan.steps.length) {
      // План завершён
      this.currentPlan.status = PLAN_STATUS.COMPLETED;
      this.currentPlan.completedAt = new Date();
      return false;
    }

    this.currentPlan.currentStepIndex = nextIndex;
    this.currentPlan.steps[nextIndex].status = STEP_STATUS.AWAITING_APPROVAL;
    this.currentPlan.status = PLAN_STATUS.PAUSED;
    return true;
  }

  /**
   * Модифицирует шаг плана
   * @param {number} stepIndex - Индекс шага
   * @param {Object} updates - Обновления
   * @returns {boolean}
   */
  modifyStep(stepIndex, updates) {
    if (!this.currentPlan || stepIndex >= this.currentPlan.steps.length) {
      return false;
    }

    const step = this.currentPlan.steps[stepIndex];
    if (step.status !== STEP_STATUS.PENDING && step.status !== STEP_STATUS.AWAITING_APPROVAL) {
      return false; // Нельзя модифицировать уже выполненные шаги
    }

    if (updates.title) step.title = updates.title;
    if (updates.description) step.description = updates.description;

    return true;
  }

  /**
   * Добавляет шаг в план
   * @param {number} afterIndex - Индекс после которого вставить
   * @param {{title: string, description: string}} step - Новый шаг
   * @returns {boolean}
   */
  addStep(afterIndex, step) {
    if (!this.currentPlan) return false;

    const newStep = {
      id: `${this.currentPlan.id}_step_${Date.now()}`,
      title: step.title,
      description: step.description,
      status: STEP_STATUS.PENDING,
      result: null,
    };

    this.currentPlan.steps.splice(afterIndex + 1, 0, newStep);
    return true;
  }

  /**
   * Удаляет шаг из плана
   * @param {number} stepIndex - Индекс шага
   * @returns {boolean}
   */
  removeStep(stepIndex) {
    if (!this.currentPlan || stepIndex >= this.currentPlan.steps.length) {
      return false;
    }

    const step = this.currentPlan.steps[stepIndex];
    if (step.status !== STEP_STATUS.PENDING) {
      return false; // Нельзя удалять не-pending шаги
    }

    this.currentPlan.steps.splice(stepIndex, 1);

    // Корректируем currentStepIndex если нужно
    if (stepIndex < this.currentPlan.currentStepIndex) {
      this.currentPlan.currentStepIndex--;
    }

    return true;
  }

  /**
   * Получает прогресс выполнения плана
   * @returns {{completed: number, total: number, percentage: number}|null}
   */
  getProgress() {
    if (!this.currentPlan) return null;

    const completed = this.currentPlan.steps.filter(
      (s) => s.status === STEP_STATUS.COMPLETED || s.status === STEP_STATUS.SKIPPED
    ).length;
    const total = this.currentPlan.steps.length;

    return {
      completed,
      total,
      percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
    };
  }

  /**
   * Форматирует план для отображения пользователю
   * @returns {string}
   */
  formatPlanForDisplay() {
    if (!this.currentPlan) return "Нет активного плана";

    const statusEmoji = {
      [STEP_STATUS.PENDING]: "⏳",
      [STEP_STATUS.AWAITING_APPROVAL]: "🔔",
      [STEP_STATUS.IN_PROGRESS]: "🔄",
      [STEP_STATUS.COMPLETED]: "✅",
      [STEP_STATUS.SKIPPED]: "⏭️",
      [STEP_STATUS.FAILED]: "❌",
    };

    const lines = [
      `📋 **План: ${this.currentPlan.taskDescription}**`,
      `Статус: ${this.currentPlan.status}`,
      "",
      "Шаги:",
    ];

    this.currentPlan.steps.forEach((step, index) => {
      const emoji = statusEmoji[step.status] || "•";
      const current = index === this.currentPlan.currentStepIndex ? " ← текущий" : "";
      lines.push(`${emoji} ${index + 1}. ${step.title}${current}`);
      if (step.description) {
        lines.push(`   ${step.description}`);
      }
    });

    const progress = this.getProgress();
    if (progress) {
      lines.push("");
      lines.push(`Прогресс: ${progress.completed}/${progress.total} (${progress.percentage}%)`);
    }

    return lines.join("\n");
  }

  /**
   * Сбрасывает состояние
   */
  reset() {
    this.currentPlan = null;
    this.autoApproveSteps = false;
  }

  /**
   * Сериализует состояние для сохранения
   * @returns {Object}
   */
  serialize() {
    return {
      currentPlan: this.currentPlan,
      autoApproveSteps: this.autoApproveSteps,
    };
  }

  /**
   * Восстанавливает состояние
   * @param {Object} data
   */
  deserialize(data) {
    if (data.currentPlan) {
      this.currentPlan = data.currentPlan;
      // Восстанавливаем Date объекты
      if (this.currentPlan.createdAt) {
        this.currentPlan.createdAt = new Date(this.currentPlan.createdAt);
      }
      if (this.currentPlan.completedAt) {
        this.currentPlan.completedAt = new Date(this.currentPlan.completedAt);
      }
    }
    this.autoApproveSteps = data.autoApproveSteps || false;
  }
}
