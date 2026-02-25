// ai.js
import { getValidMoves, playMove, pit1Index } from "./engine.js";

/**
 * Evaluate leaf state for root player.
 * startStoreP/startStoreO are stores at root.
 * repRoot = number of extra turns earned by root along the line.
 */
function evalCost(st, rules, rootP, startStoreP, startStoreO, repRoot) {
  const o = 1 - rootP;

  const dp = st.store[rootP] - startStoreP;
  const do_ = st.store[o] - startStoreO;

  const i1 = pit1Index(rules); // n-1
  const pit1Empty = (st.pits[rootP][i1] === 0) ? 1 : 0;

  return 10 * (dp - do_) + repRoot + 5 * pit1Empty;
}

/**
 * Simple move ordering: prefer moves that (a) give extra turn, (b) capture, (c) increase store.
 * Helps alpha-beta a lot.
 */
function orderMoves(st, rules, moves) {
  const p = st.toMove;
  const scored = moves.map((mv) => {
    const res = playMove(st, rules, mv);
    if (!res.ok) return { mv, score: -1e18 };

    // heuristic: extra turn big, capture medium, store gain small
    const extra = res.extraTurn ? 1000 : 0;
    const cap = res.capture?.happened ? 200 : 0;
    const storeGain = res.state.store[p] - st.store[p];
    return { mv, score: extra + cap + storeGain };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map(x => x.mv);
}

function alphabeta(st, rules, depth, alpha, beta, rootP, startStoreP, startStoreO, repRoot) {
  // leaf
  if (depth <= 0 || st.terminal) {
    return evalCost(st, rules, rootP, startStoreP, startStoreO, repRoot);
  }

  const moves = getValidMoves(st, rules);
  if (moves.length === 0) {
    return evalCost(st, rules, rootP, startStoreP, startStoreO, repRoot);
  }

  const maximizing = (st.toMove === rootP);
  const ordered = orderMoves(st, rules, moves);

  if (maximizing) {
    let best = -Infinity;
    for (const mv of ordered) {
      const res = playMove(st, rules, mv);
      if (!res.ok) continue;

      // Count repeats for ROOT player only
      let rep2 = repRoot;
      if (res.mover === rootP && res.extraTurn) rep2 += 1;

      const val = alphabeta(res.state, rules, depth - 1, alpha, beta, rootP, startStoreP, startStoreO, rep2);
      best = Math.max(best, val);
      alpha = Math.max(alpha, best);
      if (alpha >= beta) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (const mv of ordered) {
      const res = playMove(st, rules, mv);
      if (!res.ok) continue;

      let rep2 = repRoot;
      if (res.mover === rootP && res.extraTurn) rep2 += 1;

      const val = alphabeta(res.state, rules, depth - 1, alpha, beta, rootP, startStoreP, startStoreO, rep2);
      best = Math.min(best, val);
      beta = Math.min(beta, best);
      if (alpha >= beta) break;
    }
    return best;
  }
}

/**
 * Compute best move for the current player st.toMove, using alpha-beta minimax.
 * Returns:
 *  { hasMove: boolean, move: number, score: number }
 */
export function bestMove(st, rules, depth) {
  const moves = getValidMoves(st, rules);
  if (moves.length === 0) return { hasMove: false, move: -1, score: -Infinity };

  const rootP = st.toMove;
  const startStoreP = st.store[rootP];
  const startStoreO = st.store[1 - rootP];

  // Depth policy: if depth<=0, still pick best 1-ply by evaluating after move.
  const searchDepth = (depth <= 0) ? 1 : depth;

  let bestMv = moves[0];
  let bestScore = -Infinity;
  let alpha = -Infinity;
  const beta = Infinity;

  const ordered = orderMoves(st, rules, moves);

  for (const mv of ordered) {
    const res = playMove(st, rules, mv);
    if (!res.ok) continue;

    let repRoot = 0;
    if (res.mover === rootP && res.extraTurn) repRoot = 1;

    const val = alphabeta(res.state, rules, searchDepth - 1, alpha, beta,
                          rootP, startStoreP, startStoreO, repRoot);

    if (val > bestScore) {
      bestScore = val;
      bestMv = mv;
    }
    alpha = Math.max(alpha, bestScore);
  }

  return { hasMove: true, move: bestMv, score: bestScore };
}

/**
 * Optional helper: score every legal move (useful for "cheat" / UI).
 * Returns array of { move, score } sorted best-first.
 */
export function scoreMoves(st, rules, depth) {
  const moves = getValidMoves(st, rules);
  const rootP = st.toMove;
  const startStoreP = st.store[rootP];
  const startStoreO = st.store[1 - rootP];
  const searchDepth = (depth <= 0) ? 1 : depth;

  const out = [];
  for (const mv of moves) {
    const res = playMove(st, rules, mv);
    if (!res.ok) continue;

    let repRoot = 0;
    if (res.mover === rootP && res.extraTurn) repRoot = 1;

    const score = alphabeta(res.state, rules, searchDepth - 1, -Infinity, Infinity,
                            rootP, startStoreP, startStoreO, repRoot);
    out.push({ move: mv, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}