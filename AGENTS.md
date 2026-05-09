# AGENTS.md — ChronoFlow AI Harness Bible

This document is the single source of truth for every AI agent operating inside ChronoFlow.
You **must** read this entire document before proposing any changes.
If you cannot find guidance here for something the user requests, say so explicitly and stop — do not guess.

---

## 1. Architecture Overview

```
chronoflow/
├── index.html          Home page — clock, metrics, quick actions
├── planner.html        Planner — task list, time slots, generated schedule
├── focus.html          Focus session — fullscreen timer, progress modal
├── stats.html          Stats — today metrics, streak, weekly chart, energy insight
├── settings.html       Settings — appearance, planning rules, Gmail, AI, data, versions
├── server.rs           Rust static file server + API routes (compile with rustc)
├── data.json           Flat JSON persistence file (created by server on first run)
├── AGENTS.md           This file
├── css/
│   ├── tokens.css      ALL design tokens (colours, spacing, radii, motion) — CSS variables
│   ├── reset.css       Box-sizing, base styles, prefers-reduced-motion
│   ├── grain.css       Film grain overlay + keyframes
│   ├── starfield.css   Canvas positioning
│   ├── shell.css       Nav bar, blur masks, toast, confirm modal, onboarding
│   ├── home.css        Clock block, focus timer swap, subtask strip
│   ├── planner.css     Task cards, subtask editor, schedule blocks
│   ├── focus.css       Focus overlay, post-session modal
│   ├── stats.css       Metric cards, chart containers, streak dots
│   ├── settings.css    Settings layout, seg controls, toggles, colour swatches
│   └── user-theme.css  User/AI token overrides — loaded AFTER tokens.css (may not exist yet)
└── js/
    ├── app.js          ⚠ LOCKED — DB facade, server detection, page router
    ├── state.js        ⚠ LOCKED — AppState in-memory cache + event bus
    ├── utils.js        ⚠ LOCKED — pure utility functions
    ├── app-shell.js    AppShell — nav, theme toggle, toast, confirm modal
    ├── backgrounds.js  Backgrounds — canvas orbital/eclipse/hybrid renderer
    ├── scheduler.js    Scheduler — rule-based scheduling engine
    ├── focus.js        FocusMode — countdown timer, pause/resume, progress modal
    ├── planner.js      Planner — task/slot CRUD, schedule rendering
    ├── settings.js     Settings — all settings panels
    ├── gmail.js        GmailConnector — OAuth, send daily plan
    ├── home.js         Home IIFE — clock tick, metrics
    └── ai-jobs/        AI job modules (may not exist yet — create as needed)
        ├── goal-decomposition.js
        ├── task-critique.js
        ├── daily-email.js
        ├── backlog-cleanup.js
        └── weekly-review.js
```

### Script load order (every HTML file)
Scripts are loaded in this exact order via `<script>` tags:
1. `js/app.js` (DB + router)
2. `js/utils.js`
3. `js/state.js`
4. `js/app-shell.js`
5. `js/backgrounds.js`
6. Page-specific JS (e.g. `js/planner.js`)
7. Any new feature JS files

Do not change this order. New files go at position 7.

---

## 2. Data Model

All data lives in `data.json` (server mode) or IndexedDB (standalone mode).
Every object shape is defined below. Do not add fields not listed here without updating this document.

### Task
```json
{
  "id": "task-lx3k2a",
  "title": "Write introduction",
  "estimatedMinutes": 45,
  "remainingMinutes": 45,
  "priority": 4,
  "energyNeed": 4,
  "context": "focus",
  "deadline": "2026-05-10T18:00:00.000Z",
  "nextStep": "Open doc and write first paragraph",
  "notes": "",
  "progressPercent": 0,
  "isCompleted": false,
  "isPinned": false,
  "suggestedSlot": "morning",
  "dependencies": [],
  "createdAt": "2026-05-09T10:00:00.000Z",
  "updatedAt": "2026-05-09T10:00:00.000Z"
}
```
- `context` must be one of: `focus | study | admin | errand | creative | meeting`
- `priority` and `energyNeed`: integers 1–5
- `suggestedSlot`: `morning | afternoon | evening | null`
- `progressPercent`: 0–100
- `dependencies`: array of task **titles** (not IDs)

