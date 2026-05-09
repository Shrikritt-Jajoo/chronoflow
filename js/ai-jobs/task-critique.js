// =========================================================
// ChronoFlow AI Job — Task Critique
// Reviews current tasks and suggests clearer wording / next steps
// =========================================================

const TaskCritiqueJob = {
  id: 'task-critique',

  async run(session) {
    const context = await AIJobRunner.gatherInputs(['tasks', 'settings']);
    return session.executeStep({
      job: 'task-critique',
      instruction: 'Review existing tasks, identify vague or oversized tasks, and suggest clearer titles, next steps, or scope reductions.',
      context
    });
  }
};
