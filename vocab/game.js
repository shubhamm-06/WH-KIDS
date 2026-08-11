import { CAST, WORDS } from "./words.js";
import { MAX_SHOWS, applyResult, composeRound, freshEpisode, normaliseEpisode } from "./scheduler.js";

const SAVE_KEY = "wisdomhatch.wordlab.v1";
const MUTE_KEY = "wisdomhatch.wordlab.muted";
const INTRO_KEY = "wisdomhatch.wordlab.intro-seen";
const TUTORIAL_KEY = "wisdomhatch.wordlab.tutorial-seen";
const AUDIO_BASE = "assets/audio/";
const BGM_FILE = "bgm-loop.mp3";
const BGM_VOLUME = 0.30;
const BGM_DUCK_RATIO = 0.2;
const SFX_DUCK_RATIO = 0.42;
const AUDIO_FADE_SECONDS = 0.3;
const IS_DEVELOPMENT = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname)
  || window.location.protocol === "file:";
const EPISODE_ID = document.documentElement.dataset.episode;
const app = document.querySelector("#app");
const rotateView = document.querySelector("#rotate-view");
const wordById = new Map(WORDS.map(word => [word.id, word]));
const quietWords = new Set(["trust", "agreed", "promise"]);
const SUCCESS_LINES = ["You did it!", "Lovely!", "That's the word!", "Wonderful!"];
// Shown when every slot is full but the letters are in the wrong order. The
// tier is chosen by how many letters are already home, then a line is picked
// at random within it, so the same words never repeat back to back. Text
// only: nothing here is spoken, and nothing here says "wrong".
const NUDGE_LINES = {
  warm: [
    "So close! Just a little swap.",
    "Almost there. One more move.",
    "Nearly! Try swapping two letters."
  ],
  middle: [
    "Nearly! Try moving them around.",
    "Good try. Move the letters around.",
    "Keep going. Try another order."
  ],
  far: [
    "Keep going. You can move the letters around.",
    "Have another go. Move them about.",
    "Try the letters in a different order."
  ]
};
const NUDGE_DELAY = 450;
const imageState = new Map();
const audioState = new Map();
const sfxState = new Map();
const activeSfx = new Set();
// Only the lines the game can still play. Buttons no longer speak their own
// label, so those recordings are never fetched.
const audioKeys = new Set([
  "ui-open-stall",
  "ui-someone-waiting",
  "ui-stall-closed",
  "ui-help-me",
  "ui-word-stall-intro",
  ...WORDS.flatMap(word => [
    `ui-name-${word.who}`,
    word.id,
    `${word.id}_ask`,
    `${word.id}_cloze`,
    `${word.id}_clue`,
    `${word.id}_def`,
    `${word.id}_help`
  ])
]);

let envelope = loadEnvelope();
let episode = normaliseEpisode(envelope[EPISODE_ID]);
let helpTimer = 0;
let currentAudio = null;
let currentLineToken = 0;
let bgmAudio = null;
let bgmContext = null;
let bgmGain = null;
let bgmStarted = false;
let bgmUnavailable = false;
let bgmDucked = false;
let sfxDucked = false;
let bgmFadeFrame = 0;
let muted = loadMuteSetting();
let build = null;
let screenTransitionTimer = 0;
let successLineIndex = 0;
let nudgeTimer = 0;
let lastNudgeLine = "";

function sfxCandidates(name) {
  const compatibleNames = name === "tile-land" ? ["tile-land", "tile-place"] : [name];
  return compatibleNames.flatMap(base => [
    `${AUDIO_BASE}sfx-${base}.mp3`,
    `${AUDIO_BASE}sfx-${base}.wav`
  ]);
}

function startSfx(url) {
  const effect = new Audio(url);
  effect.preload = "auto";
  effect.volume = 1;
  activeSfx.add(effect);
  if (!sfxDucked) {
    sfxDucked = true;
    updateMusicForSfx(.08);
  }
  const clear = () => {
    activeSfx.delete(effect);
    if (!activeSfx.size && sfxDucked) {
      sfxDucked = false;
      updateMusicForSfx(.18);
    }
  };
  effect.addEventListener("ended", clear, { once:true });
  effect.addEventListener("error", clear, { once:true });
  effect.play().catch(clear);
}

function probeSfx(name, candidates, index = 0) {
  const url = candidates[index];
  if (!url) {
    sfxState.set(name, false);
    return;
  }
  const probe = new Audio(url);
  probe.preload = "auto";
  probe.addEventListener("canplay", () => {
    sfxState.set(name, url);
    startSfx(url);
  }, { once:true });
  probe.addEventListener("error", () => probeSfx(name, candidates, index + 1), { once:true });
  probe.load();
}

export function playSfx(name) {
  const ready = sfxState.get(name);
  if (typeof ready === "string") {
    startSfx(ready);
    return;
  }
  if (ready === false || ready === "probing") return;
  sfxState.set(name, "probing");
  probeSfx(name, sfxCandidates(name));
}

function node(tag, className = "", text = "") {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text) item.textContent = text;
  return item;
}

function fallbackFragment() {
  return document.createDocumentFragment();
}

export function img(name, fallbackFn, options = {}) {
  const holder = node("span", options.className || "");
  const useFallback = () => {
    holder.replaceChildren();
    const fallback = fallbackFn();
    if (fallback) holder.append(fallback);
  };
  const known = imageState.get(name);
  if (known === false) {
    useFallback();
    return holder;
  }

  const picture = new Image();
  picture.alt = options.alt || "";
  picture.draggable = false;
  picture.addEventListener("load", () => imageState.set(name, true), { once:true });
  picture.addEventListener("error", () => {
    imageState.set(name, false);
    useFallback();
  }, { once:true });
  picture.src = `assets/images/${name}.png`;
  holder.append(picture);
  return holder;
}

function audioUrl(key) {
  return `${AUDIO_BASE}${key}.mp3`;
}

function loadMuteSetting() {
  try { return localStorage.getItem(MUTE_KEY) === "true"; } catch { return false; }
}

function saveMuteSetting() {
  try { localStorage.setItem(MUTE_KEY, String(muted)); } catch { /* sound still works */ }
}

function hasSeenIntroduction() {
  try { return localStorage.getItem(INTRO_KEY) === "true"; } catch { return false; }
}

function markIntroductionSeen() {
  try { localStorage.setItem(INTRO_KEY, "true"); } catch { /* play carries on */ }
}

function hasSeenTutorial() {
  try { return localStorage.getItem(TUTORIAL_KEY) === "true"; } catch { return false; }
}

function markTutorialSeen() {
  try { localStorage.setItem(TUTORIAL_KEY, "true"); } catch { /* play carries on */ }
}

// Testing hooks. Add ?tutorial=reset to the address to see the walkthrough
// again, or call wordLab.resetTutorial() in the console.
function resetTutorialFlag() {
  try {
    localStorage.removeItem(TUTORIAL_KEY);
    localStorage.removeItem(INTRO_KEY);
  } catch { /* nothing to clear */ }
}

