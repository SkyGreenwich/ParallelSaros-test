// Parallel Saros library.
// The hook files stay thin; all shared runtime logic lives here.

const PS_MIN_TURNS = 10;
const PS_CARD_TITLE = "PS Settings";
const PS_CARD_DESC = "Parallel Saros settings. Edit the fields below to configure the dual-protagonist script.";
const PS_BLOCK_START = "<PS>";
const PS_BLOCK_END = "</PS>";
const PS_SHIFT_MARK = "----------------";

const PS_TASK_NONE = "";
const PS_TASK_PRESENCE = "presence";
const PS_TASK_THREAD = "thread";
const PS_TASK_CD = 2;
const PS_PRESENCE_HINTS = [
  "meet",
  "find",
  "search",
  "look for",
  "rejoin",
  "join",
  "leave",
  "split",
  "together",
  "apart",
  "same room"
];

const PS_HELP = [
  "/psaros or /psaros status",
  "/psaros enable",
  "/psaros disable",
  "/psaros switch",
  "/psaros focus primary",
  "/psaros focus secondary",
  "/psaros together",
  "/psaros split",
  "/psaros debug on",
  "/psaros debug off"
].join("\n");

const PS_ENABLED_LABEL = "Script Active";

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

const PS_SPEECH_VERBS = [
  "say",
  "ask",
  "reply",
  "whisper",
  "shout",
  "tell",
  "speak",
  "mutter",
  "murmur",
  "answer",
  "call",
  "remark",
  "admit",
  "add",
  "yell"
];

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
  if (!ps.rt.enabled) {
    quiesceDisabled(ps);
    return text;
  }
  const cooked = shouldRewriteB(ps) ? rewriteB(text, ps.cfg.secondaryName, getType()) : text;
  savePending(ps, text, cooked);
  return cooked;
}

function onContextPs(text) {
  syncCfg();
  reconcile();
  if (!getPs().rt.enabled) {
    quiesceDisabled(getPs());
    return text;
  }
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

  if (!ps.rt.enabled) {
    quiesceDisabled(ps);
    return sanitizeVisibleText(text);
  }

  return recordTurn(ps, text, cycle);
}

