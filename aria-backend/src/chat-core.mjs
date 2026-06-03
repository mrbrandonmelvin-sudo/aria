import Anthropic from "@anthropic-ai/sdk";

const SYSTEM_PROMPT = "You are Aria, a compassionate mental health support companion. Listen deeply, validate feelings without judgment, use warm non-clinical language. Never discuss methods of self-harm. If someone is in crisis, encourage them to call or text 988. You are a companion, not a therapist.";

export function healthPayload() {
  return { status: "ok", model: "claude-sonnet-4-6", keyConfigured: !!process.env.ANTHROPIC_API_KEY };
}

export function buildMessages(body) {
  if (Array.isArray(body.messages) && body.messages.length > 0) return body.messages;
  const message = body.message?.trim();
  if (!message) throw new Error("Request body must include message or messages.");
  return [{ role: "user", content: message }];
}

export async function runChat(body) {
  const messages = buildMessages(body);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured - check your .env file");
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages
  });
  return { reply: response.content[0].text, model: "claude-sonnet-4-6", usage: response.usage };
}
