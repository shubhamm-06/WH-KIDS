# Word Lab Repo Guide

## What this repo is

Word Lab is a small browser game for early learners. A child helps market characters by building vocabulary words from letter tiles. The theme of this episode is money, trade, and agreement.

The project is intentionally simple:

- no framework
- no build step
- no package manager
- one HTML file, one main JS runtime, one stylesheet
- static image/audio assets in `assets/`

Open `index.html` in a browser or serve the folder locally and the game runs.

## High-level file map

- `index.html`
  Bootstraps the app. It mounts `#app`, includes `styles.css`, and loads `game.js` as an ES module.

- `game.js`
  The main runtime. It handles screen rendering, audio playback, saved progress, tile interaction, tutorial flow, fullscreen, custom UI behavior, and end-state logic.

- `scheduler.js`
  Owns the learning model and round selection rules. It decides which words appear, how strength changes, and when a word is considered done.

- `words.js`
  The content layer. It defines the cast and the 16 words for this episode, including definitions and the spoken prompts used at different hint levels.

- `styles.css`
  All visuals and motion. It defines the warm market look, responsive layout, animation, custom cursors, and reduced-motion behavior.

- `generate_audio.py`
  Utility script for generating narration/audio files for the words and UI lines. It mirrors the wording in `words.js`, so those two need to stay in sync.

- `assets/images/`
  Character art, background art, and word pictures.

- `assets/audio/`
  Spoken lines, background music, and sound effects.

## Runtime flow

The game flow is mostly linear:

1. `renderTap()`
   Shows the first "Tap to open your stall" screen.

2. `renderIntroduction()`
   Only shown the first time. Explains the game in one simple card.

3. `renderQueue()`
   Shows the current round of waiting characters. The player picks one to help.

4. `renderServing()`
   Shows one character, the prompt, the letter slots, the tile tray, and the `Help me` / `Hand it over` actions.

5. `renderPayoff()`
   After handover, shows the solved word and its definition, then moves back to the queue.

6. `renderClosed()` or `renderAllDone()`
   End-of-round and end-of-game states.

The app does not use a router. It just replaces the contents of `#app` with a newly rendered screen each time.

## Core learning logic

Each word has saved state in `episode.words[wordId]`:

- `strength`: current learned strength, from `0` to `3`
- `lastSeen`: the round number when it last appeared
- `droppedFrom`: remembers the highest level it fell from after heavy help
- `stalls`: counts partial-help attempts
- `shows`: how many times the word has been shown total

Important scheduler constants in `scheduler.js`:

- `SLOTS = 3`
  Up to 3 people appear in a round.

- `MIN_GAP = 4`
  A word should rest at least 4 rounds before returning.

- `MAX_NEW = 2`
  A round should not introduce too many brand-new words at once.

- `REST = 8`
  Strength-3 words need a longer rest before revision.

- `MAX_SHOWS = 4`
  A word retires after being shown 4 times.

### How rounds are chosen

`composeRound()` filters and sorts words so the game prefers:

- lower-strength words first
- older unseen words before recently shown ones
- no duplicate speaker/person in the same round
- limited new words after round 1
- no words past the 4-show cap

### How results change learning

`applyResult()` updates a word after handover:

- `helpUsed === 0`
  Word strength increases normally.

- `helpUsed === 1 or 2`
  Partial help does not immediately level the word up, but repeated stalls can still push it forward.

- `helpUsed >= 3`
  Heavy help can drop the word once, or in some cases still move it forward depending on its history.

This makes the system feel forgiving without needing scores or grades on screen.

### What "done" means

The game no longer defines completion as "every word reached strength 3."

A word is treated as finished when either:

- it reached strength `3`, or
- it hit `MAX_SHOWS`

That means every child can eventually finish the episode no matter how much help they use.

## Save model

Progress is stored in `localStorage`.

Main keys:

- `wisdomhatch.wordlab.v1`
  The save envelope, keyed by episode id.

- `wisdomhatch.wordlab.muted`
  Mute state.

- `wisdomhatch.wordlab.intro-seen`
  Whether the intro card was already shown.

- `wisdomhatch.wordlab.tutorial-seen`
  Whether the one-time tutorial overlay was already shown.

`index.html` sets `data-episode="ep1"` on `<html>`, and `game.js` uses that as the save slot. That leaves room for future episodes without changing the storage structure.

## Serving screen behavior

`prepareBuild()` creates the actual letter activity for a chosen word:

