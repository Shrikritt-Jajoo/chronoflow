// =========================================================
// ChronoFlow AI Job — Goal Decomposition
// Suggests smaller actionable tasks from a large goal
// =========================================================

const GoalDecompositionJob = {
  id: 'goal-decomposition',

  async run(session) {
    const context = await AIJobRunner.gatherInputs(['tasks', 'goals', 'settings']);
    return session.executeStep({
      job: 'goal-decomposition',
      instruction: 'Break the selected goal into concrete, realistic subtasks that can be completed in one sitting.',
      context
    });
  }
};
