// =========================================================
// ChronoFlow Scheduler Engine
// Rule-based smart scheduling with manual override support
// =========================================================
const Scheduler = {
  DEFAULT_BUFFER_MINUTES: 10,
  MAX_CHUNK_MINUTES: 90,
  MIN_CHUNK_MINUTES: 15,

  async buildSchedule(day = Utils.todayStart()) {
    const tasks = AppState.get('tasks').filter(t => !t.isCompleted);
    const slots = AppState.get('slots').filter(s => {
      const d = new Date(s.start);
      return d >= day && d < Utils.todayEnd();
    });
    const manualBlocks = AppState.get('scheduleBlocks').filter(b => b.isManual);
    if (!slots.length) return [];

    const scored = tasks.map(task => ({ task, score: this.computeScore(task, slots) }))
                        .sort((a, b) => b.score - a.score);

    const schedule = [];
    const taskRemaining = new Map();
    for (const t of tasks) taskRemaining.set(t.id, t.remainingMinutes || t.estimatedMinutes || 30);

    for (const block of manualBlocks) {
      schedule.push({ ...block, preserved: true });
      const rem = taskRemaining.get(block.taskId);
      if (rem !== undefined) taskRemaining.set(block.taskId, Math.max(0, rem - block.minutes));
    }

    for (const slot of slots.sort((a,b) => new Date(a.start) - new Date(b.start))) {
      let cursor = new Date(slot.start).getTime();
      const slotEnd = new Date(slot.end).getTime();

      while (cursor < slotEnd) {
        const available = Math.floor((slotEnd - cursor) / 60000);
        if (available < this.MIN_CHUNK_MINUTES) break;

        const candidates = scored
          .filter(({ task }) => taskRemaining.get(task.id) > 0)
          .map(({ task }) => ({ task, slotScore: this.slotFitScore(task, slot) }))
          .sort((a, b) => b.slotScore - a.slotScore);
        if (!candidates.length) break;

        const winner = candidates[0].task;
        const remaining = taskRemaining.get(winner.id);
        const chunkSize = Math.min(remaining, available, this.MAX_CHUNK_MINUTES);
        if (chunkSize < this.MIN_CHUNK_MINUTES) break;

        schedule.push({
          id: Utils.uid('block'),
          taskId: winner.id,
          slotId: slot.id,
          title: winner.title,
          start: new Date(cursor).toISOString(),
          end: new Date(cursor + chunkSize * 60000).toISOString(),
          minutes: chunkSize,
          isManual: false,
          bufferAfter: this.DEFAULT_BUFFER_MINUTES
        });

        taskRemaining.set(winner.id, remaining - chunkSize);
        cursor += chunkSize * 60000;
        if (cursor + this.DEFAULT_BUFFER_MINUTES * 60000 <= slotEnd) cursor += this.DEFAULT_BUFFER_MINUTES * 60000;
      }
    }

    return schedule.sort((a, b) => new Date(a.start) - new Date(b.start));
  },

  computeScore(task, slots) {
    let score = 0;
    const hoursLeft = Utils.hoursUntil(task.deadline);
    const remaining = task.remainingMinutes || task.estimatedMinutes || 30;
    if (hoursLeft < 0)       score += 100;
    else if (hoursLeft < 6)  score += 50;
    else if (hoursLeft < 12) score += 35;
    else if (hoursLeft < 24) score += 25;
    else if (hoursLeft < 72) score += 15;
    else                     score += 5;
    if (task.isPinned)       score += 40;
    score += (task.priority || 3) * 8;
    score += (task.effort   || 3) * 4;
    if (hoursLeft > 0 && hoursLeft < Infinity) {
      const ratio = (remaining / 60) / hoursLeft;
      if (ratio > 0.8) score += 30;
      else if (ratio > 0.5) score += 15;
    }
    if (task.progressPercent > 0 && task.progressPercent < 100) score += 12;
    return score;
  },

  slotFitScore(task, slot) {
    let score = 0;
    const diff = Math.abs((slot.energyLevel || 3) - (task.energyNeed || 3));
    score += Math.max(0, 15 - diff * 5);
    const type = task.type || 'focus';
    if (type === 'deep' || type === 'study') {
      score += (slot.energyLevel || 3) >= 4 ? 10 : (slot.energyLevel || 3) <= 2 ? -10 : 0;
    } else if (type === 'admin' || type === 'errand') {
      if ((slot.energyLevel || 3) <= 3) score += 5;
    }
    return score;
  },

  async rescheduleUnfinished() {
    const tomorrow = new Date(Utils.todayStart());
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tasks = AppState.get('tasks');
    for (const task of tasks) {
      if (!task.isCompleted && task.progressPercent > 0 && task.progressPercent < 100) {
        const rem = Math.ceil((task.estimatedMinutes || 30) * (1 - task.progressPercent / 100));
        await AppState.update('tasks', task.id, { remainingMinutes: Math.max(rem, 5) });
      }
    }
    const schedule = await this.buildSchedule(tomorrow);
    await DB.clear('scheduleBlocks');
    for (const block of schedule) await DB.put('scheduleBlocks', block);
    AppState._data.scheduleBlocks = schedule;
    AppState._emit('scheduleBlocks', schedule);
    return schedule;
  }
};
