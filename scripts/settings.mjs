/**
 * Kagekuni Assistant — Module Settings Registration
 */

const MODULE_ID = "kagekuni-assistant";

export class KagekuniSettings {
  static register() {
    // Proxy server URL
    game.settings.register(MODULE_ID, "proxyUrl", {
      name: game.i18n.localize("KAGEKUNI.Settings.ProxyUrl.Name"),
      hint: game.i18n.localize("KAGEKUNI.Settings.ProxyUrl.Hint"),
      scope: "world",
      config: true,
      type: String,
      default: "http://localhost:3100",
    });

    // Actor name for the assistant's chat persona
    game.settings.register(MODULE_ID, "actorName", {
      name: game.i18n.localize("KAGEKUNI.Settings.ActorName.Name"),
      hint: game.i18n.localize("KAGEKUNI.Settings.ActorName.Hint"),
      scope: "world",
      config: true,
      type: String,
      default: "The Oracle",
    });

    // Optional folder filter for journal context
    game.settings.register(MODULE_ID, "journalFolder", {
      name: game.i18n.localize("KAGEKUNI.Settings.JournalFolder.Name"),
      hint: game.i18n.localize("KAGEKUNI.Settings.JournalFolder.Hint"),
      scope: "world",
      config: true,
      type: String,
      default: "",
    });

    // Max journal entries to send as context
    game.settings.register(MODULE_ID, "maxContextEntries", {
      name: game.i18n.localize("KAGEKUNI.Settings.MaxContextEntries.Name"),
      hint: game.i18n.localize("KAGEKUNI.Settings.MaxContextEntries.Hint"),
      scope: "world",
      config: true,
      type: Number,
      default: 20,
      range: {
        min: 5,
        max: 100,
        step: 5,
      },
    });
  }
}
