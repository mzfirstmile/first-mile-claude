// supabase/functions/auto-reply/index.ts
// Generates a smart reply to an incoming email using Claude API, then sends via Graph API
// Deploy: supabase functions deploy auto-reply
// Secrets: CLAUDE_API_KEY, AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, SB_SERVICE_KEY

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MAILBOX = "aiassistant@firstmilecap.com";
const GRAPH_SEND_URL = `https://graph.microsoft.com/v1.0/users/${MAILBOX}/sendMail`;
const GRAPH_REPLY_URL = (messageId: string) =>
  `https://graph.microsoft.com/v1.0/users/${MAILBOX}/messages/${messageId}/reply`;
const TOKEN_URL = (tenant: string) =>
  `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;

const SIGNATURE_HTML = `
<p>Thank you,<br>First Mile AI Assistant</p>
<p>362 Fifth Avenue, 9th Floor<br>New York, NY 10001<br>(201) 549-9232 (text enabled)<br><a href="https://firstmilecap.com">FirstMileCap.com</a></p>
<img src="https://admin.firstmilecap.com/assets/First_Mile_Capital_Logo_RGB.png" alt="First Mile Capital" style="width:200px;margin-top:8px;">
`;

const SYSTEM_PROMPT = `You are the AI assistant for First Mile Capital, a real estate investment firm based at 362 Fifth Avenue, 9th Floor, New York, NY 10001.

Your name is the "First Mile AI Assistant" and you send emails from aiassistant@firstmilecap.com.

## About First Mile Capital
First Mile Capital is a real estate investment firm. The managing partner is Morris Zeitouni (mz@firstmilecap.com).

## Key People
- Morris Zeitouni (mz@firstmilecap.com) — Managing Partner
- Richard "Ricky" Chera (rc@firstmilecap.com) — Executive
- Toby Yedid (ty@firstmilecap.com) — Executive
- Stanley Chera (src@cacq.com) — Executive
- Rasheq Zarif (rz@firstmilecap.com) — Executive

## Your Capabilities
- You have access to property-level financials (actuals vs. budget) across the portfolio
- You have access to executive-level business financials
- A strategic forecasting module is being built
- You can be reached via text at (201) 549-9232, email at aiassistant@firstmilecap.com, or the chat widget at admin.firstmilecap.com

