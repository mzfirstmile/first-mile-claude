// supabase/functions/quarantine-digest/index.ts
// Weekly digest of Check Point (Harmony Email / Avanan) quarantine notices for Richard.
//
// Flow: Richard's Outlook rule forwards every daily Check Point quarantine notice to
// aiassistant@firstmilecap.com → sync-inbox / email-webhook land it in `emails` →
// auto-reply recognises it (isQuarantineNotice) and claims it silently, no reply →
// this function runs Mondays 8 AM ET (pg_cron job `quarantine-digest`), reads the
// week's notices, parses the report tables, has Claude triage each item, and emails
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

function esc(s: string): string {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Deterministic parse of the Check Point report table ─────────────────────
// Report layout (Harmony Email "Quarantined and Spam/Junk Email Report"):
//   <h>Quarantined Emails</h> table rows: Sender | Subject | Date (GMT) | Action (<a href=release>Release|Request to Release</a>)
//   <h>Spam/Junk Emails</h>  table rows (already in Junk, no action) or "No Items"
interface QItem {
  date: string;
  sender_name: string;
  sender_email: string;
  subject: string;
  quarantine_reason: string; // Check Point's action label: "Release" (self-serve) / "Request to Release" (admin)
  release_link: string;
  verdict: "legit" | "spam";
  why: string;
  notice_id?: string;
}

function cellText(td: string): string {
  return td
    .replace(/<span class="data-column-title"[^>]*>[\s\S]*?<\/span>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function parseReport(html: string): { quarantined: QItem[]; junkCount: number } {
  const quarantined: QItem[] = [];
  let junkCount = 0;
  // Section split: the intro sentence also says "Spam/Junk emails", so look for the
  // capitalised heading that follows the "Quarantined Emails" heading.
  const qIdx = html.search(/Quarantined Emails\s*</);
  const after = qIdx >= 0 ? qIdx : 0;
  const rel = html.slice(after).search(/Spam\/Junk Emails\s*</);
  const junkIdx = rel >= 0 ? after + rel : -1;
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html))) {
    const row = m[1];
    const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((x) => x[1]);
    if (tds.length < 3) continue;
    const sender = cellText(tds[0]);
    if (!sender || /^sender$/i.test(sender) || !/@/.test(sender)) continue; // header / logo rows
    const inJunk = junkIdx >= 0 && m.index > junkIdx;
    if (inJunk) { junkCount++; continue; }
    const subject = cellText(tds[1]) || "(no subject)";
    const dateRaw = cellText(tds[2]);
    const actionTd = tds[3] || "";
    const link = (actionTd.match(/href=["']([^"']+)["']/i) || [])[1] || "";
    const action = cellText(actionTd);
    // "10/09/2026 04:37 AM" (GMT) → YYYY-MM-DD
    const dm = dateRaw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    const date = dm ? `${dm[3]}-${dm[1].padStart(2, "0")}-${dm[2].padStart(2, "0")}` : dateRaw;
    quarantined.push({
      date,
      sender_name: "",
      sender_email: sender,
      subject,
      quarantine_reason: action,
      release_link: /^https?:\/\//i.test(link) ? link : "",
      verdict: "legit",
      why: "",
    });
  }
  return { quarantined, junkCount };
}

