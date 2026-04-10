/**
 * Kagekuni Assistant — FoundryVTT Module Entry Point
 *
 * Registers settings, hooks into chat, and coordinates between
 * journal context gathering and the Claude API proxy.
 */

import { KagekuniSettings } from "./settings.mjs";
import { JournalContext } from "./journal-context.mjs";
import { ChatHandler } from "./chat-handler.mjs";
import { ProxyClient } from "./proxy-client.mjs";

const MODULE_ID = "kagekuni-assistant";

/* ------------------------------------------------------------------ */
/*  Initialization                                                     */
/* ------------------------------------------------------------------ */

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initializing Kagekuni Assistant`);
  KagekuniSettings.register();
});

Hooks.once("ready", () => {
  console.log(`${MODULE_ID} | Ready`);

  // Only the GM runs the assistant (prevents duplicate responses)
  if (!game.user.isGM) return;

  ChatHandler.ensureAssistantActor();
});

/* ------------------------------------------------------------------ */
/*  Chat Hook — intercept /ask and /oracle commands                    */
/* ------------------------------------------------------------------ */

Hooks.on("chatMessage", (chatLog, messageText, chatData) => {
  // Only the GM processes commands
  if (!game.user.isGM) return;

  const trimmed = messageText.trim();

  // Match /ask <question> or /oracle <question>
  const askMatch = trimmed.match(/^\/(ask|oracle)\s+(.+)$/is);
  if (!askMatch) return;

  const command = askMatch[1].toLowerCase();
  const question = askMatch[2].trim();

  // Prevent the default chat message from being created
  // (returning false from chatMessage hook suppresses it)
  handleAssistantQuery(command, question, chatData);
  return false;
});

/* ------------------------------------------------------------------ */
/*  Core Query Pipeline                                                */
/* ------------------------------------------------------------------ */

async function handleAssistantQuery(command, question, chatData) {
  const proxyUrl = game.settings.get(MODULE_ID, "proxyUrl");
  if (!proxyUrl) {
    ui.notifications.error(
      "Kagekuni Assistant: No proxy URL configured. Set it in Module Settings."
    );
    return;
  }

  // 1. Post a "thinking" message
  const thinkingMsg = await ChatHandler.postThinking();

  try {
    // 2. Gather journal context
    const journalContext = JournalContext.gather();

    // 3. Gather scene context (current scene name + notes)
    const sceneContext = getSceneContext();

    // 4. Build the request payload
    const payload = {
      question,
      command,
      journalContext,
      sceneContext,
      speaker: chatData.speaker?.alias || game.user.name,
    };

    // 5. Call the proxy
    const response = await ProxyClient.query(proxyUrl, payload);

    // 6. Replace "thinking" message with the actual response
    await ChatHandler.replaceWithResponse(thinkingMsg, response.answer, {
      contextCount: journalContext.length,
      tokensUsed: response.usage?.input_tokens,
    });
  } catch (err) {
    console.error(`${MODULE_ID} | Query failed:`, err);
    await ChatHandler.replaceWithError(thinkingMsg, err.message);
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getSceneContext() {
  const scene = game.scenes?.active;
  if (!scene) return null;
  return {
    name: scene.name,
    notes: scene.notes || "",
    // Include any scene-level journal if linked
    journalId: scene.journal?.id || null,
  };
}