### Slot
```json
{
  "id": "slot-abc123",
  "label": "Morning work",
  "start": "2026-05-10T06:00:00.000Z",
  "end": "2026-05-10T09:00:00.000Z",
  "energyLevel": 5,
  "createdAt": "2026-05-09T10:00:00.000Z"
}
```
- `energyLevel`: integer 1–5

### ScheduleBlock
```json
{
  "id": "block-xyz789",
  "taskId": "task-lx3k2a",
  "slotId": "slot-abc123",
  "title": "Write introduction",
  "start": "2026-05-10T06:00:00.000Z",
  "end": "2026-05-10T06:45:00.000Z",
  "minutes": 45,
  "isManual": false,
  "isBreak": false,
  "bufferAfter": 10,
  "preserved": false
}
```

### FocusSession
```json
{
  "id": "session-q1w2e3",
  "taskId": "task-lx3k2a",
  "taskTitle": "Write introduction",
  "startTime": "2026-05-09T09:00:00.000Z",
  "endTime": "2026-05-09T09:45:00.000Z",
  "plannedMinutes": 45,
  "actualMinutes": 42,
  "progressDelta": 30
}
```
- `progressDelta`: percentage points gained during this session (0–100)

### Settings
```json
{
  "key": "main",
  "defaultDuration": 30,
  "bufferMinutes": 10,
  "autoReschedule": true,
  "userName": "",
  "morningEnergy": 4,
  "afternoonEnergy": 3,
  "eveningEnergy": 2
}
```
- `key` is always `"main"` — singleton record

### GmailConfig
```json
{
  "key": "main",
  "clientId": "",
  "accessToken": "",
  "expiresAt": 0
}
```

### AiConfig
```json
{
  "key": "main",
  "geminiKey": "",
  "model": "gemini-2.0-flash"
}
```

### RegisteredAiJob
```json
{
  "jobId": "goal-decomposition",
  "label": "Goal Decomposition",
  "trigger": "planner-sidebar",
  "systemPrompt": "...",
  "userMessageTemplate": "...",
  "inputSources": ["tasks", "settings"],
  "outputSchema": {},
  "acceptRejectPerItem": true,
  "lockedFiles": [],
  "addedBy": "system",
  "addedAt": "2026-05-09T00:00:00.000Z"
}
```
- `trigger` locations: `planner-sidebar | planner-task | home | stats | settings-ai`
- `addedBy`: `system | ai | user`

---

## 3. Locked Files

These files must **never** be modified by an AI agent without explicit user unlock:

| File | Reason |
|---|---|
| `js/app.js` | DB facade — corruption breaks all persistence |
| `js/state.js` | Event bus — corruption breaks all reactivity |
| `js/utils.js` | Pure utilities — other modules depend on exact signatures |

### Unlock procedure
User must explicitly say: *"I want to edit [filename], I understand this is risky."*
The UI then calls `POST /api/unlock` with `{ "file": "js/app.js", "confirm": true }`.
Unlock applies to the current server session only — restarting the server re-locks all files.

**Even when unlocked:** never delete existing functions, never rename parameters, never change return types.

---

## 4. CSS Token Catalogue

All tokens live in `css/tokens.css`. User overrides go in `css/user-theme.css`.
**Never edit `tokens.css` directly.** Write overrides to `user-theme.css` only.

### Colour tokens
| Token | Default | Description |
|---|---|---|
| `--color-bg` | `#070a12` | Page background |
| `--color-bg-card` | `rgba(255,255,255,0.03)` | Card surface |
| `--color-bg-panel` | `rgba(255,255,255,0.05)` | Panel/sidebar surface |
| `--color-border` | `rgba(255,255,255,0.08)` | Default border |
| `--color-border-strong` | `rgba(255,255,255,0.15)` | Focused/active border |
| `--color-text` | `#eef1ff` | Primary text |
| `--color-text-muted` | `#8892b0` | Secondary/hint text |
| `--color-text-faint` | `rgba(255,255,255,0.3)` | Placeholder/disabled text |
| `--color-accent-cyan` | `#74f0d3` | Primary accent (CTAs, highlights) |
| `--color-accent-violet` | `#a78bfa` | Secondary accent |
| `--color-accent-blue` | `#8ca6ff` | Tertiary accent |
| `--color-danger` | `#f87171` | Destructive actions |
| `--color-warning` | `#fbbf24` | Warnings, deadlines |
| `--color-success` | `#34d399` | Success states |