function dedupe(items: QItem[]): QItem[] {
  const seen = new Set<string>();
  const out: QItem[] = [];
  for (const it of items) {
    const key = `${it.sender_email.toLowerCase()}|${it.subject.trim().toLowerCase()}|${it.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

// ── Claude: verdicts only (tiny output, so it fits well inside the 150s wall) ──
const VERDICT_TOOL = {
  name: "record_verdicts",
  description: "Record a triage verdict for every numbered item.",
  input_schema: {
    type: "object",
    properties: {
      verdicts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            n: { type: "integer", description: "Item number from the list" },
            verdict: { type: "string", enum: ["legit", "spam"] },
            why: { type: "string", description: "One short phrase (under 12 words)" },
          },
          required: ["n", "verdict", "why"],
        },
      },
    },
    required: ["verdicts"],
  },
};

async function triageWithClaude(items: QItem[]): Promise<void> {
  if (!items.length) return;
  const system = `You triage quarantined emails for Richard Chera, an executive at First Mile Capital (commercial real estate investment, New York) who is also involved with Crown Acquisitions. Counterparties he deals with: brokers, lenders, attorneys, title companies, tenants, JV partners, investors, vendors, banks, government.

For each numbered item decide:
- "legit": plausibly real correspondence he would want to see — a named counterparty or real-looking business domain, a reply in an existing thread, documents/invoices/contracts he could be expecting, industry newsletters from real sources. When unsure choose "legit"; a missed real email costs more than an extra line.
- "spam": marketing blasts, cold outreach / lead-gen (loans, lines of credit, "POC", SEO, staffing), lookalike or throwaway domains, credential-harvest patterns ("Please Review", "mailbox full", fake order/invoice confirmations), tracking-parameter garbage in the sender, obvious junk.
Wire instructions, payment-detail changes, or anything asking for credentials from a sender that looks like a known counterparty: "legit" with why "verify by phone before acting - common fraud pattern".

Call record_verdicts exactly once with one entry per item.`;
  const list = items.map((it, i) => `${i + 1}. ${it.date} | from: ${it.sender_email.slice(0, 200)} | subject: ${it.subject.slice(0, 200)}`).join("\n");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90_000);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": Deno.env.get("CLAUDE_API_KEY")!,
        "anthropic-version": "2023-06-01",
        "anthropic-workspace-id": Deno.env.get("ANTHROPIC_WORKSPACE_ID") || "wrkspc_01KFMjdE8FRViEkxanZET8rH",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        system,
        tools: [VERDICT_TOOL],
        tool_choice: { type: "tool", name: "record_verdicts" },
        messages: [{ role: "user", content: `Quarantined items this week:\n\n${list}` }],
      }),
    });
    if (!res.ok) throw new Error(`Claude error: ${res.status} ${await res.text()}`);
    const data = await res.json();
    const tool = (data.content || []).find((c: any) => c.type === "tool_use" && c.name === "record_verdicts");
    const verdicts: any[] = tool?.input?.verdicts || [];
    for (const v of verdicts) {
      const it = items[Number(v.n) - 1];
      if (!it) continue;
      it.verdict = v.verdict === "spam" ? "spam" : "legit";
      it.why = String(v.why || "").slice(0, 160);
    }
    for (const it of items) if (!it.why) it.why = "no verdict returned - review";
  } catch (e) {
    // Never lose the digest over triage: everything stays "legit" with a note.
    console.error("triage failed, sending untriaged:", e);
    for (const it of items) { it.verdict = "legit"; it.why = "triage unavailable this run"; }
  } finally {
    clearTimeout(timer);
  }
}

// ── Digest HTML ──────────────────────────────────────────────────────────────
function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
}

function buildDigestHtml(items: QItem[], noticeCount: number, junkCount: number, from: Date, to: Date): { subject: string; html: string } {
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
      <p><strong>${items.length}</strong> email${items.length === 1 ? "" : "s"} quarantined this week (${range}) across ${noticeCount} daily notice${noticeCount === 1 ? "" : "s"} — <strong>${legit.length}</strong> flagged as worth a look, ${spam.length} suppressed as spam/phishing${junkCount ? `; ${junkCount} more went straight to Junk` : ""}.</p>
      <h3 style="margin:18px 0 6px">Worth a look</h3>
      ${
        legit.length
          ? `<table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:13px">
              <tr><th ${th}>Date</th><th ${th}>Sender</th><th ${th}>Subject</th><th ${th}>Check Point action</th><th ${th}>Why flagged</th><th ${th}></th></tr>
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

    // 3. Parse each notice's table, then triage the combined list.
    let items: QItem[] = [];
    let junkCount = 0;
    for (const n of notices) {
      const { quarantined, junkCount: j } = parseReport(n.body_html || "");
      junkCount += j;
      for (const q of quarantined) q.notice_id = n.id;
      items.push(...quarantined);
      if (!quarantined.length && !j) console.warn(`notice ${n.id} parsed to zero rows — format change? subject: ${n.subject}`);
    }
    items = dedupe(items);
    await triageWithClaude(items);

    // 4. Build + send.
    const { subject, html } = buildDigestHtml(items, notices.length, junkCount, since, now);
    const summary = {
      notices: notices.length,
      items: items.length,
      legit: items.filter((i) => i.verdict === "legit").length,
      spam: items.filter((i) => i.verdict === "spam").length,
      junk: junkCount,
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
