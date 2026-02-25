// engine.js
// Headless Kalah/Mancala engine (no UI). Designed for web animation + AI.
//
// Conventions:
// - side 0 = Player 0 (bottom), side 1 = Player 1 (top)
// - pits[side][i], i=0..n-1
// - pit "1" closest to store from a player's perspective corresponds to index n-1
//
// A "move" is choosing pit_index on the CURRENT player's side.

export const CaptureRule = Object.freeze({
  KALAH: "kalah",   // standard Kalah capture
  NONE: "none",
});

export function makeRules({
  pitsPerSide = 6,
  seedsPerPit = 4,
  extraTurnOnStore = true,
  sweepOnGameEnd = true,
  captureRule = CaptureRule.KALAH,
  allowMoveFromEmpty = false,
} = {}) {
  if (!Number.isInteger(pitsPerSide) || pitsPerSide <= 0) throw new Error("pitsPerSide must be positive int");
  if (!Number.isInteger(seedsPerPit) || seedsPerPit < 0) throw new Error("seedsPerPit must be nonnegative int");
  return {
    pitsPerSide,
    seedsPerPit,
    extraTurnOnStore,
    sweepOnGameEnd,
    captureRule,
    allowMoveFromEmpty,
  };
}

/** State factory */
export function initStandard(rules, toMove = 0) {
  const n = rules.pitsPerSide;
  const pits = [
    Array(n).fill(rules.seedsPerPit),
    Array(n).fill(rules.seedsPerPit),
  ];
  return {
    pits,
    store: [0, 0],
    toMove: toMove === 1 ? 1 : 0,
  };
}

/** Initialize from explicit arrays (openings / variants / midgame positions) */
export function initFromArrays(rules, pits0, pits1, store0 = 0, store1 = 0, toMove = 0) {
  const n = rules.pitsPerSide;
  if (!Array.isArray(pits0) || pits0.length !== n) throw new Error("pits0 wrong length");
  if (!Array.isArray(pits1) || pits1.length !== n) throw new Error("pits1 wrong length");
  return {
    pits: [pits0.slice(), pits1.slice()],
    store: [store0 | 0, store1 | 0],
    toMove: toMove === 1 ? 1 : 0,
  };
}

export function cloneState(st) {
  return {
    pits: [st.pits[0].slice(), st.pits[1].slice()],
    store: [st.store[0], st.store[1]],
    toMove: st.toMove,
  };
}

export function isTerminal(st, rules) {
  const n = rules.pitsPerSide;
  let z0 = true, z1 = true;
  for (let i = 0; i < n; i++) {
    if (st.pits[0][i] !== 0) z0 = false;
    if (st.pits[1][i] !== 0) z1 = false;
  }
  return z0 || z1;
}

export function finalizeIfTerminal(st, rules) {
  if (!isTerminal(st, rules)) return st;
  if (!rules.sweepOnGameEnd) return st;

  const ns = cloneState(st);
  const n = rules.pitsPerSide;

  for (let side = 0; side < 2; side++) {
    let sweep = 0;
    for (let i = 0; i < n; i++) {
      sweep += ns.pits[side][i];
      ns.pits[side][i] = 0;
    }
    ns.store[side] += sweep;
  }
  return ns;
}

export function getValidMoves(st, rules) {
  const p = st.toMove;
  const n = rules.pitsPerSide;
  const moves = [];
  for (let i = 0; i < n; i++) {
    const seeds = st.pits[p][i];
    if (!rules.allowMoveFromEmpty && seeds === 0) continue;
    moves.push(i);
  }
  return moves;
}

/**
 * Returns a list of drop locations for sowing animation (one entry per seed).
 * Each entry: { kind: "pit"|"store", side: 0|1, index?: pitIndex }
 */
