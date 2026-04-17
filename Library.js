// Parallel Saros library.
// The hook files stay thin; all shared runtime logic lives here.

const PS_MIN_TURNS = 10;
const PS_CARD_TITLE = "PS Settings";
const PS_CARD_DESC = "Parallel Saros settings. Edit the fields below to configure the dual-protagonist script.";
const PS_BLOCK_START = "<PS>";
const PS_BLOCK_END = "</PS>";

const PS_TOGETHER_TERMS = [
  "meet",
  "meets",
  "met",
  "meet up",
  "meets up",
  "rejoin",
  "rejoins",
  "rejoined",
  "regroup",
  "regroups",
  "regrouped",
  "back together",
  "face to face",
  "stand together",
  "standing together",
  "arrive together",
  "arrives together",
  "same room",
  "same place",
  "same location",
  "same space",
  "in the room with",
  "in the same room",
  "in the same place",
  "in the same location"
];

const PS_SEPARATE_TERMS = [
  "separate",
  "separates",
  "separated",
  "split up",
  "splits up",
  "part ways",
  "parts ways",
  "go separate ways",
  "goes separate ways",
  "went separate ways",
  "different places",
  "different locations",
  "separate locations",
  "separate rooms",
  "no longer together",
  "are apart",
  "move apart",
  "moves apart",
  "moved apart",
  "heads elsewhere",
  "head elsewhere",
  "went alone"
];

const PS_HELP = [
  "/psaros or /psaros status",
  "/psaros switch",
  "/psaros focus primary",
  "/psaros focus secondary",
  "/psaros together",
  "/psaros split",
  "/psaros debug on",
  "/psaros debug off"
].join("\n");

const PS_SKIP_CONJ = {
  am: true,
  are: true,
  is: true,
  was: true,
  were: true,
  be: true,
  been: true,
  being: true,
  do: true,
  does: true,
  did: true,
  have: true,
  has: true,
  had: true,
  will: true,
  would: true,
  shall: true,
  should: true,
  can: true,
  cannot: true,
  could: true,
  may: true,
  might: true,
  must: true,
  ought: true,
  need: true
};

const PS_PAST_WORDS = {
  went: true,
  came: true,
  saw: true,
  found: true,
  felt: true,
  left: true,
  took: true,
  gave: true,
  made: true,
  knew: true,
  thought: true,
  brought: true,
  kept: true,
  said: true,
  told: true,
  ran: true,
  held: true,
  read: true,
  sat: true,
  stood: true,
  won: true,
  lost: true,
  met: true
};

onLibraryPs();

function onLibraryPs() {
  syncCfg();
  reconcile();
}

function onInputPs(text) {
  syncCfg();
  reconcile();

  const cmd = handleCmd(text);
  if (cmd.handled) {
    const ps = getPs();
    ps.rt.msg = cmd.reply;
    clearPending(ps);
    return " ";
  }

  const ps = getPs();
  const cooked = shouldRewriteB(ps) ? rewriteB(text, ps.cfg.secondaryName, getType()) : text;
  savePending(ps, text, cooked);
  return cooked;
}

function onContextPs(text) {
  syncCfg();
  reconcile();
  return injectNote(text);
}

function onOutputPs(text) {
  syncCfg();
  const ps = getPs();
  const cycle = classifyTurn(ps);
  reconcile(cycle);

  if (ps.rt.msg) {
    const msg = ps.rt.msg;
    ps.rt.msg = "";
    clearPending(ps);
    return msg;
  }

  return recordTurn(ps, text, cycle);
}

function getPs() {
  if (!state.parallelSaros || typeof state.parallelSaros !== "object") {
    state.parallelSaros = {
      cfg: defaultCfg(),
      rt: {
        focus: "primary",
        together: false,
        turns: 0,
        target: 12,
        lastLogged: -1,
        lastSeen: -1,
        msg: ""
      },
      roles: {
        primary: mkRole(),
        secondary: mkRole()
      },
      pending: mkPending(),
      track: mkTrack(),
      journal: []
    };
  }

  const ps = state.parallelSaros;
  ps.cfg = ps.cfg || defaultCfg();
  ps.rt = ps.rt || {};
  ps.roles = ps.roles || { primary: mkRole(), secondary: mkRole() };
  ps.roles.primary = ps.roles.primary || mkRole();
  ps.roles.secondary = ps.roles.secondary || mkRole();
  ps.pending = ps.pending || mkPending();
  ps.track = ps.track || mkTrack();
  ps.journal = Array.isArray(ps.journal) ? ps.journal : [];
  normalizeRt(ps);
  normalizeTrack(ps);
  return ps;
}

function defaultCfg() {
  return {
    primaryName: "",
    secondaryName: "",
    center: 12,
    flex: 2,
    startFocus: "primary",
    suspendTogether: true,
    rewriteSecondary: true,
    debug: false,
    summaryMax: 260,
    noteMax: 700,
    recentMax: 6,
    journalMax: 80
  };
}

function mkRole() {
  return {
    turns: [],
    live: "",
    handoff: ""
  };
}

function mkPending() {
  return {
    raw: "",
    cooked: "",
    type: "",
    turn: -1
  };
}

