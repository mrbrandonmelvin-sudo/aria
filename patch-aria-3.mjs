// patch-aria-3.mjs -- repairs the broken proposal parser from patch-aria-2
// Run from Desktop: node patch-aria-3.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TARGET = path.join(HERE, "aria.mjs");

if (!fs.existsSync(TARGET)) {
  console.error("aria.mjs not found.");
  process.exit(1);
}

let src = fs.readFileSync(TARGET, "utf8");

// Find and replace the entire broken proposal block
// We look for the owner block that starts with: if (owner) {
const BROKEN_MARKER = "flexible proposal parser";
const BROKEN_START = "  if (owner) {\n    // flexible proposal parser";

if (!src.includes(BROKEN_MARKER)) {
  console.log("No broken parser found - nothing to fix.");
  process.exit(0);
}

// Find the owner block boundaries
const blockStart = src.indexOf(BROKEN_START);
if (blockStart === -1) {
  console.error("Could not locate the broken block.");
  process.exit(1);
}

// Find matching closing brace by counting braces
let depth = 0;
let blockEnd = blockStart;
for (let i = blockStart; i < src.length; i++) {
  if (src[i] === "{") depth++;
  if (src[i] === "}") { depth--; if (depth === 0) { blockEnd = i + 1; break; } }
}

const FIXED_BLOCK = `  if (owner) {
    // parse proposal using simple string search (avoids regex escape issues)
    const propStart = reply.indexOf("PROPOSAL");
    const propEnd = reply.indexOf("END PROPOSAL");
    if (propStart !== -1 && propEnd !== -1) {
      const block = reply.slice(propStart, propEnd + 12);
      const lines = block.split(/\r?\n/);
      let reason = "", before = "", after = "", section = "";
      for (const line of lines) {
        if (line.startsWith("Reason:")) { reason = line.slice(7).trim(); section = ""; }
        else if (line.trim() === "Before:") { section = "before"; }
        else if (line.trim() === "After:") { section = "after"; }
        else if (line.trim() === "END PROPOSAL") { break; }
        else if (section === "before") { before += (before ? "\n" : "") + line; }
        else if (section === "after") { after += (after ? "\n" : "") + line; }
      }
      const stripFences = t => t.replace(/^\`\`\`[\w]*\n?/gm, "").replace(/^\`\`\`$/gm, "").trim();
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
  }`;

src = src.slice(0, blockStart) + FIXED_BLOCK + src.slice(blockEnd);
fs.writeFileSync(TARGET, src, "utf8");
console.log("Proposal parser repaired. Run: node aria.mjs");