function sowPath(st, rules, mover, pitIndex) {
  const n = rules.pitsPerSide;
  let hand = st.pits[mover][pitIndex];
  const path = [];
  if (hand <= 0) return path;

  // ring positions 0..(2n)
  // 0..n-1: mover pits
  // n: mover store
  // n+1..2n: opponent pits
  const ringLen = 2 * n + 1;
  let ringPos = (pitIndex + 1) % ringLen;

  const opp = 1 - mover;

  while (hand > 0) {
    if (ringPos < n) {
      path.push({ kind: "pit", side: mover, index: ringPos });
    } else if (ringPos === n) {
      path.push({ kind: "store", side: mover });
    } else {
      path.push({ kind: "pit", side: opp, index: ringPos - (n + 1) });
    }
    hand--;
    ringPos = (ringPos + 1) % ringLen;
  }
  return path;
}

/**
 * Apply a move immutably.
 *
 * Returns:
 * {
 *   state: <new state>,
 *   path:  <sowing path array>,
 *   mover: 0|1,
 *   pitIndex: number,
 *   extraTurn: boolean,
 *   capture: { happened: boolean, pit?: number, oppPit?: number, captured?: number } ,
 *   terminal: boolean
 * }
 */
export function playMove(st, rules, pitIndex) {
  const n = rules.pitsPerSide;
  const mover = st.toMove;
  const opp = 1 - mover;

  if (pitIndex < 0 || pitIndex >= n) {
    return { ok: false, error: "pitIndex out of range" };
  }
  if (!rules.allowMoveFromEmpty && st.pits[mover][pitIndex] === 0) {
    return { ok: false, error: "empty pit" };
  }

  const path = sowPath(st, rules, mover, pitIndex);

  // Work on a copy
  const ns = cloneState(st);

  let hand = ns.pits[mover][pitIndex];
  ns.pits[mover][pitIndex] = 0;

  // To detect “was empty before last seed” for capture, we need the pre-move emptiness.
  const wasEmptyBefore = new Array(n).fill(false);
  for (let i = 0; i < n; i++) wasEmptyBefore[i] = (st.pits[mover][i] === 0);

  // Perform sowing according to path
  let last = null;
  for (const loc of path) {
    if (loc.kind === "store") {
      ns.store[loc.side] += 1;
      last = { ...loc };
    } else {
      ns.pits[loc.side][loc.index] += 1;
      last = { ...loc };
    }
    hand--;
  }

  // Capture (standard Kalah)
  let captureInfo = { happened: false };
  if (rules.captureRule === CaptureRule.KALAH && last && last.kind === "pit" && last.side === mover) {
    const i = last.index;
    // last seed made it 1 and it was empty before the move (for that side/pit)
    if (wasEmptyBefore[i] && ns.pits[mover][i] === 1) {
      const oppI = (n - 1) - i;
      const oppSeeds = ns.pits[opp][oppI];
      if (oppSeeds > 0) {
        ns.pits[opp][oppI] = 0;
        ns.pits[mover][i] = 0;
        ns.store[mover] += oppSeeds + 1;
        captureInfo = { happened: true, pit: i, oppPit: oppI, captured: oppSeeds + 1 };
      }
    }
  }

  // Extra turn if last seed in mover store
  const extraTurn = !!(rules.extraTurnOnStore && last && last.kind === "store" && last.side === mover);
  ns.toMove = extraTurn ? mover : opp;

  // Terminal finalize
  const terminalBeforeSweep = isTerminal(ns, rules);
  const nsFinal = finalizeIfTerminal(ns, rules);
  const terminal = isTerminal(nsFinal, rules);

  return {
    ok: true,
    state: nsFinal,
    path,
    mover,
    pitIndex,
    extraTurn,
    capture: captureInfo,
    terminal: terminalBeforeSweep || terminal,
  };
}

/** Utility for the evaluation term N_{p,1}: pit closest to store is index n-1 */
export function pit1Index(rules) {
  return rules.pitsPerSide - 1;
}