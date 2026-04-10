/**
 * Kagekuni Assistant — Proxy Client
 *
 * Sends requests to the local proxy server and returns parsed responses.
 * Handles timeout, retries, and error formatting.
 */

const MODULE_ID = "kagekuni-assistant";

export class ProxyClient {
  /**
   * Send a query to the proxy server.
   *
   * @param {string} proxyUrl  - Base URL of the proxy (e.g. http://localhost:3100)
   * @param {object} payload   - { question, command, journalContext, sceneContext, speaker }
   * @returns {Promise<{ answer: string, usage?: object }>}
   */
  static async query(proxyUrl, payload) {
    const url = `${proxyUrl.replace(/\/+$/, "")}/api/ask`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000); // 60s timeout

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "Unknown error");
        throw new Error(`Proxy returned ${response.status}: ${errorBody}`);
      }

      return await response.json();
    } catch (err) {
      if (err.name === "AbortError") {
        throw new Error("Request timed out after 60 seconds.");
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Health check — verify the proxy is reachable.
   *
   * @param {string} proxyUrl
   * @returns {Promise<boolean>}
   */
  static async healthCheck(proxyUrl) {
    try {
      const response = await fetch(
        `${proxyUrl.replace(/\/+$/, "")}/api/health`,
        {
          method: "GET",
          signal: AbortSignal.timeout(5000),
        }
      );
      return response.ok;
    } catch {
      return false;
    }
  }
}
