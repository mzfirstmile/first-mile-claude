// supabase/functions/deal-intake/broker-ack.ts
// Broker acknowledgement with approval (2026-10-12).
// When a colleague forwards a broker's deal to aiassistant@, we draft a short "thanks for sending this
// opportunity, we'll be in touch" note to the BROKER, email the draft to Ricky (cc the colleague who
// forwarded it) for approval, and only send it to the broker once Ricky replies approve / ok / send.
// Any other reply from Ricky is treated as edit instructions: the draft is revised and re-sent for approval.
//
// Called from deal-intake/index.ts:
//   deriveBroker(ex, text, forwarder)        — broker name/email/subject from extraction + forwarded headers
//   buildBrokerDraft(deal)                   — HTML body proposed to the broker (no signature)
//   sendApprovalRequest(sb, deal, opts)      — emails the draft to Ricky (+cc forwarder), status → pending
//   handleApprovalReply(sb, email)           — parses Ricky's reply: approve → send to broker; else revise + re-ask

const MAILBOX = "aiassistant@firstmilecap.com";
const DASHBOARD = "https://admin.firstmilecap.com";
const GRAPH = "https://graph.microsoft.com/v1.0";
export const APPROVERS = ["rc@firstmilecap.com", "rchera@cacq.com"]; // Ricky — the only addresses that can release a broker email
export const APPROVER_TO = { address: "rc@firstmilecap.com", name: "Ricky Chera" };
const INTERNAL_DOMAINS = ["firstmilecap.com", "cacq.com"];
export const APPROVAL_TAG = (token: string) => `[Approve BRK-${token}]`;
const APPROVAL_RE = /\[Approve BRK-([a-z0-9]{8})\]/i;

const SIGNATURE_HTML = `
<p>Thank you,<br>First Mile AI Assistant</p>
<p>362 Fifth Avenue, 9th Floor<br>New York, NY 10001<br>(201) 549-9232 (text enabled)<br><a href="https://firstmilecap.com">FirstMileCap.com</a></p>
<img src="https://admin.firstmilecap.com/assets/First_Mile_Capital_Logo_RGB.png" alt="First Mile Capital" style="width:200px;margin-top:8px;">
`;

const esc = (s: any) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
const lower = (s: any) => String(s || "").trim().toLowerCase();
const domainOf = (e: string) => lower(e).split("@")[1] || "";
const isInternal = (e: string) => INTERNAL_DOMAINS.includes(domainOf(e)) || lower(e) === MAILBOX;
export const isApprover = (e: string) => APPROVERS.includes(lower(e));

