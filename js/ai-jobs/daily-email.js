// =========================================================
// ChronoFlow AI Job — Daily Email
// Prepares a summary payload for Gmail sending
// =========================================================

const DailyEmailJob = {
  id: 'daily-email',

  async run(session) {
    const context = await AIJobRunner.gatherInputs(['tasks', 'scheduleBlocks', 'focusSessions', 'settings']);
    return session.executeStep({
      job: 'daily-email',
      instruction: 'Prepare a concise end-of-day summary email covering what was planned, what was completed, and what should be carried forward.',
      context
    });
  }
};