function mkTrack() {
  return {
    pendingRaw: "",
    pendingNorm: "",
    pendingType: "",
    pendingSig: "",
    pendingTurn: -1,
    lastType: "",
    lastText: "",
    lastSig: "",
    lastHash: "",
    lastProbe: "",
    lastKind: "",
    lastTurn: -1,
    retryType: "",
    retryText: "",
    retrySig: "",
    retryKind: "",
    retryTurn: -1
  };
}

function syncCfg() {
  const ps = getPs();
  const card = ensureCard();
  if (!card) {
    return ps;
  }

  const cfg = loadCfg(card.entry || "");
  const built = buildCfg(cfg);

  if (card.entry !== built) {
    card.entry = built;
  }

  ps.cfg = cfg;
  normalizeRt(ps);
  debug(ps, "cfg synced");
  return ps;
}

function ensureCard() {
  if (!hasCardApi()) {
    return null;
  }

  let card = getCard();
  if (!card) {
    if (typeof addStoryCard === "function") {
      addStoryCard(PS_CARD_TITLE);
      card = getCard();
    } else {
      storyCards.push({
        title: PS_CARD_TITLE,
        entry: "",
        description: PS_CARD_DESC,
        keys: "",
        type: "system"
      });
      card = getCard();
    }
  }

  if (card) {
    initCard(card);
  }

  return card;
}

function hasCardApi() {
  return typeof storyCards !== "undefined" && Array.isArray(storyCards);
}

function getCard() {
  if (!hasCardApi()) {
    return null;
  }

  for (let i = 0; i < storyCards.length; i += 1) {
    const card = storyCards[i];
    if (card && card.title === PS_CARD_TITLE) {
      return card;
    }
  }

  return null;
}

function initCard(card) {
  card.type = "system";
  card.keys = "";
  card.description = PS_CARD_DESC;

  if (!card.entry || !card.entry.trim()) {
    card.entry = buildCfg(defaultCfg());
  }
}

function buildCfg(cfg) {
  return [
    "Primary Name: " + (cfg.primaryName || ""),
    "Secondary Name: " + (cfg.secondaryName || ""),
    "Switch Center: " + sanitizeEvery(cfg.center),
    "Switch Flex: " + sanitizeFlex(cfg.flex),
    "Start Focus: " + sanitizeFocus(cfg.startFocus),
    "Suspend When Together: " + String(parseBool(cfg.suspendTogether, true)),
    "Rewrite Secondary Input: " + String(parseBool(cfg.rewriteSecondary, true)),
    "Debug: " + String(parseBool(cfg.debug, false)),
    "Summary Max Chars: " + sanitizeInt(cfg.summaryMax, 260, 120, 500),
    "Author Note Max Chars: " + sanitizeInt(cfg.noteMax, 700, 300, 1500),
    "Recent Turns Per Role: " + sanitizeInt(cfg.recentMax, 6, 2, 12),
    "Max Journal Entries: " + sanitizeInt(cfg.journalMax, 80, 20, 160)
  ].join("\n");
}

function getCfgLine(entry, label) {
  const rx = new RegExp("^" + esc(label) + "[ \\t]*:[ \\t]*(.*)$", "im");
  const match = String(entry || "").match(rx);
  return match ? match[1].trim() : "";
}

function loadCfg(entry) {
  const cfg = defaultCfg();

  cfg.primaryName = cleanName(getCfgLine(entry, "Primary Name"));
  cfg.secondaryName = cleanName(getCfgLine(entry, "Secondary Name"));
  cfg.center = sanitizeEvery(getCfgLine(entry, "Switch Center"));
  cfg.flex = sanitizeFlex(getCfgLine(entry, "Switch Flex"));
  cfg.startFocus = sanitizeFocus(getCfgLine(entry, "Start Focus"));
  cfg.suspendTogether = parseBool(getCfgLine(entry, "Suspend When Together"), cfg.suspendTogether);
  cfg.rewriteSecondary = parseBool(getCfgLine(entry, "Rewrite Secondary Input"), cfg.rewriteSecondary);
  cfg.debug = parseBool(getCfgLine(entry, "Debug"), cfg.debug);
  cfg.summaryMax = sanitizeInt(getCfgLine(entry, "Summary Max Chars"), cfg.summaryMax, 120, 500);
  cfg.noteMax = sanitizeInt(getCfgLine(entry, "Author Note Max Chars"), cfg.noteMax, 300, 1500);
  cfg.recentMax = sanitizeInt(getCfgLine(entry, "Recent Turns Per Role"), cfg.recentMax, 2, 12);
  cfg.journalMax = sanitizeInt(getCfgLine(entry, "Max Journal Entries"), cfg.journalMax, 20, 160);

  return cfg;
}

function saveCfg(cfg) {
  const card = ensureCard();
  if (card) {
    card.entry = buildCfg(cfg);
  }
}

