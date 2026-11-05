/* Outing Planner — single-page frontend (no build step). */
"use strict";

// ------------------------------------------------------------------ utils --
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Case- and accent-insensitive key for name search: "Zoë"/"Zoe", "Îsla"/"isla" match.
const FOLD_EXTRA = { "ł": "l", "ø": "o", "đ": "d", "ß": "ss", "æ": "ae", "œ": "oe", "þ": "th", "ı": "i" };
const fold = (v) => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[łøđßæœþı]/g, (c) => FOLD_EXTRA[c]);
const tRange = (o) => (o && o.time ? (o.end_time ? `${o.time}–${o.end_time}` : o.time) : "");
async function loadPlaces(force = false) { if (!S.places || force) { try { S.places = await api("/api/places"); } catch { S.places = []; } } return S.places; }
const placesDatalist = (id) => `<datalist id="${id}">${(S.places || []).map((p) => `<option value="${esc(p.name)}">${esc(p.address)}</option>`).join("")}</datalist>`;
const SQUAD_SHORT = { open: "Open", women: "Women's" };
const SIDE_SHORT = { "Bow side only": "Bow only", "Bow side preferred": "Bow pref", "Equally happy": "Either side", "Stroke side preferred": "Stroke pref", "Stroke side only": "Stroke only" };
const DAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAYL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pd = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const iso = (dt) => dt.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = pd(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const dow = (s) => (pd(s).getUTCDay() + 6) % 7;
const fmtShort = (s) => { const d = pd(s); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
const fmtYear = (s) => `${fmtShort(s)} ${s.slice(0, 4)}`;
const fmtLong = (s) => `${DAYL[dow(s)]} ${fmtShort(s)}`;
const initials = (n) => (n || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

const I = {
  water: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 16c2 1.5 4 1.5 6 0s4-1.5 6 0 4 1.5 6 0"/><path d="M2 20c2 1.5 4 1.5 6 0s4-1.5 6 0 4 1.5 6 0"/><path d="M4 12l16-8"/><path d="M14 4l6 0 0 0"/></svg>',
  land: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 6.5h11M6.5 17.5h11"/><path d="M3 9v6M21 9v6M6 5v14M18 5v14M12 6.5v11"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-12a7 7 0 1 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  boat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 14c4 3 16 3 20 0"/><path d="M5 10l14 0"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
  swap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 16V4M7 4L3 8M7 4l4 4M17 8v12M17 20l4-4M17 20l-4-4"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>',
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>',
  whistle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="14" r="6"/><path d="M13 10l8-4v4l-6 2"/></svg>',
  trophy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
  flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22V4M4 4h13l-2 4 2 4H4"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/></svg>',
  todo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6h11M9 12h11M9 18h11"/><path d="M3.5 6l1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2"/></svg>',
  repeat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/></svg>',
  wand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8 19 13M17.8 6.2 19 5M3 21l9-9M12.2 6.2 11 5"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 15v2"/><path d="M11 10v7"/><path d="M15 6v11"/><path d="M19 12v5"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
  history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>',
  lifebuoy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M5.6 5.6l3.6 3.6M14.8 14.8l3.6 3.6M14.8 9.2l3.6-3.6M5.6 18.4l3.6-3.6"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
};

const S = {
  role: null, boot: null, week: null, weekData: null, filter: "all",
  me: (() => { try { return Number(localStorage.getItem("op_me")) || null; } catch { return null; } })(),
  openSubs: 0,
  realRole: null, // the signed-in role; S.role is the one the site currently renders as
  viewAsRower: (() => { try { return localStorage.getItem("op_view_rower") === "1"; } catch { return false; } })(),
};
const setMe = (id) => {
  const changed = id !== S.me;
  S.me = id; try { id ? localStorage.setItem("op_me", String(id)) : localStorage.removeItem("op_me"); } catch {}
  if (changed) id ? pushSync() : pushDisable(); // notifications follow whoever is picked on this device
};
const meName = () => S.boot?.members.find((m) => m.id === S.me)?.name;
const isCommittee = () => S.role === "committee";

async function api(path, opts = {}) {
  const init = { method: opts.method || "GET", headers: {}, credentials: "same-origin" };
  if (S.realRole === "committee" && S.viewAsRower) init.headers["X-View-As"] = "member";
  if (S.me) init.headers["X-Acting-As"] = String(S.me); // the name picked on this device, for the crew change log
  if (opts.body instanceof FormData) init.body = opts.body;
  else if (opts.body instanceof Blob) { init.body = opts.body; init.headers["Content-Type"] = opts.body.type || "application/octet-stream"; }
  else if (opts.body !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(opts.body); }
  const r = await fetch(path, init);
  if (r.status === 401 && path !== "/api/login") { S.role = S.realRole = null; renderLogin(); throw new Error("Signed out"); }
  const ct = r.headers.get("content-type") || "";
  const data = ct.includes("json") ? await r.json() : await r.text();
  if (!r.ok) {
    const d = data && data.detail;
    const err = new Error(typeof d === "string" ? d : d?.problems ? d.problems.join(". ") : `Error ${r.status}`);
    err.status = r.status; err.detail = d;
    throw err;
  }
  return data;
}

function toast(msg, bad = false) {
  const t = document.createElement("div");
  t.className = "toast" + (bad ? " bad" : "");
  t.textContent = msg;
  $("#toasts").appendChild(t);
  setTimeout(() => t.remove(), 3200);
}
const fail = (e) => toast(e.message || String(e), true);

// ------------------------------------------------------------------ modal --
function modal({ title, body, foot = "", wide = false, onMount }) {
  const root = $("#modal-root");
  root.innerHTML = `<div class="overlay"><div class="modal ${wide ? "wide" : ""} ${wide === "xl" ? "xl" : ""}" role="dialog" aria-modal="true">
    <div class="modal-head"><h2>${title}</h2><button class="btn ghost icon" data-close aria-label="Close">${I.x}</button></div>
    <div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ""}</div></div>`;
  const ov = $(".overlay", root);
  const close = () => { root.innerHTML = ""; document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape" && !$(".combo-list", root)) close(); };
  document.addEventListener("keydown", onKey);
  ov.addEventListener("mousedown", (e) => { if (e.target === ov) close(); });
  $$("[data-close]", root).forEach((b) => b.addEventListener("click", close));
  const m = $(".modal", root);
  onMount && onMount(m, close);
  const f = $("input:not([type=hidden]):not([readonly]), textarea, select", m);
  if (f && !("ontouchstart" in window)) f.focus();
  return { el: m, close };
}

function confirmBox(title, text, okLabel = "Confirm", danger = false) {
  return new Promise((res) => {
    modal({
      title, body: `<p style="margin:0">${text}</p>`,
      foot: `<div class="r"><button class="btn" data-close>Cancel</button><button class="btn ${danger ? "danger" : "primary"}" id="cf-ok">${okLabel}</button></div>`,
      onMount: (m, close) => {
        $("#cf-ok", m).onclick = () => { close(); res(true); };
        $$("[data-close]", m).forEach((b) => b.addEventListener("click", () => res(false)));
      },
    });
  });
}

// --------------------------------------------------------------- combobox --
/* items: [{id, label, sub, cls, rank}] — returns controller */
function combo(container, { items, value, placeholder = "Search…", onChange, renderWhy }) {
  container.classList.add("combo");
  container.innerHTML = `<input class="input" autocomplete="off" placeholder="${esc(placeholder)}"><button type="button" class="clear" tabindex="-1" aria-label="Clear">×</button>`;
  const inp = $("input", container), clr = $(".clear", container);
  let list = null, hl = 0, cur = value ?? null, shown = [];
  const byId = () => new Map(items().map((i) => [i.id, i]));
  const sync = () => {
    const it = cur != null ? byId().get(cur) : null;
    inp.value = it ? it.label : "";
    clr.style.display = it ? "" : "none";
    inp.classList.remove("bad", "warn");
    if (it && it.cls) inp.classList.add(it.cls);
  };
  const close = () => { list?.remove(); list = null; };
  const draw = () => {
    const q = fold(inp.value.trim());
    const curLabel = cur != null ? fold(byId().get(cur)?.label) : null;
    const query = q && q !== curLabel ? q : "";
    shown = items().filter((i) => !query || fold(i.label).includes(query))
      .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0) || a.label.localeCompare(b.label)).slice(0, 80);
    hl = Math.min(hl, Math.max(0, shown.length - 1));
    if (!list) { list = document.createElement("div"); list.className = "combo-list"; container.appendChild(list); }
    list.innerHTML = shown.length ? shown.map((i, k) => `<div class="combo-item ${k === hl ? "hl" : ""} ${i.dim ? "dim" : ""}" data-k="${k}"><span class="nm">${esc(i.label)}</span><span class="why">${renderWhy ? renderWhy(i) : ""}</span></div>`).join("")
      : `<div class="combo-empty">No matches</div>`;
    $$(".combo-item", list).forEach((el) => el.addEventListener("mousedown", (e) => { e.preventDefault(); pick(shown[+el.dataset.k]); }));
    const h = $(".hl", list); h && h.scrollIntoView({ block: "nearest" });
  };
  const pick = (it) => { cur = it ? it.id : null; sync(); close(); onChange && onChange(cur); inp.blur(); };
  inp.addEventListener("focus", () => { inp.select(); hl = 0; draw(); });
  inp.addEventListener("input", () => { hl = 0; draw(); });
  inp.addEventListener("blur", () => setTimeout(() => { close(); sync(); }, 120));
  inp.addEventListener("keydown", (e) => {
    if (!list && (e.key === "ArrowDown" || e.key === "Enter")) { draw(); return; }
    if (e.key === "ArrowDown") { hl = Math.min(hl + 1, shown.length - 1); draw(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { hl = Math.max(hl - 1, 0); draw(); e.preventDefault(); }
    else if (e.key === "Enter") { e.preventDefault(); if (shown[hl]) pick(shown[hl]); }
    else if (e.key === "Escape") { e.stopPropagation(); close(); inp.blur(); }
  });
  clr.addEventListener("click", () => pick(null));
  sync();
  return { get: () => cur, set: (v) => { cur = v; sync(); }, refresh: sync };
}

// ------------------------------------------------------------------ login --
function renderLogin() {
  $("#modal-root").innerHTML = "";
  $("#app").innerHTML = `<div class="login-wrap"><div class="card login">
    <img class="crest" src="/static/crest.png" alt="Reuben College crest">
    <h1>Reuben Boat Club</h1><p class="sub">University of Oxford · Outing planner</p>
    <form id="login-form">
      <label class="field"><span>Password</span><input class="input" type="password" name="password" autocomplete="current-password" required autofocus></label>
      <div class="err" id="login-err"></div>
      <button class="btn primary" type="submit">Sign in</button>
      <p class="faint small" style="margin:4px 0 0;text-align:center">Rowers and the committee use different passwords.</p>
    </form></div><div class="login-foot">Reuben College · Oxford</div></div>`;
  $("#login-form").onsubmit = async (e) => {
    e.preventDefault();
    const pw = e.target.password.value;
    try {
      const r = await api("/api/login", { method: "POST", body: { password: pw } });
      S.role = S.realRole = r.role;
      S.viewAsRower = false; try { localStorage.removeItem("op_view_rower"); } catch {}
      await start();
    } catch (err) { $("#login-err").textContent = err.message; }
  };
}

// ------------------------------------------------------------------ shell --
/* Top-level menu items, plus child pages (`parent`) that appear as tabs above the page.
   Child pages keep their own URL, so old links like #/subs still work. */
const ROUTES = [
  { id: "schedule", label: "Schedule", tab: "Week", icon: I.calendar },
  { id: "subs", label: "Sub board", parent: "schedule", icon: I.swap, count: "subs" },
  { id: "signup", label: "Sign up", committeeLabel: "Sign-ups", icon: I.calendar },
  { id: "races", label: "Races", icon: I.flag },
  { id: "me", label: "My outings", icon: I.user },
  { id: "stats", label: "Leaderboard", parent: "me", icon: I.trophy },
  { id: "rowers", label: "Rowers", tab: "Members", icon: I.user },
  { id: "reminders", label: "Subs reminders", parent: "rowers", icon: I.user, committee: true, count: "reminders" },
  { id: "boats", label: "Boat park", tab: "Boats", icon: I.boat },
  { id: "issues", label: "Issues", parent: "boats", icon: I.alert, count: "issues" },
  { id: "usage", label: "Usage", parent: "boats", icon: I.chart },
  { id: "incidents", label: "Incidents", parent: "boats", icon: I.lifebuoy, count: "incidents" },
  { id: "committee", label: "Committee", tab: "Overview", icon: I.users },
  { id: "todo", label: "To-do", parent: "committee", icon: I.todo, committee: true, count: "todo" },
  { id: "handbook", label: "Handbook", parent: "committee", icon: I.info, committee: true },
  { id: "coaches", label: "Coaches", parent: "committee", icon: I.whistle, committee: true },
  { id: "handover", label: "Handover", parent: "committee", icon: I.repeat, committee: true },
  { id: "settings", label: "Settings", icon: I.gear, committee: true, gear: true },
];
S.counts = {};
const routeAllowed = (r) => !r.committee || isCommittee();
const topOf = (r) => (r.parent ? ROUTES.find((x) => x.id === r.parent) : r);
const countBadge = (key, cls = "count") => `<span class="${cls}" data-count="${key}"${S.counts[key] ? "" : " hidden"}>${S.counts[key] || ""}</span>`;
/* Update a badge everywhere it appears (menu, phone menu button, tabs) without re-rendering the page. */
function setCount(key, n) {
  S.counts[key] = n;
  $$(`[data-count="${key}"]`).forEach((el) => { el.textContent = n || ""; el.hidden = !n; });
}
/* Navigate without the hashchange handler (which would close an open modal); returns once the page has rendered. */
function go(id) { if (location.hash !== `#/${id}`) history.pushState(null, "", `#/${id}`); return route(); }
const rerender = () => (S.page ? S.page() : route());

const routeLabel = (r) => (isCommittee() && r.committeeLabel) || r.label;
function setNavOpen(open) {
  const bar = $(".topbar"), t = $("#nav-toggle");
  if (!bar || !t) return;
  bar.classList.toggle("nav-open", open);
  t.setAttribute("aria-expanded", String(open));
}
// Close the phone page menu on Escape or a tap outside the header.
document.addEventListener("keydown", (e) => { if (e.key === "Escape") setNavOpen(false); });
document.addEventListener("click", (e) => { if (!e.target.closest(".topbar")) setNavOpen(false); });

function shell(active) {
  const routes = ROUTES.filter((r) => !r.parent && !r.gear && routeAllowed(r));
  const here = ROUTES.find((r) => r.id === active) || ROUTES[0];
  const top = topOf(here);
  const cur = top.gear ? here : top;
  const name = meName();
  // A top-level item shows the count of its child tabs (e.g. Schedule shows open subs).
  const kidCount = (r) => ROUTES.filter((k) => k.parent === r.id && k.count && routeAllowed(k)).map((k) => countBadge(k.count)).join("");
  const tabs = ROUTES.filter((r) => (r.id === top.id || r.parent === top.id) && routeAllowed(r));
  $("#app").innerHTML = `
  <header class="topbar"><div class="topbar-inner">
    <a class="brand" href="#/schedule" style="color:inherit"><img class="brand-mark" src="/static/crest.png" alt=""><div>${esc(S.boot.club_name || "Reuben Boat Club")}<small>Outing planner · Oxford</small></div></a>
    <button class="nav-toggle" id="nav-toggle" aria-expanded="false" aria-controls="main-nav"><span class="nav-ic">${cur.icon}</span><span class="nav-cur">${esc(routeLabel(cur))}</span>${countBadge("subs")}<span class="chev">${I.down}</span></button>
    <nav class="nav" id="main-nav">${routes.map((r) => `<a href="#/${r.id}" class="${r.id === top.id ? "active" : ""}"${r.id === top.id ? ` aria-current="page"` : ""}><span class="nav-ic">${r.icon}</span><span class="nav-l">${esc(routeLabel(r))}</span>${kidCount(r)}</a>`).join("")}
      ${isCommittee() ? `<a href="#/settings" class="nav-settings ${active === "settings" ? "active" : ""}"><span class="nav-ic">${I.gear}</span><span class="nav-l">Settings</span></a>` : ""}</nav>
    <div class="top-actions">
      ${S.realRole === "committee" ? `<button class="role-badge ${S.viewAsRower ? "rower" : ""}" id="view-toggle" title="${S.viewAsRower ? "Viewing as a rower — switch back to the committee view" : "Switch to the rower view"}" aria-pressed="${S.viewAsRower}">${S.viewAsRower ? "Rower" : "Committee"}</button>` : ""}
      ${isCommittee() ? `<a class="btn ghost icon top-gear ${active === "settings" ? "on" : ""}" href="#/settings" title="Settings" aria-label="Settings">${I.gear}</a>` : ""}
      <button class="me-chip" id="me-chip" title="Choose who you are">${name ? `<span class="avatar">${esc(initials(name))}</span><span class="n">${esc(name)}</span>` : `<span class="avatar" style="background:var(--surface-3);color:var(--text-3)">?</span><span class="n">Who are you?</span>`}</button>
      <button class="btn ghost icon" id="logout" title="Sign out">${I.logout}</button>
    </div>
  </div></header>
  ${tabs.length > 1 ? `<div class="subnav"><nav class="subnav-inner" aria-label="${esc(routeLabel(top))}">${tabs.map((r) => `<a href="#/${r.id}" class="${r.id === active ? "on" : ""}"${r.id === active ? ` aria-current="page"` : ""}>${esc(r.tab || r.label)}${r.count ? countBadge(r.count, "count-pill") : ""}</a>`).join("")}</nav></div>` : ""}
  <div id="race-banner"></div>
  <main class="main" id="main"><div class="spinner"></div></main>`;
  renderRaceBanner();
  $("#nav-toggle").onclick = (e) => { e.stopPropagation(); setNavOpen(!$(".topbar").classList.contains("nav-open")); };
  $("#main-nav").onclick = () => setNavOpen(false);
  $("#me-chip").onclick = () => pickIdentity();
  const vt = $("#view-toggle"); if (vt) vt.onclick = () => setViewAsRower(!S.viewAsRower);
  $("#logout").onclick = async () => { await pushDisable(); await api("/api/logout", { method: "POST" }).catch(() => {}); S.role = S.realRole = null; renderLogin(); };
}

/* Expiry chip for a dated swim test / cox status ({date, expires, state} from the server). */
function expiryChip(e, label) {
  if (!e || !e.state) return "";
  if (e.state === "expired") return `<span class="chip bad" title="${esc(label)} expired ${esc(fmtYear(e.expires))}">${I.alert}Expired</span>`;
  if (e.state === "soon") return `<span class="chip warn" title="${esc(label)} expires ${esc(fmtYear(e.expires))}">Expires ${esc(fmtYear(e.expires))}</span>`;
  return "";
}

/* Committee only: entries for a race are about to close. Shown when you log in / open the app, and again after 2h away; dismissable. */
function renderRaceBanner() {
  const el = $("#race-banner"); if (!el) return;
  const show = isCommittee() && S.raceBanner;
  const list = show ? (S.boot.races_closing || []) : [];
  const exp = show ? (S.boot.expiring || []) : [];
  if (!list.length && !exp.length) { el.innerHTML = ""; return; }
  const left = (h) => h < 1 ? "in under an hour" : h < 24 ? `in ${Math.round(h)} hour${Math.round(h) === 1 ? "" : "s"}` : `in ${Math.round(h / 24)} day${Math.round(h / 24) === 1 ? "" : "s"}`;
  const what = { swim: "Swim test", cox: "Cox status" };
  const expLine = (x) => `<span class="small">${esc(x.name)} — ${what[x.what]} ${x.state === "expired" ? "expired" : "expires"} ${esc(fmtYear(x.expires))}</span>`;
  const urgent = (list[0] && list[0].hours_left < 48) || exp.some((x) => x.state === "expired");
  const MAX = 5;
  el.innerHTML = `<div class="race-banner ${urgent ? "urgent" : ""}" role="status">${I.alert}
    <div class="flag-body">
      ${list.length ? `<b>Race entries closing soon</b>${list.map((r) => `<span class="small">${esc(r.title)} — closes ${esc(fmtDT(r.closes_at))} (${left(r.hours_left)})</span>`).join("")}` : ""}
      ${exp.length ? `<b${list.length ? ' style="margin-top:6px"' : ""}>Swim tests and cox statuses to renew</b>${exp.slice(0, MAX).map(expLine).join("")}${exp.length > MAX ? `<span class="small muted">and ${exp.length - MAX} more</span>` : ""}` : ""}
    </div>
    <div class="flag-actions">${list.length ? `<a class="btn sm" href="#/races">Races</a>` : ""}${exp.length ? `<a class="btn sm" href="#/rowers" id="rb-exp">Members</a>` : ""}<button class="btn ghost sm" id="rb-x">Dismiss</button></div></div>`;
  $("#rb-x").onclick = () => { S.raceBanner = false; renderRaceBanner(); };
  const rbe = $("#rb-exp"); if (rbe) rbe.onclick = () => { rowerCat = "expiring"; };
}

let hiddenAt = 0;
document.addEventListener("visibilitychange", async () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (!S.role || !hiddenAt || Date.now() - hiddenAt < 2 * 3600 * 1000) return;
  try { await reboot(); } catch { return; }
  S.raceBanner = true; renderRaceBanner();
});

function pickIdentity(after) {
  const members = S.boot.members;
  modal({
    title: "Who are you?",
    body: `<p class="muted" style="margin:0">Pick your name so the planner can highlight your seats and let you request or offer subs. This is remembered on this device.</p>
      <input class="input" id="pi-q" placeholder="Search names…">
      <div class="pick-list" id="pi-list"></div>`,
    foot: S.me ? `<button class="btn ghost" id="pi-clear">Forget me on this device</button>` : "",
    onMount: (m, close) => {
      const draw = () => {
        const q = fold($("#pi-q", m).value.trim());
        $("#pi-list", m).innerHTML = members.filter((x) => !q || fold(x.name).includes(q)).map((x) =>
          `<button data-id="${x.id}"><span>${esc(x.name)}</span><span class="chip ${x.category === "Novice" ? "accent" : ""}">${esc(x.category)}</span></button>`).join("")
          || `<div class="faint" style="padding:10px">No one found — ask a committee member to add you.</div>`;
        $$("#pi-list button", m).forEach((b) => b.onclick = () => { setMe(+b.dataset.id); close(); toast(`Hi, ${meName().split(" ")[0]}!`); after ? after() : route(); });
      };
      $("#pi-q", m).oninput = draw; draw();
      const c = $("#pi-clear", m); if (c) c.onclick = () => { setMe(null); close(); route(); };
    },
  });
}

function requireMe(fn) { if (S.me && meName()) fn(); else pickIdentity(fn); }

// --------------------------------------------------------------- schedule --
function seatRow(o, s, extra = "") {
  const m = s.member;
  const mine = m && m.id === S.me;
  const cls = ["seat"];
  if (!m) cls.push("open");
  if (m && isCommittee() && s.eligibility && !s.eligibility.ok) cls.push("bad");
  if (mine) cls.push("me");
  if (s.sub_request) cls.push("subreq");
  let tag = "";
  const subTag = s.subbed_for ? `<span class="tag violet" title="Subbing for ${esc(s.subbed_for)}">sub</span>` : "";
  if (s.sub_request) tag = `<button class="tag warn" data-act="fill" data-sub="${s.sub_request.id}" title="${esc(s.sub_request.reason || "Sub needed")}">Sub needed</button>`;
  // Land sessions are open: you just leave, the spot reopens for anyone.
  else if (mine && !o.past && !o.cancelled && o.kind === "land") tag = `<span class="tags">${subTag}<button class="tag ok" data-act="leave" title="Give up your spot">Leave</button></span>`;
  // Your own seat always offers "Can't go" — including a seat you took as a sub.
  else if (mine && !o.past && !o.cancelled) tag = `<span class="tags">${subTag}<button class="tag ok" data-act="reqsub" data-o="${o.id}" title="Can't make it? Request a sub">Can't go</button></span>`;
  else tag = subTag;
  const title = m && isCommittee() && s.eligibility ? (s.eligibility.reasons.join(", ") || s.eligibility.note || "") : "";
  return `<div class="${cls.join(" ")}" title="${esc(title)}"><span class="sl">${esc(({ Stroke: "S", Bow: "B", Sculler: "1x" })[s.label] || s.label)}</span><span class="sn">${m ? esc(m.name) : "Open"}</span>${tag}${extra ? `<span class="seat-extra">${extra}</span>` : ""}</div>`;
}

/* Land sessions: list who's in, then the open spots anyone can take. */
function landSpots(o) {
  const inIt = o.seats.filter((s) => s.member);
  const mine = inIt.some((s) => s.member.id === S.me);
  const join = o.spots > 0 && !o.past && !o.cancelled && !mine;
  return `<div class="seats">${inIt.map((s, i) => seatRow(o, { ...s, label: String(i + 1) })).join("") || `<div class="seat open"><span class="sl"></span><span class="sn">No one yet. Be the first!</span></div>`}</div>
    ${o.spots || join || (mine && !o.past && !o.cancelled) ? `<div class="o-foot land-open">
      ${o.spots ? `<span class="chip accent">${esc(o.spots_text)} of ${o.capacity}</span>` : "<span></span>"}
      ${join ? `<button class="btn sm primary" data-act="join" title="Take a spot in this session">${I.plus}Join</button>` : mine && !o.past && !o.cancelled ? `<span class="chip ok">${I.check}You're in</span>` : ""}
    </div>` : ""}`;
}

function joinLand(o) {
  requireMe(async () => {
    try {
      await api(`/api/outings/${o.id}/join`, { method: "POST", body: { member_id: S.me } });
      toast(`You're in: ${o.title || "Land training"}, ${DAY[dow(o.date)]} ${fmtShort(o.date)}${o.time ? " " + tRange(o) : ""}`);
      route();
    } catch (e) { fail(e); }
  });
}
async function leaveLand(o) {
  if (!await confirmBox("Leave this session?", `Your spot in <b>${esc(o.title || "Land training")}</b> on ${fmtLong(o.date)} opens up for someone else.`, "Leave")) return;
  try { await api(`/api/outings/${o.id}/leave`, { method: "POST", body: { member_id: S.me } }); toast("You've left the session"); route(); } catch (e) { fail(e); }
}

// ------------------------------------------------------------ river rules --
const riverList = (items) => items.length ? `<div class="river-list">${items.map((r) =>
  `<div class="${r.level === "stop" ? "stop" : "warn"}">${r.level === "stop" ? I.alert : I.info}<span>${esc(r.text)}</span></div>`).join("")}</div>` : "";
const fmtStamp = (isoStr) => { if (!isoStr) return ""; const d = new Date(isoStr); return isNaN(d) ? "" : d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); };

function flagBanner(f, actions = true) {
  if (!f) return "";
  const notices = (f.notices || []).filter(Boolean);
  return `<div class="flag-banner" style="--flag:${esc(f.colour)}">
    <span class="flag-swatch" aria-hidden="true"></span>
    <div class="flag-body">
      <div><b>Isis flag: ${esc(f.name)}</b>${f.set_date ? ` <span class="faint small">· set ${esc(fmtStamp(f.set_date))}</span>` : ""}${f.stale ? ` <span class="chip warn">may be out of date</span>` : ""}</div>
      <div class="small muted">${esc(notices.length ? notices.join(" ") : f.summary)}</div>
    </div>
    ${actions ? `<div class="flag-actions"><button class="btn sm" id="flag-rules">River rules</button><a class="btn sm ghost" href="${esc(f.page)}" target="_blank" rel="noopener">OURCs</a></div>` : ""}
  </div>`;
}

/* Compact flag indicator for the schedule's tab row; click opens the full details. */
function flagPill(f) {
  if (!f) return "";
  return `<button class="flag-pill" id="flag-rules" style="--flag:${esc(f.colour)}" title="Isis flag: ${esc(f.name)}${f.stale ? " (may be out of date)" : ""}. Tap for details and river rules.">
    <span class="flag-swatch" aria-hidden="true"></span>Isis flag${f.stale ? ` <span class="flag-stale" aria-label="may be out of date">!</span>` : ""}</button>`;
}

async function riverModal() {
  let d;
  try { d = await api("/api/river"); } catch (e) { return fail(e); }
  const R = d.rules, f = d.flag, order = ["green", "light_blue", "dark_blue", "amber", "red", "black", "grey"];
  const ul = (xs) => `<ul class="rules-ul">${xs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
  const t = d.term;
  modal({
    title: "River rules · Isis", wide: true,
    body: `
      ${flagBanner(f, false)}
      <p class="small muted">Today: sunrise ${esc(d.today.sunrise)}, sunset ${esc(d.today.sunset)}, so boats may be on the water from <b>${esc(d.today.first)}</b> to <b>${esc(d.today.last)}</b>.
        ${t.week != null ? `${esc(d.current_term)} week ${t.week}${t.peak ? " · <b>peak term</b>" : ""}.` : ""}
        Flag checked ${esc(fmtStamp(f.checked_at) || "never")}, every hour.</p>
      <h3 class="rules-h">Flags</h3>
      <p class="small muted">${esc(R.stream)} The flag sets the minimum experience of crews allowed out, but it doesn't mean it's safe to go out.</p>
      <div class="flag-table">${order.map((k) => `<div class="flag-row ${k === f.key ? "on" : ""}"><span class="flag-dot" style="background:${esc(d.flags[k].colour)}"></span>
        <div><b>${esc(d.flags[k].name)}</b>${k === f.key ? ` <span class="chip ok">Now</span>` : ""}${ul(R.flags[k])}</div></div>`).join("")}</div>
      <p class="small muted">${esc(R.senior_crew)}</p>
      <h3 class="rules-h">Times</h3>${ul([...R.general, ...R.isis])}
      <h3 class="rules-h">Peak term</h3>${ul(R.peak)}
      <h3 class="rules-h">Also</h3>${ul(R.other)}
      <p class="small"><a href="${esc(d.rules_page)}" target="_blank" rel="noopener">Full river restrictions on the OURCs website</a> · <a href="${esc(f.page)}" target="_blank" rel="noopener">Flag history</a></p>`,
    foot: `<div class="r"><button class="btn primary" data-close>Close</button></div>`,
  });
}

// Why a session was cancelled — keep in sync with logic.CANCEL_REASONS.
const CANCEL_REASONS = [["flag", "Red flag"], ["weather", "Weather"], ["bankrider", "No bankrider"], ["numbers", "Too few people"], ["other", "Other"]];
const LOST_TO = { flag: "the Red flag", weather: "the weather", bankrider: "having no bankrider", numbers: "too few people", other: "other reasons" };
const cancelText = (o) => [o.cancel_label, o.cancel_reason].filter(Boolean).join(" · ");

async function setOutingStatus(o, status, extra = {}) {
  await api(`/api/committee/outings/${o.id}/status`, { method: "POST", body: { status, ...extra } });
  toast(status === "cancelled" ? "Session cancelled" : "Session restored");
  pageSchedule();
}

/* Committee: cancel a session with a reason (red flag, weather, ...). It stays on the schedule. */
function cancelOuting(o) {
  const flag = S.weekData && S.weekData.river && S.weekData.river.flag;
  let cat = o.kind === "water" && flag && ["red", "black"].includes(flag.key) ? "flag" : "";
  modal({
    title: "Cancel this session?",
    body: `<p style="margin:0 0 12px">It stays on the schedule marked as cancelled, with its crew, but won't count towards anyone's outings or the stats. Open sub requests are closed.</p>
      <div class="field"><span>Reason</span><div class="reason-pick" id="oc-cat">${CANCEL_REASONS.map(([k, l]) => `<button type="button" data-k="${k}" class="${cat === k ? "on" : ""}">${esc(l)}</button>`).join("")}</div></div>
      <label class="field"><span>Note</span><input class="input" id="oc-reason" maxlength="200" placeholder="Optional, shown to rowers. E.g. stream too strong"></label>`,
    foot: `<div class="r"><button class="btn" data-close>Keep session</button><button class="btn danger" id="oc-ok" ${cat ? "" : "disabled"}>${I.x}Cancel session</button></div>`,
    onMount: (m, close) => {
      $$("#oc-cat button", m).forEach((b) => b.onclick = () => {
        cat = b.dataset.k;
        $$("#oc-cat button", m).forEach((x) => x.classList.toggle("on", x === b));
        $("#oc-ok", m).disabled = false;
      });
      $("#oc-ok", m).onclick = async () => {
        try { await setOutingStatus(o, "cancelled", { category: cat, reason: $("#oc-reason", m).value }); close(); } catch (e) { fail(e); }
      };
    },
  });
}

/* Footer tags for a water outing: only things that need attention (empty seats, missing cox or bankrider,
   cox status not set). A full crew with a fine cox shows nothing. */
const COX_ATTENTION = { "Bankrider needed": "bad", "Cox needed": "warn", "Cox status not set": "warn" };
function waterFoot(o) {
  const tags = [];
  if (o.spots_text !== "Full") tags.push(`<span class="chip warn">${esc(o.spots_text)}</span>`);
  if (COX_ATTENTION[o.cox_check] && o.cox_check !== o.spots_text) tags.push(`<span class="chip ${COX_ATTENTION[o.cox_check]}">${esc(o.cox_check)}</span>`);
  return tags.length ? `<div class="o-foot">${tags.join("")}</div>` : "";
}

/* Crew change log: who left, joined or swapped a seat, and when ("Alex left seat 3 · Tue 21:04"). */
const logWhen = (s) => {
  if (!s) return "";
  const d = new Date(s.replace(" ", "T") + "Z");
  if (isNaN(d)) return "";
  const hm = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const days = (Date.now() - d) / 86400000;
  return days < 6 ? `${DAY[(d.getDay() + 6) % 7]} ${hm}` : `${d.getDate()} ${MON[d.getMonth()]} ${hm}`;
};
const logBy = (e) => !e.by ? "" : e.source === "undo" ? `undo by ${e.by}` : `by ${e.by}`;
const logLine = (e) => [esc(e.text), e.note ? `“${esc(e.note)}”` : "", esc(logBy(e)), esc(logWhen(e.created_at))].filter(Boolean).join(" · ");
function crewLogList(o, undo = false) {
  const log = (o.log || []).slice().reverse();
  if (!log.length) return "";
  return `<div class="section-title" style="margin:16px 0 6px">${I.history}Changes</div>
    <ul class="crew-log">${log.map((e) => `<li class="${e.undone_at ? "undone" : ""}">
      <span class="cl-text">${logLine(e)}${e.undone_at ? ` <span class="chip">Undone${e.undone_by ? ` by ${esc(e.undone_by)}` : ""}</span>` : ""}</span>
      ${undo && !e.undone_at ? `<button type="button" class="btn sm ghost" data-undo="${e.id}" title="Reverse this change">Undo</button>` : ""}</li>`).join("")}</ul>`;
}
const crewLogLatest = (o) => {
  const log = o.log || [];
  if (!log.length) return "";
  const e = log[log.length - 1];
  return `<div class="o-log small" title="Tap the session to see all changes">${I.history}<span>${logLine(e)}${log.length > 1 ? ` <span class="faint">· ${log.length} changes</span>` : ""}</span></div>`;
};

function outingCard(o) {
  const committee = isCommittee();
  const kindChip = o.kind === "water" ? `<span class="chip water">${I.water}Water</span>` : `<span class="chip land">${I.land}Land</span>`;
  return `<article class="card outing ${o.kind} ${o.published ? "" : "draft"} ${o.past ? "past" : ""} ${o.cancelled ? "cancelled" : ""} clickable" data-oid="${o.id}">
    <div class="o-top"><div>${o.time ? `<div class="o-time tnum">${esc(tRange(o))}</div><div class="o-title">${esc(o.title || (o.kind === "water" ? "Water outing" : "Land training"))}</div>` : `<div class="o-time">${esc(o.title || (o.kind === "water" ? "Water outing" : "Land training"))}</div><div class="o-title faint small">Time TBC</div>`}</div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">${kindChip}${o.cancelled ? `<span class="chip bad">Cancelled</span>` : ""}${committee && !o.published ? `<span class="chip">Draft</span>` : ""}</div></div>
    ${o.cancelled ? `<div class="o-cancel">${I.x}<span>${esc(cancelText(o) || "This session has been cancelled")}</span></div>` : ""}
    <div class="o-sub">
      ${o.boat ? `<span>${I.boat}${esc(o.boat.name)} <span class="faint">${esc(o.boat.type)}</span></span>` : o.kind === "water" ? `<span class="faint">${I.boat}${o.capacity}${o.coxed ? "+" : ""} · no boat set</span>` : ""}
      ${o.location ? (o.maps_url ? `<a href="${esc(o.maps_url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="Open in maps">${I.pin}${esc(o.location)}</a>` : `<span>${I.pin}${esc(o.location)}</span>`) : ""}
      ${o.coach ? `<span>${I.whistle}${esc(o.coach)}</span>` : ""}
    </div>
    ${o.kind === "land" ? landSpots(o) : `<div class="seats">${o.seats.map((s) => seatRow(o, s)).join("")}</div>
    ${o.cancelled ? "" : waterFoot(o)}`}
    ${crewLogLatest(o)}
    ${o.notes ? `<div class="small muted" style="margin-top:6px">${esc(o.notes)}</div>` : ""}
    ${committee && o.warnings.length ? `<div class="warnings">${o.warnings.map((w) => `<div>${I.alert}<span>${esc(w)}</span></div>`).join("")}</div>` : ""}
    ${riverList((o.river || []).filter((r) => !o.past && (committee || r.level === "stop")))}
  </article>`;
}

async function pageSchedule() {
  if (!S.week) S.week = isCommittee() ? addDays(S.boot.this_week, 0) : S.boot.this_week;
  const main = $("#main");
  let data;
  try { data = await api(`/api/week?start=${S.week}`); } catch (e) { return fail(e); }
  S.weekData = data;
  const committee = isCommittee();
  const end = addDays(data.start, 6);
  const isThis = data.start === S.boot.this_week;
  const pubState = data.total === 0 ? "" : data.published === data.total
    ? `<span class="status-pill" style="background:var(--ok-soft);color:var(--ok)"><span class="dot"></span>Published</span>`
    : data.published === 0 ? `<span class="status-pill" style="background:var(--surface-3);color:var(--text-2)"><span class="dot"></span>Draft — not visible to rowers</span>`
    : `<span class="status-pill" style="background:var(--warn-soft);color:var(--warn)"><span class="dot"></span>${data.published}/${data.total} published</span>`;
  const outs = data.outings.filter((o) => S.filter === "all" || (S.filter === "mine" ? o.seats.some((s) => s.member && s.member.id === S.me) : S.filter === "subs" ? o.open_subs > 0 : S.filter === "open" ? (o.kind === "land" && o.spots > 0 && !o.past && !o.cancelled) : o.kind === S.filter));
  const myCount = data.outings.filter((o) => o.seats.some((s) => s.member && s.member.id === S.me)).length;
  main.innerHTML = `
    <div class="page-head">
      <div><h1>${isThis ? "This week" : data.start > S.boot.this_week ? (addDays(S.boot.this_week, 7) === data.start ? "Next week" : "Upcoming week") : "Past week"}</h1>
        <p>${fmtShort(data.start)} – ${fmtShort(end)} ${pd(end).getUTCFullYear()} · ${S.boot.settings.current_term} ${esc(S.boot.settings.academic_year)} ${committee && pubState ? "&nbsp;" + pubState : ""}</p></div>
      <div class="toolbar">
        <div class="weekbar">
          <button class="btn icon" id="wk-prev" title="Previous week">${I.left}</button>
          <button class="btn" id="wk-today" ${isThis ? "disabled" : ""}>Today</button>
          <button class="btn icon" id="wk-next" title="Next week">${I.right}</button>
        </div>
        <button class="btn" id="wk-cal" title="Add your outings to your phone's calendar">${I.calendar}Add to calendar</button>
        ${committee ? `
          ${data.total ? (data.published === data.total ? `<button class="btn" id="wk-unpub">${I.eye}Unpublish</button>` : `<button class="btn primary" id="wk-pub">${I.send}Publish week</button>`) : ""}
        ` : ""}
      </div>
    </div>
    <div class="filters">
      <div class="seg" id="flt">
        ${[["all", "All"], ["water", "Water"], ["land", "Land"], ["open", "Open spots"], ["mine", `Mine${S.me ? ` (${myCount})` : ""}`], ["subs", "Needs sub"]].map(([k, l]) => `<button data-f="${k}" class="${S.filter === k ? "on" : ""}">${l}</button>`).join("")}
      </div>
      <div class="filters-right">
        ${committee ? `<div class="toolbar"><button class="btn" data-new="land">${I.plus}Land session</button><button class="btn primary" data-new="water">${I.plus}Water outing</button></div>` : ""}
        ${flagPill(data.river && data.river.flag)}
      </div>
    </div>
    ${!committee && data.outings.length === 0 ? `<div class="card empty">${I.calendar}<h3>Nothing published yet</h3><p>The schedule for this week hasn't been released. Check back soon.</p></div>` : `
    <div class="days">${data.days.map((d) => {
      const list = outs.filter((o) => o.date === d);
      return `<section class="day ${d === data.today ? "today" : ""}"><div class="day-head"><b>${DAY[dow(d)]}</b><span>${d === data.today ? "Today · " : ""}${fmtShort(d)}</span></div>
        ${data.river && data.river.days[d] ? (() => { const x = data.river.days[d]; return `<div class="day-sun" title="Sunrise ${x.sunrise} · sunset ${x.sunset}. Rowing allowed from 1 hour before sunrise to 1 hour after sunset.">On the water ${x.first}–${x.last}</div>`; })() : ""}
        <div class="day-body">${list.map(outingCard).join("") || (committee ? `<div class="day-empty">No sessions<br><button class="btn sm" data-new="water" data-date="${d}">${I.plus}Add</button></div>` : `<div class="day-empty">Rest day</div>`)}</div></section>`;
    }).join("")}</div>`}
    <div class="legend">
      <span><i class="sw" style="background:var(--water)"></i>Water</span><span><i class="sw" style="background:var(--land)"></i>Land</span>
      <span><i class="sw" style="background:var(--accent-soft);border:1px solid var(--accent)"></i>You</span>
      <span><i class="sw" style="background:var(--warn)"></i>Sub needed — tap to take the seat</span>
      ${committee ? `<span><i class="sw" style="background:var(--bad)"></i>Ineligible (no subs after cutoff / no swim test)</span><span><i class="sw" style="background:repeating-linear-gradient(135deg,var(--surface),var(--surface) 3px,var(--surface-3) 3px,var(--surface-3) 6px);border:1px solid var(--border)"></i>Draft</span>` : ""}
    </div>`;

  $("#wk-prev").onclick = () => { S.week = addDays(data.start, -7); pageSchedule(); };
  $("#wk-next").onclick = () => { S.week = addDays(data.start, 7); pageSchedule(); };
  $("#wk-today").onclick = () => { S.week = S.boot.this_week; pageSchedule(); };
  $("#wk-cal").onclick = () => calendarModal();
  const fr = $("#flag-rules"); if (fr) fr.onclick = () => riverModal();
  $$("#flt button").forEach((b) => b.onclick = () => {
    if (b.dataset.f === "mine" && !S.me) return pickIdentity(() => { S.filter = "mine"; route(); });
    S.filter = b.dataset.f; pageSchedule();
  });
  if (committee) {
    $$("[data-new]").forEach((b) => b.onclick = () => editOuting(null, { kind: b.dataset.new, date: b.dataset.date || data.days.find((d) => d >= data.today) || data.start }));
    const pub = $("#wk-pub"), unpub = $("#wk-unpub");
    if (pub) pub.onclick = async () => { if (await confirmBox("Publish this week?", "All sessions for this week become visible to rowers.", "Publish")) { await api("/api/committee/week/publish", { method: "POST", body: { start: data.start, published: true } }).catch(fail); toast("Week published"); pageSchedule(); } };
    if (unpub) unpub.onclick = async () => { await api("/api/committee/week/publish", { method: "POST", body: { start: data.start, published: false } }).catch(fail); toast("Week set back to draft"); pageSchedule(); };
  }
  if (committee && S.pendingNew) { const d = S.pendingNew; S.pendingNew = null; editOuting(null, d); }
  $$(".outing").forEach((card) => card.addEventListener("click", (e) => {
    const t = e.target.closest("[data-act]");
    const o = data.outings.find((x) => x.id === +card.dataset.oid);
    if (t) { e.stopPropagation(); return outingAct(t, o); }
    if (committee) editOuting(o); else viewOuting(o);
  }));
}

function outingAct(t, o) {
  if (t.dataset.act === "reqsub") return requestSub(o);
  if (t.dataset.act === "fill") return fillSub(+t.dataset.sub, o);
  if (t.dataset.act === "join") return joinLand(o);
  if (t.dataset.act === "leave") return leaveLand(o);
  if (t.dataset.act === "cancel") return cancelOuting(o);
}

/* Rowers' read-only view of an outing: full names, who's subbing for whom, and the same seat actions as the card. */
function viewOuting(o) {
  const name = o.title || (o.kind === "water" ? "Water outing" : "Land training");
  const seats = o.kind === "land" ? o.seats.filter((s) => s.member).map((s, i) => ({ ...s, label: String(i + 1) })) : o.seats;
  const extra = (s) => [
    s.subbed_for ? `Subbing for ${esc(s.subbed_for)}` : "",
    s.sub_request ? `Sub needed${s.sub_request.reason ? `: ${esc(s.sub_request.reason)}` : ""}` : "",
  ].filter(Boolean).join(" · ");
  const row = (s) => seatRow(o, s, extra(s));
  const mine = o.seats.some((s) => s.member && s.member.id === S.me);
  const join = o.kind === "land" && o.spots > 0 && !o.past && !o.cancelled && !mine;
  modal({
    title: esc(name),
    body: `
      <div class="o-detail">
        <div><b>${fmtLong(o.date)}</b>${o.time ? ` · <span class="tnum">${esc(tRange(o))}</span>` : ` · <span class="faint">Time TBC</span>`}
          ${o.kind === "water" ? `<span class="chip water">${I.water}Water</span>` : `<span class="chip land">${I.land}Land</span>`}${o.cancelled ? ` <span class="chip bad">Cancelled</span>` : ""}</div>
        ${o.cancelled ? `<div class="callout bad">${I.x}<div><b>This session has been cancelled.</b>${cancelText(o) ? ` ${esc(cancelText(o))}` : ""}</div></div>` : ""}
        ${o.boat ? `<div>${I.boat}${esc(o.boat.name)} <span class="faint">${esc(o.boat.type)}</span></div>` : ""}
        ${o.location ? `<div>${I.pin}${o.maps_url ? `<a href="${esc(o.maps_url)}" target="_blank" rel="noopener">${esc(o.location)}</a>` : esc(o.location)}</div>` : ""}
        ${o.coach ? `<div>${I.whistle}Coach: ${esc(o.coach)}</div>` : ""}
      </div>
      <div class="seats seats-detail">${seats.map(row).join("") || `<div class="seat open"><span class="sl"></span><span class="sn">No one yet. Be the first!</span></div>`}</div>
      ${o.cancelled ? "" : o.kind === "land" ? (o.spots ? `<div class="o-foot"><span class="chip accent">${esc(o.spots_text)} of ${o.capacity}</span></div>` : "") : waterFoot(o)}
      ${o.notes ? `<div class="callout">${I.info}<div>${esc(o.notes)}</div></div>` : ""}
      ${riverList((o.river || []).filter((r) => !o.past && r.level === "stop"))}
      ${crewLogList(o)}`,
    foot: `<div class="r">${join ? `<button class="btn primary" data-act="join">${I.plus}Join</button>` : ""}<button class="btn" data-close>Close</button></div>`,
    onMount: (el, close) => {
      $$("[data-act]", el).forEach((b) => b.onclick = (e) => { e.stopPropagation(); close(); outingAct(b, o); });
    },
  });
}

/* After copying or auto-filling from the Sign-ups page, show that week's schedule. */
function showWeek(start) {
  S.week = start;
  if (location.hash.startsWith("#/schedule")) pageSchedule(); else location.hash = "#/schedule";
}

function copyWeek(target) {
  const src = addDays(target, -7);
  modal({
    title: "Copy last week's schedule",
    body: `<p style="margin:0" class="muted">Copies every outing and land session from <b>${fmtShort(src)} – ${fmtShort(addDays(src, 6))}</b> into the schedule for <b>${fmtShort(target)} – ${fmtShort(addDays(target, 6))}</b> as drafts.</p>
      <label class="check"><input type="checkbox" id="cw-crews"> Also copy crews (who's in each seat)</label>`,
    foot: `<div class="r"><button class="btn" data-close>Cancel</button><button class="btn primary" id="cw-go">${I.copy}Copy</button></div>`,
    onMount: (m, close) => {
      $("#cw-go", m).onclick = async () => {
        try {
          const r = await api("/api/committee/week/copy", { method: "POST", body: { source: src, target, include_crews: $("#cw-crews", m).checked } });
          close(); toast(`Copied ${r.copied} session${r.copied === 1 ? "" : "s"}`); showWeek(target);
        } catch (e) { fail(e); }
      };
    },
  });
}

/* Auto-fill: the server proposes crews for the week's empty seats from the sign-ups; nothing is saved until
   the committee presses Apply, and then exactly the proposal shown is saved (seats stay drafts). */
async function autofillWeek(start, includePublished = false) {
  let p;
  try { p = await api("/api/committee/week/autofill", { method: "POST", body: { start, include_published: includePublished } }); } catch (e) { return fail(e); }
  const STATUS = { full: ["Crew complete", "ok"], partial: ["Still short", "warn"], unchanged: ["No change", ""], skipped: ["Not filled", "bad"] };
  const seatsHtml = (x) => x.seats.map((s) => `<div class="seat ${s.new ? "af-new" : ""}">
      <span class="sl">${esc(s.seat === 0 ? "Cox" : s.label)}${s.side ? `<i class="af-side">${s.side}</i>` : ""}</span>
      <span class="sn">${s.member ? esc(s.member.name) : `<span class="faint">empty</span>`}</span>
      <span>${s.member && s.seat !== 0 && s.member.category === "Senior" && x.category === "Novice" ? `<span class="tag violet" title="Senior in a novice crew">Senior</span>` : ""}</span></div>`).join("");
  const outingHtml = (x) => {
    const [stl, stc] = STATUS[x.status];
    return `<article class="card af-outing">
      <div class="af-head"><b>${DAY[dow(x.date)]} ${fmtShort(x.date)}${x.time ? ` · <span class="tnum">${esc(tRange(x))}</span>` : ""}</b>
        <span class="muted">${esc([x.title, x.boat].filter(Boolean).join(" · "))}</span></div>
      <div class="af-chips"><span class="chip ${stc}">${stl}</span>${x.added ? `<span class="chip accent">+${x.added}</span>` : ""}${x.category ? `<span class="chip">${x.category === "Novice" ? "Novice crew" : "Senior crew"}</span>` : ""}${x.squad ? `<span class="chip ${x.squad === "women" ? "violet" : "accent"}">${esc(SQUAD_SHORT[x.squad])}</span>` : ""}${x.published ? `<span class="chip warn">Published</span>` : ""}</div>
      <div class="seats">${seatsHtml(x)}</div>
      <div class="small" style="margin-top:6px">${I.whistle} ${x.new_coach ? `Bankrider: <b class="af-new-text">${esc(x.new_coach)}</b>` : x.coach ? `Coach: ${esc(x.coach)}` : `<span class="faint">No coach / bankrider</span>`}</div>
      ${x.notes.length ? `<div class="warnings">${x.notes.map((n) => `<div>${I.alert}<span>${esc(n)}</span></div>`).join("")}</div>` : ""}
    </article>`;
  };
  const short = (q) => (q.role === "bankrider" ? 0 : Math.max(0, q.want_row - q.rows) + Math.max(0, q.want_cox - q.coxes));
  const people = p.people.slice().sort((a, b) => short(b) - short(a) || a.name.localeCompare(b.name));
  const given = (now, before, want) => `${now}${now > before ? ` <span class="af-new-text">(+${now - before})</span>` : ""}${want ? `<span class="faint"> / ${want}</span>` : ""}`;
  const peopleHtml = `<div class="table-wrap"><table class="t af-people"><thead><tr><th>Name</th><th title="Rowing outings this week / max water outings">Rowing</th><th title="Coxing outings this week / wanted">Coxing</th><th>Bankriding</th><th title="All sessions this week, including land and bankriding">Total</th></tr></thead><tbody>
    ${people.map((q) => `<tr class="${short(q) ? "af-short" : ""}"><td>${esc(q.name)} <span class="faint small">${esc(q.category || "")}${q.novice_outings ? ` · ${q.novice_outings} novice outing${q.novice_outings === 1 ? "" : "s"}` : ""}</span></td>
      <td class="tnum">${q.role === "cox" || q.role === "bankrider" ? "—" : given(q.rows, q.rows_before, q.want_row)}</td>
      <td class="tnum">${["cox", "both"].includes(q.role) ? given(q.coxes, q.coxes_before, q.want_cox) : "—"}</td>
      <td class="tnum">${q.bankrides ? given(q.bankrides, q.bankrides_before, 0) : "—"}</td>
      <td class="tnum">${q.total}</td></tr>`).join("")}</tbody></table></div>`;
  const nShort = people.filter(short).length;
  const changes = p.added + p.bankriders;
  const body = !p.signups
    ? `<div class="empty">${I.users}<h3>Nobody has signed up for this week yet</h3><p>Auto-fill uses the weekly sign-up. Open the sign-up form for this week first.</p></div>`
    : !p.outings.length
    ? `<div class="empty">${I.water}<h3>No draft water outings to fill</h3><p>Create this week's water outings on the Schedule first (or copy last week's schedule without crews), then auto-fill them.</p></div>`
    : `<div class="callout">${I.info}<div>${changes ? `Puts <b>${p.added}</b> ${p.added === 1 ? "person" : "people"} into empty seats${p.bankriders ? ` and adds <b>${p.bankriders}</b> bankrider${p.bankriders === 1 ? "" : "s"}` : ""}. ` : "There's nothing auto-fill can add right now. "}
        People you've already placed stay where they are. Nothing is saved until you press <b>Apply</b>, and sessions stay as drafts so you can adjust them before publishing.</div></div>
      <div class="af-summary small muted">${p.full} complete · ${p.partial} still short · ${nShort ? `${nShort} ${nShort === 1 ? "person gets" : "people get"} fewer outings than they asked for` : "everyone gets what they asked for"}</div>
      ${p.excluded_published || includePublished ? `<label class="check small"><input type="checkbox" id="af-pub" ${includePublished ? "checked" : ""}> Also fill published sessions${p.excluded_published ? ` (${p.excluded_published} with empty seats)` : ""}</label>` : ""}
      <div class="af-grid">${p.outings.map(outingHtml).join("")}</div>
      <details class="af-more"><summary class="section-title" style="cursor:pointer">Outings per person <span class="faint">${people.length}</span></summary>${peopleHtml}</details>
      <p class="small faint" style="margin:10px 0 0">How it picks: only people who signed up as free for that session and are eligible (subs, swim test, novice free outings), within their weekly maximum and not booked elsewhere at that time. People furthest below the number of outings they asked for go first. Rowers sit on their side, and crews stay in their squad unless that would leave seats empty. Novice crews get 2–3 seniors, shared out among the seniors.</p>`;
  modal({
    title: `Auto-fill crews · ${fmtShort(p.start)} – ${fmtShort(addDays(p.start, 6))}`, body, wide: "xl",
    foot: `<div class="r"><button class="btn" data-close>Cancel</button>${changes ? `<button class="btn primary" id="af-go">${I.check}Apply</button>` : ""}</div>`,
    onMount: (m, close) => {
      const pub = $("#af-pub", m); if (pub) pub.onchange = () => { close(); autofillWeek(start, pub.checked); };
      const go = $("#af-go", m);
      if (go) go.onclick = async () => {
        go.disabled = true;
        const outings = p.outings.filter((x) => x.added || x.new_coach).map((x) => ({
          id: x.id, coach: x.new_coach, seats: Object.fromEntries(x.seats.filter((s) => s.new).map((s) => [String(s.seat), s.member.id])) }));
        try {
          const r = await api("/api/committee/week/autofill/apply", { method: "POST", body: { start: p.start, outings } });
          close();
          toast(`Added ${r.added} ${r.added === 1 ? "person" : "people"}${r.coaches ? ` and ${r.coaches} bankrider${r.coaches === 1 ? "" : "s"}` : ""}${r.skipped ? ` · ${r.skipped} skipped (changed since the preview)` : ""}`, !!r.skipped);
          showWeek(p.start);
        } catch (e) { go.disabled = false; fail(e); }
      };
    },
  });
}

// ------------------------------------------------------- outing editor ----
async function editOuting(o, defaults = {}) {
  const [boatsRes, coaches] = await Promise.all([api("/api/committee/boats"), api("/api/committee/coaches"), loadPlaces(true)]).catch((e) => { fail(e); return [null, null]; });
  if (!boatsRes) return;
  const boats = boatsRes.boats.filter((b) => b.status !== "retired" || (o && o.boat && o.boat.id === b.id));
  const st = {
    kind: o?.kind || defaults.kind || "water",
    date: o?.date || defaults.date, time: o?.time || defaults.time || "", end_time: o?.end_time || defaults.end_time || "", location: o?.location || defaults.location || "",
    title: o?.title || defaults.title || "", coach: o?.coach || "", boat_id: o?.boat?.id || null,
    capacity: o?.capacity || 8, coxed: o ? o.coxed : true, notes: o?.notes || "",
    seats: Object.fromEntries((o?.seats || []).filter((s) => s.member).map((s) => [s.seat, s.member.id])),
  };
  let cand = {}, hasSlots = false;
  const week = S.weekData;
  const members = S.boot.members;
  const seatList = () => {
    let cap = st.capacity, coxed = st.coxed;
    if (st.kind === "water" && st.boat_id) { const b = boats.find((x) => x.id === st.boat_id); if (b) { cap = b.seats; coxed = !!b.coxed; } }
    if (st.kind === "land") return Array.from({ length: cap }, (_, i) => i + 1);
    const arr = []; for (let i = cap; i >= 1; i--) arr.push(i);
    return coxed ? [0, ...arr] : arr;
  };
  const label = (s, cap) => st.kind === "land" ? String(s) : s === 0 ? "Cox" : cap === 1 ? "Sculler" : s === cap ? "Stroke" : s === 1 ? "Bow" : String(s);

  const body = `
    <div class="seg" id="oe-kind"><button data-k="water" class="${st.kind === "water" ? "on" : ""}">${I.water}Water</button><button data-k="land" class="${st.kind === "land" ? "on" : ""}">${I.land}Land</button></div>
    <div class="grid-3">
      <label class="field"><span>Day</span><select class="input" id="oe-date">${(week?.days || [st.date]).map((d) => `<option value="${d}" ${d === st.date ? "selected" : ""}>${fmtLong(d)}</option>`).join("")}${week && !week.days.includes(st.date) ? `<option value="${st.date}" selected>${fmtLong(st.date)}</option>` : ""}</select></label>
      <div class="field"><span>Time <span class="faint">(start – end)</span></span><div class="time-range"><input class="input tnum" type="time" id="oe-time" value="${esc(st.time)}" aria-label="Start time"><span class="faint">–</span><input class="input tnum" type="time" id="oe-end" value="${esc(st.end_time)}" aria-label="End time (optional)"></div></div>
      <label class="field"><span>Where</span><input class="input" id="oe-loc" list="oe-places" placeholder="e.g. Boathouse" value="${esc(st.location)}">${placesDatalist("oe-places")}</label>
    </div>
    <div class="grid-2">
      <label class="field"><span>Crew / session name</span><input class="input" id="oe-title" placeholder="e.g. M1, Novice W" value="${esc(st.title)}"></label>
      <label class="field"><span id="oe-coach-l">${st.kind === "water" ? "Coach / bankrider" : "Coach"}</span><div class="combo" id="oe-coach-wrap"><input class="input" id="oe-coach" autocomplete="off" value="${esc(st.coach)}" placeholder="Optional · pick anyone or type a name"></div></label>
    </div>
    <div class="grid-2" id="oe-water-row">
      <label class="field"><span>Boat</span><select class="input" id="oe-boat"><option value="">— No specific boat —</option>${boats.map((b) => `<option value="${b.id}" ${b.id === st.boat_id ? "selected" : ""}>${esc(b.name)} · ${esc(b.boat_type)}${b.status !== "available" ? ` (${b.status})` : ""}</option>`).join("")}</select>
        ${boats.length ? "" : `<span class="hint">No boats yet — add them in the <a href="#/boats">Boat park</a>.</span>`}</label>
      <label class="field" id="oe-cap-f"><span>Seats</span><select class="input" id="oe-cap"></select></label>
    </div>
    <div id="oe-cap-land" class="grid-2"><label class="field"><span>Spots</span><input class="input" type="number" min="1" max="40" id="oe-cap-l" value="${st.kind === "land" ? st.capacity : 8}"></label></div>
    <div class="oe-crew-wrap">
      <div class="oe-crew">
        <div class="section-title" style="margin-top:4px;display:flex;justify-content:space-between;gap:8px"><span>Crew</span><span class="faint" style="text-transform:none;letter-spacing:0;font-weight:500"><span id="oe-fill"></span> · <a href="#" id="oe-clear">Clear</a></span></div>
        <p class="oe-hint">Click a name in <b>Signed up</b> to put them in the boat, and click it again to take them out. To choose the seat yourself, click the seat's name first.</p>
        <div class="seat-editor" id="oe-seats"></div>
      </div>
      <aside class="oe-pool" id="oe-pool"><div class="faint small">Loading sign-ups…</div></aside>
    </div>
    <label class="field"><span>Notes</span><textarea class="input" id="oe-notes" rows="2" placeholder="Optional — visible to rowers">${esc(st.notes)}</textarea></label>
    <div id="oe-warn"></div>
    <div id="oe-river"></div>
    ${o ? crewLogList(o, true) : ""}`;
  const foot = `${o ? `<button class="btn danger" id="oe-del">Delete</button>${o.cancelled
      ? `<button class="btn" id="oe-uncancel" title="Put this session back on">Restore session</button>`
      : `<button class="btn" id="oe-cancel" title="Keep it on the schedule, marked as cancelled, with a reason">${I.x}Cancel session</button>`}` : ""}<div class="r">
      <button class="btn" data-close>Close</button>
      ${o && o.published ? "" : `<button class="btn" id="oe-save-draft">${o ? "Save draft" : "Save as draft"}</button>`}
      <button class="btn primary" id="oe-save">${o && o.published ? "Save" : "Save & publish"}</button></div>`;

  modal({
    title: o ? (o.cancelled ? "Edit session · cancelled" : "Edit session") : st.kind === "water" ? "New water outing" : "New land session", body, foot, wide: "xl",
    onMount: (m, close) => {
      const boatSel = $("#oe-boat", m), capSel = $("#oe-cap", m);
      let target = null, loaded = false;
      let rcTimer = null, rcSeq = 0;
      const riverCheck = () => {
        clearTimeout(rcTimer);
        rcTimer = setTimeout(async () => {
          const el = $("#oe-river", m); if (!el) return;
          if (st.kind !== "water") { el.innerHTML = ""; return; }
          const seq = ++rcSeq;
          try {
            const r = await api("/api/committee/river-check", { method: "POST", body: {
              date: st.date, time: $("#oe-time", m).value.trim(), end_time: $("#oe-end", m).value.trim(), coach: $("#oe-coach", m).value,
              boat_id: st.boat_id, capacity: st.capacity, coxed: !!st.coxed, outing_id: o?.id || null,
              seats: Object.fromEntries(Object.entries(st.seats).map(([k, v]) => [String(k), v])) } });
            if (seq !== rcSeq) return;
            const f = r.flag, stops = r.issues.filter((x) => x.level === "stop");
            el.innerHTML = `<div class="callout river ${stops.length ? "bad" : r.issues.length ? "warn" : ""}">
              <span class="flag-dot" style="background:${esc(f.colour)}"></span>
              <div><b>River rules · Isis ${esc(f.name)} flag</b> <span class="faint small">· on the water ${esc(r.day.first)}–${esc(r.day.last)} (sunrise ${esc(r.day.sunrise)}, sunset ${esc(r.day.sunset)})</span>
              ${r.issues.length ? riverList(r.issues) : `<div class="small" style="color:var(--ok);margin-top:4px">No river-rule problems found.</div>`}</div></div>`;
          } catch { /* the check is only advice */ }
        }, 250);
      };
      const loadCand = async () => {
        try {
          const r = await api("/api/committee/candidates", { method: "POST", body: { kind: st.kind, date: st.date, time: st.time, outing_id: o?.id || null } });
          cand = r.members; hasSlots = r.has_slots; loaded = true;
        } catch (e) { fail(e); }
        drawSeats();
      };
      // This week's seats of the relevant kind vs the most they asked for (max water / coxing / land)
      const weekCap = (c, su, cox) => {
        if (!su || su.role === "bankrider") return null;
        const w = c.week || {};
        if (st.kind === "land") return { n: w.land || 0, max: su.max_land || 0, what: "land" };
        const max = cox ? su.want_cox : su.want_row;
        return max ? { n: cox ? w.cox || 0 : w.row || 0, max, what: cox ? "coxing" : "water" } : null;
      };
      const items = (seat) => () => members.map((mm) => {
        const c = cand[mm.id] || { ok: true, reasons: [] };
        const taken = Object.entries(st.seats).some(([k, v]) => v === mm.id && +k !== seat);
        const notCox = st.kind === "water" && seat === 0 && !mm.cox_status;
        const bad = !c.ok, busy = c.busy, su = c.signup;
        const free = !!(su && su.available);
        const roleFit = !su || (seat === 0 && st.kind === "water" ? ["cox", "both"].includes(su.role) : ["rower", "both"].includes(su.role));
        const cap = weekCap(c, su, st.kind === "water" && seat === 0);
        const overMax = !!(cap && cap.n >= cap.max);
        return { id: mm.id, label: mm.name, c, su, cap, free, overMax, taken, notCox, mm,
          dim: taken || notCox || bad || busy || (hasSlots && !free),
          cls: bad || busy ? "bad" : notCox || overMax ? "warn" : "",
          rank: (taken ? 8 : 0) + (busy ? 6 : 0) + (bad ? 4 : 0) + (notCox ? 2 : 0) + (overMax ? 1 : 0)
            + (hasSlots && !free ? 3 : 0) - (free && roleFit ? 2 : 0) - (seat === 0 && mm.cox_status ? 1 : 0) };
      });
      const why = (i) => {
        if (i.taken) return `<span class="faint">in another seat</span>`;
        if (i.c.busy) return `<span class="chip bad">Booked at this time</span>`;
        if (!i.c.ok) return `<span class="chip bad">${esc(i.c.reasons.join(" · "))}</span>`;
        const bits = [];
        if (i.free) bits.push(`<span class="chip ok">${I.check}Free</span>`);
        if (i.su && i.su.squad) bits.push(`<span class="chip ${i.su.squad === "women" ? "violet" : "accent"}">${esc(SQUAD_SHORT[i.su.squad])}</span>`);
      if (i.su && i.su.side) bits.push(`<span class="chip" title="${esc(i.su.side)}">${esc(SIDE_SHORT[i.su.side] || i.su.side)}</span>`);
        if (i.cap) bits.push(`<span class="chip ${i.overMax ? "warn" : ""}" title="${i.cap.what === "land" ? "Land sessions" : i.cap.what === "coxing" ? "Coxing outings" : "Water outings"} this week / their max">${i.cap.n}/${i.cap.max} ${i.cap.what === "land" ? "land" : "wk"}</span>`);
        if (i.mm.cox_status) bits.push(`<span class="chip violet">Cox ${esc(i.mm.cox_status)}</span>`);
        if (i.notCox) bits.push(`<span class="chip warn">not a cox</span>`);
        if (i.c.note && i.c.note.startsWith("Novice free")) bits.push(`<span class="chip accent">${esc(i.c.note.replace("Novice free outing", "Free"))}</span>`);
        else if (!i.su) bits.push(`<span class="chip ${i.mm.category === "Novice" ? "accent" : ""}">${esc(i.mm.category)}</span>`);
        if (i.c.same_day) bits.push(`<span class="faint">+${i.c.same_day} today</span>`);
        return bits.join(" ");
      };
      const drawSeats = () => {
        const seats = seatList();
        const cap = seats.filter((s) => s !== 0).length;
        for (const k of Object.keys(st.seats)) if (!seats.includes(+k)) delete st.seats[k];
        const box = $("#oe-seats", m);
        box.style.setProperty("--rows", Math.ceil(seats.length / 2));
        if (target != null && !seats.includes(target)) target = null;
        box.innerHTML = seats.map((s) => `<div class="se-wrap ${target === s ? "armed" : ""}"><div class="se-row"><button type="button" class="sl sl-btn" data-target="${s}" title="Click, then pick a name on the right to put them in this seat">${label(s, cap)}${sideOf(s) ? `<i>${sideOf(s)}</i>` : ""}</button><div data-seat="${s}"></div></div><div class="se-status small" id="ses-${s}"></div></div>`).join("");
        $$(".sl-btn", box).forEach((b) => b.onclick = () => { const t = +b.dataset.target; target = target === t ? null : t; drawSeats(); });
        seats.forEach((s) => {
          const ctl = combo($(`[data-seat="${s}"]`, box), {
            items: items(s), value: st.seats[s] ?? null, placeholder: s === 0 ? "Pick cox…" : "Pick rower…", renderWhy: why,
            onChange: (v) => { if (v == null) delete st.seats[s]; else st.seats[s] = v; status(); },
          });
          ctl._seat = s;
        });
        status();
      };
      const status = () => {
        const seats = seatList();
        let filled = 0, warns = [];
        seats.forEach((s) => {
          const el = $(`#ses-${s}`, m); const mid = st.seats[s];
          if (!el) return;
          el.innerHTML = "";
          if (mid == null) return;
          filled++;
          const c = cand[mid]; const mm = members.find((x) => x.id === mid);
          const p = [];
          if (c && c.busy) p.push("Booked in another session at this time");
          if (c && !c.ok) p.push(c.reasons.join(", "));
          if (st.kind === "water" && s === 0 && mm && !mm.cox_status) p.push("Not marked as a cox");
          const su = c && c.signup, soft = [];
          if (hasSlots && !(su && su.available)) soft.push(su ? "Didn't sign up as free for this slot" : "No sign-up this week");
          const cap = c && weekCap(c, su, st.kind === "water" && s === 0);
          if (cap && cap.n >= cap.max) soft.push(cap.max ? `Already at their max of ${cap.max} ${cap.what} outing${cap.max === 1 ? "" : "s"} this week` : "Doesn't want land sessions this week");
          if (!p.length && soft.length) { el.innerHTML = `<span style="color:var(--warn)">${esc(soft.join(" · "))}</span>`; return; }
          if (p.length) { el.innerHTML = `<span style="color:var(--bad)">${esc(p.join(" · "))}</span>`; warns.push(`${mm?.name}: ${p.join(", ")}`); }
          else if (c && (c.note || c.signup)) el.innerHTML = `<span class="faint">${esc([c.signup && c.signup.side, c.note].filter(Boolean).join(" · "))}</span>`;
        });
        $("#oe-fill", m).textContent = `${filled}/${seats.length} filled`;
        const cox = st.kind === "water" ? members.find((x) => x.id === st.seats[0]) : null;
        const extra = [];
        if (cox && cox.cox_status === "N" && !$("#oe-coach", m).value.trim()) extra.push("Novice cox — a bankrider/coach is needed.");
        const b = boats.find((x) => x.id === st.boat_id);
        if (st.kind === "water" && b && b.status !== "available") extra.push(`${b.name} is marked “${b.status}”.`);
        $("#oe-warn", m).innerHTML = (extra.length || warns.length) ? `<div class="callout warn">${I.alert}<div>${[...extra, ...warns].map(esc).join("<br>")}</div></div>` : "";
        drawPool();
        riverCheck();
      };

      // ---- sign-up pool: click a name to seat them ----
      const isSweep = () => {
        if (st.kind !== "water") return false;
        const b = boats.find((x) => x.id === st.boat_id);
        const cap = seatList().filter((x) => x !== 0).length;
        if (cap < 2) return false;
        return b ? !/x/i.test(b.boat_type) : (cap === 8 || st.coxed);
      };
      // stroke side = even seats, bow side = odd seats (sweep boats only)
      const sideOf = (s) => (s === 0 || !isSweep()) ? "" : s % 2 === 0 ? "S" : "B";
      const seatOf = (mid) => { const e = Object.entries(st.seats).find(([, v]) => v === mid); return e ? +e[0] : null; };
      const place = (mid, intent) => {
        const cur = seatOf(mid);
        if (cur != null && target == null) { delete st.seats[cur]; drawSeats(); return; }
        const seats = seatList();
        const name = members.find((x) => x.id === mid)?.name || "";
        let dest = null;
        if (target != null) dest = target;
        else if (intent === "cox") {
          if (!seats.includes(0)) return toast("This boat has no cox seat", true);
          if (st.seats[0] != null) return toast("The cox seat is taken. Click “Cox” first to replace them.", true);
          dest = 0;
        } else {
          const empty = seats.filter((x) => x !== 0 && st.seats[x] == null);
          if (!empty.length) return toast(st.kind === "land" ? "No spots left" : "No rowing seats left. Click a seat first to swap someone out.", true);
          const side = (cand[mid]?.signup?.side || "");
          const bow = (x) => x % 2 === 1, stroke = (x) => x % 2 === 0;
          let pick = empty;
          if (isSweep() && side.startsWith("Bow")) pick = empty.filter(bow).length ? empty.filter(bow) : (side.includes("only") ? [] : empty);
          if (isSweep() && side.startsWith("Stroke")) pick = empty.filter(stroke).length ? empty.filter(stroke) : (side.includes("only") ? [] : empty);
          if (!pick.length) return toast(`No ${side.startsWith("Bow") ? "bow" : "stroke"}-side seat left for ${name}. Click a seat first to place them anyway.`, true);
          dest = pick[0];
        }
        if (cur != null) delete st.seats[cur];
        st.seats[dest] = mid;
        target = null;
        drawSeats();
      };
      const toggleBankrider = (name) => {
        const inp = $("#oe-coach", m);
        const parts = inp.value.split(/\s*(?:,|&| and )\s*/).filter(Boolean);
        const has = parts.some((x) => x.toLowerCase() === name.toLowerCase());
        inp.value = (has ? parts.filter((x) => x.toLowerCase() !== name.toLowerCase()) : [...parts, name]).join(", ");
        status();
      };
      const drawPool = () => {
        const box = $("#oe-pool", m);
        if (!box) return;
        if (!loaded) { box.innerHTML = `<div class="faint small">Loading sign-ups…</div>`; return; }
        const people = members.map((mm) => ({ mm, c: cand[mm.id] || {}, su: (cand[mm.id] || {}).signup })).filter((x) => x.su);
        const free = people.filter((x) => x.su.available), others = people.filter((x) => !x.su.available);
        const water = st.kind === "water", coxed = water && seatList().includes(0);
        const coach = $("#oe-coach", m).value.toLowerCase();
        const weekN = (x) => { const w = x.c.week || {}; return (w.row || 0) + (w.cox || 0) + (w.land || 0); };
        const overCap = (x, cox) => { const cap = weekCap(x.c, x.su, cox); return !!(cap && cap.n >= cap.max); };
        const rank = (x, intent) => (x.c.busy ? 100 : 0) + (x.c.ok === false ? 50 : 0) + (overCap(x, intent === "cox") ? 20 : 0) + weekN(x);
        const sorted = (list, intent) => list.slice().sort((a, b) => rank(a, intent) - rank(b, intent) || a.mm.name.localeCompare(b.mm.name));
        const roleTag = { rower: "Rower", cox: "Cox", both: "Row/cox", bankrider: "Bankrider" };
        const item = (x, intent) => {
          const seat = seatOf(x.mm.id), inBoat = seat != null;
          const wcap = weekCap(x.c, x.su, intent === "cox"), over = !!(wcap && wcap.n >= wcap.max);
          const probs = [];
          if (x.c.busy) probs.push(`<span class="chip bad">Booked at this time</span>`);
          if (x.c.ok === false) probs.push(`<span class="chip bad">${esc(x.c.reasons.join(" · "))}</span>`);
          const cap = seatList().filter((q) => q !== 0).length;
          return `<button type="button" class="pool-item ${inBoat ? "in" : ""} ${x.c.busy || x.c.ok === false ? "bad" : ""}" data-pick="${x.mm.id}" data-intent="${intent}" title="${inBoat ? "Click to take out of the boat" : "Click to put in the boat"}">
            <span class="pi-main"><span class="pi-name">${esc(x.mm.name)}</span>
              <span class="pi-meta">${intent !== "cox" && x.su.squad ? `<span class="chip ${x.su.squad === "women" ? "violet" : "accent"}">${esc(SQUAD_SHORT[x.su.squad])}</span>` : ""}${intent !== "cox" && x.su.side ? `<span class="chip">${esc(SIDE_SHORT[x.su.side] || x.su.side)}</span>` : ""}${intent === "cox" && x.mm.cox_status ? `<span class="chip violet">Cox ${esc(x.mm.cox_status)}</span>` : ""}${x.su.role === "both" ? `<span class="chip accent">${roleTag.both}</span>` : ""}
              ${wcap ? `<span class="chip ${over ? "warn" : ""}" title="${wcap.what === "land" ? "Land sessions" : wcap.what === "coxing" ? "Coxing outings" : "Water outings"} given this week / most they want">${wcap.n}/${wcap.max} ${wcap.what === "land" ? "land" : "wk"}</span>` : ""}${probs.join("")}</span></span>
            <span class="pi-state">${inBoat ? `<span class="pi-seat">${esc(label(seat, cap))}</span>` : I.plus}</span></button>`;
        };
        const group = (title, list, intent, hint = "") => list.length ? `<div class="pool-group"><div class="pool-h">${title} <span class="faint">${list.length}</span>${hint ? `<span class="pool-hint">${hint}</span>` : ""}</div>${sorted(list, intent).map((x) => item(x, intent)).join("")}</div>` : "";
        const brs = water ? free.filter((x) => x.su.can_bankride && seatOf(x.mm.id) == null) : [];
        let html = `<div class="pool-head"><b>Signed up</b><span class="faint small">${fmtShort(st.date)}${st.time ? " · " + esc(st.time) : ""}</span></div>`;
        if (!hasSlots) html += `<div class="callout warn small" style="padding:8px 10px">${I.info}<div>No sign-up session matches this ${st.time ? "day and time" : "day"}${st.time ? "" : " (add a time)"}. Showing everyone who signed up this week.</div></div>`;
        const pool = hasSlots ? free : people;
        if (!people.length) html += `<div class="faint small" style="padding:6px 2px">Nobody has signed up for this week yet. You can still pick people from the seat boxes.</div>`;
        if (coxed) html += group("Coxes", pool.filter((x) => ["cox", "both"].includes(x.su.role)), "cox", "→ cox seat");
        html += group(st.kind === "land" ? "Athletes" : "Rowers", pool.filter((x) => (["rower", "both"].includes(x.su.role)) || (!coxed && x.su.role === "cox")), "row", isSweep() ? "placed on their side" : "");
        if (water && brs.length) html += `<div class="pool-group"><div class="pool-h">Can bankride <span class="faint">${brs.length}</span><span class="pool-hint">→ coach / bankrider</span></div>${sorted(brs).map((x) => {
          const on = coach.includes(x.mm.name.toLowerCase());
          return `<button type="button" class="pool-item ${on ? "in" : ""}" data-br="${esc(x.mm.name)}"><span class="pi-main"><span class="pi-name">${esc(x.mm.name)}</span><span class="pi-meta"><span class="chip violet">${roleTag[x.su.role]}</span></span></span><span class="pi-state">${on ? `<span class="pi-seat">BR</span>` : I.plus}</span></button>`; }).join("")}</div>`;
        if (hasSlots && others.length) html += `<details class="pool-group pool-more"><summary class="pool-h">Signed up this week, but not for this session <span class="faint">${others.length}</span></summary>${sorted(others).map((x) => item(x, coxed && x.su.role === "cox" ? "cox" : "row")).join("")}</details>`;
        const open = box.querySelector("details")?.open;
        box.innerHTML = html;
        if (open) box.querySelector("details").open = true;
        $$("[data-pick]", box).forEach((b) => b.onclick = () => place(+b.dataset.pick, b.dataset.intent));
        $$("[data-br]", box).forEach((b) => b.onclick = () => toggleBankrider(b.dataset.br));
      };
      // ---- coach / bankrider: dropdown of everyone (coaches + all members), free text still allowed ----
      function coachPicker() {
        const inp = $("#oe-coach", m), wrap = $("#oe-coach-wrap", m);
        let list = null, hl = 0, shown = [];
        const parts = () => inp.value.split(/\s*,\s*/);
        const build = () => {
          const ps = parts(), q = fold((ps[ps.length - 1] || "").trim());
          const taken = new Set(ps.slice(0, -1).map((x) => fold(x.trim())));
          const byName = new Map();
          coaches.forEach((c) => byName.set(fold(c.name), { name: c.name, coach: true }));
          members.forEach((mm) => { const k = fold(mm.name); byName.set(k, { ...(byName.get(k) || { name: mm.name }), mid: mm.id }); });
          return [...byName.values()]
            .filter((e) => !taken.has(fold(e.name)) && (!q || fold(e.name).includes(q)))
            .map((e) => {
              const c = e.mid != null ? cand[e.mid] || {} : {}, su = c.signup;
              const br = !!(su && su.can_bankride), free = !!(su && su.available), inBoat = e.mid != null && seatOf(e.mid) != null;
              return { ...e, br, free, inBoat, busy: !!c.busy, rank: inBoat || c.busy ? 5 : br && free ? 0 : e.coach ? 1 : br ? 2 : free ? 3 : 4 };
            })
            .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name)).slice(0, 80);
        };
        const why = (e) => [
          e.br && e.free ? `<span class="chip ok">${I.check}Can bankride · free</span>` : e.br ? `<span class="chip ok">Can bankride</span>` : "",
          e.coach ? `<span class="chip violet">Coach</span>` : "",
          !e.br && e.free ? `<span class="chip">Free</span>` : "",
          e.inBoat ? `<span class="chip warn">In the boat</span>` : "",
          e.busy ? `<span class="chip bad">Booked at this time</span>` : "",
        ].join(" ");
        const close = () => { list?.remove(); list = null; };
        const draw = () => {
          shown = build(); hl = Math.min(hl, Math.max(0, shown.length - 1));
          if (!list) { list = document.createElement("div"); list.className = "combo-list"; wrap.appendChild(list); }
          list.innerHTML = shown.length ? shown.map((e, k) => `<div class="combo-item ${k === hl ? "hl" : ""} ${e.inBoat || e.busy ? "dim" : ""}" data-k="${k}"><span class="nm">${esc(e.name)}</span><span class="why">${why(e)}</span></div>`).join("")
            : `<div class="combo-empty">No match. The name you typed will be used as it is.</div>`;
          $$(".combo-item", list).forEach((el) => el.addEventListener("mousedown", (ev) => { ev.preventDefault(); pick(shown[+el.dataset.k]); }));
          const h = $(".hl", list); h && h.scrollIntoView({ block: "nearest" });
        };
        const pick = (e) => {
          const ps = parts(); ps[ps.length - 1] = e.name;
          inp.value = ps.map((x) => x.trim()).filter(Boolean).join(", ");
          close(); status();
        };
        inp.addEventListener("focus", () => { hl = 0; draw(); });
        inp.addEventListener("input", () => { hl = 0; draw(); });
        inp.addEventListener("blur", () => setTimeout(close, 120));
        inp.addEventListener("keydown", (ev) => {
          if (!list && (ev.key === "ArrowDown")) { draw(); return; }
          if (!list) return;
          if (ev.key === "ArrowDown") { hl = Math.min(hl + 1, shown.length - 1); draw(); ev.preventDefault(); }
          else if (ev.key === "ArrowUp") { hl = Math.max(hl - 1, 0); draw(); ev.preventDefault(); }
          else if (ev.key === "Enter") { ev.preventDefault(); if (shown[hl]) pick(shown[hl]); }
          else if (ev.key === "Escape") { ev.stopPropagation(); close(); }
        });
      }

      $("#oe-clear", m).onclick = (e) => { e.preventDefault(); st.seats = {}; target = null; drawSeats(); };
      const syncKind = () => {
        $$("#oe-kind button", m).forEach((b) => b.classList.toggle("on", b.dataset.k === st.kind));
        $("#oe-water-row", m).classList.toggle("hidden", st.kind !== "water");
        $("#oe-cap-land", m).classList.toggle("hidden", st.kind !== "land");
        $("#oe-coach-l", m).textContent = st.kind === "water" ? "Coach / bankrider" : "Coach";
        $("#oe-cap-f", m).classList.toggle("hidden", !!st.boat_id);
        capSel.innerHTML = [["8+", 8, 1], ["4+", 4, 1], ["4x / 4-", 4, 0], ["2x / 2-", 2, 0], ["1x", 1, 0]].map(([l, c, x]) =>
          `<option value="${c}|${x}" ${st.capacity === c && !!st.coxed === !!x ? "selected" : ""}>${l}</option>`).join("");
      };
      $$("#oe-kind button", m).forEach((b) => b.onclick = () => {
        if (st.kind === b.dataset.k) return;
        st.kind = b.dataset.k; st.seats = {};
        if (st.kind === "land") { st.capacity = +$("#oe-cap-l", m).value || 8; st.coxed = false; }
        else { st.capacity = 8; st.coxed = true; }
        syncKind(); loadCand();
      });
      boatSel.onchange = () => { st.boat_id = boatSel.value ? +boatSel.value : null; syncKind(); drawSeats(); };
      capSel.onchange = () => { const [c, x] = capSel.value.split("|"); st.capacity = +c; st.coxed = x === "1"; drawSeats(); };
      $("#oe-cap-l", m).onchange = (e) => { st.capacity = Math.max(1, Math.min(40, +e.target.value || 8)); drawSeats(); };
      $("#oe-date", m).onchange = (e) => { st.date = e.target.value; loadCand(); };
      $("#oe-time", m).onchange = (e) => { st.time = e.target.value.trim(); loadCand(); };
      $("#oe-coach", m).oninput = status;
      $("#oe-end", m).onchange = riverCheck;
      coachPicker();
      const save = async (published) => {
        const body = {
          kind: st.kind, date: st.date, time: $("#oe-time", m).value.trim(), end_time: $("#oe-end", m).value.trim(), location: $("#oe-loc", m).value,
          title: $("#oe-title", m).value, coach: $("#oe-coach", m).value, boat_id: st.kind === "water" ? st.boat_id : null,
          capacity: st.kind === "land" ? (+$("#oe-cap-l", m).value || 8) : st.capacity, coxed: st.kind === "water" && st.coxed,
          notes: $("#oe-notes", m).value, published, seats: Object.fromEntries(Object.entries(st.seats).map(([k, v]) => [String(k), v])),
        };
        try {
          await api(o ? `/api/committee/outings/${o.id}` : "/api/committee/outings", { method: o ? "PUT" : "POST", body });
          close(); toast(o ? "Session saved" : "Session created"); pageSchedule();
        } catch (e) { fail(e); }
      };
      $("#oe-save", m).onclick = () => save(o && o.published ? true : true);
      const d = $("#oe-save-draft", m); if (d) d.onclick = () => save(false);
      const del = $("#oe-del", m);
      if (del) del.onclick = async () => {
        if (!await confirmBox("Delete this session?", "Crew assignments and sub requests for it will be removed. Outing counts update automatically.", "Delete", true)) return;
        try { await api(`/api/committee/outings/${o.id}`, { method: "DELETE" }); toast("Session deleted"); pageSchedule(); } catch (e) { fail(e); }
      };
      const markAs = async (st) => { try { await setOutingStatus(o, st); close(); } catch (e) { fail(e); } };
      $$("[data-undo]", m).forEach((b) => b.onclick = async () => {
        const e = (o.log || []).find((x) => x.id === +b.dataset.undo);
        if (!e) return;
        const yes = await confirmBox("Undo this change?", `<b>${esc(e.text)}</b><br>The crew is put back as it was before this change, straight away. Anything else you've changed in this form and not saved is lost.`, "Undo");
        close(); // the confirm box replaced the editor
        if (!yes) return editOuting(o);
        try {
          await api(`/api/committee/crew-log/${e.id}/undo`, { method: "POST" });
          toast("Change undone");
          await pageSchedule();
          const fresh = S.weekData && S.weekData.outings.find((x) => x.id === o.id);
          if (fresh) editOuting(fresh);
        } catch (err) { fail(err); }
      });
      const cancelBtn = $("#oe-cancel", m); if (cancelBtn) cancelBtn.onclick = () => cancelOuting(o);
      const uncancel = $("#oe-uncancel", m); if (uncancel) uncancel.onclick = () => markAs("scheduled");
      syncKind(); drawSeats(); loadCand();
    },
  });
}

// ---------------------------------------------------- phone privacy (committee) --
const telHref = (p) => "tel:" + String(p).replace(/[^\d+]/g, "");
/* Masked number with a "Show" button; the full number is only fetched when asked for. */
function phoneCell(memberId, masked, hasPhone) {
  if (!hasPhone) return `<span class="faint">—</span>`;
  return `<span class="phone-mask" data-phone="${memberId}"><span class="tnum">${esc(masked)}</span> <button type="button" class="btn sm ghost" data-reveal="${memberId}">Show</button></span>`;
}
function wireReveal(root) {
  $$("[data-reveal]", root).forEach((b) => b.onclick = async (e) => {
    e.stopPropagation();
    try {
      const { phone } = await api(`/api/committee/members/${b.dataset.reveal}/phone`);
      b.closest("[data-phone]").innerHTML = phone ? `<a class="tnum" href="${telHref(phone)}" onclick="event.stopPropagation()">${esc(phone)}</a>` : "—";
    } catch (err) { fail(err); }
  });
}
/* CSV export: phone numbers are left out unless explicitly ticked. */
function exportModal(url, what) {
  modal({
    title: `Export ${what}`,
    body: `<p style="margin:0" class="muted">Downloads a spreadsheet (CSV) of ${what}.</p>
      <label class="check"><input type="checkbox" id="ex-phone"> Include phone numbers</label>
      <div class="callout warn hidden" id="ex-warn">${I.alert}<div>The file will contain phone numbers <b>unencrypted</b>. Only do this if you need them, keep the file private, and delete it when you're done.</div></div>`,
    foot: `<div class="r"><button class="btn" data-close>Cancel</button><a class="btn primary" id="ex-go" href="${url}">${I.download}Download</a></div>`,
    onMount: (m, close) => {
      const cb = $("#ex-phone", m), go = $("#ex-go", m);
      cb.onchange = () => { go.href = url + (cb.checked ? (url.includes("?") ? "&" : "?") + "include_phone=1" : ""); $("#ex-warn", m).classList.toggle("hidden", !cb.checked); };
      go.addEventListener("click", () => setTimeout(close, 300));
    },
  });
}

// --------------------------------------------------------------- calendar --
function calendarModal() {
  requireMe(async () => {
    const mid = S.me, name = meName();
    let L;
    try { L = await api(`/api/calendar/${mid}`, { method: "POST" }); } catch (e) { return fail(e); }
    modal({
      title: "Add your outings to your calendar",
      body: `
        <p style="margin:0">Subscribe once and every outing <b>${esc(name)}</b> is put in shows up in your calendar. Crew changes, subs and new sessions update on their own, and outings you hand to a sub disappear.</p>
        <div class="cal-opts">
          <a class="cal-opt" id="cal-apple" href="${esc(L.webcal)}"><b>Apple Calendar</b><span>iPhone, iPad, Mac</span></a>
          <a class="cal-opt" href="${esc(L.google)}" target="_blank" rel="noopener"><b>Google Calendar</b><span>Android, web</span></a>
          <a class="cal-opt" href="${esc(L.outlook)}" target="_blank" rel="noopener"><b>Outlook</b><span>Outlook.com, Office 365</span></a>
        </div>
        <label class="field"><span>Or copy your personal link into any calendar app (“Subscribe to calendar” / “From URL”)</span>
          <div style="display:flex;gap:8px"><input class="input tnum" id="cal-url" readonly value="${esc(L.url)}"><button class="btn" id="cal-copy">${I.copy}Copy</button></div></label>
        <div class="callout">${I.info}<div>Calendar apps check for changes every so often (Google can take up to a day), so always check the schedule here on the day. Only published outings are included.</div></div>
        <p class="small faint" style="margin:0">This link is private to you: anyone who has it can see your outings. <a href="#" id="cal-reset">Get a new link</a> to stop an old one working.</p>`,
      foot: `<button class="btn ghost" id="cal-who">Not ${esc(name.split(" ")[0])}?</button><div class="r"><button class="btn primary" data-close>Done</button></div>`,
      onMount: (m, close) => {
        $("#cal-copy", m).onclick = async () => {
          const inp = $("#cal-url", m);
          try { await navigator.clipboard.writeText(inp.value); } catch { inp.select(); document.execCommand("copy"); }
          toast("Link copied");
        };
        $("#cal-url", m).onfocus = (e) => e.target.select();
        $("#cal-who", m).onclick = () => { close(); pickIdentity(() => calendarModal()); };
        $("#cal-reset", m).onclick = async (e) => {
          e.preventDefault();
          if (!await confirmBox("Get a new calendar link?", "Your old link stops working, so calendars subscribed with it will stop updating. You'll need to subscribe again with the new link.", "Get new link")) return;
          try { await api(`/api/calendar/${mid}/reset`, { method: "POST" }); toast("New link created"); calendarModal(); } catch (err) { fail(err); }
        };
      },
    });
  });
}

// ---------------------------------------------------------- notifications --
/* Web push (see app/push.py). A device subscribes for the rower picked on it, like the calendar feed. */
const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const b64uBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
let swReg = null;
async function swReady() {
  if (!("serviceWorker" in navigator)) return null;
  if (!swReg) { await navigator.serviceWorker.register("/sw.js"); swReg = await navigator.serviceWorker.ready; }
  return swReg;
}
async function pushSub() { if (!pushSupported()) return null; const r = await swReady(); return r ? r.pushManager.getSubscription() : null; }
const sameKey = (sub, key) => {
  const k = sub.options && sub.options.applicationServerKey;
  if (!k) return true;
  const a = new Uint8Array(k), b = b64uBytes(key);
  return a.length === b.length && a.every((x, i) => x === b[i]);
};
async function pushEnable() {
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error(perm === "denied" ? "Notifications are blocked for this site. Allow them in your browser or phone settings, then try again" : "Notifications weren't allowed");
  const reg = await swReady();
  const { key } = await api("/api/push/key");
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub, key)) { await sub.unsubscribe(); sub = null; }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uBytes(key) });
  await api("/api/push/subscribe", { method: "POST", body: { member_id: S.me, subscription: sub.toJSON() } });
  return sub;
}
async function pushDisable() {
  try {
    const sub = await pushSub(); if (!sub) return;
    await api("/api/push/unsubscribe", { method: "POST", body: { endpoint: sub.endpoint } }).catch(() => {});
    await sub.unsubscribe();
  } catch {}
}
/* On start and when the name changes: keep this device's subscription pointing at the right rower and the server's key. */
async function pushSync() {
  try {
    if (!S.me || !pushSupported() || Notification.permission !== "granted") return;
    const sub = await pushSub(); if (!sub) return;
    const { key } = await api("/api/push/key");
    if (!sameKey(sub, key)) return void await pushEnable();
    await api("/api/push/subscribe", { method: "POST", body: { member_id: S.me, subscription: sub.toJSON() } });
  } catch {}
}

function notificationsModal() {
  requireMe(async () => {
    const name = meName();
    let sub = null;
    try { sub = await pushSub(); } catch {}
    const what = `<ul style="margin:0;padding-left:20px;line-height:1.7">
        <li>Your crew is published</li><li>Someone takes the seat you asked a sub for</li>
        <li>You're put in a session, e.g. picked as someone's sub</li><li>The Isis flag goes Red or Black before your outing</li></ul>`;
    let body;
    if (isIOS() && !isStandalone()) {
      body = `<p style="margin:0">On iPhone and iPad, notifications only work once the planner is on your Home Screen:</p>
        <ol style="margin:0;padding-left:20px;line-height:1.7"><li>Tap the <b>Share</b> button in Safari</li><li>Choose <b>Add to Home Screen</b></li>
        <li>Open <b>RBC Outings</b> from your Home Screen, go to <b>Me</b> and turn notifications on there</li></ol>
        <p class="small faint" style="margin:0">Needs iOS 16.4 or later.</p>`;
    } else if (!pushSupported()) {
      body = `<div class="callout warn">${I.alert}<div>This browser can't show notifications. Try Chrome, Firefox, Edge or Safari, or add the planner to your home screen.</div></div>`;
    } else if (Notification.permission === "denied") {
      body = `<div class="callout warn">${I.alert}<div>Notifications are blocked for this site. Allow them in your browser or phone settings, then come back here.</div></div>`;
    } else {
      body = `<p style="margin:0">${sub ? `<span class="chip ok">${I.check}On for ${esc(name)}</span>` : `<span class="chip">Off on this device</span>`}</p>
        <p style="margin:0">Get a notification on this device when:</p>${what}
        <p class="small faint" style="margin:0">Notifications are for <b>${esc(name)}</b> and only go to devices where you turn them on. The flag is checked every hour.</p>`;
    }
    const can = pushSupported() && !(isIOS() && !isStandalone()) && Notification.permission !== "denied";
    modal({
      title: "Notifications",
      body,
      foot: can ? (sub
        ? `<button class="btn ghost" id="pn-off">Turn off</button><div class="r"><button class="btn" id="pn-test">${I.send}Send a test</button><button class="btn primary" data-close>Done</button></div>`
        : `<button class="btn ghost" data-close>Not now</button><div class="r"><button class="btn primary" id="pn-on">${I.bell}Turn on</button></div>`)
        : `<div class="r"><button class="btn primary" data-close>OK</button></div>`,
      onMount: (m, close) => {
        const on = $("#pn-on", m), off = $("#pn-off", m), test = $("#pn-test", m);
        if (on) on.onclick = async () => {
          on.disabled = true;
          try { await pushEnable(); toast("Notifications are on"); close(); notificationsModal(); } catch (e) { on.disabled = false; fail(e); }
        };
        if (off) off.onclick = async () => { await pushDisable(); toast("Notifications are off on this device"); close(); };
        if (test) test.onclick = async () => {
          test.disabled = true;
          try { await api("/api/push/test", { method: "POST", body: { endpoint: sub.endpoint } }); toast("Test sent. It should arrive in a few seconds"); }
          catch (e) { fail(e); } finally { test.disabled = false; }
        };
      },
    });
  });
}

// ------------------------------------------------------------------- subs --
/* Searchable rower picker for a sub, with each person's eligibility for the seat. */
function subPicker(el, cands, excludeId, onChange) {
  return combo(el, {
    items: () => S.boot.members.filter((x) => x.id !== excludeId).map((x) => { const c = cands[x.id] || { ok: false, problems: [] }; return { id: x.id, label: x.name, c, dim: !c.ok, cls: c.ok ? "" : "bad", rank: c.ok ? 0 : 1 }; }),
    renderWhy: (i) => i.c.ok ? `<span class="chip ok">OK</span>` : `<span class="chip bad">${esc(i.c.problems.join(" · "))}</span>`,
    placeholder: "Search rowers…",
    onChange,
  });
}

function requestSub(o) {
  requireMe(async () => {
    const seat = o.seats.find((s) => s.member && s.member.id === S.me);
    if (!seat) return toast("You're not in this session", true);
    let cands = {};
    try { cands = await api(`/api/outings/${o.id}/sub-candidates?member_id=${S.me}`); } catch (e) { return fail(e); }
    const what = `<b>${esc(seat.label)}</b> seat for <b>${esc(o.title || (o.kind === "water" ? "Water outing" : "Land training"))}</b> on <b>${fmtLong(o.date)}${o.time ? " at " + esc(o.time) : ""}</b>`;
    modal({
      title: "Can't make it?",
      body: `<div class="seg" id="rs-mode" style="display:flex"><button data-m="board" class="on" style="flex:1;justify-content:center">Find me a sub</button><button data-m="found" style="flex:1;justify-content:center">I've found a sub</button></div>
        <div id="rs-board"><div class="callout">${I.info}<div>You stay in the ${what} until someone takes it from the sub board. Your outing count moves to them.</div></div></div>
        <div id="rs-found" hidden><div class="callout">${I.info}<div>Arranged a sub yourself? Pick them and the ${what} moves straight to them, along with the outing count.</div></div>
          <label class="field"><span>Who's taking your seat?</span><div id="rs-who"></div></label></div>
        <label class="field"><span>Reason (optional)</span><input class="input" id="rs-reason" maxlength="300" placeholder="e.g. Lab meeting moved"></label>`,
      foot: `<div class="r"><button class="btn" data-close>Cancel</button><button class="btn primary" id="rs-go">${I.swap}Post to sub board</button></div>`,
      onMount: (m, close) => {
        let mode = "board";
        const go = $("#rs-go", m);
        const ctl = subPicker($("#rs-who", m), cands, S.me, () => sync());
        const sync = () => {
          $$("#rs-mode button", m).forEach((b) => b.classList.toggle("on", b.dataset.m === mode));
          $("#rs-board", m).hidden = mode !== "board";
          $("#rs-found", m).hidden = mode !== "found";
          go.innerHTML = mode === "board" ? `${I.swap}Post to sub board` : `${I.check}Hand over seat`;
          const who = ctl.get();
          go.disabled = mode === "found" && !(who && cands[who]?.ok);
        };
        $$("#rs-mode button", m).forEach((b) => b.onclick = () => { mode = b.dataset.m; sync(); });
        go.onclick = async () => {
          const body = { outing_id: o.id, member_id: S.me, reason: $("#rs-reason", m).value };
          if (mode === "found") {
            if (!ctl.get()) return toast("Pick your sub first", true);
            body.sub_id = ctl.get();
          }
          try { await api("/api/subs", { method: "POST", body }); close(); toast(mode === "found" ? "Seat handed over" : "Sub request posted"); refreshSubsCount(); route(); }
          catch (e) { fail(e); }
        };
        sync();
      },
    });
  });
}

async function fillSub(subId) {
  const committee = isCommittee();
  let subs;
  try { subs = await api("/api/subs"); } catch (e) { return fail(e); }
  const sr = subs.open.find((x) => x.id === subId);
  if (!sr) { toast("That request is no longer open", true); return route(); }
  const go = async () => {
    let cands = {};
    try { cands = await api(`/api/subs/${subId}/candidates`); } catch (e) { return fail(e); }
    const mine = sr.requester.id === S.me;
    const summary = `<div class="kv"><dt>Session</dt><dd>${esc(sr.outing.title || (sr.outing.kind === "water" ? "Water outing" : "Land training"))}</dd>
      <dt>When</dt><dd>${fmtLong(sr.outing.date)}${sr.outing.time ? " · " + esc(sr.outing.time) : ""}</dd>
      ${sr.outing.location ? `<dt>Where</dt><dd>${esc(sr.outing.location)}</dd>` : ""}
      ${sr.outing.boat ? `<dt>Boat</dt><dd>${esc(sr.outing.boat)}</dd>` : ""}
      <dt>Seat</dt><dd>${esc(sr.seat_label)} (for ${esc(sr.requester.name)})</dd></div>
      ${sr.reason ? `<div class="reason" style="background:var(--surface-2);padding:8px 10px;border-radius:10px;font-style:italic" class="muted">“${esc(sr.reason)}”</div>` : ""}`;
    let body, foot;
    if (mine && !committee) {
      body = summary + `<div class="callout">${I.info}<div>This is your own request. Found a sub yourself? Pick them below to hand over the seat. Or cancel the request if you can make it after all.</div></div>
        <label class="field"><span>Who's taking your seat?</span><div id="fs-who"></div></label>`;
      foot = `<button class="btn danger" id="fs-cancel">Cancel my request</button><div class="r"><button class="btn" data-close>Close</button><button class="btn primary" id="fs-go" disabled>${I.check}Hand over seat</button></div>`;
    } else if (committee) {
      body = summary + `<label class="field"><span>Who's taking the seat?</span><div id="fs-who"></div></label><div id="fs-st"></div>`;
      foot = `<button class="btn danger" id="fs-cancel">Cancel request</button><div class="r"><button class="btn" data-close>Close</button><button class="btn primary" id="fs-go">Assign sub</button></div>`;
    } else {
      const c = cands[S.me] || { ok: false, problems: ["Unknown"] };
      body = summary + (c.ok ? `<div class="callout">${I.check}<div>You're good to go, <b>${esc(meName())}</b>. The seat and outing count move to you.${c.note ? `<br><span class="faint">${esc(c.note)}</span>` : ""}</div></div>`
        : `<div class="callout bad">${I.alert}<div>You can't take this seat: <b>${esc(c.problems.join("; "))}</b>.</div></div>`);
      foot = `<div class="r"><button class="btn" data-close>Close</button><button class="btn primary" id="fs-go" ${c.ok ? "" : "disabled"}>${I.check}I'll sub</button></div>`;
    }
    modal({
      title: "Sub needed", body, foot,
      onMount: (m, close) => {
        const g = $("#fs-go", m);
        const picks = committee || mine;
        const ctl = picks ? subPicker($("#fs-who", m), cands, sr.requester.id, (v) => { if (!committee) g.disabled = !(v && cands[v]?.ok); }) : null;
        if (g) g.onclick = async () => {
          const who = picks ? ctl.get() : S.me;
          if (!who) return toast("Pick someone first", true);
          try { await api(`/api/subs/${subId}/fill`, { method: "POST", body: { member_id: who, by: S.me } }); close(); toast(mine && !committee ? "Seat handed over" : "Seat taken — thanks!"); refreshSubsCount(); route(); }
          catch (e) { fail(e); }
        };
        const c = $("#fs-cancel", m);
        if (c) c.onclick = async () => {
          try { await api(`/api/subs/${subId}/cancel`, { method: "POST", body: { member_id: S.me } }); close(); toast("Request cancelled"); refreshSubsCount(); route(); }
          catch (e) { fail(e); }
        };
      },
    });
  };
  if (committee) go(); else requireMe(go);
}

async function refreshCounts() {
  const get = async (key, path, n) => { try { setCount(key, n(await api(path))); } catch {} };
  get("subs", "/api/subs", (d) => d.open.length);
  get("issues", "/api/issues", (d) => d.issues.filter((i) => d.active.includes(i.status)).length);
  if (isCommittee()) get("reminders", "/api/committee/subs-reminders", (d) => d.members.length);
  if (isCommittee()) get("todo", "/api/committee/tasks", taskAttention);
  if (isCommittee()) get("incidents", "/api/committee/incidents/summary", (d) => d.open);
}
const refreshSubsCount = refreshCounts;

async function pageSubs() {
  let data;
  try { data = await api("/api/subs"); } catch (e) { return fail(e); }
  setCount("subs", data.open.length);
  const card = (s, filled) => {
    const d = pd(s.outing.date);
    return `<article class="card sub">
      <div class="sub-when"><div class="datebox"><span>${DAY[dow(s.outing.date)]}</span><b>${d.getUTCDate()}</b><span>${MON[d.getUTCMonth()]}</span></div>
        <div style="flex:1;min-width:0"><div style="font-weight:700">${esc(s.outing.title || (s.outing.kind === "water" ? "Water outing" : "Land training"))}</div>
          <div class="o-sub">${s.outing.time ? `<span>${esc(tRange(s.outing))}</span>` : ""}${s.outing.location ? `<span>${I.pin}${esc(s.outing.location)}</span>` : ""}${s.outing.boat ? `<span>${I.boat}${esc(s.outing.boat)}</span>` : ""}</div></div>
        <span class="chip ${s.outing.kind}">${s.outing.kind === "water" ? I.water : I.land}${esc(s.seat_label)}</span></div>
      <div class="small">${filled ? `<b>${esc(s.sub?.name)}</b> is subbing for ${esc(s.requester.name)}` : `<b>${esc(s.requester.name)}</b> needs a sub${s.requester.id === S.me ? ` <span class="chip accent">you</span>` : ""}`}</div>
      ${s.reason && !filled ? `<div class="reason">“${esc(s.reason)}”</div>` : ""}
      ${filled ? "" : `<div style="display:flex;gap:8px">${s.requester.id === S.me && !isCommittee() ? `<button class="btn" data-fill="${s.id}" style="flex:1">Manage request</button>` : `<button class="btn primary" data-fill="${s.id}" style="flex:1">${I.check}${isCommittee() ? "Assign a sub" : "I'll sub"}</button>`}</div>`}
    </article>`;
  };
  $("#main").innerHTML = `
    <div class="page-head"><div><h1>Sub board</h1><p>Can't make a session? Request a sub from your seat on the schedule. Free this week? Take an open seat below.</p></div></div>
    ${data.open.length ? `<div class="sub-list">${data.open.map((s) => card(s, false)).join("")}</div>` : `<div class="card empty">${I.check}<h3>All seats covered</h3><p>No open sub requests right now.</p></div>`}
    ${data.recent.length ? `<div class="section-title">Recently filled</div><div class="sub-list">${data.recent.slice().reverse().map((s) => card(s, true)).join("")}</div>` : ""}`;
  $$("[data-fill]").forEach((b) => b.onclick = () => fillSub(+b.dataset.fill));
  refreshSubsCount();
}

// --------------------------------------------------------------------- me --
async function pageMe() {
  if (!S.me || !meName()) {
    $("#main").innerHTML = `<div class="card empty">${I.user}<h3>Who are you?</h3><p>Pick your name to see your outings and counts.</p><button class="btn primary" id="pick">Choose my name</button></div>`;
    $("#pick").onclick = () => pickIdentity();
    return;
  }
  let d;
  try { d = await api(`/api/members/${S.me}/summary`); } catch (e) { return fail(e); }
  const t = d.totals, st = d.status;
  const free = t.novice_free_left;
  $("#main").innerHTML = `
    <div class="page-head"><div><h1>${esc(d.member.name)}</h1><p><span class="chip ${d.member.category === "Novice" ? "accent" : ""}">${esc(d.member.category)}</span> ${d.member.cox_status ? `<span class="chip violet">Cox · ${({ N: "Novice", X: "Experienced", S: "Senior" })[d.member.cox_status]}</span>` : ""}</p></div>
      <div class="toolbar"><button class="btn" id="me-notify">${I.bell}Notifications</button><button class="btn" id="me-cal">${I.calendar}Add to calendar</button><button class="btn" id="switch">${I.swap}Not you?</button></div></div>
    <div class="stats">
      <div class="card stat"><div class="k">Water outings</div><div class="v">${t.water}</div><div class="s">${t.water_done} done</div></div>
      <div class="card stat"><div class="k">Land sessions</div><div class="v">${t.land}</div><div class="s">${t.land_done} done</div></div>
      <div class="card stat"><div class="k">Total</div><div class="v">${t.total}</div><div class="s">${t.upcoming} upcoming</div></div>
      ${free != null ? `<div class="card stat"><div class="k">Free novice outings</div><div class="v">${free}</div><div class="s">of ${S.boot.settings.novice_free_outings} left</div></div>` : ""}
    </div>
    <a class="card card-pad lb-teaser" href="#/stats"><span class="lb-ico">🏆</span><div><b>See how you rank this season</b><div class="small faint">Streaks, early-bird and super-sub awards, milestones and more</div></div>${I.right}</a>
    <div class="section-title">Eligibility for your next outing</div>
    <div class="card card-pad"><div style="display:flex;gap:10px;flex-wrap:wrap">
      <span class="chip ${st.water_ok ? "ok" : "bad"}">${st.water_ok ? I.check : I.x}Water${st.water_reasons.length ? ": " + esc(st.water_reasons.join(", ")) : ""}</span>
      <span class="chip ${st.land_ok ? "ok" : "bad"}">${st.land_ok ? I.check : I.x}Land${st.land_reasons.length ? ": " + esc(st.land_reasons.join(", ")) : ""}</span>
      <span class="chip ${st.subs_valid ? "ok" : "warn"}">Subs ${st.subs_valid ? "paid" : "not paid for this term"}</span>
      <span class="chip ${!st.swim_test || st.swim.state === "soon" ? "warn" : st.swim.state === "expired" ? "bad" : "ok"}">Swim test ${!st.swim_test ? "not recorded" : st.swim.state === "expired" ? `expired ${esc(fmtYear(st.swim.expires))}` : st.swim.expires ? `valid until ${esc(fmtYear(st.swim.expires))}` : "passed"}</span>
      ${st.cox.expires ? `<span class="chip ${st.cox.state === "expired" ? "bad" : st.cox.state === "soon" ? "warn" : "ok"}">Cox status ${st.cox.state === "expired" ? "expired" : "valid until"} ${esc(fmtYear(st.cox.expires))}</span>` : ""}
    </div><p class="small faint" style="margin:10px 0 0">Something wrong? Speak to a committee member.</p></div>
    <div class="section-title">Upcoming sessions</div>
    ${d.upcoming.length ? `<div class="days" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr))">${d.upcoming.map((o) => `<div><div class="day-head"><b>${DAY[dow(o.date)]}</b><span>${fmtShort(o.date)}</span></div>${outingCard(o)}</div>`).join("")}</div>`
      : `<div class="card empty">${I.calendar}<h3>Nothing scheduled</h3><p>You're not in any published upcoming sessions. Check the sub board for open seats.</p></div>`}`;
  $("#switch").onclick = () => pickIdentity();
  $("#me-cal").onclick = () => calendarModal();
  $("#me-notify").onclick = () => notificationsModal();
  $$(".outing").forEach((card) => card.addEventListener("click", (e) => {
    const t = e.target.closest("[data-act]"); if (!t) return;
    const o = d.upcoming.find((x) => x.id === +card.dataset.oid);
    if (t.dataset.act === "reqsub") requestSub(o);
    if (t.dataset.act === "fill") fillSub(+t.dataset.sub);
    if (t.dataset.act === "leave") leaveLand(o);
  }));
}

// ------------------------------------------------------------ leaderboard --
const BOARD_ICON = { water: "🚣", land: "🏋️", total: "⭐", early: "🌅", late: "🌙", weekend: "📅", cox: "📣", subs: "🦸", streak: "🔥", boats: "🛶" };
const MEDAL = ["🥇", "🥈", "🥉"];
const plural = (n, unit) => `${n} ${n === 1 ? unit.replace(/s$/, "") : unit}`;

/* Term attendance: how many sessions went ahead, how many were lost and why. */
function outcomesCard(oc, archived) {
  if (!oc) return "";
  // An archived season shows the whole season rather than its last term.
  const t = archived ? oc.season : oc.term, ss = oc.season, total = t.happened + t.cancelled;
  const when = archived ? "this season" : "this term";
  if (!total) return "";
  const pct = Math.round((t.happened / total) * 100);
  const top = t.by_reason[0];
  const unit = (r) => (r.land ? "sessions" : "outings");
  const head = !top ? `Every session went ahead ${when}`
    : top.key ? `${plural(top.count, unit(top))} lost to ${LOST_TO[top.key]} ${when}` : `${plural(top.count, unit(top))} cancelled ${when}`;
  const max = Math.max(1, ...t.by_reason.map((r) => r.count));
  const seasonLine = !archived && ss.since !== t.since ? `<div class="small faint oc-season">Whole season since ${esc(fmtShort(ss.since))}: ${ss.happened} went ahead · ${ss.cancelled} cancelled</div>` : "";
  return `<div class="section-title">${archived ? `The ${esc(archived)} season` : `${esc(oc.term_name)} so far`}</div>
    <div class="card oc-card">
      <div class="oc-head"><div class="oc-line">${top ? I.x : I.check}<b>${esc(head)}</b></div>
        <div class="small faint">${t.happened} of ${plural(total, "sessions")} went ahead (${pct}%) since ${esc(fmtShort(t.since))}</div></div>
      <div class="oc-split" role="img" aria-label="${t.happened} went ahead, ${t.cancelled} cancelled"><i class="ok" style="flex:${t.happened}"></i><i class="bad" style="flex:${t.cancelled}"></i></div>
      <div class="oc-legend small"><span><i class="sw" style="background:var(--ok)"></i>Went ahead ${t.happened} <span class="faint">(${t.water.happened} water · ${t.land.happened} land)</span></span>
        <span><i class="sw" style="background:var(--bad)"></i>Cancelled ${t.cancelled}${t.cancelled ? ` <span class="faint">(${t.water.cancelled} water · ${t.land.cancelled} land)</span>` : ""}</span></div>
      ${t.by_reason.length ? `<div class="oc-reasons">${t.by_reason.map((r) => `<div class="oc-r"><span>${esc(r.label)}</span><div class="bar bad"><i style="width:${(r.count / max) * 100}%"></i></div><b class="tnum">${r.count}</b></div>`).join("")}</div>` : ""}
      ${seasonLine}
    </div>`;
}

function meStatsCard(p, boards, archived) {
  if (!p) return "";
  const ms = p.milestone;
  const pct = ms.next ? Math.round(((p.all_time - ms.reached) / (ms.next - ms.reached)) * 100) : 100;
  const ranks = boards.map((b) => ({ b, r: b.me[String(S.me)] })).filter((x) => x.r && x.r.rank <= 10).sort((a, b) => a.r.rank - b.r.rank).slice(0, 4);
  return `<div class="card card-pad lb-me">
    <div class="lb-me-head"><span class="avatar">${esc(initials(meName()))}</span><div><b>${esc(meName())}</b><div class="small faint">${plural(p.season_total, "sessions")} ${archived ? `in ${esc(archived)}` : "this season"} · ${plural(p.all_time, "sessions")} all time${archived ? " by then" : ""}</div></div></div>
    <div class="lb-progress"><div class="small"><b>${ms.next ? `${plural(ms.to_go, "sessions")} to your ${ms.next}${ms.next === 1 ? "st" : "th"} session` : "Every milestone reached. Legend!"}</b></div><div class="bar"><i style="width:${pct}%"></i></div></div>
    <div class="lb-me-grid">
      ${archived ? `<div><div class="k">Best streak</div><div class="v">${plural(p.streak, "weeks")}</div><div class="s">in a row with a session</div></div>`
        : `<div><div class="k">Current streak</div><div class="v">${p.current_streak ? "🔥 " : ""}${plural(p.current_streak, "weeks")}</div><div class="s">best ${plural(p.streak, "weeks")}</div></div>`}
      <div><div class="k">Early starts</div><div class="v">${p.early}</div><div class="s">before 08:00</div></div>
      <div><div class="k">Subs filled</div><div class="v">${p.subs}</div><div class="s">seats saved</div></div>
      <div><div class="k">Boat buddy</div><div class="v lb-small">${p.buddy ? esc(p.buddy.name) : "–"}</div><div class="s">${p.buddy ? `${plural(p.buddy.value, "outings")} together` : "row more to find one"}</div></div>
    </div>
    ${p.badges.length || ranks.length ? `<div class="lb-badges">${p.badges.map((b) => `<span class="chip ok">🏆 ${esc(b)}</span>`).join("")}${ranks.filter((x) => !p.badges.includes(x.b.title)).map((x) => `<span class="chip accent">#${x.r.rank} ${esc(x.b.title)}</span>`).join("")}</div>` : ""}
  </div>`;
}

async function pageStats() {
  let d, archives = [];
  try {
    [d, archives] = await Promise.all([
      api(S.statsArchive ? `/api/stats/archives/${S.statsArchive}` : "/api/stats"),
      api("/api/stats/archives").then((r) => r.archives).catch(() => [])]);
  } catch (e) {
    if (S.statsArchive) { S.statsArchive = null; return pageStats(); }   // archive gone: back to this season
    return fail(e);
  }
  const arch = d.archive, archived = arch ? arch.academic_year : null;
  const c = d.club, me = S.me && meName() ? d.people[String(S.me)] : null;
  const diff = c.this_week - c.last_week;
  const boardCard = (b) => {
    const mine = S.me ? b.me[String(S.me)] : null;
    const inTop = mine && b.entries.some((e) => e.id === S.me);
    return `<div class="card lb-board">
      <div class="lb-title"><span class="lb-ico">${BOARD_ICON[b.key] || "🏅"}</span><div><b>${esc(b.title)}</b><div class="small faint">${esc(b.desc)}</div></div></div>
      ${b.entries.length ? `<ol class="lb-list">${b.entries.map((e) => `<li class="${e.id === S.me ? "you" : ""}"><span class="lb-rank">${MEDAL[e.rank - 1] || e.rank}</span><span class="lb-name">${esc(e.name)}${e.id === S.me ? ` <span class="chip accent">you</span>` : ""}</span><span class="lb-val">${e.value}</span></li>`).join("")}
        ${mine && !inTop ? `<li class="you lb-gap"><span class="lb-rank">${mine.rank}</span><span class="lb-name">You</span><span class="lb-val">${mine.value}</span></li>` : ""}</ol>`
        : `<p class="small faint lb-empty">Up for grabs: nobody yet!</p>`}
    </div>`;
  };
  $("#main").innerHTML = `
    <div class="page-head"><div><h1>Leaderboard${archived ? ` <span class="faint">${esc(archived)}</span>` : ""}</h1><p>${arch
        ? `Awards from the ${esc(archived)} season, ${esc(fmtShort(arch.season_start))} to ${esc(fmtShort(arch.season_end))}, as they stood at the handover.`
        : `Season awards since ${esc(fmtShort(d.season_start))}. Sessions count once they've happened; cancelled ones don't.`}</p></div>
      ${!me || archives.length ? `<div class="toolbar">${archives.length ? `<select class="input" id="lb-season" style="width:auto" aria-label="Season"><option value="">This season</option>${archives.map((a) => `<option value="${a.id}" ${a.id === S.statsArchive ? "selected" : ""}>${esc(a.academic_year)}</option>`).join("")}</select>` : ""}
        ${!me ? `<button class="btn" id="lb-pick">${I.user}Show my stats</button>` : ""}</div>` : ""}</div>
    <div class="stats" style="margin-bottom:16px">
      <div class="card stat"><div class="k">Seats filled</div><div class="v">${c.seat_sessions}</div><div class="s">across ${plural(c.sessions, "sessions")}</div></div>
      ${archived ? `<div class="card stat"><div class="k">Sessions</div><div class="v">${c.sessions}</div><div class="s">went ahead all season</div></div>`
        : `<div class="card stat"><div class="k">This week so far</div><div class="v">${c.this_week}</div><div class="s">${diff > 0 ? `▲ ${diff} on last week` : diff < 0 ? `${c.last_week} last week, catch up!` : `same as last week`}</div></div>`}
      <div class="card stat"><div class="k">Rowers out</div><div class="v">${c.active_rowers}</div><div class="s">at least one session</div></div>
      <div class="card stat"><div class="k">Subs filled</div><div class="v">${c.subs_filled}</div><div class="s">${c.busiest_day != null ? `busiest day: ${DAYL[c.busiest_day]}` : "teamwork!"}</div></div>
    </div>
    ${outcomesCard(d.outcomes, archived)}
    ${me ? meStatsCard(me, d.boards, archived) : ""}
    <div class="section-title">Awards</div>
    <div class="lb-grid">${d.boards.map(boardCard).join("")}
      <div class="card lb-board">
        <div class="lb-title"><span class="lb-ico">🤝</span><div><b>Crew chemistry</b><div class="small faint">Pairs who've been in the same boat most often</div></div></div>
        ${d.pairs.length ? `<ol class="lb-list">${d.pairs.map((p, i) => `<li class="${p.ids.includes(S.me) ? "you" : ""}"><span class="lb-rank">${MEDAL[i] || i + 1}</span><span class="lb-name">${esc(p.a)} &amp; ${esc(p.b)}</span><span class="lb-val">${p.value}</span></li>`).join("")}</ol>` : `<p class="small faint lb-empty">No crews on the water yet.</p>`}
      </div>
    </div>`;
  const pk = $("#lb-pick"); if (pk) pk.onclick = () => pickIdentity();
  const sel = $("#lb-season"); if (sel) sel.onchange = () => { S.statsArchive = +sel.value || null; pageStats(); };
}

// ----------------------------------------------------------------- rowers --
let rowerSort = { k: "name", dir: 1 }, rowerQ = "", rowerCat = "all";

async function pageRowers() {
  const committee = isCommittee();
  let rows, meta = {}, nRem = 0, cttee = {};
  api("/api/club-committee").then((d) => { cttee = committeeByMember(d); if ($("#rw-table")) draw(); }).catch(() => {});
  try {
    if (committee) {
      const [r, rem] = await Promise.all([api("/api/committee/members"), api("/api/committee/subs-reminders")]);
      rows = r.members.map((m) => ({ ...m, ...m.totals })); meta = r; nRem = rem.members.length; setCount("reminders", nRem);
    }
    else rows = await api("/api/rowers");
  } catch (e) { return fail(e); }
  const draw = () => {
    let list = rows.filter((r) => (!rowerQ || fold(r.name).includes(rowerQ)) && (rowerCat === "all" || (rowerCat === "inactive" ? !r.active : rowerCat === "issues" ? (r.active !== false && (!r.water_ok || !r.land_ok)) : rowerCat === "expiring" ? (r.active && [r.swim?.state, r.cox?.state].some((x) => x === "soon" || x === "expired")) : r.category === rowerCat && r.active !== false)));
    if (rowerCat !== "inactive" && committee) list = list.filter((r) => rowerCat === "all" || r.active);
    const k = rowerSort.k;
    list.sort((a, b) => (typeof a[k] === "string" ? a[k].localeCompare(b[k]) : (a[k] ?? -1) - (b[k] ?? -1)) * rowerSort.dir || a.name.localeCompare(b.name));
    const max = Math.max(1, ...rows.map((r) => r.total));
    const th = (key, l, cls = "") => `<th class="sort ${cls}" data-k="${key}">${l}${rowerSort.k === key ? (rowerSort.dir > 0 ? " ↑" : " ↓") : ""}</th>`;
    $("#rw-table").innerHTML = `<table class="t"><thead><tr>${th("name", "Name")}${th("category", "Category")}
      ${committee ? `<th>Swim</th><th>Subs</th>${th("cox_status", "Cox")}<th title="At their next new outing, counting everything already scheduled">May row next</th>` : `${th("cox_status", "Cox")}`}
      ${th("water", "Water", "num")}${th("land", "Land", "num")}${th("total", "Total", "num")}<th style="width:120px"></th>${th("novice_free_left", "Free left", "num")}</tr></thead>
      <tbody>${list.map((r) => `<tr class="${committee ? "clickable" : ""}" data-id="${r.id}">
        <td><b>${esc(r.name)}</b>${cttee[r.id] ? ` ${committeeBadge(cttee[r.id])}` : ""}${r.id === S.me ? ` <span class="chip accent">you</span>` : ""}${committee && !r.active ? ` <span class="chip">inactive</span>` : ""}${committee && r.needs_review ? ` <span class="chip warn" title="Added through the sign-up form — check their details">New</span>` : ""}</td>
        <td><span class="chip ${r.category === "Novice" ? "accent" : ""}">${esc(r.category)}</span></td>
        ${committee ? `<td>${!r.swim_test ? `<span class="chip warn">No</span>` : r.swim.state === "expired" || r.swim.state === "soon" ? expiryChip(r.swim, "Swim test") : `<span class="chip ok" title="${r.swim.expires ? `Valid until ${esc(fmtYear(r.swim.expires))}` : "Date not recorded"}">${I.check}Yes</span>`}</td>
          <td>${r.subs_valid ? `<span class="chip ok">${esc(r.subs_plan === "Full year" ? "Full year" : r.subs_term)}</span>` : `<span class="chip ${r.subs_plan === "Unpaid" ? "warn" : "bad"}" title="${esc(r.subs_plan)} ${esc(r.subs_term)} ${esc(r.subs_year)}">${r.subs_plan === "Unpaid" ? "Unpaid" : "Expired"}</span>`}</td>
          <td>${r.cox_status ? `<span class="chip violet" title="${r.cox.expires ? `Valid until ${esc(fmtYear(r.cox.expires))}` : "Date not recorded"}">${esc(r.cox_status)}</span>${expiryChip(r.cox, "Cox status")}` : ""}</td>
          <td>${r.water_ok && r.land_ok ? `<span class="chip ok">${I.check}Yes</span>` : `<span class="chip bad" title="${esc([...r.water_reasons.map((x) => "Water: " + x), ...r.land_reasons.map((x) => "Land: " + x)].join("\n"))}">${!r.water_ok && !r.land_ok ? "No" : r.water_ok ? "Water only" : "Land only"}</span>`}</td>`
          : `<td>${r.cox_status ? `<span class="chip violet">${esc(r.cox_status)}</span>` : ""}</td>`}
        <td class="num">${r.water}</td><td class="num">${r.land}</td><td class="num"><b>${r.total}</b></td>
        <td><div class="bar"><i style="width:${(r.total / max) * 100}%"></i></div></td>
        <td class="num">${r.novice_free_left ?? ""}</td></tr>`).join("") || `<tr><td colspan="12" class="faint" style="text-align:center;padding:30px">No one matches.</td></tr>`}</tbody></table>`;
    $$("#rw-table th.sort").forEach((t) => t.onclick = () => { rowerSort = { k: t.dataset.k, dir: rowerSort.k === t.dataset.k ? -rowerSort.dir : (t.dataset.k === "name" || t.dataset.k === "category" ? 1 : -1) }; draw(); });
    if (committee) $$("#rw-table tr[data-id]").forEach((tr) => tr.onclick = () => editMember(rows.find((r) => r.id === +tr.dataset.id), meta));
    $("#rw-count").textContent = `${list.length} shown`;
  };
  const novices = rows.filter((r) => r.category === "Novice" && r.active !== false).length;
  const issues = committee ? rows.filter((r) => r.active && (!r.water_ok || !r.land_ok)).length : 0;
  const allOut = rows.reduce((a, r) => a + r.total, 0);
  $("#main").innerHTML = `
    <div class="page-head"><div><h1>${committee ? "Members" : "Rowers"}</h1><p>${committee ? "Manage the squad, subs and swim tests. Outing counts update automatically from the schedule." : "Outing counts across the squad."}</p></div>
      ${committee ? `<div class="toolbar"><button class="btn" id="rw-export">${I.download}Export CSV</button><button class="btn primary" id="rw-add">${I.plus}Add member</button></div>` : `<div class="toolbar"><button class="btn primary" id="rw-add">${I.plus}Add rower</button></div>`}</div>
    <div class="stats" style="margin-bottom:16px">
      <div class="card stat"><div class="k">Members</div><div class="v">${rows.filter((r) => r.active !== false).length}</div><div class="s">${novices} novice · ${rows.filter((r) => r.active !== false).length - novices} senior</div></div>
      <div class="card stat"><div class="k">Coxes</div><div class="v">${rows.filter((r) => r.cox_status && r.active !== false).length}</div><div class="s">with a cox status</div></div>
      <div class="card stat"><div class="k">Outings logged</div><div class="v">${allOut}</div><div class="s">seat-sessions, all time</div></div>
      ${committee ? `<div class="card stat"><div class="k">Can't row next outing</div><div class="v" style="color:${issues ? "var(--bad)" : "var(--ok)"}">${issues}</div><div class="s">subs or swim test missing</div></div>` : ""}
    </div>
    <div class="filters">
      <input class="input" id="rw-q" placeholder="Search names…" style="max-width:260px" value="${esc(rowerQ)}">
      <div class="seg" id="rw-cat">${[["all", "All"], ["Novice", "Novice"], ["Senior", "Senior"], ...(committee ? [["issues", "Can't row"], ["expiring", "Expiring"], ["inactive", "Inactive"]] : [])].map(([k, l]) => `<button data-c="${k}" class="${rowerCat === k ? "on" : ""}">${l}</button>`).join("")}</div>
      <span class="faint small" id="rw-count" style="margin-left:auto"></span>
    </div>
    <div class="card table-wrap" id="rw-table"></div>`;
  $("#rw-q").oninput = (e) => { rowerQ = fold(e.target.value.trim()); draw(); };
  $$("#rw-cat button").forEach((b) => b.onclick = () => { rowerCat = b.dataset.c; $$("#rw-cat button").forEach((x) => x.classList.toggle("on", x === b)); draw(); });
  if (committee) { $("#rw-add").onclick = () => editMember(null, meta); $("#rw-export").onclick = () => exportModal("/api/committee/members.csv", "all members"); }
  else $("#rw-add").onclick = addRower;
  draw();
}

// Any rower can add a name; subs, swim test, category etc. are left for the committee to set.
function addRower() {
  modal({
    title: "Add rower",
    body: `
      <label class="field"><span>Full name</span><input class="input" id="ar-name" placeholder="First and last name" required></label>
      <div class="grid-2">
        <label class="field"><span>College</span><input class="input" id="ar-college" list="ar-colleges"><datalist id="ar-colleges"><option value="Reuben"><option value="Blackfriars"><option value="St Stephen's House"></datalist></label>
        <label class="field"><span>Side preference</span><select class="input" id="ar-side">${["", ...Object.keys(SIDE_SHORT)].map((x) => `<option value="${esc(x)}">${x || "—"}</option>`).join("")}</select></label>
      </div>
      <div class="callout">${I.info}<div>They're added as a novice. The committee will check their category, cox status, swim test and subs.</div></div>`,
    foot: `<div class="r"><button class="btn" data-close>Cancel</button><button class="btn primary" id="ar-save">Add</button></div>`,
    onMount: (el, close) => {
      $("#ar-name", el).focus();
      $("#ar-save", el).onclick = async () => {
        const body = { name: $("#ar-name", el).value.trim(), college: $("#ar-college", el).value.trim(), side: $("#ar-side", el).value };
        if (!body.name) return toast("Name is required", true);
        try { await api("/api/rowers", { method: "POST", body }); close(); toast(`${body.name} added`); await reboot(); pageRowers(); }
        catch (e) { fail(e); }
      };
    },
  });
}

function editMember(m, meta) {
  const terms = meta.terms || ["Michaelmas", "Hilary", "Trinity"];
  const v = m || { name: "", category: "Novice", swim_test: false, subs_plan: "Unpaid", subs_term: S.boot.settings.current_term, subs_year: S.boot.settings.academic_year, cox_status: "", past_water: 0, past_land: 0, active: true, notes: "" };
  modal({
    title: m ? "Edit member" : "Add member",
    body: `
      <div class="grid-2">
        <label class="field"><span>Full name</span><input class="input" id="me-name" value="${esc(v.name)}" required></label>
        <label class="field"><span>Category</span><select class="input" id="me-cat"><option ${v.category === "Novice" ? "selected" : ""}>Novice</option><option ${v.category === "Senior" ? "selected" : ""}>Senior</option></select></label>
      </div>
      <div class="grid-3">
        <label class="field"><span>Phone <span class="faint">(committee only · encrypted)</span></span>
          <div style="display:flex;gap:6px"><input class="input tnum" id="me-phone" type="tel" placeholder="${m && m.has_phone ? esc(m.phone_masked) : "Not on file"}">
          ${m && m.has_phone ? `<button type="button" class="btn sm" id="me-phone-show" title="Show the full number">Show</button><button type="button" class="btn sm danger" id="me-phone-del" title="Delete this number">Delete</button>` : ""}</div></label>
        <label class="field"><span>College</span><input class="input" id="me-college" list="me-colleges" value="${esc(v.college || "")}"><datalist id="me-colleges"><option value="Reuben"><option value="Blackfriars"><option value="St Stephen's House"></datalist></label>
        <label class="field"><span>Side preference</span><select class="input" id="me-side">${["", ...Object.keys(SIDE_SHORT)].map((x) => `<option value="${esc(x)}" ${(v.side || "") === x ? "selected" : ""}>${x || "—"}</option>`).join("")}</select></label>
        <label class="field"><span>Squad</span><select class="input" id="me-squad">${[["", "—"], ["open", "Open"], ["women", "Women's"]].map(([k, l]) => `<option value="${k}" ${(v.squad || "") === k ? "selected" : ""}>${l}</option>`).join("")}</select><span class="hint">Used to check race entries.</span></label>
      </div>
      <div class="grid-3">
        <label class="field"><span>Subs plan</span><select class="input" id="me-plan">${(meta.plans || ["Unpaid", "Single term", "Full year"]).map((p) => `<option ${v.subs_plan === p ? "selected" : ""}>${p}</option>`).join("")}</select></label>
        <label class="field" id="me-term-f"><span>Term covered</span><select class="input" id="me-term">${terms.map((t) => `<option ${v.subs_term === t ? "selected" : ""}>${t}</option>`).join("")}</select></label>
        <label class="field" id="me-year-f"><span>Academic year</span><input class="input" id="me-year" value="${esc(v.subs_year || S.boot.settings.academic_year)}" placeholder="2026-27"></label>
      </div>
      <div class="grid-2">
        <label class="field"><span>Coxing status</span><select class="input" id="me-cox">${[["", "Not a cox"], ["N", "N — Novice (needs bankrider)"], ["X", "X — Experienced"], ["S", "S — Senior"]].map(([k, l]) => `<option value="${k}" ${v.cox_status === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <div class="field"><span>&nbsp;</span><label class="check"><input type="checkbox" id="me-swim" ${v.swim_test ? "checked" : ""}> Swim test passed</label></div>
      </div>
      <div class="grid-2">
        <label class="field"><span>Cox status awarded</span><input class="input" type="date" id="me-coxd" max="${esc(S.boot.today)}" value="${esc(v.cox_status_date || "")}"><span class="hint" id="me-coxd-h"></span></label>
        <label class="field"><span>Swim test date</span><input class="input" type="date" id="me-swimd" max="${esc(S.boot.today)}" value="${esc(v.swim_test_date || "")}"><span class="hint" id="me-swimd-h"></span></label>
      </div>
      <div class="grid-3">
        <label class="field"><span>Earlier water outings</span><input class="input" type="number" min="0" id="me-pw" value="${v.past_water}"><span class="hint">Before using this app</span></label>
        <label class="field"><span>Earlier land sessions</span><input class="input" type="number" min="0" id="me-pl" value="${v.past_land}"></label>
        <div class="field"><span>&nbsp;</span><label class="check"><input type="checkbox" id="me-active" ${v.active ? "checked" : ""}> Active member</label></div>
      </div>
      <label class="field"><span>Committee notes</span><textarea class="input" id="me-notes" rows="2">${esc(v.notes)}</textarea></label>
      ${m && m.needs_review ? `<div class="callout warn">${I.alert}<div>Added through the sign-up form. Check category, cox status, swim test and subs, then save to mark as reviewed.</div></div>` : ""}
      ${m ? `<div class="callout">${I.info}<div>Totals: <b>${m.water}</b> water · <b>${m.land}</b> land (${m.upcoming} upcoming)${m.novice_free_left != null ? ` · <b>${m.novice_free_left}</b> free novice outings left` : ""}</div></div>` : ""}`,
    foot: `${m ? `<button class="btn danger" id="me-del">Delete</button>` : ""}<div class="r"><button class="btn" data-close>Cancel</button><button class="btn primary" id="me-save">Save</button></div>`,
    onMount: (el, close) => {
      const sync = () => { const p = $("#me-plan", el).value; $("#me-term-f", el).classList.toggle("hidden", p !== "Single term"); $("#me-year-f", el).classList.toggle("hidden", p === "Unpaid"); };
      $("#me-plan", el).onchange = sync; sync();
      // Expiry hints under the two dates (validity periods come from Settings).
      const vm = { swim: S.boot.settings.swim_test_valid_months, cox: S.boot.settings.cox_status_valid_months };
      const hint = (inp, h, months) => {
        const d = $(inp, el).value;
        if (!d) { $(h, el).textContent = "Optional. Leave blank if unknown (then it never expires)."; return; }
        if (!months) { $(h, el).textContent = "Doesn't expire (see Settings)."; return; }
        const x = pd(d); x.setUTCMonth(x.getUTCMonth() + months); const e = x.toISOString().slice(0, 10);
        $(h, el).textContent = `${e <= S.boot.today ? "Expired" : "Valid until"} ${fmtYear(e)}`;
      };
      const hints = () => { hint("#me-swimd", "#me-swimd-h", vm.swim); hint("#me-coxd", "#me-coxd-h", vm.cox); };
      $("#me-swimd", el).oninput = () => { if ($("#me-swimd", el).value) $("#me-swim", el).checked = true; hints(); };
      $("#me-coxd", el).oninput = hints; hints();
      // Phone: only sent when changed (null = keep the stored, encrypted number).
      let phoneTouched = false;
      const ph = $("#me-phone", el);
      ph.oninput = () => { phoneTouched = true; };
      const show = $("#me-phone-show", el), delp = $("#me-phone-del", el);
      if (show) show.onclick = async () => { try { ph.value = (await api(`/api/committee/members/${m.id}/phone`)).phone; phoneTouched = false; } catch (e) { fail(e); } };
      if (delp) delp.onclick = () => { ph.value = ""; ph.placeholder = "Will be deleted when you save"; phoneTouched = true; };
      $("#me-save", el).onclick = async () => {
        const body = { name: $("#me-name", el).value.trim(), category: $("#me-cat", el).value, subs_plan: $("#me-plan", el).value,
          subs_term: $("#me-plan", el).value === "Single term" ? $("#me-term", el).value : "", subs_year: $("#me-plan", el).value === "Unpaid" ? "" : $("#me-year", el).value.trim(),
          cox_status: $("#me-cox", el).value, swim_test: $("#me-swim", el).checked,
          swim_test_date: $("#me-swimd", el).value, cox_status_date: $("#me-coxd", el).value, past_water: +$("#me-pw", el).value || 0, past_land: +$("#me-pl", el).value || 0,
          active: $("#me-active", el).checked, notes: $("#me-notes", el).value,
          phone: phoneTouched ? $("#me-phone", el).value.trim() : (m ? null : ($("#me-phone", el).value.trim() || null)), college: $("#me-college", el).value.trim(), side: $("#me-side", el).value, squad: $("#me-squad", el).value };
        if (!body.name) return toast("Name is required", true);
        try { await api(m ? `/api/committee/members/${m.id}` : "/api/committee/members", { method: m ? "PUT" : "POST", body }); close(); toast("Saved"); await reboot(); pageRowers(); }
        catch (e) { fail(e); }
      };
      const d = $("#me-del", el);
      if (d) d.onclick = async () => {
        if (!await confirmBox(`Delete ${esc(m.name)}?`, "They'll be removed from every session they're in. To keep their history, untick “Active member” instead.", "Delete", true)) return;
        try { await api(`/api/committee/members/${m.id}`, { method: "DELETE" }); toast("Member deleted"); await reboot(); pageRowers(); } catch (e) { fail(e); }
      };
    },
  });
}

// ---------------------------------------------------------- subs reminders --
const REM_TIERS = {
  blocked: { title: "Can't do sessions they're down for", cls: "bad", hint: "Already scheduled, but blocked until subs are paid. Contact these first." },
  now: { title: "Must pay before their next outing", cls: "warn", hint: "Free novice outings used up, or a senior past the subs cutoff." },
  cutoff: { title: "Must pay by the subs cutoff", cls: "warn", hint: "They can still row until the cutoff date, but will need subs after it." },
  soon: { title: "1 free novice outing left", cls: "accent", hint: "A heads-up: after their next water outing they'll need subs." },
};
const daysAgo = (ts) => { const d = Math.floor((Date.now() - Date.parse(ts.replace(" ", "T") + "Z")) / 86400000); return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`; };
const sessLabel = (o) => `${o.title || (o.kind === "water" ? "water outing" : "land training")} on ${DAY[dow(o.date)]} ${fmtShort(o.date)}${o.time ? " at " + tRange(o) : ""}`;

/* The "{reason}" sentence for a person's situation (no full stop: the template continues). */
function remReason(x, d) {
  const n = x.free_n;
  if (x.category !== "Novice") return `Your subs for ${d.term} ${d.year} haven’t been paid yet`;
  if (x.tier === "soon") return `After your next water outing you will have reached ${n} water outings`;
  if (!x.reach_date || x.reach_date <= d.today) return `You have now reached ${n} water outings`;
  const sunday = addDays(d.today, 6 - dow(d.today));
  return x.reach_date <= sunday ? `By the end of this week you will have reached ${n} water outings` : `With your upcoming outings you will reach ${n} water outings`;
}
function remMessage(x, d, template) {
  const vals = { first_name: x.name.split(" ")[0], reason: remReason(x, d), term: d.term, year: d.year, cutoff: d.cutoff ? fmtLong(d.cutoff) : "" };
  return (template || d.template).replace(/\{(first_name|reason|term|year|cutoff)\}/g, (_, k) => vals[k]);
}

function editReminderTemplate(d) {
  const sample = d.members.find((x) => x.category === "Novice") || d.members[0] || { name: "Htar Example", category: "Novice", tier: "now", free_n: d.free_n, reach_date: null };
  modal({
    title: "Reminder message", wide: true,
    body: `<label class="field"><span>Message</span><textarea class="input" id="tpl" rows="7">${esc(d.template)}</textarea>
        <span class="hint">Placeholders: <code>{first_name}</code>, <code>{reason}</code> (a sentence for their situation, e.g. “By the end of this week you will have reached ${d.free_n} water outings”), <code>{term}</code>, <code>{year}</code>, <code>{cutoff}</code>.</span></label>
      <div class="field"><span>Preview for ${esc(sample.name)}</span><div class="callout" id="tpl-prev" style="white-space:pre-wrap"></div></div>`,
    foot: `<button class="btn ghost" id="tpl-reset">Reset to default</button><div class="r"><button class="btn" data-close>Cancel</button><button class="btn primary" id="tpl-save">Save</button></div>`,
    onMount: (m, close) => {
      const ta = $("#tpl", m), prev = () => { $("#tpl-prev", m).textContent = remMessage(sample, d, ta.value); };
      ta.oninput = prev; prev();
      $("#tpl-reset", m).onclick = () => { ta.value = d.default_template; prev(); };
      $("#tpl-save", m).onclick = async () => {
        try { await api("/api/committee/subs-reminders/template", { method: "PUT", body: { template: ta.value } }); close(); toast("Reminder message saved"); pageSubsReminders(); } catch (e) { fail(e); }
      };
    },
  });
}

async function pageSubsReminders() {
  let d;
  try { d = await api("/api/committee/subs-reminders"); } catch (e) { return fail(e); }
  const hideReminded = !!S.remHide;
  const list = d.members.filter((x) => !hideReminded || !x.reminded_at);
  const row = (x) => {
    const blockedWhy = () => {
      if (x.category !== "Novice") return "Subs aren't paid and the cutoff has passed.";
      const landOnly = x.blocked.every((o) => o.kind === "land");
      return landOnly
        ? `These come after their ${x.free_n}th water outing (${x.water} incl. scheduled). Land training is only free while free water outings remain.`
        : `They've used their ${x.free_n} free water outings (${x.water} incl. scheduled), so anything after that needs subs.`;
    };
    const why = x.tier === "blocked" ? `Down for ${x.blocked.map((o) => `<b>${esc(sessLabel(o))}</b>`).join(", ")}<div class="faint small">${esc(blockedWhy())}</div>`
      : x.category === "Novice" ? (x.free_left === 0 ? `Used all ${x.free_n} free novice outings (${x.water} water outing${x.water === 1 ? "" : "s"} incl. scheduled)` : `${x.free_n - x.free_left} of ${x.free_n} free novice outings used, incl. scheduled`)
      : "Senior, subs not paid";
    const plan = x.subs_plan !== "Unpaid" ? `<span class="chip bad" title="Not valid for ${esc(d.term)} ${esc(d.year)}">Expired: ${esc(x.subs_plan === "Single term" ? `${x.subs_term} ${x.subs_year}` : `Full year ${x.subs_year}`)}</span>` : "";
    return `<article class="card rem" data-id="${x.id}">
      <div class="rem-main">
        <div class="rem-name"><b>${esc(x.name)}</b> <span class="chip ${x.category === "Novice" ? "accent" : ""}">${esc(x.category)}</span> ${plan}
          ${x.reminded_at ? `<button class="chip ok rem-reminded" data-unremind="${x.id}" title="Click to clear">${I.check}Reminded ${daysAgo(x.reminded_at)}</button>` : ""}</div>
        <div class="rem-why">${why}</div>
        <div class="rem-meta">${x.next && x.tier !== "blocked" ? `<span>Next: ${esc(sessLabel(x.next))}</span>` : ""}${x.last_activity ? `<span>Last active ${fmtShort(x.last_activity)}</span>` : `<span>${x.water + x.land ? `${x.water + x.land} outing${x.water + x.land === 1 ? "" : "s"} so far` : "No outings yet"}</span>`}
          ${x.has_phone ? `<span>${phoneCell(x.id, x.phone_masked, x.has_phone)}</span>` : `<span>No phone number</span>`}</div>
      </div>
      <div class="rem-actions">
        <button class="btn sm" data-copy="${x.id}" title="Copy a reminder message">${I.copy}Copy message</button>
        ${x.has_phone ? `<button class="btn sm" data-text="${x.id}" title="Open your messages app with the reminder">${I.send}Text</button>` : ""}
        ${x.reminded_at ? "" : `<button class="btn sm ghost" data-remind="${x.id}">${I.check}Mark reminded</button>`}
        <button class="btn sm primary" data-paid="${x.id}">Mark paid</button>
      </div></article>`;
  };
  const groups = Object.keys(REM_TIERS).map((t) => [t, list.filter((x) => x.tier === t)]).filter(([, l]) => l.length);
  $("#main").innerHTML = `
    <div class="page-head"><div><h1>Subs reminders</h1><p>Unpaid members to contact for ${esc(d.term)} ${esc(d.year)}, most urgent first. Outings already scheduled are counted.${d.cutoff ? ` Subs cutoff: <b>${fmtLong(d.cutoff)}</b>.` : ""}</p></div></div>
    <div class="filters">
      <label class="check small"><input type="checkbox" id="rem-hide" ${hideReminded ? "checked" : ""}> Hide people already reminded</label>
      <div class="toolbar" style="margin-left:auto"><button class="btn sm" id="rem-tpl">Edit message</button>${list.length ? `<button class="btn sm" id="rem-names">${I.copy}Copy all names</button>` : ""}</div>
    </div>
    ${groups.length ? groups.map(([t, l]) => `<div class="section-title rem-h ${REM_TIERS[t].cls}">${REM_TIERS[t].title} <span class="faint">· ${l.length} ${l.length === 1 ? "person" : "people"}</span></div>
      <p class="muted small" style="margin:-6px 0 10px">${REM_TIERS[t].hint}</p><div class="rem-list">${l.map(row).join("")}</div>`).join("")
      : `<div class="card empty">${I.check}<h3>No one to remind</h3><p>${hideReminded && d.members.length ? "Everyone on the list has already been reminded." : "Every active member who needs subs has paid, or still has free novice outings left."}</p></div>`}`;
  setCount("reminders", d.members.length); wireReveal($("#main"));
  const byId = (id) => d.members.find((x) => x.id === +id);
  const markReminded = async (id, on = true) => { try { await api(`/api/committee/members/${id}/reminded`, { method: "POST", body: { reminded: on } }); } catch (e) { fail(e); } };
  const copy = async (text) => { try { await navigator.clipboard.writeText(text); return true; } catch { const t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select(); const ok = document.execCommand("copy"); t.remove(); return ok; } };
  $("#rem-tpl").onclick = () => editReminderTemplate(d);
  $("#rem-hide").onchange = (e) => { S.remHide = e.target.checked; pageSubsReminders(); };
  const nm = $("#rem-names"); if (nm) nm.onclick = async () => { await copy(list.map((x) => x.name).join("\n")); toast(`Copied ${list.length} name${list.length === 1 ? "" : "s"}`); };
  $$("[data-copy]").forEach((b) => b.onclick = async () => { const x = byId(b.dataset.copy); await copy(remMessage(x, d)); await markReminded(x.id); toast(`Message for ${x.name.split(" ")[0]} copied · marked as reminded`); pageSubsReminders(); });
  $$("[data-text]").forEach((b) => b.onclick = async () => {
    const x = byId(b.dataset.text);
    try {
      const { phone } = await api(`/api/committee/members/${x.id}/phone`);
      if (!phone) return toast("No phone number on file", true);
      await markReminded(x.id);
      location.href = `sms:${phone.replace(/[^\d+]/g, "")}?&body=${encodeURIComponent(remMessage(x, d))}`;
      setTimeout(pageSubsReminders, 800);
    } catch (e) { fail(e); }
  });
  $$("[data-remind]").forEach((b) => b.onclick = async () => { await markReminded(b.dataset.remind); toast("Marked as reminded"); pageSubsReminders(); });
  $$("[data-unremind]").forEach((b) => b.onclick = async () => { await markReminded(b.dataset.unremind, false); pageSubsReminders(); });
  $$("[data-paid]").forEach((b) => b.onclick = () => {
    const x = byId(b.dataset.paid);
    modal({
      title: `Mark ${esc(x.name)} as paid`,
      body: `<p style="margin:0">Which subs have they paid?</p>
        <div class="role-cards" style="grid-template-columns:1fr 1fr">
          <button type="button" class="role-card" data-plan="Single term"><b>Single term</b><span>${esc(d.term)} ${esc(d.year)}</span></button>
          <button type="button" class="role-card" data-plan="Full year"><b>Full year</b><span>${esc(d.year)}</span></button></div>`,
      onMount: (m, close) => $$("[data-plan]", m).forEach((p) => p.onclick = async () => {
        try { await api(`/api/committee/members/${x.id}/paid`, { method: "POST", body: { plan: p.dataset.plan } }); close(); toast(`${x.name}: ${p.dataset.plan} recorded`); pageSubsReminders(); } catch (e) { fail(e); }
      }),
    });
  });
}

// ------------------------------------------------------------------ boats --
const boatSvg = (seats, coxed) => {
  const w = 300, n = seats, gap = (w - 70) / Math.max(n, 1);
  let dots = "";
  for (let i = 0; i < n; i++) dots += `<circle cx="${40 + gap * i + gap / 2}" cy="17" r="4" fill="currentColor" opacity=".85"/><line x1="${40 + gap * i + gap / 2}" y1="17" x2="${40 + gap * i + gap / 2 + (i % 2 ? 10 : -10)}" y2="${i % 2 ? 32 : 2}" stroke="currentColor" stroke-width="1.5" opacity=".4"/>`;
  if (coxed) dots += `<rect x="${w - 30}" y="13" width="8" height="8" rx="2" fill="currentColor"/>`;
  return `<svg class="boat-svg" viewBox="0 0 ${w} 34" preserveAspectRatio="none"><path d="M4 17 Q 30 9 150 9 Q 270 9 296 17 Q 270 25 150 25 Q 30 25 4 17Z" fill="currentColor" opacity=".14" stroke="currentColor" stroke-width="1.2"/>${dots}</svg>`;
};

async function pageBoats() {
  let data;
  try { data = await api("/api/committee/boats"); } catch (e) { return fail(e); }
  const committee = isCommittee();
  const avail = data.boats.filter((b) => b.status === "available").length;
  $("#main").innerHTML = `
    <div class="page-head"><div><h1>Boat park</h1><p>${data.boats.length} boats · ${avail} available${data.boats.length - avail ? ` · ${data.boats.length - avail} out of service` : ""}</p></div>
      <div class="toolbar"><button class="btn" id="bt-report">${I.alert}Report an issue</button>${committee ? `<button class="btn primary" id="bt-add">${I.plus}Add boat</button>` : ""}</div></div>
    ${data.boats.length ? `<div class="boats">${data.boats.map((b) => `
      <article class="card boat ${b.status} ${committee ? "clickable" : ""}" data-id="${b.id}">
        <div class="boat-head"><div><div class="boat-name">${esc(b.name)}</div><div class="muted small">${esc(b.boat_type)} · ${b.seats} seat${b.seats > 1 ? "s" : ""}${b.coxed ? " + cox" : ""}</div></div>
          <span class="chip ${b.status === "available" ? "ok" : b.status === "repair" ? "warn" : ""}">${b.status === "available" ? "Available" : b.status === "repair" ? "Under repair" : "Retired"}</span></div>
        ${boatSvg(b.seats, b.coxed)}
        <div class="o-sub">${b.rigging ? `<span>${esc(b.rigging)}</span>` : ""}<span>${b.outings} outing${b.outings === 1 ? "" : "s"}</span>${b.next_outing ? `<span>Next: ${fmtShort(b.next_outing)}</span>` : ""}</div>
        ${b.notes ? `<div class="small muted">${esc(b.notes)}</div>` : ""}
        ${b.open_issues ? `<button class="chip ${ISSUE_SEV[b.worst_issue]?.[1] || "warn"} chip-btn" data-boat-issues="${b.id}">${I.alert}${b.open_issues} open issue${b.open_issues === 1 ? "" : "s"}</button>` : ""}
      </article>`).join("")}</div>`
      : `<div class="card empty">${I.boat}<h3>No boats yet</h3><p>${committee ? "Add the club's fleet so outings can be assigned to specific boats." : "The committee hasn't added the fleet yet."}</p>${committee ? `<button class="btn primary" id="bt-add2">${I.plus}Add first boat</button>` : ""}</div>`}`;
  $("#bt-report").onclick = () => reportIssue(data.boats);
  $$("[data-boat-issues]").forEach((b) => b.onclick = (e) => { e.stopPropagation(); S.issueBoat = +b.dataset.boatIssues; S.issueFilter = "active"; go("issues"); });
  if (committee) {
    const add = () => editBoat(null, data.types);
    $("#bt-add").onclick = add; const a2 = $("#bt-add2"); if (a2) a2.onclick = add;
    $$(".boat[data-id]").forEach((c) => c.onclick = () => editBoat(data.boats.find((b) => b.id === +c.dataset.id), data.types));
  }
}

function editBoat(b, types) {
  const v = b || { name: "", boat_type: "8+", seats: 8, coxed: 1, status: "available", rigging: "", notes: "" };
  modal({
    title: b ? "Edit boat" : "Add boat",
    body: `<div class="grid-2"><label class="field"><span>Name</span><input class="input" id="b-name" value="${esc(v.name)}" placeholder="e.g. Isis"></label>
        <label class="field"><span>Type</span><select class="input" id="b-type">${Object.keys(types).map((t) => `<option ${v.boat_type === t ? "selected" : ""}>${t}</option>`).join("")}</select></label></div>
      <div class="grid-3"><label class="field"><span>Rowing seats</span><input class="input" type="number" min="1" max="8" id="b-seats" value="${v.seats}"></label>
        <div class="field"><span>&nbsp;</span><label class="check"><input type="checkbox" id="b-cox" ${v.coxed ? "checked" : ""}> Coxed</label></div>
        <label class="field"><span>Status</span><select class="input" id="b-status">${[["available", "Available"], ["repair", "Under repair"], ["retired", "Retired"]].map(([k, l]) => `<option value="${k}" ${v.status === k ? "selected" : ""}>${l}</option>`).join("")}</select></label></div>
      <label class="field"><span>Rigging / weight class</span><input class="input" id="b-rig" value="${esc(v.rigging)}" placeholder="e.g. Bow-rigged, 75–85 kg"></label>
      <label class="field"><span>Notes</span><textarea class="input" id="b-notes" rows="2">${esc(v.notes)}</textarea></label>`,
    foot: `${b ? `<button class="btn danger" id="b-del">Delete</button>` : ""}<div class="r"><button class="btn" data-close>Cancel</button><button class="btn primary" id="b-save">Save</button></div>`,
    onMount: (m, close) => {
      $("#b-type", m).onchange = (e) => { const t = types[e.target.value]; if (t) { $("#b-seats", m).value = t.seats; $("#b-cox", m).checked = t.coxed; } };
      $("#b-save", m).onclick = async () => {
        const body = { name: $("#b-name", m).value.trim(), boat_type: $("#b-type", m).value, seats: Math.max(1, Math.min(8, +$("#b-seats", m).value || 1)), coxed: $("#b-cox", m).checked, status: $("#b-status", m).value, rigging: $("#b-rig", m).value, notes: $("#b-notes", m).value };
        if (!body.name) return toast("Name is required", true);
        try { await api(b ? `/api/committee/boats/${b.id}` : "/api/committee/boats", { method: b ? "PUT" : "POST", body }); close(); toast("Boat saved"); pageBoats(); } catch (e) { fail(e); }
      };
      const d = $("#b-del", m);
      if (d) d.onclick = async () => {
        if (!await confirmBox(`Delete ${esc(b.name)}?`, "Sessions using this boat keep their crews but lose the boat. Mark it “Retired” instead to keep history.", "Delete", true)) return;
        try { await api(`/api/committee/boats/${b.id}`, { method: "DELETE" }); toast("Boat deleted"); pageBoats(); } catch (e) { fail(e); }
      };
    },
  });
}

// ------------------------------------------------------------- boat usage --
/* Outings and hours on the water per boat, usage since each boat's last service, and idle boats. */
const USAGE_PERIODS = [["season", "This season"], ["term", "This term"], ["30d", "Last 30 days"], ["all", "All time"]];
const fmtHours = (h) => (h >= 100 ? Math.round(h) : h.toFixed(1).replace(/\.0$/, ""));

async function pageUsage() {
  S.usagePeriod = S.usagePeriod || "season";
  let d;
  try { d = await api(`/api/boats/usage?period=${S.usagePeriod}`); } catch (e) { return fail(e); }
  const committee = isCommittee(), t = d.totals, iv = d.service_interval_hours;
  const maxH = Math.max(1, ...d.boats.map((b) => b.hours));
  const ago = (n) => (n === 0 ? "today" : n === 1 ? "yesterday" : n < 14 ? `${n} days ago` : n < 60 ? `${Math.round(n / 7)} weeks ago` : `${Math.round(n / 30)} months ago`);
  const periodLabel = d.since ? `since ${fmtShort(d.since)}` : "all time";
  const svcCell = (b) => {
    const s = b.since_service;
    const pct = b.service_pct;
    const bar = pct != null && b.status !== "retired" ? `<div class="bar ${b.service_due ? "due" : pct >= 80 ? "near" : ""}" title="${pct}% of the ${iv} h service interval"><i style="width:${Math.min(100, pct)}%"></i></div>` : "";
    return `<div class="u-svc"><span>${fmtHours(s.hours)} h <span class="faint">· ${plural(s.outings, "outings")}</span>${b.service_due ? ` <span class="chip bad">Due</span>` : ""}</span>${bar}</div>`;
  };
  const row = (b) => `<tr class="${b.status === "retired" ? "u-retired" : ""}">
      <td><b>${esc(b.name)}</b> <span class="faint">${esc(b.boat_type)}</span>
        ${b.status === "repair" ? ` <span class="chip warn">Under repair</span>` : b.status === "retired" ? ` <span class="chip">Retired</span>` : b.idle ? ` <span class="chip warn" title="No outing in the last ${d.idle_after_days} days and nothing booked">Idle</span>` : ""}</td>
      <td class="num">${b.outings}</td>
      <td><div class="u-hours"><span class="num">${fmtHours(b.hours)}</span><div class="bar"><i style="width:${(b.hours / maxH) * 100}%"></i></div></div></td>
      <td>${b.last_used ? `${fmtShort(b.last_used)} <span class="faint small">${ago(b.idle_days)}</span>` : `<span class="faint">Never</span>`}</td>
      <td>${b.upcoming ? `${b.upcoming} <span class="faint small">next ${fmtShort(b.next_outing)}</span>` : `<span class="faint">–</span>`}</td>
      <td>${svcCell(b)}</td>
      <td>${b.last_serviced ? fmtShort(b.last_serviced) : `<span class="faint">Not recorded</span>`}${committee ? ` <button class="btn sm" data-svc="${b.id}">Serviced…</button>` : ""}</td>
    </tr>`;
  $("#main").innerHTML = `
    <div class="page-head"><div><h1>Boat usage</h1><p>Outings and hours on the water per boat, ${esc(periodLabel)}. Outings count once they've happened; cancelled ones don't.</p></div>
      <div class="toolbar"><div class="seg" id="us-p">${USAGE_PERIODS.map(([k, l]) => `<button data-p="${k}" class="${S.usagePeriod === k ? "on" : ""}">${l}</button>`).join("")}</div></div></div>
    <div class="stats" style="margin-bottom:16px">
      <div class="card stat"><div class="k">Hours on the water</div><div class="v">${fmtHours(t.hours)}</div><div class="s">across ${plural(t.outings, "outings")}</div></div>
      <div class="card stat"><div class="k">Boats used</div><div class="v">${t.used}<span class="u-of"> / ${t.in_service}</span></div><div class="s">of the boats not retired</div></div>
      <div class="card stat"><div class="k">Sitting idle</div><div class="v">${t.idle}</div><div class="s">available, unused for ${d.idle_after_days} days, nothing booked</div></div>
      ${iv ? `<div class="card stat"><div class="k">Due for service</div><div class="v">${t.due}</div><div class="s">${fmtHours(iv)} h or more since last service</div></div>` : ""}
    </div>
    ${t.assumed ? `<div class="callout" style="margin-bottom:14px">${I.info}<div>${plural(t.assumed, "outings")} had no end time, so ${d.default_minutes} minutes were assumed for ${t.assumed === 1 ? "it" : "them"}. Add end times to sessions for exact hours.</div></div>` : ""}
    ${d.boats.length ? `<div class="card table-wrap"><table class="t u-table"><thead><tr><th>Boat</th><th class="num">Outings</th><th>Hours</th><th>Last used</th><th>Booked</th><th title="All use since the last service date (or ever, if none is recorded), whatever period is picked">Since service</th><th>Last serviced</th></tr></thead>
      <tbody>${d.boats.map(row).join("")}</tbody></table></div>`
      : `<div class="card empty">${I.boat}<h3>No boats yet</h3><p>Add the fleet under <a href="#/boats">Boat park</a> and set a boat on water outings to track their use.</p></div>`}
    ${committee ? `<div class="card u-interval"><label class="field"><span>Service interval</span>
        <div class="u-iv-row"><input class="input" type="number" min="0" step="5" id="us-iv" value="${iv ? fmtHours(iv) : ""}" placeholder="Off"><span class="muted">hours on the water</span><button class="btn" id="us-iv-save">Save</button></div>
        <span class="hint">Boats with this many hours since their last service are flagged as due. Leave blank to turn it off.</span></label></div>` : ""}`;
  $$("#us-p button").forEach((b) => b.onclick = () => { S.usagePeriod = b.dataset.p; pageUsage(); });
  if (!committee) return;
  $("#us-iv-save").onclick = async () => {
    const hours = Math.max(0, +$("#us-iv").value || 0);
    try { await api("/api/committee/service-interval", { method: "PUT", body: { hours } }); toast(hours ? "Service interval saved" : "Service interval turned off"); pageUsage(); } catch (e) { fail(e); }
  };
  $$("[data-svc]").forEach((btn) => btn.onclick = () => markServiced(d.boats.find((b) => b.id === +btn.dataset.svc)));
}

function markServiced(b) {
  modal({
    title: `${b.name}: last serviced`,
    body: `<label class="field"><span>Date of service</span><input class="input" type="date" id="sv-date" value="${esc(b.last_serviced || S.boot.today)}" max="${esc(S.boot.today)}">
      <span class="hint">Usage since service counts from this day on.</span></label>`,
    foot: `${b.last_serviced ? `<button class="btn danger" id="sv-clear">Clear</button>` : ""}<div class="r"><button class="btn" data-close>Cancel</button><button class="btn primary" id="sv-save">Save</button></div>`,
    onMount: (m, close) => {
      const save = async (date) => {
        try { await api(`/api/committee/boats/${b.id}/serviced`, { method: "PUT", body: { date } }); close(); toast(date ? "Service recorded" : "Service date cleared"); pageUsage(); } catch (e) { fail(e); }
      };
      $("#sv-save", m).onclick = () => { const v = $("#sv-date", m).value; if (!v) return toast("Pick a date", true); save(v); };
      const c = $("#sv-clear", m); if (c) c.onclick = () => save("");
    },
  });
}

// ------------------------------------------------------------ boat issues --
const ISSUE_SEV = { minor: ["Minor", ""], caution: ["Use with care", "warn"], unusable: ["Do not use", "bad"] };
const ISSUE_ST = { open: "bad", in_progress: "accent", waiting: "warn", fixed: "ok", closed: "" };
const utcStamp = (s) => (s ? fmtStamp(s.replace(" ", "T") + "Z") : "");
const fmtBytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const PHOTO_EDGE = 1600, PHOTO_Q = 0.8, PHOTO_MAX = 2 * 1024 * 1024;

/* Resize and re-encode a photo in the browser, so the server never has to decode it.
   Re-encoding also drops EXIF metadata (e.g. the GPS position phones embed). */
async function compressImage(file) {
  let src, w, h, cleanup = () => {};
  try {
    src = await createImageBitmap(file, { imageOrientation: "from-image" });
    w = src.width; h = src.height; cleanup = () => src.close();
  } catch {
    const url = URL.createObjectURL(file);
    src = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error(`Can't read ${file.name}. Try a JPEG or PNG photo`)); im.src = url; });
    w = src.naturalWidth; h = src.naturalHeight; cleanup = () => URL.revokeObjectURL(url);
  }
  try {
    for (const [edge, q] of [[PHOTO_EDGE, PHOTO_Q], [1200, 0.7], [900, 0.6]]) {
      const k = Math.min(1, edge / Math.max(w, h));
      const c = document.createElement("canvas");
      c.width = Math.round(w * k); c.height = Math.round(h * k);
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);   // transparent PNGs become white, not black
      ctx.drawImage(src, 0, 0, c.width, c.height);
      const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", q));
      c.width = c.height = 0;   // free the canvas memory straight away
      if (blob && blob.size <= PHOTO_MAX) return blob;
    }
    throw new Error(`${file.name} is too large even after compressing`);
  } finally { cleanup(); }
}

async function uploadPhotos(issueId, files, onProgress) {
  let done = 0, saved = 0;
  for (const f of files) {          // one at a time keeps memory low on phones
    onProgress && onProgress(`Compressing photo ${done + 1} of ${files.length}…`);
    try {
      const blob = await compressImage(f);
      onProgress && onProgress(`Uploading photo ${done + 1} of ${files.length} (${fmtBytes(blob.size)})…`);
      await api(`/api/issues/${issueId}/photos?by=${encodeURIComponent(meName() || "")}`, { method: "POST", body: blob });
      saved++;
    } catch (e) { fail(e); }
    done++;
  }
  return saved;
}

const photoPicker = (id) => `<div class="field"><span>Photos (optional)</span><input class="input" type="file" id="${id}" accept="image/*" multiple><span class="hint">Resized on your device before uploading, so big photos are fine.</span></div>`;

function reportIssue(boats, boatId) {
  const list = boats.filter((b) => b.status !== "retired" || b.id === boatId);
  let sev = "minor";
  modal({
    title: "Report a boat issue",
    body: `<div class="grid-2"><label class="field"><span>Boat</span><select class="input" id="ri-boat"><option value="">Choose a boat…</option>${list.map((b) => `<option value="${b.id}" ${b.id === boatId ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select></label>
        <label class="field"><span>Your name</span><input class="input" id="ri-who" value="${esc(meName() || "")}" autocomplete="name"></label></div>
      <label class="field"><span>What's wrong?</span><input class="input" id="ri-title" maxlength="150" placeholder="e.g. 3 seat rigger loose"></label>
      <div class="field"><span>How serious?</span><div class="seg" id="ri-sev">${Object.entries(ISSUE_SEV).map(([k, [l]]) => `<button type="button" data-v="${k}" class="${k === sev ? "on" : ""}">${esc(l)}</button>`).join("")}</div></div>
      <label class="field"><span>Description</span><textarea class="input" id="ri-desc" rows="4" maxlength="4000" placeholder="Where exactly, what happened, anything you already tried"></textarea></label>
      ${photoPicker("ri-photos")}
      <div class="small muted" id="ri-prog"></div>`,
    foot: `<div class="r"><button class="btn" data-close>Cancel</button><button class="btn primary" id="ri-save">${I.send}Report issue</button></div>`,
    onMount: (m, close) => {
      $$("#ri-sev button", m).forEach((b) => b.onclick = () => { sev = b.dataset.v; $$("#ri-sev button", m).forEach((x) => x.classList.toggle("on", x === b)); });
      $("#ri-save", m).onclick = async () => {
        const body = { boat_id: +$("#ri-boat", m).value, title: $("#ri-title", m).value.trim(), severity: sev, description: $("#ri-desc", m).value, reported_by: $("#ri-who", m).value.trim() };
        if (!body.boat_id) return toast("Pick a boat", true);
        if (!body.title) return toast("Say what's wrong", true);
        if (!body.reported_by) return toast("Add your name", true);
        const btn = $("#ri-save", m); btn.disabled = true;
        try {
          const r = await api("/api/issues", { method: "POST", body });
          const files = [...$("#ri-photos", m).files];
          if (files.length) await uploadPhotos(r.id, files, (t) => ($("#ri-prog", m).textContent = t));
          close(); toast("Issue reported"); await go("issues"); openIssue(r.id, boats);
        } catch (e) { fail(e); btn.disabled = false; }
      };
    },
  });
}

async function pageIssues() {
  let data, iss;
  try { [data, iss] = await Promise.all([api("/api/committee/boats"), api("/api/issues")]); } catch (e) { return fail(e); }
  setCount("issues", iss.issues.filter((i) => iss.active.includes(i.status)).length);
  S.issueFilter = S.issueFilter || "active";
  let shown = iss.issues.filter((i) => S.issueFilter === "all" || (S.issueFilter === "active") === iss.active.includes(i.status));
  if (S.issueBoat) shown = shown.filter((i) => i.boat_id === S.issueBoat);
  $("#main").innerHTML = `
    <div class="page-head"><div><h1>Boat issues</h1><p>Problems with the boats and how their repairs are going.</p></div>
      <div class="toolbar"><button class="btn primary" id="is-new">${I.plus}Report an issue</button></div></div>
    <div class="toolbar" style="margin-bottom:14px">
      <div class="seg" id="is-f">${[["active", "Open"], ["done", "Fixed & closed"], ["all", "All"]].map(([k, l]) => `<button data-f="${k}" class="${S.issueFilter === k ? "on" : ""}">${l}</button>`).join("")}</div>
      <select class="input" id="is-boat" style="width:auto"><option value="">All boats</option>${data.boats.map((b) => `<option value="${b.id}" ${S.issueBoat === b.id ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select></div>
    ${shown.length ? `<div class="issue-list">${shown.map((i) => `<button class="card issue-row" data-issue="${i.id}">
        <div class="issue-main"><div class="issue-title">${esc(i.title)}</div>
          <div class="o-sub"><span>${I.boat}${esc(i.boat_name)}</span><span>Reported by ${esc(i.reported_by)} · ${esc(utcStamp(i.created_at))}</span>${i.photos ? `<span>${i.photos} photo${i.photos === 1 ? "" : "s"}</span>` : ""}${i.notes ? `<span>${i.notes} note${i.notes === 1 ? "" : "s"}</span>` : ""}</div></div>
        <div class="issue-chips"><span class="chip ${ISSUE_SEV[i.severity][1]}">${esc(ISSUE_SEV[i.severity][0])}</span><span class="chip ${ISSUE_ST[i.status]}">${esc(iss.statuses[i.status])}</span></div>
      </button>`).join("")}</div>`
      : `<div class="card empty">${I.check}<h3>${S.issueFilter === "active" ? "No open issues" : "Nothing here"}</h3><p>${S.issueFilter === "active" ? "All boats are in good shape. Spotted a problem? Report it so it can be fixed." : "No issues match these filters."}</p></div>`}`;
  $("#is-new").onclick = () => reportIssue(data.boats, S.issueBoat || undefined);
  $$("#is-f button").forEach((b) => b.onclick = () => { S.issueFilter = b.dataset.f; pageIssues(); });
  $("#is-boat").onchange = (e) => { S.issueBoat = +e.target.value || null; pageIssues(); };
  $$("[data-issue]").forEach((b) => b.onclick = () => openIssue(+b.dataset.issue, data.boats));
}

async function openIssue(id, boats) {
  let i, meta;
  try { [i, meta] = await Promise.all([api(`/api/issues/${id}`), api("/api/issues")]); } catch (e) { return fail(e); }
  const committee = isCommittee(), st = meta.statuses;
  const timeline = i.updates.map((u) => `<div class="tl-item"><div class="tl-dot ${u.status ? ISSUE_ST[u.status] || "" : ""}"></div><div>
      <div class="small"><b>${esc(u.author || "Someone")}</b> ${u.status ? (u === i.updates[0] ? "reported this" : `set the status to <span class="chip ${ISSUE_ST[u.status]}">${esc(st[u.status])}</span>`) : "added a note"} <span class="faint">· ${esc(utcStamp(u.created_at))}</span></div>
      ${u.note ? `<div class="tl-note">${esc(u.note)}</div>` : ""}</div></div>`).join("");
  modal({
    title: esc(i.title), wide: true,
    body: `<div class="issue-chips"><span class="chip">${I.boat}${esc(i.boat_name)}</span><span class="chip ${ISSUE_SEV[i.severity][1]}">${esc(ISSUE_SEV[i.severity][0])}</span><span class="chip ${ISSUE_ST[i.status]}">${esc(st[i.status])}</span></div>
      ${i.description ? `<div class="issue-desc">${esc(i.description)}</div>` : `<div class="faint small">No description.</div>`}
      ${(i.incidents || []).length ? `<div class="issue-chips">${i.incidents.map((x) => committee ? `<button class="chip chip-btn warn" data-inc-open="${x.id}">${I.lifebuoy}${esc(x.kind_label)}, ${esc(fmtShort(x.date))}</button>` : `<span class="chip warn">${I.lifebuoy}From a ${esc(x.kind_label.toLowerCase())}, ${esc(fmtShort(x.date))}</span>`).join("")}</div>` : ""}
      ${i.photos.length ? `<div class="photo-grid">${i.photos.map((p) => `<div class="photo"><a href="/api/issues/photos/${p.id}" target="_blank" rel="noopener"><img src="/api/issues/photos/${p.id}" loading="lazy" alt="Photo${p.uploaded_by ? ` from ${esc(p.uploaded_by)}` : ""}"></a>${committee ? `<button class="btn icon sm photo-del" data-del-photo="${p.id}" title="Delete photo" aria-label="Delete photo">${I.x}</button>` : ""}</div>`).join("")}</div>` : ""}
      <div class="section-title" style="margin-top:6px">Progress</div>
      <div class="timeline">${timeline}</div>
      <div class="card-pad issue-add">
        ${committee ? `<label class="field"><span>Status</span><select class="input" id="iu-st">${Object.entries(st).map(([k, l]) => `<option value="${k}" ${k === i.status ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>` : ""}
        <label class="field"><span>Add a note</span><textarea class="input" id="iu-note" rows="2" maxlength="4000" placeholder="${committee ? "e.g. Ordered a new gate, arriving Friday" : "e.g. Still loose after Tuesday's outing"}"></textarea></label>
        <div class="grid-2"><label class="field"><span>Your name</span><input class="input" id="iu-who" value="${esc(meName() || "")}"></label>${photoPicker("iu-photos")}</div>
        <div class="small muted" id="iu-prog"></div>
      </div>`,
    foot: `${committee ? `<button class="btn danger" id="iu-del">Delete</button><button class="btn" id="iu-edit">Edit</button>` : ""}<div class="r"><button class="btn" data-close>Close</button><button class="btn primary" id="iu-save">Save update</button></div>`,
    onMount: (m, close) => {
      const reload = async () => { close(); await rerender(); openIssue(id, boats); };
      $("#iu-save", m).onclick = async () => {
        const note = $("#iu-note", m).value.trim(), status = committee ? $("#iu-st", m).value : "", who = $("#iu-who", m).value.trim();
        const files = [...$("#iu-photos", m).files];
        const changed = status && status !== i.status;
        if (!note && !changed && !files.length) return toast("Write a note, change the status or add a photo", true);
        if (!who) return toast("Add your name", true);
        const btn = $("#iu-save", m); btn.disabled = true;
        try {
          if (note || changed) await api(`/api/issues/${id}/updates`, { method: "POST", body: { note, status: changed ? status : "", author: who } });
          if (files.length) await uploadPhotos(id, files, (t) => ($("#iu-prog", m).textContent = t));
          toast("Update saved"); reload();
        } catch (e) { fail(e); btn.disabled = false; }
      };
      $$("[data-del-photo]", m).forEach((b) => b.onclick = async () => {
        if (!await confirmBox("Delete this photo?", "It's removed from the server straight away.", "Delete", true)) return openIssue(id, boats);
        try { await api(`/api/issues/photos/${b.dataset.delPhoto}`, { method: "DELETE" }); } catch (e) { fail(e); }
        openIssue(id, boats);
      });
      const d = $("#iu-del", m);
      if (d) d.onclick = async () => {
        if (!await confirmBox("Delete this issue?", "Its notes and photos are deleted too. To keep the history, set it to Fixed or Closed instead.", "Delete", true)) return openIssue(id, boats);
        try { await api(`/api/issues/${id}`, { method: "DELETE" }); toast("Issue deleted"); rerender(); } catch (e) { fail(e); }
      };
      const ed = $("#iu-edit", m);
      if (ed) ed.onclick = () => editIssue(i, boats);
      $$("[data-inc-open]", m).forEach((b) => b.onclick = async () => { close(); await go("incidents"); openIncident(+b.dataset.incOpen); });
    },
  });
}

function editIssue(i, boats) {
  let sev = i.severity;
  modal({
    title: "Edit issue",
    body: `<label class="field"><span>Boat</span><select class="input" id="ei-boat">${boats.map((b) => `<option value="${b.id}" ${b.id === i.boat_id ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select></label>
      <label class="field"><span>Title</span><input class="input" id="ei-title" maxlength="150" value="${esc(i.title)}"></label>
      <div class="field"><span>How serious?</span><div class="seg" id="ei-sev">${Object.entries(ISSUE_SEV).map(([k, [l]]) => `<button type="button" data-v="${k}" class="${k === sev ? "on" : ""}">${esc(l)}</button>`).join("")}</div></div>
      <label class="field"><span>Description</span><textarea class="input" id="ei-desc" rows="5" maxlength="4000">${esc(i.description)}</textarea></label>`,
    foot: `<div class="r"><button class="btn" id="ei-cancel">Cancel</button><button class="btn primary" id="ei-save">Save</button></div>`,
    onMount: (m) => {
      $$("#ei-sev button", m).forEach((b) => b.onclick = () => { sev = b.dataset.v; $$("#ei-sev button", m).forEach((x) => x.classList.toggle("on", x === b)); });
      $("#ei-cancel", m).onclick = () => openIssue(i.id, boats);
      $("#ei-save", m).onclick = async () => {
        const body = { boat_id: +$("#ei-boat", m).value, title: $("#ei-title", m).value.trim(), severity: sev, description: $("#ei-desc", m).value };
        if (!body.title) return toast("Title is required", true);
        try { await api(`/api/issues/${i.id}`, { method: "PUT", body }); await rerender(); openIssue(i.id, boats); } catch (e) { fail(e); }
      };
    },
  });
}

// -------------------------------------------------------------- incidents --
/* Incident and capsize log. Anyone can report; only the committee sees the log (names, injuries). */
const INC_KIND = { capsize: "bad", collision: "bad", injury: "warn", near_miss: "accent", equipment: "warn", other: "" };
const INC_INJ = { none: "", first_aid: "warn", medical: "bad", hospital: "bad" };
let incMeta = null;
async function loadIncMeta() { if (!incMeta) incMeta = await api("/api/incidents/meta"); return incMeta; }
const incWhen = (i) => `${fmtLong(i.date)}${i.time ? ` ${i.time}` : ""}`;

/* Report form (rowers and committee) or full edit (committee, `i` given). */
async function incidentForm(i = null) {
  let meta, boats;
  try { [meta, boats] = await Promise.all([loadIncMeta(), api("/api/committee/boats").then((d) => d.boats)]); } catch (e) { return fail(e); }
  const edit = !!i, v = i || { date: S.boot.today, time: "", kind: "capsize", outing_id: null, boat_id: null, crew: "", location: "", description: "", injury: "none", injury_details: "", action_taken: "", reported_by: meName() || "" };
  let kind = v.kind, outings = [];
  const opts = (o, sel) => Object.entries(o).map(([k, l]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${esc(l)}</option>`).join("");
  modal({
    title: edit ? "Edit incident" : "Report an incident", wide: true,
    body: `${edit ? "" : `<div class="callout warn">${I.alert}<div>Someone hurt or still in the water? Call <b>999</b> (ask for the coastguard on tidal water) before filling this in.</div></div>`}
      <div class="field"><span>What happened?</span><div class="seg seg-wrap" id="in-kind">${Object.entries(meta.kinds).map(([k, l]) => `<button type="button" data-v="${k}" class="${k === kind ? "on" : ""}">${esc(l)}</button>`).join("")}</div></div>
      <div class="grid-3"><label class="field"><span>Date</span><input class="input" type="date" id="in-date" max="${esc(S.boot.today)}" value="${esc(v.date)}"></label>
        <label class="field"><span>Time (roughly)</span><input class="input" type="time" id="in-time" value="${esc(/^\d\d:\d\d$/.test(v.time) ? v.time : "")}"></label>
        <label class="field"><span>Outing</span><select class="input" id="in-outing"><option value="">Not part of an outing</option></select></label></div>
      <div class="grid-2"><label class="field"><span>Boat</span><select class="input" id="in-boat"><option value="">No boat / not listed</option>${boats.map((b) => `<option value="${b.id}" ${b.id === v.boat_id ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select>${edit && !v.boat_id && v.boat_name ? `<span class="hint">Was: ${esc(v.boat_name)} (since deleted)</span>` : ""}</label>
        <label class="field"><span>Where</span><input class="input" id="in-loc" maxlength="200" value="${esc(v.location)}" placeholder="e.g. Gut bend, near the boathouse"></label></div>
      <label class="field"><span>Crew (and coach / launch driver)</span><textarea class="input" id="in-crew" rows="2" maxlength="2000" placeholder="Names of everyone involved">${esc(v.crew)}</textarea><span class="hint">Picking the outing fills this in.</span></label>
      <label class="field"><span>What happened</span><textarea class="input" id="in-desc" rows="4" maxlength="8000" placeholder="Conditions, what led up to it, what happened">${esc(v.description)}</textarea></label>
      <div class="grid-2"><label class="field"><span>Was anyone hurt?</span><select class="input" id="in-inj">${opts(meta.injuries, v.injury)}</select></label>
        <label class="field ${v.injury === "none" ? "hidden" : ""}" id="in-injd-f"><span>Injury details</span><input class="input" id="in-injd" maxlength="4000" value="${esc(v.injury_details)}" placeholder="Who, what, any treatment"></label></div>
      <label class="field"><span>What was done about it</span><textarea class="input" id="in-act" rows="3" maxlength="8000" placeholder="e.g. Crew swam the boat to the bank, launch took the cox back, everyone checked for cold, boat taken out">${esc(v.action_taken)}</textarea></label>
      ${edit ? `<div class="section-title" style="margin-top:4px">Committee</div>
        <label class="field"><span>Follow-up</span><textarea class="input" id="in-fu" rows="3" maxlength="8000" placeholder="Lessons learned, changes made (e.g. briefing on the Gut, extra launch cover)">${esc(v.follow_up)}</textarea></label>
        <div class="grid-2"><label class="field"><span>Status</span><select class="input" id="in-st">${opts(meta.statuses, v.status)}</select></label>
          <label class="field"><span>Boat issue</span><select class="input" id="in-issue"><option value="">None</option>${(v.boat_issues || []).map((x) => `<option value="${x.id}" ${x.id === v.issue_id ? "selected" : ""}>${esc(x.title)}</option>`).join("")}</select></label></div>
        <label class="check"><input type="checkbox" id="in-br" ${v.br_reported ? "checked" : ""}> Reported to British Rowing</label>
        <div class="grid-2 ${v.br_reported ? "" : "hidden"}" id="in-br-f"><label class="field"><span>Reported on</span><input class="input" type="date" id="in-br-on" value="${esc(v.br_reported_on || S.boot.today)}"></label>
          <label class="field"><span>Reference</span><input class="input" id="in-br-ref" maxlength="120" value="${esc(v.br_reference)}" placeholder="Incident number from British Rowing"></label></div>`
      : `<label class="check"><input type="checkbox" id="in-dmg"> Equipment was damaged: also report a boat issue</label>
        <div class="hidden" id="in-dmg-f"><div class="grid-2"><label class="field"><span>Damage</span><input class="input" id="in-dmg-t" maxlength="150" placeholder="e.g. Bow ball snapped, 4 seat rigger bent"></label>
          <div class="field"><span>Can the boat still be used?</span><div class="seg" id="in-dmg-s">${Object.entries(ISSUE_SEV).map(([k, [l]]) => `<button type="button" data-v="${k}" class="${k === "caution" ? "on" : ""}">${esc(l)}</button>`).join("")}</div></div></div></div>
        <label class="field"><span>Your name</span><input class="input" id="in-who" value="${esc(v.reported_by)}" autocomplete="name"></label>
        <p class="small muted" style="margin:0">Only the committee can see incident reports. They follow up and report to British Rowing.</p>`}`,
    foot: `<div class="r"><button class="btn" ${edit ? `id="in-cancel"` : "data-close"}>Cancel</button><button class="btn primary" id="in-save">${edit ? "Save" : `${I.send}Report incident`}</button></div>`,
    onMount: (m, close) => {
      const pick = (sel, cb) => $$(`${sel} button`, m).forEach((b) => b.onclick = () => { $$(`${sel} button`, m).forEach((x) => x.classList.toggle("on", x === b)); cb(b.dataset.v); });
      let sev = "caution", autoCrew = "";
      pick("#in-kind", (k) => { kind = k; });
      pick("#in-dmg-s", (k) => { sev = k; });
      const outSel = $("#in-outing", m), boatSel = $("#in-boat", m), crew = $("#in-crew", m);
      const loadOutings = async (keep) => {
        const day = $("#in-date", m).value;
        outings = [];
        if (day) { try { outings = (await api(`/api/incidents/outings?day=${day}`)).outings; } catch {} }
        outSel.innerHTML = `<option value="">Not part of an outing</option>${outings.map((o) => `<option value="${o.id}" ${o.id === keep ? "selected" : ""}>${esc(`${o.time || "?"} ${o.kind === "water" ? o.boat_name || "Water outing" : o.title || "Land session"}`)}</option>`).join("")}`;
        if (keep && !outings.some((o) => o.id === keep)) outSel.insertAdjacentHTML("beforeend", `<option value="${keep}" selected>Linked outing</option>`);
      };
      loadOutings(v.outing_id);
      $("#in-date", m).onchange = () => loadOutings(null);
      outSel.onchange = () => {
        const o = outings.find((x) => x.id === +outSel.value);
        if (!o) return;
        if (o.boat_id) boatSel.value = o.boat_id;
        if (!$("#in-time", m).value && /^\d\d:\d\d$/.test(o.time)) $("#in-time", m).value = o.time;
        if (o.crew.length && (!crew.value.trim() || crew.value === autoCrew)) crew.value = autoCrew = o.crew.join(", ");
      };
      $("#in-inj", m).onchange = (e) => $("#in-injd-f", m).classList.toggle("hidden", e.target.value === "none");
      const tog = (cb, f) => { const c = $(cb, m); if (c) c.onchange = () => $(f, m).classList.toggle("hidden", !c.checked); };
      tog("#in-dmg", "#in-dmg-f"); tog("#in-br", "#in-br-f");
      const cancel = $("#in-cancel", m); if (cancel) cancel.onclick = () => openIncident(i.id);
      $("#in-save", m).onclick = async () => {
        const body = { date: $("#in-date", m).value, time: $("#in-time", m).value, kind, outing_id: +outSel.value || null, boat_id: +boatSel.value || null,
          crew: crew.value, location: $("#in-loc", m).value, description: $("#in-desc", m).value, injury: $("#in-inj", m).value,
          injury_details: $("#in-injd", m).value, action_taken: $("#in-act", m).value, reported_by: edit ? v.reported_by : $("#in-who", m).value.trim() };
        if (!body.date) return toast("Add the date", true);
        if (!body.description.trim()) return toast("Describe what happened", true);
        const btn = $("#in-save", m); btn.disabled = true;
        try {
          if (edit) {
            Object.assign(body, { follow_up: $("#in-fu", m).value, status: $("#in-st", m).value, issue_id: +$("#in-issue", m).value || null,
              br_reported: $("#in-br", m).checked, br_reported_on: $("#in-br-on", m).value, br_reference: $("#in-br-ref", m).value });
            await api(`/api/committee/incidents/${i.id}`, { method: "PUT", body });
            await rerender(); openIncident(i.id);
          } else {
            if (!body.reported_by) { btn.disabled = false; return toast("Add your name", true); }
            const dmg = $("#in-dmg", m).checked;
            if (dmg && !body.boat_id) { btn.disabled = false; return toast("Pick the boat that was damaged", true); }
            Object.assign(body, { boat_issue: dmg, issue_title: $("#in-dmg-t", m).value, issue_severity: sev });
            const r = await api("/api/incidents", { method: "POST", body });
            close(); refreshCounts();
            if (r.issue_id) {
              toast("Incident reported and boat issue opened. Add photos of the damage there");
              await go("issues"); openIssue(r.issue_id, boats);
            } else { toast("Incident reported. Thank you"); rerender(); }
          }
        } catch (e) { fail(e); btn.disabled = false; }
      };
    },
  });
}

async function pageIncidents() {
  const committee = isCommittee();
  const head = (extra = "") => `<div class="page-head"><div><h1>Incidents</h1><p>Capsizes, collisions, injuries and near misses. ${committee ? "Only the committee can see this log." : "Reports go to the committee only."}</p></div>
      <div class="toolbar">${extra}<button class="btn primary" id="in-new">${I.plus}Report an incident</button></div></div>`;
  if (!committee) {
    $("#main").innerHTML = `${head()}
      <div class="card empty">${I.lifebuoy}<h3>Had a capsize or a close call?</h3>
        <p>Report every capsize, collision, injury or near miss, even if nobody was hurt. The committee uses the reports to make outings safer and to report to British Rowing, as the club has to.</p>
        <button class="btn primary" id="in-new2">${I.plus}Report an incident</button></div>`;
    $("#in-new").onclick = $("#in-new2").onclick = () => incidentForm();
    return;
  }
  let d;
  try { d = await api("/api/committee/incidents"); } catch (e) { return fail(e); }
  setCount("incidents", d.incidents.filter((i) => i.status === "open").length);
  const years = [...new Set([d.this_year, ...d.incidents.map((i) => i.year)])].sort().reverse();
  if (!years.includes(S.incYear)) S.incYear = d.this_year;
  S.incFilter = S.incFilter || "all";
  const inYear = d.incidents.filter((i) => S.incYear === "all" || i.year === S.incYear);
  const shown = inYear.filter((i) => S.incFilter === "all" || (S.incFilter === "open" ? i.status === "open" : !i.br_reported));
  const n = (f) => inYear.filter(f).length, notRep = n((i) => !i.br_reported);
  $("#main").innerHTML = `${head(`<button class="btn" id="in-csv">${I.download}Export CSV</button>`)}
    <div class="stats" style="margin-bottom:16px">
      <div class="card stat"><div class="k">Incidents</div><div class="v">${inYear.length}</div><div class="s">${S.incYear === "all" ? "all time" : esc(S.incYear)}</div></div>
      <div class="card stat"><div class="k">Capsizes</div><div class="v">${n((i) => i.kind === "capsize")}</div><div class="s">${n((i) => i.kind === "near_miss")} near miss${n((i) => i.kind === "near_miss") === 1 ? "" : "es"}</div></div>
      <div class="card stat"><div class="k">Injuries</div><div class="v">${n((i) => i.injury !== "none")}</div><div class="s">${n((i) => i.injury === "medical" || i.injury === "hospital")} needed treatment</div></div>
      <div class="card stat"><div class="k">Not reported to BR</div><div class="v" style="color:${notRep ? "var(--warn)" : "var(--ok)"}">${notRep}</div><div class="s">British Rowing</div></div>
    </div>
    <div class="filters">
      <div class="seg" id="in-f">${[["all", "All"], ["open", "Follow-up needed"], ["br", "Not reported to BR"]].map(([k, l]) => `<button data-f="${k}" class="${S.incFilter === k ? "on" : ""}">${l}</button>`).join("")}</div>
      <select class="input" id="in-year" style="width:auto">${years.map((y) => `<option value="${y}" ${S.incYear === y ? "selected" : ""}>${esc(y)}</option>`).join("")}<option value="all" ${S.incYear === "all" ? "selected" : ""}>All years</option></select>
    </div>
    ${shown.length ? `<div class="issue-list">${shown.map((i) => `<button class="card issue-row" data-inc="${i.id}">
        <div class="issue-main"><div class="issue-title">${esc(d.kinds[i.kind])}${i.boat_name ? ` · ${esc(i.boat_name)}` : ""}</div>
          <div class="o-sub"><span>${I.calendar}${esc(incWhen(i))}</span>${i.location ? `<span>${I.pin}${esc(i.location)}</span>` : ""}<span>Reported by ${esc(i.reported_by)}</span>${i.issue_id ? `<span>${I.boat}Boat issue: ${esc(i.issue_title)}</span>` : ""}</div>
          <div class="task-latest small">${esc(i.description.length > 160 ? i.description.slice(0, 160) + "…" : i.description)}</div></div>
        <div class="issue-chips">${i.injury !== "none" ? `<span class="chip ${INC_INJ[i.injury]}">${esc(d.injuries[i.injury])}</span>` : ""}${i.br_reported ? `<span class="chip ok">${I.check}BR</span>` : `<span class="chip warn">Not reported to BR</span>`}<span class="chip ${i.status === "open" ? "accent" : ""}">${esc(d.statuses[i.status])}</span></div>
      </button>`).join("")}</div>`
      : `<div class="card empty">${I.lifebuoy}<h3>${d.incidents.length ? "Nothing here" : "No incidents logged"}</h3><p>${d.incidents.length ? "No incidents match these filters." : "Capsizes, collisions, injuries and near misses reported by anyone in the club appear here."}</p></div>`}`;
  $("#in-new").onclick = () => incidentForm();
  $("#in-csv").onclick = () => { location.href = `/api/committee/incidents.csv${S.incYear === "all" ? "" : `?year=${encodeURIComponent(S.incYear)}`}`; };
  $$("#in-f button").forEach((b) => b.onclick = () => { S.incFilter = b.dataset.f; pageIncidents(); });
  $("#in-year").onchange = (e) => { S.incYear = e.target.value; pageIncidents(); };
  $$("[data-inc]").forEach((b) => b.onclick = () => openIncident(+b.dataset.inc));
}

async function openIncident(id) {
  let i, meta;
  try { [i, meta] = await Promise.all([api(`/api/committee/incidents/${id}`), loadIncMeta()]); } catch (e) { return fail(e); }
  const sec = (t, body, empty = "Not recorded.") => `<div><div class="section-title" style="margin:4px 0 6px">${t}</div>${body ? `<div class="issue-desc">${richText(body)}</div>` : `<div class="faint small">${empty}</div>`}</div>`;
  modal({
    title: `${esc(meta.kinds[i.kind])}, ${esc(incWhen(i))}`, wide: true,
    body: `<div class="issue-chips">${i.boat_name ? `<span class="chip">${I.boat}${esc(i.boat_name)}</span>` : ""}${i.location ? `<span class="chip">${I.pin}${esc(i.location)}</span>` : ""}<span class="chip ${INC_INJ[i.injury]}">${esc(meta.injuries[i.injury])}</span><span class="chip ${i.status === "open" ? "accent" : ""}">${esc(meta.statuses[i.status])}</span></div>
      <dl class="kv">
        <dt>Crew</dt><dd>${esc(i.crew) || `<span class="faint">Not recorded</span>`}</dd>
        ${i.outing ? `<dt>Outing</dt><dd>${esc(fmtLong(i.outing.date))} ${esc(tRange(i.outing))} ${esc(i.outing.kind === "water" ? "water outing" : i.outing.title || "land session")}</dd>` : ""}
        <dt>Reported by</dt><dd>${esc(i.reported_by)} <span class="faint">· ${esc(utcStamp(i.created_at))}</span></dd>
        <dt>British Rowing</dt><dd>${i.br_reported ? `Reported${i.br_reported_on ? ` on ${esc(fmtShort(i.br_reported_on))} ${pd(i.br_reported_on).getUTCFullYear()}` : ""}${i.br_reference ? ` · ref. ${esc(i.br_reference)}` : ""}` : `<span style="color:var(--warn)">Not reported yet</span>`}</dd>
        <dt>Boat issue</dt><dd>${i.issue ? `<a href="#/issues" id="io-issue">${esc(i.issue.title)}</a>` : `<span class="faint">None</span>`}</dd>
      </dl>
      ${sec("What happened", i.description)}
      ${i.injury !== "none" ? sec("Injury", i.injury_details) : ""}
      ${sec("What was done about it", i.action_taken)}
      ${sec("Follow-up", i.follow_up, "No follow-up recorded yet. Use Edit to add lessons learned and close the incident.")}`,
    foot: `<button class="btn danger" id="io-del">Delete</button><button class="btn" id="io-edit">Edit</button>${!i.issue && i.boat_id ? `<button class="btn" id="io-mk">${I.boat}Open boat issue</button>` : ""}<div class="r"><button class="btn" data-close>Close</button></div>`,
    onMount: (m, close) => {
      $("#io-edit", m).onclick = () => incidentForm(i);
      const li = $("#io-issue", m);
      if (li) li.onclick = async (e) => { e.preventDefault(); close(); const boats = (await api("/api/committee/boats")).boats; await go("issues"); openIssue(i.issue.id, boats); };
      const mk = $("#io-mk", m);
      if (mk) mk.onclick = async () => {
        try {
          const r = await api(`/api/committee/incidents/${id}/boat-issue`, { method: "POST", body: { author: me4() } });
          toast("Boat issue opened"); refreshCounts(); const boats = (await api("/api/committee/boats")).boats; await go("issues"); openIssue(r.issue_id, boats);
        } catch (e) { fail(e); }
      };
      $("#io-del", m).onclick = async () => {
        if (!await confirmBox("Delete this incident?", "It's removed from the log for good, including for the safety audit. To keep it on record, close it instead.", "Delete", true)) return openIncident(id);
        try { await api(`/api/committee/incidents/${id}`, { method: "DELETE" }); toast("Incident deleted"); refreshCounts(); rerender(); } catch (e) { fail(e); }
      };
    },
  });
}

// -------------------------------------------------------------- committee --
/* member id -> ["President", ...] */
function committeeByMember(d) {
  const label = Object.fromEntries(d.positions.map((p) => [p.key, p.label]));
  const out = {};
  d.holders.filter((h) => h.member_id).forEach((h) => (out[h.member_id] = out[h.member_id] || []).push(label[h.position]));
  return out;
}
const positionPlural = (label) => label.replace(/Captain$/, "Captains");
const committeeBadge = (titles) => `<span class="c-badge" title="Committee: ${esc(titles.join(", "))}" aria-label="Committee: ${esc(titles.join(", "))}">C</span>`;

async function pageCommittee() {
  let d;
  try { d = await api("/api/club-committee"); } catch (e) { return fail(e); }
  const held = (key) => d.holders.filter((h) => h.position === key);
  const card = (p) => {
    const hs = held(p.key);
    const people = hs.length ? hs.map((h) => `<div class="cm-person"><span class="avatar">${esc(initials(h.name))}</span><span><b>${esc(h.name)}</b>${S.me && h.member_id === S.me ? ` <span class="chip accent">you</span>` : ""}</span></div>`).join("")
      : `<div class="cm-person vacant"><span class="avatar">?</span><span class="faint">Vacant</span></div>`;
    return `<div class="card cm-card"><div class="cm-role">${esc(p.max > 1 && hs.length > 1 ? positionPlural(p.label) : p.label)}</div>${people}</div>`;
  };
  $("#main").innerHTML = `
    <div class="page-head"><div><h1>Committee</h1><p>Who runs the club, and who to talk to. Committee members have a <span class="c-badge" aria-hidden="true">C</span> next to their name on the rowers list.</p></div>
      ${isCommittee() ? `<div class="toolbar"><button class="btn primary" id="cm-edit">Edit committee</button></div>` : ""}</div>
    <div class="cm-grid">${d.positions.map(card).join("")}</div>`;
  const e = $("#cm-edit"); if (e) e.onclick = () => editCommittee(d);
}

/* Roster editor shared by "Edit committee" and the year-end handover: one name field per seat
   (Men's and Women's Captain have two), prefilled from d.holders. */
async function rosterEditor(d) {
  const all = (await api("/api/committee/members")).members.map((m) => ({ id: m.id, name: m.name, active: !!m.active })).sort((a, b) => a.name.localeCompare(b.name));
  const seats = d.positions.flatMap((p) => Array.from({ length: p.max }, (_, slot) => ({ p, slot })));
  const state = seats.map(({ p, slot }) => { const h = d.holders.find((x) => x.position === p.key && x.slot === slot); return { member_id: h?.member_id ?? null, new_name: h && !h.member_id ? h.name : "" }; });
  return {
    html: `<div class="cm-edit">${d.positions.map((p) => {
        const idx = seats.map((x, i) => (x.p === p ? i : -1)).filter((i) => i >= 0);
        return p.max > 1
          ? `<div class="field cm-multi"><span>${esc(positionPlural(p.label))} <span class="faint">(up to ${p.max})</span></span><div class="cm-multi-row">${idx.map((i) => `<div data-seat="${i}" aria-label="${esc(p.label)}"></div>`).join("")}</div></div>`
          : `<label class="field"><span>${esc(p.label)}</span><div data-seat="${idx[0]}"></div></label>`;
      }).join("")}</div>`,
    mount: (root) => $$("[data-seat]", root).forEach((el) => nameField(el, state[+el.dataset.seat], null, { members: all, placeholder: "Vacant — type a name…", newLabel: "Not in the club list:", newChip: "Use this name", empty: "Keep typing the full name…" })),
    holders: () => {
      const holders = seats.map(({ p, slot }, i) => ({ position: p.key, slot, member_id: state[i].member_id, name: state[i].member_id ? "" : state[i].new_name || "" }))
        .filter((h) => h.member_id || h.name.trim());
      // captains are equal: store whoever is filled in from slot 0 upwards, with no gaps
      const bySlot = {};
      holders.forEach((h) => { h.slot = bySlot[h.position] = (bySlot[h.position] ?? -1) + 1; });
      return holders;
    },
  };
}

async function editCommittee(d) {
  let ed;
  try { ed = await rosterEditor(d); } catch (e) { return fail(e); }
  modal({
    title: "Edit committee", wide: true,
    body: `<p class="muted small" style="margin:0">Pick a club member (inactive members are included), or type a name for someone who isn't in the club list (e.g. the Senior Member). Leave a position empty if it's vacant.</p>
      ${ed.html}`,
    foot: `<div class="r"><button class="btn" data-close>Cancel</button><button class="btn primary" id="cm-save">Save</button></div>`,
    onMount: (m, close) => {
      ed.mount(m);
      $("#cm-save", m).onclick = async () => {
        try { await api("/api/committee/club-committee", { method: "PUT", body: { holders: ed.holders() } }); close(); toast("Committee saved"); rerender(); } catch (e) { fail(e); }
      };
    },
  });
}

// --------------------------------------------------------- year-end handover --
/* Close the academic year and set up the next one in one go (see handover.py). */
async function pageHandover() {
  let d, ed;
  try { d = await api("/api/committee/handover"); ed = await rosterEditor(d); } catch (e) { return fail(e); }
  const cur = d.current, pr = d.proposed, ss = d.season, subs = d.subs;
  const done = d.already_archived || d.not_started;
  const lateStart = pr.season_start && d.today >= pr.season_start;
  const nov = d.novices;
  const novRow = (n) => `<label class="ho-nov"><input type="checkbox" data-nov="${n.id}" ${n.suggest ? "checked" : ""}>
      <span><span class="ho-nov-name">${esc(n.name)}</span>${!n.active ? ` <span class="chip">Inactive</span>` : !n.all_time ? ` <span class="chip warn">Never rowed</span>` : ""}
      <span class="faint small" style="display:block">${plural(n.season, "sessions")} this season · ${n.all_time} all time</span></span></label>`;
  const step = (n, title, body) => `<section class="card card-pad ho-step"><h3><span class="ho-n">${n}</span>${title}</h3>${body}</section>`;
  $("#main").innerHTML = `
    <div class="page-head"><div><h1>Year-end handover</h1><p>${d.not_started ? "Close one academic year and set up the next, once a year." : `Close ${esc(cur.academic_year || "this year")} and set up ${esc(pr.academic_year || "the next one")}. Nothing changes until you press <b>Hand over</b> at the bottom.`}</p></div></div>
    ${d.not_started ? `<div class="callout" style="margin-bottom:16px">${I.check}<div><b>${esc(cur.academic_year)} is set up and starts on ${esc(fmtShort(cur.season_start))}.</b> The next handover opens once that season is under way.</div></div>`
      : d.already_archived ? `<div class="callout warn" style="margin-bottom:16px">${I.alert}<div><b>${esc(cur.academic_year)} has already been handed over.</b> Change the academic year under <a href="#/settings">Settings</a> if it should have moved on.</div></div>` : ""}
    ${d.not_started ? "" : `<div class="ho-steps">
    ${step(1, "Archive the season", `<p class="muted" style="margin:0">Since ${esc(fmtShort(ss.start))}: <b>${plural(ss.sessions, "sessions")}</b> went ahead, ${plural(ss.seat_sessions, "seats")} filled by ${plural(ss.active_rowers, "rowers")}, ${ss.cancelled} cancelled.
        The leaderboard, boat usage, committee and handbook are saved. Everyone can still look back at the leaderboard (Leaderboard → season picker). Outing history and all-time totals stay as they are.</p>
      ${lateStart ? `<div class="callout warn">${I.alert}<div>The new season starts on ${esc(fmtShort(pr.season_start))}, but today is later. Outings since then will be counted in ${esc(cur.academic_year)}'s archive.</div></div>` : ""}`)}
    ${step(2, "Roll over the dates", `<div class="grid-2">
        <label class="field"><span>New academic year</span><input class="input" id="ho-ay" value="${esc(pr.academic_year)}" placeholder="e.g. 2027-28"><span class="hint">Now ${esc(cur.academic_year || "not set")}. Term goes back to Michaelmas.</span></label>
        <label class="field"><span>Season starts</span><input class="input" type="date" id="ho-season" value="${esc(pr.season_start)}"><span class="hint">Now ${cur.season_start ? esc(fmtShort(cur.season_start)) : "not set"}. Leaderboard and coaching year count from here.</span></label>
        <label class="field"><span>Full Term starts</span><input class="input" type="date" id="ho-term" value="${esc(pr.term_start)}"><span class="hint">Sunday of 1st week. Suggested: 52 weeks after this year's. Check the University's dates.</span></label>
        <label class="field"><span>Subs cutoff</span><input class="input" type="date" id="ho-cut" value="${esc(pr.subs_cutoff)}"><span class="hint">${cur.subs_cutoff ? `Now ${esc(fmtShort(cur.subs_cutoff))}.` : "Not set now."} Blank = none.</span></label>
      </div><p class="small faint" style="margin:0">The regatta end date (river rules) is cleared, so peak term runs to the end of 8th week until you set it.</p>`)}
    ${step(3, "Reset subs", `<label class="check"><input type="checkbox" id="ho-subs" checked> Set everyone's subs back to <b>Unpaid</b></label>
      <p class="small muted" style="margin:0">Now: ${subs.full_year} full year · ${subs.single_term} single term · ${subs.unpaid} unpaid (active members). Anyone already marked as paid for the new year keeps it. Subs reminders start afresh.</p>`)}
    ${step(4, "Move novices to senior", nov.length ? `<p class="small muted" style="margin:0">Ticked: active novices who have rowed. Novices who never came out stay Novice, so they keep their free outings if they return.</p>
      <div class="ho-nov-tools small"><a href="#" id="ho-all">Tick all</a> · <a href="#" id="ho-none">Untick all</a> · <span id="ho-nov-n"></span></div>
      <div class="ho-novs">${nov.map(novRow).join("")}</div>` : `<p class="muted" style="margin:0">There are no novices to move.</p>`)}
    ${step(5, "Carry the committee forward", `<p class="small muted" style="margin:0">Prefilled with the current committee. Change whoever is leaving; empty = vacant. This year's committee is kept in the archive.</p>
      <div id="ho-roster">${ed.html}</div>
      <div class="callout">${I.info}<div>The <a href="#/handbook">handbook</a> carries over as it is${d.handbook_chars ? "" : " (it's empty at the moment)"}. A copy is saved in the archive. Yearly to-dos already come back by themselves.</div></div>`)}
    </div>
    <div class="ho-go"><button class="btn primary" id="ho-go" ${done ? "disabled" : ""}>${I.repeat}Hand over to ${esc(pr.academic_year || "next year")}</button></div>`}
    ${d.archives.length ? `<div class="section-title">Past seasons</div>
      <div class="card table-wrap"><table class="t ho-past"><thead><tr><th>Season</th><th>Dates</th><th class="ho-when">Handed over</th><th></th></tr></thead><tbody>
      ${d.archives.map((a) => `<tr><td><b>${esc(a.academic_year)}</b></td><td>${a.season_start ? esc(fmtShort(a.season_start)) : "?"} – ${esc(fmtShort(a.season_end))}</td><td class="ho-when">${esc(utcStamp(a.created_at))}</td>
        <td class="num ho-acts"><button class="btn sm" data-lb="${a.id}">${I.trophy}Leaderboard</button> <button class="btn sm" data-arch="${a.id}">Details</button></td></tr>`).join("")}
      </tbody></table></div>` : ""}`;

  $$("[data-lb]").forEach((b) => b.onclick = () => { S.statsArchive = +b.dataset.lb; go("stats"); });
  $$("[data-arch]").forEach((b) => b.onclick = () => openArchive(+b.dataset.arch));
  if (d.not_started) return;
  ed.mount($("#ho-roster"));
  const novCount = () => { const n = $$("[data-nov]:checked").length; const el = $("#ho-nov-n"); if (el) el.textContent = `${n} of ${nov.length} ticked`; };
  novCount();
  $$("[data-nov]").forEach((c) => c.onchange = novCount);
  const setAll = (v) => (e) => { e.preventDefault(); $$("[data-nov]").forEach((c) => (c.checked = v)); novCount(); };
  if ($("#ho-all")) { $("#ho-all").onclick = setAll(true); $("#ho-none").onclick = setAll(false); }

  $("#ho-go").onclick = async () => {
    const body = {
      academic_year: $("#ho-ay").value.trim(), season_start: $("#ho-season").value, term_start: $("#ho-term").value,
      subs_cutoff: $("#ho-cut").value, reset_subs: $("#ho-subs").checked,
      promote: $$("[data-nov]:checked").map((c) => +c.dataset.nov), holders: ed.holders(),
    };
    if (!body.academic_year) return toast("Enter the new academic year", true);
    if (!body.season_start) return toast("Pick when the new season starts", true);
    if (body.term_start && dow(body.term_start) !== 6) return toast("Full Term starts on a Sunday (Sunday of 1st week)", true);
    const lines = [`Archive <b>${esc(cur.academic_year)}</b> and switch to <b>${esc(body.academic_year)}</b>, Michaelmas, season from ${esc(fmtShort(body.season_start))}`,
      body.reset_subs ? "Reset everyone's subs to Unpaid" : "Leave subs as they are",
      `Move ${plural(body.promote.length, "novices")} to senior`, "Save the committee as entered"];
    if (!await confirmBox(`Hand over to ${esc(body.academic_year)}?`, `<ul class="ho-confirm">${lines.map((l) => `<li>${l}</li>`).join("")}</ul>This can't be undone in one click, but the old season stays in the archive.`, "Hand over")) return;
    try {
      const r = await api("/api/committee/handover", { method: "POST", body });
      await reboot();
      toast(`Welcome to ${r.settings.academic_year}! ${r.archived} is archived.`);
      pageHandover();
    } catch (e) { fail(e); }
  };
}

async function openArchive(id) {
  let a;
  try { a = await api(`/api/committee/archives/${id}`); } catch (e) { return fail(e); }
  const held = (k) => a.roster.holders.filter((h) => h.position === k).map((h) => esc(h.name)).join(", ");
  const boats = a.usage.boats.filter((b) => b.outings);
  modal({
    title: `${esc(a.academic_year)} season`, wide: true,
    body: `<p class="muted small" style="margin:0">${a.season_start ? esc(fmtShort(a.season_start)) : "?"} – ${esc(fmtShort(a.season_end))} · handed over ${esc(utcStamp(a.created_at))}</p>
      <div class="section-title" style="margin:4px 0 0">Committee</div>
      <dl class="ho-dl">${a.roster.positions.map((p) => `<dt>${esc(p.label)}</dt><dd>${held(p.key) || `<span class="faint">Vacant</span>`}</dd>`).join("")}</dl>
      <div class="section-title" style="margin:4px 0 0">Subs at handover</div>
      <p style="margin:0">${a.subs.full_year} full year · ${a.subs.single_term} single term · ${a.subs.unpaid} unpaid</p>
      <div class="section-title" style="margin:4px 0 0">Moved to senior</div>
      <p style="margin:0">${a.promoted.length ? a.promoted.map(esc).join(", ") : `<span class="faint">Nobody</span>`}</p>
      <div class="section-title" style="margin:4px 0 0">Boats</div>
      ${boats.length ? `<table class="t"><thead><tr><th>Boat</th><th class="num">Outings</th><th class="num">Hours</th></tr></thead><tbody>${boats.map((b) => `<tr><td>${esc(b.name)} <span class="faint">${esc(b.boat_type)}</span></td><td class="num">${b.outings}</td><td class="num">${fmtHours(b.hours)}</td></tr>`).join("")}</tbody></table>
        <p class="small faint" style="margin:0">${fmtHours(a.usage.totals.hours)} hours on the water across ${plural(a.usage.totals.outings, "outings")}.</p>` : `<p class="faint" style="margin:0">No boat use recorded.</p>`}
      <details><summary class="section-title" style="cursor:pointer;margin:4px 0 0">Handbook as it was</summary><div class="handbook small">${a.handbook ? richText(a.handbook) : `<span class="faint">Empty</span>`}</div></details>`,
    foot: `<div class="r"><button class="btn" data-close>Close</button><button class="btn primary" id="ar-lb">${I.trophy}Leaderboard</button></div>`,
    onMount: (m, close) => { $("#ar-lb", m).onclick = () => { close(); S.statsArchive = id; go("stats"); }; },
  });
}

// ---------------------------------------------------------- committee to-do --
const TASK_ST = { open: "", in_progress: "accent", waiting: "warn", done: "ok" };
const TASK_PRI = { high: "bad", medium: "warn", low: "", "": "" };
const daysUntil = (d) => Math.round((pd(d) - pd(S.boot.today)) / 86400000);
/* badge on the To-do tab: open tasks that are overdue, due within 2 weeks, or high priority */
const taskAttention = (d) => d.tasks.filter((t) => t.status !== "done" && (t.priority === "high" || (t.due && daysUntil(t.due) <= 14))).length;
const dueChip = (t) => {
  if (!t.due) return "";
  const n = daysUntil(t.due), done = t.status === "done";
  const cls = done ? "" : n < 0 ? "bad" : n <= 14 ? "warn" : "";
  const when = done ? `Due ${fmtShort(t.due)}` : n < 0 ? `Overdue · ${fmtShort(t.due)}` : n === 0 ? "Due today" : n <= 14 ? `Due in ${n} day${n === 1 ? "" : "s"}` : `Due ${fmtShort(t.due)} ${pd(t.due).getUTCFullYear()}`;
  return `<span class="chip ${cls}">${I.calendar}${esc(when)}</span>`;
};
/* Escape, keep line breaks, and turn web addresses and emails into links. */
function richText(text) {
  const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]|\b(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:org|com|net|uk|io|co|edu|gov|ac\.uk|org\.uk|co\.uk)(?:\/[^\s<]*[^\s<.,;:!?)\]'"])?|[\w.+-]+@[\w-]+(?:\.[\w-]+)+)/gi;
  return esc(text).replace(URL_RE, (m) => {
    const href = m.includes("@") && !m.includes("/") ? `mailto:${m}` : /^https?:/i.test(m) ? m : `https://${m}`;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${m}</a>`;
  });
}
const me4 = () => meName() || "Committee";

/* Incident log summary for the to-do list (the yearly safety audit asks for it). */
function incidentCallout(inc, always = false) {
  if (!inc || (!always && !inc.open && !inc.not_reported)) return "";
  const bits = [`${inc.this_year} incident${inc.this_year === 1 ? "" : "s"} logged in ${esc(inc.year)}`];
  if (inc.not_reported) bits.push(`<b>${inc.not_reported} not yet reported to British Rowing</b>`);
  if (inc.open) bits.push(`${inc.open} need${inc.open === 1 ? "s" : ""} follow-up`);
  return `<div class="callout ${inc.not_reported ? "warn" : ""}" style="margin-bottom:14px">${I.lifebuoy}<div>${bits.join(", ")}. See <a href="#/incidents">Boat park → Incidents</a>; its CSV export is the incident record for the safety audit.</div></div>`;
}
const isSafetyAudit = (t) => /safety\s*audit|incident/i.test(t.title);

async function pageTasks() {
  let d, inc = null;
  try { [d, inc] = await Promise.all([api("/api/committee/tasks"), api("/api/committee/incidents/summary").catch(() => null)]); } catch (e) { return fail(e); }
  setCount("todo", taskAttention(d));
  S.taskFilter = S.taskFilter || "open";
  const q = fold(S.taskQ);
  const shown = d.tasks.filter((t) => (S.taskFilter === "all" || (S.taskFilter === "done") === (t.status === "done"))
    && (!S.taskOwner || t.owner === S.taskOwner) && (!q || fold(`${t.title} ${t.plan} ${t.owner}`).includes(q)));
  const nOpen = d.tasks.filter((t) => t.status !== "done").length;
  $("#main").innerHTML = `
    <div class="page-head"><div><h1>Committee to-do</h1><p>${nOpen} open task${nOpen === 1 ? "" : "s"}. Only the committee can see this list.</p></div>
      <div class="toolbar"><button class="btn primary" id="tk-new">${I.plus}New task</button></div></div>
    ${incidentCallout(inc)}
    ${d.open_boat_issues ? `<div class="callout" style="margin-bottom:14px">${I.boat}<div>Problems with a specific boat are tracked under <a href="#/issues">Boat park → Issues</a> (${d.open_boat_issues} open). Use <b>Move to boat issues</b> on a task that's really about one boat.</div></div>` : ""}
    <div class="filters">
      <input class="input" id="tk-q" placeholder="Search tasks…" style="max-width:240px" value="${esc(S.taskQ || "")}">
      <div class="seg" id="tk-f">${[["open", "Open"], ["done", "Done"], ["all", "All"]].map(([k, l]) => `<button data-f="${k}" class="${S.taskFilter === k ? "on" : ""}">${l}</button>`).join("")}</div>
      ${d.owners.length ? `<select class="input" id="tk-owner" style="width:auto"><option value="">Everyone</option>${d.owners.map((o) => `<option ${S.taskOwner === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>` : ""}
    </div>
    ${shown.length ? `<div class="issue-list">${shown.map((t) => `<button class="card issue-row task-row ${t.status === "done" ? "done" : ""}" data-task="${t.id}">
        <div class="issue-main"><div class="issue-title">${esc(t.title)}</div>
          <div class="o-sub">${t.owner ? `<span>${I.user}${esc(t.owner)}</span>` : `<span class="faint">No one assigned</span>`}${t.repeat_yearly ? `<span>${I.repeat}Every year</span>` : ""}${t.notes > 1 ? `<span>${t.notes} updates</span>` : ""}</div>
          ${t.latest ? `<div class="task-latest small"><b>${esc(t.latest.author || "Update")}:</b> ${esc(t.latest.note)}</div>` : ""}</div>
        <div class="issue-chips">${t.priority ? `<span class="chip ${TASK_PRI[t.priority]}">${esc(d.priorities[t.priority])}</span>` : ""}${dueChip(t)}<span class="chip ${TASK_ST[t.status]}">${esc(d.statuses[t.status])}</span></div>
      </button>`).join("")}</div>`
      : `<div class="card empty">${I.todo}<h3>${d.tasks.length ? "Nothing here" : "No tasks yet"}</h3><p>${d.tasks.length ? "No tasks match these filters." : "Add the first task on the committee's to-do list."}</p>${d.tasks.length ? "" : `<button class="btn primary" id="tk-new2">${I.plus}New task</button>`}</div>`}`;
  $("#tk-new").onclick = () => editTask(null, d);
  const n2 = $("#tk-new2"); if (n2) n2.onclick = () => editTask(null, d);
  $$("#tk-f button").forEach((b) => b.onclick = () => { S.taskFilter = b.dataset.f; pageTasks(); });
  const ow = $("#tk-owner"); if (ow) ow.onchange = (e) => { S.taskOwner = e.target.value; pageTasks(); };
  let tq; $("#tk-q").oninput = (e) => { clearTimeout(tq); tq = setTimeout(() => { S.taskQ = e.target.value; pageTasks().then(() => { const i = $("#tk-q"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 250); };
  $$("[data-task]").forEach((b) => b.onclick = () => openTask(+b.dataset.task, d));
}

async function openTask(id, d) {
  let t, inc = null;
  try { t = await api(`/api/committee/tasks/${id}`); } catch (e) { return fail(e); }
  if (isSafetyAudit(t)) inc = await api("/api/committee/incidents/summary").catch(() => null);
  const st = d.statuses;
  const timeline = t.updates.map((u, k) => `<div class="tl-item"><div class="tl-dot ${u.status ? TASK_ST[u.status] || "" : ""}"></div><div>
      <div class="small"><b>${esc(u.author || "Someone")}</b> ${k === 0 ? "added this task" : u.status ? `set it to <span class="chip ${TASK_ST[u.status]}">${esc(st[u.status])}</span>` : "posted an update"} <span class="faint">· ${esc(utcStamp(u.created_at))}</span></div>
      ${u.note ? `<div class="tl-note">${richText(u.note)}</div>` : ""}</div></div>`).join("");
  modal({
    title: esc(t.title), wide: true,
    body: `<div class="issue-chips">${t.priority ? `<span class="chip ${TASK_PRI[t.priority]}">${esc(d.priorities[t.priority])} priority</span>` : ""}<span class="chip ${TASK_ST[t.status]}">${esc(st[t.status])}</span>${dueChip(t)}${t.repeat_yearly ? `<span class="chip">${I.repeat}Every year</span>` : ""}${t.owner ? `<span class="chip">${I.user}${esc(t.owner)}</span>` : ""}</div>
      ${incidentCallout(inc, true)}
      <div><div class="section-title" style="margin:4px 0 6px">Plan of action</div>${t.plan ? `<div class="issue-desc">${richText(t.plan)}</div>` : `<div class="faint small">No plan written yet.</div>`}</div>
      <div class="section-title" style="margin:6px 0 0">Updates</div>
      <div class="timeline">${timeline}</div>
      <div class="card-pad issue-add">
        <div class="grid-2"><label class="field"><span>Status</span><select class="input" id="tu-st">${Object.entries(st).map(([k, l]) => `<option value="${k}" ${k === t.status ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
          <label class="field"><span>Your name</span><input class="input" id="tu-who" value="${esc(meName() || "")}"></label></div>
        <label class="field"><span>Update</span><textarea class="input" id="tu-note" rows="2" maxlength="4000" placeholder="e.g. Ordered, awaiting delivery"></textarea></label>
        ${t.repeat_yearly && t.status !== "done" ? `<div class="small muted">${I.repeat} When this is marked done, next year's task is added automatically, due ${esc(fmtShort(t.due))} ${pd(t.due).getUTCFullYear() + 1}.</div>` : ""}
      </div>`,
    foot: `<button class="btn danger" id="tu-del">Delete</button><button class="btn" id="tu-edit">Edit</button><button class="btn" id="tu-move" title="For problems with one boat">${I.boat}Move to boat issues</button><div class="r"><button class="btn" data-close>Close</button><button class="btn primary" id="tu-save">Save update</button></div>`,
    onMount: (m, close) => {
      $("#tu-save", m).onclick = async () => {
        const status = $("#tu-st", m).value, note = $("#tu-note", m).value.trim();
        if (!note && status === t.status) return toast("Write an update or change the status", true);
        try {
          const r = await api(`/api/committee/tasks/${id}/updates`, { method: "POST", body: { note, status: status !== t.status ? status : "", author: $("#tu-who", m).value.trim() || me4() } });
          close(); toast(r.next_id ? "Done! Next year's task has been added" : "Update saved"); await rerender();
          if (!r.next_id || status !== "done") openTask(id, d);
        } catch (e) { fail(e); }
      };
      $("#tu-edit", m).onclick = () => editTask(t, d);
      $("#tu-move", m).onclick = () => moveTaskToBoat(t);
      $("#tu-del", m).onclick = async () => {
        if (!await confirmBox("Delete this task?", "Its updates are deleted too. To keep the history, mark it as done instead.", "Delete", true)) return openTask(id, d);
        try { await api(`/api/committee/tasks/${id}`, { method: "DELETE" }); toast("Task deleted"); rerender(); } catch (e) { fail(e); }
      };
    },
  });
}

async function editTask(t, d) {
  let roster = { holders: [], positions: [] };
  try { roster = await api("/api/club-committee"); } catch {}
  const v = t || { title: "", priority: "", plan: "", owner: "", due: "", repeat_yearly: false };
  let pri = v.priority;
  const who = [...new Set([...d.owners, ...roster.holders.map((h) => h.name), "Captains", "Whole committee"])].sort((a, b) => a.localeCompare(b));
  modal({
    title: t ? "Edit task" : "New task", wide: true,
    body: `<label class="field"><span>Task</span><input class="input" id="te-title" maxlength="300" value="${esc(v.title)}" placeholder="e.g. Renew insurance (BR Affiliation Plus)"></label>
      <div class="grid-2"><div class="field"><span>Priority</span><div class="seg" id="te-pri">${[["high", "High"], ["medium", "Medium"], ["low", "Low"], ["", "None"]].map(([k, l]) => `<button type="button" data-v="${k}" class="${pri === k ? "on" : ""}">${l}</button>`).join("")}</div></div>
        <label class="field"><span>Who's doing it</span><input class="input" id="te-owner" list="te-owners" maxlength="200" value="${esc(v.owner)}" placeholder="e.g. Sophie, or Captains"><datalist id="te-owners">${who.map((x) => `<option value="${esc(x)}">`).join("")}</datalist></label></div>
      <div class="grid-2"><label class="field"><span>Due date (optional)</span><input class="input" type="date" id="te-due" value="${esc(v.due)}"></label>
        <div class="field"><span>&nbsp;</span><label class="check"><input type="checkbox" id="te-rep" ${v.repeat_yearly ? "checked" : ""}> Repeats every year <span class="faint small">(e.g. insurance, BR affiliation, safety audit)</span></label></div></div>
      <label class="field"><span>Plan of action</span><textarea class="input" id="te-plan" rows="6" maxlength="8000" placeholder="Steps, contacts, links, costs…">${esc(v.plan)}</textarea></label>`,
    foot: `<div class="r"><button class="btn" id="te-cancel">Cancel</button><button class="btn primary" id="te-save">Save</button></div>`,
    onMount: (m, close) => {
      $$("#te-pri button", m).forEach((b) => b.onclick = () => { pri = b.dataset.v; $$("#te-pri button", m).forEach((x) => x.classList.toggle("on", x === b)); });
      $("#te-cancel", m).onclick = () => (t ? openTask(t.id, d) : close());
      $("#te-save", m).onclick = async () => {
        const body = { title: $("#te-title", m).value.trim(), priority: pri, owner: $("#te-owner", m).value, due: $("#te-due", m).value, repeat_yearly: $("#te-rep", m).checked, plan: $("#te-plan", m).value };
        if (!body.title) return toast("Give the task a title", true);
        if (body.repeat_yearly && !body.due) return toast("A yearly task needs a due date", true);
        try {
          const r = await api(t ? `/api/committee/tasks/${t.id}` : `/api/committee/tasks?author=${encodeURIComponent(me4())}`, { method: t ? "PUT" : "POST", body });
          close(); toast("Task saved"); await rerender(); openTask(t ? t.id : r.id, d);
        } catch (e) { fail(e); }
      };
    },
  });
}

async function moveTaskToBoat(t) {
  let boats;
  try { boats = (await api("/api/committee/boats")).boats.filter((b) => b.status !== "retired"); } catch (e) { return fail(e); }
  let sev = "minor";
  modal({
    title: "Move to boat issues",
    body: `<p class="muted" style="margin:0">“${esc(t.title)}” becomes an issue on the boat's page, with its plan and updates. Rowers can then see it and add notes and photos. The task is removed from this list.</p>
      <label class="field"><span>Boat</span><select class="input" id="mv-boat"><option value="">Choose a boat…</option>${boats.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join("")}</select></label>
      <div class="field"><span>How serious?</span><div class="seg" id="mv-sev">${Object.entries(ISSUE_SEV).map(([k, [l]]) => `<button type="button" data-v="${k}" class="${k === sev ? "on" : ""}">${esc(l)}</button>`).join("")}</div></div>`,
    foot: `<div class="r"><button class="btn" data-close>Cancel</button><button class="btn primary" id="mv-go">${I.boat}Move</button></div>`,
    onMount: (m, close) => {
      $$("#mv-sev button", m).forEach((b) => b.onclick = () => { sev = b.dataset.v; $$("#mv-sev button", m).forEach((x) => x.classList.toggle("on", x === b)); });
      $("#mv-go", m).onclick = async () => {
        const boat_id = +$("#mv-boat", m).value;
        if (!boat_id) return toast("Pick a boat", true);
        try {
          const r = await api(`/api/committee/tasks/${t.id}/move-to-boat`, { method: "POST", body: { boat_id, severity: sev, author: me4() } });
          close(); toast("Moved to boat issues"); refreshCounts(); await go("issues"); openIssue(r.issue_id, boats);
        } catch (e) { fail(e); }
      };
    },
  });
}

async function pageHandbook() {
  let h;
  try { h = await api("/api/committee/handbook"); } catch (e) { return fail(e); }
  $("#main").innerHTML = `
    <div class="page-head"><div><h1>Committee handbook</h1><p>Standing information to hand over each year: contacts, how-tos and reminders. Only the committee can see this.</p></div>
      <div class="toolbar"><button class="btn primary" id="hb-edit">Edit</button></div></div>
    <div class="card card-pad handbook">${h.text ? richText(h.text) : `<span class="faint">Nothing written yet. Add contacts, procedures and reminders.</span>`}</div>`;
  $("#hb-edit").onclick = () => modal({
    title: "Edit handbook", wide: "xl",
    body: `<textarea class="input" id="hb-text" rows="20" maxlength="50000" placeholder="e.g. If there are any significant safety incidents, report them to British Rowing at incidentreporting.britishrowing.org">${esc(h.text)}</textarea>
      <span class="hint">Plain text. Line breaks are kept, and web addresses and emails become links. Start a line with • for a bullet.</span>`,
    foot: `<div class="r"><button class="btn" data-close>Cancel</button><button class="btn primary" id="hb-save">Save</button></div>`,
    onMount: (m, close) => {
      $("#hb-save", m).onclick = async () => {
        try { await api("/api/committee/handbook", { method: "PUT", body: { text: $("#hb-text", m).value } }); close(); toast("Handbook saved"); pageHandbook(); } catch (e) { fail(e); }
      };
    },
  });
}

// ---------------------------------------------------------------- coaches --
async function pageCoaches() {
  let coaches, stats;
  try { [coaches, stats] = await Promise.all([api("/api/committee/coaches"), api("/api/committee/coaching-stats")]); } catch (e) { return fail(e); }
  const mlabel = (m) => { const [y, mo] = m.split("-").map(Number); return `${MON[mo - 1]} ${String(y).slice(2)}`; };
  $("#main").innerHTML = `
    <div class="page-head"><div><h1>Coaches</h1><p>Sessions per coach per month, counted from the Coach / bankrider field on every session.</p></div>
      <div class="toolbar"><button class="btn primary" id="c-add">${I.plus}Add coach</button></div></div>
    <div class="card table-wrap"><table class="t"><thead><tr><th>Coach</th>${stats.months.map((m) => `<th class="num">${mlabel(m)}</th>`).join("")}<th class="num">Total</th></tr></thead>
      <tbody>${stats.rows.map((r) => { const c = coaches.find((x) => x.name === r.name); return `<tr class="clickable" data-id="${c?.id}"><td><b>${esc(r.name)}</b></td>${stats.months.map((m) => `<td class="num ${r.months[m] ? "" : "faint"}">${r.months[m] || "·"}</td>`).join("")}<td class="num"><b>${r.total}</b></td></tr>`; }).join("") || `<tr><td colspan="14" class="faint" style="text-align:center;padding:30px">No coaches yet.</td></tr>`}</tbody></table></div>
    ${stats.uncounted.length ? `<div class="section-title">Not matched to a coach</div><div class="callout warn">${I.alert}<div>These coach entries don't match anyone above, so they aren't counted: ${stats.uncounted.map((u) => `<b>${esc(u.coach)}</b> (${u.n})`).join(", ")}. Add the coach, or use their full name in the Coach / bankrider field.</div></div>` : ""}`;
  const edit = (c) => modal({
    title: c ? "Edit coach" : "Add coach",
    body: `<label class="field"><span>Name</span><input class="input" id="c-name" value="${esc(c?.name || "")}"></label>`,
    foot: `${c ? `<button class="btn danger" id="c-del">Delete</button>` : ""}<div class="r"><button class="btn" data-close>Cancel</button><button class="btn primary" id="c-save">Save</button></div>`,
    onMount: (m, close) => {
      $("#c-save", m).onclick = async () => {
        const body = { name: $("#c-name", m).value.trim() };
        if (!body.name) return toast("Name is required", true);
        try { await api(c ? `/api/committee/coaches/${c.id}` : "/api/committee/coaches", { method: c ? "PUT" : "POST", body }); close(); pageCoaches(); } catch (e) { fail(e); }
      };
      const d = $("#c-del", m); if (d) d.onclick = async () => { await api(`/api/committee/coaches/${c.id}`, { method: "DELETE" }).catch(fail); close(); pageCoaches(); };
    },
  });
  $("#c-add").onclick = () => edit(null);
  $$("tr[data-id]").forEach((tr) => tr.onclick = () => edit(coaches.find((c) => c.id === +tr.dataset.id)));
}

// --------------------------------------------------------------- settings --
async function pageSettings() {
  let s;
  try { s = await api("/api/committee/settings"); } catch (e) { return fail(e); }
  $("#main").innerHTML = `
    <div class="page-head"><div><h1>Settings</h1><p>Review these at the start of each term.</p></div></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:16px;align-items:start">
      <div class="card card-pad" style="display:flex;flex-direction:column;gap:14px">
        <h3 style="margin:0">Term &amp; subs</h3>
        <label class="field"><span>Club name</span><input class="input" id="s-club" value="${esc(s.club_name)}"></label>
        <div class="grid-2">
          <label class="field"><span>Academic year</span><input class="input" id="s-ay" value="${esc(s.academic_year)}" placeholder="2026-27"><span class="hint">Must match members' “Academic year”.</span></label>
          <label class="field"><span>Current term</span><select class="input" id="s-term">${s.terms.map((t) => `<option ${t === s.current_term ? "selected" : ""}>${t}</option>`).join("")}</select></label>
        </div>
        <label class="field"><span>Subs cutoff date</span><input class="input" type="date" id="s-cut" value="${esc(s.subs_cutoff)}"><span class="hint">Unpaid members may row up to and including this date.</span></label>
        <div class="grid-2">
          <label class="field"><span>Free water outings for novices</span><input class="input" type="number" min="0" max="50" id="s-free" value="${s.novice_free_outings}"><span class="hint">For novices who haven't paid subs yet: no subs needed for these.</span></label>
          <div class="field"><span>&nbsp;</span><label class="check"><input type="checkbox" id="s-land" ${s.novice_land_free ? "checked" : ""}> Land free for novices while free water outings remain</label></div>
        </div>
        <div class="grid-2">
          <label class="field"><span>Swim test required after</span><input class="input" type="number" min="0" max="50" id="s-swim" value="${s.swim_test_after}"><span class="hint">Water outings anyone may do before a swim test is needed (applies to everyone).</span></label>
          <span></span>
          <label class="field"><span>Swim test valid for (months)</span><input class="input" type="number" min="0" max="240" id="s-swimv" value="${s.swim_test_valid_months}"><span class="hint">Counted from the swim test date. 0 = never expires. An expired swim test counts as no swim test.</span></label>
          <label class="field"><span>Cox status valid for (months)</span><input class="input" type="number" min="0" max="240" id="s-coxv" value="${s.cox_status_valid_months}"><span class="hint">Counted from the date it was awarded. 0 = never expires. Expiry is a warning only.</span></label>
          <label class="field"><span>Coaching year starts</span><input class="input" type="date" id="s-season" value="${esc(s.season_start)}"><span class="hint">First month on the Coaches page.</span></label>
          <label class="field"><span>Override “today” (testing)</span><input class="input" type="date" id="s-today" value="${esc(s.today_override)}"><span class="hint">Leave blank normally.</span></label>
        </div>
        <div><button class="btn primary" id="s-save">Save settings</button></div>
      </div>
      <div style="display:flex;flex-direction:column;gap:16px">
        <div class="card card-pad" style="display:flex;flex-direction:column;gap:12px">
          <h3 style="margin:0">Rower password</h3>
          <p class="muted small" style="margin:0">${s.member_password_custom ? "A custom rower password is set here (overrides the server's MEMBER_PASSWORD)." : "Currently using the MEMBER_PASSWORD set on the server."} Changing it doesn't sign out people already signed in.</p>
          <div style="display:flex;gap:8px"><input class="input" type="password" id="s-mpw" placeholder="New rower password" autocomplete="new-password"><button class="btn" id="s-mpw-save">Set</button></div>
          ${s.member_password_custom ? `<div><button class="btn sm ghost" id="s-mpw-reset">Revert to server password</button></div>` : ""}
        </div>
        <div class="card card-pad" style="display:flex;flex-direction:column;gap:12px">
          <h3 style="margin:0">River rules</h3>
          <p class="muted small" style="margin:0">Sessions are checked against the OURCs rules for the Isis and the current flag, which is fetched every hour. Peak term runs from the Thursday of 0th week to the last day of the term's major regatta.</p>
          <div id="s-river-flag" class="small muted">Loading flag…</div>
          <div class="grid-2">
            <label class="field"><span>Full Term starts</span><input class="input" type="date" id="s-term-start"><span class="hint">Sunday of 1st week.</span></label>
            <label class="field"><span>Major regatta ends</span><input class="input" type="date" id="s-peak-end"><span class="hint">Tamesis / Torpids / Summer VIIIs. Blank = end of 8th week.</span></label>
          </div>
          <label class="field"><span>Crews on the water at once before 08:00 (peak term)</span><input class="input" type="number" min="1" max="5" id="s-peak8"><span class="hint">1 normally; 2 with an Extra Slot or the OURCs Secretary's permission. (Trinity uses its own limit of two 4s/8s.)</span></label>
          <div class="toolbar"><button class="btn" id="s-river-save">Save river settings</button><button class="btn ghost" id="s-river-refresh">Check flag now</button><button class="btn ghost" id="s-river-rules">View rules</button></div>
        </div>
        <div class="card card-pad" style="display:flex;flex-direction:column;gap:12px">
          <h3 style="margin:0">Places</h3>
          <p class="muted small" style="margin:0">Give the places you use (e.g. “Boathouse”) a full address. Sessions at that place then get a maps link, and calendar events carry the address so phones can navigate there. Add coordinates for an exact pin.</p>
          <div id="s-places" class="places-list"></div>
          <div><button class="btn" id="s-place-add">${I.plus}Add place</button></div>
        </div>
        <div class="card card-pad" style="display:flex;flex-direction:column;gap:12px">
          <h3 style="margin:0">Phone numbers</h3>
          ${s.phone_encryption
            ? `<div class="callout">${I.check}<div>Stored <b>encrypted</b> with the server's <code>PHONE_KEY</code>. ${s.phone_count} number${s.phone_count === 1 ? "" : "s"} on file.</div></div>`
            : `<div class="callout warn">${I.alert}<div><b><code>PHONE_KEY</code> isn't set</b>, so the sign-up form doesn't ask for phone numbers. To collect them, set <code>PHONE_KEY</code> on the server (at least 16 characters, e.g. from <code>openssl rand -base64 32</code>) and restart.${s.phone_count ? ` <b>${s.phone_count}</b> number${s.phone_count === 1 ? " is" : "s are"} stored from before without encryption. Setting the key encrypts them.` : ""}</div></div>`}
          <label class="field"><span>Ask for a phone number on the sign-up form</span>
            <select class="input" id="s-phone-mode" ${s.phone_encryption ? "" : "disabled"}>${[["required", "Required"], ["optional", "Optional"], ["off", "Don't ask"]].map(([k, l]) => `<option value="${k}" ${s.phone_mode === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
          <label class="field"><span>Delete a number after this many days without a sign-up</span>
            <input class="input" type="number" min="0" max="3650" id="s-phone-days" value="${s.phone_retention_days}"><span class="hint">0 keeps numbers until deleted by hand. Old numbers are checked every few hours.</span></label>
          <div><button class="btn" id="s-phone-save">Save phone settings</button></div>
        </div>
        <div class="card card-pad" style="display:flex;flex-direction:column;gap:12px">
          <h3 style="margin:0">Data</h3>
          <div class="toolbar"><a class="btn" href="/api/committee/backup">${I.download}Download database backup</a><button class="btn" id="s-csv">${I.download}Members CSV</button></div>
          <p class="muted small" style="margin:0">Phone numbers in the backup stay encrypted. They can only be read with this server's <code>PHONE_KEY</code>. Boat-issue photos aren't in the database backup: they're in the <code>photos</code> folder next to it.</p>
          <div class="field"><span>Boat-issue photos</span><div class="meter"><div id="s-ph-bar"></div></div><span class="hint" id="s-ph-used">…</span></div>
          <div style="display:flex;gap:8px;align-items:flex-end"><label class="field" style="flex:1"><span>Storage limit for photos (MB)</span><input class="input" type="number" min="10" max="100000" id="s-ph-limit"></label><button class="btn" id="s-ph-save">Save</button></div>
        </div>
      </div>
    </div>`;
  const phoneFields = () => ({ phone_mode: $("#s-phone-mode").value, phone_retention_days: Math.max(0, Math.min(3650, +$("#s-phone-days").value || 0)) });
  $("#s-csv").onclick = () => exportModal("/api/committee/members.csv", "all members");
  const drawStorage = (ps) => {
    const pct = Math.min(100, (ps.used / ps.limit) * 100);
    $("#s-ph-bar").style.width = `${pct}%`; $("#s-ph-bar").className = pct > 90 ? "bad" : pct > 70 ? "warn" : "";
    $("#s-ph-used").textContent = `${ps.count} photo${ps.count === 1 ? "" : "s"} · ${fmtBytes(ps.used)} of ${ps.limit_mb} MB used. When it's full, new uploads are refused.`;
    $("#s-ph-limit").value = ps.limit_mb;
  };
  api("/api/committee/photo-storage").then(drawStorage).catch(() => {});
  $("#s-ph-save").onclick = async () => {
    try { drawStorage(await api("/api/committee/photo-storage", { method: "PUT", body: { photo_storage_mb: Math.max(10, +$("#s-ph-limit").value || 300) } })); toast("Photo limit saved"); } catch (e) { fail(e); }
  };
  const drawFlag = (f) => { $("#s-river-flag").innerHTML = `<span class="flag-dot" style="background:${esc(f.colour)}"></span> Isis: <b>${esc(f.name)}</b> · checked ${esc(fmtStamp(f.checked_at) || "never")}${f.error ? ` · <span style="color:var(--bad)">last check failed: ${esc(f.error)}</span>` : ""}`; };
  api("/api/river").then((rv) => {
    drawFlag(rv.flag);
    $("#s-term-start").value = rv.settings.term_start || ""; $("#s-peak-end").value = rv.settings.peak_end || ""; $("#s-peak8").value = rv.settings.peak_crews_before_8 || 1;
  }).catch(() => {});
  $("#s-river-save").onclick = async () => {
    const body = { term_start: $("#s-term-start").value, peak_end: $("#s-peak-end").value, peak_crews_before_8: Math.max(1, Math.min(5, +$("#s-peak8").value || 1)) };
    try { await api("/api/committee/river-settings", { method: "PUT", body }); toast("River settings saved"); } catch (e) { fail(e); }
  };
  $("#s-river-refresh").onclick = async () => { try { drawFlag(await api("/api/committee/river/refresh", { method: "POST" })); toast("Flag checked"); } catch (e) { fail(e); } };
  $("#s-river-rules").onclick = () => riverModal();
  const drawPlaces = async () => {
    const ps = await loadPlaces(true);
    $("#s-places").innerHTML = ps.length ? ps.map((p) => `<button type="button" class="place-row" data-place="${p.id}">
        <span><b>${esc(p.name)}</b><span class="faint small">${esc(p.address || "No address yet")}</span></span>
        <span class="chip ${p.lat != null ? "ok" : ""}">${p.lat != null ? "Pin set" : "Address only"}</span></button>`).join("")
      : `<div class="faint small">No places yet.</div>`;
    $$("[data-place]").forEach((b) => b.onclick = () => editPlace(ps.find((p) => p.id === +b.dataset.place), drawPlaces));
  };
  $("#s-place-add").onclick = () => editPlace(null, drawPlaces);
  drawPlaces();
  $("#s-phone-save").onclick = async () => {
    const body = { club_name: s.club_name, academic_year: s.academic_year, current_term: s.current_term, subs_cutoff: s.subs_cutoff, novice_free_outings: s.novice_free_outings,
      novice_land_free: s.novice_land_free, season_start: s.season_start, today_override: s.today_override, ...phoneFields() };
    try { await api("/api/committee/settings", { method: "PUT", body }); toast("Phone settings saved"); pageSettings(); } catch (e) { fail(e); }
  };
  $("#s-save").onclick = async () => {
    const body = { club_name: $("#s-club").value.trim() || "Reuben Boat Club", academic_year: $("#s-ay").value.trim(), current_term: $("#s-term").value, subs_cutoff: $("#s-cut").value,
      novice_free_outings: +$("#s-free").value || 0, novice_land_free: $("#s-land").checked, season_start: $("#s-season").value, today_override: $("#s-today").value, swim_test_after: Math.max(0, +$("#s-swim").value || 0),
      swim_test_valid_months: Math.max(0, +$("#s-swimv").value || 0), cox_status_valid_months: Math.max(0, +$("#s-coxv").value || 0), ...phoneFields() };
    try { await api("/api/committee/settings", { method: "PUT", body }); toast("Settings saved"); await reboot(); shell("settings"); pageSettings(); } catch (e) { fail(e); }
  };
  $("#s-mpw-save").onclick = async () => {
    const pw = $("#s-mpw").value;
    if (!pw) return toast("Type a password first", true);
    const body = { club_name: s.club_name, academic_year: s.academic_year, current_term: s.current_term, subs_cutoff: s.subs_cutoff, novice_free_outings: s.novice_free_outings,
      novice_land_free: s.novice_land_free, season_start: s.season_start, today_override: s.today_override, member_password: pw, ...phoneFields() };
    try { await api("/api/committee/settings", { method: "PUT", body }); toast("Rower password updated"); pageSettings(); } catch (e) { fail(e); }
  };
  const r = $("#s-mpw-reset"); if (r) r.onclick = async () => { await api("/api/committee/settings/reset-member-password", { method: "POST" }).catch(fail); toast("Using server password"); pageSettings(); };
}

// ---------------------------------------------------------------- sign-up --
const SLOT_ICON = { water: () => I.water, erg: () => I.land, tank: () => I.land };
const slotChip = (k) => `<span class="chip ${k === "water" ? "water" : k === "erg" ? "land" : "ok"}">${({ water: "Water", erg: "Erg", tank: "Tank" })[k] || k}</span>`;

async function pageSignup() {
  if (isCommittee() && !(location.hash.includes("form=1"))) return pageSignupCommittee();
  let meta;
  try { meta = await api("/api/signup"); } catch (e) { return fail(e); }
  const main = $("#main");
  if (!meta.weeks.length) {
    main.innerHTML = `<div class="page-head"><div><h1>Weekly sign-up</h1><p>Tell the coaches when you're free so they can build the crews.</p></div></div>
      <div class="card empty">${I.calendar}<h3>Sign-ups are closed</h3><p>There's no sign-up open right now. Check back when the next week's form opens.</p></div>`;
    return;
  }
  if (!S.suFormWeek || !meta.weeks.some((w) => w.week_start === S.suFormWeek)) S.suFormWeek = meta.weeks[0].week_start;
  const wk = meta.weeks.find((w) => w.week_start === S.suFormWeek);
  const st = { member_id: S.me && meName() ? S.me : null, new_name: "", phone: "", has_phone: false, college: "", college_other: "",
    role: "rower", want_row: 2, want_cox: 1, side: "", squad: "", max_land: 1, can_bankride: true, slot_ids: new Set(), comments: "", existing: false };

  const prefill = async () => {
    if (!st.member_id) return;
    try {
      const p = await api(`/api/signup/${wk.week_start}/member/${st.member_id}`);
      st.has_phone = p.has_phone; st.existing = p.existing;
      if (p.college) { if (meta.colleges.includes(p.college)) st.college = p.college; else { st.college = "Other"; st.college_other = p.college; } }
      st.side = p.side || st.side; st.squad = p.squad || st.squad; st.role = p.role || st.role;
      if (p.want_row != null) st.want_row = p.want_row || st.want_row;
      if (p.want_cox != null) st.want_cox = p.want_cox || st.want_cox;
      if (p.max_land != null) st.max_land = p.max_land;
      st.can_bankride = p.can_bankride; st.comments = p.comments;
      st.slot_ids = new Set(p.slot_ids);
    } catch (e) { fail(e); }
  };
  await prefill();

  const byDay = {};
  wk.slots.forEach((sl) => (byDay[sl.date] = byDay[sl.date] || []).push(sl));
  const pills = (name, opts, cur) => `<div class="pills" data-name="${name}">${opts.map(([v, l]) => `<button type="button" class="pill ${cur === v ? "on" : ""}" data-v="${esc(v)}">${esc(l)}</button>`).join("")}</div>`;
  const stepper = (id, v, label, hint = "") => `<label class="field"><span>${label}</span><div class="stepper" data-id="${id}"><button type="button" data-d="-1" aria-label="Fewer">−</button><input class="input tnum" id="${id}" type="number" min="0" max="21" value="${v}"><button type="button" data-d="1" aria-label="More">+</button></div>${hint ? `<span class="hint">${hint}</span>` : ""}</label>`;

  const draw = () => {
    const rows = ["rower", "both"].includes(st.role), coxes = ["cox", "both"].includes(st.role);
    main.innerHTML = `
    <div class="page-head"><div><h1>Weekly sign-up</h1><p>Week of ${fmtLong(wk.week_start)} · tell the coaches when you're free and they'll build the crews.</p></div>
      ${meta.weeks.length > 1 ? `<div class="seg" id="su-weeks">${meta.weeks.map((w) => `<button data-w="${w.week_start}" class="${w.week_start === wk.week_start ? "on" : ""}">w/c ${fmtShort(w.week_start)}</button>`).join("")}</div>` : ""}</div>
    ${wk.note ? `<div class="callout" style="margin-bottom:16px">${I.info}<div>${esc(wk.note)}</div></div>` : ""}
    ${isCommittee() ? `<div class="callout warn" style="margin-bottom:16px">${I.info}<div>You're filling in the form as a committee member (e.g. on someone's behalf). <a href="#/signup">Back to sign-up management</a></div></div>` : ""}
    <form id="su-form" class="su-form" novalidate>
      <section class="card card-pad su-sec"><div class="su-num">1</div><div class="su-body">
        <h3>About you</h3>
        <label class="field"><span>Your name</span><div id="su-name"></div><span class="hint">Pick your name, or type it in full if you're new to the club.</span></label>
        <div class="grid-2">
          ${meta.phone_mode === "off" ? "" : `<label class="field"><span>Phone number${meta.phone_mode === "optional" ? ` <span class="faint">(optional)</span>` : ""}</span><input class="input" id="su-phone" type="tel" autocomplete="tel" placeholder="${st.has_phone ? "We have your number. Leave blank to keep it" : "e.g. 07700 900123"}" value="${esc(st.phone)}">
            <span class="hint">🔒 Only the committee can see it. Stored encrypted${meta.phone_retention_days ? ` and deleted after ${meta.phone_retention_days >= 60 ? Math.round(meta.phone_retention_days / 30) + " months" : meta.phone_retention_days + " days"} without a sign-up` : ""}.</span></label>`}
          <div class="field"><span>College</span>${pills("college", meta.colleges.map((c) => [c, c]), st.college)}
            <input class="input ${st.college === "Other" ? "" : "hidden"}" id="su-college-other" placeholder="Which college?" value="${esc(st.college_other)}" style="margin-top:6px"></div>
        </div>
      </div></section>

      <section class="card card-pad su-sec"><div class="su-num">2</div><div class="su-body">
        <h3>This week</h3>
        <div class="field"><span>I'm signing up as</span>
          <div class="role-cards">${Object.entries(meta.roles).map(([k, l]) => `<button type="button" class="role-card ${st.role === k ? "on" : ""}" data-role="${k}"><b>${esc(l)}</b><span>${({ rower: "Row in a crew", cox: "Steer and call the crew", both: "Happy to row or cox", bankrider: "Coach from the bank or a launch" })[k]}</span></button>`).join("")}</div></div>
        ${st.role ? `
        <div class="grid-3">
          ${rows ? stepper("su-wr", st.want_row, "Max water outings", "Rowing outings on the river") : ""}
          ${coxes ? stepper("su-wc", st.want_cox, "Coxing outings wanted") : ""}
          ${st.role !== "bankrider" ? stepper("su-max", st.max_land, "Max land outings", "Erg and tank sessions") : ""}
        </div>
        ${rows ? `<div class="field"><span>Squad</span>${pills("squad", Object.entries(meta.squads), st.squad)}<span class="hint">Which crews you row in, so the captains know how many people there are for each.</span></div>
        <div class="field"><span>Side preference</span>${pills("side", meta.sides.map((x) => [x, x]), st.side)}</div>` : ""}
        <div class="field"><span>Can you bankride this week?</span>${pills("bankride", [["yes", "Yes"], ["no", "No"]], st.role === "bankrider" || st.can_bankride ? "yes" : "no")}</div>` : ""}
      </div></section>

      <section class="card card-pad su-sec"><div class="su-num">3</div><div class="su-body">
        <h3>When are you free?</h3>
        <p class="muted small" style="margin:-4px 0 4px">Tick every session you could make. You won't be put in all of them.</p>
        ${wk.slots.length ? Object.entries(byDay).map(([d, list]) => `<div class="su-day"><div class="su-day-h"><b>${DAYL[dow(d)]}</b> <span class="faint">${fmtShort(d)}</span></div>
          <div class="slot-grid">${list.map((sl) => `<button type="button" class="slot ${sl.kind} ${st.slot_ids.has(sl.id) ? "on" : ""}" data-slot="${sl.id}">
            <span class="slot-check">${I.check}</span><span class="slot-time tnum">${esc(tRange(sl) || "Time TBC")}</span>${slotChip(sl.kind)}
            ${sl.location || sl.note ? `<span class="slot-meta">${esc([sl.location, sl.note].filter(Boolean).join(" · "))}</span>` : ""}</button>`).join("")}</div></div>`).join("")
          : `<div class="faint">No sessions have been listed for this week yet.</div>`}
        <label class="field" style="margin-top:6px"><span>Anything else? (optional)</span><textarea class="input" id="su-comments" rows="2" maxlength="500" placeholder="e.g. Need to leave by 8:15 on Tuesday">${esc(st.comments)}</textarea></label>
      </div></section>

      <div class="su-submit"><span class="faint small" id="su-count"></span><button class="btn primary" type="submit" id="su-go">${I.send}${st.existing ? "Update my sign-up" : "Submit sign-up"}</button></div>
    </form>`;

    // name picker: existing members + "I'm new"
    nameField($("#su-name"), st, async () => { st.existing = false; st.has_phone = false; st.slot_ids = new Set(); await prefill(); draw(); });
    $$(".pills").forEach((g) => $$(".pill", g).forEach((b) => b.onclick = () => {
      $$(".pill", g).forEach((x) => x.classList.toggle("on", x === b));
      const v = b.dataset.v;
      if (g.dataset.name === "college") { st.college = v; $("#su-college-other").classList.toggle("hidden", v !== "Other"); if (v === "Other") $("#su-college-other").focus(); }
      if (g.dataset.name === "side") st.side = v;
      if (g.dataset.name === "squad") st.squad = v;
      if (g.dataset.name === "bankride") st.can_bankride = v === "yes";
    }));
    $$(".role-card").forEach((b) => b.onclick = () => { capture(); st.role = b.dataset.role; draw(); });
    $$(".stepper").forEach((sp) => $$("button", sp).forEach((b) => b.onclick = () => { const i = $("input", sp); i.value = Math.max(0, Math.min(21, (+i.value || 0) + +b.dataset.d)); }));
    $$(".slot").forEach((b) => b.onclick = () => { const id = +b.dataset.slot; st.slot_ids.has(id) ? st.slot_ids.delete(id) : st.slot_ids.add(id); b.classList.toggle("on"); count(); });
    const w = $("#su-weeks"); if (w) $$("button", w).forEach((b) => b.onclick = () => { S.suFormWeek = b.dataset.w; pageSignup(); });
    count();
    $("#su-form").onsubmit = submit;
  };
  const count = () => { const n = st.slot_ids.size; $("#su-count").textContent = n ? `${n} session${n === 1 ? "" : "s"} ticked` : ""; };
  const capture = () => {
    const v = (id) => { const e = $(id); return e ? e.value : null; };
    if (v("#su-phone") != null) st.phone = v("#su-phone");
    if (v("#su-college-other") != null) st.college_other = v("#su-college-other");
    if (v("#su-wr") != null) st.want_row = +v("#su-wr") || 0;
    if (v("#su-wc") != null) st.want_cox = +v("#su-wc") || 0;
    if (v("#su-max") != null) st.max_land = +v("#su-max") || 0;
    if (v("#su-comments") != null) st.comments = v("#su-comments");
  };
  const submit = async (e) => {
    e.preventDefault(); capture();
    if (!st.member_id && !st.new_name.trim()) return toast("Pick or type your name first", true);
    if (!st.college) return toast("Pick your college", true);
    if (st.college === "Other" && !st.college_other.trim()) return toast("Type the name of your college", true);
    if (!st.role) return toast("Choose what you're signing up as", true);
    if (["rower", "both"].includes(st.role) && !st.squad) return toast("Choose your squad (Open or Women's)", true);
    const body = { week_start: wk.week_start, member_id: st.member_id, new_name: st.member_id ? "" : st.new_name, phone: st.phone,
      college: st.college === "Other" ? st.college_other.trim() : st.college, role: st.role, want_row: st.want_row, want_cox: st.want_cox,
      side: st.side, squad: ["rower", "both"].includes(st.role) ? st.squad : "", max_land: st.role === "bankrider" ? 0 : st.max_land, can_bankride: st.role === "bankrider" || st.can_bankride,
      slot_ids: [...st.slot_ids], comments: st.comments };
    const btn = $("#su-go"); btn.disabled = true;
    try {
      const r = await api("/api/signup", { method: "POST", body });
      if (!isCommittee()) setMe(r.member_id);
      if (r.created) await reboot();
      const slots = wk.slots.filter((x) => st.slot_ids.has(x.id));
      main.innerHTML = `<div class="card su-done"><div class="su-done-icon">${I.check}</div>
        <h2>${r.updated ? "Sign-up updated" : "You're signed up"}${isCommittee() ? "" : `, ${esc(r.member_name.split(" ")[0])}`}!</h2>
        <p class="muted">${isCommittee() ? `Saved for ${esc(r.member_name)}.` : "The crews will appear on the schedule once they're published."}${r.created ? " Your name has been added to the club list." : ""}</p>
        ${slots.length ? `<div class="su-done-list">${slots.map((x) => `<div><b>${DAY[dow(x.date)]} ${fmtShort(x.date)}</b> <span class="tnum">${esc(tRange(x))}</span> ${slotChip(x.kind)}</div>`).join("")}</div>` : ""}
        <div class="toolbar" style="justify-content:center"><button class="btn" id="su-edit">Edit my answers</button><a class="btn primary" href="#/schedule">Go to schedule</a></div></div>`;
      $("#su-edit").onclick = () => { st.member_id = r.member_id; st.new_name = ""; pageSignup(); };
      window.scrollTo(0, 0);
    } catch (err) { fail(err); btn.disabled = false; }
  };
  draw();
}

/* Name field: pick an existing member, or type a new full name. */
function nameField(container, st, onPick, opts = {}) {
  const o = { placeholder: "Start typing your name…", newLabel: "I'm new:", newChip: "Add me", empty: "Keep typing your full name…", ...opts };
  container.classList.add("combo");
  container.innerHTML = `<input class="input" autocomplete="off" placeholder="${esc(o.placeholder)}"><button type="button" class="clear" tabindex="-1" aria-label="Clear">×</button>`;
  const inp = $("input", container), clr = $(".clear", container);
  let list = null, hl = 0, shown = [];
  const members = () => o.members || S.boot.members;
  const cur = () => st.member_id ? members().find((m) => m.id === st.member_id)?.name || "" : st.new_name;
  const sync = () => { inp.value = cur(); clr.style.display = inp.value ? "" : "none"; };
  const close = () => { list?.remove(); list = null; };
  const draw = () => {
    const q = fold(inp.value.trim());
    const matches = members().filter((m) => !q || fold(m.name).includes(q)).slice(0, 8);
    const exact = members().some((m) => fold(m.name) === q);
    shown = matches.map((m) => ({ id: m.id, label: m.name, inactive: m.active === false }));
    if (q.length >= 3 && !exact) shown.push({ id: null, label: inp.value.trim().replace(/\s+/g, " "), isNew: true });
    hl = Math.min(hl, Math.max(0, shown.length - 1));
    if (!list) { list = document.createElement("div"); list.className = "combo-list"; container.appendChild(list); }
    list.innerHTML = shown.length ? shown.map((i, k) => `<div class="combo-item ${k === hl ? "hl" : ""}" data-k="${k}">${i.isNew ? `<span class="nm"><b>${esc(o.newLabel)}</b> “${esc(i.label)}”</span><span class="why"><span class="chip accent">${I.plus}${esc(o.newChip)}</span></span>` : `<span class="nm">${esc(i.label)}</span>${i.inactive ? `<span class="why"><span class="chip">inactive</span></span>` : ""}`}</div>`).join("")
      : `<div class="combo-empty">${esc(o.empty)}</div>`;
    $$(".combo-item", list).forEach((el) => el.addEventListener("mousedown", (e) => { e.preventDefault(); pick(shown[+el.dataset.k]); }));
  };
  const pick = (it) => {
    close(); inp.blur();
    if (!it) { st.member_id = null; st.new_name = ""; sync(); return; }
    if (it.isNew) { st.member_id = null; st.new_name = it.label; sync(); return; }
    st.member_id = it.id; st.new_name = ""; sync(); onPick && onPick();
  };
  inp.addEventListener("focus", () => { inp.select(); hl = 0; draw(); });
  inp.addEventListener("input", () => { hl = 0; draw(); });
  inp.addEventListener("blur", () => setTimeout(() => {
    close();
    const v = inp.value.trim();
    if (v && v !== cur()) { const m = members().find((x) => fold(x.name) === fold(v)); if (m) return pick({ id: m.id }); st.member_id = null; st.new_name = v; }
    if (!v) { st.member_id = null; st.new_name = ""; }
    sync();
  }, 120));
  inp.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { hl = Math.min(hl + 1, shown.length - 1); draw(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { hl = Math.max(hl - 1, 0); draw(); e.preventDefault(); }
    else if (e.key === "Enter") { e.preventDefault(); if (list && shown[hl]) pick(shown[hl]); }
    else if (e.key === "Escape") { close(); inp.blur(); }
  });
  clr.addEventListener("click", () => pick(null));
  sync();
}

// ---- committee: manage sessions & responses ----
/* "4 Open · 3 Women's" rowers for a session (plus anyone without a squad yet) */
const squadCounts = (sl) => `<span title="Open-squad rowers"><b>${sl.rowers_open}</b> Open</span><span title="Women's-squad rowers"><b>${sl.rowers_women}</b> Women's</span>${sl.rowers_unknown ? `<span title="Rowers who signed up before the squad question and have no squad on their profile">${sl.rowers_unknown} squad not set</span>` : ""}`;

async function pageSignupCommittee() {
  if (!S.suWeek) S.suWeek = addDays(S.boot.this_week, 7);
  if (!S.suTab) S.suTab = "responses";
  let d;
  try { d = await api(`/api/committee/signup/${S.suWeek}`); } catch (e) { return fail(e); }
  const ws = d.week.week_start, main = $("#main");
  const R = d.responses;
  const nRow = R.filter((r) => ["rower", "both"].includes(r.role)).length, nCox = R.filter((r) => ["cox", "both"].includes(r.role)).length;
  const nBank = R.filter((r) => r.can_bankride).length, nNew = R.filter((r) => r.needs_review).length;
  const roleShort = { rower: "Rower", cox: "Cox", both: "Row + cox", bankrider: "Bankrider" };
  // "scheduled / max" for one kind of outing; red when they've been given more than they asked for
  const schedCell = (n, max, applies) => applies ? `<span class="${n > (max || 0) ? "chip bad" : ""}">${n} / ${max || 0}</span>` : (n ? `${n}` : "");
  main.innerHTML = `
    <div class="page-head"><div><h1>Sign-ups</h1><p>Week of ${fmtLong(ws)} – ${fmtShort(addDays(ws, 6))} ·
        ${d.week.open ? `<span class="status-pill" style="background:var(--ok-soft);color:var(--ok)"><span class="dot"></span>Open to rowers</span>` : `<span class="status-pill" style="background:var(--surface-3);color:var(--text-2)"><span class="dot"></span>Closed</span>`}</p></div>
      <div class="toolbar">
        <div class="weekbar"><button class="btn icon" id="sw-prev">${I.left}</button><button class="btn icon" id="sw-next">${I.right}</button></div>
        <a class="btn" href="#/signup?form=1">${I.eye}Open form</a>
        <button class="btn" id="sw-copy-week" title="Copy last week's outings and land sessions into this week's schedule">${I.copy}Copy last week's schedule</button>
        <button class="btn" id="sw-auto" title="Suggest crews for this week's empty seats from these sign-ups">${I.wand}Auto-fill crews</button>
        ${d.week.open ? `<button class="btn" id="sw-toggle">Close sign-ups</button>` : `<button class="btn primary" id="sw-toggle">${I.send}Open sign-ups</button>`}
      </div></div>
    ${!d.week.open && !d.slots.length ? `<div class="callout warn" style="margin-bottom:16px">${I.info}<div><b>Next step:</b> add this week's water, erg and tank sessions so rowers can tick when they're free, then open sign-ups. <a href="#" id="sw-go-sessions">Add sessions</a> or <a href="#" id="sw-copy-top">copy last week's</a>.</div></div>` : ""}
    <div class="stats" style="margin-bottom:16px">
      <div class="card stat"><div class="k">Responses</div><div class="v">${R.length}</div><div class="s">${nNew ? `${nNew} new name${nNew === 1 ? "" : "s"} to review` : "for this week"}</div></div>
      <div class="card stat"><div class="k">Rowers</div><div class="v">${nRow}</div><div class="s">${(() => { const rw = R.filter((r) => ["rower", "both"].includes(r.role)), o = rw.filter((r) => r.squad === "open").length, w = rw.filter((r) => r.squad === "women").length; return `${o} Open · ${w} Women's${rw.length - o - w ? ` · ${rw.length - o - w} not set` : ""} · `; })()}${R.reduce((a, r) => a + (r.want_row || 0), 0)} water outings max</div></div>
      <div class="card stat"><div class="k">Coxes</div><div class="v">${nCox}</div><div class="s">${R.reduce((a, r) => a + (r.want_cox || 0), 0)} outings wanted</div></div>
      <div class="card stat"><div class="k">Bankriders</div><div class="v">${nBank}</div><div class="s">can bankride this week</div></div>
    </div>
    <div class="filters">
      <div class="seg" id="sw-tabs">${[["responses", `Responses (${R.length})`], ["grid", "Availability grid"], ["sessions", `Sessions (${d.slots.length})`]].map(([k, l]) => `<button data-t="${k}" class="${S.suTab === k ? "on" : ""}">${l}</button>`).join("")}</div>
      <div class="toolbar" style="margin-left:auto">${S.suTab === "sessions" ? `<button class="btn" id="sw-copy">${I.copy}Copy last week's sessions</button><button class="btn primary" id="sw-add">${I.plus}Add session</button>` : `<button class="btn" id="sw-export">${I.download}Export CSV</button>`}</div>
    </div>
    <div id="sw-body"></div>`;

  const body = $("#sw-body");
  const slotLabel = (sl) => `${DAY[dow(sl.date)]} ${esc(tRange(sl) || "TBC")}`;
  if (S.suTab === "sessions") {
    const byDay = {}; d.slots.forEach((sl) => (byDay[sl.date] = byDay[sl.date] || []).push(sl));
    body.innerHTML = `
      <div class="card card-pad" style="margin-bottom:14px"><label class="field"><span>Message shown at the top of the form (optional)</span>
        <div style="display:flex;gap:8px"><input class="input" id="sw-note" value="${esc(d.week.note)}" placeholder="e.g. Please sign up by Friday 6pm. Ergs are in the college gym."><button class="btn" id="sw-note-save">Save</button></div></label></div>
      ${d.slots.length ? Object.entries(byDay).map(([day, list]) => `<div class="section-title" style="margin-top:14px">${DAYL[dow(day)]} · ${fmtShort(day)}</div>
        <div class="slot-committee">${list.map((sl) => `<div class="card slot-row" data-id="${sl.id}">
          <div class="slot-time tnum">${esc(tRange(sl) || "TBC")}</div>${slotChip(sl.kind)}
          <div class="slot-meta" style="flex:1">${esc([sl.location, sl.note].filter(Boolean).join(" · "))}</div>
          <div class="slot-counts"><span title="Free in total"><b>${sl.count}</b> free</span>${squadCounts(sl)}<span title="Coxes (either squad)">${sl.coxes} cox</span><span title="Can bankride">${sl.bankriders} BR</span></div>
          <button class="btn sm" data-mk="${sl.id}">${I.plus}Create session</button>
          <button class="btn sm ghost" data-ed="${sl.id}">Edit</button></div>`).join("")}</div>`).join("")
        : `<div class="card empty">${I.calendar}<h3>No sessions listed</h3><p>Add the water, erg and tank sessions people can sign up for, or copy last week's.</p></div>`}`;
    $("#sw-note-save").onclick = async () => { await api(`/api/committee/signup/${ws}`, { method: "PUT", body: { open: d.week.open, note: $("#sw-note").value } }).catch(fail); toast("Message saved"); };
    $$("[data-ed]").forEach((b) => b.onclick = () => editSlot(d.slots.find((x) => x.id === +b.dataset.ed), ws));
    $$("[data-mk]").forEach((b) => b.onclick = () => {
      const sl = d.slots.find((x) => x.id === +b.dataset.mk);
      S.week = ws; S.pendingNew = { kind: sl.kind === "water" ? "water" : "land", date: sl.date, time: sl.time, end_time: sl.end_time, location: sl.location, title: sl.kind === "water" ? "" : (sl.kind === "erg" ? "Erg" : "Tank") };
      location.hash = "#/schedule";
    });
    $("#sw-add").onclick = () => editSlot(null, ws);
    $("#sw-copy").onclick = async () => {
      try { const r = await api(`/api/committee/signup/${ws}/copy-slots`, { method: "POST", body: { source: addDays(ws, -7) } }); toast(`Copied ${r.copied} session${r.copied === 1 ? "" : "s"}`); pageSignupCommittee(); } catch (e) { fail(e); }
    };
  } else if (S.suTab === "grid") {
    body.innerHTML = !R.length || !d.slots.length ? `<div class="card empty">${I.user}<h3>Nothing to show yet</h3><p>Responses will appear here as people sign up.</p></div>` :
      `<div class="card table-wrap"><table class="t grid-t"><thead><tr><th>Name</th>${d.slots.map((sl) => `<th class="gc" title="${esc([sl.location, sl.note].filter(Boolean).join(" · "))}"><div>${slotLabel(sl)}</div><div>${slotChip(sl.kind)}</div></th>`).join("")}</tr></thead>
      <tbody>${R.slice().sort((a, b) => a.name.localeCompare(b.name)).map((r) => `<tr><td><b>${esc(r.name)}</b> <span class="faint small">${roleShort[r.role]}${r.squad ? ` · ${esc(SQUAD_SHORT[r.squad])}` : ""}</span></td>${d.slots.map((sl) => `<td class="gc">${r.slot_ids.includes(sl.id) ? `<span class="tick ${sl.kind}">${I.check}</span>` : ""}</td>`).join("")}</tr>`).join("")}
      <tr class="tot"><td>Open rowers</td>${d.slots.map((sl) => `<td class="gc">${sl.rowers_open || "·"}</td>`).join("")}</tr>
      <tr class="tot"><td>Women's rowers</td>${d.slots.map((sl) => `<td class="gc">${sl.rowers_women || "·"}</td>`).join("")}</tr>
      ${d.slots.some((sl) => sl.rowers_unknown) ? `<tr class="tot"><td title="Signed up before the squad question, with no squad on their profile">Rowers, squad not set</td>${d.slots.map((sl) => `<td class="gc">${sl.rowers_unknown || "·"}</td>`).join("")}</tr>` : ""}
      <tr class="tot"><td>Coxes</td>${d.slots.map((sl) => `<td class="gc">${sl.coxes || "·"}</td>`).join("")}</tr>
      <tr class="tot"><td>Total free</td>${d.slots.map((sl) => `<td class="gc"><b>${sl.count}</b></td>`).join("")}</tr></tbody></table></div>`;
  } else {
    body.innerHTML = R.length ? `<div class="card table-wrap"><table class="t"><thead><tr><th>Name</th><th>Phone</th><th>College</th><th>As</th><th class="num" title="Water outings scheduled / max">Water</th><th class="num" title="Coxing outings scheduled / wanted">Cox</th><th class="num" title="Land sessions scheduled / max">Land</th><th>Squad</th><th>Side</th><th>Bankride</th><th class="num">Free for</th></tr></thead>
      <tbody>${R.map((r) => `<tr class="clickable" data-id="${r.id}">
        <td><b>${esc(r.name)}</b>${r.needs_review ? ` <span class="chip warn" title="Added through the form — check their details in Rowers">New</span>` : ""}${r.comments ? ` <span title="${esc(r.comments)}">💬</span>` : ""}</td>
        <td>${phoneCell(r.member_id, r.phone_masked, r.has_phone)}</td>
        <td>${esc(r.college)}</td><td><span class="chip ${r.role === "bankrider" ? "violet" : r.role === "rower" ? "" : "accent"}">${roleShort[r.role]}</span></td>
        <td class="num">${schedCell(r.scheduled.row, r.want_row, ["rower", "both"].includes(r.role))}</td><td class="num">${schedCell(r.scheduled.cox, r.want_cox, ["cox", "both"].includes(r.role))}</td><td class="num">${schedCell(r.scheduled.land, r.max_land, r.role !== "bankrider")}</td><td>${r.squad ? `<span class="chip ${r.squad === "women" ? "violet" : "accent"}">${esc(SQUAD_SHORT[r.squad])}</span>` : ""}</td><td>${r.side ? `<span class="chip">${esc(SIDE_SHORT[r.side] || r.side)}</span>` : ""}</td>
        <td>${r.can_bankride ? `<span class="chip ok">${I.check}Yes</span>` : `<span class="faint">No</span>`}</td>
        <td class="num">${r.slot_ids.length}</td></tr>`).join("")}</tbody></table></div>`
      : `<div class="card empty">${I.user}<h3>No responses yet</h3><p>${d.week.open ? "The form is open — share the site link with the squad." : "Add sessions, then open sign-ups so rowers can respond."}</p></div>`;
    $$("tr[data-id]", body).forEach((tr) => tr.onclick = () => responseDetail(R.find((x) => x.id === +tr.dataset.id), d, roleShort));
    wireReveal(body);
  }
  $$("#sw-tabs button").forEach((b) => b.onclick = () => { S.suTab = b.dataset.t; pageSignupCommittee(); });
  const swx = $("#sw-export"); if (swx) swx.onclick = () => exportModal(`/api/committee/signup/${ws}/responses.csv`, `sign-ups for the week of ${fmtShort(ws)}`);
  $("#sw-copy-week").onclick = () => copyWeek(ws);
  $("#sw-auto").onclick = () => autofillWeek(ws);
  $("#sw-prev").onclick = () => { S.suWeek = addDays(ws, -7); pageSignupCommittee(); };
  $("#sw-next").onclick = () => { S.suWeek = addDays(ws, 7); pageSignupCommittee(); };
  const goSessions = $("#sw-go-sessions");
  if (goSessions) goSessions.onclick = (e) => { e.preventDefault(); S.suTab = "sessions"; pageSignupCommittee().then(() => $("#sw-add")?.click()); };
  const copyTop = $("#sw-copy-top");
  if (copyTop) copyTop.onclick = async (e) => {
    e.preventDefault();
    try { const r = await api(`/api/committee/signup/${ws}/copy-slots`, { method: "POST", body: { source: addDays(ws, -7) } });
      toast(r.copied ? `Copied ${r.copied} session${r.copied === 1 ? "" : "s"}` : "Last week had no sessions to copy", !r.copied); S.suTab = "sessions"; pageSignupCommittee(); } catch (err) { fail(err); }
  };
  $("#sw-toggle").onclick = async () => {
    if (!d.week.open && !d.slots.length) {
      const go = await new Promise((res) => modal({
        title: "No sessions listed yet",
        body: `<p style="margin:0">There are no sessions on the form for the week of <b>${fmtLong(ws)}</b>, so rowers would have nothing to tick (only bankriders could sign up).</p><p class="muted small" style="margin:0">Check you're on the right week with the arrows, or add the sessions first.</p>`,
        foot: `<button class="btn ghost" id="ns-anyway">Open anyway</button><div class="r"><button class="btn" data-close>Cancel</button><button class="btn primary" id="ns-add">${I.plus}Add sessions</button></div>`,
        onMount: (m, close) => {
          $("#ns-add", m).onclick = () => { close(); res("add"); };
          $("#ns-anyway", m).onclick = () => { close(); res("open"); };
          $$("[data-close]", m).forEach((b) => b.addEventListener("click", () => res(null)));
        },
      }));
      if (go === "add") { S.suTab = "sessions"; await pageSignupCommittee(); $("#sw-add")?.click(); return; }
      if (go !== "open") return;
    }
    try { await api(`/api/committee/signup/${ws}`, { method: "PUT", body: { open: !d.week.open, note: d.week.note } }); toast(d.week.open ? "Sign-ups closed" : "Sign-ups are open"); pageSignupCommittee(); } catch (e) { fail(e); }
  };
}

function responseDetail(r, d, roleShort) {
  const slots = d.slots.filter((sl) => r.slot_ids.includes(sl.id));
  modal({
    title: esc(r.name),
    body: `<dl class="kv"><dt>Phone</dt><dd>${phoneCell(r.member_id, r.phone_masked, r.has_phone)}${r.has_phone ? ` <button type="button" class="btn sm ghost danger" id="rd-delphone">Delete number</button>` : ""}</dd>
      <dt>College</dt><dd>${esc(r.college)}</dd><dt>Signing up as</dt><dd>${roleShort[r.role]}</dd>
      ${["rower", "both"].includes(r.role) ? `<dt>Max water outings</dt><dd>${r.want_row} (scheduled: ${r.scheduled.row})</dd>` : ""}${["cox", "both"].includes(r.role) ? `<dt>Coxing outings</dt><dd>${r.want_cox} (scheduled: ${r.scheduled.cox})</dd>` : ""}${r.role !== "bankrider" ? `<dt>Max land outings</dt><dd>${r.max_land} (scheduled: ${r.scheduled.land})</dd>` : ""}
      ${r.squad ? `<dt>Squad</dt><dd>${esc(d.squads[r.squad])}</dd>` : ""}${r.side ? `<dt>Side</dt><dd>${esc(r.side)}</dd>` : ""}
      <dt>Can bankride</dt><dd>${r.can_bankride ? "Yes" : "No"}</dd><dt>Submitted</dt><dd>${esc(r.updated_at)} UTC</dd></dl>
      ${r.comments ? `<div class="callout">${I.info}<div>${esc(r.comments)}</div></div>` : ""}
      <div class="section-title" style="margin:6px 0 0">Free for (${slots.length})</div>
      <div class="su-done-list" style="text-align:left">${slots.map((x) => `<div><b>${DAY[dow(x.date)]} ${fmtShort(x.date)}</b> <span class="tnum">${esc(tRange(x))}</span> ${slotChip(x.kind)} <span class="faint small">${esc(x.location)}</span></div>`).join("") || `<span class="faint">No sessions ticked.</span>`}</div>
      ${r.needs_review ? `<div class="callout warn">${I.alert}<div>${esc(r.name)} was added through the form. Check their category, swim test and subs on the <a href="#/rowers">Rowers</a> page.</div></div>` : ""}`,
    foot: `<button class="btn danger" id="rd-del">Delete response</button><div class="r"><button class="btn" data-close>Close</button></div>`,
    onMount: (m, close) => {
      wireReveal(m);
      const dp = $("#rd-delphone", m);
      if (dp) dp.onclick = async () => {
        if (!await confirmBox(`Delete ${esc(r.name)}'s phone number?`, "It's removed from the club's records. They'll be asked for it again next time they sign up.", "Delete number", true)) return;
        try { await api(`/api/committee/members/${r.member_id}/phone`, { method: "DELETE" }); toast("Phone number deleted"); pageSignupCommittee(); } catch (e) { fail(e); }
      };
      $("#rd-del", m).onclick = async () => {
        if (!await confirmBox("Delete this response?", `${esc(r.name)}'s sign-up for this week will be removed. Their member record stays.`, "Delete", true)) return;
        try { await api(`/api/committee/signup/responses/${r.id}`, { method: "DELETE" }); toast("Response deleted"); pageSignupCommittee(); } catch (e) { fail(e); }
      };
    },
  });
}

async function editSlot(sl, ws, tpl) {
  await loadPlaces(true);
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  const v = sl || tpl || { date: days[0], time: "", kind: "water", location: "", note: "" };
  // new sessions can go on several days at once; editing keeps a single day
  const picked = new Set(sl ? [v.date] : (v.dates || [v.date]).filter((d) => days.includes(d)));
  modal({
    title: sl ? "Edit session" : "Add session",
    body: `<div class="seg" id="sl-kind">${[["water", "Water"], ["erg", "Erg"], ["tank", "Tank"]].map(([k, l]) => `<button data-k="${k}" class="${v.kind === k ? "on" : ""}">${l}</button>`).join("")}</div>
      <div class="grid-2">${sl ? `<label class="field"><span>Day</span><select class="input" id="sl-date">${days.map((d) => `<option value="${d}" ${d === v.date ? "selected" : ""}>${fmtLong(d)}</option>`).join("")}</select></label>`
          : `<div class="field"><span>Days <span class="faint">(tick several to add the same session on each)</span></span><div class="seg seg-days" id="sl-days">${days.map((d) => `<button type="button" data-d="${d}" class="${picked.has(d) ? "on" : ""}" title="${esc(fmtLong(d))}">${DAY[dow(d)]}</button>`).join("")}</div></div>`}
        <div class="field"><span>Time <span class="faint">(start – end)</span></span><div class="time-range"><input class="input tnum" type="time" id="sl-time" value="${esc(v.time)}" aria-label="Start time"><span class="faint">–</span><input class="input tnum" type="time" id="sl-end" value="${esc(v.end_time || "")}" aria-label="End time (optional)"></div><span class="hint">Use the same time when you create the outing, so availability matches.</span></div></div>
      <div class="grid-2"><label class="field"><span>Where (optional)</span><input class="input" id="sl-loc" list="sl-places" value="${esc(v.location)}" placeholder="e.g. Boathouse, College gym">${placesDatalist("sl-places")}</label>
        <label class="field"><span>Note (optional)</span><input class="input" id="sl-note" value="${esc(v.note)}" placeholder="e.g. Novices only"></label></div>
      ${sl ? "" : `<label class="check small"><input type="checkbox" id="sl-more" ${tpl ? "checked" : ""}> Add another after this one <span class="faint">(keeps these details)</span></label>`}`,
    foot: `${sl ? `<button class="btn danger" id="sl-del">Delete</button>` : ""}<div class="r"><button class="btn" data-close>Cancel</button><button class="btn primary" id="sl-save">Save</button></div>`,
    onMount: (m, close) => {
      let kind = v.kind;
      $$("#sl-kind button", m).forEach((b) => b.onclick = () => { kind = b.dataset.k; $$("#sl-kind button", m).forEach((x) => x.classList.toggle("on", x === b)); });
      $$("#sl-days button", m).forEach((b) => b.onclick = () => {
        const d = b.dataset.d; picked.has(d) ? picked.delete(d) : picked.add(d); b.classList.toggle("on", picked.has(d));
      });
      $("#sl-save", m).onclick = async () => {
        const body = { time: $("#sl-time", m).value.trim(), end_time: $("#sl-end", m).value.trim(), kind, location: $("#sl-loc", m).value, note: $("#sl-note", m).value };
        try {
          if (sl) {
            await api(`/api/committee/signup/slots/${sl.id}`, { method: "PUT", body: { ...body, date: $("#sl-date", m).value } });
            close(); toast("Session saved"); pageSignupCommittee(); return;
          }
          const dates = days.filter((d) => picked.has(d));
          if (!dates.length) return toast("Pick at least one day", true);
          const r = await api("/api/committee/signup/slots", { method: "POST", body: { ...body, date: dates[0], dates } });
          const more = $("#sl-more", m)?.checked; close();
          toast(r.created > 1 ? `Added ${r.created} sessions` : "Session saved"); await pageSignupCommittee();
          if (more) editSlot(null, ws, { ...body, date: dates[0], dates });
        } catch (e) { fail(e); }
      };
      const del = $("#sl-del", m);
      if (del) del.onclick = async () => {
        if (!await confirmBox("Delete this session?", "Anyone who ticked it loses that availability.", "Delete", true)) return;
        try { await api(`/api/committee/signup/slots/${sl.id}`, { method: "DELETE" }); toast("Session deleted"); pageSignupCommittee(); } catch (e) { fail(e); }
      };
    },
  });
}

function editPlace(p, after) {
  modal({
    title: p ? "Edit place" : "Add place",
    body: `<label class="field"><span>Name</span><input class="input" id="pl-name" value="${esc(p?.name || "")}" placeholder="e.g. Boathouse"><span class="hint">Use exactly this name in a session's “Where” field.</span></label>
      <label class="field"><span>Address</span><input class="input" id="pl-addr" value="${esc(p?.address || "")}" placeholder="e.g. Meadow Lane, Oxford OX1 4BH"></label>
      <label class="field"><span>Coordinates (optional)</span><input class="input" id="pl-coords" value="${p?.lat != null ? `${p.lat}, ${p.lon}` : ""}" placeholder="e.g. 51.7436, -1.2521, or paste a Google Maps link">
        <span class="hint">For an exact pin. In Google Maps, long-press the spot and copy the numbers shown.</span></label>`,
    foot: `${p ? `<button class="btn danger" id="pl-del">Delete</button>` : ""}<div class="r"><button class="btn" data-close>Cancel</button><button class="btn primary" id="pl-save">Save</button></div>`,
    onMount: (m, close) => {
      $("#pl-save", m).onclick = async () => {
        const body = { name: $("#pl-name", m).value.trim(), address: $("#pl-addr", m).value.trim(), coords: $("#pl-coords", m).value.trim() };
        if (!body.name) return toast("Give the place a name", true);
        try { await api(p ? `/api/committee/places/${p.id}` : "/api/committee/places", { method: p ? "PUT" : "POST", body }); close(); toast("Place saved"); after && after(); } catch (e) { fail(e); }
      };
      const d = $("#pl-del", m);
      if (d) d.onclick = async () => { try { await api(`/api/committee/places/${p.id}`, { method: "DELETE" }); close(); toast("Place deleted"); after && after(); } catch (e) { fail(e); } };
    },
  });
}

// ------------------------------------------------------------------ races --
const RACE_ST = { yes: ["Available", "ok"], maybe: ["Maybe", "warn"], no: ["Not available", "bad"] };
const RACE_ORDER = ["yes", "maybe", "no"];
const RACE_ENTRY_CHIP = { novice: "accent", senior: "violet", all: "" };
const youify = (t) => t.replace(/they're/g, "you're").replace(/they could/g, "you could");
/* "Open · Rower or cox · Bow pref" */
function raceRespSummary(x, data) {
  if (x.status === "no") return "";
  return [x.role !== "cox" ? data.squads[x.squad] : "", x.role ? data.roles[x.role] : "", x.side ? SIDE_SHORT[x.side] || x.side : ""].filter(Boolean).join(" · ");
}

/* Answers grouped for the card and the "who" panel. */
const RACE_FILTER = { yes: ["yes"], maybe: ["maybe"], no: ["no"] };
const RACE_FILTER_LABEL = { yes: "Available", maybe: "Maybe", no: "Not available" };
const RACE_FILTER_CHIP = { yes: "ok", maybe: "warn", no: "bad" };
/* Split responses into crew columns. Someone who'd row or cox goes in their squad's column and in Coxes. */
function raceCrew(list) {
  const out = { open: [], women: [], unset: [], cox: [] };
  for (const x of list) {
    const rows = x.role !== "cox";
    const coxes = x.role === "cox" || x.role === "both";
    if (rows) out[x.squad === "open" || x.squad === "women" ? x.squad : "unset"].push(x);
    if (coxes) out.cox.push(x);
  }
  return out;
}

/* Who gave an answer, as crew columns (Open rowers / Women's rowers / Coxes). */
function raceWhoModal(r, data, filter) {
  const committee = isCommittee();
  const count = (k) => r.responses.filter((x) => RACE_FILTER[k].includes(x.status)).length;
  const person = (x, col) => {
    const side = col !== "cox" && col !== "no" && x.side ? SIDE_SHORT[x.side] || x.side : "";
    const also = x.role === "both" && col !== "no" ? (col === "cox" ? "also rows" : "also coxes") : "";
    const el = committee ? `button type="button" data-race-set="${x.member_id}"` : "div";
    return `<${el} class="race-person ${x.member_id === S.me ? "me" : ""}">
      <span class="race-person-name">${esc(x.name)}</span>
      <span class="race-person-meta"><span class="chip ${x.category === "Novice" ? "accent" : ""}" title="${esc(x.category || "Category not set")}">${esc(x.category || "?")}</span>${[side, also].filter(Boolean).map((t) => `<span>${esc(t)}</span>`).join("")}${x.problems?.length ? `<span class="chip bad" title="${esc(x.problems.join(". "))}">${I.alert}Not eligible</span>` : ""}</span>
      ${x.comment && committee ? `<span class="small muted race-comment">“${esc(x.comment)}”</span>` : ""}</${committee ? "button" : "div"}>`;
  };
  const body = () => {
    const list = r.responses.filter((x) => RACE_FILTER[filter].includes(x.status));
    if (!list.length) return `<div class="small muted race-who-empty">Nobody has said ${esc(RACE_FILTER_LABEL[filter].toLowerCase())}.</div>`;
    if (filter === "no") return `<div class="race-col">${list.map((x) => person(x, "no")).join("")}</div>`;
    const c = raceCrew(list);
    const cols = [["open", "Open rowers"], ["women", "Women's rowers"], ["unset", "Rowers, squad not set"], ["cox", "Coxes"]].filter(([k]) => k !== "unset" || c.unset.length);
    return `<div class="race-cols">${cols.map(([k, l]) => `<div class="race-col"><div class="race-col-h"><span>${esc(l)}</span><b>${c[k].length}</b></div>
      ${c[k].length ? c[k].map((x) => person(x, k)).join("") : `<div class="faint small">Nobody</div>`}</div>`).join("")}</div>`;
  };
  modal({
    title: esc(r.title), wide: true,
    body: `<div class="seg" id="rw-f">${Object.keys(RACE_FILTER).map((k) => `<button type="button" data-f="${k}">${esc(RACE_FILTER_LABEL[k])} · ${count(k)}</button>`).join("")}</div>
      <div id="rw-body"></div>${committee ? `<div class="faint small">Click someone to change their answer.</div>` : ""}`,
    foot: `${committee ? `<button class="btn" data-race-set="">${I.plus}Add someone</button>` : ""}<div class="r"><button class="btn" data-close>Close</button></div>`,
    onMount: (m) => {
      const draw = () => {
        $("#rw-body", m).innerHTML = body();
        $$("#rw-f button", m).forEach((b) => (b.className = b.dataset.f === filter ? "on " + filter : ""));
        $$("[data-race-set]", m).forEach((b) => b.onclick = () => raceResponseModal(r, data, b.dataset.raceSet ? +b.dataset.raceSet : null));
      };
      $$("#rw-f button", m).forEach((b) => b.onclick = () => { filter = b.dataset.f; draw(); });
      draw();
    },
  });
}

const fmtDT = (t) => { const [d, h] = t.split("T"), x = pd(d); return `${DAY[dow(d)]} ${x.getUTCDate()} ${MON[x.getUTCMonth()]}, ${h}`; };
function raceWindow(r) {
  const parts = [r.opens_at && `open <b>${esc(fmtDT(r.opens_at))}</b>`, r.closes_at && `close <b>${esc(fmtDT(r.closes_at))}</b>`].filter(Boolean);
  const bits = [parts.length && `Entries ${parts.join(" · ")}`, r.scratch_date && `Scratch by <b>${esc(fmtDT(r.scratch_date + "T").slice(0, -2))}</b>`].filter(Boolean);
  return bits.length ? `<div class="small muted race-window">${bits.join(" · ")}</div>` : "";
}

function raceCard(r, data) {
  const d = pd(r.date), me = S.boot.members.find((m) => m.id === S.me);
  const mine = r.responses.find((x) => x.member_id === S.me);
  const locked = r.past || !r.open;
  let respond;
  if (locked && !isCommittee()) respond = `<div class="small muted">${r.past ? "This race has happened." : "Sign-up is closed."}${mine ? ` You said <b>${esc(RACE_ST[mine.status][0].toLowerCase())}</b>.` : ""}</div>`;
  else respond = `<div class="race-respond">
      <span class="small muted">${me ? `${esc(me.name.split(" ")[0])}, can you race?` : "Can you race?"}</span>
      <div class="seg">${RACE_ORDER.map((k) => `<button data-race-st="${k}" class="${mine?.status === k ? "on " + k : ""}">${esc(RACE_ST[k][0])}</button>`).join("")}</div>
      ${mine ? `<button class="btn ghost sm" data-race-mine>Edit</button>` : ""}</div>
      ${mine && raceRespSummary(mine, data) ? `<div class="small muted">You: ${esc(raceRespSummary(mine, data))}${mine.comment ? ` · “${esc(mine.comment)}”` : ""}</div>` : ""}
      ${me && !mine && r.me_problems.length ? `<div class="small race-warn">${I.alert}${esc(youify(r.me_problems[0]))}.</div>` : ""}`;
  const avail = r.responses.filter((x) => RACE_FILTER.yes.includes(x.status));
  const crew = raceCrew(avail), flex = avail.filter((x) => x.role === "both").length;
  const n = (k) => r.responses.filter((x) => RACE_FILTER[k].includes(x.status)).length;
  const crewLine = avail.length ? `<div class="race-crew">${[["open", "Open rowers"], ["women", "Women's rowers"], ["unset", "Squad not set"], ["cox", "Coxes"]].filter(([k]) => k !== "unset" || crew.unset.length)
      .map(([k, l]) => `<button type="button" class="race-crew-n" data-race-who="yes"><b>${crew[k].length}</b><span>${esc(l)}</span></button>`).join("")}</div>
      ${flex ? `<div class="faint small">${flex === 1 ? "1 person" : flex + " people"} could row or cox, so ${flex === 1 ? "is" : "are"} counted in both.</div>` : ""}` : "";
  const who = r.responses.length
    ? `<div class="race-who">${Object.keys(RACE_FILTER).filter((k) => n(k)).map((k) => `<button type="button" class="chip ${RACE_FILTER_CHIP[k]}" data-race-who="${k}">${n(k)} ${esc(RACE_FILTER_LABEL[k].toLowerCase())}</button>`).join("")}
        <button type="button" class="btn ghost sm" data-race-who="yes">See who</button></div>`
    : `<div class="race-who"><span class="chip">No responses yet</span>${isCommittee() ? `<button class="btn ghost sm" data-race-set="">${I.plus}Add someone</button>` : ""}</div>`;
  return `<article class="card race ${r.past ? "past" : ""}" data-race="${r.id}">
    <div class="race-head"><div class="datebox"><span>${DAY[dow(r.date)]}</span><b>${d.getUTCDate()}</b><span>${MON[d.getUTCMonth()]}</span></div>
      <div style="flex:1;min-width:0"><div class="race-title">${esc(r.title)}</div>
        <div class="o-sub">${r.city ? `<span>${I.pin}${esc(r.city)}</span>` : ""}${r.time_slot ? `<span>${esc(r.time_slot)}</span>` : ""}${r.term ? `<span>${esc(r.term)}</span>` : ""}</div></div>
      ${isCommittee() ? `<button class="btn sm" data-race-edit>Edit</button>` : ""}</div>
    <div class="race-chips"><span class="chip ${RACE_ENTRY_CHIP[r.entry]}">${esc(data.entry[r.entry])}</span>${r.squad !== "any" ? `<span class="chip violet">${esc(data.squads[r.squad])} squad</span>` : ""}${r.race_type ? `<span class="chip">${esc(r.race_type)}</span>` : ""}${!r.open && !r.past ? `<span class="chip warn">Sign-up closed</span>` : ""}</div>
    ${raceWindow(r)}
    ${r.notes ? `<div class="race-notes small">${esc(r.notes)}</div>` : ""}
    ${r.links.length ? `<div class="race-links">${r.links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${I.link}${esc(l.label || l.url.replace(/^https?:\/\//, "").replace(/\/$/, ""))}</a>`).join("")}</div>` : ""}
    ${respond}
    ${crewLine}
    ${who}
  </article>`;
}

async function pageRaces() {
  let data;
  try { data = await api(`/api/races${S.me ? `?me=${S.me}` : ""}`); } catch (e) { return fail(e); }
  S.raceTab = S.raceTab || "upcoming";
  const shown = data.races.filter((r) => (S.raceTab === "past") === r.past);
  if (S.raceTab === "past") shown.reverse();
  const committee = isCommittee();
  $("#main").innerHTML = `
    <div class="page-head"><div><h1>Races</h1><p>Upcoming regattas and head races. Say whether you can race so the captains can put crews together.</p></div>
      <div class="toolbar"><div class="seg" id="rc-tab"><button data-t="upcoming" class="${S.raceTab === "upcoming" ? "on" : ""}">Upcoming</button><button data-t="past" class="${S.raceTab === "past" ? "on" : ""}">Past</button></div>
      ${committee ? `<button class="btn primary" id="rc-add">${I.plus}Add race</button>` : ""}</div></div>
    ${shown.length ? `<div class="race-list">${shown.map((r) => raceCard(r, data)).join("")}</div>`
      : `<div class="card empty">${I.flag}<h3>${S.raceTab === "past" ? "No past races" : "No races planned yet"}</h3><p>${committee && S.raceTab === "upcoming" ? "Add a race so rowers can say whether they're available." : "Races will show up here once the committee adds them."}</p></div>`}`;
  $$("#rc-tab button").forEach((b) => b.onclick = () => { S.raceTab = b.dataset.t; pageRaces(); });
  if (committee) $("#rc-add").onclick = () => editRace(null, data);
  $$(".race[data-race]").forEach((card) => {
    const r = data.races.find((x) => x.id === +card.dataset.race);
    const e = $("[data-race-edit]", card); if (e) e.onclick = () => editRace(r, data);
    $$("[data-race-st]", card).forEach((b) => b.onclick = () => requireMe(async () => {
      const status = b.dataset.raceSt, mine = r.responses.find((x) => x.member_id === S.me);
      if (status !== "no") return raceResponseModal(r, data, S.me, status);
      try {   // "Not available" needs no other details
        await api(`/api/races/${r.id}/response`, { method: "PUT", body: { member_id: S.me, status, squad: mine?.squad || "", comment: mine?.comment || "" } });
        pageRaces();
      } catch (err) { fail(err); }
    }));
    const n = $("[data-race-mine]", card); if (n) n.onclick = () => requireMe(() => raceResponseModal(r, data, S.me));
    $$("[data-race-set]", card).forEach((b) => b.onclick = () => raceResponseModal(r, data, b.dataset.raceSet ? +b.dataset.raceSet : null));
    $$("[data-race-who]", card).forEach((b) => b.onclick = () => raceWhoModal(r, data, b.dataset.raceWho));
  });
}

/* The race response form, for yourself or (committee) for someone else. Eligibility is checked live by the server. */
function raceResponseModal(r, data, memberId, presetStatus) {
  const committee = isCommittee(), self = memberId != null && memberId === S.me && !committee;
  const cur = memberId != null ? r.responses.find((x) => x.member_id === memberId) : null;
  const prof = memberId === S.me ? data.me : null;
  const st = { member_id: memberId, status: presetStatus || cur?.status || "yes", squad: cur?.squad || prof?.squad || "", role: cur?.role && cur.role !== "cox" ? cur.role : cur?.role || "rower",
    side: cur?.side || prof?.side || "", problems: [] };
  let picker = null, checkSeq = 0;
  const pills = (name, opts, v) => `<div class="pills" data-name="${name}">${opts.map(([k, l]) => `<button type="button" class="pill ${v === k ? "on" : ""}" data-v="${esc(k)}">${esc(l)}</button>`).join("")}</div>`;
  const whoName = memberId != null ? (S.boot.members.find((m) => m.id === memberId)?.name || cur?.name || "") : "";
  modal({
    title: esc(r.title), wide: true,
    body: `${committee && memberId == null ? `<label class="field"><span>Who</span><div id="rr-who"></div></label>` : `<div><b>${esc(whoName)}</b> <span class="faint small">${esc(data.entry[r.entry])}${r.squad !== "any" ? ` · ${esc(data.squads[r.squad])} squad` : ""}</span></div>`}
      <div class="field"><span>${self ? "Can you race?" : "Can they race?"}</span><div class="seg" id="rr-st">${RACE_ORDER.map((k) => `<button type="button" data-v="${k}" class="${st.status === k ? "on " + k : ""}">${esc(RACE_ST[k][0])}</button>`).join("")}</div></div>
      <div id="rr-details">
        <div class="grid-2"><div class="field" id="rr-role-f"><span>${self ? "I'd like to" : "Would"}</span>${pills("role", Object.entries(data.roles).map(([k, l]) => [k, l]), st.role)}</div>
          <div class="field" id="rr-squad-f"><span>Squad</span>${pills("squad", Object.entries(data.squads), st.squad)}</div></div>
        <div class="field" id="rr-side-f"><span>Side preference</span>${pills("side", data.sides.map((x) => [x, x]), st.side)}</div>
      </div>
      <div id="rr-elig"></div>
      <label class="field"><span>Note (optional)</span><textarea class="input" id="rr-c" rows="2" maxlength="500" placeholder="e.g. Can only do the morning division">${esc(cur?.comment || "")}</textarea><span class="hint">Only the committee sees notes.${self ? " Your squad and side are saved to your profile." : ""}</span></label>`,
    foot: `${cur ? `<button class="btn danger" id="rr-del">Remove response</button>` : ""}<div class="r"><button class="btn" data-close>Cancel</button><button class="btn primary" id="rr-save">Save</button></div>`,
    onMount: (m, close) => {
      const show = () => {
        const no = st.status === "no";
        $("#rr-details", m).classList.toggle("hidden", no);
        $("#rr-squad-f", m).classList.toggle("hidden", st.role === "cox");   // coxes cox either squad
        $("#rr-side-f", m).classList.toggle("hidden", st.role === "cox");
      };
      const drawElig = () => {
        const save = $("#rr-save", m), p = st.problems;
        $("#rr-elig", m).innerHTML = p.length ? `<div class="callout bad">${I.alert}<div><b>${self ? "You can't enter this race" : "Not eligible"}</b><br>${p.map((x) => esc(self ? youify(x) : x)).join(".<br>")}.${committee ? "<br><span class='small'>You can still save, as the committee.</span>" : ""}</div></div>` : "";
        save.textContent = p.length && committee ? "Save anyway" : "Save";
        save.classList.toggle("danger", !!(p.length && committee)); save.classList.toggle("primary", !(p.length && committee));
        save.disabled = !!(p.length && !committee);
      };
      const check = async () => {
        if (st.member_id == null) { st.problems = []; return drawElig(); }
        const seq = ++checkSeq;
        try {
          const res = await api(`/api/races/${r.id}/check`, { method: "POST", body: { member_id: st.member_id, status: st.status, squad: st.squad, role: st.role } });
          if (seq !== checkSeq) return;
          st.problems = res.problems; drawElig();
          return res.profile;
        } catch {}
      };
      // pick someone (committee): fill in their profile's squad and side
      const box = $("#rr-who", m);
      if (box) picker = combo(box, { items: () => S.boot.members.filter((x) => !r.responses.some((y) => y.member_id === x.id)).map((x) => ({ id: x.id, label: x.name, sub: x.category })), placeholder: "Search names…",
        renderWhy: (i) => `<span class="chip">${esc(i.sub)}</span>`,
        onChange: async (id) => {
          st.member_id = id;
          const prof = await check();
          if (prof) {
            if (prof.squad && !st.squad) { st.squad = prof.squad; $$('[data-name="squad"] .pill', m).forEach((x) => x.classList.toggle("on", x.dataset.v === st.squad)); }
            if (prof.side && !st.side) { st.side = prof.side; $$('[data-name="side"] .pill', m).forEach((x) => x.classList.toggle("on", x.dataset.v === st.side)); }
            check();
          }
        } });
      $$("#rr-st button", m).forEach((b) => b.onclick = () => {
        st.status = b.dataset.v; $$("#rr-st button", m).forEach((x) => (x.className = x === b ? "on " + x.dataset.v : ""));
        show(); check();
      });
      $$(".pills", m).forEach((g) => $$(".pill", g).forEach((b) => b.onclick = () => {
        $$(".pill", g).forEach((x) => x.classList.toggle("on", x === b));
        st[g.dataset.name] = b.dataset.v; show(); check();
      }));
      show(); check();
      $("#rr-save", m).onclick = async () => {
        if (st.member_id == null) return toast("Pick who to add", true);
        if (st.status !== "no" && st.role !== "cox") {
          if (!st.squad) return toast(self ? "Choose your squad" : "Choose their squad", true);
          if (!st.side) return toast("Choose a side preference", true);
        }
        const body = { member_id: st.member_id, status: st.status, squad: st.squad, role: st.role, side: st.side, comment: $("#rr-c", m).value, override: committee && st.problems.length > 0 };
        try { await api(`/api/races/${r.id}/response`, { method: "PUT", body }); close(); toast("Response saved"); pageRaces(); }
        catch (e) { if (e.status === 409 && e.detail?.problems) { st.problems = e.detail.problems; drawElig(); } else fail(e); }
      };
      const d = $("#rr-del", m);
      if (d) d.onclick = async () => { try { await api(`/api/races/${r.id}/response/${memberId}`, { method: "DELETE" }); close(); pageRaces(); } catch (e) { fail(e); } };
    },
  });
}

function editRace(r, data) {
  const v = r || { title: "", date: S.boot.today, term: S.boot.settings.current_term || "", city: "", time_slot: "", entry: "all", squad: "any", race_type: "", notes: "", open: true, opens_at: "", closes_at: "", scratch_date: "", links: [] };
  const links = v.links.map((l) => ({ ...l }));
  const types = [...new Set(data.races.map((x) => x.race_type).filter(Boolean))];
  const linkRows = () => links.map((l, i) => `<div class="race-link-row" data-i="${i}"><input class="input" data-k="label" placeholder="Label, e.g. Entry info" value="${esc(l.label)}"><input class="input" data-k="url" type="url" placeholder="https://…" value="${esc(l.url)}"><button type="button" class="btn ghost icon" data-rm aria-label="Remove link">${I.x}</button></div>`).join("");
  modal({
    title: r ? "Edit race" : "Add race", wide: true,
    body: `<label class="field"><span>Title</span><input class="input" id="r-title" value="${esc(v.title)}" placeholder="e.g. Christ Church Regatta"></label>
      <div class="grid-3"><label class="field"><span>Date</span><input class="input" type="date" id="r-date" value="${esc(v.date)}"></label>
        <label class="field"><span>Term</span><select class="input" id="r-term"><option value="">–</option>${data.terms.map((t) => `<option ${v.term === t ? "selected" : ""}>${t}</option>`).join("")}</select></label>
        <label class="field"><span>Who should enter</span><div class="grid-2" style="gap:6px"><select class="input" id="r-entry" aria-label="Novice or senior">${Object.entries(data.entry).map(([k, l]) => `<option value="${k}" ${v.entry === k ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
          <select class="input" id="r-squad" aria-label="Squad">${Object.entries(data.race_squads).map(([k, l]) => `<option value="${k}" ${(v.squad || "any") === k ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div></label></div>
      <div class="grid-3"><label class="field"><span>City</span><input class="input" id="r-city" value="${esc(v.city)}" placeholder="e.g. Oxford"></label>
        <label class="field"><span>Expected time slot</span><input class="input" id="r-slot" value="${esc(v.time_slot)}" placeholder="e.g. 09:00–13:00, Morning"></label>
        <label class="field"><span>Race type</span><input class="input" id="r-type" list="r-types" value="${esc(v.race_type)}" placeholder="e.g. Head race, Side-by-side"><datalist id="r-types">${types.map((t) => `<option value="${esc(t)}">`).join("")}</datalist></label></div>
      <div class="grid-3"><label class="field"><span>Entries open</span><input class="input" type="datetime-local" id="r-opens" value="${esc(v.opens_at || "")}"></label>
        <label class="field"><span>Entries close</span><input class="input" type="datetime-local" id="r-closes" value="${esc(v.closes_at || "")}"><span class="hint">The committee gets a reminder banner as this approaches.</span></label>
        <label class="field"><span>Scratch date</span><input class="input" type="date" id="r-scratch" value="${esc(v.scratch_date || "")}"><span class="hint">Last day to withdraw.</span></label></div>
      <label class="field"><span>Notes</span><textarea class="input" id="r-notes" rows="3">${esc(v.notes)}</textarea></label>
      <div class="field"><span>Links / sources</span><div id="r-links" class="race-link-rows"></div><button type="button" class="btn sm" id="r-addlink" style="align-self:flex-start">${I.plus}Add link</button></div>
      <label class="check"><input type="checkbox" id="r-open" ${v.open ? "checked" : ""}> Open for responses</label>`,
    foot: `${r ? `<button class="btn danger" id="r-del">Delete</button>` : ""}<div class="r"><button class="btn" data-close>Cancel</button><button class="btn primary" id="r-save">Save</button></div>`,
    onMount: (m, close) => {
      const box = $("#r-links", m);
      const sync = () => $$(".race-link-row", box).forEach((row) => $$("input", row).forEach((inp) => links[+row.dataset.i][inp.dataset.k] = inp.value));
      const draw = () => { box.innerHTML = linkRows(); $$("[data-rm]", box).forEach((b) => b.onclick = () => { sync(); links.splice(+b.closest(".race-link-row").dataset.i, 1); draw(); }); };
      draw();
      $("#r-addlink", m).onclick = () => { sync(); links.push({ label: "", url: "" }); draw(); $$(".race-link-row input[data-k=label]", box).pop()?.focus(); };
      $("#r-save", m).onclick = async () => {
        sync();
        const body = { title: $("#r-title", m).value.trim(), date: $("#r-date", m).value, term: $("#r-term", m).value, city: $("#r-city", m).value, time_slot: $("#r-slot", m).value,
          entry: $("#r-entry", m).value, squad: $("#r-squad", m).value, race_type: $("#r-type", m).value, notes: $("#r-notes", m).value, open: $("#r-open", m).checked,
          opens_at: $("#r-opens", m).value, closes_at: $("#r-closes", m).value, scratch_date: $("#r-scratch", m).value,
          links: links.filter((l) => l.url.trim()) };
        if (!body.title) return toast("Title is required", true);
        if (!body.date) return toast("Pick a date", true);
        try { await api(r ? `/api/committee/races/${r.id}` : "/api/committee/races", { method: r ? "PUT" : "POST", body }); close(); toast("Race saved"); pageRaces(); } catch (e) { fail(e); }
      };
      const d = $("#r-del", m);
      if (d) d.onclick = async () => {
        if (!await confirmBox(`Delete ${esc(r.title)}?`, "This also removes everyone's responses for it.", "Delete", true)) return;
        try { await api(`/api/committee/races/${r.id}`, { method: "DELETE" }); toast("Race deleted"); pageRaces(); } catch (e) { fail(e); }
      };
    },
  });
}

// ----------------------------------------------------------------- router --
async function reboot() { S.boot = await api("/api/bootstrap"); S.role = S.boot.role; }

/* Committee only: preview the whole site as a rower sees it (the server answers as for a rower too). */
async function setViewAsRower(on) {
  if (S.realRole !== "committee") return;
  S.viewAsRower = on;
  try { on ? localStorage.setItem("op_view_rower", "1") : localStorage.removeItem("op_view_rower"); } catch {}
  S.week = null; S.weekData = null; S.counts = {};
  try { await reboot(); } catch (e) { return fail(e); }
  refreshSubsCount();
  await route();
  toast(on ? "Viewing as a rower" : "Back to the committee view");
}

function route() {
  if (!S.role) return renderLogin();
  const id = (location.hash.replace(/^#\/?/, "") || "schedule").split("?")[0];
  const r = ROUTES.find((x) => x.id === id && routeAllowed(x)) || ROUTES[0];
  shell(r.id);
  S.page = ({ schedule: pageSchedule, signup: pageSignup, subs: pageSubs, races: pageRaces, me: pageMe, stats: pageStats, rowers: pageRowers,
    committee: pageCommittee, todo: pageTasks, handbook: pageHandbook, reminders: pageSubsReminders, coaches: pageCoaches, handover: pageHandover, boats: pageBoats, issues: pageIssues, usage: pageUsage, incidents: pageIncidents, settings: pageSettings })[r.id];
  window.scrollTo(0, 0);
  return S.page();
}

async function start() {
  try { await reboot(); } catch { return renderLogin(); }
  if (S.me && !meName()) setMe(null);
  S.raceBanner = true;
  pushSync();
  refreshSubsCount();
  route();
}

window.addEventListener("hashchange", () => { $("#modal-root").innerHTML = ""; route(); });
(async () => {
  try { const r = await api("/api/me"); S.role = S.realRole = r.role; } catch {}
  S.role ? start() : renderLogin();
})();
