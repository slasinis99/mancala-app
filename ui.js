import { makeRules, initStandard, getValidMoves, playMove } from "./engine.js";
import { bestMove } from "./ai.js";

// ---------- Mode ----------
const Mode = Object.freeze({
  HvAI: "HvAI",
  AIvH: "AIvH",
  HvH:  "HvH",
  AIvAI:"AIvAI",
});

function nextMode(m) {
  if (m === Mode.HvAI) return Mode.AIvH;
  if (m === Mode.AIvH) return Mode.HvH;
  if (m === Mode.HvH)  return Mode.AIvAI;
  return Mode.HvAI;
}

// ---------- DOM ----------
const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");

const elNew = document.getElementById("newGame");
const elMode = document.getElementById("modeBtn");
const elUndoMove = document.getElementById("undoMove");
const elUndoTurn = document.getElementById("undoTurn");
const elMoves = document.getElementById("moves");
const elStatus = document.getElementById("status");

const elAnimDelay = document.getElementById("animDelay");

const elDepth = document.getElementById("depth");
const elAiMove = document.getElementById("aiMove");
const elStepAi = document.getElementById("stepAi");

const elDepthP0 = document.getElementById("depthP0");
const elDepthP1 = document.getElementById("depthP1");
const elAutoAi = document.getElementById("autoAi");
const elAutoDelay = document.getElementById("autoDelay");

const elHelpBtn = document.getElementById("helpBtn");
const elHelpModal = document.getElementById("helpModal");
const elHelpClose = document.getElementById("helpClose");

let hoverPit = null; // { side, idx } or null

const elLoadMoves = document.getElementById("loadMoves");
const elCopyMoves = document.getElementById("copyMoves");

// ---------- Game state ----------
const rules = makeRules({ pitsPerSide: 6, seedsPerPit: 4 });
let mode = Mode.HvAI;

let state = initStandard(rules, 0);      // authoritative
let vis = structuredClone(state);        // visual (during animation)
let anim = null;                         // animation state

// move history for display + undo (store moves and replay)
let moves = []; // entries: { mover, pitIndex }  mover=0|1

// auto-play timer for AIvAI
let nextAutoTime = 0;

let gameLogged = false;

async function logCompletedGameOnce() {
  if (gameLogged) return;
  if (!state.terminal) return;

  const payload = currentGamePayload();
  if (!payload) return;

  gameLogged = true;

  // Use sendBeacon if possible (more reliable on page close)
  const url = "https://YOUR-WORKER.SUBDOMAIN.workers.dev/log"; // replace later
  const body = JSON.stringify(payload);

  if (navigator.sendBeacon) {
    const blob = new Blob([body], { type: "application/json" });
    navigator.sendBeacon(url, blob);
    return;
  }

  // Fallback fetch
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    });
  } catch {
    // If it fails, we intentionally don't spam retries.
  }
}

// ---------- Helpers ----------
function letterForMove(mover, pitIndex) {
  return String.fromCharCode((mover === 0 ? "a".charCodeAt(0) : "A".charCodeAt(0)) + pitIndex);
}

function turnsStarted() {
  return Math.floor((moves.length + 1) / 2);
}

function isAiGame() {
  return mode === Mode.HvAI || mode === Mode.AIvH;
}

function aiSide() {
  if (mode === Mode.HvAI) return 1; // AI second
  if (mode === Mode.AIvH) return 0; // AI first
  return -1;
}

function isHumansTurn() {
  if (mode === Mode.HvH) return true;
  if (mode === Mode.AIvAI) return false;
  return state.toMove !== aiSide();
}

function currentAiDepth() {
  if (mode !== Mode.AIvAI) return parseInt(elDepth.value, 10) || 6;
  return (state.toMove === 0)
    ? (parseInt(elDepthP0.value, 10) || 6)
    : (parseInt(elDepthP1.value, 10) || 6);
}

function resetGame() {
  gameLogged = false;
  state = initStandard(rules, 0);
  vis = structuredClone(state);
  anim = null;
  moves = [];
  nextAutoTime = performance.now();
  renderAll();
}

function replayFromStart() {
  // rebuild state by replaying moves with engine (no animation)
  let st = initStandard(rules, 0);
  for (const m of moves) {
    const res = playMove(st, rules, m.pitIndex);
    if (!res.ok) break;
    st = res.state;
  }
  state = st;
  vis = structuredClone(state);
  anim = null;
}

