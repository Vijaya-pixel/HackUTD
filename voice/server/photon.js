// Sends scam alerts over iMessage with the Photon 2.0 (Beta) API.
// Docs: https://photon.codes/docs/beta/get-started/imessage.md
//
// A shared Photon line cannot send the first message, so the alert recipient
// must have texted the line at least once. We find their latest message to
// get the conversation (space) and our agent user ID, then send into it.
//
// If credentials are missing or a call fails, we return { status: "simulated" }
// with the text, so the demo never breaks on stage.

import { Photon, ApiError } from "@photon-ai/api";
import { randomUUID } from "node:crypto";

const { PHOTON_API_KEY, PHOTON_PROJECT_ID, PHOTON_ALERT_RECIPIENT } = process.env;

export const photonConfigured = Boolean(
  PHOTON_API_KEY && PHOTON_PROJECT_ID && PHOTON_ALERT_RECIPIENT &&
  !PHOTON_API_KEY.includes("REPLACE") && PHOTON_PROJECT_ID.startsWith("pho_prj_") && !PHOTON_PROJECT_ID.includes("REPLACE")
);

const photon = photonConfigured
  ? new Photon({ headers: { Authorization: `Bearer ${PHOTON_API_KEY}` } })
  : null;

let cachedConversation = null;

async function findConversation() {
  if (cachedConversation) return cachedConversation;
  const createdSince = new Date(Date.now() - 30 * 864e5).toISOString();
  let pageToken;
  for (let i = 0; i < 5; i++) {
    const page = await photon.projects.listMessages({
      path: { id: PHOTON_PROJECT_ID },
      query: { createdSince, direction: "received", order: "desc", pageSize: 100, platform: "imessage", ...(pageToken ? { pageToken } : {}) },
    });
    const m = page.items.find((x) => x.sentBy?.handle === PHOTON_ALERT_RECIPIENT && x.receivedBy?.kind === "agent");
    if (m) {
      cachedConversation = { spaceId: m.space.id, senderId: m.receivedBy.id };
      return cachedConversation;
    }
    pageToken = page.nextPageToken;
    if (!pageToken) break;
  }
  return null;
}

// Send a text to any participant who has already texted the Photon line.
// Used by the scam drill. Returns { status: "sent" | "simulated", ... }.
const conversations = new Map(); // handle -> { spaceId, senderId }

async function findConversationFor(handle) {
  if (conversations.has(handle)) return conversations.get(handle);
  const createdSince = new Date(Date.now() - 30 * 864e5).toISOString();
  let pageToken;
  for (let i = 0; i < 5; i++) {
    const page = await photon.projects.listMessages({
      path: { id: PHOTON_PROJECT_ID },
      query: { createdSince, direction: "received", order: "desc", pageSize: 100, platform: "imessage", ...(pageToken ? { pageToken } : {}) },
    });
    const m = page.items.find((x) => x.sentBy?.handle === handle && x.receivedBy?.kind === "agent");
    if (m) {
      const conv = { spaceId: m.space.id, senderId: m.receivedBy.id };
      conversations.set(handle, conv);
      return conv;
    }
    pageToken = page.nextPageToken;
    if (!pageToken) break;
  }
  return null;
}

// Newest-first incoming texts from `handle` to our agent, since `sinceIso`
// (exclusive). Used to detect replies for the scripted conversation drill.
export async function repliesSince(handle, sinceIso) {
  if (!photon) return [];
  const page = await photon.projects.listMessages({
    path: { id: PHOTON_PROJECT_ID },
    query: { createdSince: sinceIso, direction: "received", order: "asc", pageSize: 50, platform: "imessage" },
  });
  return page.items.filter((x) => x.sentBy?.handle === handle && x.receivedBy?.kind === "agent" && x.createdAt > sinceIso);
}

export async function sendTo(handle, text, idempotencyKey = randomUUID()) {
  if (!photon || !PHOTON_API_KEY || !PHOTON_PROJECT_ID?.startsWith("pho_prj_")) {
    return { status: "simulated", reason: "Photon credentials not set", text };
  }
  try {
    const conv = await findConversationFor(handle);
    if (!conv) return { status: "simulated", reason: `${handle} has not texted the Photon line yet`, text };
    await photon.projects.sendMessage({
      path: { id: PHOTON_PROJECT_ID },
      headers: { "idempotency-key": `drill:${idempotencyKey}` },
      body: { spaceId: conv.spaceId, senderId: conv.senderId, content: { type: "text", format: "plain", text } },
    });
    return { status: "sent", text };
  } catch (error) {
    const reason = error instanceof ApiError
      ? `Photon API error ${error.status} (request ${error.requestId ?? "unknown"})`
      : "Photon request failed";
    console.error(reason);
    return { status: "simulated", reason, text };
  }
}

export async function sendAlert(text) {
  if (!photonConfigured) {
    return { status: "simulated", reason: "Photon credentials not set", text };
  }
  try {
    const conv = await findConversation();
    if (!conv) {
      return { status: "simulated", reason: `No conversation yet. Text your Photon line once from ${PHOTON_ALERT_RECIPIENT}.`, text };
    }
    await photon.projects.sendMessage({
      path: { id: PHOTON_PROJECT_ID },
      headers: { "idempotency-key": `safe-signal-alert:${randomUUID()}` },
      body: { spaceId: conv.spaceId, senderId: conv.senderId, content: { type: "text", format: "plain", text } },
    });
    return { status: "sent", text };
  } catch (error) {
    const reason = error instanceof ApiError
      ? `Photon API error ${error.status} (request ${error.requestId ?? "unknown"})`
      : "Photon request failed";
    console.error(reason);
    return { status: "simulated", reason, text };
  }
}
