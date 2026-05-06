/**
 * Stateful checklist checkboxes for Kagekuni journal pages.
 *
 * The build pipeline emits markdown checklist items as
 *   <li class="kg-task" data-done="false|true" data-task-key="<hash>">…</li>
 * with the data-task-key being a stable FNV-1a hash of the item's plain text
 * (see assistant/tools/lib/enrich-html.mjs).
 *
 * This script:
 *   1. On journal page render, applies persisted state from the page's
 *      "tasks" flag to every li.kg-task, overwriting the build-time default.
 *   2. On click of a li.kg-task (GM-only), toggles state and writes the new
 *      value back to the same flag. Foundry re-renders the sheet, which
 *      runs (1) again with the updated value.
 *
 * Flag layout: kagekuni-assistant.tasks = { "<task-key>": true, ... }
 * Only "true" entries are stored — absence implies the build-time default.
 */

const MODULE_ID = "kagekuni-assistant";
const FLAG_KEY = "tasks";

/**
 * Apply persisted task state to every kg-task in a rendered DOM root.
 * @param {HTMLElement} root - sheet root element
 * @param {ClientDocument} page - the JournalEntryPage document
 */
function applyTaskState(root, page) {
  if (!root || !page) return;
  const tasks = page.getFlag(MODULE_ID, FLAG_KEY) || {};
  const items = root.querySelectorAll("li.kg-task[data-task-key]");
  for (const li of items) {
    const key = li.dataset.taskKey;
    if (!key) continue;
    if (Object.prototype.hasOwnProperty.call(tasks, key)) {
      li.dataset.done = tasks[key] ? "true" : "false";
    }
  }
}

/**
 * Bind a delegated click handler that toggles task state on click.
 * Re-binding is idempotent — we tag the root with a marker dataset.
 */
function bindClickHandler(root, page) {
  if (!root || !page) return;
  if (root.dataset.kgTasksBound === "1") return;
  root.dataset.kgTasksBound = "1";

  root.addEventListener("click", async (event) => {
    const li = event.target.closest("li.kg-task[data-task-key]");
    if (!li || !root.contains(li)) return;
    if (!game.user.isGM) return;

    const key = li.dataset.taskKey;
    if (!key) return;

    // Optimistic UI — flip immediately, persist after.
    const wasDone = li.dataset.done === "true";
    const nextDone = !wasDone;
    li.dataset.done = nextDone ? "true" : "false";

    try {
      const current = page.getFlag(MODULE_ID, FLAG_KEY) || {};
      const next = { ...current };
      const buildDefault = (li.dataset.buildDefault ??= wasDone ? "true" : "false");
      // Only store overrides — if the new state matches the build default,
      // remove the entry so future build changes can flow through.
      if ((nextDone ? "true" : "false") === buildDefault) {
        delete next[key];
      } else {
        next[key] = nextDone;
      }
      await page.setFlag(MODULE_ID, FLAG_KEY, next);
    } catch (err) {
      console.error(`${MODULE_ID} | Failed to persist task state:`, err);
      // Revert optimistic flip on failure.
      li.dataset.done = wasDone ? "true" : "false";
      ui.notifications?.error("Could not save checklist state. See console.");
    }
  });
}

/**
 * Capture build-time default once per render so we know whether a click
 * toggles back to the default (drop the flag) or away from it (store it).
 */
function captureBuildDefaults(root) {
  if (!root) return;
  const items = root.querySelectorAll("li.kg-task[data-task-key]");
  for (const li of items) {
    if (li.dataset.buildDefault === undefined) {
      li.dataset.buildDefault = li.dataset.done === "true" ? "true" : "false";
    }
  }
}

function handleRender(app, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  const page = app?.document;
  if (!page) return;
  captureBuildDefaults(root);
  applyTaskState(root, page);
  bindClickHandler(root, page);
}

Hooks.on("renderJournalEntryPageSheet", handleRender);
// Some Foundry versions/page subclasses fire a more specific hook name.
Hooks.on("renderJournalTextPageSheet", handleRender);
Hooks.on("renderJournalEntryPageProseMirrorSheet", handleRender);

export const KagekuniTaskCheckboxes = { applyTaskState };