// ── Graph ────────────────────────────────────────────────────
async function graphToken(): Promise<string> {
  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: Deno.env.get("AZURE_CLIENT_ID")!,
    client_secret: Deno.env.get("AZURE_CLIENT_SECRET")!,
    scope: "https://graph.microsoft.com/.default",
  });
  const res = await fetch(`https://login.microsoftonline.com/${Deno.env.get("AZURE_TENANT_ID")}/oauth2/v2.0/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString(),
  });
  if (!res.ok) throw new Error(`Graph token ${res.status}: ${await res.text()}`);
  return (await res.json()).access_token;
}

type Addr = { address: string; name?: string };
async function graphSend(opts: { to: Addr[]; cc?: Addr[]; subject: string; html: string; replyToGraphId?: string }): Promise<void> {
  const token = await graphToken();
  const body = `${opts.html}\n<br>\n${SIGNATURE_HTML}`;
  const rcpt = (a: Addr[]) => a.map((x) => ({ emailAddress: { address: x.address, name: x.name || undefined } }));
  // Reply in-thread when we have the inbound Graph message id (keeps Ricky's approval thread together)
  if (opts.replyToGraphId) {
    const payload: any = { message: { body: { contentType: "HTML", content: body } } };
    if (opts.cc?.length) payload.message.ccRecipients = rcpt(opts.cc);
    const r = await fetch(`${GRAPH}/users/${MAILBOX}/messages/${opts.replyToGraphId}/reply`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    if (r.ok) return;
    console.warn(`Graph /reply failed (${r.status}) — falling back to sendMail: ${await r.text()}`);
  }
  const message: any = { subject: opts.subject, body: { contentType: "HTML", content: body }, toRecipients: rcpt(opts.to) };
  if (opts.cc?.length) message.ccRecipients = rcpt(opts.cc);
  const r = await fetch(`${GRAPH}/users/${MAILBOX}/sendMail`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ message, saveToSentItems: true }),
  });
  if (!r.ok) throw new Error(`Graph sendMail ${r.status}: ${await r.text()}`);
}

async function logSent(sb: any, to: Addr[], cc: Addr[], subject: string, html: string, by: string) {
  try { await sb.from("email_sent_log").insert({ to_addresses: to.map((a) => ({ email: a.address, name: a.name })), cc_addresses: cc.map((a) => ({ email: a.address, name: a.name })), subject, body_html: html + SIGNATURE_HTML, sent_by: by }); } catch (e) { console.warn("email_sent_log failed", e); }
}

async function appendLog(sb: any, deal: any, event: string, by: string | null, note?: string) {
  const log = Array.isArray(deal.broker_reply_log) ? deal.broker_reply_log : [];
  log.push({ at: new Date().toISOString(), event, by, note: note || null });
  deal.broker_reply_log = log;
  return log;
}

// ── Broker identification ────────────────────────────────────
// The forwarded broker email usually carries an Outlook/Gmail header block in the body:
//   From: Jane Broker <jane@cbre.com>   /   From: Jane Broker [mailto:jane@cbre.com]
// Claude's extraction gets first shot (broker_name / broker_email fields); this regex is the fallback.
export function parseForwardedSender(text: string): { name: string | null; email: string | null } | null {
  const t = String(text || "");
  const re = /^\s*(?:>+\s*)?\*?From:\*?\s*(.*?)\s*$/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const line = m[1];
    const em = line.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/);
    if (!em) continue;
    const email = em[0].toLowerCase();
    if (isInternal(email)) continue;
    let name = line.replace(em[0], "").replace(/mailto:|[<>\[\]"']/g, "").replace(/\s{2,}/g, " ").trim();
    if (!name || /@/.test(name)) name = null as any;
    return { name: name || null, email };
  }
  return null;
}

export function stripFwd(subject: string | null | undefined): string {
  let s = String(subject || "").trim();
  for (let i = 0; i < 4; i++) s = s.replace(/^\s*(fw|fwd|re|aw|wg|tr)\s*:\s*/i, "").trim();
  return s;
}

export function firstNameOf(name: string | null | undefined, email: string | null | undefined): string | null {
  const n = String(name || "").replace(/["']/g, "").trim();
  if (n) {
    // "Last, First" → First
    if (n.includes(",")) { const p = n.split(",")[1]?.trim().split(/\s+/)[0]; if (p) return p; }
    const first = n.split(/\s+/)[0];
    if (first && !/@/.test(first) && first.length > 1) return first.replace(/[^A-Za-z'\-]/g, "") || null;
  }
  const local = String(email || "").split("@")[0];
  const guess = local.split(/[._-]/)[0];
  return guess && guess.length > 1 && !/\d/.test(guess) ? guess[0].toUpperCase() + guess.slice(1) : null;
}

export function deriveBroker(ex: any, text: string, forwarder: string | null | undefined): { name: string | null; email: string | null; company: string | null } {
  let email: string | null = ex?.broker_email ? lower(ex.broker_email) : null;
  let name: string | null = ex?.broker_name || null;
  if (email && (isInternal(email) || lower(forwarder) === email)) email = null; // never "reply" to ourselves
  if (!email) { const p = parseForwardedSender(text); if (p?.email) { email = p.email; name = name || p.name; } }
  return { name: name || null, email, company: ex?.broker || ex?.broker_company || null };
}

// ── Draft ────────────────────────────────────────────────────
export function buildBrokerDraft(deal: any): string {
  const first = firstNameOf(deal.broker_name, deal.broker_email);
  const what = deal.deal_name || deal.address || (deal.broker_subject ? `“${deal.broker_subject}”` : "this opportunity");
  return `<p>Dear ${esc(first || "Sir or Madam")},</p>
<p>Thank you for sending over ${esc(what)}. We appreciate you thinking of First Mile Capital for this opportunity.</p>
<p>Our team is reviewing the materials and we will be in touch with any questions or next steps.</p>`;
}

// ── Approval request ─────────────────────────────────────────
function approvalSubject(deal: any) {
  return `${APPROVAL_TAG(deal.broker_approval_token)} Broker reply — ${deal.deal_name || deal.address || deal.broker_subject || "prospective deal"}`;
}

function approvalHtml(deal: any, forwarderName: string | null, revised: boolean): string {
  const fwd = deal.submitted_by ? `${esc(deal.submitted_by_name || forwarderName || deal.submitted_by)}` : "a colleague";
  return `
<p>Hi Ricky,</p>
<p>${revised ? "Here is the revised reply" : "Here is the proposed reply"} to <b>${esc(deal.broker_name || deal.broker_email)}</b> &lt;${esc(deal.broker_email)}&gt; for the deal ${fwd} forwarded (<a href="${DASHBOARD}/#dealtracking&deal=${deal.id}" style="color:#0ea5e9">${esc(deal.deal_name || "open in Deal Tracking")}</a>).</p>
<p><b>Reply “approve”, “ok” or “send”</b> to send it to the broker as written. Reply with any changes and I'll revise it and send you a new version to approve. Nothing goes to the broker until you approve.</p>
<div style="border:1px solid #e2e8f0;border-left:4px solid #0ea5e9;border-radius:8px;padding:12px 16px;margin:12px 0;background:#f8fafc">
  <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Proposed email · To: ${esc(deal.broker_email)} · Subject: Re: ${esc(deal.broker_subject || deal.deal_name || "")}</div>
  ${deal.broker_reply_draft}
  <p style="color:#94a3b8;font-size:12px;margin-top:8px">(standard First Mile AI Assistant signature follows)</p>
</div>`;
}

export async function sendApprovalRequest(sb: any, deal: any, opts: { revised?: boolean; replyToGraphId?: string } = {}): Promise<any> {
  if (!deal.broker_email) throw new Error("no broker email on this deal");
  if (!deal.broker_approval_token) deal.broker_approval_token = String(deal.id).replace(/-/g, "").slice(0, 8);
  if (!deal.broker_reply_draft) deal.broker_reply_draft = buildBrokerDraft(deal);
  const to = [APPROVER_TO];
  const cc: Addr[] = [];
  if (deal.submitted_by && !isApprover(deal.submitted_by) && lower(deal.submitted_by) !== MAILBOX) cc.push({ address: deal.submitted_by, name: deal.submitted_by_name || undefined });
  const subject = approvalSubject(deal);
  const html = approvalHtml(deal, null, !!opts.revised);
  await graphSend({ to, cc, subject, html, replyToGraphId: opts.replyToGraphId });
  await logSent(sb, to, cc, subject, html, "deal-intake-broker-approval");
  const log = await appendLog(sb, deal, opts.revised ? "approval_requested_revised" : "approval_requested", MAILBOX, `to ${to[0].address}${cc.length ? ", cc " + cc.map((c) => c.address).join(",") : ""}`);
  const patch = { broker_reply_status: "pending", broker_approval_token: deal.broker_approval_token, broker_reply_draft: deal.broker_reply_draft, broker_approval_sent_at: new Date().toISOString(), broker_reply_log: log, updated_at: new Date().toISOString() };
  const { error } = await sb.from("deal_tracking").update(patch).eq("id", deal.id);
  if (error) throw new Error(`deal_tracking update: ${error.message}`);
  return { ...deal, ...patch };
}

// ── Approval reply ───────────────────────────────────────────
export function approvalTokenFromSubject(subject: string | null | undefined): string | null {
  const m = String(subject || "").match(APPROVAL_RE);
  return m ? m[1].toLowerCase() : null;
}

// Top-of-reply text only: drop quoted history (">" lines, "From:" header blocks, "On … wrote:")
export function replyTopText(bodyText: string): string {
  const lines = String(bodyText || "").replace(/\r/g, "").split("\n");
  const out: string[] = [];
  for (const raw of lines) {
    const l = raw.trim();
    if (/^>/.test(l)) break;
    if (/^(from|sent|to|subject|date):\s/i.test(l)) break;
    if (/^on .{6,120} wrote:?$/i.test(l)) break;
    if (/^-{3,}\s*original message\s*-{3,}$/i.test(l) || /^_{5,}$/.test(l)) break;
    if (/^Sent from my (iPhone|iPad|Android)/i.test(l)) break;
    out.push(l);
  }
  return out.join("\n").trim();
}

const YES_RE = /^(approve[d]?|ok(ay)?|yes|yep|yup|sure|send( it)?|go( ahead)?|looks? good( to me)?|lgtm|good to go|ship it|fine|perfect|great|👍|✅)[\s.!,]*(thanks?|thank you|please|pls)?[\s.!]*$/i;
export function isApprovalText(top: string): boolean {
  // drop greeting lines, sign-off lines and short name lines, then test what's left
  const lines = String(top || "").split("\n").map((l) => l.trim()).filter(Boolean)
    .filter((l) => !/^(hi|hey|hello|good (morning|afternoon|evening))\b[^a-z]*$/i.test(l))
    .filter((l) => !/^(thanks?|thank you|many thanks|best|best regards|regards|cheers|sent from my \w+)[.,!]?$/i.test(l))
    .filter((l) => YES_RE.test(l) || (!/^[A-Z][a-z]+(\s[A-Z][a-z]+)?$/.test(l) && !/^(r|rc)$/i.test(l))); // bare name lines ("Ricky", "Richard Chera") — but never drop a yes-word
  const t = lines.join(" ").replace(/\s+/g, " ").trim();
  if (!t || t.length > 80) return false;
  return YES_RE.test(t);
}

async function reviseDraft(deal: any, instructions: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": Deno.env.get("CLAUDE_API_KEY")!,
      "anthropic-version": "2023-06-01",
      "anthropic-workspace-id": Deno.env.get("ANTHROPIC_WORKSPACE_ID") || "wrkspc_01KFMjdE8FRViEkxanZET8rH",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 800,
      system: "You revise short, professional acknowledgement emails from First Mile Capital (a NYC real estate investment firm) to brokers who sent us a deal. Apply the reviewer's instructions exactly. Keep it brief and courteous. Never invent deal terms, prices or commitments. Return ONLY the revised email body as HTML <p> paragraphs — no subject, no signature, no commentary, no markdown fences.",
      messages: [{ role: "user", content: `Current draft (HTML):\n${deal.broker_reply_draft}\n\nBroker: ${deal.broker_name || ""} <${deal.broker_email}>\nDeal: ${deal.deal_name || ""} — ${[deal.address, deal.city, deal.state].filter(Boolean).join(", ")}\n\nReviewer (Ricky) replied with these instructions:\n${instructions}` }],
    }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`);
  const data = await res.json();
  let html = String(data.content?.[0]?.text || "").trim().replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/, "").trim();
  if (!/<p/i.test(html)) html = html.split(/\n{2,}/).map((p) => `<p>${esc(p)}</p>`).join("\n");
  return html;
}

