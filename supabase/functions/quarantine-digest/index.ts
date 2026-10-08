// supabase/functions/quarantine-digest/index.ts
// Weekly digest of Check Point (Harmony Email / Avanan) quarantine notices for Richard.
//
// Flow: Richard's Outlook rule forwards every daily Check Point quarantine notice to
// aiassistant@firstmilecap.com → sync-inbox / email-webhook land it in `emails` →
// auto-reply recognises it (isQuarantineNotice) and claims it silently, no reply →
// this function runs Mondays 8 AM ET (pg_cron job `quarantine-digest`), reads the
// week's notices, has Claude extract + triage every quarantined item, and emails
// one digest from aiassistant@ to Richard (cc Morris).
//
// POST body (all optional):
//   { dry_run: true }        → build the digest, return HTML, do NOT send
//   { days: 7 }              → look-back window in days (default 7, +2h slack)
//   { to: "x@y", cc: [...] } → override recipients (default rc@ / cc mz@)
//   { skip_sync: true }      → don't call sync-inbox first
//
// Secrets: CLAUDE_API_KEY, ANTHROPIC_WORKSPACE_ID (optional), AZURE_TENANT_ID,
//          AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, SB_SERVICE_KEY
// Deploy:  supabase functions deploy quarantine-digest   (or push → deploy-edge-functions.yml)

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MAILBOX = "aiassistant@firstmilecap.com";
const DEFAULT_TO = "rc@firstmilecap.com";
const DEFAULT_CC = ["mz@firstmilecap.com"];
const FAIL_TO = "mz@firstmilecap.com";
const GRAPH_SEND_URL = `https://graph.microsoft.com/v1.0/users/${MAILBOX}/sendMail`;
const TOKEN_URL = (tenant: string) => `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;

const EMAIL_SIGNATURE = `
<p>Thank you,<br>First Mile AI Assistant</p>
<p>362 Fifth Avenue, 9th Floor<br>New York, NY 10001<br>(201) 549-9232 (text enabled)<br><a href="https://firstmilecap.com">FirstMileCap.com</a></p>
<img src="https://admin.firstmilecap.com/assets/First_Mile_Capital_Logo_RGB.png" alt="First Mile Capital" style="width:200px;margin-top:8px;">
`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── Shared with auto-reply: what counts as a quarantine notice ──────────────
// Keep in sync with isQuarantineNotice() in auto-reply/index.ts.
export function isQuarantineNotice(subject: string | null, body: string | null): boolean {
  const s = (subject || "").toLowerCase();
  const b = (body || "").toLowerCase().slice(0, 4000);
  const vendor = /check ?point|avanan|harmony email|smartphish|quarantine (report|digest|summary|notification)/i;
  if (/quarantin/.test(s) && (vendor.test(s) || vendor.test(b) || /release|report as safe|restore/.test(b))) return true;
  if (/quarantin/.test(b) && vendor.test(b)) return true;
  return false;
}

// ── Graph ────────────────────────────────────────────────────────────────────
async function getGraphToken(): Promise<string> {
  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: Deno.env.get("AZURE_CLIENT_ID")!,
    client_secret: Deno.env.get("AZURE_CLIENT_SECRET")!,
    scope: "https://graph.microsoft.com/.default",
  });
  const res = await fetch(TOKEN_URL(Deno.env.get("AZURE_TENANT_ID")!), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) throw new Error(`Token error: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

async function sendEmail(token: string, to: string, cc: string[], subject: string, htmlBody: string) {
  const message = {
    subject,
    body: { contentType: "HTML", content: htmlBody },
    toRecipients: [{ emailAddress: { address: to } }],
    ccRecipients: cc.map((a) => ({ emailAddress: { address: a } })),
  };
  const res = await fetch(GRAPH_SEND_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message, saveToSentItems: true }),
  });
  if (!res.ok) throw new Error(`Graph send error: ${res.status} ${await res.text()}`);
}

// ── HTML → text, keeping link targets (release links live in the HTML) ───────
function htmlToTextWithLinks(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, text) => {
      const t = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      return ` ${t} [${href}] `;
    })
    .replace(/<\/(tr|p|div|li|h\d|table)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function esc(s: string): string {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Claude extraction + triage ───────────────────────────────────────────────
interface QItem {
  date: string;
  sender_name: string;
  sender_email: string;
  subject: string;
  quarantine_reason: string;
  release_link: string;
  verdict: "legit" | "spam";
  why: string;
}

const TRIAGE_TOOL = {
  name: "record_items",
  description: "Record every quarantined email found in the notices, each with a triage verdict.",
  input_schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            date: { type: "string", description: "Date the email was quarantined, YYYY-MM-DD if known" },
            sender_name: { type: "string" },
            sender_email: { type: "string" },
            subject: { type: "string" },
            quarantine_reason: { type: "string", description: "Check Point's stated reason / category, verbatim if given" },
            release_link: { type: "string", description: "The Release / Report-as-safe URL for this item, copied exactly, or empty string" },
            verdict: { type: "string", enum: ["legit", "spam"] },
            why: { type: "string", description: "One short phrase explaining the verdict" },
          },
          required: ["sender_email", "subject", "verdict", "why"],
        },
      },
    },
    required: ["items"],
  },
};