function normalizeRt(ps) {
  const cfg = ps.cfg || defaultCfg();
  const rt = ps.rt;

  rt.focus = sanitizeFocus(rt.focus || cfg.startFocus);
  rt.together = parseBool(rt.together, false);
  rt.turns = sanitizeInt(rt.turns, 0, 0, 9999);
  rt.target = clampTarget(cfg, sanitizeInt(rt.target, cfg.center, PS_MIN_TURNS, 9999));
  rt.lastLogged = sanitizeInt(rt.lastLogged, -1, -1, 999999);
  rt.lastSeen = sanitizeInt(rt.lastSeen, -1, -1, 999999);
  rt.msg = typeof rt.msg === "string" ? rt.msg : "";
}

function normalizeTrack(ps) {
  const track = ps.track;

  track.pendingRaw = typeof track.pendingRaw === "string" ? track.pendingRaw : "";
  track.pendingNorm = typeof track.pendingNorm === "string" ? track.pendingNorm : "";
  track.pendingType = typeof track.pendingType === "string" ? track.pendingType : "";
  track.pendingSig = typeof track.pendingSig === "string" ? track.pendingSig : "";
  track.pendingTurn = sanitizeInt(track.pendingTurn, -1, -1, 999999);
  track.lastType = typeof track.lastType === "string" ? track.lastType : "";
  track.lastText = typeof track.lastText === "string" ? track.lastText : "";
  track.lastSig = typeof track.lastSig === "string" ? track.lastSig : "";
  track.lastHash = typeof track.lastHash === "string" ? track.lastHash : "";
  track.lastProbe = typeof track.lastProbe === "string" ? track.lastProbe : "";
  track.lastKind = typeof track.lastKind === "string" ? track.lastKind : "";
  track.lastTurn = sanitizeInt(track.lastTurn, -1, -1, 999999);
  track.retryType = typeof track.retryType === "string" ? track.retryType : "";
  track.retryText = typeof track.retryText === "string" ? track.retryText : "";
  track.retrySig = typeof track.retrySig === "string" ? track.retrySig : "";
  track.retryKind = typeof track.retryKind === "string" ? track.retryKind : "";
  track.retryTurn = sanitizeInt(track.retryTurn, -1, -1, 999999);
}

function reconcile(cycleHint) {
  const ps = getPs();
  const turn = getTurn();
  const cycle = cycleHint || classifyTurn(ps);
  const rewindTurn = cycle.explicitRetry || cycle.implicitRetry ? turn - 1 : turn;
  const needsRebuild = ps.rt.lastSeen < 0 || turn < ps.rt.lastSeen || cycle.explicitRetry || cycle.implicitRetry;

  if (cycle.explicitRetry || cycle.implicitRetry) {
    rememberRetryCycle(ps, cycle);
  } else if (ps.track.retryTurn !== turn) {
    clearRetryCycle(ps);
  }

  if (!needsRebuild) {
    if (ps.pending.turn > turn) {
      clearPending(ps);
    }
    ps.rt.lastSeen = turn;
    return ps;
  }

  trimEntries(ps, rewindTurn);
  restoreRt(ps);
  ps.roles.primary.live = buildLive(ps, "primary");
  ps.roles.secondary.live = buildLive(ps, "secondary");

  if (!ps.roles.primary.turns.length) {
    ps.roles.primary.live = "";
    ps.roles.primary.handoff = ps.journal.length ? ps.roles.primary.handoff : "";
  }

  if (!ps.roles.secondary.turns.length) {
    ps.roles.secondary.live = "";
    ps.roles.secondary.handoff = ps.journal.length ? ps.roles.secondary.handoff : "";
  }

  if (ps.pending.turn > rewindTurn) {
    clearPending(ps);
  }

  ps.rt.lastSeen = turn;
  debug(ps, "state reconciled");
  return ps;
}

function restoreRt(ps) {
  const last = ps.journal.length ? ps.journal[ps.journal.length - 1] : null;

  ps.rt.focus = last ? sanitizeFocus(last.focus) : sanitizeFocus(ps.cfg.startFocus);
  ps.rt.together = last ? parseBool(last.together, false) : false;
  ps.rt.turns = last ? sanitizeInt(last.turns, 0, 0, 9999) : 0;
  ps.rt.target = last ? clampTarget(ps.cfg, sanitizeInt(last.target, ps.cfg.center, PS_MIN_TURNS, 9999)) : nextTarget(ps);
  ps.rt.lastLogged = -1;
  ps.roles.primary.handoff = last && typeof last.pH === "string" ? last.pH : "";
  ps.roles.secondary.handoff = last && typeof last.sH === "string" ? last.sH : "";
  ps.track.lastType = last && typeof last.aType === "string" ? last.aType : "";
  ps.track.lastText = last && typeof last.aText === "string" ? last.aText : "";
  ps.track.lastSig = last && typeof last.sig === "string" ? last.sig : "";
  ps.track.lastHash = last && typeof last.hash === "string" ? last.hash : "";
  ps.track.lastProbe = last && typeof last.probe === "string" ? last.probe : "";
  ps.track.lastKind = last && typeof last.kind === "string" ? last.kind : "";
  ps.track.lastTurn = last ? sanitizeInt(last.turn, -1, -1, 999999) : -1;
  clearRetryCycle(ps);
}

