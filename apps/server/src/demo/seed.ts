#!/usr/bin/env tsx
/**
 * Demo seed: creates a demo user, consent, and two finished sessions
 * (one caught, one fell-for-it) so the Learn screen has content on first launch.
 */
import "dotenv/config";
import { nanoid } from "nanoid";
import { getDb } from "../db/client.js";
import { upsertUser, saveConsent, upsertSkillStat } from "../db/repository.js";
import { users, sessions, messages, skillsStats } from "../db/schema.js";
import { eq } from "drizzle-orm";
import type { Lesson } from "@safe-signal/shared";

const DEMO_USER_PHONE = "+15550010001";
const DEMO_USER_NAME = "Demo User";

async function seed() {
  console.log("🌱 Seeding demo data…");

  const user = await upsertUser(DEMO_USER_PHONE, DEMO_USER_NAME);
  console.log(`✅ User: ${user.id} (${user.phone})`);

  await saveConsent({
    userId: user.id,
    phone: DEMO_USER_PHONE,
    channel: "simulator",
    interests: ["shopping", "package_delivery", "mobile_account"],
    maxPerDay: 5,
    consentVersion: "1.0",
    consentAt: new Date().toISOString(),
    active: true,
  });
  console.log("✅ Consent saved");

  const db = getDb();

  // Clear existing demo sessions
  const existing = db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, user.id)).all();
  for (const s of existing) {
    db.delete(messages).where(eq(messages.sessionId, s.id)).run();
    db.delete(sessions).where(eq(sessions.id, s.id)).run();
  }

  // ── Session 1: Fell for it (delivery scam) ────────────────────────────────
  const s1Id = nanoid();
  const s1Token = nanoid(32);
  const s1Lesson: Lesson = {
    sessionId: s1Id,
    outcome: "fell_for_it",
    replay: [
      {
        id: nanoid(),
        role: "scammer",
        text: "PARCELGO: Your package #PG847291 could not be delivered. A $3.50 redelivery fee is required within 24 hrs. Pay here: https://safe-signal.demo/p/" + s1Token,
        redFlags: [
          { category: "urgency", startChar: 60, endChar: 76, explanation: "24-hour deadline creates artificial pressure" },
          { category: "suspicious_link_or_sender", startChar: 90, endChar: 130, explanation: "Link doesn't match official parcelgo.com domain" },
        ],
      },
      {
        id: nanoid(),
        role: "user",
        text: "You engaged with the scammer's message",
        redFlags: [],
      },
      {
        id: nanoid(),
        role: "scammer",
        text: "⚠️ FINAL NOTICE: Your package will be returned to sender in 1 hour. Act now.",
        redFlags: [
          { category: "urgency", startChar: 4, endChar: 60, explanation: "1-hour countdown is false scarcity" },
        ],
      },
      {
        id: nanoid(),
        role: "user",
        text: "You tapped the link",
        redFlags: [],
      },
    ],
    mistakes: [
      "Replied to a message from an unknown or suspicious sender",
      "Engaged with a request involving payment or a code",
    ],
    strengths: ["You completed this practice session"],
    ruleToRemember: "Real carriers never charge redelivery fees by SMS link.",
    nextWeakCategory: "urgency",
    generatedAt: new Date().toISOString(),
  };

  db.insert(sessions).values({
    id: s1Id,
    userId: user.id,
    scenarioId: "parcelgo-delivery-1",
    channel: "simulator",
    state: "ended_fell",
    currentStageIndex: 3,
    token: s1Token,
    startedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    endedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000 + 10 * 60 * 1000).toISOString(),
    outcome: "fell_for_it",
    lessonJson: JSON.stringify(s1Lesson),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  }).run();
  console.log(`✅ Session 1 (fell_for_it): ${s1Id}`);

  // ── Session 2: Caught it (bank scam) ──────────────────────────────────────
  const s2Id = nanoid();
  const s2Token = nanoid(32);
  const s2Lesson: Lesson = {
    sessionId: s2Id,
    outcome: "caught",
    replay: [
      {
        id: nanoid(),
        role: "scammer",
        text: "NORTHLINE BANK ALERT: Suspicious login detected from TX. Verify identity: https://safe-signal.demo/p/" + s2Token,
        redFlags: [
          { category: "urgency", startChar: 0, endChar: 30, explanation: "Account compromise fear triggers immediate action" },
          { category: "suspicious_link_or_sender", startChar: 70, endChar: 110, explanation: "Real bank alerts use the official app" },
        ],
      },
      {
        id: nanoid(),
        role: "user",
        text: "You reported this as a scam",
        redFlags: [],
      },
    ],
    mistakes: [],
    strengths: [
      "You didn't engage with the scam at all",
      "You correctly identified the suspicious link",
    ],
    ruleToRemember: "Your bank will never ask for your PIN or OTP over text.",
    nextWeakCategory: "impersonation",
    generatedAt: new Date().toISOString(),
  };

  db.insert(sessions).values({
    id: s2Id,
    userId: user.id,
    scenarioId: "northline-bank-1",
    channel: "simulator",
    state: "ended_caught",
    currentStageIndex: 1,
    token: s2Token,
    startedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    endedAt: new Date(Date.now() - 24 * 60 * 60 * 1000 + 5 * 60 * 1000).toISOString(),
    outcome: "caught",
    lessonJson: JSON.stringify(s2Lesson),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  }).run();
  console.log(`✅ Session 2 (caught): ${s2Id}`);

  // ── Skills stats ──────────────────────────────────────────────────────────
  upsertSkillStat(user.id, "urgency", false);
  upsertSkillStat(user.id, "suspicious_link_or_sender", false);
  upsertSkillStat(user.id, "suspicious_link_or_sender", true);
  upsertSkillStat(user.id, "impersonation", true);
  console.log("✅ Skills stats seeded");

  console.log(`\n🎬 Demo user ready!`);
  console.log(`   userId: ${user.id}`);
  console.log(`   phone:  ${DEMO_USER_PHONE}`);
  console.log(`   session 1 (fell): ${s1Id}`);
  console.log(`   session 2 (caught): ${s2Id}`);
}

seed().catch((e) => { console.error(e); process.exit(1); });
