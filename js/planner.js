// =========================================================
// ChronoFlow Planner Page
// Task CRUD, slot management, schedule rendering
// =========================================================
const Planner = {
  _sortOrder: localStorage.getItem('cf-task-sort') || 'priority',

  async init() {
    await AppState.init();
    this.render();
    this.bindEvents();
    AppState.on('tasks',          () => this.render());
    AppState.on('slots',          () => this.render());
    AppState.on('scheduleBlocks', () => this.render());
  },

  async render() {
    await this.renderTasks();
    await this.renderSlots();
    await this.renderSchedule();
  },

  async renderTasks() {
    const el = document.getElementById('taskList');
    if (!el) return;
    let tasks = [...(AppState.get('tasks') || [])];
    if (!tasks.length) { el.innerHTML = '<div class="empty-state">No tasks yet — add one below.</div>'; return; }

    const active    = tasks.filter(t => !t.isCompleted);
    const completed = tasks.filter(t =>  t.isCompleted);

    const sortFn = {
      priority: (a, b) => (a.priority || 3) - (b.priority || 3),
      deadline: (a, b) => new Date(a.deadline || '9999') - new Date(b.deadline || '9999'),
      progress: (a, b) => (b.progressPercent || 0) - (a.progressPercent || 0),
      created:  (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
    }[this._sortOrder] || ((a, b) => (a.priority || 3) - (b.priority || 3));

    active.sort(sortFn);
    const sorted = [...active, ...completed];

    el.innerHTML = `
      <div class="task-sort-row">
        <label class="task-sort-label">Sort by</label>
        <select id="taskSortSelect" class="task-sort-select">
          <option value="priority" ${this._sortOrder==='priority'?'selected':''}>Priority</option>
          <option value="deadline" ${this._sortOrder==='deadline'?'selected':''}>Deadline</option>
          <option value="progress" ${this._sortOrder==='progress'?'selected':''}>Progress</option>
          <option value="created"  ${this._sortOrder==='created' ?'selected':''}>Newest first</option>
        </select>
      </div>` +
      sorted.map(task => `
        <div class="task-card${task.isCompleted ? ' done' : ''}" data-id="${task.id}">
          <div style="flex:1;min-width:0">
            <div class="task-card-title">${Utils.escapeHtml(task.title)}</div>
            <div class="task-card-meta">
              <span class="tag">${task.estimatedMinutes || 30} min</span>
              <span class="tag tag-cyan">P${task.priority || 3}</span>
              <span class="tag tag-violet">${task.context || 'focus'}</span>
              ${task.deadline ? `<span class="tag tag-warning">Due ${Utils.formatDateTime(new Date(task.deadline))}</span>` : ''}
              ${task.progressPercent > 0 ? `<span class="tag">${task.progressPercent}%</span>` : ''}
            </div>
          </div>
          <div class="task-card-actions">
            <button class="btn btn-icon btn-ghost" data-focus="${task.id}" title="Focus">&#9654;</button>
            <button class="btn btn-icon btn-ghost" data-edit="${task.id}" title="Edit">&#9998;</button>
            <button class="btn btn-icon btn-ghost" data-delete="${task.id}" title="Delete">&#10005;</button>
          </div>
        </div>`).join('');

    el.querySelector('#taskSortSelect')?.addEventListener('change', e => {
      this._sortOrder = e.target.value;
      localStorage.setItem('cf-task-sort', this._sortOrder);
      this.renderTasks();
    });
  },

  async renderSlots() {
    // Fix 5: correct ID is 'slotList' (no trailing s) per planner.html
    const el = document.getElementById('slotList');
    if (!el) return;
    const slots = (AppState.get('slots') || []).sort((a,b) => new Date(a.start) - new Date(b.start));
    if (!slots.length) { el.innerHTML = '<div class="empty-state">No time slots added yet.</div>'; return; }
    el.innerHTML = slots.map(slot => `
      <div class="slot-card" data-id="${slot.id}">
        <div>
          <div class="slot-card-title">${Utils.escapeHtml(slot.label)}</div>
          <div class="slot-card-time">${Utils.formatDateTime(new Date(slot.start))} &ndash; ${Utils.formatDateTime(new Date(slot.end))}</div>
          <div style="margin-top:.5rem"><span class="tag tag-cyan">Energy ${slot.energyLevel || 3}</span></div>
        </div>
        <button class="btn btn-icon btn-ghost" data-deleteSlot="${slot.id}">&#10005;</button>
      </div>`).join('');
  },

  async renderSchedule() {
    const el = document.getElementById('scheduleList');
    if (!el) return;
    const tasks  = AppState.get('tasks') || [];
    const slots  = AppState.get('slots') || [];
    const blocks = Scheduler.buildScheduleSync
      ? Scheduler.buildScheduleSync(tasks, slots)
      : await Scheduler.buildSchedule();
    if (!blocks || !blocks.length) { el.innerHTML = '<div class="empty-state">Add tasks and time slots to generate a schedule.</div>'; return; }
    el.innerHTML = blocks.map(block => `
      <div class="schedule-block${block.isBreak ? ' break' : ''}">
        <div class="schedule-block-header">
          <span class="schedule-block-title">${Utils.escapeHtml(block.title)}</span>
          <span class="tag">${block.minutes} min</span>
        </div>
        <div class="schedule-block-time">${Utils.formatDateTime(new Date(block.start))} &ndash; ${Utils.formatDateTime(new Date(block.end))}</div>
      </div>`).join('');
  },

  bindEvents() {
    document.getElementById('taskList')?.addEventListener('click', async e => {
      const focusId  = e.target.closest('[data-focus]')?.dataset.focus;
      const editId   = e.target.closest('[data-edit]')?.dataset.edit;
      const deleteId = e.target.closest('[data-delete]')?.dataset.delete;
      if (focusId)  this.openFocusModal(focusId);
      if (editId)   this.openTaskModal(editId);
      if (deleteId) AppShell.confirm('Delete this task?', () => AppState.remove('tasks', deleteId));
    });

    // Fix 5: correct ID 'slotList'
    document.getElementById('slotList')?.addEventListener('click', async e => {
      const deleteId = e.target.closest('[data-deleteSlot]')?.dataset.deleteslot;
      if (deleteId) AppShell.confirm('Remove this time slot?', () => AppState.remove('slots', deleteId));
    });

    document.getElementById('addTaskBtn')?.addEventListener('click',  () => this.openTaskModal());
    document.getElementById('addSlotBtn')?.addEventListener('click',  () => this.openSlotModal());
    // Fix 6: correct ID 'generateBtn'
    document.getElementById('generateBtn')?.addEventListener('click', () => this.renderSchedule());
  },

  openTaskModal(editId = null) {
    const task = editId ? (AppState.get('tasks') || []).find(t => t.id === editId) : null;
    const modal = document.createElement('div');
    modal.className = 'modal-overlay open';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header"><span class="panel-title">${task ? 'Edit Task' : 'Add Task'}</span></div>
        <div class="modal-body">
          <div class="form-group"><label>Title</label><input id="tTitle" value="${Utils.escapeHtml(task?.title||'')}"></div>
          <div class="form-row">
            <div class="form-group"><label>Duration (min)</label><input type="number" id="tDuration" value="${task?.estimatedMinutes||30}" min="5"></div>
            <div class="form-group"><label>Priority (1-5)</label><input type="number" id="tPriority" value="${task?.priority||3}" min="1" max="5"></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Energy need (1-5)</label><input type="number" id="tEnergy" value="${task?.energyNeed||3}" min="1" max="5"></div>
            <div class="form-group"><label>Deadline</label><input type="datetime-local" id="tDeadline" value="${task?.deadline||''}"></div>
          </div>
          <div class="form-group">
            <label>Context</label>
            <select id="tContext">
              ${['focus','study','admin','errand','creative','meeting'].map(c=>`<option value="${c}"${task?.context===c?' selected':''}>${c}</option>`).join('')}
            </select>
          </div>
          <div class="form-group"><label>Notes / next step</label><textarea id="tNotes">${Utils.escapeHtml(task?.nextStep||'')}</textarea></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" id="tCancel">Cancel</button>
          <button class="btn btn-primary" id="tSave">${task ? 'Save Changes' : 'Add Task'}</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#tCancel').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    modal.querySelector('#tSave').addEventListener('click', async () => {
      const title = modal.querySelector('#tTitle').value.trim();
      if (!title) { AppShell.toast('Title is required', 'error'); return; }
      const newDuration = parseInt(modal.querySelector('#tDuration').value) || 30;
      const data = {
        title,
        estimatedMinutes: newDuration,
        // Fix 7: preserve remainingMinutes progress on edit
        remainingMinutes: task
          ? Math.min(task.remainingMinutes ?? newDuration, newDuration)
          : newDuration,
        priority: parseInt(modal.querySelector('#tPriority').value) || 3,
        energyNeed: parseInt(modal.querySelector('#tEnergy').value) || 3,
        deadline: modal.querySelector('#tDeadline').value || null,
        context: modal.querySelector('#tContext').value,
        nextStep: modal.querySelector('#tNotes').value.trim(),
        isCompleted: task?.isCompleted || false,
        progressPercent: task?.progressPercent || 0
      };
      if (task) { await AppState.update('tasks', task.id, data); AppShell.toast('Task updated', 'success'); }
      else      { await AppState.add('tasks', { ...data, id: Utils.uid('task'), createdAt: new Date().toISOString() }); AppShell.toast('Task added', 'success'); }
      modal.remove();
    });
  },

  openSlotModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay open';
    const now = new Date(); now.setMinutes(0,0,0);
    const later = new Date(now); later.setHours(later.getHours() + 2);
    const toLocal = d => { const off = d.getTimezoneOffset(); const loc = new Date(d - off*60000); return loc.toISOString().slice(0,16); };
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header"><span class="panel-title">Add Time Slot</span></div>
        <div class="modal-body">
          <div class="form-group"><label>Label</label><input id="sLabel" value="Morning work"></div>
          <div class="form-row">
            <div class="form-group"><label>Start</label><input type="datetime-local" id="sStart" value="${toLocal(now)}"></div>
            <div class="form-group"><label>End</label><input type="datetime-local" id="sEnd" value="${toLocal(later)}"></div>
          </div>
          <div class="form-group"><label>Energy level (1-5)</label><input type="number" id="sEnergy" value="3" min="1" max="5"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" id="sCancel">Cancel</button>
          <button class="btn btn-primary" id="sSave">Add Slot</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#sCancel').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    modal.querySelector('#sSave').addEventListener('click', async () => {
      const label = modal.querySelector('#sLabel').value.trim();
      const start = modal.querySelector('#sStart').value;
      const end   = modal.querySelector('#sEnd').value;
      if (!label || !start || !end) { AppShell.toast('All fields required', 'error'); return; }
      if (new Date(start) >= new Date(end)) { AppShell.toast('End must be after start', 'error'); return; }
      await AppState.add('slots', {
        id: Utils.uid('slot'), label,
        start: new Date(start).toISOString(),
        end:   new Date(end).toISOString(),
        energyLevel: parseInt(modal.querySelector('#sEnergy').value) || 3,
        createdAt: new Date().toISOString()
      });
      AppShell.toast('Slot added', 'success');
      modal.remove();
    });
  },

  openFocusModal(taskId) {
    window.location.href = `focus.html?task=${taskId}`;
  }
};