function trimEntries(ps, keepTurn) {
  ps.roles.primary.turns = ps.roles.primary.turns.filter((item) => item.turn <= keepTurn);
  ps.roles.secondary.turns = ps.roles.secondary.turns.filter((item) => item.turn <= keepTurn);
  ps.journal = ps.journal.filter((item) => item.turn <= keepTurn);
}

function savePending(ps, raw, cooked) {
  const type = getPlayerType(getType(), raw);
  ps.pending = {
    raw: String(raw || ""),
    cooked: String(cooked || ""),
    type: type,
    turn: getTurn()
  };
  rememberPending(ps, raw, type);
}

function clearPending(ps) {
  ps.pending = mkPending();
  ps.track.pendingRaw = "";
  ps.track.pendingNorm = "";
  ps.track.pendingType = "";
  ps.track.pendingSig = "";
  ps.track.pendingTurn = -1;
}

function rememberPending(ps, raw, type) {
  const norm = normalizeActionText(raw);
  if (!norm || !isPlayerType(type)) {
    clearPending(ps);
    return;
  }

  clearRetryCycle(ps);
  ps.track.pendingRaw = String(raw || "");
  ps.track.pendingNorm = norm;
  ps.track.pendingType = type;
  ps.track.pendingSig = getActionSig(type, raw);
  ps.track.pendingTurn = getTurn();
}

function rememberRetryCycle(ps, cycle) {
  ps.track.retryType = cycle.actionType || "";
  ps.track.retryText = normalizeActionText(cycle.actionText);
  ps.track.retrySig = cycle.sig || "";
  ps.track.retryKind = cycle.kind || "";
  ps.track.retryTurn = cycle.turn;
}

function clearRetryCycle(ps) {
  ps.track.retryType = "";
  ps.track.retryText = "";
  ps.track.retrySig = "";
  ps.track.retryKind = "";
  ps.track.retryTurn = -1;
}

function rememberProcessedTurn(ps, cycle, output) {
  ps.track.lastType = cycle.actionType || "";
  ps.track.lastText = normalizeActionText(cycle.actionText);
  ps.track.lastSig = cycle.sig || "";
  ps.track.lastHash = cycle.hash || "";
  ps.track.lastProbe = getResponseProbe(output);
  ps.track.lastKind = cycle.kind || "";
  ps.track.lastTurn = cycle.turn;
  clearRetryCycle(ps);
}

function classifyTurn(ps) {
  const turn = getTurn();
  const type = getType();
  const hash = getHistoryHash();
  const pendingFresh = ps.track.pendingTurn === turn && !!ps.track.pendingSig;
  const latest = getLatestPlayerAction(history);
  const retryFresh = ps.track.retryTurn === turn && !!ps.track.retrySig && !pendingFresh;
  let kind = "continue";
  let actionType = "continue";
  let actionText = "";
  let sig = "continue:" + hash;

  if (pendingFresh) {
    kind = "action";
    actionType = ps.track.pendingType || getPlayerType(type, ps.track.pendingRaw);
    actionText = ps.track.pendingRaw || "";
    sig = "action:" + (ps.track.pendingSig || getActionSig(actionType, actionText));
  } else if (retryFresh) {
    kind = ps.track.retryKind || (type === "retry" ? "retry" : "continue");
    actionType = ps.track.retryType || "continue";
    actionText = ps.track.retryText || "";
    sig = ps.track.retrySig;
  } else if (type === "retry" && ps.track.lastSig) {
    kind = ps.track.lastKind || "retry";
    actionType = ps.track.lastType || "continue";
    actionText = ps.track.lastText || "";
    sig = ps.track.lastSig;
  } else if (type === "continue" || !latest) {
    kind = "continue";
    sig = "continue:" + hash;
  } else {
    kind = "history";
    actionType = isPlayerType(latest.type) ? latest.type : "story";
    actionText = latest.text || latest.rawText || "";
    sig = "action:" + getActionSig(actionType, actionText);
  }

  const sameSig = !!sig && sig === ps.track.lastSig;
  const sameHash = !!hash && hash === ps.track.lastHash;
  const sameTurn = turn === ps.track.lastTurn;
  const explicitRetry = type === "retry";
  const probePresent = isResponseStillPresent(ps.track.lastProbe);
  const implicitRetry = hasTurn(ps, turn) && !pendingFresh && sameTurn && sameSig && (sameHash || !probePresent);

  return {
    turn: turn,
    type: type,
    hash: hash,
    kind: kind,
    actionType: actionType,
    actionText: actionText,
    sig: sig,
    pendingFresh: pendingFresh,
    explicitRetry: explicitRetry,
    implicitRetry: implicitRetry
  };
}