async function sendToBroker(sb: any, deal: any, approvedBy: string): Promise<any> {
  const to: Addr[] = [{ address: deal.broker_email, name: deal.broker_name || undefined }];
  const cc: Addr[] = [APPROVER_TO];
  if (deal.submitted_by && !isApprover(deal.submitted_by) && lower(deal.submitted_by) !== MAILBOX) cc.push({ address: deal.submitted_by, name: deal.submitted_by_name || undefined });
  const subject = deal.broker_subject ? `Re: ${deal.broker_subject}` : `Re: ${deal.deal_name || "your opportunity"}`;
  await graphSend({ to, cc, subject, html: deal.broker_reply_draft });
  await logSent(sb, to, cc, subject, deal.broker_reply_draft, "deal-intake-broker-reply");
  const log = await appendLog(sb, deal, "sent_to_broker", approvedBy, `to ${deal.broker_email}`);
  const patch = { broker_reply_status: "sent", broker_approved_by: approvedBy, broker_reply_sent_at: new Date().toISOString(), broker_reply_log: log, updated_at: new Date().toISOString() };
  await sb.from("deal_tracking").update(patch).eq("id", deal.id);
  return { ...deal, ...patch };
}

// Returns { handled, replyHtml } — replyHtml is what auto-reply sends back in the approval thread.
export async function handleApprovalReply(sb: any, email: any): Promise<{ handled: boolean; replyHtml?: string; action?: string; dealId?: string }> {
  const token = approvalTokenFromSubject(email.subject);
  if (!token) return { handled: false };
  const { data: deal } = await sb.from("deal_tracking").select("*").eq("broker_approval_token", token).maybeSingle();
  if (!deal) return { handled: true, replyHtml: `<p>I couldn't find the deal this approval refers to (token ${esc(token)}). It may have been deleted from Deal Tracking.</p>` };
  const from = lower(email.from_address);
  const top = replyTopText(email.body_text || email.body_preview || "");
  const link = `<a href="${DASHBOARD}/#dealtracking&deal=${deal.id}" style="color:#0ea5e9">${esc(deal.deal_name || "Deal Tracking")}</a>`;

  if (!isApprover(from)) {
    const log = await appendLog(sb, deal, "reply_ignored_not_approver", from, top.slice(0, 200));
    await sb.from("deal_tracking").update({ broker_reply_log: log }).eq("id", deal.id);
    return { handled: true, action: "ignored", dealId: deal.id, replyHtml: `<p>Thanks — noted. Only Ricky can release the broker reply for ${link}; I'll send it once he approves.${top ? " I've attached your comment to the deal log." : ""}</p>` };
  }
  if (deal.broker_reply_status === "sent") {
    return { handled: true, action: "already_sent", dealId: deal.id, replyHtml: `<p>This reply already went to ${esc(deal.broker_email)} on ${new Date(deal.broker_reply_sent_at).toLocaleString("en-US", { timeZone: "America/New_York" })} — nothing further sent. (${link})</p>` };
  }
  if (isApprovalText(top)) {
    const updated = await sendToBroker(sb, deal, from);
    return { handled: true, action: "sent", dealId: deal.id, replyHtml: `<p>Approved — sent to <b>${esc(updated.broker_name || updated.broker_email)}</b> &lt;${esc(updated.broker_email)}&gt;${updated.submitted_by && !isApprover(updated.submitted_by) ? `, cc ${esc(updated.submitted_by)}` : ""}. Logged on ${link}.</p>` };
  }
  // Anything else = edit instructions → revise and re-ask
  if (!top) {
    return { handled: true, action: "unclear", dealId: deal.id, replyHtml: `<p>I couldn't read an approval or any edits in that reply. Reply <b>approve</b> to send the draft to ${esc(deal.broker_email)} as is, or tell me what to change.</p>` };
  }
  const revised = await reviseDraft(deal, top);
  deal.broker_reply_draft = revised;
  await appendLog(sb, deal, "revised", from, top.slice(0, 500));
  await sendApprovalRequest(sb, deal, { revised: true, replyToGraphId: email.graph_id });
  return { handled: true, action: "revised", dealId: deal.id }; // the revised approval request IS the reply
}
