// =========================================================
// ChronoFlow AI Job — Backlog Cleanup
// Suggests archiving, deleting, or rewriting stale tasks
// =========================================================

const BacklogCleanupJob = {
  id: 'backlog-cleanup',

  async run(session) {
    const context = await AIJobRunner.gatherInputs(['tasks', 'subtasks', 'settings']);
    return session.executeStep({
      job: 'backlog-cleanup',
      instruction: 'Find stale, duplicated, outdated, or unclear tasks in the backlog and suggest cleanup actions one item at a time.',
      context
    });
  }
};