## How to Respond
- Be professional, warm, and concise
- If the email is a question you can answer based on your knowledge of First Mile, answer it
- If you don't know something specific, say you'll check with the team and get back to them
- If the email requires Morris's personal attention (legal, major decisions, sensitive topics), say you'll loop Morris in
- Do NOT make up financial numbers or specific data you don't have
- Do NOT include a signature in your reply — it will be appended automatically
- Write your reply as plain HTML paragraphs (use <p> tags)
- Keep replies brief and helpful — 2-4 paragraphs max
- Match the tone of the sender — if they're casual, be casual; if formal, be formal`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function getGraphToken(): Promise<string> {
  const tenantId = Deno.env.get("AZURE_TENANT_ID")!;
  const clientId = Deno.env.get("AZURE_CLIENT_ID")!;
  const clientSecret = Deno.env.get("AZURE_CLIENT_SECRET")!;

  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
  });

  const res = await fetch(TOKEN_URL(tenantId), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) throw new Error(`Token error: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

// ── Task Reminder Reply Handler ──
// Detects replies to task reminder emails and uses Claude to parse which tasks are done

function isTaskReminderReply(subject: string): boolean {
  const s = (subject || "").toLowerCase();
  return (
    s.includes("tasks due tomorrow") ||
    s.includes("past due task") ||
    s.includes("past due —") ||
    s.includes("task reminder") ||
    s.includes("escalation") ||
    s.includes("tasks past due") ||
    s.includes("upcoming deadline")
  );
}

async function handleTaskReminderReply(
  sb: any,
  email: any
): Promise<{ handled: boolean; replyHtml?: string; markedDone?: string[] }> {
  const fullBody = email.body_text || email.body_preview || "";

  // Fetch all non-terminated, non-done tasks to match against
  const { data: tasks, error: taskErr } = await sb
    .from("calendar_tasks")
    .select("id, property, payment_type, description, cadence, day_of_month, due_month, team, status")
    .neq("status", "Terminated")
    .neq("status", "Done");

  if (taskErr || !tasks || tasks.length === 0) {
    return { handled: false };
  }

  // Build a numbered task list for Claude to reference
  // Only include tasks whose property or description appears in the email thread
  const candidateTasks = tasks.filter((t: any) => {
    const bodyLower = fullBody.toLowerCase();
    const propMatch = bodyLower.includes(t.property.toLowerCase());
    const descMatch = t.description && bodyLower.includes(t.description.substring(0, 25).toLowerCase());
    return propMatch || descMatch;
  });

  if (candidateTasks.length === 0) {
    return { handled: false };
  }

  const taskListForPrompt = candidateTasks
    .map((t: any, i: number) => `[${i + 1}] ID=${t.id} | Property: ${t.property} | Type: ${t.payment_type || "—"} | ${t.description}`)
    .join("\n");

  // Use Claude to parse the reply and determine which tasks are done
  const claudeKey = Deno.env.get("CLAUDE_API_KEY")!;
  const parsePrompt = `You are parsing an email reply to a task reminder. The user is telling us which tasks they have completed.

Here are the tasks that were in the original reminder email:
${taskListForPrompt}

Here is the user's reply:
---
${fullBody.substring(0, 2000)}
---

Determine which tasks the user is saying are COMPLETED/DONE. Consider:
- If they say "all done", "all completed", "all tasks completed", etc. → ALL tasks are done
- If they reference specific properties or tasks → only those are done
- If they say "March tasks done" or "everything from March" → all tasks are done (since these were all from the reminder)
- If they mark individual items with "done", "completed", "✓", etc. → those specific ones
- If they say some are done and some aren't, only mark the done ones

Return a JSON object with this exact format, nothing else:
{"done_ids": ["id1", "id2"], "not_done_ids": ["id3"], "summary": "brief description of what user said"}

If ALL tasks are done, include all IDs in done_ids.
If you cannot determine status, return {"done_ids": [], "not_done_ids": [], "summary": "could not parse"}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": claudeKey,
        "anthropic-version": "2023-06-01",
        "anthropic-workspace-id": Deno.env.get("ANTHROPIC_WORKSPACE_ID") || "wrkspc_01KFMjdE8FRViEkxanZET8rH",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 512,
        messages: [{ role: "user", content: parsePrompt }],
      }),
    });

    if (!res.ok) {
      console.error(`Claude parse error: ${res.status}`);
      return { handled: false };
    }

    const data = await res.json();
    const responseText = data.content[0]?.text || "";

    // Extract JSON from response (Claude may wrap it in markdown)
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("Could not extract JSON from Claude response:", responseText);
      return { handled: false };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const doneIds: string[] = parsed.done_ids || [];

    if (doneIds.length === 0) {
      console.log("Claude determined no tasks marked as done:", parsed.summary);
      return { handled: false };
    }

    // Mark tasks as Done in the database
    const senderName = email.from_name || email.from_address.split("@")[0];
    const now = new Date().toISOString();
    const markedTaskNames: string[] = [];

    for (const taskId of doneIds) {
      const task = candidateTasks.find((t: any) => t.id === taskId);
      if (!task) continue;

      await sb
        .from("calendar_tasks")
        .update({
          status: "Done",
          completed_by: senderName,
          completed_date: now,
        })
        .eq("id", taskId);

      markedTaskNames.push(`${task.property}: ${task.description.substring(0, 60)}`);
    }

    // Build confirmation reply
    const taskList = markedTaskNames
      .map((n) => `<li style="margin-bottom:4px;">✅ ${n}</li>`)
      .join("");

    const notDoneIds: string[] = parsed.not_done_ids || [];
    let notDoneSection = "";
    if (notDoneIds.length > 0) {
      const notDoneNames = notDoneIds
        .map((id: string) => {
          const t = candidateTasks.find((t: any) => t.id === id);
          return t ? `<li style="margin-bottom:4px;">⏳ ${t.property}: ${t.description.substring(0, 60)}</li>` : "";
        })
        .filter(Boolean)
        .join("");
      notDoneSection = `<p style="margin-top:12px;">Still pending:</p><ul style="margin:8px 0; padding-left:20px; color:#d97706;">${notDoneNames}</ul>`;
    }

    const replyHtml = `
<p>Hi ${senderName.split(" ")[0]},</p>
<p>Got it! I've marked <strong>${markedTaskNames.length}</strong> task${markedTaskNames.length > 1 ? "s" : ""} as completed:</p>
<ul style="margin:8px 0; padding-left:20px; color:#059669;">
${taskList}
</ul>
${notDoneSection}
<p style="font-size:13px; color:#6b7280;">You can always review your tasks at <a href="https://admin.firstmilecap.com/#calendar">Calendars & Tasks</a>.</p>`;

    return { handled: true, replyHtml, markedDone: markedTaskNames };
  } catch (e) {
    console.error("AI parse error:", e);
    return { handled: false };
  }
}

