import { Hono } from "hono";
import { handleLinkClick } from "../engine/stateMachine.js";
import type { MessagingChannel } from "../channels/MessagingChannel.js";

export function createRedirectRouter(channel: MessagingChannel) {
  const app = new Hono();
  const baseUrl = process.env["BASE_URL"] ?? "http://localhost:3000";
  const deepLinkScheme = process.env["DEEP_LINK_SCHEME"] ?? "tlife";

  app.get("/p/:token", async (c) => {
    const token = c.req.param("token");

    const result = await handleLinkClick(token, { channel, baseUrl });

    if (!result) {
      return c.html(notFoundPage(), 404);
    }

    const { session, lesson } = result;
    const deepLink = `${deepLinkScheme}://learn/${session.id}`;

    // Try deep link first; fall back to web lesson page
    return c.html(redirectPage(deepLink, session.id, lesson));
  });

  // Web fallback lesson page
  app.get("/learn/:sessionId", async (c) => {
    const sessionId = c.req.param("sessionId");
    const { getSessionById } = await import("../db/repository.js");
    const session = getSessionById(sessionId);
    if (!session || !session.lesson) {
      return c.html(notFoundPage(), 404);
    }
    return c.html(webLessonPage(session.lesson));
  });

  return app;
}

function redirectPage(deepLink: string, sessionId: string, lesson: any): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Safe Signal — Practice Complete</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #1a0a2e; color: #fff; margin: 0; padding: 24px; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; }
    .card { background: #2d1b4e; border-radius: 16px; padding: 32px 24px; max-width: 420px; width: 100%; text-align: center; }
    h1 { font-size: 28px; margin: 0 0 8px; }
    .outcome { font-size: 48px; margin: 16px 0; }
    p { color: #c8b8e8; line-height: 1.6; margin: 12px 0; }
    .btn { display: block; background: #e20074; color: #fff; border: none; border-radius: 12px; padding: 16px 24px; font-size: 17px; font-weight: 600; text-decoration: none; margin: 16px 0; cursor: pointer; }
    .rule-box { background: #3d2460; border-left: 4px solid #e20074; border-radius: 8px; padding: 16px; margin: 16px 0; text-align: left; }
    .rule-box h3 { margin: 0 0 8px; font-size: 13px; text-transform: uppercase; color: #e20074; }
    .rule-box p { margin: 0; color: #fff; font-size: 15px; }
    .open-app-hint { font-size: 13px; color: #9980c8; margin-top: 8px; }
  </style>
  <script>
    window.onload = function() {
      var deepLink = "${deepLink}";
      var fallbackUrl = "/learn/${sessionId}";
      var timer = setTimeout(function() {
        window.location.href = fallbackUrl;
      }, 2000);
      window.location.href = deepLink;
      window.addEventListener("blur", function() { clearTimeout(timer); });
    };
  </script>
</head>
<body>
  <div class="card">
    <div class="outcome">🛑</div>
    <h1>Practice Complete</h1>
    <p>This was a <strong>Safe Signal</strong> practice scam from T-Life.</p>
    ${lesson?.ruleToRemember ? `<div class="rule-box"><h3>Rule to Remember</h3><p>${escapeHtml(lesson.ruleToRemember)}</p></div>` : ""}
    <a href="${deepLink}" class="btn">Open T-Life App →</a>
    <p class="open-app-hint">If T-Life doesn't open, tap "Open T-Life App" above.</p>
    <a href="/learn/${sessionId}" style="color:#9980c8;font-size:14px;">View lesson in browser instead</a>
  </div>
</body>
</html>`;
}

function webLessonPage(lesson: any): string {
  const outcomeEmoji = lesson.outcome === "caught" ? "🎉" : "🛑";
  const outcomeText = lesson.outcome === "caught" ? "Great job — you caught it!" : "You fell for this one.";

  const mistakeItems = (lesson.mistakes as string[])
    .map((m: string) => `<li>${escapeHtml(m)}</li>`)
    .join("");
  const strengthItems = (lesson.strengths as string[])
    .map((s: string) => `<li>${escapeHtml(s)}</li>`)
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Safe Signal — Your Lesson</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #1a0a2e; color: #fff; margin: 0; padding: 16px; }
    .card { background: #2d1b4e; border-radius: 16px; padding: 24px; max-width: 500px; margin: 0 auto 16px; }
    h1 { font-size: 22px; margin: 0 0 8px; }
    h2 { font-size: 16px; color: #e20074; text-transform: uppercase; margin: 20px 0 8px; }
    p, li { color: #c8b8e8; line-height: 1.6; font-size: 15px; }
    ul { padding-left: 20px; }
    .rule-box { background: #3d2460; border-left: 4px solid #e20074; border-radius: 8px; padding: 16px; margin: 16px 0; }
    .rule-box p { color: #fff; font-size: 16px; font-weight: 500; margin: 0; }
    .protect { background: #0a2410; border: 1px solid #1a4a20; border-radius: 12px; padding: 16px; margin-top: 12px; }
    .protect h2 { color: #4caf50; }
    .protect p { color: #a8d8b0; font-size: 14px; }
    .outcome { font-size: 36px; margin-bottom: 8px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="outcome">${outcomeEmoji}</div>
    <h1>${escapeHtml(outcomeText)}</h1>
    <h2>Your Key Mistakes</h2>
    <ul>${mistakeItems || "<li>No major mistakes this time!</li>"}</ul>
    <h2>What You Did Well</h2>
    <ul>${strengthItems}</ul>
    <div class="rule-box">
      <h2 style="margin:0 0 8px;color:#e20074;font-size:13px;text-transform:uppercase;">Rule to Remember</h2>
      <p>${escapeHtml(lesson.ruleToRemember)}</p>
    </div>
  </div>
  <div class="card protect">
    <h2>Protect Yourself Now</h2>
    <p>📞 <strong>Turn on Scam Block:</strong> Dial <strong>#662#</strong> from your T-Mobile phone</p>
    <p>🔒 <strong>Enable SIM Protection:</strong> Open T-Life → Account → SIM Protection</p>
    <p>🛡️ <strong>Enable Safe Browsing:</strong> Open T-Life → Account → Safe Browsing</p>
    <p>📢 <strong>Report real scams:</strong> Forward suspicious texts to <strong>7726</strong></p>
  </div>
</body>
</html>`;
}

function notFoundPage(): string {
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;text-align:center;background:#1a0a2e;color:#fff;"><h1>Link not found</h1><p>This practice link has already been used or has expired.</p></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
