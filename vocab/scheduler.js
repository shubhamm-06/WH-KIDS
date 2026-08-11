import { WORDS } from "./words.js";

export const SLOTS = 3;
export const MIN_GAP = 4;
export const MAX_NEW = 2;
export const REST = 8;
export const MAX_SHOWS = 4;
const wordById = new Map(WORDS.map(word => [word.id, word]));

export function freshEpisode() {
  return {
    round: 1,
    words: Object.fromEntries(WORDS.map(({ id }) => [id, {
      strength: 0,
      lastSeen: -1,
      droppedFrom: 0,
      stalls: 0,
      shows: 0
    }])),
    jars: [],
    activeRound: [],
    helped: []
  };
}

export function normaliseEpisode(candidate) {
  const base = freshEpisode();
  if (!candidate || typeof candidate !== "object") return base;
  base.round = Number.isInteger(candidate.round) && candidate.round > 0 ? candidate.round : 1;
  for (const { id } of WORDS) {
    const saved = candidate.words?.[id];
    if (!saved || typeof saved !== "object") continue;
    base.words[id] = {
      strength: Math.max(0, Math.min(3, Number(saved.strength) || 0)),
      lastSeen: Number.isInteger(saved.lastSeen) ? saved.lastSeen : -1,
      droppedFrom: Math.max(0, Math.min(3, Number(saved.droppedFrom) || 0)),
      stalls: Math.max(0, Number(saved.stalls) || 0),
      shows: Math.max(0, Math.min(MAX_SHOWS, Number(saved.shows) || 0))
    };
  }
  const known = new Set(WORDS.map(({ id }) => id));
  base.jars = Array.isArray(candidate.jars) ? [...new Set(candidate.jars.filter(id => known.has(id)))] : [];
  const roundWhos = new Set();
  base.activeRound = Array.isArray(candidate.activeRound)
    ? candidate.activeRound.filter(item => {
      const word = wordById.get(item?.id);
      if (!word || !known.has(item.id) || ![1, 2, 3].includes(item.level) || roundWhos.has(word.who)) return false;
      roundWhos.add(word.who);
      return true;
    }).slice(0, SLOTS)
    : [];
  base.helped = Array.isArray(candidate.helped)
    ? [...new Set(candidate.helped.filter(id => base.activeRound.some(item => item.id === id)))]
    : [];
  return base;
}

export function composeRound(state) {
  const r = state.round;
  const out = [];
  const selectedWhos = new Set();
  let fresh = 0;

  WORDS.map(w => ({ w, st: state.words[w.id] }))
    .filter(({ st }) => (st.shows || 0) < MAX_SHOWS)
    .filter(({ st }) => st.strength < 3 || (r - st.lastSeen) >= REST)
    .filter(({ st }) => st.lastSeen < 0 || (r - st.lastSeen) >= MIN_GAP)
    .sort((a, b) => (a.st.strength - b.st.strength) || (a.st.lastSeen - b.st.lastSeen))
    .forEach(({ w, st }) => {
      if (out.length >= SLOTS) return;
      if (selectedWhos.has(w.who)) return;
      const isNew = st.lastSeen < 0;
      if (isNew && fresh >= MAX_NEW && r > 1) return;
      if (isNew) fresh += 1;
      selectedWhos.add(w.who);
      out.push({ id: w.id, level: Math.min(st.strength, 2) + 1 });
    });

  return out;
}

export function applyResult(state, id, helpUsed) {
  const st = state.words[id];
  st.lastSeen = state.round;
  st.shows = (st.shows || 0) + 1;

  if (helpUsed === 0) {
    st.strength = Math.min(3, st.strength + 1);
    st.stalls = 0;
  } else if (helpUsed >= 3) {
    if (st.strength > 0 && st.strength > st.droppedFrom) {
      st.droppedFrom = st.strength;
      st.strength -= 1;
    } else {
      st.strength = Math.min(3, st.strength + 1);
    }
    st.stalls = 0;
  } else {
    st.stalls = (st.stalls || 0) + 1;
    if (st.stalls >= 2) {
      st.strength = Math.min(3, st.strength + 1);
      st.stalls = 0;
    }
  }

  if (st.strength > 0 && !state.jars.includes(id)) state.jars.push(id);
}