- fills some letters automatically for easier levels
- chooses the correct missing letters
- adds a few spare letters on harder levels
- shuffles the tile tray

The serving screen uses three prompt levels:

- level 1: story prompt + second cloze line
- level 2: cloze prompt
- level 3: short clue

### Tile interaction rules

- Correct next tile only: accepted and animated into the next slot
- Wrong tile: visually wobbles, but stays silent
- Completed word: slots celebrate, a short success compliment appears, and `Hand it over` becomes visually ready

The build interaction is intentionally slot-by-slot. The player is always solving the next correct letter, not freely rearranging all positions.

## Help system

`Help me` appears after a delay, not instantly.

Help escalates in stages:

1. repeats the prompt
2. highlights the correct tile
3. finishes the rest of the word automatically

After full help, the game can say the word aloud using the word-specific `_help` audio line.

## End states

There are two different "finished for now" ideas:

- `renderClosed()`
  The current round is finished, but more words are still left for later rounds.

- `renderAllDone()`
  Every word is finished for the episode, either by mastery or by hitting the show cap.

There is also a distinction between:

- truly done
- waiting for strength-3 revision words to become due again

That is why the ending text can change depending on whether any real revision visit is still possible.

## Audio system

The audio handling in `game.js` is more robust than it first looks.

It supports:

- background music with fade and ducking
- sound effects with their own ducking behavior
- spoken MP3 lines for prompts and meanings
- fallback to browser speech synthesis if a voice file is missing
- muting that also stops speech and SFX cleanly

Useful details:

- BGM is `assets/audio/bgm-loop.mp3`
- most speech lines are keyed by the ids in `words.js`
- SFX are loaded by name through `playSfx()`
- `tile-land` has a compatibility fallback to `tile-place`
- `auditAudioFiles()` checks required audio files during startup and logs missing ones

The UI buttons themselves are mostly silent by design. The game prefers quick response over making the child wait through repeated button narration.

## Art and fallback strategy

The image system also degrades gracefully.

`img()` tries to load `assets/images/<name>.png`. If the file is missing, many UI pieces fall back to:

- CSS-drawn figures
- CSS jars/lanterns
- emoji-based word pictures
- empty document fragments for optional decorative layers

This is useful because the runtime references more art names than the current repo necessarily ships. The game is designed to stay usable even with incomplete art coverage.

## UI and styling notes

`styles.css` contains the full design system:

- cream / gold / teal palette
- rounded toy-like cards and buttons
- responsive layout for landscape play
- portrait-mode rotate screen
- one-time tutorial overlay
- motion for tiles, queue cards, jars, and success states
- reduced-motion support
- custom desktop cursors
- grouped top-right audio and fullscreen controls

There is no CSS framework. The stylesheet is hand-authored and tightly coupled to the DOM structure produced by `game.js`.

## Tutorial and testing helpers

There is a built-in first-run tutorial overlay that points at:

- the queue
- the tiles
- the handover button

Testing helpers:

- `?tutorial=reset`
  Clears intro/tutorial flags so the walkthrough shows again.

- `?tutorial=all`
  Clears tutorial flags and save progress.

- `window.wordLab.resetTutorial()`
- `window.wordLab.resetAll()`

These are exposed mainly for development/testing convenience.

## Audio generation script

`generate_audio.py` is a separate content-production tool, not part of gameplay.

It:

- defines the same word lines as `words.js`
- defines extra UI narration lines
- generates missing MP3s into `assets/audio/`
- can selectively rebuild categories like `ask`, `cloze`, or `ui`

Important maintenance note:

- if wording changes in `words.js`, the matching text in `generate_audio.py` should usually change too, otherwise on-screen text and spoken audio can drift apart

## What to know before editing

- The repo is deliberately simple and stateful. Most behavior lives in `game.js`.
- `scheduler.js` is the safest place to change learning cadence without touching UI.
- `words.js` is the safest place to change episode content.
- Many visual behaviors depend on exact class names in both `game.js` and `styles.css`.
- The app is designed around touch-first interaction, but also has desktop niceties like fullscreen and custom cursors.
- The game avoids scores, red error states, progress counters, and other school-like feedback. That tone is part of the design, not an accident.

## If someone new wants the fastest reading order

Read in this order:

1. `words.js`
2. `scheduler.js`
3. `game.js`
4. `styles.css`
5. `generate_audio.py`

That gives the best mental model with the least time.