async function triageWithClaude(noticesText: string): Promise<QItem[]> {
  const system = `You process forwarded Check Point email-quarantine notices for Richard Chera, an executive at First Mile Capital, a commercial real estate investment firm in New York (acquisitions, property management, JV partners, lenders, brokers, attorneys, tenants, investors, vendors).

Extract EVERY quarantined email listed across the notices. The same quarantined email often appears in more than one daily notice — record it once. Copy sender addresses, subjects, reasons and Release links exactly as they appear; never invent a link.

Triage each item:
- "legit" = plausibly real business correspondence Richard would want to see: known-looking counterparties (brokers, lenders, attorneys, title, tenants, investors, vendors, government, banks), replies in an existing thread, documents/invoices/contracts he would expect, newsletters from real industry sources he might read. When unsure, choose "legit" — a missed real email costs more than an extra line.
- "spam" = marketing blasts, cold outreach, lookalike domains, credential-harvest / "your mailbox is full" patterns, generic "invoice attached" from unknown senders, obvious junk.
Wire instructions, payment-detail changes, or anything asking for credentials: verdict "legit" with why = "verify by phone before acting — common fraud pattern".

Call record_items exactly once with the full list. If the notices contain no quarantined items, call it with an empty list.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": Deno.env.get("CLAUDE_API_KEY")!,
      "anthropic-version": "2023-06-01",
      "anthropic-workspace-id": Deno.env.get("ANTHROPIC_WORKSPACE_ID") || "wrkspc_01KFMjdE8FRViEkxanZET8rH",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 8000,
      system,
      tools: [TRIAGE_TOOL],
      tool_choice: { type: "tool", name: "record_items" },
      messages: [{ role: "user", content: `Forwarded quarantine notices from this week:\n\n${noticesText}` }],
    }),
  });
  if (!res.ok) throw new Error(`Claude error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  if (data.stop_reason === "max_tokens") throw new Error("Claude hit max_tokens — too many notices in one call");
  const tool = (data.content || []).find((c: any) => c.type === "tool_use" && c.name === "record_items");
  const items: QItem[] = tool?.input?.items || [];
  // Normalise + de-dupe on (sender, subject, date)
  const seen = new Set<string>();
  const out: QItem[] = [];
  for (const it of items) {
    const key = `${(it.sender_email || "").toLowerCase()}|${(it.subject || "").trim().toLowerCase()}|${it.date || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      date: it.date || "",
      sender_name: it.sender_name || "",
      sender_email: it.sender_email || "",
      subject: it.subject || "(no subject)",
      quarantine_reason: it.quarantine_reason || "",
      release_link: /^https?:\/\//i.test(it.release_link || "") ? it.release_link : "",
      verdict: it.verdict === "spam" ? "spam" : "legit",
      why: it.why || "",
    });
  }
  return out;
}

// ── Digest HTML ──────────────────────────────────────────────────────────────
function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
}

function buildDigestHtml(items: QItem[], noticeCount: number, from: Date, to: Date): { subject: string; html: string } {
  const legit = items.filter((i) => i.verdict === "legit").sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const spam = items.filter((i) => i.verdict === "spam");
  const byDomain: Record<string, number> = {};
  for (const s of spam) {
    const d = (s.sender_email.split("@")[1] || "unknown").toLowerCase();
    byDomain[d] = (byDomain[d] || 0) + 1;
  }
  const domainRows = Object.entries(byDomain)
    .sort((a, b) => b[1] - a[1])
    .map(([d, n]) => `<tr><td style="padding:4px 10px;border-bottom:1px solid #eee">${esc(d)}</td><td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right">${n}</td></tr>`)
    .join("");

  const legitRows = legit
    .map(
      (i) => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;white-space:nowrap">${esc(i.date)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(i.sender_name)}${i.sender_name ? "<br>" : ""}<span style="color:#666;font-size:12px">${esc(i.sender_email)}</span></td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(i.subject)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;color:#666;font-size:12px">${esc(i.quarantine_reason)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:12px">${esc(i.why)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;white-space:nowrap">${i.release_link ? `<a href="${esc(i.release_link)}">Release</a>` : "—"}</td>
      </tr>`
    )
    .join("");

  const range = `${fmtDate(from)} – ${fmtDate(to)}`;
  const subject = `Weekly quarantine digest — ${range}`;
  const th = `style="text-align:left;padding:6px 10px;border-bottom:2px solid #ddd;font-size:12px;color:#444"`;

  let body: string;
  if (noticeCount === 0) {
    body = `<p>No Check Point quarantine notices reached the assistant mailbox this week (${range}). If you did receive daily notices, the Outlook forwarding rule may need a look.</p>`;
  } else {
    body = `
      <p><strong>${items.length}</strong> email${items.length === 1 ? "" : "s"} quarantined this week (${range}) across ${noticeCount} daily notice${noticeCount === 1 ? "" : "s"} — <strong>${legit.length}</strong> flagged as worth a look, ${spam.length} suppressed as spam/phishing.</p>
      <h3 style="margin:18px 0 6px">Worth a look</h3>
      ${
        legit.length
          ? `<table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:13px">
              <tr><th ${th}>Date</th><th ${th}>Sender</th><th ${th}>Subject</th><th ${th}>Quarantine reason</th><th ${th}>Why flagged</th><th ${th}></th></tr>
              ${legitRows}
            </table>`
          : `<p style="color:#666">Nothing this week looked legitimate.</p>`
      }
      <h3 style="margin:18px 0 6px">Suppressed as spam / phishing (by sender domain)</h3>
      ${
        spam.length
          ? `<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px"><tr><th ${th}>Domain</th><th ${th}>Count</th></tr>${domainRows}</table>`
          : `<p style="color:#666">None.</p>`
      }
      <p style="margin-top:16px;color:#666;font-size:12px">Reply to this email if something is misfiled and the triage rule will be adjusted. Release links open Check Point directly; the assistant never releases anything itself.</p>`;
  }

  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:900px">
    <h2 style="margin:0 0 10px">Weekly quarantine digest</h2>
    ${body}
    ${EMAIL_SIGNATURE}
  </div>`;
  return { subject, html };
}

// ── Main ─────────────────────────────────────────────────────────────────────
serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SB_SERVICE_KEY")!;
  const sb = createClient(supabaseUrl, supabaseKey);

  let opts: any = {};
  try { opts = await req.json(); } catch { /* empty body from cron */ }
  const dryRun = !!opts.dry_run;
  const days = Number(opts.days) > 0 ? Number(opts.days) : 7;
  const to: string = opts.to || DEFAULT_TO;
  const cc: string[] = Array.isArray(opts.cc) ? opts.cc : opts.cc ? [opts.cc] : DEFAULT_CC;

  try {
    // 1. Make sure the newest notices are in `emails` (sync-inbox is also on its own cron).
    if (!opts.skip_sync) {
      try {
        await fetch(`${supabaseUrl}/functions/v1/sync-inbox`, {
          method: "POST",
          headers: { Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
          body: "{}",
        });
      } catch (e) { console.warn("sync-inbox call failed (continuing):", e); }
    }

    // 2. Pull candidate notices from the window.
    const now = new Date();
    const since = new Date(now.getTime() - (days * 24 + 2) * 3600 * 1000); // +2h slack for cron drift
    const { data: rows, error } = await sb
      .from("emails")
      .select("id, subject, from_address, from_name, body_html, body_text, received_at")
      .eq("folder", "inbox")
      .gte("received_at", since.toISOString())
      .or("subject.ilike.%quarantin%,body_text.ilike.%quarantin%")
      .order("received_at", { ascending: true })
      .limit(200);
    if (error) throw new Error(`emails query: ${JSON.stringify(error)}`);

    const notices = (rows || []).filter((r) => isQuarantineNotice(r.subject, r.body_text));
    console.log(`quarantine-digest: ${rows?.length || 0} candidates, ${notices.length} notices in window since ${since.toISOString()}`);

    // 3. Extract + triage.
    let items: QItem[] = [];
    if (notices.length) {
      const chunks = notices.map((n, i) => {
        const text = n.body_html ? htmlToTextWithLinks(n.body_html) : (n.body_text || "");
        return `=== NOTICE ${i + 1} | forwarded by ${n.from_name || ""} <${n.from_address}> | received ${n.received_at} | subject: ${n.subject} ===\n${text.slice(0, 15000)}`;
      });
      items = await triageWithClaude(chunks.join("\n\n"));
    }

    // 4. Build + send.
    const { subject, html } = buildDigestHtml(items, notices.length, since, now);
    const summary = {
      notices: notices.length,
      items: items.length,
      legit: items.filter((i) => i.verdict === "legit").length,
      spam: items.filter((i) => i.verdict === "spam").length,
      window: { since: since.toISOString(), until: now.toISOString() },
    };

    if (dryRun) {
      return new Response(JSON.stringify({ dry_run: true, subject, to, cc, ...summary, items, html }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = await getGraphToken();
    await sendEmail(token, to, cc, subject, html);

    // 5. Tag the processed notices so they're easy to find / audit.
    if (notices.length) {
      await sb
        .from("emails")
        .update({ ai_category: "quarantine_notice", ai_summary: `Included in digest sent ${now.toISOString().slice(0, 10)}` })
        .in("id", notices.map((n) => n.id));
    }

    return new Response(JSON.stringify({ success: true, sent_to: to, cc, subject, ...summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("quarantine-digest error:", err);
    // Tell Morris, not Richard, when the run itself breaks.
    if (!dryRun) {
      try {
        const token = await getGraphToken();
        await sendEmail(token, FAIL_TO, [], "[quarantine digest] failed", `<p>The weekly quarantine digest did not go out.</p><pre>${esc(String(err?.message || err))}</pre>${EMAIL_SIGNATURE}`);
      } catch (e2) { console.error("failure email also failed:", e2); }
    }
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