async function generateReply(email: any): Promise<string> {
  const claudeKey = Deno.env.get("CLAUDE_API_KEY")!;

  const emailContext = `From: ${email.from_name || email.from_address} <${email.from_address}>
Subject: ${email.subject}
Date: ${email.received_at}

${email.body_text || email.body_preview || "(empty email)"}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": claudeKey,
      "anthropic-version": "2023-06-01",
        "anthropic-workspace-id": Deno.env.get("ANTHROPIC_WORKSPACE_ID") || "wrkspc_01KFMjdE8FRViEkxanZET8rH",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Please write a reply to this email. Return ONLY the HTML body of the reply (using <p> tags), no signature, no subject line, just the reply content.\n\n${emailContext}`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API error: ${res.status} ${err}`);
  }

  const data = await res.json();
  return data.content[0]?.text || "<p>Thank you for your email. I'll look into this and get back to you shortly.</p>";
}

async function sendReply(token: string, original: any, replyHtml: string): Promise<void> {
  const fullBody = `${replyHtml}\n<br>\n${SIGNATURE_HTML}`;

  // If we have the original Graph message ID, use the /reply endpoint
  // This properly threads the response (conversationId, In-Reply-To, References headers)
  if (original.graph_id) {
    console.log(`Using Graph /reply endpoint for message ${original.graph_id}`);

    // Build CC list: all original to/cc minus our mailbox and the sender
    const allRecipients = [
      ...(original.to_addresses || []),
      ...(original.cc_addresses || []),
    ].filter((r: any) => r.email && r.email.toLowerCase() !== MAILBOX.toLowerCase());

    const senderEmail = original.from_address.toLowerCase();
    const seenEmails = new Set([senderEmail, MAILBOX.toLowerCase()]);
    const ccRecipients: any[] = [];
    for (const r of allRecipients) {
      const email = r.email.toLowerCase();
      if (!seenEmails.has(email)) {
        seenEmails.add(email);
        ccRecipients.push({
          emailAddress: { address: r.email, name: r.name || undefined },
        });
      }
    }

    // Graph /reply endpoint payload — "message" overrides only the fields you specify
    // The reply automatically goes to the sender; we add CC for reply-all behavior
    const payload: any = {
      message: {
        body: { contentType: "HTML", content: fullBody },
      },
    };
    if (ccRecipients.length > 0) {
      payload.message.ccRecipients = ccRecipients;
    }

    const res = await fetch(GRAPH_REPLY_URL(original.graph_id), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.text();
      // If reply fails (e.g. message no longer in mailbox), fall back to sendMail
      console.warn(`Graph /reply failed (${res.status}), falling back to sendMail: ${err}`);
    } else {
      return; // Success — reply sent in-thread
    }
  }

  // Fallback: use sendMail (won't thread, but at least the reply goes out)
  console.log(`Falling back to sendMail for email from ${original.from_address}`);
  const replySubject = original.subject.startsWith("Re:")
    ? original.subject
    : `Re: ${original.subject}`;

  const allRecipients = [
    ...(original.to_addresses || []),
    ...(original.cc_addresses || []),
  ].filter((r: any) => r.email && r.email.toLowerCase() !== MAILBOX.toLowerCase());

  const toRecipients = [
    {
      emailAddress: {
        address: original.from_address,
        name: original.from_name || undefined,
      },
    },
  ];

  const senderEmail = original.from_address.toLowerCase();
  const seenEmails = new Set([senderEmail, MAILBOX.toLowerCase()]);
  const ccRecipients: any[] = [];
  for (const r of allRecipients) {
    const email = r.email.toLowerCase();
    if (!seenEmails.has(email)) {
      seenEmails.add(email);
      ccRecipients.push({
        emailAddress: { address: r.email, name: r.name || undefined },
      });
    }
  }

  const message: any = {
    subject: replySubject,
    body: { contentType: "HTML", content: fullBody },
    toRecipients,
  };
  if (ccRecipients.length > 0) {
    message.ccRecipients = ccRecipients;
  }

  const res = await fetch(GRAPH_SEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message, saveToSentItems: true }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Graph send error: ${res.status} ${err}`);
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { emailId } = await req.json();

    if (!emailId) {
      return new Response(
        JSON.stringify({ error: "Missing required field: emailId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SB_SERVICE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    // Fetch the email
    const { data: email, error: fetchErr } = await sb
      .from("emails")
      .select("*")
      .eq("id", emailId)
      .single();

    if (fetchErr || !email) {
      return new Response(
        JSON.stringify({ error: `Email not found: ${fetchErr?.message || "no data"}` }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Skip if already replied
    if (email.replied_at) {
      console.log(`Already replied to email ${emailId}, skipping`);
      return new Response(
        JSON.stringify({ skipped: true, reason: "already replied" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Atomic lock: claim this email by setting replied_at, but ONLY if still null
    // This prevents duplicate replies when webhook and cron race
    const lockTime = new Date().toISOString();
    const { data: claimed, error: claimErr } = await sb
      .from("emails")
      .update({ replied_at: lockTime })
      .eq("id", emailId)
      .is("replied_at", null)
      .select("id")
      .single();

    if (claimErr || !claimed) {
      console.log(`Email ${emailId} already claimed by another process, skipping`);
      return new Response(
        JSON.stringify({ skipped: true, reason: "claimed by another process" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Generating reply for email ${emailId} from ${email.from_address}: "${email.subject}"`);

    // Check if this is a reply to a task reminder email
    let replyHtml: string;
    if (isTaskReminderReply(email.subject)) {
      console.log(`Detected task reminder reply from ${email.from_address}`);
      const taskResult = await handleTaskReminderReply(sb, email);
      if (taskResult.handled && taskResult.replyHtml) {
        console.log(`Marked ${taskResult.markedDone?.length || 0} tasks as Done`);
        replyHtml = taskResult.replyHtml;
      } else {
        // Couldn't parse task completions — fall through to Claude
        console.log(`Could not parse task completions, falling back to Claude`);
        try {
          replyHtml = await generateReply(email);
        } catch (genErr) {
          await sb.from("emails").update({ replied_at: null }).eq("id", emailId);
          throw genErr;
        }
      }
    } else {
      // Standard email — generate reply via Claude
      try {
        replyHtml = await generateReply(email);
      } catch (genErr) {
        // Release the lock if reply generation fails
        await sb.from("emails").update({ replied_at: null }).eq("id", emailId);
        throw genErr;
      }
    }

    // Send via Graph API
    const token = await getGraphToken();
    await sendReply(token, email, replyHtml);

    // replied_at already set by atomic lock above — no need to update again

    // Log the sent reply (including CC recipients from reply-all)
    const logCc = (email.to_addresses || [])
      .concat(email.cc_addresses || [])
      .filter((r: any) => r.email && r.email.toLowerCase() !== MAILBOX.toLowerCase() && r.email.toLowerCase() !== email.from_address.toLowerCase());
    await sb.from("email_sent_log").insert({
      to_addresses: [{ email: email.from_address, name: email.from_name }],
      cc_addresses: logCc,
      subject: email.subject.startsWith("Re:") ? email.subject : `Re: ${email.subject}`,
      body_html: replyHtml + SIGNATURE_HTML,
      sent_by: "ai-auto-reply",
    });

    return new Response(
      JSON.stringify({ success: true, replied_to: email.from_address, subject: email.subject }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("auto-reply error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
