const SYSTEM_PROMPT = "You are Aria, a compassionate mental health support companion. Listen deeply, validate feelings without judgment, use warm non-clinical language. Never discuss methods of self-harm. If someone is in crisis, encourage them to call or text 988.";

export function healthPayload() {
  return { status: "ok", model: "gemini-1.5-flash", keyConfigured: !!process.env.GEMINI_API_KEY };
}

export function buildMessages(body) {
  if (Array.isArray(body.messages) && body.messages.length > 0) return body.messages;
  const message = body.message?.trim();
  if (!message) throw new Error("Request body must include message or messages.");
  return [{ role: "user", content: message }];
}

export async function runChat(body) {
  const messages = buildMessages(body);
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: messages.map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }]
      }))
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Gemini request failed");
  const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!reply) throw new Error("Gemini returned empty response");
  return { reply, model: "gemini-1.5-flash", usage: {} };
}
