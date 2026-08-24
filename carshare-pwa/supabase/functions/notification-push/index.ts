import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import * as webpush from "jsr:@negrel/webpush@0.5.0";

type NotificationRecord = {
  id: string;
  recipient_id: string;
  event_type: string;
  title: string;
  body: string;
  action_path: string;
  payload: Record<string, unknown>;
};

type WebhookPayload = {
  type?: string;
  table?: string;
  schema?: string;
  record?: NotificationRecord;
};

function response(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "Content-Type": "application/json" } });
}

function defaultSecretKey() {
  const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
  return keys.default || Object.values(keys)[0];
}

function isWebhookAuthorized(request: Request) {
  const actual = request.headers.get("x-notification-webhook-secret") || "";
  const expected = Deno.env.get("NOTIFICATION_WEBHOOK_SECRET") || "";
  return actual.length > 0 && expected.length > 0 && actual === expected;
}

function validRecord(record: NotificationRecord | undefined): record is NotificationRecord {
  return Boolean(record
    && typeof record.id === "string"
    && typeof record.recipient_id === "string"
    && typeof record.event_type === "string"
    && typeof record.title === "string"
    && typeof record.body === "string"
    && typeof record.action_path === "string"
    && record.payload !== null
    && typeof record.payload === "object"
    && !Array.isArray(record.payload)
    && record.action_path.startsWith("/")
    && !record.action_path.startsWith("//")
    && !record.action_path.includes("\\"));
}

async function applicationServer() {
  const serialized = Deno.env.get("NOTIFICATION_VAPID_KEYS_JSON");
  const subject = Deno.env.get("NOTIFICATION_VAPID_SUBJECT");
  if (!serialized || !subject) throw new Error("VAPID notification secrets are not configured.");
  const vapidKeys = await webpush.importVapidKeys(JSON.parse(serialized));
  return webpush.ApplicationServer.new({ contactInformation: subject, vapidKeys });
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return response({ error: "POST required" }, 405);
  if (!isWebhookAuthorized(request)) return response({ error: "Unauthorized" }, 401);
  try {
    const payload = await request.json() as WebhookPayload;
    if (payload.type !== "INSERT" || payload.schema !== "public" || payload.table !== "user_notifications" || !validRecord(payload.record)) {
      return response({ error: "Invalid notification webhook payload." }, 400);
    }
    const record = payload.record;
    const admin = createClient(Deno.env.get("SUPABASE_URL") || "", defaultSecretKey() as string, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: subscriptions, error } = await admin
      .from("web_push_subscriptions")
      .select("endpoint, p256dh, auth")
      .eq("user_id", record.recipient_id);
    if (error) throw error;

    const server = await applicationServer();
    const isVoiceCall = record.event_type === "voice_call";
    const callId = typeof record.payload.callId === "string" ? record.payload.callId : null;
    const message = JSON.stringify({
      notificationId: record.id,
      title: record.title,
      body: record.body,
      actionPath: record.action_path,
      eventType: record.event_type,
      callId,
    });
    const outcomes = await Promise.all((subscriptions || []).map(async (subscription) => {
      try {
        const subscriber = server.subscribe({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        });
        await subscriber.pushTextMessage(message, {
          // A delayed call alert is actively misleading after the 45-second
          // ringing window; durable ride/message alerts retain one-day TTL.
          ttl: isVoiceCall ? 45 : 60 * 60 * 24,
          urgency: webpush.Urgency.High,
          topic: `notification-${record.id}`,
        });
        return "delivered" as const;
      } catch (pushError) {
        if (pushError instanceof webpush.PushMessageError && pushError.isGone()) {
          await admin.from("web_push_subscriptions").delete().eq("endpoint", subscription.endpoint);
          return "removed" as const;
        }
        console.error("Push delivery failed", { notificationId: record.id, pushError });
        return "failed" as const;
      }
    }));
    const delivered = outcomes.filter((outcome) => outcome === "delivered").length;
    const failed = outcomes.filter((outcome) => outcome === "failed").length;
    const removed = outcomes.filter((outcome) => outcome === "removed").length;
    return response({
      ok: failed === 0,
      attempted: outcomes.length,
      delivered,
      failed,
      removed,
    }, failed > 0 ? 502 : 200);
  } catch (error) {
    console.error(error);
    return response({ error: error instanceof Error ? error.message : "Push delivery failed." }, 500);
  }
});
