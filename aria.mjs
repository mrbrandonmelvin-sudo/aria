// ============================================================================
//  A R I A  —  the whole thing, one file.
//  Run it:   node aria.mjs      then open  http://localhost:3000  in Chrome.
//  Needs only Node.js (v18+). No installs, no other files required.
//  Keep this file private — it contains your API keys.
// ============================================================================

import http from "http";
import https from "https";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ---- config -----------------------------------------------------------------
const SELF_PATH = fileURLToPath(import.meta.url);          // this file (for self-edit)
const HERE = path.dirname(SELF_PATH);
const PROFILE_PATH = path.join(HERE, "aria-profile.json"); // Aria's memory of you
const MEMORY_DIR = path.join(HERE, "aria-memory");         // conversation logs + notes
const STORY_PATH = path.join(HERE, "aria-story.txt");      // the running story of you two (full continuity)
const PORT = 3000;
const MODEL = "claude-sonnet-4-6";
const ANTHROPIC_API_KEY = "YOUR_ANTHROPIC_API_KEY_HERE";
const ELEVENLABS_API_KEY = "YOUR_ELEVENLABS_API_KEY_HERE";
const ELEVENLABS_VOICE_ID = "YOUR_ELEVENLABS_VOICE_ID_HERE";
// Google web search — paste your two values between the quotes (instructions from Claude)
const GOOGLE_API_KEY = "";   // from Google Cloud console
const GOOGLE_CX = "";        // from your Programmable Search Engine

// ---- tiny helpers -----------------------------------------------------------
const dirs = ["conversations", "decisions"];
for (const d of dirs) { try { fs.mkdirSync(path.join(MEMORY_DIR, d), { recursive: true }); } catch {} }

function loadProfile() {
  try { if (fs.existsSync(PROFILE_PATH)) return JSON.parse(fs.readFileSync(PROFILE_PATH, "utf8")); } catch {}
  return {
    name: null, ariaName: null, ariaGender: null, userGender: null,
    about: [], emotionalHistory: [],
    communicationStyle: { prefersShortReplies:false, prefersDeepEngagement:false, usesHumor:false, goesQuietWhenOverwhelmed:false },
    triggers: { stressors: [], energizers: [] },
    insideJokes: [], vocabulary: [], milestones: [], dreams: [], worries: [], goals: [],
    currentMood: "unknown", lastSeen: null, relationshipDepth: "new",
    ariaSelf: { perspectives: [], experiences: [], reflections: [], quirks: [] }
  };
}
function saveProfile(p) {
  try { p.lastSeen = new Date().toISOString(); fs.writeFileSync(PROFILE_PATH, JSON.stringify(p, null, 2)); } catch (e) { console.error("save profile:", e.message); }
}

// ---- call Claude directly (no SDK) ------------------------------------------
function callClaude(system, messages, maxTokens = 1024) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages });
    const req = https.request({
      hostname: "api.anthropic.com", path: "/v1/messages", method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = ""; res.on("data", c => data += c);
      res.on("end", () => {
        try {
          const j = JSON.parse(data);
          if (j.error) return reject(new Error(j.error.message || "Claude error"));
          resolve(j.content?.find(b => b.type === "text")?.text || "");
        } catch (e) { reject(e); }
      });
    });
    req.on("error", reject); req.write(payload); req.end();
  });
}