### Spacing tokens
| Token | Default | Description |
|---|---|---|
| `--space-xs` | `0.25rem` | 4px |
| `--space-sm` | `0.5rem` | 8px |
| `--space-md` | `1rem` | 16px |
| `--space-lg` | `1.5rem` | 24px |
| `--space-xl` | `2rem` | 32px |
| `--space-2xl` | `3rem` | 48px |

### Typography tokens
| Token | Default | Description |
|---|---|---|
| `--text-xs` | `0.75rem` | 12px |
| `--text-sm` | `0.875rem` | 14px |
| `--text-base` | `1rem` | 16px |
| `--text-lg` | `1.125rem` | 18px |
| `--text-xl` | `1.25rem` | 20px |
| `--text-2xl` | `1.5rem` | 24px |
| `--text-3xl` | `2rem` | 32px |
| `--font-sans` | `system-ui, sans-serif` | Body font stack |
| `--font-mono` | `'JetBrains Mono', monospace` | Code/clock font |
| `--font-weight-normal` | `400` | |
| `--font-weight-medium` | `500` | |
| `--font-weight-bold` | `700` | |

### Radius tokens
| Token | Default | Description |
|---|---|---|
| `--radius-sm` | `4px` | Small elements (tags, badges) |
| `--radius-md` | `8px` | Inputs, small cards |
| `--radius-lg` | `12px` | Cards, panels |
| `--radius-xl` | `16px` | Modals |
| `--radius-full` | `9999px` | Pills, toggles |

### Motion tokens
| Token | Default | Description |
|---|---|---|
| `--transition-fast` | `150ms ease` | Hover states |
| `--transition-base` | `250ms ease` | Standard transitions |
| `--transition-slow` | `400ms ease` | Page-level transitions |
| `--transition-spring` | `300ms cubic-bezier(0.34,1.56,0.64,1)` | Springy entrance |

### Shadow tokens
| Token | Default | Description |
|---|---|---|
| `--shadow-sm` | `0 1px 3px rgba(0,0,0,0.4)` | Subtle elevation |
| `--shadow-md` | `0 4px 16px rgba(0,0,0,0.5)` | Card elevation |
| `--shadow-lg` | `0 8px 32px rgba(0,0,0,0.6)` | Modal elevation |
| `--glow-cyan` | `0 0 20px rgba(116,240,211,0.15)` | Cyan accent glow |
| `--glow-violet` | `0 0 20px rgba(167,139,250,0.15)` | Violet accent glow |

---

## 5. Naming Conventions

### HTML IDs (never rename these)
IDs are referenced across JS files. Renaming one breaks functionality silently.

| ID | Element | Page |
|---|---|---|
| `bgCanvas` | Background canvas | All pages |
| `timeDisplay` | Clock time element | index.html |
| `dateDisplay` | Clock date element | index.html |
| `greetDisplay` | Greeting text | index.html |
| `pendingCount` | Pending task count | index.html |
| `plannedMinutes` | Planned minutes today | index.html |
| `nextBlock` | Next scheduled block | index.html |
| `taskList` | Task list container | planner.html |
| `slotsList` | Slots list container | planner.html |
| `scheduleList` | Schedule blocks container | planner.html |
| `addTaskBtn` | Add task button | planner.html |
| `addSlotBtn` | Add slot button | planner.html |
| `buildScheduleBtn` | Build schedule button | planner.html |
| `focusOverlay` | Focus session overlay | focus.html |
| `focusTimer` | Timer display | focus.html |
| `focusTaskTitle` | Task title in focus | focus.html |
| `focusProgressBar` | Progress bar wrapper | focus.html |
| `focusNextStep` | Next step text | focus.html |
| `appearanceSettings` | Appearance panel | settings.html |
| `planningSettings` | Planning rules panel | settings.html |
| `gmailSettings` | Gmail panel | settings.html |
| `aiSettings` | AI panel | settings.html |
| `dataSettings` | Data panel | settings.html |