function resetEverything() {
  try {
    localStorage.removeItem(SAVE_KEY);
    localStorage.removeItem(TUTORIAL_KEY);
    localStorage.removeItem(INTRO_KEY);
  } catch { /* nothing to clear */ }
}

function applyResetFromAddress() {
  const asked = new URLSearchParams(window.location.search).get("tutorial");
  if (asked === "reset") resetTutorialFlag();
  if (asked === "all") resetEverything();
}

function setMuted(nextMuted) {
  muted = nextMuted;
  saveMuteSetting();
  updateMuteButton();
  fadeBgmTo(musicTarget());
}

function renderAudioControls() {
  const controls = node("div", "top-controls");
  const button = node("button", "audio-toggle");
  button.type = "button";
  button.addEventListener("click", () => {
    if (muted) {
      setMuted(false);
      playSfx("tap");
      return;
    }
    playSfx("tap");
    window.setTimeout(() => setMuted(true), 100);
  });
  const fullscreen = node("button", "fullscreen-toggle");
  fullscreen.type = "button";
  fullscreen.addEventListener("click", toggleFullscreen);
  controls.append(button, fullscreen);
  document.body.append(controls);
  updateMuteButton();
  updateFullscreenButton();
  document.addEventListener("fullscreenchange", updateFullscreenButton);
}

function updateMuteButton() {
  const button = document.querySelector(".audio-toggle");
  if (!button) return;
  // A picture, not a word. The child reads the speaker, not the label.
  button.textContent = muted ? "🔇" : "🔊";
  button.setAttribute("aria-label", muted ? "Unmute music" : "Mute music");
  button.setAttribute("aria-pressed", String(muted));
}

function fullscreenIcon(isFullscreen) {
  const path = isFullscreen
    ? "M9 4v5H4M15 9h5V4M20 15v5h-5M9 15H4v5"
    : "M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5";
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${path}" /></svg>`;
}

function updateFullscreenButton() {
  const button = document.querySelector(".fullscreen-toggle");
  if (!button) return;
  const isFullscreen = Boolean(document.fullscreenElement);
  button.innerHTML = fullscreenIcon(isFullscreen);
  button.setAttribute("aria-label", isFullscreen ? "Exit fullscreen" : "Enter fullscreen");
  button.setAttribute("title", isFullscreen ? "Exit fullscreen" : "Enter fullscreen");
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else if (document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen();
    }
  } catch {
    // Fullscreen can be denied by browser or iframe policy; the game remains usable.
  }
  updateFullscreenButton();
}

function musicTarget() {
  if (bgmDucked) return BGM_VOLUME * BGM_DUCK_RATIO;
  if (sfxDucked) return BGM_VOLUME * SFX_DUCK_RATIO;
  return BGM_VOLUME;
}

function fadeBgmTo(target, duration = AUDIO_FADE_SECONDS) {
  if (!bgmAudio || bgmUnavailable) return;
  const destination = muted ? 0 : target;

  if (bgmGain && bgmContext) {
    const now = bgmContext.currentTime;
    bgmGain.gain.cancelScheduledValues(now);
    bgmGain.gain.setValueAtTime(bgmGain.gain.value, now);
    bgmGain.gain.linearRampToValueAtTime(destination, now + duration);
    return;
  }

  window.cancelAnimationFrame(bgmFadeFrame);
  const start = bgmAudio.volume;
  const startedAt = performance.now();
  const animate = now => {
    const progress = Math.min(1, (now - startedAt) / (duration * 1000));
    bgmAudio.volume = start + ((destination - start) * progress);
    if (progress < 1) bgmFadeFrame = window.requestAnimationFrame(animate);
  };
  bgmFadeFrame = window.requestAnimationFrame(animate);
}

function setMusicDucked(ducked) {
  bgmDucked = ducked;
  fadeBgmTo(musicTarget());
}

function updateMusicForSfx(duration) {
  if (!bgmDucked) fadeBgmTo(musicTarget(), duration);
}

function startBackgroundMusic() {
  if (bgmStarted) {
    if (bgmContext) bgmContext.resume().catch(() => {});
    if (bgmAudio && !bgmUnavailable) bgmAudio.play().catch(() => {});
    return;
  }

  bgmStarted = true;
  const audio = new Audio(`${AUDIO_BASE}${BGM_FILE}`);
  audio.loop = true;
  audio.preload = "auto";
  audio.volume = muted ? 0 : BGM_VOLUME;
  bgmAudio = audio;
  audio.addEventListener("error", () => {
    bgmUnavailable = true;
    bgmAudio = null;
  }, { once:true });

  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      bgmContext = new AudioContextClass();
      const source = bgmContext.createMediaElementSource(audio);
      bgmGain = bgmContext.createGain();
      audio.volume = 1;
      bgmGain.gain.value = muted ? 0 : BGM_VOLUME;
      source.connect(bgmGain).connect(bgmContext.destination);
      bgmContext.resume().catch(() => {});
    }
  } catch {
    bgmContext = null;
    bgmGain = null;
    audio.volume = muted ? 0 : BGM_VOLUME;
  }

  audio.play().catch(() => {});
}

async function auditAudioFiles() {
  const requiredFiles = [...audioKeys].sort().map(audioUrl);
  requiredFiles.push(`${AUDIO_BASE}${BGM_FILE}`);
  console.info(`[audio] Required files (${requiredFiles.length}):`, requiredFiles);

  const results = await Promise.all(requiredFiles.map(async file => {
    try {
      const response = await fetch(file, { cache:"no-store" });
      if (response.body) response.body.cancel();
      if (response.ok) return { file, status:"available" };
      if (response.status === 404) return { file, status:"missing" };
      return { file, status:"unverified", detail:`HTTP ${response.status}` };
    } catch {
      return { file, status:"unverified", detail:"request failed" };
    }
  }));

  for (const result of results) {
    const key = result.file.slice(AUDIO_BASE.length, -4);
    if (result.status === "available" && key !== BGM_FILE.slice(0, -4)) audioState.set(key, true);
    if (result.status === "missing" && key !== BGM_FILE.slice(0, -4)) audioState.set(key, false);
  }

  const missing = results.filter(result => result.status === "missing").map(result => result.file);
  const unverified = results.filter(result => result.status === "unverified");
  console.info(`[audio] Missing files (${missing.length}):`, missing);
  if (unverified.length) console.info("[audio] Files not verified:", unverified);
}

function finishLine(lineToken, onEnded) {
  if (lineToken !== currentLineToken) return;
  setMusicDucked(false);
  if (onEnded) onEnded(lineToken);
}

function fallbackSpeech(key, text, lineToken, onEnded) {
  if (!("speechSynthesis" in window)) {
    finishLine(lineToken, onEnded);
    return;
  }
  if (IS_DEVELOPMENT) {
    console.warn(`[audio] Fallback voice used because ${key}.mp3 is missing.`);
  }
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = .86;
  utterance.pitch = 1.06;
  utterance.addEventListener("end", () => {
    finishLine(lineToken, onEnded);
  }, { once:true });
  utterance.addEventListener("error", () => {
    finishLine(lineToken, onEnded);
  }, { once:true });
  speechSynthesis.speak(utterance);
}