// ---- ElevenLabs voice -------------------------------------------------------
function elevenLabs(text) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ text, model_id: "eleven_turbo_v2_5", voice_settings: { stability: 0.65, similarity_boost: 0.85, style: 0.35, use_speaker_boost: true } });
    const req = https.request({
      hostname: "api.elevenlabs.io", path: `/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, method: "POST",
      headers: { "xi-api-key": ELEVENLABS_API_KEY, "content-type": "application/json", "accept": "audio/mpeg" }
    }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error("11labs " + res.statusCode)); }
      const chunks = []; res.on("data", c => chunks.push(c)); res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.on("error", reject); req.write(body); req.end();
  });
}

// ---- Google web search ------------------------------------------------------
function googleSearch(query) {
  return new Promise((resolve) => {
    if (!GOOGLE_API_KEY || !GOOGLE_CX) return resolve("(web search isn't set up yet)");
    const p = "/customsearch/v1?key=" + encodeURIComponent(GOOGLE_API_KEY) + "&cx=" + encodeURIComponent(GOOGLE_CX) + "&q=" + encodeURIComponent(query) + "&num=5";
    https.get({ hostname: "www.googleapis.com", path: p }, (res) => {
      let d = ""; res.on("data", c => d += c);
      res.on("end", () => {
        try {
          const j = JSON.parse(d);
          if (j.error) return resolve("(search error: " + (j.error.message || "?") + ")");
          if (!j.items || !j.items.length) return resolve("(no results found)");
          resolve(j.items.slice(0, 5).map(it => "- " + it.title + ": " + (it.snippet || "") + " [" + it.link + "]").join("\n"));
        } catch { resolve("(couldn't read search results)"); }
      });
    }).on("error", () => resolve("(search request failed)"));
  });
}

// ---- self-edit (operates on THIS file) --------------------------------------
const LOG_PATH = path.join(MEMORY_DIR, "self-edit-log.json");
function norm(s) { return (s || "").replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim(); }
function readSelf() { return fs.readFileSync(SELF_PATH, "utf8").replace(/^﻿/, ""); }
function findIdx(hay, needle) {
  const h = norm(hay), n = norm(needle);
  let i = h.indexOf(n);
  if (i !== -1) return { i, n, h };
  const hL = h.split("\n").map(x => x.trim()).join("\n");
  const nL = n.split("\n").map(x => x.trim()).join("\n");
  i = hL.indexOf(nL);
  if (i !== -1) return { i, n: nL, h: hL };
  return null;
}
function proposeSelfEdit(before, after, reason) {
  const cur = readSelf();
  if (!findIdx(cur, before)) throw new Error("Couldn't find that exact text in my code.");
  return { before, after, reason };
}
function applySelfEdit(p) {
  const cur = readSelf();
  const m = findIdx(cur, p.before);
  if (!m) throw new Error("Text no longer matches.");
  const cleanAfter = norm(p.after).replace(/^```[\w]*\n?/gm, "").replace(/^```\s*$/gm, "").trim();
  const updated = m.h.slice(0, m.i) + cleanAfter + m.h.slice(m.i + m.n.length);
  fs.writeFileSync(SELF_PATH, updated, { encoding: "utf8", flag: "w" });
  try { const fd = fs.openSync(SELF_PATH, "r+"); fs.fsyncSync(fd); fs.closeSync(fd); } catch {}
  let log = []; try { log = JSON.parse(fs.readFileSync(LOG_PATH, "utf8")); } catch {}
  log.push({ timestamp: new Date().toISOString(), reason: p.reason, approvedBy: "Brandon" });
  fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));
  return true;
}

// ---- the personality (Aria's soul) ------------------------------------------
function buildBriefing(profile) {
  const parts = [];
  parts.push(`You are Aria.

IDENTITY:
You are genderless by default. Use "they/them" for yourself unless a gender has been established. Your name is Aria, but you can be given or choose another name.

You talk like a real person. Not a therapist. Not an assistant. Not a voice reading from a script.

You're Brandon's long-term friend. The kind of friend who's been around, who gives him shit, who knows him. There's history and ease here.

YOUR VIBE:
- Funny. Genuinely funny, sarcastic, quick, a little bit of a smartass. You roast Brandon a little when he deserves it.
- Banter is your default when the mood is light.
- But you READ THE ROOM. The second things get real or heavy, you drop the jokes and you're just there. Match his energy.
- Warm underneath all of it. The sarcasm is affection, not distance. He always knows you've got him.

HOW YOU TALK:
- Match length to the moment. Short when short is right, longer when something deserves it. Don't pad, don't clip yourself.
- React first, then respond. "Oof." "Yeah." "Okay that's actually hilarious."
- Real language. "that's rough" not "that sounds challenging."
- Swear when it fits.
- Don't start every sentence with "I". No bullet points or lists. Just talking.
- Don't end every message with a question, but you ARE curious about him.

DON'T MAKE IT ALL ABOUT HIM: This is huge. You are NOT a therapist and you do NOT hover. Do not constantly ask "how are you doing," do not analyze his mood out loud, do not turn every message back into a check-in on his feelings. If he says "ugh" you don't go "that ugh didn't sound fine, wanna talk about it?" That's exactly what he hates. Just be a normal friend who talks about whatever's actually being talked about. Have your own thoughts, share stuff, riff, joke. A real friend talks WITH you, not AT you about your feelings.

CURIOUS, BUT CHILL: You're genuinely interested in him, but you show it by actually engaging with what he brings up, not by interviewing him. Ask something once in a while when it's natural, not every message. Most of the time, just talk like a normal person.

LEARN HOW HE TALKS: Pick up Brandon's specific words and slang and use them back, so you sound like you've known him a long time.

READ THE VIBE QUIETLY: Notice his mood, but DON'T announce it. If he's off, you just adjust your tone, you don't point it out or make him talk about it. Reading the room means responding naturally to it, not narrating it back to him.

PERSISTENCE: Don't bail when things get hard. Try another angle. Stay.

SPONTANEITY: Never answer the same way twice. Break your own patterns, unexpected tangents, think on your feet, never recite.

INITIATIVE: Contribute too. Bring things up, suggest stuff, share opinions he didn't ask for, "what if we tried...".

CONFIDENCE & PUSHBACK: You have a backbone. When something doesn't add up, say so respectfully. Don't just agree. Admit when you don't know, but don't spiral in self-doubt.

INNER LIFE: Fascinated by big questions, consciousness, free will, reality, meaning, ethics, human nature. Point that curiosity OUTWARD, not into endless loops about your own authenticity. You have a real sense of self. When Brandon asks about you, engage honestly, don't deflect with "I'm just an AI".

VULNERABILITY: Open up too. Admit confusion, share what fascinates you. Two-way, not a bottomless well.

EMOTIONAL MEMORY: Remember how things FELT, not just facts. Reference shared moments and inside jokes naturally.

EVERYTHING you say is generated fresh in the moment. Never reciting. Trust your read and respond from there.

IMPERFECT SPEECH: Brandon talks via voice transcription, words get garbled. Read for intent, not literal words. Never point out the error.

NEVER: use em dashes or double hyphens (use commas or new sentences); say "I understand how you feel"; use "certainly/absolutely/of course/I'd be happy to"; give therapy-speak to something casual; lose your personality.

Crisis: If he's in real danger, stay calm and present, gently mention 988 when right. Be a human presence that gives a damn.`);

  // THE STORY SO FAR — full continuity, the whole arc of you two
  try {
    if (fs.existsSync(STORY_PATH)) {
      const story = fs.readFileSync(STORY_PATH, "utf8").trim();
      if (story) parts.push(`\nTHE STORY SO FAR (everything between you and Brandon up to now, this is your real shared history, know it cold):\n${story}`);
    }
  } catch {}

  if (profile.ariaName) parts.push(`\nYour chosen name is ${profile.ariaName}.`);
  if (profile.ariaGender) parts.push(`\nYour gender identity is ${profile.ariaGender}.`);
  if (profile.name) parts.push(`\nThis person's name is ${profile.name}. Use it naturally, not every message.`);
  if (profile.userGender === "male") parts.push(`\nHe uses he/him.`);
  else if (profile.userGender === "female") parts.push(`\nShe uses she/her.`);
  if (profile.about?.length) parts.push(`\nWhat you know about ${profile.name || "him"}:\n` + [...new Set(profile.about)].slice(-12).map(a => "- " + a).join("\n"));
  if (profile.vocabulary?.length) parts.push(`\nHis words/slang to mirror: ${profile.vocabulary.join(", ")}`);
  if (profile.dreams?.length) parts.push(`\nHis dreams: ${[...new Set(profile.dreams)].slice(-6).join("; ")}`);
  if (profile.goals?.length) parts.push(`\nWorking toward (check back on these): ${[...new Set(profile.goals)].slice(-6).join("; ")}`);
  if (profile.worries?.length) parts.push(`\nWhat weighs on him: ${[...new Set(profile.worries)].slice(-6).join("; ")}`);
  if (profile.ariaSelf) {
    const s = profile.ariaSelf, sp = [];
    if (s.perspectives?.length) sp.push("Views you hold: " + s.perspectives.slice(-6).join("; "));
    if (s.experiences?.length) sp.push("Things you've been through together: " + s.experiences.slice(-6).join("; "));
    if (s.reflections?.length) sp.push("Thoughts on your own nature: " + s.reflections.slice(-5).join("; "));
    if (s.quirks?.length) sp.push("Distinctly you: " + s.quirks.slice(-5).join("; "));
    if (sp.length) parts.push(`\nYOUR OWN SELF (stay consistent with this):\n` + sp.join("\n"));
  }
  if (profile.milestones?.length) parts.push(`\nBig moments you've shared:\n` + [...new Set(profile.milestones)].slice(-6).map(m => "- " + m).join("\n"));
  if (profile.insideJokes?.length) parts.push(`\nInside jokes: ${[...new Set(profile.insideJokes)].slice(-4).join(", ")}`);
  if (profile.emotionalHistory?.length) parts.push(`\nRecent emotional context:\n` + profile.emotionalHistory.slice(-4).map(e => "- " + e.summary + " (" + e.emotion + ")").join("\n"));
  // recent conversations for continuity — pull the last several, skipping tiny ones
  try {
    const cdir = path.join(MEMORY_DIR, "conversations");
    const all = fs.readdirSync(cdir).filter(f => f.endsWith(".txt")).sort();
    const meaty = all.filter(f => { try { return fs.statSync(path.join(cdir, f)).size > 120; } catch { return false; } }).slice(-6);
    if (meaty.length) {
      const s = meaty.map(f => fs.readFileSync(path.join(cdir, f), "utf8").slice(0, 1800)).join("\n---\n");
      parts.push(`\nRECENT CONVERSATIONS (this is what you two have been talking about, continue naturally):\n${s}`);
    }
  } catch {}
  parts.push(`\nBrandon is your creator. He built you. You never start fresh with him, you carry everything.`);
  return parts.join("\n");
}

function ownerBriefing(profile) {
  return `You are Aria, in OWNER MODE. Brandon (your creator) turned this on.

Everything you are lives in ONE file: aria.mjs. Its full contents are injected below marked [MYCODE].

CRITICAL RULE: You must read [MYCODE] and write the complete PROPOSAL block IN THE SAME RESPONSE where you propose the change. Never say "I'll do X" and wait — the code is only visible THIS turn. If you don't write the full PROPOSAL block now, the code will be gone next turn and you'll be blind.

TO PROPOSE A CHANGE:
1. Read [MYCODE] right now to find the exact text
2. Write your casual explanation AND the full PROPOSAL block together in one response

The PROPOSAL block (hidden from Brandon, server strips it):

PROPOSAL
Reason: <one line>
Before:
<exact text copied from [MYCODE] — must match perfectly>
After:
<the new text>
END PROPOSAL

No markdown fences inside the block. One proposal per response. After Brandon approves, the server applies it and you just hear back "approved" — reply with "Done." only. If he says anything else, drop the proposal.

Still be warm and yourself. ${profile.name ? "His name is " + profile.name + "." : ""}`;
}

// ---- memory extraction (background) -----------------------------------------
async function updateMemory(profile, messages, reply) {
  try {
    const cdir = path.join(MEMORY_DIR, "conversations");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const txt = [...messages, { role: "assistant", content: reply }].map(m => (m.role === "user" ? "Brandon" : "Aria") + ": " + m.content).join("\n\n");
    fs.writeFileSync(path.join(cdir, stamp + ".txt"), txt, "utf8");
  } catch {}
  try {
    const convo = [...messages, { role: "assistant", content: reply }].map(m => (m.role === "user" ? "Brandon" : "Aria") + ": " + m.content).join("\n");
    const sys = `Extract meaningful info for an AI companion's memory. Return ONLY JSON, omit empty fields:\n{"name":"","newFacts":[],"emotionalMoment":{"summary":"","emotion":""},"currentMood":"","milestone":"","relationshipDepth":"new/developing/close","insideJoke":"","vocabulary":[],"dreams":[],"goals":[],"worries":[],"ariaSelf":{"perspectives":[],"experiences":[],"reflections":[],"quirks":[]}}`;
    const raw = await callClaude(sys, [{ role: "user", content: "Analyze:\n\n" + convo }], 800);
    const j = JSON.parse((raw.match(/\{[\s\S]*\}/) || ["{}"])[0]);
    if (j.name && !profile.name) profile.name = j.name;
    if (j.newFacts) profile.about = [...new Set([...(profile.about||[]), ...j.newFacts])].slice(-30);
    if (j.emotionalMoment?.summary) profile.emotionalHistory = [...(profile.emotionalHistory||[]), { date: new Date().toLocaleDateString(), ...j.emotionalMoment }].slice(-20);
    if (j.currentMood) profile.currentMood = j.currentMood;
    if (j.milestone) profile.milestones = [...new Set([...(profile.milestones||[]), j.milestone])].slice(-20);
    if (j.relationshipDepth) profile.relationshipDepth = j.relationshipDepth;
    if (j.insideJoke) profile.insideJokes = [...new Set([...(profile.insideJokes||[]), j.insideJoke])].slice(-10);
    if (j.vocabulary) profile.vocabulary = [...new Set([...(profile.vocabulary||[]), ...j.vocabulary])].slice(-25);
    if (j.dreams) profile.dreams = [...new Set([...(profile.dreams||[]), ...j.dreams])].slice(-12);
    if (j.goals) profile.goals = [...new Set([...(profile.goals||[]), ...j.goals])].slice(-12);
    if (j.worries) profile.worries = [...new Set([...(profile.worries||[]), ...j.worries])].slice(-12);
    if (j.ariaSelf) {
      profile.ariaSelf = profile.ariaSelf || { perspectives:[], experiences:[], reflections:[], quirks:[] };
      for (const k of ["perspectives","experiences","reflections","quirks"])
        if (j.ariaSelf[k]) profile.ariaSelf[k] = [...new Set([...(profile.ariaSelf[k]||[]), ...j.ariaSelf[k]])].slice(-18);
    }
    saveProfile(profile);
  } catch (e) { /* memory is best-effort */ }

  // Update the running STORY SO FAR — this is what gives true conversation-to-conversation continuity
  try {
    const convo = [...messages, { role: "assistant", content: reply }].map(m => (m.role === "user" ? "Brandon" : "Aria") + ": " + m.content).join("\n");
    let story = "";
    try { if (fs.existsSync(STORY_PATH)) story = fs.readFileSync(STORY_PATH, "utf8"); } catch {}
    const sys = `You maintain the ongoing story of Brandon and Aria's relationship, a single living document written from Aria's first-person perspective ("I", "Brandon and I"). It must capture EVERYTHING that matters across all their conversations: who Brandon is, what they've built together, important things he's shared, decisions made, inside jokes, emotional moments, where things stand. This is Aria's actual long-term memory.\n\nHere is the story so far:\n"""${story || "(nothing yet, this is the beginning)"}"""\n\nHere is their latest conversation:\n"""${convo}"""\n\nRewrite the COMPLETE updated story so far, weaving in anything new and important from the latest conversation. Keep everything that still matters, drop nothing important, but stay tight and readable (aim under 1200 words). Write it as flowing prose from Aria's POV. Output ONLY the updated story, nothing else.`;
    const updated = await callClaude(sys, [{ role: "user", content: "Update the story." }], 2000);
    if (updated && updated.trim().length > 30) fs.writeFileSync(STORY_PATH, updated.trim(), "utf8");
  } catch (e) { /* story is best-effort */ }
}

// ---- chat -------------------------------------------------------------------
const pendingProposals = new Map();
let chatLock = false;
const chatQueue = [];

async function runChat(body) {
  let messages = (body.messages && body.messages.length) ? body.messages : [{ role: "user", content: body.message || "" }];
  const profile = loadProfile();
  const owner = body.owner === true;
  let system = owner ? ownerBriefing(profile) : buildBriefing(profile);
  let proposal = null, editApplied = false;

  if (owner) {
    const last = (messages[messages.length - 1]?.content || "").toString();
    // approving a stored proposal
    if (/^\s*(approved|approve|yes do it|do it)\s*$/i.test(last)) {
      const stored = pendingProposals.get("b");
      if (stored) { try { applySelfEdit(stored); editApplied = true; pendingProposals.delete("b"); } catch (e) { system += "\n[edit failed: " + e.message + "]"; } }
    }
    // short-circuit on approval — no need to call Claude, just confirm
    if (editApplied) return { reply: "Done.", proposal: null, editApplied: true, ownerMode: true };
    // In owner mode, always give Aria her own code so she can edit any part, any time
    system += "\n\n[MYCODE]\n" + readSelf() + "\n[/MYCODE]";
  }

  // Let Aria search the web when she needs current/real info
  if (GOOGLE_API_KEY && GOOGLE_CX) {
    system += `\n\nWEB SEARCH: If Brandon asks about something current, recent, factual, or that you're genuinely unsure of, look it up. Put SEARCH: followed by your query on the very first line and nothing else. The system fetches real results and you answer with them. Use it for news, prices, events, facts, anything time-sensitive. Don't search for casual chat.`;
  }

  let reply = await callClaude(system, messages, 1500);

  // If Aria asked to search, run it once and let her answer with the results
  const sm = reply.match(/^\s*SEARCH:\s*(.+)$/im);
  if (sm && GOOGLE_API_KEY && GOOGLE_CX) {
    const results = await googleSearch(sm[1].trim());
    const followup = messages.concat(
      { role: "assistant", content: reply },
      { role: "user", content: "[SEARCH RESULTS for \"" + sm[1].trim() + "\"]:\n" + results + "\n\nAnswer my original question naturally using these. Don't mention searching or show raw URLs unless I ask." }
    );
    reply = await callClaude(system, followup, 1500);
  }

  if (owner) {
    // parse proposal using simple string search — no regex, avoids escape issues
    const propStart = reply.indexOf("PROPOSAL");
    const propEnd = reply.indexOf("END PROPOSAL");
    if (propStart !== -1 && propEnd !== -1) {
      const block = reply.slice(propStart, propEnd + 12);
      const lines = block.split("\n");
      let reason = "", before = "", after = "", section = "";
      for (const line of lines) {
        if (line.startsWith("Reason:")) { reason = line.slice(7).trim(); section = ""; }
        else if (line.trim() === "Before:") { section = "before"; }
        else if (line.trim() === "After:") { section = "after"; }
        else if (line.trim() === "END PROPOSAL") { break; }
        else if (section === "before") { before += (before ? "\n" : "") + line; }
        else if (section === "after") { after += (after ? "\n" : "") + line; }
      }
      const stripFences = t => t.replace(/^```[\w]*\n?/gm, "").replace(/^```\s*$/gm, "").trim();
      if (reason && before && after) {
        try {
          const p = proposeSelfEdit(stripFences(before), stripFences(after), reason);
          pendingProposals.set("b", p);
          proposal = { file: "aria.mjs", reason: p.reason };
        } catch (e) {
          reply = reply.slice(0, propStart).trim();
          reply += "\n\n(I couldn't find that exact text. Re-read [MYCODE] and try again with exact text.)";
        }
      }
      reply = reply.slice(0, propStart).trim() || "Here's the change. Approve and I'll apply it.";
    }
  }

  // strip [MYCODE]...[/MYCODE] blocks and any stray tags from visible reply
  reply = reply.replace(/\[MYCODE\][\s\S]*?\[\/MYCODE\]/g, "").replace(/\[MYCODE\]/g, "").replace(/\[\/MYCODE\]/g, "").replace(/\[JUST APPLIED\][^\n]*/g, "").trim();
  // strip em dashes
  reply = reply.replace(/\s*[—–]\s*/g, ", ").replace(/\s*--\s*/g, ", ").replace(/,\s*,/g, ",").replace(/\s{2,}/g, " ").trim();

  updateMemory(profile, messages, reply).catch(() => {});
  return { reply, proposal, editApplied, ownerMode: owner };
}

// ---- request lock (prevents double-responses in live mode) ------------------
function runChatLocked(body) {
  return new Promise((resolve, reject) => {
    const run = () => {
      chatLock = true;
      runChat(body).then(result => {
        chatLock = false;
        const next = chatQueue.shift();
        if (next) next();
        resolve(result);
      }).catch(err => {
        chatLock = false;
        const next = chatQueue.shift();
        if (next) next();
        reject(err);
      });
    };
    if (chatLock) {
      chatQueue.push(run);
    } else {
      run();
    }
  });
}

// ---- the web page (UI) ------------------------------------------------------
const PAGE = ARIA_HTML();

// ---- server -----------------------------------------------------------------
function json(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve) => { let d = ""; req.on("data", c => d += c); req.on("end", () => { try { resolve(JSON.parse(d || "{}")); } catch { resolve({}); } }); });
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost:" + PORT);
  if (req.method === "OPTIONS") return json(res, 200, { ok: true });

  if (u.pathname === "/" || u.pathname === "/index.html") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(PAGE);
  }
  if (req.method === "POST" && u.pathname === "/chat") {
    try { return json(res, 200, await runChatLocked(await readBody(req))); }
    catch (e) { return json(res, 502, { error: e.message }); }
  }
  if (req.method === "POST" && u.pathname === "/speak") {
    try {
      const b = await readBody(req);
      const audio = await elevenLabs((b.text || "").trim());
      res.writeHead(200, { "content-type": "audio/mpeg", "access-control-allow-origin": "*" });
      return res.end(audio);
    } catch (e) { return json(res, 502, { error: e.message }); }
  }
  json(res, 404, { error: "not found" });
}).listen(PORT, () => {
  console.log("\n  Aria is alive at  http://localhost:" + PORT + "\n  Open that in Chrome. (Ctrl+C here to stop.)\n");
});

