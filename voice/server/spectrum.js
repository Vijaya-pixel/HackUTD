// Shared Spectrum (Stable) app instance: real-time, two-way iMessage.
// Spectrum replaces the old Beta polling approach — inbound messages arrive
// instantly over `app.messages`, and we can create a DM ourselves instead of
// waiting for the target to text first.
// Docs: https://docs.photon.codes/docs/spectrum-ts/getting-started.md

import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";

const { SPECTRUM_PROJECT_ID, SPECTRUM_PROJECT_SECRET } = process.env;

export const spectrumConfigured = Boolean(SPECTRUM_PROJECT_ID && SPECTRUM_PROJECT_SECRET);

let appPromise = null;

// Lazily starts (once) and returns the shared Spectrum app.
export function getSpectrum() {
  if (!spectrumConfigured) return null;
  appPromise ??= Spectrum({
    projectId: SPECTRUM_PROJECT_ID,
    projectSecret: SPECTRUM_PROJECT_SECRET,
    providers: [imessage.config()],
  });
  return appPromise;
}

// Resolves (or creates) the DM space for a phone number / iMessage email.
export async function dmFor(handle) {
  const app = await getSpectrum();
  const im = imessage(app);
  const user = await im.user(handle);
  return im.space.create(user);
}

// Runs `onMessage(space, message)` for every inbound text message, forever.
// Call once at startup; it never resolves on its own.
export async function listen(onMessage) {
  const app = await getSpectrum();
  if (!app) return;
  for await (const [space, message] of app.messages) {
    if (message.platform !== "imessage") continue;
    if (message.content?.type !== "text") continue;
    try {
      await onMessage(space, message);
    } catch (e) {
      console.error("spectrum: handler failed", e);
    }
  }
}
