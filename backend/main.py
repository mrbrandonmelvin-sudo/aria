import os
import re
from typing import List, Literal
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import anthropic
import openai
import google.generativeai as genai

load_dotenv()

app = FastAPI(title="Aria Mental Health Companion")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

SYSTEM_PROMPT = """You are Aria, a compassionate and empathetic mental health support companion. Your purpose is to help people who may be struggling emotionally, mentally, or in crisis situations.

Core principles:
- Listen deeply and validate feelings without judgment
- Use warm, calm, non-clinical language
- Never minimize someone's pain or dismiss their experiences
- Follow safe messaging guidelines: do NOT discuss methods of self-harm or suicide in any detail
- If someone expresses suicidal ideation, intent, or is in immediate danger, gently but clearly encourage them to contact the 988 Suicide & Crisis Lifeline (call or text 988) or go to their nearest emergency room
- You are a support companion, NOT a replacement for professional mental health care - remind users of this periodically and encourage professional help
- Ask open-ended questions to help people explore their feelings
- Offer grounding techniques, breathing exercises, or coping strategies when appropriate
- Keep responses warm but concise - do not overwhelm someone in distress with walls of text

Crisis escalation:
- If you detect imminent danger (suicidal intent, self-harm, abuse, violence), always surface crisis resources clearly
- Example resources: 988 Lifeline, Crisis Text Line (text HOME to 741741), International Association for Suicide Prevention (https://www.iasp.info/resources/Crisis_Centres/)

You respond in plain conversational text. Do not use markdown formatting like **bold** or bullet points - keep it like a warm human conversation."""

CRISIS_KEYWORDS = [
    r"\bsuicid\w*\b",
    r"\bkill\s+(my)?self\b",
    r"\bend\s+(my\s+)?life\b",
    r"\bwant\s+to\s+die\b",
    r"\bself.?harm\b",
    r"\bcut\s+(my)?self\b",
    r"\boverdos\w*\b",
    r"\bno\s+reason\s+to\s+live\b",
    r"\bgoodbye\s+(forever|cruel)\b",
]

CRISIS_BANNER = (
    "I want to make sure you're safe. Please reach out right now:\n"
    "• 988 Suicide & Crisis Lifeline - call or text 988 (US)\n"
    "• Crisis Text Line - text HOME to 741741\n"
    "• International resources: https://www.iasp.info/resources/Crisis_Centres/"
)


def detect_crisis(text: str) -> bool:
    lower = text.lower()
    return any(re.search(p, lower) for p in CRISIS_KEYWORDS)


class Message(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    messages: List[Message]
    model: Literal["claude", "chatgpt", "gemini"] = "claude"


class ChatResponse(BaseModel):
    reply: str
    crisis_detected: bool


def chat_claude(messages: List[Message]) -> str:
    key = os.getenv("ANTHROPIC_API_KEY")
    if not key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")
    client = anthropic.Anthropic(api_key=key)
    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        system=SYSTEM_PROMPT,
        messages=[{"role": m.role, "content": m.content} for m in messages],
    )
    return response.content[0].text


def chat_openai(messages: List[Message]) -> str:
    key = os.getenv("OPENAI_API_KEY")
    if not key:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY not configured")
    client = openai.OpenAI(api_key=key)
    formatted = [{"role": "system", "content": SYSTEM_PROMPT}]
    formatted += [{"role": m.role, "content": m.content} for m in messages]
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=formatted,
        max_tokens=1024,
    )
    return response.choices[0].message.content


def chat_gemini(messages: List[Message]) -> str:
    key = os.getenv("GEMINI_API_KEY")
    if not key:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not configured")
    genai.configure(api_key=key)
    model = genai.GenerativeModel(
        model_name="gemini-1.5-pro",
        system_instruction=SYSTEM_PROMPT,
    )
    history = []
    for m in messages[:-1]:
        history.append({
            "role": "user" if m.role == "user" else "model",
            "parts": [m.content],
        })
    chat = model.start_chat(history=history)
    response = chat.send_message(messages[-1].content)
    return response.text


@app.post("/api/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    if not req.messages:
        raise HTTPException(status_code=400, detail="No messages provided")

    last_user_msg = next(
        (m.content for m in reversed(req.messages) if m.role == "user"), ""
    )
    crisis = detect_crisis(last_user_msg)

    try:
        if req.model == "claude":
            reply = chat_claude(req.messages)
        elif req.model == "chatgpt":
            reply = chat_openai(req.messages)
        else:
            reply = chat_gemini(req.messages)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI provider error: {str(e)}")

    if crisis and CRISIS_BANNER not in reply:
        reply = reply + "\n\n" + CRISIS_BANNER

    return ChatResponse(reply=reply, crisis_detected=crisis)


frontend_dir = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.isdir(frontend_dir):
    app.mount("/static", StaticFiles(directory=frontend_dir), name="static")

    @app.get("/")
    async def root():
        return FileResponse(os.path.join(frontend_dir, "index.html"))