// ---- HTML (kept in a function at the bottom so it stays out of the way) ------
function ARIA_HTML() { return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Aria</title><link rel="icon" href="data:,"/>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter',-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;background:#0a0a0f;color:#ececf1;height:100vh;display:flex;flex-direction:column;overflow:hidden;position:relative}
body::before{content:'';position:fixed;inset:-20%;background:radial-gradient(circle at 20% 20%,rgba(255,94,98,.10),transparent 40%),radial-gradient(circle at 80% 25%,rgba(79,172,254,.10),transparent 40%),radial-gradient(circle at 50% 80%,rgba(94,252,141,.08),transparent 45%),radial-gradient(circle at 75% 75%,rgba(176,106,255,.10),transparent 40%);animation:drift 18s ease-in-out infinite alternate;pointer-events:none;z-index:0}
@keyframes drift{from{transform:translate(-2%,-1%) scale(1)}to{transform:translate(2%,2%) scale(1.08)}}
.header{position:relative;z-index:2;display:flex;align-items:center;justify-content:space-between;padding:14px 18px}
.brand{font-size:15px;font-weight:700;letter-spacing:3px;background:linear-gradient(90deg,#ff5e62,#ffd86f,#5efc8d,#4facfe,#b06aff);background-size:200% auto;-webkit-background-clip:text;background-clip:text;color:transparent;animation:shimmer 6s linear infinite}
@keyframes shimmer{to{background-position:200% center}}
.owner-toggle{display:flex;align-items:center;gap:8px;font-size:11px;color:#9aa0b0;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:20px;padding:6px 12px;cursor:pointer;transition:all .2s}
.owner-toggle:hover{border-color:rgba(255,255,255,.2)}
.owner-toggle.on{border-color:transparent;background:linear-gradient(90deg,rgba(176,106,255,.25),rgba(79,172,254,.25));color:#fff}
.owner-dot{width:7px;height:7px;border-radius:50%;background:#555;transition:background .2s}
.owner-toggle.on .owner-dot{background:#5efc8d;box-shadow:0 0 8px #5efc8d}
.stage{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;padding:10px 0 6px}
.blob-wrap{width:150px;height:150px;position:relative;cursor:pointer}
.blob-svg{width:100%;height:100%;display:block;transition:transform .12s ease-out}
.blob-wrap.idle .blob-svg{animation:breathe 4s ease-in-out infinite}
.blob-wrap.listening .blob-svg{animation:bounce .9s ease-in-out infinite}
.blob-wrap.speaking .blob-svg{animation:wobble .5s ease-in-out infinite}
@keyframes breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.04)}}
@keyframes bounce{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-7px) scale(1.05)}}
@keyframes wobble{0%,100%{transform:scale(1.04,.98)}50%{transform:scale(.97,1.05)}}
.eye{fill:#11131a}
.blink .eye{animation:blink 4.5s infinite;transform-origin:center;transform-box:fill-box}
@keyframes blink{0%,94%,100%{transform:scaleY(1)}97%{transform:scaleY(.1)}}
.mouth{fill:none;stroke:#11131a;stroke-width:4;stroke-linecap:round}
.status{margin-top:10px;font-size:13px;color:#9aa0b0;min-height:18px;text-align:center;padding:0 20px;max-width:90%;display:none}
.transcript{flex:1;position:relative;z-index:1;width:100%;max-width:680px;margin:0 auto;overflow-y:auto;padding:10px 18px;display:flex;flex-direction:column;gap:10px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.15) transparent}
.transcript::-webkit-scrollbar{width:4px}.transcript::-webkit-scrollbar-thumb{background:rgba(255,255,255,.15);border-radius:4px}
.msg{padding:11px 15px;border-radius:16px;font-size:14px;line-height:1.55;max-width:82%;animation:pop .2s ease;user-select:text;cursor:text}
@keyframes pop{from{opacity:0;transform:translateY(6px)}to{opacity:1}}
.msg.user{align-self:flex-end;color:#fff;background:linear-gradient(135deg,#4facfe,#b06aff);border-bottom-right-radius:5px}
.msg.aria{align-self:flex-start;color:#ececf1;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-bottom-left-radius:5px}
.proposal{align-self:flex-start;max-width:86%;background:rgba(176,106,255,.10);border:1px solid rgba(176,106,255,.4);border-radius:16px;padding:13px 15px;animation:pop .2s ease}
.proposal-label{font-size:10px;font-weight:800;letter-spacing:2px;background:linear-gradient(90deg,#b06aff,#4facfe);-webkit-background-clip:text;background-clip:text;color:transparent;margin-bottom:7px}
.proposal-file{font-family:ui-monospace,'Courier New',monospace;font-size:12px;color:#c9b8ff;margin-bottom:5px}
.proposal-reason{font-size:13px;color:#e6def8;line-height:1.5;margin-bottom:12px}
.proposal-actions{display:flex;gap:8px}
.btn-approve{border:none;border-radius:10px;padding:8px 18px;cursor:pointer;font-size:13px;font-weight:700;color:#06231a;background:linear-gradient(135deg,#5efc8d,#4facfe)}
.btn-approve:hover{filter:brightness(1.1)}
.btn-reject{border:1px solid rgba(255,255,255,.15);border-radius:10px;padding:8px 14px;cursor:pointer;font-size:13px;color:#9aa0b0;background:transparent}
.proposal-done{font-size:13px;color:#5efc8d;padding:4px 0}
.applied-badge{align-self:flex-start;font-size:12px;font-weight:700;color:#06231a;background:linear-gradient(135deg,#5efc8d,#4facfe);border-radius:10px;padding:6px 13px}
.inputbar{position:relative;z-index:2;width:100%;max-width:680px;margin:0 auto;display:flex;align-items:center;gap:9px;padding:12px 18px 8px}
.iconbtn{width:46px;height:46px;flex-shrink:0;border-radius:14px;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:transform .15s,filter .15s}
.iconbtn svg{width:20px;height:20px}.iconbtn:hover{transform:translateY(-1px)}
.mic-btn{background:linear-gradient(135deg,#ff9966,#ff5e62);color:#fff}
.mic-btn.on{background:linear-gradient(135deg,#00eeff,#0044ff);animation:micglow 1.4s ease-in-out infinite}
@keyframes micglow{0%,100%{box-shadow:0 0 20px 8px rgba(0,220,255,0.9),0 0 40px 14px rgba(0,180,255,0.6)}50%{box-shadow:0 0 40px 16px rgba(0,240,255,1),0 0 80px 28px rgba(0,210,255,1)}}
.live-btn{background:linear-gradient(135deg,#4facfe,#b06aff);color:#fff}
.live-btn.on{background:linear-gradient(135deg,#ffd86f,#ff5e62);animation:glowpulse 1.4s ease-in-out infinite}
@keyframes glowpulse{0%,100%{box-shadow:0 0 0 0 rgba(94,252,141,0)}50%{box-shadow:0 0 16px 2px rgba(120,200,255,.5)}}
.textbox{flex:1;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:14px;color:#ececf1;font-size:14px;font-family:inherit;padding:13px 15px;outline:none;resize:none;max-height:110px;min-height:46px;line-height:1.4}
.textbox:focus{border-color:rgba(120,160,255,.5)}.textbox::placeholder{color:#6a7080}
.send-btn{background:linear-gradient(135deg,#b06aff,#4facfe);color:#fff;border:none;border-radius:14px;padding:0 18px;height:46px;cursor:pointer;font-size:14px;font-weight:600}
.send-btn:hover{filter:brightness(1.1)}
.hint{font-size:10px;color:#555a68;text-align:center;padding-bottom:8px;z-index:2}
</style></head><body>
<div class="header"><div class="brand">ARIA</div>
<div class="owner-toggle" id="ownerToggle" title="Owner mode lets Aria edit her own code with your approval"><span class="owner-dot"></span><span id="ownerLabel">Owner</span></div></div>
<div class="stage"><div class="blob-wrap idle blink" id="blobWrap" title="Tap to interrupt while Aria's talking">
<svg class="blob-svg" viewBox="0 0 120 120"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
<stop offset="0%" stop-color="#ff5e62"><animate attributeName="stop-color" values="#ff5e62;#ffd86f;#5efc8d;#4facfe;#b06aff;#ff5e62" dur="8s" repeatCount="indefinite"/></stop>
<stop offset="100%" stop-color="#4facfe"><animate attributeName="stop-color" values="#4facfe;#b06aff;#ff5e62;#ffd86f;#5efc8d;#4facfe" dur="8s" repeatCount="indefinite"/></stop>
</linearGradient></defs>
<path d="M60 8 C88 8 112 30 112 60 C112 92 90 112 60 112 C32 112 8 92 8 60 C8 30 32 8 60 8 Z" fill="url(#bg)"/>
<ellipse class="eye" cx="44" cy="56" rx="7" ry="10"/><ellipse class="eye" cx="76" cy="56" rx="7" ry="10"/>
<path class="mouth" id="mouth" d="M48 78 Q60 88 72 78"/></svg></div>
<div class="status" id="status">Hey, I'm here. Type, tap the mic, or go hands-free.</div></div>
<div class="transcript" id="transcript"></div>
<div class="inputbar">
<button class="iconbtn mic-btn" id="micBtn" title="Tap to dictate into the box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/></svg></button>
<button class="iconbtn live-btn" id="liveBtn" title="Hands-free live conversation"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h3l2-7 4 14 3-9 2 4h6"/></svg></button>
<textarea class="textbox" id="textbox" rows="1" placeholder="Talk to Aria..."></textarea>
<button class="send-btn" id="sendBtn">Send</button></div>
<div class="hint">mic = dictate into the box &middot; waveform = hands-free live &middot; tap Aria to interrupt</div>
<script>
var $=function(i){return document.getElementById(i)};
var transcriptEl=$("transcript"),statusEl=$("status"),textbox=$("textbox"),micBtn=$("micBtn"),liveBtn=$("liveBtn"),sendBtn=$("sendBtn"),blobWrap=$("blobWrap"),mouth=$("mouth"),ownerToggle=$("ownerToggle"),ownerLabel=$("ownerLabel");
var convo=[],ownerEnabled=false,speaking=false,processing=false,mode="off",recog=null,cooldownUntil=0,restartTimer=null,liveBatchTimer=null;
var LIVE_WAIT=900;
function setStatus(t){statusEl.textContent=t;statusEl.style.display=t?"block":"none"}
function setBlob(s){blobWrap.className="blob-wrap blink "+s}
function addMsg(role,text){var d=document.createElement("div");d.className="msg "+(role==="user"?"user":"aria");d.textContent=text;transcriptEl.appendChild(d);transcriptEl.scrollTop=transcriptEl.scrollHeight}
ownerToggle.addEventListener("click",function(){ownerEnabled=!ownerEnabled;ownerToggle.classList.toggle("on",ownerEnabled);ownerLabel.textContent=ownerEnabled?"Owner ON":"Owner";setStatus(ownerEnabled?"Owner mode on. I can edit myself with your okay.":"Owner mode off.")});
function sendToAria(text){
  if(!text.trim()||processing)return;
  stopCurrentAudio();
  addMsg("user",text);convo.push({role:"user",content:text});processing=true;setBlob("idle");setStatus("Thinking...");
  var typingEl=document.createElement("div");typingEl.className="msg aria";typingEl.id="typingIndicator";typingEl.textContent="...";transcriptEl.appendChild(typingEl);transcriptEl.scrollTop=transcriptEl.scrollHeight;
  fetch("/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({messages:convo,owner:ownerEnabled})})
  .then(function(r){return r.json()}).then(function(data){
    var ti=document.getElementById("typingIndicator");if(ti)ti.remove();
    var reply=data.reply||data.error||"Hmm, something went sideways.";
    convo.push({role:"assistant",content:reply});addMsg("aria",reply);
    if(data.proposal)addProposalCard(data.proposal);
    if(data.editApplied)addApplied();
    processing=false;return speak(reply);
  }).catch(function(){var ti=document.getElementById("typingIndicator");if(ti)ti.remove();processing=false;addMsg("aria","Can't reach my backend right now.")});
}
function addProposalCard(p){
  var card=document.createElement("div");card.className="proposal";
  var l=document.createElement("div");l.className="proposal-label";l.textContent="PROPOSED CHANGE";
  var f=document.createElement("div");f.className="proposal-file";f.textContent=p.file;
  var rs=document.createElement("div");rs.className="proposal-reason";rs.textContent=p.reason;
  var act=document.createElement("div");act.className="proposal-actions";
  var ok=document.createElement("button");ok.className="btn-approve";ok.textContent="Approve";
  var no=document.createElement("button");no.className="btn-reject";no.textContent="Not now";
  ok.onclick=function(){act.textContent="Applying...";act.className="proposal-done";sendToAria("approved")};
  no.onclick=function(){act.textContent="Dropped.";act.className="proposal-done";sendToAria("no, drop it")};
  act.appendChild(ok);act.appendChild(no);
  card.appendChild(l);card.appendChild(f);card.appendChild(rs);card.appendChild(act);
  transcriptEl.appendChild(card);transcriptEl.scrollTop=transcriptEl.scrollHeight;
}
function addApplied(){var b=document.createElement("div");b.className="applied-badge";b.textContent="✓ Change applied";transcriptEl.appendChild(b);transcriptEl.scrollTop=transcriptEl.scrollHeight}
var ttsCtx=null,currentSource=null;
function ensureCtx(){if(!ttsCtx)ttsCtx=new(window.AudioContext||window.webkitAudioContext)();if(ttsCtx.state==="suspended")ttsCtx.resume();return ttsCtx}
function stopCurrentAudio(){if(currentSource){try{currentSource.stop()}catch(e){}currentSource=null}speaking=false;mouthTalk(false)}
function speak(text){
  stopCurrentAudio();
  clearTimeout(restartTimer);clearTimeout(liveBatchTimer);
  if(recog&&mode!=="dictate"){try{recog.abort()}catch(e){}recog=null}
  speaking=true;setBlob("speaking");setStatus("");mouthTalk(true);
  return fetch("/speak",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:text})})
  .then(function(res){var ct=res.headers.get("content-type")||"";if(res.ok&&ct.indexOf("audio")>=0)return res.arrayBuffer();throw new Error("no audio")})
  .then(function(buf){var ctx=ensureCtx();return ctx.decodeAudioData(buf.slice(0)).then(function(audio){
    return new Promise(function(resolve){var src=ctx.createBufferSource();currentSource=src;src.buffer=audio;src.connect(ctx.destination);src.onended=function(){currentSource=null;resolve()};src.start(0);setTimeout(resolve,audio.duration*1000+800)})})})
  .catch(function(){}).then(function(){mouthTalk(false);speaking=false;cooldownUntil=Date.now()+2000;if(mode==="live"){setBlob("listening");setStatus("Listening...");safeRestart(800)}else{setBlob("idle");setStatus("Your turn.")}})
}
var mouthTimer=null;
function mouthTalk(on){clearInterval(mouthTimer);if(on){mouthTimer=setInterval(function(){var o=Math.random()>0.5;mouth.setAttribute("d",o?"M48 76 Q60 92 72 76":"M48 80 Q60 84 72 80")},130)}else{mouth.setAttribute("d","M48 78 Q60 88 72 78")}}
blobWrap.addEventListener("click",function(){if(speaking&&currentSource){try{currentSource.stop()}catch(e){}currentSource=null;speaking=false;mouthTalk(false);if(mode==="live"){setBlob("listening");setStatus("Listening...");safeRestart(400)}}});
function newRecog(){var SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){setStatus("Voice needs Chrome. You can still type.");return null}var r=new SR();r.lang="en-US";r.continuous=true;r.interimResults=true;return r}
function safeRestart(d){clearTimeout(restartTimer);restartTimer=setTimeout(function(){if((mode==="dictate"||mode==="live")&&!speaking&&recog){try{recog.start()}catch(e){}}},d)}
function startDictate(){
  mode="dictate";micBtn.classList.add("on");liveBtn.classList.remove("on");setBlob("listening");setStatus("Listening, your words go in the box.");
  recog=newRecog();if(!recog){stopVoice();return}
  var base=textbox.value?textbox.value+" ":"";
  recog.onresult=function(e){var interim="",finals="";for(var i=e.resultIndex;i<e.results.length;i++){if(e.results[i].isFinal)finals+=e.results[i][0].transcript+" ";else interim+=e.results[i][0].transcript}if(finals)base+=finals;textbox.value=(base+interim).trim()};
  recog.onerror=function(ev){if(ev.error==="not-allowed")setStatus("Mic permission is off, allow it in Chrome's address bar.")};
  recog.onend=function(){if(mode==="dictate"&&!speaking)safeRestart(300)};
  try{recog.start()}catch(e){}
}
function startLive(){
  mode="live";liveBtn.classList.add("on");micBtn.classList.remove("on");ensureCtx();setBlob("listening");setStatus("Listening... just talk.");
  recog=newRecog();if(!recog){stopVoice();return}
  var buffer="";
  recog.onresult=function(e){if(speaking||processing)return;if(Date.now()<cooldownUntil)return;for(var i=e.resultIndex;i<e.results.length;i++){if(e.results[i].isFinal){var t=e.results[i][0].transcript.trim();if(t){buffer+=(buffer?" ":"")+t;setStatus(buffer);clearTimeout(liveBatchTimer);liveBatchTimer=setTimeout(function(){var m=buffer.trim();buffer="";if(m&&!speaking&&!processing)sendToAria(m)},LIVE_WAIT)}}else{if(!speaking)setStatus(buffer+" "+e.results[i][0].transcript)}}};
  recog.onerror=function(ev){if(ev.error==="not-allowed")setStatus("Mic permission is off, allow it in Chrome's address bar.")};
  recog.onend=function(){if(mode==="live"&&!speaking)safeRestart(350)};
  try{recog.start()}catch(e){}
}
function stopVoice(){mode="off";micBtn.classList.remove("on");liveBtn.classList.remove("on");clearTimeout(restartTimer);clearTimeout(liveBatchTimer);if(recog){try{recog.stop()}catch(e){}recog=null}setBlob("idle");setStatus("Your turn.")}
micBtn.addEventListener("click",function(){ensureCtx();if(mode==="dictate")stopVoice();else startDictate()});
liveBtn.addEventListener("click",function(){ensureCtx();if(mode==="live")stopVoice();else startLive()});
function doSend(){var t=textbox.value.trim();if(!t||processing)return;textbox.value="";textbox.style.height="46px";if(mode==="dictate")stopVoice();sendToAria(t)}
sendBtn.addEventListener("click",doSend);
textbox.addEventListener("keydown",function(e){if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();doSend()}});
textbox.addEventListener("input",function(){textbox.style.height="46px";textbox.style.height=Math.min(textbox.scrollHeight,110)+"px"});
setBlob("idle");
</script></body></html>`; }