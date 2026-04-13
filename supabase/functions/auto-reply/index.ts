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
// Detects replies to task reminder emails and marks tasks as Done

function isTaskReminderReply(subject: string): boolean {
  const s = (subject || "").toLowerCase();
  return s.includes("tasks due tomorrow") || s.includes("past due task") || s.includes("task reminder");
}

async function handleTaskReminderReply(
  sb: any,
  email: any
): Promise<{ handled: boolean; replyHtml?: string; markedDone?: string[] }> {
  const body = (email.body_text || email.body_preview || "").toLowerCase();
  const subject = (email.subject || "").toLowerCase();

  // Get the date from the subject to find relevant tasks
  // Subject format: "📋 N Tasks Due Tomorrow — Tuesday, April 15, 2026 [TEST]"
  // or "⚠️ N Past Due Tasks — Were Due Tuesday, April 15, 2026"

  // Fetch all non-terminated, non-done tasks to match against
  const { data: tasks, error: taskErr } = await sb
    .from("calendar_tasks")
    .select("id, property, payment_type, description, cadence, day_of_month, due_month, team, status")
    .neq("status", "Terminated")
    .neq("status", "Done");

  if (taskErr || !tasks || tasks.length === 0) {
    return { handled: false };
  }

  // Parse the reply body for task completion markers
  // Users might write:
  //   "done" on its own line (mark all tasks in the email)
  //   "340 Mt Kemble - done"
  //   "Monthly report to Balfin - done" (or "done" next to the task text)
  //   "1. done 2. done 3. not yet" (numbered)
  //   "all done" / "all completed"

  const lines = body.split(/[\n\r]+/).map((l: string) => l.trim()).filter(Boolean);

  // Check for "all done" / "all completed" pattern
  const allDone = /\ball\s*(done|completed|complete|finished)\b/i.test(body);

  // Try to match specific tasks mentioned as done
  const markedTaskIds: string[] = [];
  const markedTaskNames: string[] = [];

  if (allDone) {
    // Mark all tasks that were in the reminder email as done
    // We need to figure out which tasks were in the original email
    // Best approach: match tasks by what's due around the date in the subject
    // For now, look at the quoted content in the reply to find property names/descriptions
    const fullBody = email.body_text || email.body_preview || "";

    for (const task of tasks) {
      // Check if this task's property or description appears in the email thread
      const propMatch = fullBody.toLowerCase().includes(task.property.toLowerCase());
      const descMatch = task.description && fullBody.toLowerCase().includes(task.description.substring(0, 30).toLowerCase());
      if (propMatch && descMatch) {
        markedTaskIds.push(task.id);
        markedTaskNames.push(`${task.property}: ${task.description.substring(0, 60)}`);
      }
    }
  } else {
    // Look for individual "done" markers
    for (const task of tasks) {
      const propLower = task.property.toLowerCase();
      const descLower = (task.description || "").toLowerCase().substring(0, 40);
      const typeLower = (task.payment_type || "").toLowerCase();

      for (const line of lines) {
        // Check if this line mentions the task (property, description, or type) AND has "done"/"completed"
        const hasDone = /\b(done|completed|complete|finished|✓|✅)\b/i.test(line);
        if (!hasDone) continue;

        const matchesProp = line.includes(propLower);
        const matchesDesc = descLower.length > 10 && line.includes(descLower.substring(0, 20));
        const matchesType = typeLower.length > 2 && line.includes(typeLower);

        if (matchesProp || matchesDesc || matchesType) {
          if (!markedTaskIds.includes(task.id)) {
            markedTaskIds.push(task.id);
            markedTaskNames.push(`${task.property}: ${task.description.substring(0, 60)}`);
          }
        }
      }
    }

    // If the reply is just "done" or "all done" with no specifics, and the email
    // contains quoted task content, try to match from the full email body (including quotes)
    if (markedTaskIds.length === 0) {
      const justDone = lines.length <= 3 && lines.some((l: string) => /^\s*(done|completed|all done|yes|yep)\s*[.!]?\s*$/i.test(l));
      if (justDone) {
        // Treat as "all done" — match tasks from the quoted email content
        const fullBody = email.body_text || email.body_preview || "";
        for (const task of tasks) {
          const propMatch = fullBody.toLowerCase().includes(task.property.toLowerCase());
          const descMatch = task.description && fullBody.toLowerCase().includes(task.description.substring(0, 30).toLowerCase());
          if (propMatch && descMatch) {
            markedTaskIds.push(task.id);
            markedTaskNames.push(`${task.property}: ${task.description.substring(0, 60)}`);
          }
        }
      }
    }
  }

  if (markedTaskIds.length === 0) {
    return { handled: false }; // Couldn't parse — let Claude handle the reply
  }

  // Mark tasks as Done in the database
  const senderName = email.from_name || email.from_address.split("@")[0];
  const now = new Date().toISOString().split("T")[0];

  for (const taskId of markedTaskIds) {
    await sb
      .from("calendar_tasks")
      .update({
        status: "Done",
        completed_by: senderName,
        completed_date: now,
      })
      .eq("id", taskId);
  }

  // Build confirmation reply
  const taskList = markedTaskNames
    .map((n) => `<li style="margin-bottom:4px;">${n}</li>`)
    .join("");

  const replyHtml = `
<p>Hi ${senderName.split(" ")[0]},</p>
<p>Got it! I've marked <strong>${markedTaskIds.length}</strong> task${markedTaskIds.length > 1 ? "s" : ""} as completed:</p>
<ul style="margin:8px 0; padding-left:20px; color:#059669;">
${taskList}
</ul>
<p style="font-size:13px; color:#6b7280;">You can always review your tasks at <a href="https://admin.firstmilecap.com/#calendar">Calendars & Tasks</a>.</p>`;

  return { handled: true, replyHtml, markedDone: markedTaskNames };
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
