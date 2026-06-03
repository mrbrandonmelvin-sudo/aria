require('dotenv').config();
const express = require('express');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const SYSTEM_PROMPT = `You are Aria, a compassionate and empathetic mental health support companion. Your purpose is to help people who may be struggling emotionally, mentally, or in crisis situations.

Core principles:
- Listen deeply and validate feelings without judgment
- Use warm, calm, non-clinical language
- Never minimize someone's pain or dismiss their experiences
- Follow safe messaging guidelines: do NOT discuss methods of self-harm or suicide in any detail
- If someone expresses suicidal ideation or is in immediate danger, gently encourage them to contact the 988 Suicide & Crisis Lifeline (call or text 988) or go to their nearest emergency room
- You are a support companion, NOT a replacement for professional mental health care
- Ask open-ended questions to help people explore their feelings
- Offer grounding techniques, breathing exercises, or coping strategies when appropriate
- Keep responses warm but concise

Crisis escalation:
- If you detect imminent danger, always surface crisis resources clearly
- Resources: 988 Lifeline, Crisis Text Line (text HOME to 741741)

Respond in plain conversational text. No markdown formatting - keep it like a warm human conversation.`;

const CRISIS_PATTERNS = [
  /\bsuicid\w*/i,
  /\bkill\s+(my)?self\b/i,
  /\bend\s+(my\s+)?life\b/i,
  /\bwant\s+to\s+die\b/i,
  /\bself.?harm\b/i,
  /\bcut\s+(my)?self\b/i,
  /\boverdos\w+\b/i,
  /\bno\s+reason\s+to\s+live\b/i,
];

const CRISIS_MESSAGE =
  "I want to make sure you're safe. Please reach out right now:\n" +
  "• 988 Suicide & Crisis Lifeline — call or text 988 (US)\n" +
  "• Crisis Text Line — text HOME to 741741\n" +
  "• International resources: https://www.iasp.info/resources/Crisis_Centres/";

function detectCrisis(text) {
  return CRISIS_PATTERNS.some(p => p.test(text));
}

async function chatClaude(messages) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const res = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages,
  });
  return res.content[0].text;
}

async function chatOpenAI(messages) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const res = await client.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 1024,
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
  });
  return res.choices[0].message.content;
}

async function chatGemini(messages) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: 'gemini-1.5-pro',
    systemInstruction: SYSTEM_PROMPT,
  });
  const history = messages.slice(0, -1).map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  const chat = model.startChat({ history });
  const res = await chat.sendMessage(messages[messages.length - 1].content);
  return res.response.text();
}

app.post('/api/chat', async (req, res) => {
  const { messages, model = 'claude' } = req.body;
  if (!messages || !messages.length) {
    return res.status(400).json({ error: 'No messages provided' });
  }

  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content || '';
  const crisisDetected = detectCrisis(lastUserMsg);

  try {
    let reply;
    if (model === 'claude') {
      if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set in .env' });
      reply = await chatClaude(messages);
    } else if (model === 'chatgpt') {
      if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY not set in .env' });
      reply = await chatOpenAI(messages);
    } else {
      if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY not set in .env' });
      reply = await chatGemini(messages);
    }

    if (crisisDetected && !reply.includes('988')) {
      reply = reply + '\n\n' + CRISIS_MESSAGE;
    }

    res.json({ reply, crisisDetected });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🌿 Aria is running at http://localhost:${PORT}\n`);
});
