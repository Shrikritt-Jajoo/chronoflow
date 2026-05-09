// =========================================================
// ChronoFlow AI Job — Weekly Review
// Produces reflective insights from last week's work
// =========================================================

const WeeklyReviewJob = {
  id: 'weekly-review',

  async run(session) {
    const context = await AIJobRunner.gatherInputs(['tasks', 'scheduleBlocks', 'focusSessions', 'settings']);
    return session.executeStep({
      job: 'weekly-review',
      instruction: 'Summarize the week, identify patterns in completed work, missed plans, and energy usage, and propose realistic improvements for next week.',
      context
    });
  }
};