### CSS class naming
- BEM-lite: `.block`, `.block-element`, `.block--modifier`
- All classes use `kebab-case`
- Existing classes: `task-card`, `task-card-title`, `task-card-meta`, `task-card-actions`, `slot-card`, `schedule-block`, `btn`, `btn-primary`, `btn-ghost`, `btn-danger`, `btn-icon`, `tag`, `tag-cyan`, `tag-violet`, `tag-warning`, `modal`, `modal-overlay`, `modal-header`, `modal-body`, `modal-footer`, `form-group`, `form-row`, `toggle-row`, `toggle-label`, `toggle-hint`, `seg-control`, `seg-btn`, `panel-title`, `empty-state`, `nav-shell`, `nav-logo`, `toast`, `toast-container`
- New classes must follow same pattern, never conflict with existing ones

### data-* attributes (never rename)
| Attribute | Purpose |
|---|---|
| `data-page` | On `<body>` — identifies page to router (`planner`, `focus`, `stats`, `settings`) |
| `data-theme` | On `<html>` — `dark` or `light` |
| `data-theme-toggle` | On theme button — triggers AppShell.toggleTheme() |
| `data-focus` | On focus button — holds task ID |
| `data-edit` | On edit button — holds task ID |
| `data-delete` | On delete button — holds task ID |
| `data-deleteSlot` | On slot delete button — holds slot ID |
| `data-section` | On settings nav items — target section name |
| `data-bgmode` | On background mode buttons — mode name |

---

## 6. AppState API

`AppState` is the reactive data layer. Always use it — never read from `DB` directly in UI code.

```js
// Initialise (call once per page)
await AppState.init();

// Read (synchronous after init)
const tasks = AppState.get('tasks');         // returns array
const cfg   = AppState.get('aiConfig');      // returns object

// Write
await AppState.add('tasks', taskObject);     // adds item, persists, emits event
await AppState.update('tasks', id, changes); // merges changes, persists, emits
await AppState.remove('tasks', id);          // removes by id, persists, emits
await AppState.set('aiConfig', configObj);   // replaces whole store value

// React to changes
const unsub = AppState.on('tasks', (tasks) => { /* re-render */ });
unsub(); // unsubscribe
```

### Valid store names
`tasks` | `slots` | `scheduleBlocks` | `focusSessions` | `settings` | `gmailConfig` | `aiConfig` | `goals` | `subtasks` | `registeredAiJobs`

### Rules
- Always call `AppState.init()` before any reads
- Never mutate the returned array/object directly — always go through `AppState.update()`
- `updatedAt` is set automatically by `AppState.update()` — do not set it manually

---

## 7. AppShell API

```js
// Toast notification
AppShell.toast('Message', 'success'); // types: info | success | error | warning
AppShell.toast('Message', 'error', 5000); // optional duration ms

// Confirm dialog
AppShell.confirm('Are you sure?', () => { /* confirmed callback */ });

// Theme
AppShell.toggleTheme(); // cycles dark <-> light

// Nav
AppShell.showNav(); // temporarily show the nav bar
```

---

## 8. How to Add a New Page

Follow this checklist exactly. Do not skip steps.

1. **Create `pagename.html`** in project root
   - Copy the shell structure from any existing page (head, nav, bgCanvas, script tags)
   - Set `<body data-page="pagename">`
   - Keep all existing `<link>` tags for CSS
   - Keep all existing `<script>` tags in order (see Section 1)
   - Add your new `<script src="js/pagename.js">` after the existing scripts

2. **Create `js/pagename.js`**
   - Export a `const PageName = { async init() { ... } }` object
   - Call `await AppState.init()` as first line of `init()`
   - Use `AppState.on()` for reactivity

3. **Create `css/pagename.css`** if needed
   - Use only existing tokens from Section 4
   - Add `<link rel="stylesheet" href="css/pagename.css">` to the HTML head

4. **Add nav link** in `css/shell.css` (or the nav HTML partial)
   - Use the existing `.nav-item` class
   - Set `href="pagename.html"`