export function say(key, text, { onEnded } = {}) {
  const lineToken = ++currentLineToken;
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  setMusicDucked(true);
  if (audioState.get(key) === false) {
    fallbackSpeech(key, text, lineToken, onEnded);
    return;
  }
  const voice = new Audio(audioUrl(key));
  voice.preload = "auto";
  voice.volume = 1;
  currentAudio = voice;
  voice.addEventListener("canplay", () => audioState.set(key, true), { once:true });
  voice.addEventListener("ended", () => {
    if (currentAudio !== voice) return;
    currentAudio = null;
    finishLine(lineToken, onEnded);
  }, { once:true });
  voice.addEventListener("error", () => {
    if (currentAudio !== voice) return;
    audioState.set(key, false);
    currentAudio = null;
    voice.pause();
    fallbackSpeech(key, text, lineToken, onEnded);
  }, { once:true });
  voice.play().catch(error => {
    // A blocked play is not evidence that the file is missing. Wait for the
    // media error event before using speech synthesis.
    if (currentAudio !== voice || error?.name === "NotSupportedError") return;
    if (error?.name === "NotAllowedError" || error?.name === "AbortError") {
      currentAudio = null;
      finishLine(lineToken, onEnded);
    }
  });
}

function loadEnvelope() {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || "{}");
    return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  } catch {
    return {};
  }
}

function saveEpisode() {
  envelope[EPISODE_ID] = episode;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(envelope)); } catch { /* play carries on */ }
}

function spoken(element, key, text) {
  element.dataset.say = key;
  element.addEventListener("click", event => {
    event.stopPropagation();
    say(key, text);
  });
  return element;
}

// Buttons are silent. Tapping one stops whatever is playing and moves on, so
// the child is never made to sit through a line before the game responds.
function actionButton(label, className, action, pause = 180) {
  const button = node("button", className, label);
  button.type = "button";
  button.addEventListener("click", () => {
    button.disabled = true;
    playSfx("tap");
    fadeOutCurrentAudio(200);
    window.setTimeout(action, pause);
  });
  return button;
}

function cssFigure(who) {
  const figure = node("div", `figure-fallback ${figureTone(who)}`);
  figure.append(node("span", "figure-head"), node("span", "figure-body"));
  return figure;
}

function figureTone(who) {
  const tones = ["", "plum", "gold", "leaf"];
  return tones[Math.abs([...who].reduce((sum, char) => sum + char.charCodeAt(0), 0)) % tones.length];
}

function personArt(word, mood = "ask") {
  const cast = CAST[word.who];
  const baseName = cast.img;
  const artName = mood === "happy"
    ? (baseName.endsWith("-ask") ? baseName.replace("-ask", "-happy") : `${baseName}-happy`)
    : baseName;
  const fallback = mood === "happy"
    ? () => img(baseName, () => cssFigure(word.who), { className:"fallback-person-image" })
    : () => cssFigure(word.who);
  return img(artName, fallback, { className:"person-art" });
}

function wordPicture(word, className = "word-picture") {
  return img(`word-${word.id}`, () => node("span", "emoji-picture", word.emoji), { className });
}

function jarArt(isFull) {
  return img(isFull ? "jar-full" : "jar-empty", () => node("span", "jar-css"), { className:"jar-art" });
}

function lantern(isOn) {
  return img(isOn ? "lantern-on" : "lantern-off", () => node("span", "lantern-css"), {
    className:`lantern ${isOn ? "is-on" : ""}`
  });
}

function marketScene(container) {
  container.append(
    img("market-bg", () => node("span", "market-flat"), { className:"market-base" }),
    img("stall-awning", fallbackFragment, { className:"awning-layer" }),
    // No fallback slab here. With no counter art the market photograph carries
    // the bottom of the scene, instead of a cream band sitting on top of it.
    img("stall-counter", fallbackFragment, { className:"counter-layer" }),
    node("span", "scene-scrim")
  );
}

function mountScreen(screen, immediate = false) {
  window.clearTimeout(screenTransitionTimer);
  const previous = app.firstElementChild;
  if (!previous || immediate) {
    app.replaceChildren(screen);
    return;
  }
  previous.classList.add("is-leaving");
  screenTransitionTimer = window.setTimeout(() => {
    app.replaceChildren(screen);
    screen.classList.add("is-entering");
    window.requestAnimationFrame(() => screen.classList.add("is-visible"));
  }, 120);
}

function fadeOutCurrentAudio(duration = 250) {
  if (!currentAudio) return;
  const voice = currentAudio;
  const startingVolume = voice.volume;
  const startedAt = performance.now();
  const fade = now => {
    if (currentAudio !== voice) return;
    const progress = Math.min(1, (now - startedAt) / duration);
    voice.volume = startingVolume * (1 - progress);
    if (progress < 1) {
      window.requestAnimationFrame(fade);
      return;
    }
    voice.pause();
    currentAudio = null;
    setMusicDucked(false);
  };
  window.requestAnimationFrame(fade);
}

function jarShelf(fullShelf = false) {
  const shelf = node("section", "jar-shelf");
  shelf.setAttribute("aria-label", "Word jars");
  shelf.append(img("shelf", fallbackFragment, { className:"shelf-art" }));
  for (const word of WORDS) {
    const isFull = fullShelf || episode.jars.includes(word.id);
    const jarButton = node("button", `jar-button ${isFull ? "is-full" : "is-empty"}`);
    jarButton.type = "button";
    jarButton.disabled = !isFull;
    jarButton.setAttribute("aria-label", isFull ? word.t : "Empty jar");
    const picture = node("span", "jar-picture");
    picture.append(jarArt(isFull));
    if (isFull) picture.append(wordPicture(word, "jar-word-picture"));
    jarButton.append(picture);
    if (isFull) jarButton.append(node("span", "jar-label", word.t));
    if (isFull) jarButton.addEventListener("click", () => say(word.id, `${word.t}. ${word.def}`));
    shelf.append(jarButton);
  }
  return shelf;
}

function shell(screenClass, { fullShelf = false } = {}) {
  clearTimeout(helpTimer);
  clearTutorial();
  finishDrag();
  window.clearTimeout(nudgeTimer);
  const screen = node("section", `screen game-shell ${screenClass}`);
  marketScene(screen);
  screen.append(jarShelf(fullShelf));
  const area = node("div", "play-area");
  screen.append(area);
  mountScreen(screen);
  return area;
}

function renderTap() {
  clearTimeout(helpTimer);
  const screen = node("section", "screen tap-screen");
  marketScene(screen);
  const button = node("button", "open-button", "Tap to open your stall");
  button.type = "button";
  button.addEventListener("click", () => {
    playSfx("stall-open");
    startBackgroundMusic();
    if (hasSeenIntroduction()) {
      ensureRound();
      renderQueue();
    } else {
      renderIntroduction();
    }
  });
  screen.append(button);
  mountScreen(screen, true);
}

