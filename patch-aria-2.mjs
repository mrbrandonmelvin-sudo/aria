// patch-aria-2.mjs — fixes proposal parsing bug + UI polish
// Run from aria-voice-app folder: node patch-aria-2.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TARGET = path.join(HERE, "aria.mjs");

if (!fs.existsSync(TARGET)) {
  console.error("aria.mjs not found. Run from the aria-voice-app folder.");
  process.exit(1);
}

let src = fs.readFileSync(TARGET, "utf8");
const original = src;

// ── FIX 1: Robust proposal parser ─────────────────────────────────────────
// Replace the strict single-line regex with a flexible multi-format parser
const OLD_PROPOSAL_PARSE = `  if (owner) {
    const m = reply.match(/PROPOSAL\\nReason:\\s*(.+)\\nBefore:\\n([\\s\\S]+?)\\nAfter:\\n([\\s\\S]+?)\\nEND PROPOSAL/);
    if (m) {
      try {
        const p = proposeSelfEdit(m[2].trim(), m[3].trim(), m[1].trim());
        pendingProposals.set("b", p);
        proposal = { file: "aria.mjs", reason: p.reason };
      } catch (e) { /* keep reply, no card */ }
      reply = reply.replace(/PROPOSAL[\\s\\S]+?END PROPOSAL/g, "").trim() || "Here's the change. Approve and I'll apply it.";
    }
  }`;

const NEW_PROPOSAL_PARSE = `  if (owner) {
    // flexible proposal parser — handles varied whitespace, line endings, markdown fences
    const rawBlock = reply.match(/PROPOSAL[\s\S]+?END\s*PROPOSAL/i);
    if (rawBlock) {
      const block = rawBlock[0];
      const reasonM = block.match(/Reason:\s*([^\n\r]+)/);
      const beforeM = block.match(/Before:[\r\n]+((?:[\s\S](?!After:))+?)\s*[\r\n]+After:/);
      const afterM  = block.match(/After:[\r\n]+([\s\S]+?)\s*[\r\n]*END\s*PROPOSAL/i);
      if (reasonM && beforeM && afterM) {
        const cleanFences = t => t.replace(/^\`\`\`[\w]*\n?/gm,"").replace(/^\`\`\`\s*$/gm,"").trim();
        try {
          const p = proposeSelfEdit(cleanFences(beforeM[1]), cleanFences(afterM[1]), reasonM[1].trim());
          pendingProposals.set("b", p);
          proposal = { file: "aria.mjs", reason: p.reason };
        } catch (e) {
          // text not found — tell Aria so she can retry with a fresh read
          reply = reply.replace(/PROPOSAL[\s\S]+?END\s*PROPOSAL/gi, "").trim();
          reply += "\n\n(Heads up: I couldn't find that exact text in the file. Re-read [MYCODE] and try the proposal again with the exact text.)";
        }
      }
      reply = reply.replace(/PROPOSAL[\s\S]+?END\s*PROPOSAL/gi, "").trim() || "Here's the change. Approve and I'll apply it.";
    }
  }`;

if (src.includes("PROPOSAL\\nReason:")) {
  src = src.replace(OLD_PROPOSAL_PARSE, NEW_PROPOSAL_PARSE);
  console.log("✓ Fixed proposal parser");
} else if (src.includes("flexible proposal parser")) {
  console.log("- Proposal parser already patched, skipping");
} else {
  // fallback: replace just the regex line
  src = src.replace(
    /reply\.match\(\/PROPOSAL\\nReason[^)]+\)/,
    `(()=>{ const rb=reply.match(/PROPOSAL[\\s\\S]+?END\\s*PROPOSAL/i); if(!rb) return null; const bl=rb[0]; const r=bl.match(/Reason:\\s*([^\\n\\r]+)/); const b=bl.match(/Before:[\\r\\n]+([\\s\\S]+?)\\s*[\\r\\n]+After:/); const a=bl.match(/After:[\\r\\n]+([\\s\\S]+?)\\s*[\\r\\n]*END\\s*PROPOSAL/i); return (r&&b&&a)?[rb[0],r[1],b[1],a[1]]:null })()`
  );
  console.log("✓ Applied fallback proposal fix");
}

// ── FIX 2: UI polish — better fonts, bubbles, spacing ─────────────────────
const OLD_CSS_BODY = `body{font-family:'Inter',-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;background:#0a0a0f;color:#ececf1;height:100vh;display:flex;flex-direction:column;overflow:hidden;position:relative}`;
const NEW_CSS_BODY = `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');body{font-family:'Inter',-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;background:#080810;color:#ececf1;height:100vh;display:flex;flex-direction:column;overflow:hidden;position:relative}`;

if (src.includes(OLD_CSS_BODY)) {
  src = src.replace(OLD_CSS_BODY, NEW_CSS_BODY);
  console.log("✓ Improved font loading");
}

