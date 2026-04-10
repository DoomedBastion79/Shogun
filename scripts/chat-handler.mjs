/**
 * Kagekuni Assistant — Chat Message Handler
 *
 * Manages the assistant actor, posts thinking/response/error messages,
 * and formats Claude's responses for display in the Foundry chat log.
 */

const MODULE_ID = "kagekuni-assistant";

export class ChatHandler {
  /**
   * Ensure the assistant actor exists (creates one if missing).
   * Called once on "ready" hook, GM-only.
   */
  static async ensureAssistantActor() {
    const actorName = game.settings.get(MODULE_ID, "actorName");
    let actor = game.actors.find((a) => a.name === actorName);

    if (!actor) {
      actor = await Actor.create({
        name: actorName,
        type: "npc",
        img: "icons/magic/perception/eye-ringed-glow-angry-small-teal.webp",
      });
      console.log(`${MODULE_ID} | Created assistant actor: ${actorName}`);
    }

    this._actorId = actor.id;
  }

  /**
   * Post a "thinking" placeholder message in chat.
   * Returns the ChatMessage document so it can be updated later.
   */
  static async postThinking() {
    const actor = game.actors.get(this._actorId);
    const label = game.i18n.localize("KAGEKUNI.Chat.Thinking");

    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div class="kagekuni-thinking">${label}</div>`,
      whisper: [game.user.id], // GM-only whisper during processing
      flags: { [MODULE_ID]: { isAssistant: true } },
    });
  }

  /**
   * Replace a thinking message with the actual assistant response.
   */
  static async replaceWithResponse(thinkingMsg, answer, meta = {}) {
    const formatted = this._formatResponse(answer);

    let contextNote = "";
    if (meta.contextCount) {
      contextNote = `<div class="kagekuni-context-info">${meta.contextCount} journal entries referenced`;
      if (meta.tokensUsed) {
        contextNote += ` · ${meta.tokensUsed.toLocaleString()} input tokens`;
      }
      contextNote += `</div>`;
    }

    await thinkingMsg.update({
      content: `<div class="kagekuni-response">${formatted}${contextNote}</div>`,
      whisper: [], // Make visible to all players (or keep whispered if you prefer)
    });
  }

  /**
   * Replace a thinking message with an error notice (GM-only).
   */
  static async replaceWithError(thinkingMsg, errorMessage) {
    const label = game.i18n.localize("KAGEKUNI.Chat.Error");
    await thinkingMsg.update({
      content: `<div class="kagekuni-error">${label}<br><small>${errorMessage}</small></div>`,
    });
  }

  /**
   * Convert markdown-ish response text to safe HTML for Foundry chat.
   * Handles: paragraphs, bold, italic, inline code, line breaks.
   * Does NOT handle full markdown — just the patterns Claude commonly uses.
   */
  static _formatResponse(text) {
    if (!text) return "<p><em>No response.</em></p>";

    // Escape HTML entities first
    let safe = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Bold: **text**
    safe = safe.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

    // Italic: *text* (but not inside bold)
    safe = safe.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, "<em>$1</em>");

    // Inline code: `text`
    safe = safe.replace(/`([^`]+?)`/g, "<code>$1</code>");

    // Paragraph breaks (double newline)
    safe = safe
      .split(/\n{2,}/)
      .map((p) => `<p>${p.trim()}</p>`)
      .join("");

    // Single newlines within paragraphs → <br>
    safe = safe.replace(/([^>])\n([^<])/g, "$1<br>$2");

    return safe;
  }
}