function renderIntroduction() {
  const screen = node("section", "screen intro-screen");
  marketScene(screen);
  const card = node("section", "intro-card");
  const title = node("h1", "intro-title", "Your word stall");
  const line = node("p", "intro-line", "This is your word stall. People will come and ask you for a word. You build the word and hand it over.");
  const button = node("button", "intro-continue", "Let's begin");
  button.type = "button";
  card.append(title, line, button);
  screen.append(card);

  let leaving = false;
  const continueToQueue = () => {
    if (leaving) return;
    leaving = true;
    playSfx("tap");
    markIntroductionSeen();
    fadeOutCurrentAudio(250);
    window.setTimeout(() => {
      ensureRound();
      renderQueue();
    }, 250);
  };
  screen.addEventListener("click", continueToQueue);
  button.addEventListener("click", event => {
    event.stopPropagation();
    continueToQueue();
  });
  mountScreen(screen);
  say("ui-word-stall-intro", line.textContent);
}

// A one-off walkthrough of a single round: the queue, then the letters, then
// the button. It guides, it never blocks, and Skip is on screen the whole time.
// Where the caption sits is set per step, because the three screens have
// different gaps free. Measured against the real layout, not guessed.
const TUTORIAL_STEPS = {
  queue: {
    target:".person-card", text:"Tap somebody to help them.",
    pointer:"above", caption:"above", hideHeading:true
  },
  tiles: {
    target:".tiles", text:"Tap the letters to build the word.",
    pointer:"above", caption:"below"
  },
  hand: {
    target:".handover-button", text:"Now hand it over.",
    pointer:"above", caption:"beside"
  }
};
const POINTER_SIZE = 44;

let tutorialStage = null;
let tutorialFrame = 0;

function clearTutorial() {
  window.cancelAnimationFrame(tutorialFrame);
  tutorialStage = null;
  const layer = document.querySelector(".tutorial-layer");
  if (layer) layer.remove();
  const coached = document.querySelector(".is-coaching");
  if (coached) coached.classList.remove("is-coaching");
}

function skipTutorial() {
  playSfx("tap");
  markTutorialSeen();
  clearTutorial();
}

function finishTutorial() {
  markTutorialSeen();
  clearTutorial();
}

function startTutorial(stage, area) {
  if (hasSeenTutorial() || tutorialStage === stage) return;
  clearTutorial();
  const step = TUTORIAL_STEPS[stage];
  const screen = area.closest(".screen");
  if (!step || !screen) return;
  tutorialStage = stage;

  const layer = node("div", "tutorial-layer");
  const ring = node("div", "tutorial-ring");
  const pointer = node("div", "tutorial-pointer");
  const caption = node("p", "tutorial-caption", step.text);
  const skip = node("button", "tutorial-skip", "Skip");
  skip.type = "button";
  skip.setAttribute("aria-label", "Skip the walkthrough");
  skip.addEventListener("click", skipTutorial);
  layer.append(ring, pointer, caption, skip);
  screen.append(layer);
  if (step.hideHeading) screen.classList.add("is-coaching");

  const place = () => {
    // One ring around everything the step is talking about, so three cards
    // read as one thing to choose from.
    const frame = screen.getBoundingClientRect();
    let top = Infinity, left = Infinity, right = -Infinity, bottom = -Infinity;
    for (const target of screen.querySelectorAll(step.target)) {
      const box = target.getBoundingClientRect();
      if (!box.width && !box.height) continue;
      top = Math.min(top, box.top);
      left = Math.min(left, box.left);
      right = Math.max(right, box.right);
      bottom = Math.max(bottom, box.bottom);
    }
    if (!Number.isFinite(top)) return;
    top -= frame.top;
    bottom -= frame.top;
    left -= frame.left;
    right -= frame.left;
    const width = right - left;
    const height = bottom - top;

    ring.style.top = `${top - 12}px`;
    ring.style.left = `${left - 12}px`;
    ring.style.width = `${width + 24}px`;
    ring.style.height = `${height + 24}px`;

    const pointsDown = step.pointer === "above";
    const pointerTop = pointsDown ? top - (POINTER_SIZE + 16) : bottom + 16;
    pointer.classList.toggle("arrow-down", pointsDown);
    pointer.style.top = `${pointerTop}px`;
    pointer.style.left = `${left + (width / 2) - (POINTER_SIZE / 2)}px`;

    caption.style.top = "auto";
    caption.style.bottom = "auto";
    caption.style.left = "50%";
    caption.style.maxWidth = "";
    caption.style.transform = "translateX(-50%)";
    if (step.caption === "above") {
      caption.style.bottom = `${frame.height - pointerTop + 14}px`;
    } else if (step.caption === "below") {
      caption.style.top = `${bottom + 16}px`;
    } else {
      // Alongside the target, using the empty space to its left.
      const room = left - 34;
      caption.style.top = `${top + (height / 2)}px`;
      caption.style.transform = "translate(-50%,-50%)";
      caption.style.left = `${Math.max(190, (room / 2) + 20)}px`;
      caption.style.maxWidth = `${Math.max(240, room - 70)}px`;
    }
  };

  // Cards and tiles slide in, so keep the pointer glued to them for a moment.
  place();
  const startedAt = performance.now();
  const follow = now => {
    place();
    if (now - startedAt < 1400) tutorialFrame = window.requestAnimationFrame(follow);
  };
  tutorialFrame = window.requestAnimationFrame(follow);
}

function wordIsFinished(id) {
  const state = episode.words[id];
  return state.strength === 3 || state.shows >= MAX_SHOWS;
}

function allWordsFinished() {
  return WORDS.every(word => wordIsFinished(word.id));
}

function revisionsCanReturn() {
  return WORDS.some(word => {
    const state = episode.words[word.id];
    return state.strength === 3 && state.shows < MAX_SHOWS;
  });
}

function ensureRound({ allowRevision = false } = {}) {
  if (episode.activeRound.length) return "ready";
  if (allWordsFinished() && !allowRevision) return "all-done";

  let selection = composeRound(episode);
  if (!allWordsFinished()) {
    let checked = 0;
    while (!selection.length && checked < 12) {
      episode.round += 1;
      selection = composeRound(episode);
      checked += 1;
    }
  }
  if (!selection.length) return "not-due";

  episode.activeRound = selection;
  episode.helped = [];
  saveEpisode();
  return "ready";
}

function roundLanterns(allOn = false) {
  const row = node("div", "lantern-row");
  for (let index = 0; index < 3; index += 1) {
    row.append(lantern(allOn || index < episode.helped.length));
  }
  return row;
}