function recordTurn(ps, text, cycleHint) {
  if (!isReady(ps.cfg)) {
    clearPending(ps);
    return text;
  }

  const turn = getTurn();
  const cycle = cycleHint || classifyTurn(ps);
  const focus = ps.rt.focus;
  const role = ps.roles[focus];
  const pending = ps.pending.turn === turn ? ps.pending : mkPending();
  const actionText = pending.cooked || pending.raw || cycle.actionText || "";
  const output = cleanOut(text);

  upsertTurn(role.turns, {
    turn: turn,
    input: compact(actionText, 160),
    output: compact(output, 220)
  }, ps.cfg.recentMax);

  role.live = buildLive(ps, focus);

  const together = scanTogether(ps, pending.cooked + "\n" + output);
  if (together !== null && together !== ps.rt.together) {
    ps.rt.together = together;
    resetClock(ps);
  }

  if (!(ps.rt.together && ps.cfg.suspendTogether)) {
    ps.rt.turns += 1;
    if (ps.rt.turns >= ps.rt.target) {
      role.handoff = role.live;
      ps.rt.focus = flipFocus(focus);
      resetClock(ps);
    }
  } else if (ps.rt.together && ps.cfg.suspendTogether) {
    ps.rt.turns = 0;
  }

  ps.roles.primary.live = buildLive(ps, "primary");
  ps.roles.secondary.live = buildLive(ps, "secondary");
  ps.rt.lastLogged = turn;
  ps.rt.lastSeen = turn;
  saveSnapshot(ps, turn, {
    sig: cycle.sig,
    hash: cycle.hash,
    kind: cycle.kind,
    aType: cycle.actionType,
    aText: normalizeActionText(cycle.actionText),
    probe: getResponseProbe(output)
  });
  rememberProcessedTurn(ps, cycle, output);
  clearPending(ps);
  debug(ps, "turn recorded");
  return text;
}

function hasTurn(ps, turn) {
  for (let i = 0; i < ps.journal.length; i += 1) {
    if (ps.journal[i].turn === turn) {
      return true;
    }
  }
  return false;
}

function upsertTurn(list, item, max) {
  let replaced = false;

  for (let i = 0; i < list.length; i += 1) {
    if (list[i].turn === item.turn) {
      list[i] = item;
      replaced = true;
      break;
    }
  }

  if (!replaced) {
    list.push(item);
  }

  list.sort((a, b) => a.turn - b.turn);
  if (list.length > max) {
    list.splice(0, list.length - max);
  }
}

function saveSnapshot(ps, turn, meta) {
  const data = meta || {};
  const item = {
    turn: turn,
    focus: ps.rt.focus,
    together: ps.rt.together,
    turns: ps.rt.turns,
    target: ps.rt.target,
    pH: ps.roles.primary.handoff || "",
    sH: ps.roles.secondary.handoff || "",
    sig: typeof data.sig === "string" ? data.sig : ps.track.lastSig,
    hash: typeof data.hash === "string" ? data.hash : ps.track.lastHash,
    kind: typeof data.kind === "string" ? data.kind : ps.track.lastKind,
    aType: typeof data.aType === "string" ? data.aType : ps.track.lastType,
    aText: typeof data.aText === "string" ? data.aText : ps.track.lastText,
    probe: typeof data.probe === "string" ? data.probe : ps.track.lastProbe
  };

  let replaced = false;
  for (let i = 0; i < ps.journal.length; i += 1) {
    if (ps.journal[i].turn === turn) {
      ps.journal[i] = item;
      replaced = true;
      break;
    }
  }

  if (!replaced) {
    ps.journal.push(item);
  }

  ps.journal.sort((a, b) => a.turn - b.turn);
  if (ps.journal.length > ps.cfg.journalMax) {
    ps.journal.splice(0, ps.journal.length - ps.cfg.journalMax);
  }
}

function buildLive(ps, key) {
  const role = ps.roles[key];
  return buildSummary(getFocusName(ps, key), role.turns, ps.cfg.summaryMax);
}

function buildSummary(name, turns, max) {
  if (!name || !turns.length) {
    return "";
  }

  const bits = [];
  for (let i = 0; i < turns.length; i += 1) {
    const item = turns[i];
    const action = item.input ? "Action: " + compact(item.input, 50) : "";
    const beat = item.output ? "Beat: " + compact(item.output, 80) : "";
    bits.push("T" + item.turn + " " + [action, beat].filter(Boolean).join(" | "));
  }

  return clip(name + " checkpoint: " + bits.join(" || "), max);
}

function nextTarget(ps) {
  const bounds = getBounds(ps.cfg);
  const target = ps.cfg.center + getDensityAdj(ps) + getWave(ps);
  return clamp(target, bounds.min, bounds.max);
}

function getBounds(cfg) {
  const min = Math.max(PS_MIN_TURNS, cfg.center - cfg.flex);
  const max = Math.max(min, cfg.center + cfg.flex);
  return { min: min, max: max };
}

function getDensityAdj(ps) {
  const role = ps.roles[ps.rt.focus];
  if (!role || !role.turns.length) {
    return 0;
  }

  let total = 0;
  for (let i = 0; i < role.turns.length; i += 1) {
    total += (role.turns[i].input || "").length + (role.turns[i].output || "").length;
  }

  const avg = total / role.turns.length;
  if (avg > 260) {
    return 1;
  }
  if (avg < 120) {
    return -1;
  }
  return 0;
}

function getWave(ps) {
  const span = ps.cfg.flex * 2 + 1;
  if (span <= 1) {
    return 0;
  }

  const bias = ps.rt.focus === "secondary" ? 1 : 0;
  return ((getTurn() + bias) % span) - ps.cfg.flex;
}