function getPs() {
  if (!state.parallelSaros || typeof state.parallelSaros !== "object") {
    state.parallelSaros = {
      cfg: defaultCfg(),
      rt: {
        enabled: true,
        focus: "primary",
        together: false,
        manual: "",
        breakTurn: -1,
        task: PS_TASK_NONE,
        taskRole: "",
        taskTurn: -1,
        taskTry: 0,
        taskCd: 0,
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
    enabled: true,
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
    handoff: "",
    scene: "",
    knows: "",
    next: ""
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

  const prevEnabled = parseBool(ps.rt && ps.rt.enabled, true);
  const cfg = loadCfg(card.entry || "", ps.cfg);
  const built = buildCfg(cfg);

  if (card.entry !== built) {
    card.entry = built;
  }

  ps.cfg = cfg;
  normalizeRt(ps);
  if (prevEnabled !== cfg.enabled) {
    setEnabledState(ps, cfg.enabled);
  }
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

// PS Settings used to expose a longer list of user-facing tuning fields here.
// The card is intentionally minimal now: only the on/off toggle, protagonist
// identities, and switch center remain editable; the rest stays internal.
function buildCfg(cfg) {
  return [
    PS_ENABLED_LABEL + ": " + String(parseBool(cfg.enabled, true)),
    "Primary Name: " + (cfg.primaryName || ""),
    "Secondary Name: " + (cfg.secondaryName || ""),
    "Switch Center: " + sanitizeEvery(cfg.center)
  ].join("\n");
}

function getCfgLine(entry, label) {
  const rx = new RegExp("^" + esc(label) + "[ \\t]*:[ \\t]*(.*)$", "im");
  const match = String(entry || "").match(rx);
  return match ? match[1].trim() : "";
}

// The old card-level custom fields were retired with the simplified settings
// card. Runtime-only flags such as debug can still survive in memory, but they
// are no longer read from or written to the story card.
function loadCfg(entry, prevCfg) {
  const cfg = defaultCfg();
  const prev = prevCfg && typeof prevCfg === "object" ? prevCfg : null;

  if (prev) {
    cfg.debug = parseBool(prev.debug, cfg.debug);
  }

  cfg.enabled = parseBool(getCfgLine(entry, PS_ENABLED_LABEL), cfg.enabled);
  cfg.primaryName = cleanName(getCfgLine(entry, "Primary Name"));
  cfg.secondaryName = cleanName(getCfgLine(entry, "Secondary Name"));
  cfg.center = sanitizeEvery(getCfgLine(entry, "Switch Center"));

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

  rt.enabled = parseBool(rt.enabled, true);
  rt.focus = sanitizeFocus(rt.focus || cfg.startFocus);
  rt.together = parseBool(rt.together, false);
  rt.manual = sanitizeManual(rt.manual);
  rt.breakTurn = sanitizeInt(rt.breakTurn, -1, -1, 999999);
  rt.task = sanitizeTask(rt.task);
  rt.taskRole = sanitizeTaskRole(rt.taskRole);
  rt.taskTurn = sanitizeInt(rt.taskTurn, -1, -1, 999999);
  rt.taskTry = sanitizeInt(rt.taskTry, 0, 0, 99);
  rt.taskCd = sanitizeInt(rt.taskCd, 0, 0, 99);
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
    if (!ps.journal.length) {
      clearThreadState(ps.roles.primary);
    }
  }

  if (!ps.roles.secondary.turns.length) {
    ps.roles.secondary.live = "";
    ps.roles.secondary.handoff = ps.journal.length ? ps.roles.secondary.handoff : "";
    if (!ps.journal.length) {
      clearThreadState(ps.roles.secondary);
    }
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

  ps.rt.enabled = last ? parseBool(last.enabled, true) : true;
  ps.rt.focus = last ? sanitizeFocus(last.focus) : sanitizeFocus(ps.cfg.startFocus);
  ps.rt.together = last ? parseBool(last.together, false) : false;
  ps.rt.manual = last ? sanitizeManual(last.manual) : "";
  ps.rt.breakTurn = last ? sanitizeInt(last.breakTurn, -1, -1, 999999) : -1;
  ps.rt.task = last ? sanitizeTask(last.task) : PS_TASK_NONE;
  ps.rt.taskRole = last ? sanitizeTaskRole(last.taskRole) : "";
  ps.rt.taskTurn = last ? sanitizeInt(last.taskTurn, -1, -1, 999999) : -1;
  ps.rt.taskTry = last ? sanitizeInt(last.taskTry, 0, 0, 99) : 0;
  ps.rt.taskCd = last ? sanitizeInt(last.taskCd, 0, 0, 99) : 0;
  ps.rt.turns = last ? sanitizeInt(last.turns, 0, 0, 9999) : 0;
  ps.rt.target = last ? clampTarget(ps.cfg, sanitizeInt(last.target, ps.cfg.center, PS_MIN_TURNS, 9999)) : nextTarget(ps);
  ps.rt.lastLogged = -1;
  ps.roles.primary.handoff = last && typeof last.pH === "string" ? last.pH : "";
  ps.roles.secondary.handoff = last && typeof last.sH === "string" ? last.sH : "";
  ps.roles.primary.scene = last && typeof last.pScene === "string" ? last.pScene : "";
  ps.roles.primary.knows = last && typeof last.pKnow === "string" ? last.pKnow : "";
  ps.roles.primary.next = last && typeof last.pNext === "string" ? last.pNext : "";
  ps.roles.secondary.scene = last && typeof last.sScene === "string" ? last.sScene : "";
  ps.roles.secondary.knows = last && typeof last.sKnow === "string" ? last.sKnow : "";
  ps.roles.secondary.next = last && typeof last.sNext === "string" ? last.sNext : "";
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

function clearCycleMemory(ps) {
  ps.track.lastType = "";
  ps.track.lastText = "";
  ps.track.lastSig = "";
  ps.track.lastHash = "";
  ps.track.lastProbe = "";
  ps.track.lastKind = "";
  ps.track.lastTurn = -1;
  clearRetryCycle(ps);
}

// Keep the "disabled" path close to the examples: stop doing work early and
// clear only volatile runtime signals so the core story state can resume later.
function quiesceDisabled(ps) {
  clearTask(ps);
  clearPending(ps);
  clearRetryCycle(ps);
}

function setEnabledState(ps, enabled) {
  const next = parseBool(enabled, true);
  ps.cfg.enabled = next;
  ps.rt.enabled = next;
  clearTask(ps);
  clearPending(ps);
  clearCycleMemory(ps);
  ps.rt.lastSeen = -1;

  if (!next) {
    return;
  }
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
  const task = getActiveTask(ps);
  const pending = ps.pending.turn === turn ? ps.pending : mkPending();
  const actionText = pending.cooked || pending.raw || cycle.actionText || "";
  const parsed = parseTaskOutput(ps, text);
  const storyText = parsed.story;
  const sceneOut = stripBlock(storyText).replace(/\s*<<[\s\S]*?>>\s*/g, " ");
  const output = compact(sceneOut, 260);

  upsertTurn(role.turns, {
    turn: turn,
    input: compact(actionText, 160),
    output: compact(output, 220)
  }, ps.cfg.recentMax);

  role.live = buildLive(ps, focus);

  if (task === PS_TASK_PRESENCE) {
    applyPresenceTask(ps, parsed.presence);
  } else if (task === PS_TASK_THREAD) {
    applyThreadTask(role, parsed.thread);
  }

  if (ps.rt.together && ps.cfg.suspendTogether) {
    ps.rt.turns = 0;
  } else {
    ps.rt.turns += 1;
    if (ps.rt.turns >= ps.rt.target) {
      if (task === PS_TASK_PRESENCE) {
        ps.rt.turns = Math.max(ps.rt.turns, ps.rt.target);
      } else {
        role.handoff = buildThreadNote(ps, focus);
        ps.rt.focus = flipFocus(focus);
        ps.rt.breakTurn = turn + 1;
        resetClock(ps);
      }
    }
  }

  ps.roles.primary.live = buildLive(ps, "primary");
  ps.roles.secondary.live = buildLive(ps, "secondary");
  finishTask(ps, task);
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
  return applyBreakMark(ps, storyText, turn);
}

function applyBreakMark(ps, text, turn) {
  if (ps.rt.breakTurn !== turn) {
    return text;
  }

  ps.rt.breakTurn = -1;
  return addShiftMark(text);
}

function addShiftMark(text) {
  const story = String(text || "").trimStart();
  if (!story) {
    return "\n" + PS_SHIFT_MARK + "\n";
  }

  const clean = story.replace(/^(?:-{3,}|[=_*]{3,})\s*\n+/g, "");
  return "\n" + PS_SHIFT_MARK + "\n\n" + clean;
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
    enabled: ps.rt.enabled,
    focus: ps.rt.focus,
    together: ps.rt.together,
    turns: ps.rt.turns,
    target: ps.rt.target,
    manual: ps.rt.manual,
    breakTurn: ps.rt.breakTurn,
    task: ps.rt.task,
    taskRole: ps.rt.taskRole,
    taskTurn: ps.rt.taskTurn,
    taskTry: ps.rt.taskTry,
    taskCd: ps.rt.taskCd,
    pH: ps.roles.primary.handoff || "",
    sH: ps.roles.secondary.handoff || "",
    pScene: ps.roles.primary.scene || "",
    pKnow: ps.roles.primary.knows || "",
    pNext: ps.roles.primary.next || "",
    sScene: ps.roles.secondary.scene || "",
    sKnow: ps.roles.secondary.knows || "",
    sNext: ps.roles.secondary.next || "",
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

function buildThreadNote(ps, key) {
  const role = ps.roles[key];
  const name = getFocusName(ps, key);
  if (!role || !name) {
    return "";
  }

  const parts = [];
  if (role.scene) {
    parts.push("Scene: " + clip(role.scene, 110));
  }
  if (role.knows) {
    parts.push("Knows: " + clip(role.knows, 130));
  }
  if (role.next) {
    parts.push("Next: " + clip(role.next, 110));
  }

  if (!parts.length) {
    return role.live || role.handoff || "";
  }

  return clip(name + " thread: " + parts.join(" | "), ps.cfg.summaryMax);
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

function buildCtx(text) {
  const ps = getPs();
  if (!isReady(ps.cfg)) {
    return "";
  }

  const task = planTask(ps, text);
  const turn = getTurn();
  const focusKey = ps.rt.focus;
  const otherKey = flipFocus(focusKey);
  const focusName = getFocusName(ps, focusKey);
  const otherName = getFocusName(ps, otherKey);
  const focusRole = ps.roles[focusKey];
  const entering = ps.rt.breakTurn === turn;
  const focusScene = buildThreadField(ps, focusKey, "scene");
  const focusKnows = buildThreadField(ps, focusKey, "knows");
  const focusNext = buildThreadField(ps, focusKey, "next");
  const offstage = buildOffstageNote(ps, otherKey, entering);
  const lines = ["<SYSTEM>"].concat(buildTaskLines(ps, task, entering), [
    focusKey === "primary"
      ? 'PoV: "you" in second person; keep ' + ps.cfg.secondaryName + " in third person."
      : "PoV: " + ps.cfg.secondaryName + " third person; keep " + ps.cfg.primaryName + " as the second-person player thread.",
    entering
      ? "Shift: offstage " + otherName + " ended. Resume " + focusName + " only."
      : "Stay inside " + focusName + "'s local thread.",
    ps.rt.together
      ? "Together: direct interaction is allowed."
      : "Separate: no offstage imports from " + otherName + " unless directly perceived here.",
    "Offstage: " + offstage,
    focusRole.scene || focusRole.knows || focusRole.next
      ? "Scene: " + focusScene
      : "Scene: establish a narrow local opening for " + focusName + " from direct perception only.",
    "Knows: " + focusKnows,
    "Next: " + focusNext,
    "</SYSTEM>"
  ]).filter(Boolean);

  const room = Math.max(120, ps.cfg.noteMax - PS_BLOCK_START.length - PS_BLOCK_END.length - 4);
  const body = clip(lines.join("\n"), room);
  return PS_BLOCK_START + "\n" + body + "\n" + PS_BLOCK_END;
}

function injectNote(text) {
  const memory = getMemLen();
  const max = getMaxChars();
  const memoryText = memory ? String(text || "").slice(0, memory) : "";
  let context = memory ? String(text || "").slice(memory) : String(text || "");
  const block = buildCtx(context);

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
  return compact(stripCtrl(text), 260);
}

function setTogether(ps, value, rule) {
  if (ps.rt.together === value) {
    return;
  }

  ps.rt.together = value;
  resetClock(ps);
  debug(ps, "presence " + (value ? "together" : "separate") + (rule ? " via " + rule : ""));
}

function getActiveTask(ps) {
  return ps.rt.taskTurn === getTurn() ? ps.rt.task : PS_TASK_NONE;
}

function planTask(ps, text) {
  const turn = getTurn();
  if (ps.rt.taskTurn === turn && ps.rt.task !== PS_TASK_NONE) {
    return ps.rt.task;
  }

  clearTask(ps);
  if (!isReady(ps.cfg)) {
    return PS_TASK_NONE;
  }

  if (shouldAskPresence(ps, text)) {
    setTask(ps, PS_TASK_PRESENCE, "");
    return ps.rt.task;
  }

  if (shouldAskThread(ps)) {
    setTask(ps, PS_TASK_THREAD, ps.rt.focus);
    return ps.rt.task;
  }

  return PS_TASK_NONE;
}

function shouldAskPresence(ps, text) {
  if (ps.rt.manual || ps.rt.taskCd > 0) {
    return false;
  }

  const seed = buildPresenceSeed(ps, text);
  if (!seed) {
    return false;
  }

  const lower = seed.toLowerCase();
  const hasHint = hasPhrase(lower, PS_PRESENCE_HINTS);
  if (!hasHint) {
    return false;
  }

  const hasSecondary = hasName(lower, ps.cfg.secondaryName);
  const hasPrimary = hasName(lower, ps.cfg.primaryName) || /\byou\b/.test(lower);
  const pairCue = /\bboth\b|\beach other\b|\btogether\b|\bapart\b|\bsame room\b|\bface to face\b/.test(lower);
  return pairCue || (hasSecondary && hasPrimary) || (ps.rt.focus === "primary" && hasSecondary) || (ps.rt.focus === "secondary" && hasPrimary);
}

function buildPresenceSeed(ps, text) {
  const recent = getRecentText(4);
  return [
    ps.pending.raw,
    ps.pending.cooked !== ps.pending.raw ? ps.pending.cooked : "",
    recent,
    compact(text, 900)
  ].filter(Boolean).join("\n");
}

function getRecentText(max) {
  const list = Array.isArray(history) ? history.slice(-Math.max(0, max || 0)) : [];
  const bits = [];

  for (let i = 0; i < list.length; i += 1) {
    const text = list[i] && (list[i].rawText || list[i].text);
    if (text) {
      bits.push(String(text));
    }
  }

  return bits.join("\n");
}

function shouldAskSummary(ps) {
  return !(ps.rt.together && ps.cfg.suspendTogether) && ps.rt.turns + 1 >= ps.rt.target;
}

function shouldAskThread(ps) {
  if (ps.rt.breakTurn === getTurn()) {
    return true;
  }

  if (roleNeedsThread(ps.roles[ps.rt.focus])) {
    return true;
  }

  return shouldAskSummary(ps);
}

function buildTaskLines(ps, task, entering) {
  if (task === PS_TASK_PRESENCE) {
    return [
      "Task: start with exactly one line `(ps_presence=together)` or `(ps_presence=separate)` or `(ps_presence=unclear)`, then continue the story.",
      "Choose together only for a clearly shared scene. Choose separate only for a clearly split scene. Otherwise choose unclear."
    ];
  }

  if (task === PS_TASK_THREAD) {
    return [
      "Task: start with `(ps_thread scene=`...`; knows=`...`; next=`...`)`, then continue.",
      entering
        ? "Shift turn: resume only the active protagonist's local thread."
        : "Continue only the active protagonist's own thread.",
      "`scene`=local scene, `knows`=current knowledge, `next`=immediate step. Keep them short and factual."
    ];
  }

  return [];
}

function parseTaskOutput(ps, text) {
  const raw = String(text || "");
  const presence = findPresenceValue(raw);
  const thread = findThreadValue(raw);
  const task = getActiveTask(ps);
  return {
    story: sanitizeVisibleText(raw),
    presence: task === PS_TASK_PRESENCE ? presence : "",
    thread: task === PS_TASK_THREAD ? thread : null
  };
}

function findPresenceValue(text) {
  const match = getTaskWindow(text).match(/\(\s*ps_presence\s*=\s*(together|separate|unclear)\s*\)/i);
  if (!match) {
    return "";
  }
  return match[1].toLowerCase();
}

function findThreadValue(text) {
  const match = getTaskWindow(text).match(/\(\s*ps_thread\s+scene\s*=\s*`([^`]{1,220})`\s*;\s*knows\s*=\s*`([^`]{1,260})`\s*;\s*next\s*=\s*`([^`]{1,220})`\s*\)/i);
  if (!match) {
    return null;
  }

  const thread = {
    scene: cleanThreadValue(match[1], 160),
    knows: cleanThreadValue(match[2], 180),
    next: cleanThreadValue(match[3], 160)
  };

  return isThreadValueValid(thread) ? thread : null;
}

function getTaskWindow(text) {
  return String(text || "").slice(0, 420);
}

function sanitizeVisibleText(text) {
  return tidyVisibleText(stripCtrl(text));
}

function stripCtrl(text) {
  return stripLooseCtrl(String(text || "")
    .replace(/\s*\(\s*ps_presence\s*=\s*(?:together|separate|unclear)\s*\)\s*/ig, " ")
    .replace(/\s*\(\s*ps_thread\s+scene\s*=\s*`[^`]{1,220}`\s*;\s*knows\s*=\s*`[^`]{1,260}`\s*;\s*next\s*=\s*`[^`]{1,220}`\s*\)\s*/ig, " ")
    .replace(/\s*\(\s*ps_summary\s*=\s*`[^`]{1,320}`\s*\)\s*/ig, " ")
    .replace(/\n?<PS>[\s\S]*?<\/PS>\n?/gi, "\n")
    .replace(/\s*<<[\s\S]*?>>\s*/g, " "));
}

function stripLooseCtrl(text) {
  return String(text || "")
    .replace(/\s*ps_presence\s*=\s*(?:together|separate|unclear)\b(?:\s*[.,;:!?-]*)\s*/ig, " ")
    .replace(/\s*ps_thread\s+scene\s*=\s*`[^`\n]{1,220}`\s*;\s*knows\s*=\s*`[^`\n]{1,260}`\s*;\s*next\s*=\s*`[^`\n]{1,220}`(?:\s*[.,;:!?-]*)\s*/ig, " ")
    .replace(/\s*ps_summary\s*=\s*`[^`\n]{1,320}`(?:\s*[.,;:!?-]*)\s*/ig, " ")
    .replace(/\s*\(\s*ps_presence\b[\s\S]{0,120}?(?:\)|(?=\n)|$)\s*/ig, " ")
    .replace(/\s*\(\s*ps_thread\b[\s\S]{0,560}?(?:\)|(?=\n)|$)\s*/ig, " ")
    .replace(/\s*\(\s*ps_summary\b[\s\S]{0,360}?(?:\)|(?=\n)|$)\s*/ig, " ")
    .replace(/(^|\n)\s*ps_(?:presence|thread|summary)\b[^\n]{0,560}(?=\n|$)/ig, "$1")
    .replace(/\n?\s*<PS>[\s\S]{0,1200}?(?:<\/PS>|(?=\n\s*\n)|$)\s*/gi, "\n")
    .replace(/\n?\s*<\/?PS>\s*\n?/gi, "\n")
    .replace(/\s*<<[\s\S]{0,240}?(?:>>|(?=\n)|$)\s*/g, " ");
}

function tidyVisibleText(text) {
  return String(text || "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trimStart();
}

function applyPresenceTask(ps, decision) {
  const value = String(decision || "").toLowerCase();
  if (value === "together") {
    setTogether(ps, true, "ai");
  } else if (value === "separate") {
    setTogether(ps, false, "ai");
  }
}

function applyThreadTask(role, thread) {
  if (!role || !thread || !isThreadValueValid(thread)) {
    return;
  }

  role.scene = thread.scene;
  role.knows = thread.knows;
  role.next = thread.next;
}

function setTask(ps, kind, role) {
  ps.rt.task = sanitizeTask(kind);
  ps.rt.taskRole = sanitizeTaskRole(role);
  ps.rt.taskTurn = getTurn();
  ps.rt.taskTry = 1;
}

function clearTask(ps) {
  ps.rt.task = PS_TASK_NONE;
  ps.rt.taskRole = "";
  ps.rt.taskTurn = -1;
  ps.rt.taskTry = 0;
}

function finishTask(ps, task) {
  if (task === PS_TASK_PRESENCE) {
    ps.rt.taskCd = PS_TASK_CD;
  } else if (ps.rt.taskCd > 0) {
    ps.rt.taskCd -= 1;
  }

  clearTask(ps);
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
  const sample = String(text || "").toLowerCase();
  for (let i = 0; i < list.length; i += 1) {
    const rx = new RegExp("(^|[^a-z0-9])" + toPhraseRx(list[i]) + "([^a-z0-9]|$)", "i");
    if (rx.test(sample)) {
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

  const quoted = rewriteQuotedSpeechSafe(trimmed, name);
  if (quoted) {
    return (lead || "> ") + quoted;
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

function rewriteQuotedSpeech(body, name) {
  const text = String(body || "").trim();
  const quoteIndex = text.search(/["“]/);
  if (quoteIndex < 1) {
    return "";
  }

  const lead = text.slice(0, quoteIndex).trimEnd();
  const quoted = text.slice(quoteIndex);
  if (!isSpeechLead(lead)) {
    return "";
  }

  const cookedLead = rewriteDo(lead, name).replace(/\s+$/, "");
  return cookedLead + (/\s$/.test(cookedLead) || /^[,.;:!?]/.test(quoted) ? "" : " ") + quoted;
}

function isSpeechLead(text) {
  const lead = String(text || "").trim().replace(/[,:;.!?\s]+$/, "");
  if (!/^(?:you|i)\b/i.test(lead)) {
    return false;
  }
  return hasPhrase(lead, PS_SPEECH_VERBS);
}

function rewriteQuotedSpeechSafe(body, name) {
  const text = String(body || "").trim();
  const quoteIndex = findSpeechQuoteIndexSafe(text);
  if (quoteIndex < 1) {
    return "";
  }

  const lead = text.slice(0, quoteIndex).trimEnd();
  const quoted = text.slice(quoteIndex);
  if (!isSpeechLeadSafe(lead)) {
    return "";
  }

  const cookedLead = rewriteDo(lead, name).replace(/\s+$/, "");
  return cookedLead + (/\s$/.test(cookedLead) || /^[,.;:!?]/.test(quoted) ? "" : " ") + quoted;
}

function isSpeechLeadSafe(text) {
  const lead = String(text || "").trim().replace(/[,:;.!?\s]+$/, "");
  if (!/^(?:you|i)\b/i.test(lead)) {
    return false;
  }
  return hasPhrase(lead, PS_SPEECH_VERBS);
}

function findSpeechQuoteIndexSafe(text) {
  const sample = String(text || "");
  const doubleIndex = sample.search(/["“”]/);
  if (doubleIndex !== -1) {
    return doubleIndex;
  }

  for (let i = 0; i < sample.length; i += 1) {
    const ch = sample.charAt(i);
    if (ch !== "'" && ch !== "‘" && ch !== "’") {
      continue;
    }

    const prev = i > 0 ? sample.charAt(i - 1) : "";
    const next = i + 1 < sample.length ? sample.charAt(i + 1) : "";
    if (/[A-Za-z]/.test(prev) && /[A-Za-z]/.test(next)) {
      continue;
    }
    return i;
  }

  return -1;
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
  } else if (lower === "/psaros enable") {
    setEnabledState(ps, true);
    saveCfg(ps.cfg);
    saveSnapshot(ps, getTurn());
    reply = "PS enabled.";
  } else if (lower === "/psaros disable") {
    setEnabledState(ps, false);
    saveCfg(ps.cfg);
    saveSnapshot(ps, getTurn());
    reply = "PS disabled.";
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
      clearTask(ps);
      resetClock(ps);
      saveSnapshot(ps, getTurn());
      reply = "Focus switched to " + ps.rt.focus + ".";
    } else {
      reply = "PS is not configured yet. Fill in " + PS_CARD_TITLE + " first.";
    }
  } else if (lower === "/psaros focus primary") {
    ps.rt.focus = "primary";
    clearTask(ps);
    resetClock(ps);
    saveSnapshot(ps, getTurn());
    reply = "Focus set to primary.";
  } else if (lower === "/psaros focus secondary") {
    ps.rt.focus = "secondary";
    clearTask(ps);
    resetClock(ps);
    saveSnapshot(ps, getTurn());
    reply = "Focus set to secondary.";
  } else if (lower === "/psaros together") {
    ps.rt.together = true;
    ps.rt.manual = "together";
    clearTask(ps);
    resetClock(ps);
    saveSnapshot(ps, getTurn());
    reply = "Protagonists marked as together.";
  } else if (lower === "/psaros split") {
    ps.rt.together = false;
    ps.rt.manual = "separate";
    clearTask(ps);
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
    "Script active: " + String(ps.rt.enabled),
    "Primary: " + (ps.cfg.primaryName || "(blank)"),
    "Secondary: " + (ps.cfg.secondaryName || "(blank)"),
    "Focus: " + ps.rt.focus,
    "Together: " + String(ps.rt.together),
    "Presence lock: " + (ps.rt.manual || "auto"),
    "Task: " + (getActiveTask(ps) || "none") + (ps.rt.taskCd ? " (cooldown " + ps.rt.taskCd + ")" : ""),
    "Switch center/flex: " + ps.cfg.center + " +/- " + ps.cfg.flex,
    "Switch window: " + bounds.min + "-" + bounds.max,
    "Current target: " + ps.rt.target,
    "Current counter: " + ps.rt.turns,
    "Primary scene: " + (ps.roles.primary.scene || "(none)"),
    "Secondary scene: " + (ps.roles.secondary.scene || "(none)"),
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

function toPhraseRx(text) {
  return esc(String(text || "").toLowerCase()).replace(/\s+/g, "\\s+");
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

function sanitizeManual(value) {
  const lower = String(value || "").toLowerCase();
  if (lower === "together" || lower === "separate") {
    return lower;
  }
  return "";
}

function sanitizeTask(value) {
  const lower = String(value || "").toLowerCase();
  if (lower === PS_TASK_PRESENCE || lower === PS_TASK_THREAD) {
    return lower;
  }
  return PS_TASK_NONE;
}

function sanitizeTaskRole(value) {
  const lower = String(value || "").toLowerCase();
  if (lower === "primary" || lower === "secondary") {
    return lower;
  }
  return "";
}

function clearThreadState(role) {
  if (!role) {
    return;
  }

  role.scene = "";
  role.knows = "";
  role.next = "";
}

function roleNeedsThread(role) {
  return !(role && role.scene && role.knows && role.next);
}

function buildThreadField(ps, key, field) {
  const role = ps.roles[key];
  const fallback = buildThreadFallback(ps, key, field);
  const value = role && typeof role[field] === "string" ? role[field] : "";
  return value || fallback;
}

function buildThreadFallback(ps, key, field) {
  const role = ps.roles[key];
  const name = getFocusName(ps, key);
  const last = role && role.turns.length ? role.turns[role.turns.length - 1] : null;
  const note = role && (role.handoff || role.live) ? (role.handoff || role.live) : "";

  if (field === "scene") {
    return last && last.output
      ? clip(last.output, 160)
      : "Establish " + name + "'s immediate local scene from direct perception only.";
  }

  if (field === "knows") {
    return note
      ? clip(note, 180)
      : name + " knows only this thread's established local facts.";
  }

  if (field === "next") {
    if (last && last.output) {
      return "Follow the next local beat after: " + clip(last.output, 120);
    }
    return "Re-establish " + name + "'s immediate local beat.";
  }

  return "";
}

function buildOffstageNote(ps, key, entering) {
  const role = ps.roles[key];
  const name = getFocusName(ps, key);
  if (entering && !ps.rt.together) {
    return name + " stays offstage.";
  }

  const note = buildThreadNote(ps, key) || role.handoff || role.live;
  if (note) {
    return clip(note, 180);
  }
  return name + " remains offstage and should not automatically leak into the active local scene.";
}

function cleanThreadValue(value, max) {
  return clip(compact(String(value || ""), max), max);
}

function isThreadValueValid(thread) {
  if (!thread || !thread.scene || !thread.knows || !thread.next) {
    return false;
  }

  const joined = [thread.scene, thread.knows, thread.next].join(" ");
  if (/["“”]/.test(joined)) {
    return false;
  }
  if (/\b(?:ps_presence|ps_thread|ps_summary)\b/i.test(joined)) {
    return false;
  }
  return true;
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
    manual: ps.rt.manual,
    turns: ps.rt.turns,
    target: ps.rt.target
  });
}

function squeeze(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}
