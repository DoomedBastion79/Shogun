/**
 * Kagekuni Character Sheet — extends the dnd5e 5.3.x default character sheet
 * and injects a consolidated Resources panel into the left-rail sidebar.
 *
 * The panel surfaces (auto-detected, no favorites required):
 *   - Legacy resources:  system.resources.{primary, secondary, tertiary}
 *                        (the Luck Pool is the secondary resource by convention)
 *   - Class features:    Items of type "feat" whose system.uses.max > 0
 *   - Item uses:         Non-feat items whose system.uses.max > 0
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

      // 1. Legacy resources — only those with a label AND a nonzero max.
      const legacy = [];
      const resources = this.actor.system.resources ?? {};
      for (const [key, r] of Object.entries(resources)) {
        if (!r?.label || !(r.max > 0)) continue;
        legacy.push({
          id: `resources.${key}`,
          label: r.label,
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

      // 2 + 3. Items with limited uses — split feats (class features) from the rest.
      const classFeats = [];
      const itemUses = [];
      for (const item of this.actor.items) {
        const uses = item.system?.uses;
        const max = Number(uses?.max) || 0;
        if (!max) continue;
        const entry = {
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
          kind: item.type === "feat" ? "feat" : "item",
          itemUuid: item.uuid
        };
        if (item.type === "feat") classFeats.push(entry);
        else itemUses.push(entry);
      }
      if (classFeats.length) {
        groups.push({ key: "class", label: "Class Features", items: classFeats });
      }
      if (itemUses.length) {
        groups.push({ key: "items", label: "Item Uses", items: itemUses });
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
        // Insert after the portrait block if present, else prepend.
        const portrait = sidebar.querySelector(".portrait");
        if (portrait?.parentElement === sidebar) {
          portrait.insertAdjacentHTML("afterend", html);
        } else {
          sidebar.insertAdjacentHTML("afterbegin", html);
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
