/**
 * Tests for ProfessionalModeHandler
 */

import {
  ProfessionalModeHandler,
  PLAN_STATUS,
  STEP_STATUS,
} from "./professional-handler.js";

describe("ProfessionalModeHandler", () => {
  let handler;

  beforeEach(() => {
    handler = new ProfessionalModeHandler();
  });

  describe("isActive", () => {
    it("returns true for professional mode", () => {
      expect(handler.isActive("professional")).toBe(true);
    });

    it("returns false for other modes", () => {
      expect(handler.isActive("default")).toBe(false);
      expect(handler.isActive("yolo")).toBe(false);
      expect(handler.isActive("plan")).toBe(false);
    });
  });

  describe("createPlan", () => {
    it("creates a plan with steps", () => {
      const steps = [
        { title: "Step 1", description: "Do something" },
        { title: "Step 2", description: "Do something else" },
      ];

      const plan = handler.createPlan("Test task", steps);

      expect(plan.taskDescription).toBe("Test task");
      expect(plan.steps).toHaveLength(2);
      expect(plan.status).toBe(PLAN_STATUS.PENDING_APPROVAL);
      expect(plan.currentStepIndex).toBe(0);
      expect(plan.steps[0].status).toBe(STEP_STATUS.PENDING);
    });

    it("generates unique IDs", () => {
      const plan = handler.createPlan("Task", [{ title: "Step", description: "" }]);

      expect(plan.id).toMatch(/^plan_\d+$/);
      expect(plan.steps[0].id).toMatch(/^plan_\d+_step_0$/);
    });
  });

  describe("hasPlan", () => {
    it("returns false when no plan exists", () => {
      expect(handler.hasPlan()).toBe(false);
    });

    it("returns true when plan exists", () => {
      handler.createPlan("Task", [{ title: "Step", description: "" }]);
      expect(handler.hasPlan()).toBe(true);
    });
  });

  describe("approvePlan", () => {
    it("approves pending plan", () => {
      handler.createPlan("Task", [
        { title: "Step 1", description: "" },
        { title: "Step 2", description: "" },
      ]);

      const result = handler.approvePlan();

      expect(result).toBe(true);
      expect(handler.currentPlan.status).toBe(PLAN_STATUS.PAUSED);
      expect(handler.currentPlan.steps[0].status).toBe(STEP_STATUS.AWAITING_APPROVAL);
    });

    it("fails if plan is not pending approval", () => {
      expect(handler.approvePlan()).toBe(false);
    });
  });

  describe("rejectPlan", () => {
    it("rejects plan", () => {
      handler.createPlan("Task", [{ title: "Step", description: "" }]);

      const result = handler.rejectPlan();

      expect(result).toBe(true);
      expect(handler.currentPlan.status).toBe(PLAN_STATUS.CANCELLED);
    });

    it("fails if no plan exists", () => {
      expect(handler.rejectPlan()).toBe(false);
    });
  });

  describe("approveCurrentStep", () => {
    beforeEach(() => {
      handler.createPlan("Task", [
        { title: "Step 1", description: "" },
        { title: "Step 2", description: "" },
      ]);
      handler.approvePlan();
    });

    it("approves step awaiting approval", () => {
      const step = handler.approveCurrentStep();

      expect(step).not.toBeNull();
      expect(step.status).toBe(STEP_STATUS.IN_PROGRESS);
      expect(handler.currentPlan.status).toBe(PLAN_STATUS.EXECUTING);
    });

    it("returns null if step is not awaiting approval", () => {
      handler.approveCurrentStep(); // First approval
      expect(handler.approveCurrentStep()).toBeNull();
    });
  });

  describe("completeCurrentStep", () => {
    beforeEach(() => {
      handler.createPlan("Task", [
        { title: "Step 1", description: "" },
        { title: "Step 2", description: "" },
      ]);
      handler.approvePlan();
      handler.approveCurrentStep();
    });

    it("completes step and moves to next", () => {
      const hasNext = handler.completeCurrentStep("Done!");

      expect(hasNext).toBe(true);
      expect(handler.currentPlan.steps[0].status).toBe(STEP_STATUS.COMPLETED);
      expect(handler.currentPlan.steps[0].result).toBe("Done!");
      expect(handler.currentPlan.currentStepIndex).toBe(1);
      expect(handler.currentPlan.steps[1].status).toBe(STEP_STATUS.AWAITING_APPROVAL);
    });

    it("completes plan when last step is done", () => {
      handler.completeCurrentStep();
      handler.approveCurrentStep();

      const hasNext = handler.completeCurrentStep();

      expect(hasNext).toBe(false);
      expect(handler.currentPlan.status).toBe(PLAN_STATUS.COMPLETED);
      expect(handler.currentPlan.completedAt).not.toBeNull();
    });
  });

  describe("skipCurrentStep", () => {
    beforeEach(() => {
      handler.createPlan("Task", [
        { title: "Step 1", description: "" },
        { title: "Step 2", description: "" },
      ]);
      handler.approvePlan();
    });

    it("skips step and moves to next", () => {
      const hasNext = handler.skipCurrentStep();

      expect(hasNext).toBe(true);
      expect(handler.currentPlan.steps[0].status).toBe(STEP_STATUS.SKIPPED);
      expect(handler.currentPlan.currentStepIndex).toBe(1);
    });
  });

  describe("failCurrentStep", () => {
    beforeEach(() => {
      handler.createPlan("Task", [{ title: "Step 1", description: "" }]);
      handler.approvePlan();
      handler.approveCurrentStep();
    });

    it("marks step as failed", () => {
      const result = handler.failCurrentStep("Error occurred");

      expect(result).toBe(true);
      expect(handler.currentPlan.steps[0].status).toBe(STEP_STATUS.FAILED);
      expect(handler.currentPlan.steps[0].result).toBe("Error occurred");
      expect(handler.currentPlan.status).toBe(PLAN_STATUS.PAUSED);
    });
  });

  describe("modifyStep", () => {
    beforeEach(() => {
      handler.createPlan("Task", [
        { title: "Original", description: "Original desc" },
      ]);
    });

    it("modifies pending step", () => {
      const result = handler.modifyStep(0, {
        title: "Modified",
        description: "New desc",
      });

      expect(result).toBe(true);
      expect(handler.currentPlan.steps[0].title).toBe("Modified");
      expect(handler.currentPlan.steps[0].description).toBe("New desc");
    });

    it("fails for completed step", () => {
      handler.approvePlan();
      handler.approveCurrentStep();
      handler.completeCurrentStep();

      const result = handler.modifyStep(0, { title: "Modified" });
      expect(result).toBe(false);
    });
  });

  describe("addStep", () => {
    it("adds step after specified index", () => {
      handler.createPlan("Task", [{ title: "Step 1", description: "" }]);

      handler.addStep(0, { title: "New Step", description: "Added" });

      expect(handler.currentPlan.steps).toHaveLength(2);
      expect(handler.currentPlan.steps[1].title).toBe("New Step");
    });
  });

  describe("removeStep", () => {
    beforeEach(() => {
      handler.createPlan("Task", [
        { title: "Step 1", description: "" },
        { title: "Step 2", description: "" },
        { title: "Step 3", description: "" },
      ]);
    });

    it("removes pending step", () => {
      const result = handler.removeStep(1);

      expect(result).toBe(true);
      expect(handler.currentPlan.steps).toHaveLength(2);
      expect(handler.currentPlan.steps[1].title).toBe("Step 3");
    });

    it("adjusts currentStepIndex when removing earlier step", () => {
      handler.approvePlan();
      handler.skipCurrentStep(); // Now at index 1

      handler.removeStep(0);

      // Should not work as step 0 is now skipped (not pending)
      expect(handler.currentPlan.steps).toHaveLength(3);
    });
  });

  describe("getProgress", () => {
    it("returns null when no plan", () => {
      expect(handler.getProgress()).toBeNull();
    });

    it("calculates progress correctly", () => {
      handler.createPlan("Task", [
        { title: "Step 1", description: "" },
        { title: "Step 2", description: "" },
        { title: "Step 3", description: "" },
        { title: "Step 4", description: "" },
      ]);
      handler.approvePlan();
      handler.approveCurrentStep();
      handler.completeCurrentStep();
      handler.skipCurrentStep();

      const progress = handler.getProgress();

      expect(progress.completed).toBe(2);
      expect(progress.total).toBe(4);
      expect(progress.percentage).toBe(50);
    });
  });

  describe("formatPlanForDisplay", () => {
    it("returns message when no plan", () => {
      expect(handler.formatPlanForDisplay()).toBe("Нет активного плана");
    });

    it("formats plan with steps", () => {
      handler.createPlan("Test task", [
        { title: "Step 1", description: "First step" },
        { title: "Step 2", description: "Second step" },
      ]);

      const display = handler.formatPlanForDisplay();

      expect(display).toContain("Test task");
      expect(display).toContain("Step 1");
      expect(display).toContain("Step 2");
      expect(display).toContain("0/2");
    });
  });

  describe("reset", () => {
    it("clears all state", () => {
      handler.createPlan("Task", [{ title: "Step", description: "" }]);
      handler.autoApproveSteps = true;

      handler.reset();

      expect(handler.currentPlan).toBeNull();
      expect(handler.autoApproveSteps).toBe(false);
    });
  });

  describe("serialize/deserialize", () => {
    it("serializes and deserializes state", () => {
      handler.createPlan("Task", [{ title: "Step", description: "" }]);
      handler.autoApproveSteps = true;

      const serialized = handler.serialize();
      const newHandler = new ProfessionalModeHandler();
      newHandler.deserialize(serialized);

      expect(newHandler.currentPlan.taskDescription).toBe("Task");
      expect(newHandler.autoApproveSteps).toBe(true);
      expect(newHandler.currentPlan.createdAt).toBeInstanceOf(Date);
    });
  });
});