// Better chat bubbles
const OLD_MSG = `.msg{padding:11px 15px;border-radius:16px;font-size:14px;line-height:1.55;max-width:82%;animation:pop .2s ease;user-select:text;cursor:text}`;
const NEW_MSG = `.msg{padding:13px 17px;border-radius:18px;font-size:15px;line-height:1.6;max-width:80%;animation:pop .2s ease;user-select:text;cursor:text;word-break:break-word}`;
if (src.includes(OLD_MSG)) { src = src.replace(OLD_MSG, NEW_MSG); console.log("✓ Improved chat bubbles"); }

// Better user bubble
const OLD_USER = `.msg.user{align-self:flex-end;color:#fff;background:linear-gradient(135deg,#4facfe,#b06aff);border-bottom-right-radius:5px}`;
const NEW_USER = `.msg.user{align-self:flex-end;color:#fff;background:linear-gradient(135deg,#6366f1,#a855f7);border-bottom-right-radius:4px;box-shadow:0 2px 12px rgba(99,102,241,0.3)}`;
if (src.includes(OLD_USER)) { src = src.replace(OLD_USER, NEW_USER); console.log("✓ Improved user bubble"); }

// Better Aria bubble
const OLD_ARIA_MSG = `.msg.aria{align-self:flex-start;color:#ececf1;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-bottom-left-radius:5px}`;
const NEW_ARIA_MSG = `.msg.aria{align-self:flex-start;color:#e8e8f4;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-bottom-left-radius:4px;backdrop-filter:blur(8px)}`;
if (src.includes(OLD_ARIA_MSG)) { src = src.replace(OLD_ARIA_MSG, NEW_ARIA_MSG); console.log("✓ Improved Aria bubble"); }

// Better input box
const OLD_TEXTBOX = `.textbox{flex:1;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:14px;color:#ececf1;font-size:14px;font-family:inherit;padding:13px 15px;outline:none;resize:none;max-height:110px;min-height:46px;line-height:1.4}`;
const NEW_TEXTBOX = `.textbox{flex:1;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:16px;color:#ececf1;font-size:15px;font-family:inherit;padding:13px 16px;outline:none;resize:none;max-height:110px;min-height:48px;line-height:1.5;transition:border-color .2s}`;
if (src.includes(OLD_TEXTBOX)) { src = src.replace(OLD_TEXTBOX, NEW_TEXTBOX); console.log("✓ Improved input box"); }

// Focused textbox glow
const OLD_FOCUS = `.textbox:focus{border-color:rgba(120,160,255,.5)}`;
const NEW_FOCUS = `.textbox:focus{border-color:rgba(139,92,246,.6);box-shadow:0 0 0 3px rgba(139,92,246,.15)}`;
if (src.includes(OLD_FOCUS)) { src = src.replace(OLD_FOCUS, NEW_FOCUS); console.log("✓ Improved input focus"); }

// Better send button
const OLD_SEND = `.send-btn{background:linear-gradient(135deg,#b06aff,#4facfe);color:#fff;border:none;border-radius:14px;padding:0 18px;height:46px;cursor:pointer;font-size:14px;font-weight:600}`;
const NEW_SEND = `.send-btn{background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff;border:none;border-radius:16px;padding:0 22px;height:48px;cursor:pointer;font-size:15px;font-weight:600;letter-spacing:.3px;transition:filter .15s,transform .1s}`;
if (src.includes(OLD_SEND)) { src = src.replace(OLD_SEND, NEW_SEND); console.log("✓ Improved send button"); }

// Better send hover
const OLD_SEND_HOVER = `.send-btn:hover{filter:brightness(1.1)}`;
const NEW_SEND_HOVER = `.send-btn:hover{filter:brightness(1.15);transform:translateY(-1px)}.send-btn:active{transform:translateY(0)}`;
if (src.includes(OLD_SEND_HOVER)) { src = src.replace(OLD_SEND_HOVER, NEW_SEND_HOVER); console.log("✓ Improved send hover"); }

// Better brand / header
const OLD_BRAND = `.brand{font-size:15px;font-weight:700;letter-spacing:3px;background:linear-gradient(90deg,#ff5e62,#ffd86f,#5efc8d,#4facfe,#b06aff);background-size:200% auto;-webkit-background-clip:text;background-clip:text;color:transparent;animation:shimmer 6s linear infinite}`;
const NEW_BRAND = `.brand{font-size:16px;font-weight:800;letter-spacing:4px;background:linear-gradient(90deg,#f472b6,#a78bfa,#60a5fa,#34d399,#a78bfa,#f472b6);background-size:300% auto;-webkit-background-clip:text;background-clip:text;color:transparent;animation:shimmer 8s linear infinite}`;
if (src.includes(OLD_BRAND)) { src = src.replace(OLD_BRAND, NEW_BRAND); console.log("✓ Improved brand header"); }

if (src === original) {
  console.log("Nothing changed — text may not have matched. The file might already be patched or have different content.");
} else {
  fs.writeFileSync(TARGET, src, "utf8");
  console.log("\n✅ Done! Restart Aria: node aria.mjs");
}
