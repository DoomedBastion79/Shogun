/**
 * Kagekuni Character Sheet — extends the dnd5e 5.3.x default character sheet
 * and injects a consolidated Resources panel into the sidebar, positioned
 * below the favorites block.
 *
 * The panel surfaces (auto-detected, no favorites required):
 *   - Legacy resources:  system.resources.{primary, secondary, tertiary}
 *                        (Luck Points live in the secondary resource by
 *                        convention; shown whenever max > 0, even if no label
 *                        is set)
 *   - Class features:    Items of type "feat" whose system.uses.max > 0
 *
 * Registered as a selectable sheet — users opt in per actor via
 * Actor → "Sheet" header button. The dnd5e default sheet remains unchanged.
 */

const MODULE_ID = "kagekuni-assistant";
const RESOURCES_TEMPLATE = `modules/${MODULE_ID}/templates/actors/resources-panel.hbs`;

/**
 * Resolve the dnd5e CharacterActorSheet class at registration time.
 * The dnd5e system exposes it on the global `dnd5e` namespace once ready.
 */
export function getCharacterSheetClass() {
  const cls = globalThis.dnd5e?.applications?.actor?.CharacterActorSheet;
  if (!cls) {
    throw new Error(
      `${MODULE_ID} | dnd5e.applications.actor.CharacterActorSheet not found. ` +
        `Is the dnd5e system active?`
    );
  }
  return cls;
}

/**
 * Build the Kagekuni sheet subclass. Deferred until after dnd5e's init so the
 * parent class is guaranteed to exist.
 */
export function defineCharacterSheet() {
  const CharacterActorSheet = getCharacterSheetClass();

  return class CharacterSheetKagekuni extends CharacterActorSheet {
    /** @override */
    static DEFAULT_OPTIONS = {
      classes: ["kagekuni-character"]
    };

    /* ------------------------------------------------------------ */
    /*  Context preparation                                          */
    /* ------------------------------------------------------------ */

    /** @inheritDoc */
    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      context.kagekuni = { resourceGroups: this._prepareKagekuniResources() };
      return context;
    }

    /**
     * Gather all resources worth surfacing, grouped for display.
     * @returns {Array<{key: string, label: string, items: object[]}>}
     * @protected
     */
    _prepareKagekuniResources() {
      const groups = [];

      // 1. Legacy resources — show any slot with max > 0. Label is resolved
      //    with sensible fallbacks so conventional pools (Luck Pool =
      //    secondary) surface even when the actor hasn't set an explicit label.
      const LEGACY_FALLBACK_LABELS = {
        primary: "Primary",
        secondary: "Luck Points",
        tertiary: "Tertiary"
      };
      const legacy = [];
      const resources = this.actor.system.resources ?? {};
      for (const [key, r] of Object.entries(resources)) {
        if (!r || !(r.max > 0)) continue;
        legacy.push({
          id: `resources.${key}`,
          label: r.label || LEGACY_FALLBACK_LABELS[key] || key,
          value: Number(r.value) || 0,
          max: Number(r.max) || 0,
          recover: [r.sr ? "SR" : null, r.lr ? "LR" : null].filter(Boolean).join(" / "),
          path: `system.resources.${key}.value`,
          kind: "legacy",
          img: null
        });
      }
      if (legacy.length) {
        groups.push({ key: "legacy", label: "Pools", items: legacy });
      }

      // 2. Class features with limited uses. Mundane item uses are intentionally
      //    excluded — the dnd5e sheet already surfaces them via favorites and
      //    the inventory tab, and duplicating them here just adds noise.
      const classFeats = [];
      for (const item of this.actor.items) {
        if (item.type !== "feat") continue;
        const uses = item.system?.uses;
        const max = Number(uses?.max) || 0;
        if (!max) continue;
        classFeats.push({
          id: item.id,
          label: item.name,
          img: item.img,
          value: Number(uses.value) || 0,
          max,
          recover: (uses.recovery ?? [])
            .map((rec) => (rec.period ? String(rec.period).toUpperCase() : null))
            .filter(Boolean)
            .join(" / "),
          path: null, // items use their own spend/restore flow, not direct edits
          kind: "feat",
          itemUuid: item.uuid
        });
      }
      if (classFeats.length) {
        groups.push({ key: "class", label: "Class Features", items: classFeats });
      }

      return groups;
    }

    /* ------------------------------------------------------------ */
    /*  Rendering hook                                               */
    /* ------------------------------------------------------------ */

    /** @inheritDoc */
    async _onRender(context, options) {
      await super._onRender(context, options);
      await this.#injectResourcesPanel(context);
    }

    /**
     * Render the resources panel and insert it into the sidebar part. Replaces
     * any previous instance so repeated renders don't stack.
     */
    async #injectResourcesPanel(context) {
      const sidebar = this.element.querySelector('[data-application-part="sidebar"]');
      if (!sidebar) return;

      const groups = context.kagekuni?.resourceGroups ?? [];
      const html = await foundry.applications.handlebars.renderTemplate(
        RESOURCES_TEMPLATE,
        { groups, empty: groups.length === 0 }
      );

      const existing = sidebar.querySelector(".kagekuni-resources");
      if (existing) {
        existing.outerHTML = html;
      } else {
        // Anchor the panel below favorites. Fall back to appending to the
        // sidebar if the favorites block isn't present on this sheet layout.
        const favorites =
          sidebar.querySelector('[data-tab="favorites"]') ??
          sidebar.querySelector(".favorites");
        if (favorites) {
          favorites.insertAdjacentHTML("afterend", html);
        } else {
          sidebar.insertAdjacentHTML("beforeend", html);
        }
      }

      this.#activatePanelListeners(sidebar);
    }

    /**
     * Wire click handlers on the injected panel for spending/restoring uses.
     */
    #activatePanelListeners(sidebar) {
      const panel = sidebar.querySelector(".kagekuni-resources");
      if (!panel) return;

      panel.addEventListener("click", async (event) => {
        const button = event.target.closest("[data-kagekuni-action]");
        if (!button) return;
        event.preventDefault();

        const action = button.dataset.kagekuniAction;
        const entry = button.closest("[data-kind]");
        if (!entry) return;

        const kind = entry.dataset.kind;
        const delta = action === "increment" ? 1 : action === "decrement" ? -1 : 0;
        if (!delta) return;

        if (kind === "legacy") {
          const path = entry.dataset.path;
          if (!path) return;
          const current = Number(foundry.utils.getProperty(this.actor, path)) || 0;
          const maxPath = path.replace(/\.value$/, ".max");
          const max = Number(foundry.utils.getProperty(this.actor, maxPath)) || 0;
          const next = Math.clamp(current + delta, 0, max);
          if (next !== current) await this.actor.update({ [path]: next });
        } else {
          const uuid = entry.dataset.itemUuid;
          if (!uuid) return;
          const item = await fromUuid(uuid);
          if (!item) return;
          const uses = item.system.uses;
          const max = Number(uses?.max) || 0;
          const spent = Number(uses?.spent) || 0;
          // value = max - spent; +1 use -> spent - 1; -1 use -> spent + 1
          const nextSpent = Math.clamp(spent - delta, 0, max);
          if (nextSpent !== spent) await item.update({ "system.uses.spent": nextSpent });
        }
      });
    }
  };
}