function renderQueue({ allowRevision = false } = {}) {
  if (episode.activeRound.length && episode.helped.length >= episode.activeRound.length) {
    // Words at full strength that have not had all their showings yet are
    // resting, not finished, so this is not the end of the episode.
    if (allWordsFinished()) renderAllDone({ waitingForRevision:revisionsCanReturn() });
    else renderClosed();
    return;
  }
  const roundState = ensureRound({ allowRevision });
  if (roundState === "all-done") {
    renderAllDone();
    return;
  }
  if (roundState === "not-due") {
    if (allWordsFinished()) renderAllDone({ waitingForRevision:revisionsCanReturn() });
    else renderClosed();
    return;
  }
  const area = shell("queue-screen");
  area.append(roundLanterns());
  const headingText = episode.helped.length ? "Someone else is waiting." : "Who shall we help first?";
  const headingKey = episode.helped.length ? "ui-someone-waiting" : "ui-open-stall";
  area.append(spoken(node("h1", "queue-heading", headingText), headingKey, headingText));

  const people = node("div", "people-row");
  for (const item of episode.activeRound) {
    const word = wordById.get(item.id);
    const cast = CAST[word.who];
    const hasHelped = episode.helped.includes(word.id);
    const card = node("button", `person-card ${hasHelped ? "is-helped" : ""}`);
    card.type = "button";
    card.disabled = hasHelped;
    card.append(personArt(word));
    card.append(node("span", "person-name", cast.name));
    if (cast.has) card.append(node("span", "person-has", cast.has));
    if (!hasHelped) card.addEventListener("click", () => {
      if (people.dataset.leaving) return;
      people.dataset.leaving = "true";
      const cards = [...people.querySelectorAll(".person-card")];
      const middle = (cards.length - 1) / 2;
      cards.forEach((otherCard, otherIndex) => {
        otherCard.disabled = true;
        if (otherCard === card) {
          otherCard.style.setProperty("--queue-shift", `${Math.round((middle - otherIndex) * 82)}px`);
          otherCard.classList.add("is-chosen");
        } else {
          otherCard.classList.add("is-deemphasised");
        }
      });
      fadeOutCurrentAudio(250);
      window.setTimeout(() => renderServing(item, 130), 120);
    });
    people.append(card);
  }
  area.append(people);
  // The queue does not announce itself. The heading still speaks when tapped.
  if (!hasSeenTutorial()) startTutorial("queue", area);
}

function promptFor(word, level) {
  if (level === 1) return { key:`${word.id}_ask`, text:word.ask, second:word.cloze };
  if (level === 2) return { key:`${word.id}_cloze`, text:word.cloze, second:"" };
  return { key:`${word.id}_clue`, text:word.clue, second:"" };
}

