/**
 * Kagekuni Assistant — Journal Context Extraction
 *
 * Gathers journal entries from the Foundry world and formats them
 * as structured context for the Claude API system prompt.
 *
 * Supports:
 *  - Folder-based filtering (only include journals in a named folder)
 *  - Max entry limits (to control token usage)
 *  - Multi-page journal entries (concatenates all pages)
 *  - Text extraction from HTML content
 */

const MODULE_ID = "kagekuni-assistant";

export class JournalContext {
  /**
   * Gather journal entries and return them as an array of
   * { name, folder, content } objects ready for the proxy.
   */
  static gather() {
    const maxEntries = game.settings.get(MODULE_ID, "maxContextEntries");
    const folderFilter = game.settings.get(MODULE_ID, "journalFolder").trim();

    let entries = Array.from(game.journal);

    // ── Folder filtering ──────────────────────────────────────
    if (folderFilter) {
      const targetFolder = game.folders.find(
        (f) =>
          f.type === "JournalEntry" &&
          f.name.toLowerCase() === folderFilter.toLowerCase()
      );

      if (targetFolder) {
        const folderIds = this._getFolderAndDescendants(targetFolder);
        entries = entries.filter((e) => folderIds.has(e.folder?.id));
      } else {
        console.warn(
          `${MODULE_ID} | Journal folder "${folderFilter}" not found — using all journals`
        );
      }
    }

    // ── Sort by most recently modified, then cap ──────────────
    entries.sort(
      (a, b) => (b._source?.timestamp ?? 0) - (a._source?.timestamp ?? 0)
    );
    entries = entries.slice(0, maxEntries);

    // ── Extract text content from each entry ──────────────────
    return entries.map((entry) => ({
      name: entry.name,
      folder: entry.folder?.name || "Uncategorized",
      content: this._extractEntryText(entry),
    }));
  }

  /**
   * Get all folder IDs for a folder and its descendants (recursive).
   */
  static _getFolderAndDescendants(folder) {
    const ids = new Set([folder.id]);
    for (const child of folder.children || []) {
      if (child.folder) {
        for (const id of this._getFolderAndDescendants(child.folder)) {
          ids.add(id);
        }
      }
    }
    return ids;
  }

  /**
   * Extract plain text from a JournalEntry's pages.
   * Handles both the v10+ multi-page structure and legacy content field.
   */
  static _extractEntryText(entry) {
    // v10+ : JournalEntry has .pages collection
    if (entry.pages?.size > 0) {
      const parts = [];
      for (const page of entry.pages) {
        if (page.type === "text" && page.text?.content) {
          parts.push(
            `## ${page.name}\n${this._htmlToText(page.text.content)}`
          );
        }
      }
      return parts.join("\n\n");
    }

    // Legacy fallback: single content field
    if (entry.content) {
      return this._htmlToText(entry.content);
    }

    return "";
  }

  /**
   * Minimal HTML-to-text conversion. Strips tags, decodes entities,
   * preserves paragraph breaks. Runs entirely client-side.
   */
  static _htmlToText(html) {
    if (!html) return "";

    // Use a temporary DOM element to parse
    const temp = document.createElement("div");
    temp.innerHTML = html;

    // Replace <br>, <p>, <div>, <li> boundaries with newlines
    for (const tag of ["br", "p", "div", "li", "h1", "h2", "h3", "h4"]) {
      for (const el of temp.querySelectorAll(tag)) {
        el.insertAdjacentText("afterend", "\n");
      }
    }

    // Extract text and clean up whitespace
    let text = temp.textContent || "";
    text = text.replace(/\n{3,}/g, "\n\n").trim();
    return text;
  }
}
