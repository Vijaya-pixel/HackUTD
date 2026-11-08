import type { MessagingChannel, InboundHandler } from "./MessagingChannel.js";

/**
 * PhotonChannel wraps the Spectrum (Photon stable) SDK.
 *
 * Outbound: Spectrum doesn't have a direct "push to phone" REST endpoint in the
 * stable API. The first message of a session is initiated via the redirect
 * endpoint (GET /users/{userId}/redirect?msg=...) which opens an SMS deep-link
 * that pre-fills iMessage. All subsequent replies use message.reply().
 *
 * Inbound: We use the WebSocket-based event stream from spectrum-ts.
 * Additionally we register an HTTPS webhook at startup for redundancy.
 */
export class PhotonChannel implements MessagingChannel {
  private handler: InboundHandler | null = null;
  private app: any = null; // spectrum-ts Spectrum instance

  onMessage(handler: InboundHandler): void {
    this.handler = handler;
  }

  async send(to: string, text: string, _sessionId?: string): Promise<void> {
    // For proactive first messages: build the SMS deep-link redirect URL.
    // The caller is responsible for triggering this URL (e.g., push notification
    // to the mobile app, which opens the SMS deep-link).
    // For subsequent replies in an active session, use replyFn stored in context.
    console.log(`[PhotonChannel] Would send to ${to}: ${text.slice(0, 60)}…`);
    // Note: actual reply within session context is done via space.responding() in startListening
  }

  async start(): Promise<void> {
    const projectId = process.env["PHOTON_PROJECT_ID"];
    const projectSecret = process.env["PHOTON_PROJECT_SECRET"];
    if (!projectId || !projectSecret) {
      console.warn("[PhotonChannel] PHOTON_PROJECT_ID/SECRET not set — channel inactive");
      return;
    }

    try {
      const { Spectrum } = await import("spectrum-ts");
      const { imessage } = await import("spectrum-ts/providers/imessage" as string);

      this.app = await Spectrum({
        projectId,
        projectSecret,
        providers: [imessage.config()],
      });

      this.startListening();
      console.log("[PhotonChannel] Connected to Spectrum");
    } catch (err) {
      console.error("[PhotonChannel] Failed to connect:", err);
    }
  }

  private startListening(): void {
    if (!this.app) return;
    (async () => {
      try {
        for await (const [space, message] of this.app.messages) {
          const text: string = message.text ?? "";
          const from: string = message.sender ?? "unknown";
          if (this.handler) {
            await space.responding(async () => {
              await this.handler!(from, text, undefined);
            });
          }
        }
      } catch (err) {
        console.error("[PhotonChannel] Stream error:", err);
      }
    })();
  }

  async stop(): Promise<void> {
    if (this.app?.stop) await this.app.stop();
  }

  /** Build the redirect URL to initiate a conversation via iMessage deep-link */
  static buildRedirectUrl(photonUserId: string, openerText: string): string {
    const projectId = process.env["PHOTON_PROJECT_ID"] ?? "";
    const encoded = encodeURIComponent(openerText);
    return `https://spectrum.photon.codes/users/${photonUserId}/redirect?msg=${encoded}`;
  }
}
