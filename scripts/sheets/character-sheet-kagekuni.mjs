/**
 * Kagekuni Character Sheet — extends the dnd5e 5.3.x default character sheet
 * and injects a consolidated Resources banner into the Details tab, above the
 * skills / saving-throws / background section.
 *
 * The panel surfaces (auto-detected, no favorites required):
 *   - Legacy resources:  system.resources.{primary, secondary, tertiary}
 *                        (Luck Points live in the secondary resource by
 *                        convention; shown whenever the slot has *any* data
 *                        — max > 0, value > 0, or a custom label — which is
 *                        more permissive than dnd5e's own favorites block)
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

      // 1. Legacy resources — show any slot that has *any* data set: a max,
      //    a current value, or a custom label. This is more permissive than
      //    dnd5e's own favorites block (which requires both label AND max),
      //    so a Luck Pool the player has labeled but not yet set a max on
      //    still surfaces here.
      const LEGACY_FALLBACK_LABELS = {
        primary: "Primary",
        secondary: "Luck Points",
        tertiary: "Tertiary"
      };
      const legacy = [];
      const resources = this.actor.system.resources ?? {};
      for (const [key, r] of Object.entries(resources)) {
        if (!r) continue;
        const max = Number(r.max) || 0;
        const value = Number(r.value) || 0;
        const label = typeof r.label === "string" ? r.label.trim() : "";
        if (!max && !value && !label) continue;
        legacy.push({
          id: `resources.${key}`,
          label: label || LEGACY_FALLBACK_LABELS[key] || key,
          value,
          max,
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
     * Render the resources banner and insert it into the Details tab, right
     * above the skills / saves / background grid. Replaces any previous
     * instance so repeated renders don't stack.
     */
    async #injectResourcesPanel(context) {
      const root = this.element;

      // Bail if the details tab hasn't rendered yet (e.g. another tab is
      // active and details is lazily rendered). Try again on next render.
      const details = root.querySelector('[data-application-part="details"]');
      if (!details) return;

      // Skip entirely when there's nothing to show — no point rendering an
      // empty banner taking vertical space above skills.
      const groups = context.kagekuni?.resourceGroups ?? [];
      if (!groups.length) {
        root.querySelectorAll(".kagekuni-resources").forEach((el) => el.remove());
        return;
      }

      const html = await foundry.applications.handlebars.renderTemplate(
        RESOURCES_TEMPLATE,
        { groups, empty: false }
      );

      // Remove any stale instance anywhere in the sheet (handles the case
      // where a prior version put the panel in the sidebar).
      root.querySelectorAll(".kagekuni-resources").forEach((el) => el.remove());

      // The details part's template emits:
      //   <section class="tab" data-tab="details">
      //     {{ability scores}}
      //     <div class="col-2"><div class="left"/> <div class="right"/></div>
      //   </section>
      // The ability-scores partial also contains `.col-2` descendants, so a
      // naive `details.querySelector(".col-2")` lands inside the ability
      // block and the banner ends up stuffed into one of its columns. Anchor
      // specifically to the grid that's a *direct child* of the tab section.
      const tabSection = details.querySelector('section[data-tab="details"]')
        ?? details.querySelector("section.tab");
      const anchor = tabSection?.querySelector(":scope > .col-2");

      if (anchor) {
        anchor.insertAdjacentHTML("beforebegin", html);
      } else if (tabSection) {
        // No grid found — drop it at the top of the tab content so it still
        // spans full width rather than getting nested in an inner cell.
        tabSection.insertAdjacentHTML("afterbegin", html);
      } else {
        details.insertAdjacentHTML("afterbegin", html);
      }

      this.#activatePanelListeners(root);
    }

    /**
     * Wire click handlers on the injected panel for spending/restoring uses.
     */
    #activatePanelListeners(root) {
      const panel = root.querySelector(".kagekuni-resources");
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