function undoOne() {
  if (anim) return;
  if (moves.length === 0) return;
  moves.pop();
  replayFromStart();
  if (!state.terminal) gameLogged = false;
  renderAll();
}

function undoToHumanTurn() {
  if (anim) return;
  if (!isAiGame()) { undoOne(); return; }

  if (moves.length === 0) return;
  moves.pop(); // undo at least one
  replayFromStart();

  // keep undoing while it's AI's turn
  while (moves.length > 0 && state.toMove === aiSide()) {
    moves.pop();
    replayFromStart();
  }
  renderAll();
}

function startAnimationForMove(pitIndex) {
  const mover = state.toMove;
  const res = playMove(state, rules, pitIndex);
  if (!res.ok) return false;

  // animation timeline: seed-by-seed using res.path
  const stepDelay = Math.max(0.01, parseFloat(elAnimDelay.value) || 0.12);

  anim = {
    mover,
    pitIndex,
    startState: structuredClone(state),
    endState: structuredClone(res.state),
    path: res.path,               // array of {kind, side, index?}
    idx: 0,
    stepDelayMs: stepDelay * 1000,
    nextTime: performance.now(),
    lastDrop: null,
  };

  // visual starts as startState but with chosen pit emptied
  vis = structuredClone(state);
  vis.pits[mover][pitIndex] = 0;

  // record move for history (authoritative will commit at end of animation)
  moves.push({ mover, pitIndex });

  return true;
}

function tickAnimation(now) {
  if (!anim) return;

  if (now < anim.nextTime) return;

  if (anim.idx < anim.path.length) {
    const loc = anim.path[anim.idx];
    anim.lastDrop = loc;

    if (loc.kind === "store") {
      vis.store[loc.side] += 1;
    } else {
      vis.pits[loc.side][loc.index] += 1;
    }

    anim.idx++;
    anim.nextTime = now + anim.stepDelayMs;
    renderAll();
    return;
  }

  // done sowing: snap to final state (captures/sweep already applied)
  state = anim.endState;
  vis = structuredClone(state);
  anim = null;
  renderAll();
}

function doAiMove() {
  if (anim) return;
  if (state.terminal) return;

  const depth = currentAiDepth();
  const r = bestMove(state, rules, depth);
  if (!r.hasMove) return;
  startAnimationForMove(r.move);
  renderAll();
}

function updateTerminalFlag() {
  // engine’s playMove sets terminal boolean on result; for init, compute simply:
  // We'll just attach a terminal field here for convenience.
  const anyMoves = getValidMoves(state, rules).length > 0;
  state.terminal = !anyMoves; // in standard Kalah, no moves implies terminal
  vis.terminal = state.terminal;
}

function movesToString(movesArr) {
  return movesArr.map(m => letterForMove(m.mover, m.pitIndex)).join("");
}

function parseMoveString(s) {
  const out = [];
  for (const ch of (s || "").trim()) {
    if (ch >= "a" && ch <= "z") {
      out.push({ side: 0, pitIndex: ch.charCodeAt(0) - 97 });
    } else if (ch >= "A" && ch <= "Z") {
      out.push({ side: 1, pitIndex: ch.charCodeAt(0) - 65 });
    } else {
      // ignore whitespace, but reject other chars
      if (!/\s/.test(ch)) return { ok: false, error: `Invalid character: '${ch}'` };
    }
  }
  return { ok: true, moves: out };
}

function loadMovesFromString(s) {
  if (anim) return { ok: false, error: "Cannot load while animating" };

  gameLogged = false;

  const parsed = parseMoveString(s);
  if (!parsed.ok) return parsed;

  // reset everything
  state = initStandard(rules, 0);
  vis = structuredClone(state);
  anim = null;
  moves = [];

  for (const step of parsed.moves) {
    // must match whose turn it is
    if (state.toMove !== step.side) {
      return { ok: false, error: `Turn mismatch at '${letterForMove(step.side, step.pitIndex)}' (expected P${state.toMove})` };
    }
    // must be valid index
    if (step.pitIndex < 0 || step.pitIndex >= rules.pitsPerSide) {
      return { ok: false, error: `Pit out of range in move '${letterForMove(step.side, step.pitIndex)}'` };
    }

    const res = playMove(state, rules, step.pitIndex);
    if (!res.ok) {
      return { ok: false, error: `Illegal move '${letterForMove(step.side, step.pitIndex)}'` };
    }

    // record history using same format as the rest of UI
    moves.push({ mover: step.side, pitIndex: step.pitIndex });

    state = res.state;
    vis = structuredClone(state);

    if (state.terminal) break;
  }

  renderAll();
  return { ok: true };
}

