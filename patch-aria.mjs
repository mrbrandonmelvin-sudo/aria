// patch-aria.mjs — fixes the double-response / request queue bug in aria.mjs
// Run once from the aria-voice-app folder:  node patch-aria.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TARGET = path.join(HERE, "aria.mjs");

if (!fs.existsSync(TARGET)) {
  console.error("aria.mjs not found in this folder. Run this script from the aria-voice-app folder.");
  process.exit(1);
}

let src = fs.readFileSync(TARGET, "utf8");
const original = src;

// 1. Add server-side request queue after pendingProposals
const QUEUE_CODE = `
// ---- request queue (prevents double-fire) ----------------------------------
let _chatBusy = false;
const _chatQueue = [];
function _enqueueChat(body) {
  return new Promise((resolve, reject) => {
    _chatQueue.push({ body, resolve, reject });
    if (!_chatBusy) _drainChat();
  });
}
async function _drainChat() {
  if (_chatBusy || _chatQueue.length === 0) return;
  _chatBusy = true;
  const item = _chatQueue.shift();
  if (_chatQueue.length > 0) {
    const extra = _chatQueue.splice(0);
    const last = item.body.messages[item.body.messages.length - 1];
    const ints = extra.map(e => (e.body.messages[e.body.messages.length - 1] || {}).content).filter(Boolean);
    if (ints.length) last.content = '[Said: "' + last.content + '"] [Then interrupted/added: "' + ints.join('" / "') + '"]. Integrate both naturally in one response.';
    extra.forEach(e => { item._extra = item._extra || []; item._extra.push(e); });
  }
  try {
    const result = await runChat(item.body);
    item.resolve(result);
    if (item._extra) item._extra.forEach(e => e.resolve(result));
  } catch (err) {
    item.reject(err);
    if (item._extra) item._extra.forEach(e => e.reject(err));
  } finally {
    _chatBusy = false;
    if (_chatQueue.length > 0) _drainChat();
  }
}
`;

if (!src.includes("_enqueueChat")) {
  src = src.replace(
    "const pendingProposals = new Map();",
    "const pendingProposals = new Map();\n" + QUEUE_CODE
  );

  // 2. Use _enqueueChat in the /chat route
  src = src.replace(
    "try { return json(res, 200, await runChat(await readBody(req))); }",
    "try { return json(res, 200, await _enqueueChat(await readBody(req))); }"
  );
}

// 3. Frontend: add pendingVoiceBuffer and guard sendToAria
if (!src.includes("pendingVoiceBuffer")) {
  src = src.replace(
    `function sendToAria(text){
  if(!text.trim())return;
  stopCurrentAudio();
  addMsg("user",text);convo.push({role:"user",content:text});processing=true;`,
    `var pendingVoiceBuffer="";
function sendToAria(text){
  if(!text.trim())return;
  if(speaking||processing){pendingVoiceBuffer+=(pendingVoiceBuffer?" ":"")+text;setStatus("Got it, finishing up...");return;}
  if(pendingVoiceBuffer){text=text+" "+pendingVoiceBuffer;pendingVoiceBuffer="";}
  stopCurrentAudio();
  addMsg("user",text);convo.push({role:"user",content:text});processing=true;`
  );

  // 4. After speaking ends, drain any buffered voice input
  src = src.replace(
    `.then(function(){mouthTalk(false);speaking=false;cooldownUntil=Date.now()+6000;if(mode==="live"){setBlob("listening");setStatus("Listening...");safeRestart(1500)}else{setBlob("idle");setStatus("Your turn.")}});`,
    `.then(function(){mouthTalk(false);speaking=false;cooldownUntil=Date.now()+6000;if(pendingVoiceBuffer&&!processing){var b=pendingVoiceBuffer;pendingVoiceBuffer="";setTimeout(function(){sendToAria(b)},300);}else if(mode==="live"){setBlob("listening");setStatus("Listening...");safeRestart(1500)}else{setBlob("idle");setStatus("Your turn.");}});`
  );
}

if (src === original) {
  console.log("Nothing to patch — either already patched or text didn't match.");
} else {
  fs.writeFileSync(TARGET, src, "utf8");
  console.log("aria.mjs patched successfully. Restart with: node aria.mjs");
}