5. **Register page in router** in `js/app.js` — **only if app.js is unlocked**
   - Add: `if (page === 'pagename') await PageName.init();`
   - If app.js is locked, add an inline `DOMContentLoaded` listener in `pagename.js` instead

6. **Update AGENTS.md** — add new file to Section 1 architecture map and any new IDs to Section 5

---

## 9. How to Add a New AI Job

1. **Create `js/ai-jobs/jobname.js`**
   - Expose: `const JobName = { async run(session) { ... } }`
   - Use `AI.chat()` for conversation, `AI.readFile()` for context, `AppState` for data

2. **Register in `data.json`** under `registeredAiJobs` using this schema:
```json
{
  "jobId": "unique-kebab-id",
  "label": "Human Readable Label",
  "trigger": "planner-sidebar",
  "systemPrompt": "Full system prompt text",
  "userMessageTemplate": "Template with {placeholders}",
  "inputSources": ["tasks", "slots"],
  "outputSchema": { },
  "acceptRejectPerItem": true,
  "lockedFiles": [],
  "addedBy": "ai",
  "addedAt": "ISO timestamp"
}
```

3. **Add trigger UI** — button or menu item at the location specified by `trigger`

4. **Update AGENTS.md Section 1** — add new file to architecture map

---

## 10. Common Mistakes — Read This Before Every Change

### Things that silently break the app
- Renaming any HTML `id` listed in Section 5 — JS queries these by exact string
- Renaming any `data-*` attribute listed in Section 5 — event delegation uses these
- Changing the `keyPath` of any store — breaks IndexedDB schema, data loss
- Adding a `<script>` tag before `js/app.js` — DB not ready yet
- Writing directly to `tokens.css` — write to `user-theme.css` instead
- Calling `DB.get/put` directly in UI code — always go through `AppState`
- Returning partial file content — always return the complete file
- Mutating `AppState.get()` return value directly — use `AppState.update()`

### Things that crash the page
- Removing the `<canvas id="bgCanvas">` element — Backgrounds.init() throws
- Removing `<body data-page="...">` — page router does nothing, modules don't init
- Removing any `<script src="js/app.js">` tag — entire app fails silently
- Syntax errors in any JS file — the whole page goes blank

### Things that lose user data
- Modifying `js/app.js` without unlock — may corrupt DB layer
- Changing store names in `STORES` array in `app.js` — IndexedDB won't find old data
- Clearing `data.json` without a snapshot — unrecoverable in server mode

### Style rules
- Never use `!important` — it breaks the token override cascade
- Never use inline `style=""` for colours or spacing — use CSS classes and tokens
- Never hardcode colour hex values in JS — reference CSS variables via `getComputedStyle`
- Never add `position: fixed` to elements inside scrollable containers

### AI job rules
- Never call Gemini API without checking `aiConfig.geminiKey` exists first
- Always show a loading state while waiting for AI response
- Always wrap AI calls in try/catch and show `AppShell.toast('AI error', 'error')`
- Never auto-apply AI suggestions — always go through accept/reject UI
- Never send the user's `geminiKey` anywhere except `generativelanguage.googleapis.com`

---

## 11. Version System

Versions are stored in `.versions/` at the project root. Each version is a folder containing a copy of `js/`, `css/`, all `*.html` files, and `data.json`.

```js
// Take a snapshot before starting a change session
const snapName = await takeSnapshot('pre-session-' + Date.now());

// If user cancels all changes
await deleteSnapshot(snapName);

// If user accepts at least one change — rename to meaningful name
await fetch(`/api/versions?name=${snapName}&newName=before-habit-tracker`, { method: 'PATCH' });

// List all versions
const versions = await listVersions();

// Restore a version (reloads page)
await restoreVersion('before-habit-tracker');
```

### Version naming convention
- Auto-snapshots: `pre-{jobId}-{unixTimestamp}` e.g. `pre-goal-decomp-1746800000`
- User-saved: any name, sanitised to `[a-zA-Z0-9_\-.]` max 64 chars
- Post-session auto-name: `post-{jobId}-{unixTimestamp}`

---

*Last updated: 2026-05-09. Update this document whenever the architecture changes.*