async function copyTextToClipboard(text) {
  // Modern API (works on https or localhost)
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  // Fallback
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
}

elLoadMoves.onclick = () => {
  if (anim) return;

  const current = movesToString(moves);
  const s = prompt("Paste a move string (e.g., cfBA...):", current);
  if (s == null) return; // cancelled

  const r = loadMovesFromString(s);
  if (!r.ok) alert(r.error);
};

elCopyMoves.onclick = async () => {
  const s = movesToString(moves);
  try {
    await copyTextToClipboard(s);
    // optional quick feedback:
    elStatus.textContent = `Copied moves (${s.length} plies) to clipboard.`;
  } catch (e) {
    alert("Clipboard copy failed.");
  }
};

function openHelp() {
  elHelpModal.style.display = "block";
}

function closeHelp() {
  elHelpModal.style.display = "none";
}

elHelpBtn.onclick = () => openHelp();
elHelpClose.onclick = () => closeHelp();

// click outside the dialog closes
elHelpModal.addEventListener("click", (e) => {
  if (e.target === elHelpModal) closeHelp();
});

// Esc closes
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && elHelpModal.style.display === "block") closeHelp();
});

// ---------- Drawing ----------
function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  canvas.width = Math.max(300, Math.floor(rect.width * dpr));
  canvas.height = Math.max(200, Math.floor(rect.height * dpr));

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawRoundedRect(x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function layout(w, h, n) {
  const PAD = 18;
  const GAP = 12;
  const top = 10;
  const bottomMovesReserve = 0; // moves are in separate div, so 0 here

  const board = { x: PAD, y: top + PAD, w: w - 2 * PAD, h: h - top - 2 * PAD - bottomMovesReserve };
  const storeW = Math.min(140, Math.max(80, board.w * 0.11));
  const storeH = board.h * 0.78;
  const storeY = board.y + (board.h - storeH) * 0.5;

  const store1 = { x: board.x, y: storeY, w: storeW, h: storeH };                         // left = P1 store
  const store0 = { x: board.x + board.w - storeW, y: storeY, w: storeW, h: storeH };       // right = P0 store

  const pitsArea = {
    x: store1.x + store1.w + GAP,
    y: board.y,
    w: store0.x - GAP - (store1.x + store1.w + GAP),
    h: board.h,
  };

  const rowH = (pitsArea.h - GAP) / 2;
  const pitH = rowH * 0.68;
  const yTop = pitsArea.y + (rowH - pitH) * 0.5;
  const yBot = pitsArea.y + rowH + GAP + (rowH - pitH) * 0.5;
  const pitW = (pitsArea.w - (n - 1) * GAP) / n;

  function pitRect(side, idx) {
    // side 1 on top, right-to-left; side 0 on bottom, left-to-right
    const col = (side === 1) ? (n - 1 - idx) : idx;
    return {
      x: pitsArea.x + col * (pitW + GAP),
      y: (side === 1) ? yTop : yBot,
      w: pitW,
      h: pitH,
    };
  }

  return { board, store0, store1, pitsArea, pitRect };
}

function draw() {
  const cssW = canvas.getBoundingClientRect().width;
  const cssH = canvas.getBoundingClientRect().height;

  ctx.clearRect(0, 0, cssW, cssH);

  const st = vis;
  const n = rules.pitsPerSide;
  const L = layout(cssW, cssH, n);

  // background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, cssW, cssH);

  // stores
  for (const side of [1, 0]) {
    const r = (side === 0) ? L.store0 : L.store1;
    ctx.fillStyle = (side === 0) ? "#dcf0ff" : "#ffebdc";
    drawRoundedRect(r.x, r.y, r.w, r.h, 14);
    ctx.fill();
    ctx.strokeStyle = "#999";
    ctx.stroke();

    ctx.fillStyle = "#111";
    ctx.font = "28px system-ui";
    const txt = String(st.store[side]);
    const tw = ctx.measureText(txt).width;
    ctx.fillText(txt, r.x + (r.w - tw)/2, r.y + r.h/2 + 10);

    ctx.font = "14px system-ui";
    ctx.fillStyle = "#444";
    ctx.fillText(side === 0 ? "P0" : "P1", r.x + 10, r.y - 6);
  }

  // pits
  ctx.font = "22px system-ui";
  for (let side = 0; side < 2; side++) {
    for (let i = 0; i < n; i++) {
      const r = L.pitRect(side, i);

      const animHighlight =
        anim && anim.lastDrop && anim.lastDrop.kind === "pit" &&
        anim.lastDrop.side === side && anim.lastDrop.index === i;

      const hoverHighlight =
        !anim &&
        hoverPit &&
        hoverPit.side === side &&
        hoverPit.idx === i &&
        isHumansTurn() &&
        side === state.toMove &&
        state.pits[side][i] > 0;

        ctx.fillStyle = animHighlight ? "#fffacd"
                    : hoverHighlight ? "#d9fdd3"   // light green
                    : "#f5f5f5";
      drawRoundedRect(r.x, r.y, r.w, r.h, 14);
      ctx.fill();
      ctx.strokeStyle = "#999";
      ctx.stroke();

      // count
      const s = String(st.pits[side][i]);
      const tw = ctx.measureText(s).width;
      ctx.fillStyle = "#111";
      ctx.fillText(s, r.x + (r.w - tw)/2, r.y + r.h/2 + 8);

      // top-left label: number + letter
      ctx.font = "13px system-ui";
      ctx.fillStyle = "#666";
      ctx.fillText(String(i + 1), r.x + 6, r.y + 16);
      ctx.fillText(String.fromCharCode((side === 0 ? 97 : 65) + i), r.x + 22, r.y + 16);
      ctx.font = "22px system-ui";
    }
  }

  // overlay status (small)
  ctx.font = "14px system-ui";
  ctx.fillStyle = "#333";
  const tm = state.toMove;
  ctx.fillText(`to_move: P${tm}` + (anim ? " (animating)" : ""), 10, 18);

  // terminal overlay
  if (state.terminal) {
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(0, cssH/2 - 45, cssW, 90);
    ctx.fillStyle = "#fff";
    ctx.font = "32px system-ui";
    const diff = state.store[0] - state.store[1];
    const winner = diff > 0 ? "P0 wins" : diff < 0 ? "P1 wins" : "Draw";
    const tw = ctx.measureText(winner).width;
    ctx.fillText(winner, (cssW - tw)/2, cssH/2 + 12);
  }
}

function renderMoves() {
  let s = "";
  const maxShow = 1000;
  const start = Math.max(0, moves.length - maxShow);

  for (let i = start; i < moves.length; i++) {
    s += letterForMove(moves[i].mover, moves[i].pitIndex) + "";
    if ((i - start + 1) % 40 === 0) s += "\n";
  }
  s += `\n\nPlies: ${moves.length}`;
  elMoves.textContent = s;
}

function renderStatus() {
  const tm = state.toMove;
  let modeStr = mode;
  if (mode === Mode.AIvAI) {
    modeStr += ` (P0 d=${elDepthP0.value}, P1 d=${elDepthP1.value})`;
  } else if (mode !== Mode.HvH) {
    modeStr += ` (AI d=${elDepth.value})`;
  }
  elStatus.textContent = `Mode: ${modeStr} | to_move: P${tm}${anim ? " | animating" : ""}`;
}

function renderAll() {
  updateTerminalFlag();
  draw();
  renderMoves();
  renderStatus();

  // disable some buttons while animating
  const busy = !!anim;
  elUndoMove.disabled = busy;
  elUndoTurn.disabled = busy;
  elAiMove.disabled = busy || mode === Mode.HvH;
  elStepAi.disabled = busy || mode !== Mode.AIvAI;

  logCompletedGameOnce();
}

// ---------- Input: click pits ----------
function pickPitFromClick(x, y) {
  const hit = pickPitFromPoint(x, y);
  if (!hit) return null;
  if (hit.side !== state.toMove) return null; // only current player side
  return hit.idx;
}

function pickPitFromPoint(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const cx = clientX - rect.left;
  const cy = clientY - rect.top;

  const n = rules.pitsPerSide;
  const L = layout(rect.width, rect.height, n);

  // Check both sides; we'll use it for hover
  for (let side = 0; side < 2; side++) {
    for (let i = 0; i < n; i++) {
      const r = L.pitRect(side, i);
      if (cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h) {
        return { side, idx: i };
      }
    }
  }
  return null;
}

canvas.addEventListener("click", (e) => {
  if (anim) return;
  if (!isHumansTurn()) return;
  if (state.terminal) return;

  const pit = pickPitFromClick(e.clientX, e.clientY);
  if (pit === null) return;

  // validate non-empty unless allowMoveFromEmpty
  const seeds = state.pits[state.toMove][pit];
  if (seeds === 0) return;

  startAnimationForMove(pit);
  renderAll();
});

canvas.addEventListener("mousemove", (e) => {
  if (anim || state.terminal) {
    if (hoverPit !== null) { hoverPit = null; renderAll(); }
    return;
  }

  const hit = pickPitFromPoint(e.clientX, e.clientY);

  // Not over any pit => clear highlight
  if (!hit) {
    if (hoverPit !== null) { hoverPit = null; renderAll(); }
    return;
  }

  // Only highlight if it's a human's turn and on the current player's side
  if (!isHumansTurn() || hit.side !== state.toMove) {
    if (hoverPit !== null) { hoverPit = null; renderAll(); }
    return;
  }

  // Only highlight non-empty pits
  const seeds = state.pits[hit.side][hit.idx];
  const nextHover = (seeds > 0) ? hit : null;

  // Only re-render if changed (prevents redraw spam)
  const changed =
    (hoverPit === null && nextHover !== null) ||
    (hoverPit !== null && nextHover === null) ||
    (hoverPit && nextHover && (hoverPit.side !== nextHover.side || hoverPit.idx !== nextHover.idx));

  hoverPit = nextHover;
  if (changed) renderAll();
});

canvas.addEventListener("mouseleave", () => {
  hoverPit = null;
  renderAll();
});

// ---------- Buttons ----------
elNew.onclick = () => { if (!anim) resetGame(); };

elMode.onclick = () => {
  if (anim) return;
  mode = nextMode(mode);
  elMode.textContent = `Mode: ${mode}`;
  elAutoAi.checked = false;
  resetGame();
};

elUndoMove.onclick = () => undoOne();
elUndoTurn.onclick = () => undoToHumanTurn();

elAiMove.onclick = () => {
  if (mode === Mode.HvH) return;
  if (mode === Mode.AIvAI) return; // use Step/Auto
  if (anim) return;
  if (state.toMove !== aiSide()) return; // only if AI turn
  doAiMove();
  renderAll();
};

elStepAi.onclick = () => {
  if (mode !== Mode.AIvAI) return;
  if (anim) return;
  if (state.terminal) return;
  doAiMove();
  renderAll();
};

// ---------- Resize ----------
function onResize() {
  resizeCanvas();
  renderAll();
}
window.addEventListener("resize", onResize);

// ---------- Main loop (animation + auto AIvAI) ----------
function loop(now) {
  // animation tick
  tickAnimation(now);

  // AI triggers after animation ends
  if (!anim && !state.terminal) {
    // Single-AI modes: auto-play AI when it's AI's turn
    if (isAiGame() && state.toMove === aiSide()) {
      doAiMove();
    }

    // AIvAI auto
    if (mode === Mode.AIvAI && elAutoAi.checked) {
      const delayMs = Math.max(100, (parseFloat(elAutoDelay.value) || 3.0) * 1000);
      if (now >= nextAutoTime) {
        doAiMove();
        nextAutoTime = now + delayMs;
      }
    }
  }

  requestAnimationFrame(loop);
}

// ---------- Data Analytics ----------

function currentGamePayload() {
  const moveString = movesToString(moves); // you already wrote this earlier
  const m = mode;

  // Ignore AIvAI as requested
  if (m === Mode.AIvAI) return null;
  if (!moveString || moveString.length === 0) return null;

  let depth = null;
  if (m === Mode.HvAI || m === Mode.AIvH) {
    depth = parseInt(elDepth.value, 10) || 6;
  }

  return {
    mode: m,
    depth,                 // null for HvH
    moves: moveString,
    plies: moves.length,
    // optional: final stores can be helpful
    finalStore0: state.store[0],
    finalStore1: state.store[1],
    // optional: timestamp
    ts: Date.now(),
  };
}

// ---------- init ----------
function init() {
  elMode.textContent = `Mode: ${mode}`;
  resizeCanvas();
  resetGame();
  requestAnimationFrame(loop);
}

init();