function buildCtx() {
  const ps = getPs();
  if (!isReady(ps.cfg)) {
    return "";
  }

  const bounds = getBounds(ps.cfg);
  const focusName = getFocusName(ps, ps.rt.focus);
  const pSummary = ps.roles.primary.handoff || ps.roles.primary.live || "No primary checkpoint yet.";
  const sSummary = ps.roles.secondary.handoff || ps.roles.secondary.live || "No secondary checkpoint yet.";

  const lines = [
    "Focus: " + ps.rt.focus + " (" + focusName + ").",
    ps.rt.focus === "primary"
      ? 'Narrate the active thread in second person as "you". Keep ' + ps.cfg.secondaryName + " in third person."
      : "Narrate " + ps.cfg.secondaryName + " in third person. Keep " + ps.cfg.primaryName + ' as the player-facing second-person thread.',
    ps.rt.together && ps.cfg.suspendTogether
      ? "Both protagonists are together. Do not force a perspective switch until they separate again."
      : "Use a soft switch rhythm around " + bounds.min + "-" + bounds.max + " turns. Current counter: " + ps.rt.turns + "/" + ps.rt.target + ".",
    "Primary checkpoint: " + pSummary,
    "Secondary checkpoint: " + sSummary
  ];

  const room = Math.max(120, ps.cfg.noteMax - PS_BLOCK_START.length - PS_BLOCK_END.length - 4);
  const body = clip(lines.join("\n"), room);
  return PS_BLOCK_START + "\n" + body + "\n" + PS_BLOCK_END;
}

function injectNote(text) {
  const memory = getMemLen();
  const max = getMaxChars();
  const memoryText = memory ? String(text || "").slice(0, memory) : "";
  let context = memory ? String(text || "").slice(memory) : String(text || "");
  const block = buildCtx();

  context = stripBlock(context);
  if (!block) {
    return [memoryText, context].join("");
  }

  const lines = context.split("\n");
  if (lines.length > 2) {
    lines.splice(-3, 0, block);
  } else {
    lines.push(block);
  }

  context = lines.join("\n");
  context = context.slice(-(max - memory));
  return [memoryText, context].join("");
}

function stripBlock(text) {
  return String(text || "").replace(/\n?<PS>[\s\S]*?<\/PS>\n?/g, "\n").trimStart();
}

function cleanOut(text) {
  return compact(stripBlock(text).replace(/\s*<<[\s\S]*?>>\s*/g, " "), 260);
}

function scanTogether(ps, text) {
  if (!isReady(ps.cfg)) {
    return null;
  }

  const sample = " " + compact(text, 600).toLowerCase() + " ";
  const hasA = hasName(sample, ps.cfg.primaryName);
  const hasB = hasName(sample, ps.cfg.secondaryName);

  if ((hasA && hasB) || sample.includes(" both ")) {
    if (hasPhrase(sample, PS_TOGETHER_TERMS)) {
      return true;
    }
    if (hasPhrase(sample, PS_SEPARATE_TERMS)) {
      return false;
    }
  }

  return null;
}

function hasName(text, name) {
  const clean = cleanName(name).toLowerCase();
  if (!clean) {
    return false;
  }

  const rx = new RegExp("(^|[^a-z0-9])" + esc(clean) + "([^a-z0-9]|$)", "i");
  return rx.test(text);
}

function hasPhrase(text, list) {
  for (let i = 0; i < list.length; i += 1) {
    if (text.indexOf(" " + list[i].toLowerCase() + " ") !== -1) {
      return true;
    }
  }
  return false;
}

function shouldRewriteB(ps) {
  return isReady(ps.cfg) &&
    ps.rt.focus === "secondary" &&
    !ps.rt.together &&
    ps.cfg.rewriteSecondary;
}