function shuffled(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function prepareBuild(item) {
  const word = wordById.get(item.id);
  const letters = [...word.t];
  // Every slot tracks which tile is sitting in it, so a tile can be pulled
  // back out and moved somewhere else. Locked slots are the level-1 scaffold
  // letters: they are given, so they hold no tile and cannot be picked up.
  const slots = letters.map(() => ({ letter:null, tileId:null, locked:false }));
  if (item.level === 1) {
    slots[0] = { letter:letters[0], tileId:null, locked:true };
    slots[letters.length - 1] = { letter:letters.at(-1), tileId:null, locked:true };
  }
  const needed = letters.filter((letter, index) => !slots[index].locked);
  const spareCount = item.level === 1 ? 0 : item.level;
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const spares = [];
  let cursor = Math.floor(Math.random() * alphabet.length);
  while (spares.length < spareCount) {
    const letter = alphabet[cursor % alphabet.length];
    cursor += 7;
    if (!letters.includes(letter)) spares.push(letter);
  }
  return {
    item,
    word,
    letters,
    slots,
    tiles:shuffled([...needed, ...spares]).map((letter, index) => ({ id:`tile-${index}`, letter, placed:null })),
    selectedTileId:null,
    wasSolved:false,
    wrongArrangementSfxPlayed:false,
    helpUsed:0,
    busy:false
  };
}

function renderServing(item, promptDelay = 0) {
  build = prepareBuild(item);
  const area = shell("serve-screen");
  const layout = node("div", "serve-layout");
  const person = node("div", "serve-person");
  person.append(personArt(build.word));
  layout.append(person);

  const bench = node("div", "workbench");
  const prompt = promptFor(build.word, item.level);
  const bubbleRow = node("div", "bubble-row");
  const bubble = node("div", "speech-bubble");
  bubble.append(img("speech-bubble", fallbackFragment, { className:"bubble-skin" }));
  bubble.append(node("span", "prompt-line", prompt.text));
  if (prompt.second) bubble.append(node("span", "second-line", prompt.second));
  bubble.addEventListener("click", () => replayPrompt(prompt));
  const speaker = node("button", "speaker-button", "🔊");
  speaker.type = "button";
  speaker.setAttribute("aria-label", "Speak again");
  speaker.addEventListener("click", () => replayPrompt(prompt));
  bubbleRow.append(bubble, speaker);
  bench.append(bubbleRow);
  const tileStage = node("div", "tile-stage");
  const success = node("p", "success-message");
  success.setAttribute("aria-live", "polite");
  const nudge = node("p", "nudge-message");
  nudge.setAttribute("aria-live", "polite");
  tileStage.append(tileRow(), success, nudge);
  bench.append(slotRow(), tileStage);

  const actions = node("div", "serve-actions");
  const help = node("button", "help-button", "Help me");
  help.type = "button";
  help.addEventListener("click", () => useHelp(help, prompt));
  helpTimer = window.setTimeout(() => help.classList.add("is-visible"), 20000);
  const hand = node("button", "handover-button", "Hand it over");
  hand.type = "button";
  hand.disabled = !isBuilt();
  hand.addEventListener("click", handOver);
  actions.append(help, hand);
  bench.append(actions);
  layout.append(bench);
  area.append(layout);
  area.append(img("hatch-idle", fallbackFragment, { className:"hatch-art" }));
  if (promptDelay) {
    window.setTimeout(() => replayPrompt(prompt), promptDelay);
  } else {
    replayPrompt(prompt);
  }
  if (!hasSeenTutorial()) startTutorial("tiles", area);
}

function replayPrompt(prompt) {
  say(prompt.key, prompt.text, {
    onEnded: lineToken => {
      if (!prompt.second) return;
      window.setTimeout(() => {
        if (lineToken !== currentLineToken) return;
        say(`${build.word.id}_cloze`, prompt.second);
      }, 400);
    }
  });
}

function tileById(id) {
  return build.tiles.find(tile => tile.id === id) || null;
}

function slotsAreFull() {
  return build.slots.every(slot => Boolean(slot.letter));
}

// Full is not the same as right. The word is only solved when every slot
// holds the letter that belongs there.
function isSolved() {
  return build.slots.every((slot, index) => slot.letter === build.letters[index]);
}

function correctSlotCount() {
  return build.slots.filter((slot, index) => slot.letter === build.letters[index]).length;
}

function firstUnsolvedSlot() {
  return build.slots.findIndex((slot, index) => slot.letter !== build.letters[index]);
}

function removeTileFromSlot(index) {
  const slot = build.slots[index];
  if (!slot || slot.locked || !slot.tileId) return false;
  const tile = tileById(slot.tileId);
  if (tile) tile.placed = null;
  slot.letter = null;
  slot.tileId = null;
  return true;
}

function placeTileInSlot(tileId, index) {
  const slot = build.slots[index];
  const tile = tileById(tileId);
  if (!slot || !tile || slot.locked) return false;
  if (tile.placed === index) return false;
  // Vacate wherever this tile came from, and send any current occupant home.
  if (tile.placed !== null) {
    const previous = build.slots[tile.placed];
    previous.letter = null;
    previous.tileId = null;
  }
  if (slot.tileId) {
    const displaced = tileById(slot.tileId);
    if (displaced) displaced.placed = null;
  }
  slot.letter = tile.letter;
  slot.tileId = tile.id;
  tile.placed = index;
  return true;
}

function slotRow() {
  const solved = isSolved();
  const choosing = Boolean(build.selectedTileId);
  const row = node("div", `slots ${solved ? "is-celebrating" : ""} ${choosing ? "is-choosing" : ""}`);
  build.slots.forEach((slot, index) => {
    const el = node("button", [
      "slot",
      slot.letter ? "is-filled" : "",
      slot.locked ? "is-locked" : "",
      solved ? "is-celebrating" : ""
    ].filter(Boolean).join(" "));
    el.type = "button";
    el.dataset.slotIndex = String(index);
    if (slot.tileId) el.dataset.tileId = slot.tileId;
    el.style.setProperty("--slot-index", index);
    el.setAttribute("aria-label", slot.letter ? `Letter ${slot.letter}` : "Empty space");
    el.append(img("slot-empty", fallbackFragment, { className:"slot-skin" }));
    el.append(node("span", "slot-letter", slot.letter || ""));
    if (!slot.locked) attachDragSource(el, { kind:"slot", index });
    row.append(el);
  });
  return row;
}

function tileRow() {
  const row = node("div", `tiles ${slotsAreFull() ? "is-complete" : ""}`);
  for (const tile of build.tiles) {
    const button = node("button", [
      "letter-tile",
      tile.placed !== null ? "is-used" : "",
      build.selectedTileId === tile.id ? "is-selected" : ""
    ].filter(Boolean).join(" "));
    button.type = "button";
    button.dataset.tileId = tile.id;
    button.setAttribute("aria-label", `Letter ${tile.letter}`);
    button.append(img("tile-blank", fallbackFragment, { className:"tile-skin" }));
    button.append(node("span", "tile-letter", tile.letter));
    if (tile.placed === null) attachDragSource(button, { kind:"tray", tileId:tile.id });
    row.append(button);
  }
  return row;
}

// ---- moving letters about -------------------------------------------------
// One pointer path covers finger, pen and mouse. A short press that barely
// moves counts as a tap, so tap-to-place and drag are the same gesture until
// the child's finger decides which one it is.
const DRAG_THRESHOLD = 8;
const SNAP_RADIUS = 104;
const DROP_PADDING = 30;
let drag = null;

function sourceLetter(source) {
  if (source.kind === "tray") return tileById(source.tileId)?.letter || "";
  return build.slots[source.index]?.letter || "";
}

function sourceTileId(source) {
  if (source.kind === "tray") return source.tileId;
  return build.slots[source.index]?.tileId || null;
}

function attachDragSource(element, source) {
  element.style.touchAction = "none";
  element.addEventListener("pointerdown", event => beginPointer(event, source, element));
}

function beginPointer(event, source, element) {
  if (build.busy || drag) return;
  if (event.pointerType === "mouse" && event.button !== 0) return;
  // Captured now, before anything moves, so the ghost can be anchored to
  // wherever within the tile the finger actually landed — not its centre.
  const rect = element.getBoundingClientRect();
  drag = {
    pointerId:event.pointerId,
    source,
    element,
    startX:event.clientX,
    startY:event.clientY,
    grabX:event.clientX - rect.left,
    grabY:event.clientY - rect.top,
    rectWidth:rect.width,
    rectHeight:rect.height,
    moved:false,
    ghost:null
  };
  attachPointerFollow(element);
}

function attachPointerFollow(element) {
  try { element.setPointerCapture(drag.pointerId); } catch { /* capture is a nicety */ }
  element.addEventListener("pointermove", onPointerMove);
  element.addEventListener("pointerup", onPointerUp);
  element.addEventListener("pointercancel", onPointerCancel);
}

function detachPointerFollow() {
  if (!drag) return;
  const { element, pointerId } = drag;
  element.removeEventListener("pointermove", onPointerMove);
  element.removeEventListener("pointerup", onPointerUp);
  element.removeEventListener("pointercancel", onPointerCancel);
  try { element.releasePointerCapture(pointerId); } catch { /* already gone */ }
}

function onPointerMove(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const dx = event.clientX - drag.startX;
  const dy = event.clientY - drag.startY;
  if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
  if (!drag.moved) {
    const letter = sourceLetter(drag.source);
    if (!letter) return;
    drag.moved = true;
    hideNudge();
    setSelectedTile(null, { redraw:false });
    playSfx("tile-pickup");
    drag.ghost = makeGhost(letter, drag.rectWidth, drag.rectHeight);
    drag.element.classList.add("is-dragging");
  }
  moveGhost(event.clientX, event.clientY);
  highlightDropTarget(event.clientX, event.clientY);
}

function onPointerUp(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const { source, moved } = drag;
  const x = event.clientX;
  const y = event.clientY;
  finishDrag();
  if (!moved) {
    handleTap(source);
    return;
  }
  const target = slotAtPoint(x, y);
  const tileId = sourceTileId(source);
  if (target !== null && tileId && placeTileInSlot(tileId, target)) {
    playSfx("tile-land");
  } else if (source.kind === "slot" && target === null) {
    // Dropped away from every slot: the letter goes back to the tray.
    removeTileFromSlot(source.index);
  }
  refreshWorkbench();
}

function onPointerCancel(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  finishDrag();
  refreshWorkbench();
}

function finishDrag() {
  if (!drag) return;
  detachPointerFollow();
  drag.element.classList.remove("is-dragging");
  if (drag.ghost) drag.ghost.remove();
  clearDropHighlight();
  drag = null;
}

// Two elements: the outer div is the position anchor moveGhost drives every
// frame; the pop-in flourish lives on the inner span so its animation never
// touches the outer's transform (see the CSS comment on .drag-ghost for why
// that combination used to make the tile fly in from the corner).
function makeGhost(letter, width, height) {
  const ghost = node("div", "drag-ghost");
  const pop = node("span", "drag-ghost-pop");
  pop.append(node("span", "tile-letter", letter));
  ghost.append(pop);
  ghost.style.width = `${width}px`;
  ghost.style.height = `${height}px`;
  document.body.append(ghost);
  return ghost;
}

// Keeps the ghost glued to the exact point the finger grabbed, so it never
// recentres under the pointer — on the very first frame this places it
// exactly where the real tile already was, zero jump.
function moveGhost(x, y) {
  if (!drag?.ghost) return;
  drag.ghost.style.transform = `translate3d(${x - drag.grabX}px, ${y - drag.grabY}px, 0)`;
}

// Generous targeting: anywhere inside a padded slot counts, and failing that
// the nearest slot centre within arm's reach.
function slotAtPoint(x, y) {
  let best = null;
  let bestDistance = Infinity;
  for (const el of document.querySelectorAll(".slot")) {
    const index = Number(el.dataset.slotIndex);
    if (build.slots[index]?.locked) continue;
    const box = el.getBoundingClientRect();
    const centreX = box.left + (box.width / 2);
    const centreY = box.top + (box.height / 2);
    const inside = x >= box.left - DROP_PADDING && x <= box.right + DROP_PADDING
      && y >= box.top - DROP_PADDING && y <= box.bottom + DROP_PADDING;
    const distance = Math.hypot(x - centreX, y - centreY);
    if (!inside && distance > SNAP_RADIUS) continue;
    const score = inside ? distance : distance + 1000;
    if (score < bestDistance) {
      bestDistance = score;
      best = index;
    }
  }
  return best;
}

function highlightDropTarget(x, y) {
  const target = slotAtPoint(x, y);
  for (const el of document.querySelectorAll(".slot")) {
    el.classList.toggle("is-drop-target", Number(el.dataset.slotIndex) === target);
  }
}

function clearDropHighlight() {
  for (const el of document.querySelectorAll(".slot")) el.classList.remove("is-drop-target");
}

function setSelectedTile(tileId, { redraw = true } = {}) {
  if (build.selectedTileId === tileId) return;
  build.selectedTileId = tileId;
  if (redraw) refreshWorkbench();
}

function handleTap(source) {
  hideNudge();
  if (source.kind === "tray") {
    const tile = tileById(source.tileId);
    if (!tile || tile.placed !== null) return;
    if (build.selectedTileId === tile.id) {
      setSelectedTile(null);
      return;
    }
    playSfx("tile-pickup");
    setSelectedTile(tile.id);
    return;
  }

  const slot = build.slots[source.index];
  if (!slot || slot.locked) return;
  if (build.selectedTileId) {
    const chosen = build.selectedTileId;
    build.selectedTileId = null;
    if (placeTileInSlot(chosen, source.index)) playSfx("tile-land");
    refreshWorkbench();
    return;
  }
  if (slot.tileId) {
    playSfx("tile-pickup");
    removeTileFromSlot(source.index);
    refreshWorkbench();
  }
}

function refreshWorkbench() {
  const slots = document.querySelector(".slots");
  const tiles = document.querySelector(".tile-stage .tiles");
  if (slots) slots.replaceWith(slotRow());
  if (tiles) tiles.replaceWith(tileRow());
  updateOutcome();
}

// ---- right, wrong, or still going ----------------------------------------
function updateOutcome() {
  const solved = isSolved();
  const full = slotsAreFull();
  const hand = document.querySelector(".handover-button");
  const success = document.querySelector(".success-message");

  if (hand) hand.disabled = !solved;

  if (solved && !build.wasSolved) {
    playSfx("word-complete");
    if (success) {
      success.textContent = SUCCESS_LINES[successLineIndex % SUCCESS_LINES.length];
      successLineIndex += 1;
      success.classList.add("is-visible");
    }
    if (hand) {
      hand.classList.remove("is-ready");
      void hand.offsetWidth;
      hand.classList.add("is-ready");
      const area = hand.closest(".play-area");
      if (area && !hasSeenTutorial()) startTutorial("hand", area);
    }
  }

  if (!solved) {
    if (success) success.classList.remove("is-visible");
    if (hand) hand.classList.remove("is-ready");
  }

  if (full && !solved) scheduleNudge();
  else {
    // A new full-but-wrong moment may play its gentle nudge sound once.
    // Removing a letter resets that moment; simply rearranging full slots does not.
    if (!full) build.wrongArrangementSfxPlayed = false;
    hideNudge();
  }

  build.wasSolved = solved;
}

// Every slot filled but the word is wrong. Nothing is undone, nothing is
// marked, and a single gentle "not quite" sound accompanies the warm line.
// The tiles simply stay movable and the nudge appears where the compliment
// would have been.
function nudgeLine() {
  const total = build.letters.length;
  const right = correctSlotCount();
  const share = total ? right / total : 0;
  const tier = (right >= total - 1 || share >= .75) ? "warm" : (share >= .4 ? "middle" : "far");
  const pool = NUDGE_LINES[tier].filter(line => line !== lastNudgeLine);
  const choices = pool.length ? pool : NUDGE_LINES[tier];
  lastNudgeLine = choices[Math.floor(Math.random() * choices.length)];
  return lastNudgeLine;
}

function scheduleNudge() {
  window.clearTimeout(nudgeTimer);
  nudgeTimer = window.setTimeout(() => {
    const message = document.querySelector(".nudge-message");
    if (!message || !build || !slotsAreFull() || isSolved()) return;
    message.textContent = nudgeLine();
    message.classList.add("is-visible");
    if (!build.wrongArrangementSfxPlayed) {
      build.wrongArrangementSfxPlayed = true;
      playSfx("word-incorrect");
    }
  }, NUDGE_DELAY);
}

function hideNudge() {
  window.clearTimeout(nudgeTimer);
  const message = document.querySelector(".nudge-message");
  if (message) message.classList.remove("is-visible");
}

function isBuilt() {
  return isSolved();
}

function useHelp(button, prompt) {
  if (build.busy || button.dataset.waiting || isSolved()) return;
  button.dataset.waiting = "true";
  build.helpUsed = Math.min(3, build.helpUsed + 1);
  const stage = build.helpUsed;
  const continueHelp = () => {
    delete button.dataset.waiting;
    if (stage === 1) {
      replayPrompt(prompt);
      return;
    }
    if (stage === 2) {
      // Point at the letter that belongs in the first slot that is not right
      // yet, wherever that letter currently sits.
      const index = firstUnsolvedSlot();
      const wanted = build.letters[index];
      const tile = build.tiles.find(item => item.placed === null && item.letter === wanted)
        || build.tiles.find(item => item.letter === wanted);
      const tileButton = tile && document.querySelector(`[data-tile-id="${tile.id}"]`);
      if (tileButton) tileButton.classList.add("is-hinting");
      return;
    }
    button.disabled = true;
    finishWithHelp();
  };
  say("ui-help-me", "Help me.", {
    onEnded: () => window.setTimeout(continueHelp, 250)
  });
}

// Sorts the whole word out, including any letters the child has put in the
// wrong place, one slot at a time from the left.
async function finishWithHelp() {
  build.busy = true;
  hideNudge();
  build.selectedTileId = null;
  for (let index = 0; index < build.slots.length; index += 1) {
    if (build.slots[index].letter === build.letters[index]) continue;
    const wanted = build.letters[index];
    const tile = build.tiles.find(item => item.placed === null && item.letter === wanted)
      || build.tiles.find(item => item.letter === wanted);
    if (!tile) continue;
    removeTileFromSlot(index);
    placeTileInSlot(tile.id, index);
    refreshWorkbench();
    await new Promise(resolve => window.setTimeout(resolve, 145));
  }
  build.busy = false;
  refreshWorkbench();
  window.setTimeout(() => {
    if (document.querySelector(".serve-screen") && isSolved()) {
      say(`${build.word.id}_help`, `This one is ${build.word.t}.`);
    }
  }, 850);
}

function handOver() {
  if (!isBuilt() || episode.helped.includes(build.word.id)) return;
  playSfx("handover");
  applyResult(episode, build.word.id, build.helpUsed);
  episode.helped.push(build.word.id);
  saveEpisode();
  finishTutorial();
  // Silent handover. The word and its meaning speak on the next screen.
  const word = build.word;
  fadeOutCurrentAudio(200);
  window.setTimeout(() => renderPayoff(word), 200);
}

function renderPayoff(word) {
  const area = shell("payoff-screen");
  const card = node("div", "payoff-card");
  const visual = node("div", "payoff-visual");
  visual.append(personArt(word, "happy"), wordPicture(word, "payoff-word-picture"));
  const copy = node("div", "payoff-copy");
  const line = quietWords.has(word.id) ? `Yes. That is ${word.t}.` : `${word.t}! That is the word!`;
  copy.append(spoken(node("h1", `payoff-line ${quietWords.has(word.id) ? "quiet" : ""}`, line), word.id, line));
  copy.append(spoken(node("p", "meaning", word.def), `${word.id}_def`, word.def));
  copy.append(actionButton("Next", "next-button", renderQueue));
  card.append(visual, copy);
  area.append(card);
  area.append(img("hatch-happy", fallbackFragment, { className:"hatch-art payoff-hatch" }));
  say(word.id, line, {
    onEnded: () => window.setTimeout(() => say(`${word.id}_def`, word.def), 400)
  });
  window.setTimeout(() => playSfx("jar-fill"), 460);
}

function openAfterAllDone() {
  episode.round += 1;
  episode.activeRound = [];
  episode.helped = [];
  saveEpisode();
  renderQueue({ allowRevision:true });
}

function playAgain() {
  // A genuinely fresh episode: round, every word's strength and showings, the
  // jars, and the current round all go back to the start. The mute setting and
  // the seen-it-before flags live outside the episode, so they survive.
  episode = freshEpisode();
  saveEpisode();
  successLineIndex = 0;
  ensureRound();
  renderQueue();
}

// The end of the whole episode: every word has had all of its showings and
// none can come back. Its own screen, deliberately unlike anything else in
// the game — the gallery of everything learned is the reward.
function renderGalleryFinale() {
  finishDrag();
  clearTutorial();
  clearTimeout(helpTimer);
  const screen = node("section", "screen gallery-screen");
  marketScene(screen);

  const card = node("section", "gallery-card");
  const heading = node("h1", "gallery-heading", "You have learned every word. Your shelf is full.");
  card.append(spoken(heading, "ui-all-done", heading.textContent));

  const gallery = node("div", "gallery-grid");
  gallery.setAttribute("aria-label", "Every word you learned");
  WORDS.forEach((word, index) => {
    const item = node("button", "gallery-item");
    item.type = "button";
    item.style.setProperty("--gallery-index", index);
    item.setAttribute("aria-label", `${word.t}. ${word.def}`);
    const frame = node("span", "gallery-frame");
    frame.append(wordPicture(word, "gallery-picture"));
    item.append(frame, node("span", "gallery-word", word.t));
    item.addEventListener("click", () => {
      playSfx("tap");
      say(word.id, word.t, {
        onEnded: lineToken => window.setTimeout(() => {
          if (lineToken !== currentLineToken) return;
          say(`${word.id}_def`, word.def);
        }, 300)
      });
    });
    gallery.append(item);
  });
  card.append(gallery);
  card.append(actionButton("Play again", "play-again-button", playAgain));
  screen.append(card);
  mountScreen(screen);
  playSfx("all-learned");
  say("ui-all-done", heading.textContent);
}

function renderAllDone({ waitingForRevision = false } = {}) {
  if (!waitingForRevision) {
    renderGalleryFinale();
    return;
  }
  // Only the resting case reaches here now: the shelf is full, but some words
  // still owe a visit before the episode is truly over.
  const area = shell("all-done-screen", { fullShelf:true });
  const card = node("section", "all-done-card");
  const sparkle = node("div", "all-done-sparkle", "✦");
  sparkle.setAttribute("aria-hidden", "true");
  const line = "Your shelf is full. The words will visit again soon.";
  card.append(sparkle);
  card.append(spoken(node("p", "all-done-line", line), "ui-revision-soon", line));
  card.append(actionButton("Open again", "again-button", openAfterAllDone));
  area.append(card);
  say("ui-revision-soon", line);
}

function renderClosed() {
  const area = shell("closed-screen");
  const card = node("div", "closed-card");
  card.append(roundLanterns(true));
  card.append(spoken(node("h1", "closed-title", "Stall closed"), "ui-stall-closed", "Stall closed."));
  card.append(spoken(node("p", "closed-line", "Everyone found their word."), "ui-stall-closed", "Everyone found their word."));
  card.append(actionButton("Open again", "again-button", () => {
    episode.round += 1;
    episode.activeRound = [];
    episode.helped = [];
    ensureRound();
    renderQueue();
  }));
  area.append(card);
  area.append(img("hatch-celebrate", fallbackFragment, { className:"hatch-art closed-hatch" }));
  playSfx("round-closed");
  // Silent. Both printed lines still speak when tapped.
}

rotateView.append(img("rotate-device", () => node("span", "rotate-icon"), { className:"rotate-picture" }));
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (currentAudio) currentAudio.pause();
    if (bgmAudio) bgmAudio.pause();
    if (bgmContext) bgmContext.suspend().catch(() => {});
    if ("speechSynthesis" in window) speechSynthesis.pause();
  } else if ("speechSynthesis" in window) {
    if (bgmContext) bgmContext.resume().catch(() => {});
    if (bgmAudio && !bgmUnavailable) bgmAudio.play().catch(() => {});
    speechSynthesis.resume();
  } else {
    if (bgmContext) bgmContext.resume().catch(() => {});
    if (bgmAudio && !bgmUnavailable) bgmAudio.play().catch(() => {});
  }
});

// For testing the first-run walkthrough:
//   ?tutorial=reset  shows it again on the next load
//   ?tutorial=all    also wipes the saved jars and progress
// or, from the console: wordLab.resetTutorial() then reload.
window.wordLab = {
  resetTutorial() { resetTutorialFlag(); return "Reload to see the walkthrough again."; },
  resetAll() { resetEverything(); return "Reload to start completely fresh."; }
};

applyResetFromAddress();
renderAudioControls();
auditAudioFiles();
renderTap();