function rewriteB(text, name, type) {
  const raw = String(text || "");
  if (!raw.trim() || raw.trim().charAt(0) === "/") {
    return raw;
  }

  const marker = raw.match(/^(\s*>\s*)([\s\S]*)$/);
  const lead = marker ? marker[1] : "";
  const body = marker ? marker[2] : raw;
  const trimmed = body.trim();

  if (!trimmed) {
    return raw;
  }

  if (/^["']/.test(trimmed) || type === "say") {
    return (lead || "> ") + rewriteSay(trimmed, name);
  }

  return (lead || "> ") + rewriteDo(trimmed, name);
}

function rewriteSay(body, name) {
  if (/^["']/.test(body)) {
    return name + " says " + body;
  }
  return name + " says, " + body;
}

function rewriteDo(body, name) {
  let text = swapPronouns(body, name);
  text = ensureNamed(text, name);
  return conjAfter(text, name);
}

function swapPronouns(text, name) {
  return String(text || "")
    .replace(/\b[Ii]'m\b/g, name + " is")
    .replace(/\b[Ii]\s+am\b/g, name + " is")
    .replace(/\b[Yy]ou're\b/g, name + " is")
    .replace(/\b[Yy]ou\s+are\b/g, name + " is")
    .replace(/\b[Yy]ou\s+were\b/g, name + " was")
    .replace(/\b[Ii]'ll\b/g, name + " will")
    .replace(/\b[Ii]\s+will\b/g, name + " will")
    .replace(/\b[Yy]ou'll\b/g, name + " will")
    .replace(/\b[Yy]ou\s+will\b/g, name + " will")
    .replace(/\b[Ii]'ve\b/g, name + " has")
    .replace(/\b[Ii]\s+have\b/g, name + " has")
    .replace(/\b[Yy]ou've\b/g, name + " has")
    .replace(/\b[Yy]ou\s+have\b/g, name + " has")
    .replace(/\b[Ii]'d\b/g, name + " would")
    .replace(/\b[Ii]\s+would\b/g, name + " would")
    .replace(/\b[Dd]on't\b/g, "does not")
    .replace(/\b[Cc]an't\b/g, "cannot")
    .replace(/\b[Ww]on't\b/g, "will not")
    .replace(/\b[Mm]yself\b/g, "himself")
    .replace(/\b[Yy]ourself\b/g, "himself")
    .replace(/\b[Mm]ine\b/g, "his")
    .replace(/\b[Yy]ours\b/g, "his")
    .replace(/\b[Mm]y\b/g, "his")
    .replace(/\b[Yy]our\b/g, "his")
    .replace(/\b[Mm]e\b/g, "him")
    .replace(/\b[Ii]\b/g, name)
    .replace(/\b[Yy]ou\b/g, name);
}

function ensureNamed(text, name) {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    return name;
  }

  if (hasName(" " + trimmed.toLowerCase() + " ", name)) {
    return trimmed;
  }

  return name + " " + trimmed;
}

function conjAfter(text, name) {
  const rx = new RegExp("^" + esc(name) + "\\s+(.+)$", "i");
  const match = String(text || "").match(rx);
  if (!match) {
    return text;
  }

  return name + " " + conj(match[1]);
}

function conj(text) {
  const match = String(text || "").match(/^([A-Za-z']+)([\s\S]*)$/);
  if (!match) {
    return text;
  }

  const word = match[1];
  const tail = match[2] || "";
  const lower = word.toLowerCase();

  if (PS_SKIP_CONJ[lower] || PS_PAST_WORDS[lower] || /ed$|ing$/.test(lower)) {
    return word + tail;
  }

  if (lower === "are") {
    return "is" + tail;
  }
  if (lower === "were") {
    return "was" + tail;
  }
  if (lower === "have") {
    return "has" + tail;
  }
  if (lower === "do") {
    return "does" + tail;
  }
  if (lower === "go") {
    return "goes" + tail;
  }

  if (/[^aeiou]y$/.test(lower)) {
    return word.slice(0, -1) + "ies" + tail;
  }

  if (/(s|sh|ch|x|z|o)$/.test(lower)) {
    return word + "es" + tail;
  }

  return word + "s" + tail;
}

function handleCmd(text) {
  const raw = String(text || "").trim();
  if (!/^\/psaros\b/i.test(raw)) {
    return { handled: false, reply: "" };
  }

  const ps = getPs();
  const lower = raw.toLowerCase();
  let reply = "";

  if (lower === "/psaros" || lower === "/psaros status") {
    reply = buildStatus(ps);
  } else if (lower === "/psaros debug on") {
    ps.cfg.debug = true;
    saveCfg(ps.cfg);
    reply = "PS debug enabled.";
  } else if (lower === "/psaros debug off") {
    ps.cfg.debug = false;
    saveCfg(ps.cfg);
    reply = "PS debug disabled.";
  } else if (lower === "/psaros switch") {
    if (isReady(ps.cfg)) {
      ps.roles[ps.rt.focus].handoff = ps.roles[ps.rt.focus].live;
      ps.rt.focus = flipFocus(ps.rt.focus);
      resetClock(ps);
      saveSnapshot(ps, getTurn());
      reply = "Focus switched to " + ps.rt.focus + ".";
    } else {
      reply = "PS is not configured yet. Fill in " + PS_CARD_TITLE + " first.";
    }
  } else if (lower === "/psaros focus primary") {
    ps.rt.focus = "primary";
    resetClock(ps);
    saveSnapshot(ps, getTurn());
    reply = "Focus set to primary.";
  } else if (lower === "/psaros focus secondary") {
    ps.rt.focus = "secondary";
    resetClock(ps);
    saveSnapshot(ps, getTurn());
    reply = "Focus set to secondary.";
  } else if (lower === "/psaros together") {
    ps.rt.together = true;
    resetClock(ps);
    saveSnapshot(ps, getTurn());
    reply = "Protagonists marked as together.";
  } else if (lower === "/psaros split") {
    ps.rt.together = false;
    resetClock(ps);
    saveSnapshot(ps, getTurn());
    reply = "Protagonists marked as separate.";
  } else {
    reply = buildStatus(ps) + "\n\nCommands:\n" + PS_HELP;
  }

  debug(ps, "command handled");
  return { handled: true, reply: reply };
}

function resetClock(ps) {
  ps.rt.turns = 0;
  ps.rt.target = nextTarget(ps);
}

function buildStatus(ps) {
  const bounds = getBounds(ps.cfg);
  const lines = [
    "Parallel Saros",
    "Settings card: " + PS_CARD_TITLE,
    "Configured: " + (isReady(ps.cfg) ? "yes" : "no"),
    "Primary: " + (ps.cfg.primaryName || "(blank)"),
    "Secondary: " + (ps.cfg.secondaryName || "(blank)"),
    "Focus: " + ps.rt.focus,
    "Together: " + String(ps.rt.together),
    "Switch center/flex: " + ps.cfg.center + " +/- " + ps.cfg.flex,
    "Switch window: " + bounds.min + "-" + bounds.max,
    "Current target: " + ps.rt.target,
    "Current counter: " + ps.rt.turns,
    "Primary checkpoint: " + (ps.roles.primary.handoff || ps.roles.primary.live || "(none)"),
    "Secondary checkpoint: " + (ps.roles.secondary.handoff || ps.roles.secondary.live || "(none)")
  ];

  return lines.join("\n");
}

function isReady(cfg) {
  return !!(cleanName(cfg.primaryName) && cleanName(cfg.secondaryName));
}

function flipFocus(focus) {
  return focus === "secondary" ? "primary" : "secondary";
}

function getFocusName(ps, key) {
  return key === "secondary" ? ps.cfg.secondaryName : ps.cfg.primaryName;
}

function getLatestPlayerAction(items) {
  const list = Array.isArray(items) ? items : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const item = list[i];
    if (item && isPlayerType(item.type)) {
      return item;
    }
  }
  return null;
}

function isPlayerType(type) {
  return type === "do" || type === "say" || type === "story";
}

function getPlayerType(type, text) {
  if (isPlayerType(type)) {
    return type;
  }

  const raw = String(text || "").trim();
  if (!raw) {
    return "do";
  }
  if (/^["']/.test(raw)) {
    return "say";
  }
  return "do";
}

function normalizeActionText(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

function getActionSig(type, text) {
  return (type || "") + ":" + normalizeActionText(text);
}

function getHistoryHash() {
  const list = Array.isArray(history) ? history.slice(-50) : [];
  const serialized = JSON.stringify(list);
  let hash = 0;

  for (let i = 0; i < serialized.length; i += 1) {
    hash = ((31 * hash) + serialized.charCodeAt(i)) | 0;
  }

  return hash.toString(16);
}

function getResponseProbe(text) {
  const clean = compact(text, 120);
  if (!clean) {
    return "";
  }
  return clean.length > 64 ? clean.slice(0, 64) : clean;
}

function isResponseStillPresent(probe) {
  if (!probe) {
    return false;
  }

  const recent = (Array.isArray(history) ? history : [])
    .slice(-6)
    .map((item) => item && item.text ? item.text : "")
    .join("\n");

  return recent.indexOf(probe) !== -1;
}

function compact(text, max) {
  const clean = String(text || "")
    .replace(/\r/g, " ")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^>\s*/, "")
    .trim();

  return typeof max === "number" ? clip(clean, max) : clean;
}

function clip(text, max) {
  const clean = String(text || "");
  if (!Number.isFinite(max) || max < 8 || clean.length <= max) {
    return clean;
  }
  return clean.slice(0, Math.max(0, max - 3)).trimEnd() + "...";
}

function cleanName(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function parseBool(value, fallback) {
  if (typeof value === "boolean") {
    return value;
  }

  const lower = String(value || "").trim().toLowerCase();
  if (!lower) {
    return fallback;
  }
  if (lower === "true" || lower === "yes" || lower === "on") {
    return true;
  }
  if (lower === "false" || lower === "no" || lower === "off") {
    return false;
  }
  return fallback;
}

function esc(text) {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sanitizeInt(value, fallback, min, max) {
  const num = parseInt(value, 10);
  if (!Number.isFinite(num)) {
    return fallback;
  }
  return clamp(num, min, max);
}

function sanitizeEvery(value) {
  return sanitizeInt(value, 12, PS_MIN_TURNS, 40);
}

function sanitizeFlex(value) {
  return sanitizeInt(value, 2, 1, 4);
}

function clampTarget(cfg, value) {
  const bounds = getBounds(cfg);
  return clamp(value, bounds.min, bounds.max);
}

function sanitizeFocus(value) {
  return String(value || "").toLowerCase() === "secondary" ? "secondary" : "primary";
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getTurn() {
  return typeof info !== "undefined" && Number.isFinite(info.actionCount) ? info.actionCount : 0;
}

function getType() {
  return typeof info !== "undefined" && typeof info.actionType === "string" ? info.actionType : "do";
}

function getMemLen() {
  return typeof info !== "undefined" && Number.isFinite(info.memoryLength) ? info.memoryLength : 0;
}

function getMaxChars() {
  return typeof info !== "undefined" && Number.isFinite(info.maxChars) ? info.maxChars : 4000;
}

function debug(ps, msg) {
  if (!ps.cfg.debug || typeof console === "undefined" || typeof console.log !== "function") {
    return;
  }

  console.log("[PS]", msg, {
    turn: getTurn(),
    focus: ps.rt.focus,
    together: ps.rt.together,
    turns: ps.rt.turns,
    target: ps.rt.target
  });
}
