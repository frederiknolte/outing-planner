/* Outing Planner — single-page frontend (no build step). */
"use strict";

// ------------------------------------------------------------------ utils --
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const tRange = (o) => (o && o.time ? (o.end_time ? `${o.time}–${o.end_time}` : o.time) : "");
async function loadPlaces(force = false) { if (!S.places || force) { try { S.places = await api("/api/places"); } catch { S.places = []; } } return S.places; }
const placesDatalist = (id) => `<datalist id="${id}">${(S.places || []).map((p) => `<option value="${esc(p.name)}">${esc(p.address)}</option>`).join("")}</datalist>`;
const SIDE_SHORT = { "Bow side only": "Bow only", "Bow side preferred": "Bow pref", "Equally happy": "Either side", "Stroke side preferred": "Stroke pref", "Stroke side only": "Stroke only" };
const DAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAYL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pd = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const iso = (dt) => dt.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = pd(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const dow = (s) => (pd(s).getUTCDay() + 6) % 7;
const fmtShort = (s) => { const d = pd(s); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
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
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
};

const S = {
  role: null, boot: null, week: null, weekData: null, filter: "all",
  me: (() => { try { return Number(localStorage.getItem("op_me")) || null; } catch { return null; } })(),
  openSubs: 0,
};
const setMe = (id) => { S.me = id; try { id ? localStorage.setItem("op_me", String(id)) : localStorage.removeItem("op_me"); } catch {} };
const meName = () => S.boot?.members.find((m) => m.id === S.me)?.name;
const isAdmin = () => S.role === "admin";

async function api(path, opts = {}) {
  const init = { method: opts.method || "GET", headers: {}, credentials: "same-origin" };
  if (opts.body instanceof FormData) init.body = opts.body;
  else if (opts.body !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(opts.body); }
  const r = await fetch(path, init);
  if (r.status === 401 && path !== "/api/login") { S.role = null; renderLogin(); throw new Error("Signed out"); }
  const ct = r.headers.get("content-type") || "";
  const data = ct.includes("json") ? await r.json() : await r.text();
  if (!r.ok) throw new Error((data && data.detail) || `Error ${r.status}`);
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
    const q = inp.value.trim().toLowerCase();
    const curLabel = cur != null ? byId().get(cur)?.label?.toLowerCase() : null;
    const query = q && q !== curLabel ? q : "";
    shown = items().filter((i) => !query || i.label.toLowerCase().includes(query))
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
      <p class="faint small" style="margin:4px 0 0;text-align:center">Rowers and coaches use different passwords.</p>
    </form></div><div class="login-foot">Reuben College · Oxford</div></div>`;
  $("#login-form").onsubmit = async (e) => {
    e.preventDefault();
    const pw = e.target.password.value;
    try {
      const r = await api("/api/login", { method: "POST", body: { password: pw } });
      S.role = r.role;
      await start();
    } catch (err) { $("#login-err").textContent = err.message; }
  };
}

// ------------------------------------------------------------------ shell --
const ROUTES = [
  { id: "schedule", label: "Schedule", icon: I.calendar },
  { id: "signup", label: "Sign up", adminLabel: "Sign-ups", icon: I.calendar },
  { id: "subs", label: "Sub board", icon: I.swap },
  { id: "me", label: "My outings", icon: I.user, member: true },
  { id: "stats", label: "Leaderboard", icon: I.trophy },
  { id: "rowers", label: "Rowers", icon: I.user },
  { id: "boats", label: "Boat park", icon: I.boat },
  { id: "coaches", label: "Coaches", icon: I.whistle, admin: true },
  { id: "settings", label: "Settings", icon: I.info, admin: true },
];

const routeLabel = (r) => (isAdmin() && r.adminLabel) || r.label;
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
  const routes = ROUTES.filter((r) => (!r.admin || isAdmin()));
  const cur = routes.find((r) => r.id === active) || routes[0];
  const name = meName();
  $("#app").innerHTML = `
  <header class="topbar"><div class="topbar-inner">
    <a class="brand" href="#/schedule" style="color:inherit"><img class="brand-mark" src="/static/crest.png" alt=""><div>${esc(S.boot.club_name || "Reuben Boat Club")}<small>Outing planner · Oxford</small></div></a>
    <button class="nav-toggle" id="nav-toggle" aria-expanded="false" aria-controls="main-nav"><span class="nav-ic">${cur.icon}</span><span class="nav-cur">${esc(routeLabel(cur))}</span><span class="count" id="nav-toggle-count"${active !== "subs" && S.openSubs ? "" : " hidden"}>${S.openSubs}</span><span class="chev">${I.down}</span></button>
    <nav class="nav" id="main-nav">${routes.map((r) => `<a href="#/${r.id}" class="${r.id === active ? "active" : ""}"${r.id === active ? ` aria-current="page"` : ""}><span class="nav-ic">${r.icon}</span><span class="nav-l">${esc(routeLabel(r))}</span>${r.id === "subs" && S.openSubs ? `<span class="count">${S.openSubs}</span>` : ""}</a>`).join("")}</nav>
    <div class="top-actions">
      ${isAdmin() ? `<span class="role-badge">Admin</span>` : ""}
      <button class="me-chip" id="me-chip" title="Choose who you are">${name ? `<span class="avatar">${esc(initials(name))}</span><span class="n">${esc(name)}</span>` : `<span class="avatar" style="background:var(--surface-3);color:var(--text-3)">?</span><span class="n">Who are you?</span>`}</button>
      <button class="btn ghost icon" id="logout" title="Sign out">${I.logout}</button>
    </div>
  </div></header>
  <main class="main" id="main"><div class="spinner"></div></main>`;
  $("#nav-toggle").onclick = (e) => { e.stopPropagation(); setNavOpen(!$(".topbar").classList.contains("nav-open")); };
  $("#main-nav").onclick = () => setNavOpen(false);
  $("#me-chip").onclick = () => pickIdentity();
  $("#logout").onclick = async () => { await api("/api/logout", { method: "POST" }).catch(() => {}); S.role = null; renderLogin(); };
}

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
        const q = $("#pi-q", m).value.trim().toLowerCase();
        $("#pi-list", m).innerHTML = members.filter((x) => !q || x.name.toLowerCase().includes(q)).map((x) =>
          `<button data-id="${x.id}"><span>${esc(x.name)}</span><span class="chip ${x.category === "Novice" ? "accent" : ""}">${esc(x.category)}</span></button>`).join("")
          || `<div class="faint" style="padding:10px">No one found — ask an admin to add you.</div>`;
        $$("#pi-list button", m).forEach((b) => b.onclick = () => { setMe(+b.dataset.id); close(); toast(`Hi, ${meName().split(" ")[0]}!`); after ? after() : route(); });
      };
      $("#pi-q", m).oninput = draw; draw();
      const c = $("#pi-clear", m); if (c) c.onclick = () => { setMe(null); close(); route(); };
    },
  });
}

function requireMe(fn) { if (S.me && meName()) fn(); else pickIdentity(fn); }

// --------------------------------------------------------------- schedule --
function seatRow(o, s) {
  const m = s.member;
  const mine = m && m.id === S.me;
  const cls = ["seat"];
  if (!m) cls.push("open");
  if (m && isAdmin() && s.eligibility && !s.eligibility.ok) cls.push("bad");
  if (mine) cls.push("me");
  if (s.sub_request) cls.push("subreq");
  let tag = "";
  const subTag = s.subbed_for ? `<span class="tag violet" title="Subbing for ${esc(s.subbed_for)}">sub</span>` : "";
  if (s.sub_request) tag = `<button class="tag warn" data-act="fill" data-sub="${s.sub_request.id}" title="${esc(s.sub_request.reason || "Sub needed")}">Sub needed</button>`;
  // Land sessions are open: you just leave, the spot reopens for anyone.
  else if (mine && !o.past && o.kind === "land") tag = `<span class="tags">${subTag}<button class="tag ok" data-act="leave" title="Give up your spot">Leave</button></span>`;
  // Your own seat always offers "Can't go" — including a seat you took as a sub.
  else if (mine && !o.past) tag = `<span class="tags">${subTag}<button class="tag ok" data-act="reqsub" data-o="${o.id}" title="Can't make it? Request a sub">Can't go</button></span>`;
  else tag = subTag;
  const title = m && isAdmin() && s.eligibility ? (s.eligibility.reasons.join(", ") || s.eligibility.note || "") : "";
  return `<div class="${cls.join(" ")}" title="${esc(title)}"><span class="sl">${esc(({ Stroke: "S", Bow: "B", Sculler: "1x" })[s.label] || s.label)}</span><span class="sn">${m ? esc(m.name) : "Open"}</span>${tag}</div>`;
}

/* Land sessions: list who's in, then the open spots anyone can take. */
function landSpots(o) {
  const inIt = o.seats.filter((s) => s.member);
  const mine = inIt.some((s) => s.member.id === S.me);
  const join = o.spots > 0 && !o.past && !mine;
  return `<div class="seats">${inIt.map((s, i) => seatRow(o, { ...s, label: String(i + 1) })).join("") || `<div class="seat open"><span class="sl"></span><span class="sn">No one yet. Be the first!</span></div>`}</div>
    <div class="o-foot land-open">
      <span class="chip ${o.spots ? "accent" : "ok"}">${o.spots ? "" : I.check}${esc(o.spots_text)}${o.spots ? ` of ${o.capacity}` : ""}</span>
      ${join ? `<button class="btn sm primary" data-act="join" title="Take a spot in this session">${I.plus}Join</button>` : mine && !o.past ? `<span class="chip ok">${I.check}You're in</span>` : ""}
    </div>`;
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

function outingCard(o) {
  const admin = isAdmin();
  const kindChip = o.kind === "water" ? `<span class="chip water">${I.water}Water</span>` : `<span class="chip land">${I.land}Land</span>`;
  const full = o.spots === 0;
  const coxChip = o.cox_check && o.cox_check !== o.spots_text ? `<span class="chip ${o.cox_check === "Bankrider needed" ? "bad" : o.cox_check.startsWith("Cox needed") || o.cox_check === "Cox status not set" ? "warn" : "ok"}">${esc(o.cox_check)}</span>` : "";
  return `<article class="card outing ${o.kind} ${o.published ? "" : "draft"} ${o.past ? "past" : ""} ${admin ? "clickable" : ""}" data-oid="${o.id}">
    <div class="o-top"><div>${o.time ? `<div class="o-time tnum">${esc(tRange(o))}</div><div class="o-title">${esc(o.title || (o.kind === "water" ? "Water outing" : "Land training"))}</div>` : `<div class="o-time">${esc(o.title || (o.kind === "water" ? "Water outing" : "Land training"))}</div><div class="o-title faint small">Time TBC</div>`}</div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">${kindChip}${admin && !o.published ? `<span class="chip">Draft</span>` : ""}</div></div>
    <div class="o-sub">
      ${o.boat ? `<span>${I.boat}${esc(o.boat.name)} <span class="faint">${esc(o.boat.type)}</span></span>` : o.kind === "water" ? `<span class="faint">${I.boat}${o.capacity}${o.coxed ? "+" : ""} · no boat set</span>` : ""}
      ${o.location ? (o.maps_url ? `<a href="${esc(o.maps_url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="Open in maps">${I.pin}${esc(o.location)}</a>` : `<span>${I.pin}${esc(o.location)}</span>`) : ""}
      ${o.coach ? `<span>${I.whistle}${esc(o.coach)}</span>` : ""}
    </div>
    ${o.kind === "land" ? landSpots(o) : `<div class="seats">${o.seats.map((s) => seatRow(o, s)).join("")}</div>
    <div class="o-foot"><span class="chip ${full ? "ok" : "warn"}">${full ? I.check : ""}${esc(o.spots_text)}</span>${coxChip}</div>`}
    ${o.notes ? `<div class="small muted" style="margin-top:6px">${esc(o.notes)}</div>` : ""}
    ${admin && o.warnings.length ? `<div class="warnings">${o.warnings.map((w) => `<div>${I.alert}<span>${esc(w)}</span></div>`).join("")}</div>` : ""}
    ${riverList((o.river || []).filter((r) => !o.past && (admin || r.level === "stop")))}
  </article>`;
}

async function pageSchedule() {
  if (!S.week) S.week = isAdmin() ? addDays(S.boot.this_week, 0) : S.boot.this_week;
  const main = $("#main");
  let data;
  try { data = await api(`/api/week?start=${S.week}`); } catch (e) { return fail(e); }
  S.weekData = data;
  const admin = isAdmin();
  const end = addDays(data.start, 6);
  const isThis = data.start === S.boot.this_week;
  const pubState = data.total === 0 ? "" : data.published === data.total
    ? `<span class="status-pill" style="background:var(--ok-soft);color:var(--ok)"><span class="dot"></span>Published</span>`
    : data.published === 0 ? `<span class="status-pill" style="background:var(--surface-3);color:var(--text-2)"><span class="dot"></span>Draft — not visible to rowers</span>`
    : `<span class="status-pill" style="background:var(--warn-soft);color:var(--warn)"><span class="dot"></span>${data.published}/${data.total} published</span>`;
  const outs = data.outings.filter((o) => S.filter === "all" || (S.filter === "mine" ? o.seats.some((s) => s.member && s.member.id === S.me) : S.filter === "subs" ? o.open_subs > 0 : S.filter === "open" ? (o.kind === "land" && o.spots > 0 && !o.past) : o.kind === S.filter));
  const myCount = data.outings.filter((o) => o.seats.some((s) => s.member && s.member.id === S.me)).length;
  main.innerHTML = `
    <div class="page-head">
      <div><h1>${isThis ? "This week" : data.start > S.boot.this_week ? (addDays(S.boot.this_week, 7) === data.start ? "Next week" : "Upcoming week") : "Past week"}</h1>
        <p>${fmtShort(data.start)} – ${fmtShort(end)} ${pd(end).getUTCFullYear()} · ${S.boot.settings.current_term} ${esc(S.boot.settings.academic_year)} ${admin && pubState ? "&nbsp;" + pubState : ""}</p></div>
      <div class="toolbar">
        <div class="weekbar">
          <button class="btn icon" id="wk-prev" title="Previous week">${I.left}</button>
          <button class="btn" id="wk-today" ${isThis ? "disabled" : ""}>Today</button>
          <button class="btn icon" id="wk-next" title="Next week">${I.right}</button>
        </div>
        <button class="btn" id="wk-cal" title="Add your outings to your phone's calendar">${I.calendar}Add to calendar</button>
        ${admin ? `
          <button class="btn" id="wk-copy">${I.copy}Copy last week</button>
          ${data.total ? (data.published === data.total ? `<button class="btn" id="wk-unpub">${I.eye}Unpublish</button>` : `<button class="btn primary" id="wk-pub">${I.send}Publish week</button>`) : ""}
        ` : ""}
      </div>
    </div>
    ${flagBanner(data.river && data.river.flag)}
    <div class="filters">
      <div class="seg" id="flt">
        ${[["all", "All"], ["water", "Water"], ["land", "Land"], ["open", "Open spots"], ["mine", `Mine${S.me ? ` (${myCount})` : ""}`], ["subs", "Needs sub"]].map(([k, l]) => `<button data-f="${k}" class="${S.filter === k ? "on" : ""}">${l}</button>`).join("")}
      </div>
      ${admin ? `<div style="margin-left:auto" class="toolbar"><button class="btn" data-new="land">${I.plus}Land session</button><button class="btn primary" data-new="water">${I.plus}Water outing</button></div>` : ""}
    </div>
    ${!admin && data.outings.length === 0 ? `<div class="card empty">${I.calendar}<h3>Nothing published yet</h3><p>The schedule for this week hasn't been released. Check back soon.</p></div>` : `
    <div class="days">${data.days.map((d) => {
      const list = outs.filter((o) => o.date === d);
      return `<section class="day ${d === data.today ? "today" : ""}"><div class="day-head"><b>${DAY[dow(d)]}</b><span>${d === data.today ? "Today · " : ""}${fmtShort(d)}</span></div>
        ${data.river && data.river.days[d] ? (() => { const x = data.river.days[d]; return `<div class="day-sun" title="Sunrise ${x.sunrise} · sunset ${x.sunset}. Rowing allowed from 1 hour before sunrise to 1 hour after sunset.">On the water ${x.first}–${x.last}</div>`; })() : ""}
        <div class="day-body">${list.map(outingCard).join("") || (admin ? `<div class="day-empty">No sessions<br><button class="btn sm" data-new="water" data-date="${d}">${I.plus}Add</button></div>` : `<div class="day-empty">Rest day</div>`)}</div></section>`;
    }).join("")}</div>`}
    <div class="legend">
      <span><i class="sw" style="background:var(--water)"></i>Water</span><span><i class="sw" style="background:var(--land)"></i>Land</span>
      <span><i class="sw" style="background:var(--accent-soft);border:1px solid var(--accent)"></i>You</span>
      <span><i class="sw" style="background:var(--warn)"></i>Sub needed — tap to take the seat</span>
      ${admin ? `<span><i class="sw" style="background:var(--bad)"></i>Ineligible (no subs after cutoff / no swim test)</span><span><i class="sw" style="background:repeating-linear-gradient(135deg,var(--surface),var(--surface) 3px,var(--surface-3) 3px,var(--surface-3) 6px);border:1px solid var(--border)"></i>Draft</span>` : ""}
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
  if (admin) {
    $$("[data-new]").forEach((b) => b.onclick = () => editOuting(null, { kind: b.dataset.new, date: b.dataset.date || data.days.find((d) => d >= data.today) || data.start }));
    const pub = $("#wk-pub"), unpub = $("#wk-unpub");
    if (pub) pub.onclick = async () => { if (await confirmBox("Publish this week?", "All sessions for this week become visible to rowers.", "Publish")) { await api("/api/admin/week/publish", { method: "POST", body: { start: data.start, published: true } }).catch(fail); toast("Week published"); pageSchedule(); } };
    if (unpub) unpub.onclick = async () => { await api("/api/admin/week/publish", { method: "POST", body: { start: data.start, published: false } }).catch(fail); toast("Week set back to draft"); pageSchedule(); };
    $("#wk-copy").onclick = () => copyWeek(data.start);
  }
  if (admin && S.pendingNew) { const d = S.pendingNew; S.pendingNew = null; editOuting(null, d); }
  $$(".outing").forEach((card) => card.addEventListener("click", (e) => {
    const t = e.target.closest("[data-act]");
    const o = data.outings.find((x) => x.id === +card.dataset.oid);
    if (t) {
      e.stopPropagation();
      if (t.dataset.act === "reqsub") return requestSub(o);
      if (t.dataset.act === "fill") return fillSub(+t.dataset.sub, o);
      if (t.dataset.act === "join") return joinLand(o);
      if (t.dataset.act === "leave") return leaveLand(o);
    }
    if (admin) editOuting(o);
  }));
}

function copyWeek(target) {
  const src = addDays(target, -7);
  modal({
    title: "Copy sessions from last week",
    body: `<p style="margin:0" class="muted">Copies every session from <b>${fmtShort(src)} – ${fmtShort(addDays(src, 6))}</b> into this week as drafts.</p>
      <label class="check"><input type="checkbox" id="cw-crews"> Also copy crews (who's in each seat)</label>`,
    foot: `<div class="r"><button class="btn" data-close>Cancel</button><button class="btn primary" id="cw-go">${I.copy}Copy</button></div>`,
    onMount: (m, close) => {
      $("#cw-go", m).onclick = async () => {
        try {
          const r = await api("/api/admin/week/copy", { method: "POST", body: { source: src, target, include_crews: $("#cw-crews", m).checked } });
          close(); toast(`Copied ${r.copied} session${r.copied === 1 ? "" : "s"}`); pageSchedule();
        } catch (e) { fail(e); }
      };
    },
  });
}

// ------------------------------------------------------- outing editor ----
async function editOuting(o, defaults = {}) {
  const [boatsRes, coaches] = await Promise.all([api("/api/admin/boats"), api("/api/admin/coaches"), loadPlaces(true)]).catch((e) => { fail(e); return [null, null]; });
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
    <div id="oe-river"></div>`;
  const foot = `${o ? `<button class="btn danger" id="oe-del">Delete</button>` : ""}<div class="r">
      <button class="btn" data-close>Cancel</button>
      ${o && o.published ? "" : `<button class="btn" id="oe-save-draft">${o ? "Save draft" : "Save as draft"}</button>`}
      <button class="btn primary" id="oe-save">${o && o.published ? "Save" : "Save & publish"}</button></div>`;

  modal({
    title: o ? "Edit session" : st.kind === "water" ? "New water outing" : "New land session", body, foot, wide: "xl",
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
            const r = await api("/api/admin/river-check", { method: "POST", body: {
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
          const r = await api("/api/admin/candidates", { method: "POST", body: { kind: st.kind, date: st.date, time: st.time, outing_id: o?.id || null } });
          cand = r.members; hasSlots = r.has_slots; loaded = true;
        } catch (e) { fail(e); }
        drawSeats();
      };
      const items = (seat) => () => members.map((mm) => {
        const c = cand[mm.id] || { ok: true, reasons: [] };
        const taken = Object.entries(st.seats).some(([k, v]) => v === mm.id && +k !== seat);
        const notCox = st.kind === "water" && seat === 0 && !mm.cox_status;
        const bad = !c.ok, busy = c.busy, su = c.signup;
        const free = !!(su && su.available);
        const roleFit = !su || (seat === 0 && st.kind === "water" ? ["cox", "both"].includes(su.role) : ["rower", "both"].includes(su.role));
        const overMax = !!(su && su.max_outings && c.week_count >= su.max_outings);
        return { id: mm.id, label: mm.name, c, su, free, overMax, taken, notCox, mm,
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
        if (i.su && i.su.side) bits.push(`<span class="chip" title="${esc(i.su.side)}">${esc(SIDE_SHORT[i.su.side] || i.su.side)}</span>`);
        if (i.su && i.su.max_outings) bits.push(`<span class="chip ${i.overMax ? "warn" : ""}" title="Scheduled this week / max wanted">${i.c.week_count}/${i.su.max_outings} wk</span>`);
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
          if (su && su.max_outings && c.week_count >= su.max_outings) soft.push(`Already at their max of ${su.max_outings} this week`);
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
        const rank = (x) => (x.c.busy ? 100 : 0) + (x.c.ok === false ? 50 : 0) + (x.su.max_outings && x.c.week_count >= x.su.max_outings ? 20 : 0) + (x.c.week_count || 0);
        const sorted = (list) => list.slice().sort((a, b) => rank(a) - rank(b) || a.mm.name.localeCompare(b.mm.name));
        const roleTag = { rower: "Rower", cox: "Cox", both: "Row/cox", bankrider: "Bankrider" };
        const item = (x, intent) => {
          const seat = seatOf(x.mm.id), inBoat = seat != null;
          const over = x.su.max_outings && x.c.week_count >= x.su.max_outings;
          const probs = [];
          if (x.c.busy) probs.push(`<span class="chip bad">Booked at this time</span>`);
          if (x.c.ok === false) probs.push(`<span class="chip bad">${esc(x.c.reasons.join(" · "))}</span>`);
          const cap = seatList().filter((q) => q !== 0).length;
          return `<button type="button" class="pool-item ${inBoat ? "in" : ""} ${x.c.busy || x.c.ok === false ? "bad" : ""}" data-pick="${x.mm.id}" data-intent="${intent}" title="${inBoat ? "Click to take out of the boat" : "Click to put in the boat"}">
            <span class="pi-main"><span class="pi-name">${esc(x.mm.name)}</span>
              <span class="pi-meta">${intent !== "cox" && x.su.side ? `<span class="chip">${esc(SIDE_SHORT[x.su.side] || x.su.side)}</span>` : ""}${intent === "cox" && x.mm.cox_status ? `<span class="chip violet">Cox ${esc(x.mm.cox_status)}</span>` : ""}${x.su.role === "both" ? `<span class="chip accent">${roleTag.both}</span>` : ""}
              ${x.su.max_outings ? `<span class="chip ${over ? "warn" : ""}" title="Outings given this week / most they want">${x.c.week_count}/${x.su.max_outings} wk</span>` : ""}${probs.join("")}</span></span>
            <span class="pi-state">${inBoat ? `<span class="pi-seat">${esc(label(seat, cap))}</span>` : I.plus}</span></button>`;
        };
        const group = (title, list, intent, hint = "") => list.length ? `<div class="pool-group"><div class="pool-h">${title} <span class="faint">${list.length}</span>${hint ? `<span class="pool-hint">${hint}</span>` : ""}</div>${sorted(list).map((x) => item(x, intent)).join("")}</div>` : "";
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
          const ps = parts(), q = (ps[ps.length - 1] || "").trim().toLowerCase();
          const taken = new Set(ps.slice(0, -1).map((x) => x.trim().toLowerCase()));
          const byName = new Map();
          coaches.forEach((c) => byName.set(c.name.toLowerCase(), { name: c.name, coach: true }));
          members.forEach((mm) => { const k = mm.name.toLowerCase(); byName.set(k, { ...(byName.get(k) || { name: mm.name }), mid: mm.id }); });
          return [...byName.values()]
            .filter((e) => !taken.has(e.name.toLowerCase()) && (!q || e.name.toLowerCase().includes(q)))
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
          await api(o ? `/api/admin/outings/${o.id}` : "/api/admin/outings", { method: o ? "PUT" : "POST", body });
          close(); toast(o ? "Session saved" : "Session created"); pageSchedule();
        } catch (e) { fail(e); }
      };
      $("#oe-save", m).onclick = () => save(o && o.published ? true : true);
      const d = $("#oe-save-draft", m); if (d) d.onclick = () => save(false);
      const del = $("#oe-del", m);
      if (del) del.onclick = async () => {
        if (!await confirmBox("Delete this session?", "Crew assignments and sub requests for it will be removed. Outing counts update automatically.", "Delete", true)) return;
        try { await api(`/api/admin/outings/${o.id}`, { method: "DELETE" }); toast("Session deleted"); pageSchedule(); } catch (e) { fail(e); }
      };
      syncKind(); drawSeats(); loadCand();
    },
  });
}

// ---------------------------------------------------- phone privacy (admin) --
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
      const { phone } = await api(`/api/admin/members/${b.dataset.reveal}/phone`);
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

// ------------------------------------------------------------------- subs --
function requestSub(o) {
  requireMe(() => {
    const seat = o.seats.find((s) => s.member && s.member.id === S.me);
    if (!seat) return toast("You're not in this session", true);
    modal({
      title: "Request a sub",
      body: `<div class="callout">${I.info}<div>You stay in the <b>${esc(seat.label)}</b> seat for <b>${esc(o.title || (o.kind === "water" ? "Water outing" : "Land training"))}</b> on <b>${fmtLong(o.date)}${o.time ? " at " + esc(o.time) : ""}</b> until someone takes it. Your outing count moves to them.</div></div>
        <label class="field"><span>Reason (optional)</span><input class="input" id="rs-reason" maxlength="300" placeholder="e.g. Lab meeting moved"></label>`,
      foot: `<div class="r"><button class="btn" data-close>Cancel</button><button class="btn primary" id="rs-go">${I.swap}Post to sub board</button></div>`,
      onMount: (m, close) => {
        $("#rs-go", m).onclick = async () => {
          try { await api("/api/subs", { method: "POST", body: { outing_id: o.id, member_id: S.me, reason: $("#rs-reason", m).value } }); close(); toast("Sub request posted"); refreshSubsCount(); route(); }
          catch (e) { fail(e); }
        };
      },
    });
  });
}

async function fillSub(subId) {
  const admin = isAdmin();
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
    if (mine && !admin) {
      body = summary + `<div class="callout">${I.info}<div>This is your own request. Cancel it if you can make it after all.</div></div>`;
      foot = `<div class="r"><button class="btn" data-close>Close</button><button class="btn danger" id="fs-cancel">Cancel my request</button></div>`;
    } else if (admin) {
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
        let ctl = null;
        if (admin) {
          ctl = combo($("#fs-who", m), {
            items: () => S.boot.members.filter((x) => x.id !== sr.requester.id).map((x) => { const c = cands[x.id] || { ok: false, problems: [] }; return { id: x.id, label: x.name, c, dim: !c.ok, cls: c.ok ? "" : "bad", rank: c.ok ? 0 : 1 }; }),
            renderWhy: (i) => i.c.ok ? `<span class="chip ok">OK</span>` : `<span class="chip bad">${esc(i.c.problems.join(" · "))}</span>`,
            placeholder: "Search rowers…",
          });
        }
        const g = $("#fs-go", m);
        if (g) g.onclick = async () => {
          const who = admin ? ctl.get() : S.me;
          if (!who) return toast("Pick someone first", true);
          try { await api(`/api/subs/${subId}/fill`, { method: "POST", body: { member_id: who } }); close(); toast("Seat taken — thanks!"); refreshSubsCount(); route(); }
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
  if (admin) go(); else requireMe(go);
}

async function refreshSubsCount() {
  try { const s = await api("/api/subs"); S.openSubs = s.open.length; const n = $('.nav a[href="#/subs"]'); if (n) { n.querySelector(".count")?.remove(); if (S.openSubs) n.insertAdjacentHTML("beforeend", `<span class="count">${S.openSubs}</span>`); }
    const tc = $("#nav-toggle-count"); if (tc) { tc.textContent = S.openSubs; tc.hidden = !S.openSubs || !!n?.classList.contains("active"); } } catch {}
}

async function pageSubs() {
  let data;
  try { data = await api("/api/subs"); } catch (e) { return fail(e); }
  S.openSubs = data.open.length;
  const card = (s, filled) => {
    const d = pd(s.outing.date);
    return `<article class="card sub">
      <div class="sub-when"><div class="datebox"><span>${DAY[dow(s.outing.date)]}</span><b>${d.getUTCDate()}</b><span>${MON[d.getUTCMonth()]}</span></div>
        <div style="flex:1;min-width:0"><div style="font-weight:700">${esc(s.outing.title || (s.outing.kind === "water" ? "Water outing" : "Land training"))}</div>
          <div class="o-sub">${s.outing.time ? `<span>${esc(tRange(s.outing))}</span>` : ""}${s.outing.location ? `<span>${I.pin}${esc(s.outing.location)}</span>` : ""}${s.outing.boat ? `<span>${I.boat}${esc(s.outing.boat)}</span>` : ""}</div></div>
        <span class="chip ${s.outing.kind}">${s.outing.kind === "water" ? I.water : I.land}${esc(s.seat_label)}</span></div>
      <div class="small">${filled ? `<b>${esc(s.sub?.name)}</b> is subbing for ${esc(s.requester.name)}` : `<b>${esc(s.requester.name)}</b> needs a sub${s.requester.id === S.me ? ` <span class="chip accent">you</span>` : ""}`}</div>
      ${s.reason && !filled ? `<div class="reason">“${esc(s.reason)}”</div>` : ""}
      ${filled ? "" : `<div style="display:flex;gap:8px">${s.requester.id === S.me && !isAdmin() ? `<button class="btn" data-fill="${s.id}" style="flex:1">Manage request</button>` : `<button class="btn primary" data-fill="${s.id}" style="flex:1">${I.check}${isAdmin() ? "Assign a sub" : "I'll sub"}</button>`}</div>`}
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
      <div class="toolbar"><button class="btn" id="me-cal">${I.calendar}Add to calendar</button><button class="btn" id="switch">${I.swap}Not you?</button></div></div>
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
      <span class="chip ${st.swim_test ? "ok" : "warn"}">Swim test ${st.swim_test ? "passed" : "not recorded"}</span>
    </div><p class="small faint" style="margin:10px 0 0">Something wrong? Speak to a club admin.</p></div>
    <div class="section-title">Upcoming sessions</div>
    ${d.upcoming.length ? `<div class="days" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr))">${d.upcoming.map((o) => `<div><div class="day-head"><b>${DAY[dow(o.date)]}</b><span>${fmtShort(o.date)}</span></div>${outingCard(o)}</div>`).join("")}</div>`
      : `<div class="card empty">${I.calendar}<h3>Nothing scheduled</h3><p>You're not in any published upcoming sessions. Check the sub board for open seats.</p></div>`}`;
  $("#switch").onclick = () => pickIdentity();
  $("#me-cal").onclick = () => calendarModal();
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

function meStatsCard(p, boards) {
  if (!p) return "";
  const ms = p.milestone;
  const pct = ms.next ? Math.round(((p.all_time - ms.reached) / (ms.next - ms.reached)) * 100) : 100;
  const ranks = boards.map((b) => ({ b, r: b.me[String(S.me)] })).filter((x) => x.r && x.r.rank <= 10).sort((a, b) => a.r.rank - b.r.rank).slice(0, 4);
  return `<div class="card card-pad lb-me">
    <div class="lb-me-head"><span class="avatar">${esc(initials(meName()))}</span><div><b>${esc(meName())}</b><div class="small faint">${plural(p.season_total, "sessions")} this season · ${plural(p.all_time, "sessions")} all time</div></div></div>
    <div class="lb-progress"><div class="small"><b>${ms.next ? `${plural(ms.to_go, "sessions")} to your ${ms.next}${ms.next === 1 ? "st" : "th"} session` : "Every milestone reached. Legend!"}</b></div><div class="bar"><i style="width:${pct}%"></i></div></div>
    <div class="lb-me-grid">
      <div><div class="k">Current streak</div><div class="v">${p.current_streak ? "🔥 " : ""}${plural(p.current_streak, "weeks")}</div><div class="s">best ${plural(p.streak, "weeks")}</div></div>
      <div><div class="k">Early starts</div><div class="v">${p.early}</div><div class="s">before 08:00</div></div>
      <div><div class="k">Subs filled</div><div class="v">${p.subs}</div><div class="s">seats saved</div></div>
      <div><div class="k">Boat buddy</div><div class="v lb-small">${p.buddy ? esc(p.buddy.name) : "–"}</div><div class="s">${p.buddy ? `${plural(p.buddy.value, "outings")} together` : "row more to find one"}</div></div>
    </div>
    ${p.badges.length || ranks.length ? `<div class="lb-badges">${p.badges.map((b) => `<span class="chip ok">🏆 ${esc(b)}</span>`).join("")}${ranks.filter((x) => !p.badges.includes(x.b.title)).map((x) => `<span class="chip accent">#${x.r.rank} ${esc(x.b.title)}</span>`).join("")}</div>` : ""}
  </div>`;
}

async function pageStats() {
  let d;
  try { d = await api("/api/stats"); } catch (e) { return fail(e); }
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
    <div class="page-head"><div><h1>Leaderboard</h1><p>Season awards since ${esc(fmtShort(d.season_start))}. Sessions count once they've happened.</p></div>
      ${!me ? `<div class="toolbar"><button class="btn" id="lb-pick">${I.user}Show my stats</button></div>` : ""}</div>
    <div class="stats" style="margin-bottom:16px">
      <div class="card stat"><div class="k">Seats filled</div><div class="v">${c.seat_sessions}</div><div class="s">across ${plural(c.sessions, "sessions")}</div></div>
      <div class="card stat"><div class="k">This week so far</div><div class="v">${c.this_week}</div><div class="s">${diff > 0 ? `▲ ${diff} on last week` : diff < 0 ? `${c.last_week} last week, catch up!` : `same as last week`}</div></div>
      <div class="card stat"><div class="k">Rowers out</div><div class="v">${c.active_rowers}</div><div class="s">at least one session</div></div>
      <div class="card stat"><div class="k">Subs filled</div><div class="v">${c.subs_filled}</div><div class="s">${c.busiest_day != null ? `busiest day: ${DAYL[c.busiest_day]}` : "teamwork!"}</div></div>
    </div>
    ${me ? meStatsCard(me, d.boards) : ""}
    <div class="section-title">Awards</div>
    <div class="lb-grid">${d.boards.map(boardCard).join("")}
      <div class="card lb-board">
        <div class="lb-title"><span class="lb-ico">🤝</span><div><b>Crew chemistry</b><div class="small faint">Pairs who've been in the same boat most often</div></div></div>
        ${d.pairs.length ? `<ol class="lb-list">${d.pairs.map((p, i) => `<li class="${p.ids.includes(S.me) ? "you" : ""}"><span class="lb-rank">${MEDAL[i] || i + 1}</span><span class="lb-name">${esc(p.a)} &amp; ${esc(p.b)}</span><span class="lb-val">${p.value}</span></li>`).join("")}</ol>` : `<p class="small faint lb-empty">No crews on the water yet.</p>`}
      </div>
    </div>`;
  const pk = $("#lb-pick"); if (pk) pk.onclick = () => pickIdentity();
}

// ----------------------------------------------------------------- rowers --
let rowerSort = { k: "name", dir: 1 }, rowerQ = "", rowerCat = "all";
const rowersTabs = (on, nRem) => `<div class="seg" id="rw-tabs"><button data-t="members" class="${on === "members" ? "on" : ""}">Members</button><button data-t="subs" class="${on === "subs" ? "on" : ""}">Subs reminders${nRem ? ` <span class="count-pill">${nRem}</span>` : ""}</button></div>`;
const wireRowersTabs = () => $$("#rw-tabs button").forEach((b) => b.onclick = () => { S.rowersTab = b.dataset.t; route(); });

async function pageRowers() {
  const admin = isAdmin();
  if (admin && S.rowersTab === "subs") return pageSubsReminders();
  let rows, meta = {}, nRem = 0;
  try {
    if (admin) {
      const [r, rem] = await Promise.all([api("/api/admin/members"), api("/api/admin/subs-reminders")]);
      rows = r.members.map((m) => ({ ...m, ...m.totals })); meta = r; nRem = rem.members.length;
    }
    else rows = await api("/api/rowers");
  } catch (e) { return fail(e); }
  const draw = () => {
    let list = rows.filter((r) => (!rowerQ || r.name.toLowerCase().includes(rowerQ)) && (rowerCat === "all" || (rowerCat === "inactive" ? !r.active : rowerCat === "issues" ? (r.active !== false && (!r.water_ok || !r.land_ok)) : r.category === rowerCat && r.active !== false)));
    if (rowerCat !== "inactive" && admin) list = list.filter((r) => rowerCat === "all" || r.active);
    const k = rowerSort.k;
    list.sort((a, b) => (typeof a[k] === "string" ? a[k].localeCompare(b[k]) : (a[k] ?? -1) - (b[k] ?? -1)) * rowerSort.dir || a.name.localeCompare(b.name));
    const max = Math.max(1, ...rows.map((r) => r.total));
    const th = (key, l, cls = "") => `<th class="sort ${cls}" data-k="${key}">${l}${rowerSort.k === key ? (rowerSort.dir > 0 ? " ↑" : " ↓") : ""}</th>`;
    $("#rw-table").innerHTML = `<table class="t"><thead><tr>${th("name", "Name")}${th("category", "Category")}
      ${admin ? `<th>Swim</th><th>Subs</th>${th("cox_status", "Cox")}<th title="At their next new outing, counting everything already scheduled">May row next</th>` : `${th("cox_status", "Cox")}`}
      ${th("water", "Water", "num")}${th("land", "Land", "num")}${th("total", "Total", "num")}<th style="width:120px"></th>${th("novice_free_left", "Free left", "num")}</tr></thead>
      <tbody>${list.map((r) => `<tr class="${admin ? "clickable" : ""}" data-id="${r.id}">
        <td><b>${esc(r.name)}</b>${r.id === S.me ? ` <span class="chip accent">you</span>` : ""}${admin && !r.active ? ` <span class="chip">inactive</span>` : ""}${admin && r.needs_review ? ` <span class="chip warn" title="Added through the sign-up form — check their details">New</span>` : ""}</td>
        <td><span class="chip ${r.category === "Novice" ? "accent" : ""}">${esc(r.category)}</span></td>
        ${admin ? `<td>${r.swim_test ? `<span class="chip ok">${I.check}Yes</span>` : `<span class="chip warn">No</span>`}</td>
          <td>${r.subs_valid ? `<span class="chip ok">${esc(r.subs_plan === "Full year" ? "Full year" : r.subs_term)}</span>` : `<span class="chip ${r.subs_plan === "Unpaid" ? "warn" : "bad"}" title="${esc(r.subs_plan)} ${esc(r.subs_term)} ${esc(r.subs_year)}">${r.subs_plan === "Unpaid" ? "Unpaid" : "Expired"}</span>`}</td>
          <td>${r.cox_status ? `<span class="chip violet">${esc(r.cox_status)}</span>` : ""}</td>
          <td>${r.water_ok && r.land_ok ? `<span class="chip ok">${I.check}Yes</span>` : `<span class="chip bad" title="${esc([...r.water_reasons.map((x) => "Water: " + x), ...r.land_reasons.map((x) => "Land: " + x)].join("\n"))}">${!r.water_ok && !r.land_ok ? "No" : r.water_ok ? "Water only" : "Land only"}</span>`}</td>`
          : `<td>${r.cox_status ? `<span class="chip violet">${esc(r.cox_status)}</span>` : ""}</td>`}
        <td class="num">${r.water}</td><td class="num">${r.land}</td><td class="num"><b>${r.total}</b></td>
        <td><div class="bar"><i style="width:${(r.total / max) * 100}%"></i></div></td>
        <td class="num">${r.novice_free_left ?? ""}</td></tr>`).join("") || `<tr><td colspan="12" class="faint" style="text-align:center;padding:30px">No one matches.</td></tr>`}</tbody></table>`;
    $$("#rw-table th.sort").forEach((t) => t.onclick = () => { rowerSort = { k: t.dataset.k, dir: rowerSort.k === t.dataset.k ? -rowerSort.dir : (t.dataset.k === "name" || t.dataset.k === "category" ? 1 : -1) }; draw(); });
    if (admin) $$("#rw-table tr[data-id]").forEach((tr) => tr.onclick = () => editMember(rows.find((r) => r.id === +tr.dataset.id), meta));
    $("#rw-count").textContent = `${list.length} shown`;
  };
  const novices = rows.filter((r) => r.category === "Novice" && r.active !== false).length;
  const issues = admin ? rows.filter((r) => r.active && (!r.water_ok || !r.land_ok)).length : 0;
  const allOut = rows.reduce((a, r) => a + r.total, 0);
  $("#main").innerHTML = `
    <div class="page-head"><div><h1>${admin ? "Members" : "Rowers"}</h1><p>${admin ? "Manage the squad, subs and swim tests. Outing counts update automatically from the schedule." : "Outing counts across the squad."}</p></div>
      ${admin ? `<div class="toolbar">${rowersTabs("members", nRem)}<button class="btn" id="rw-export">${I.download}Export CSV</button><button class="btn primary" id="rw-add">${I.plus}Add member</button></div>` : ""}</div>
    <div class="stats" style="margin-bottom:16px">
      <div class="card stat"><div class="k">Members</div><div class="v">${rows.filter((r) => r.active !== false).length}</div><div class="s">${novices} novice · ${rows.filter((r) => r.active !== false).length - novices} senior</div></div>
      <div class="card stat"><div class="k">Coxes</div><div class="v">${rows.filter((r) => r.cox_status && r.active !== false).length}</div><div class="s">with a cox status</div></div>
      <div class="card stat"><div class="k">Outings logged</div><div class="v">${allOut}</div><div class="s">seat-sessions, all time</div></div>
      ${admin ? `<div class="card stat"><div class="k">Can't row next outing</div><div class="v" style="color:${issues ? "var(--bad)" : "var(--ok)"}">${issues}</div><div class="s">subs or swim test missing</div></div>` : ""}
    </div>
    <div class="filters">
      <input class="input" id="rw-q" placeholder="Search names…" style="max-width:260px" value="${esc(rowerQ)}">
      <div class="seg" id="rw-cat">${[["all", "All"], ["Novice", "Novice"], ["Senior", "Senior"], ...(admin ? [["issues", "Can't row"], ["inactive", "Inactive"]] : [])].map(([k, l]) => `<button data-c="${k}" class="${rowerCat === k ? "on" : ""}">${l}</button>`).join("")}</div>
      <span class="faint small" id="rw-count" style="margin-left:auto"></span>
    </div>
    <div class="card table-wrap" id="rw-table"></div>`;
  $("#rw-q").oninput = (e) => { rowerQ = e.target.value.trim().toLowerCase(); draw(); };
  $$("#rw-cat button").forEach((b) => b.onclick = () => { rowerCat = b.dataset.c; $$("#rw-cat button").forEach((x) => x.classList.toggle("on", x === b)); draw(); });
  if (admin) wireRowersTabs();
  if (admin) { $("#rw-add").onclick = () => editMember(null, meta); $("#rw-export").onclick = () => exportModal("/api/admin/members.csv", "all members"); }
  draw();
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
        <label class="field"><span>Phone <span class="faint">(admins only · encrypted)</span></span>
          <div style="display:flex;gap:6px"><input class="input tnum" id="me-phone" type="tel" placeholder="${m && m.has_phone ? esc(m.phone_masked) : "Not on file"}">
          ${m && m.has_phone ? `<button type="button" class="btn sm" id="me-phone-show" title="Show the full number">Show</button><button type="button" class="btn sm danger" id="me-phone-del" title="Delete this number">Delete</button>` : ""}</div></label>
        <label class="field"><span>College</span><input class="input" id="me-college" list="me-colleges" value="${esc(v.college || "")}"><datalist id="me-colleges"><option value="Reuben"><option value="Blackfriars"><option value="St Stephen's House"></datalist></label>
        <label class="field"><span>Side preference</span><select class="input" id="me-side">${["", ...Object.keys(SIDE_SHORT)].map((x) => `<option value="${esc(x)}" ${(v.side || "") === x ? "selected" : ""}>${x || "—"}</option>`).join("")}</select></label>
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
      <div class="grid-3">
        <label class="field"><span>Earlier water outings</span><input class="input" type="number" min="0" id="me-pw" value="${v.past_water}"><span class="hint">Before using this app</span></label>
        <label class="field"><span>Earlier land sessions</span><input class="input" type="number" min="0" id="me-pl" value="${v.past_land}"></label>
        <div class="field"><span>&nbsp;</span><label class="check"><input type="checkbox" id="me-active" ${v.active ? "checked" : ""}> Active member</label></div>
      </div>
      <label class="field"><span>Admin notes</span><textarea class="input" id="me-notes" rows="2">${esc(v.notes)}</textarea></label>
      ${m && m.needs_review ? `<div class="callout warn">${I.alert}<div>Added through the sign-up form. Check category, cox status, swim test and subs, then save to mark as reviewed.</div></div>` : ""}
      ${m ? `<div class="callout">${I.info}<div>Totals: <b>${m.water}</b> water · <b>${m.land}</b> land (${m.upcoming} upcoming)${m.novice_free_left != null ? ` · <b>${m.novice_free_left}</b> free novice outings left` : ""}</div></div>` : ""}`,
    foot: `${m ? `<button class="btn danger" id="me-del">Delete</button>` : ""}<div class="r"><button class="btn" data-close>Cancel</button><button class="btn primary" id="me-save">Save</button></div>`,
    onMount: (el, close) => {
      const sync = () => { const p = $("#me-plan", el).value; $("#me-term-f", el).classList.toggle("hidden", p !== "Single term"); $("#me-year-f", el).classList.toggle("hidden", p === "Unpaid"); };
      $("#me-plan", el).onchange = sync; sync();
      // Phone: only sent when changed (null = keep the stored, encrypted number).
      let phoneTouched = false;
      const ph = $("#me-phone", el);
      ph.oninput = () => { phoneTouched = true; };
      const show = $("#me-phone-show", el), delp = $("#me-phone-del", el);
      if (show) show.onclick = async () => { try { ph.value = (await api(`/api/admin/members/${m.id}/phone`)).phone; phoneTouched = false; } catch (e) { fail(e); } };
      if (delp) delp.onclick = () => { ph.value = ""; ph.placeholder = "Will be deleted when you save"; phoneTouched = true; };
      $("#me-save", el).onclick = async () => {
        const body = { name: $("#me-name", el).value.trim(), category: $("#me-cat", el).value, subs_plan: $("#me-plan", el).value,
          subs_term: $("#me-plan", el).value === "Single term" ? $("#me-term", el).value : "", subs_year: $("#me-plan", el).value === "Unpaid" ? "" : $("#me-year", el).value.trim(),
          cox_status: $("#me-cox", el).value, swim_test: $("#me-swim", el).checked, past_water: +$("#me-pw", el).value || 0, past_land: +$("#me-pl", el).value || 0,
          active: $("#me-active", el).checked, notes: $("#me-notes", el).value,
          phone: phoneTouched ? $("#me-phone", el).value.trim() : (m ? null : ($("#me-phone", el).value.trim() || null)), college: $("#me-college", el).value.trim(), side: $("#me-side", el).value };
        if (!body.name) return toast("Name is required", true);
        try { await api(m ? `/api/admin/members/${m.id}` : "/api/admin/members", { method: m ? "PUT" : "POST", body }); close(); toast("Saved"); await reboot(); pageRowers(); }
        catch (e) { fail(e); }
      };
      const d = $("#me-del", el);
      if (d) d.onclick = async () => {
        if (!await confirmBox(`Delete ${esc(m.name)}?`, "They'll be removed from every session they're in. To keep their history, untick “Active member” instead.", "Delete", true)) return;
        try { await api(`/api/admin/members/${m.id}`, { method: "DELETE" }); toast("Member deleted"); await reboot(); pageRowers(); } catch (e) { fail(e); }
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
        try { await api("/api/admin/subs-reminders/template", { method: "PUT", body: { template: ta.value } }); close(); toast("Reminder message saved"); pageSubsReminders(); } catch (e) { fail(e); }
      };
    },
  });
}

async function pageSubsReminders() {
  let d;
  try { d = await api("/api/admin/subs-reminders"); } catch (e) { return fail(e); }
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
    <div class="page-head"><div><h1>Subs reminders</h1><p>Unpaid members to contact for ${esc(d.term)} ${esc(d.year)}, most urgent first. Outings already scheduled are counted.${d.cutoff ? ` Subs cutoff: <b>${fmtLong(d.cutoff)}</b>.` : ""}</p></div>
      <div class="toolbar">${rowersTabs("subs", d.members.length)}</div></div>
    <div class="filters">
      <label class="check small"><input type="checkbox" id="rem-hide" ${hideReminded ? "checked" : ""}> Hide people already reminded</label>
      <div class="toolbar" style="margin-left:auto"><button class="btn sm" id="rem-tpl">Edit message</button>${list.length ? `<button class="btn sm" id="rem-names">${I.copy}Copy all names</button>` : ""}</div>
    </div>
    ${groups.length ? groups.map(([t, l]) => `<div class="section-title rem-h ${REM_TIERS[t].cls}">${REM_TIERS[t].title} <span class="faint">· ${l.length} ${l.length === 1 ? "person" : "people"}</span></div>
      <p class="muted small" style="margin:-6px 0 10px">${REM_TIERS[t].hint}</p><div class="rem-list">${l.map(row).join("")}</div>`).join("")
      : `<div class="card empty">${I.check}<h3>No one to remind</h3><p>${hideReminded && d.members.length ? "Everyone on the list has already been reminded." : "Every active member who needs subs has paid, or still has free novice outings left."}</p></div>`}`;
  wireRowersTabs(); wireReveal($("#main"));
  const byId = (id) => d.members.find((x) => x.id === +id);
  const markReminded = async (id, on = true) => { try { await api(`/api/admin/members/${id}/reminded`, { method: "POST", body: { reminded: on } }); } catch (e) { fail(e); } };
  const copy = async (text) => { try { await navigator.clipboard.writeText(text); return true; } catch { const t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select(); const ok = document.execCommand("copy"); t.remove(); return ok; } };
  $("#rem-tpl").onclick = () => editReminderTemplate(d);
  $("#rem-hide").onchange = (e) => { S.remHide = e.target.checked; pageSubsReminders(); };
  const nm = $("#rem-names"); if (nm) nm.onclick = async () => { await copy(list.map((x) => x.name).join("\n")); toast(`Copied ${list.length} name${list.length === 1 ? "" : "s"}`); };
  $$("[data-copy]").forEach((b) => b.onclick = async () => { const x = byId(b.dataset.copy); await copy(remMessage(x, d)); await markReminded(x.id); toast(`Message for ${x.name.split(" ")[0]} copied · marked as reminded`); pageSubsReminders(); });
  $$("[data-text]").forEach((b) => b.onclick = async () => {
    const x = byId(b.dataset.text);
    try {
      const { phone } = await api(`/api/admin/members/${x.id}/phone`);
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
        try { await api(`/api/admin/members/${x.id}/paid`, { method: "POST", body: { plan: p.dataset.plan } }); close(); toast(`${x.name}: ${p.dataset.plan} recorded`); pageSubsReminders(); } catch (e) { fail(e); }
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
  try { data = await api("/api/admin/boats"); } catch (e) { return fail(e); }
  const admin = isAdmin();
  const avail = data.boats.filter((b) => b.status === "available").length;
  $("#main").innerHTML = `
    <div class="page-head"><div><h1>Boat park</h1><p>${data.boats.length} boats · ${avail} available${data.boats.length - avail ? ` · ${data.boats.length - avail} out of service` : ""}</p></div>
      ${admin ? `<div class="toolbar"><button class="btn primary" id="bt-add">${I.plus}Add boat</button></div>` : ""}</div>
    ${data.boats.length ? `<div class="boats">${data.boats.map((b) => `
      <article class="card boat ${b.status} ${admin ? "clickable" : ""}" data-id="${b.id}">
        <div class="boat-head"><div><div class="boat-name">${esc(b.name)}</div><div class="muted small">${esc(b.boat_type)} · ${b.seats} seat${b.seats > 1 ? "s" : ""}${b.coxed ? " + cox" : ""}</div></div>
          <span class="chip ${b.status === "available" ? "ok" : b.status === "repair" ? "warn" : ""}">${b.status === "available" ? "Available" : b.status === "repair" ? "Under repair" : "Retired"}</span></div>
        ${boatSvg(b.seats, b.coxed)}
        <div class="o-sub">${b.rigging ? `<span>${esc(b.rigging)}</span>` : ""}<span>${b.outings} outing${b.outings === 1 ? "" : "s"}</span>${b.next_outing ? `<span>Next: ${fmtShort(b.next_outing)}</span>` : ""}</div>
        ${b.notes ? `<div class="small muted">${esc(b.notes)}</div>` : ""}
      </article>`).join("")}</div>`
      : `<div class="card empty">${I.boat}<h3>No boats yet</h3><p>${admin ? "Add the club's fleet so outings can be assigned to specific boats." : "An admin hasn't added the fleet yet."}</p>${admin ? `<button class="btn primary" id="bt-add2">${I.plus}Add first boat</button>` : ""}</div>`}`;
  if (admin) {
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
        try { await api(b ? `/api/admin/boats/${b.id}` : "/api/admin/boats", { method: b ? "PUT" : "POST", body }); close(); toast("Boat saved"); pageBoats(); } catch (e) { fail(e); }
      };
      const d = $("#b-del", m);
      if (d) d.onclick = async () => {
        if (!await confirmBox(`Delete ${esc(b.name)}?`, "Sessions using this boat keep their crews but lose the boat. Mark it “Retired” instead to keep history.", "Delete", true)) return;
        try { await api(`/api/admin/boats/${b.id}`, { method: "DELETE" }); toast("Boat deleted"); pageBoats(); } catch (e) { fail(e); }
      };
    },
  });
}

// ---------------------------------------------------------------- coaches --
async function pageCoaches() {
  let coaches, stats;
  try { [coaches, stats] = await Promise.all([api("/api/admin/coaches"), api("/api/admin/coaching-stats")]); } catch (e) { return fail(e); }
  const mlabel = (m) => { const [y, mo] = m.split("-").map(Number); return `${MON[mo - 1]} ${String(y).slice(2)}`; };
  $("#main").innerHTML = `
    <div class="page-head"><div><h1>Coaches</h1><p>Sessions per coach per month, counted from the Coach / bankrider field on every session.</p></div>
      <div class="toolbar"><button class="btn primary" id="c-add">${I.plus}Add coach</button></div></div>
    <div class="card table-wrap"><table class="t"><thead><tr><th>Coach</th>${stats.months.map((m) => `<th class="num">${mlabel(m)}</th>`).join("")}<th class="num">Total</th></tr></thead>
      <tbody>${stats.rows.map((r) => { const c = coaches.find((x) => x.name === r.name); return `<tr class="clickable" data-id="${c?.id}"><td><b>${esc(r.name)}</b>${c?.search_text ? ` <span class="faint small">matches “${esc(c.search_text)}”</span>` : ""}</td>${stats.months.map((m) => `<td class="num ${r.months[m] ? "" : "faint"}">${r.months[m] || "·"}</td>`).join("")}<td class="num"><b>${r.total}</b></td></tr>`; }).join("") || `<tr><td colspan="14" class="faint" style="text-align:center;padding:30px">No coaches yet.</td></tr>`}</tbody></table></div>
    ${stats.uncounted.length ? `<div class="section-title">Not matched to a coach</div><div class="callout warn">${I.alert}<div>These coach entries don't match anyone above, so they aren't counted: ${stats.uncounted.map((u) => `<b>${esc(u.coach)}</b> (${u.n})`).join(", ")}. Add the coach, or set “Text to find” for short names.</div></div>` : ""}`;
  const edit = (c) => modal({
    title: c ? "Edit coach" : "Add coach",
    body: `<label class="field"><span>Name</span><input class="input" id="c-name" value="${esc(c?.name || "")}"></label>
      <label class="field"><span>Text to find (optional)</span><input class="input" id="c-st" value="${esc(c?.search_text || "")}" placeholder="e.g. Maddie"><span class="hint">Use a short name that appears in entries like “Maddie or Henry”. Defaults to the full name.</span></label>`,
    foot: `${c ? `<button class="btn danger" id="c-del">Delete</button>` : ""}<div class="r"><button class="btn" data-close>Cancel</button><button class="btn primary" id="c-save">Save</button></div>`,
    onMount: (m, close) => {
      $("#c-save", m).onclick = async () => {
        const body = { name: $("#c-name", m).value.trim(), search_text: $("#c-st", m).value.trim() };
        if (!body.name) return toast("Name is required", true);
        try { await api(c ? `/api/admin/coaches/${c.id}` : "/api/admin/coaches", { method: c ? "PUT" : "POST", body }); close(); pageCoaches(); } catch (e) { fail(e); }
      };
      const d = $("#c-del", m); if (d) d.onclick = async () => { await api(`/api/admin/coaches/${c.id}`, { method: "DELETE" }).catch(fail); close(); pageCoaches(); };
    },
  });
  $("#c-add").onclick = () => edit(null);
  $$("tr[data-id]").forEach((tr) => tr.onclick = () => edit(coaches.find((c) => c.id === +tr.dataset.id)));
}

// --------------------------------------------------------------- settings --
async function pageSettings() {
  let s;
  try { s = await api("/api/admin/settings"); } catch (e) { return fail(e); }
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
          <h3 style="margin:0">Import from spreadsheet</h3>
          <p class="muted small" style="margin:0">Upload the club's <b>Rowing_Outings.xlsx</b> to import members (swim tests, subs, category, cox status, past outing counts), coaches and term settings. Existing members are matched by name and updated.</p>
          <input type="file" id="s-file" accept=".xlsx" class="input">
          <label class="check small"><input type="checkbox" id="s-sched"> Also import that sheet's weekly schedule as sessions</label>
          <div><button class="btn" id="s-import">${I.upload}Import</button></div>
          <div id="s-import-res"></div>
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
          <div class="toolbar"><a class="btn" href="/api/admin/backup">${I.download}Download database backup</a><button class="btn" id="s-csv">${I.download}Members CSV</button></div>
          <p class="muted small" style="margin:0">Phone numbers in the backup stay encrypted. They can only be read with this server's <code>PHONE_KEY</code>.</p>
        </div>
      </div>
    </div>`;
  const phoneFields = () => ({ phone_mode: $("#s-phone-mode").value, phone_retention_days: Math.max(0, Math.min(3650, +$("#s-phone-days").value || 0)) });
  $("#s-csv").onclick = () => exportModal("/api/admin/members.csv", "all members");
  const drawFlag = (f) => { $("#s-river-flag").innerHTML = `<span class="flag-dot" style="background:${esc(f.colour)}"></span> Isis: <b>${esc(f.name)}</b> · checked ${esc(fmtStamp(f.checked_at) || "never")}${f.error ? ` · <span style="color:var(--bad)">last check failed: ${esc(f.error)}</span>` : ""}`; };
  api("/api/river").then((rv) => {
    drawFlag(rv.flag);
    $("#s-term-start").value = rv.settings.term_start || ""; $("#s-peak-end").value = rv.settings.peak_end || ""; $("#s-peak8").value = rv.settings.peak_crews_before_8 || 1;
  }).catch(() => {});
  $("#s-river-save").onclick = async () => {
    const body = { term_start: $("#s-term-start").value, peak_end: $("#s-peak-end").value, peak_crews_before_8: Math.max(1, Math.min(5, +$("#s-peak8").value || 1)) };
    try { await api("/api/admin/river-settings", { method: "PUT", body }); toast("River settings saved"); } catch (e) { fail(e); }
  };
  $("#s-river-refresh").onclick = async () => { try { drawFlag(await api("/api/admin/river/refresh", { method: "POST" })); toast("Flag checked"); } catch (e) { fail(e); } };
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
    try { await api("/api/admin/settings", { method: "PUT", body }); toast("Phone settings saved"); pageSettings(); } catch (e) { fail(e); }
  };
  $("#s-save").onclick = async () => {
    const body = { club_name: $("#s-club").value.trim() || "Reuben Boat Club", academic_year: $("#s-ay").value.trim(), current_term: $("#s-term").value, subs_cutoff: $("#s-cut").value,
      novice_free_outings: +$("#s-free").value || 0, novice_land_free: $("#s-land").checked, season_start: $("#s-season").value, today_override: $("#s-today").value, swim_test_after: Math.max(0, +$("#s-swim").value || 0), ...phoneFields() };
    try { await api("/api/admin/settings", { method: "PUT", body }); toast("Settings saved"); await reboot(); shell("settings"); pageSettings(); } catch (e) { fail(e); }
  };
  $("#s-mpw-save").onclick = async () => {
    const pw = $("#s-mpw").value;
    if (!pw) return toast("Type a password first", true);
    const body = { club_name: s.club_name, academic_year: s.academic_year, current_term: s.current_term, subs_cutoff: s.subs_cutoff, novice_free_outings: s.novice_free_outings,
      novice_land_free: s.novice_land_free, season_start: s.season_start, today_override: s.today_override, member_password: pw, ...phoneFields() };
    try { await api("/api/admin/settings", { method: "PUT", body }); toast("Rower password updated"); pageSettings(); } catch (e) { fail(e); }
  };
  const r = $("#s-mpw-reset"); if (r) r.onclick = async () => { await api("/api/admin/settings/reset-member-password", { method: "POST" }).catch(fail); toast("Using server password"); pageSettings(); };
  $("#s-import").onclick = async () => {
    const f = $("#s-file").files[0];
    if (!f) return toast("Choose a file first", true);
    const fd = new FormData(); fd.append("file", f); fd.append("include_schedule", $("#s-sched").checked ? "true" : "false");
    try {
      const res = await api("/api/admin/import", { method: "POST", body: fd });
      $("#s-import-res").innerHTML = `<div class="callout">${I.check}<div>Imported: <b>${res.members_added}</b> new members, <b>${res.members_updated}</b> updated, <b>${res.coaches}</b> coaches${res.outings ? `, <b>${res.outings}</b> sessions` : ""}.</div></div>`;
      await reboot();
    } catch (e) { fail(e); }
  };
}

// ---------------------------------------------------------------- sign-up --
const SLOT_ICON = { water: () => I.water, erg: () => I.land, tank: () => I.land };
const slotChip = (k) => `<span class="chip ${k === "water" ? "water" : k === "erg" ? "land" : "ok"}">${({ water: "Water", erg: "Erg", tank: "Tank" })[k] || k}</span>`;

async function pageSignup() {
  if (isAdmin() && !(location.hash.includes("form=1"))) return pageSignupAdmin();
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
    role: "", want_row: 2, want_cox: 1, side: "", max_outings: 3, can_bankride: false, slot_ids: new Set(), comments: "", existing: false };

  const prefill = async () => {
    if (!st.member_id) return;
    try {
      const p = await api(`/api/signup/${wk.week_start}/member/${st.member_id}`);
      st.has_phone = p.has_phone; st.existing = p.existing;
      if (p.college) { if (meta.colleges.includes(p.college)) st.college = p.college; else { st.college = "Other"; st.college_other = p.college; } }
      st.side = p.side || st.side; st.role = p.role || st.role;
      if (p.want_row != null) st.want_row = p.want_row || st.want_row;
      if (p.want_cox != null) st.want_cox = p.want_cox || st.want_cox;
      if (p.max_outings) st.max_outings = p.max_outings;
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
    ${isAdmin() ? `<div class="callout warn" style="margin-bottom:16px">${I.info}<div>You're filling in the form as an admin (e.g. on someone's behalf). <a href="#/signup">Back to sign-up management</a></div></div>` : ""}
    <form id="su-form" class="su-form" novalidate>
      <section class="card card-pad su-sec"><div class="su-num">1</div><div class="su-body">
        <h3>About you</h3>
        <label class="field"><span>Your name</span><div id="su-name"></div><span class="hint">Pick your name, or type it in full if you're new to the club.</span></label>
        <div class="grid-2">
          ${meta.phone_mode === "off" ? "" : `<label class="field"><span>Phone number${meta.phone_mode === "optional" ? ` <span class="faint">(optional)</span>` : ""}</span><input class="input" id="su-phone" type="tel" autocomplete="tel" placeholder="${st.has_phone ? "We have your number. Leave blank to keep it" : "e.g. 07700 900123"}" value="${esc(st.phone)}">
            <span class="hint">🔒 Only club admins can see it. Stored encrypted${meta.phone_retention_days ? ` and deleted after ${meta.phone_retention_days >= 60 ? Math.round(meta.phone_retention_days / 30) + " months" : meta.phone_retention_days + " days"} without a sign-up` : ""}.</span></label>`}
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
          ${rows ? stepper("su-wr", st.want_row, "Rowing outings wanted") : ""}
          ${coxes ? stepper("su-wc", st.want_cox, "Coxing outings wanted") : ""}
          ${st.role !== "bankrider" ? stepper("su-max", st.max_outings, "Max outings this week", "Including erg and tank sessions") : ""}
        </div>
        ${rows ? `<div class="field"><span>Side preference</span>${pills("side", meta.sides.map((x) => [x, x]), st.side)}</div>` : ""}
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
    if (v("#su-max") != null) st.max_outings = +v("#su-max") || 0;
    if (v("#su-comments") != null) st.comments = v("#su-comments");
  };
  const submit = async (e) => {
    e.preventDefault(); capture();
    if (!st.member_id && !st.new_name.trim()) return toast("Pick or type your name first", true);
    if (!st.college) return toast("Pick your college", true);
    if (st.college === "Other" && !st.college_other.trim()) return toast("Type the name of your college", true);
    if (!st.role) return toast("Choose what you're signing up as", true);
    const body = { week_start: wk.week_start, member_id: st.member_id, new_name: st.member_id ? "" : st.new_name, phone: st.phone,
      college: st.college === "Other" ? st.college_other.trim() : st.college, role: st.role, want_row: st.want_row, want_cox: st.want_cox,
      side: st.side, max_outings: st.role === "bankrider" ? 0 : st.max_outings, can_bankride: st.role === "bankrider" || st.can_bankride,
      slot_ids: [...st.slot_ids], comments: st.comments };
    const btn = $("#su-go"); btn.disabled = true;
    try {
      const r = await api("/api/signup", { method: "POST", body });
      if (!isAdmin()) setMe(r.member_id);
      if (r.created) await reboot();
      const slots = wk.slots.filter((x) => st.slot_ids.has(x.id));
      main.innerHTML = `<div class="card su-done"><div class="su-done-icon">${I.check}</div>
        <h2>${r.updated ? "Sign-up updated" : "You're signed up"}${isAdmin() ? "" : `, ${esc(r.member_name.split(" ")[0])}`}!</h2>
        <p class="muted">${isAdmin() ? `Saved for ${esc(r.member_name)}.` : "The crews will appear on the schedule once they're published."}${r.created ? " Your name has been added to the club list." : ""}</p>
        ${slots.length ? `<div class="su-done-list">${slots.map((x) => `<div><b>${DAY[dow(x.date)]} ${fmtShort(x.date)}</b> <span class="tnum">${esc(tRange(x))}</span> ${slotChip(x.kind)}</div>`).join("")}</div>` : ""}
        <div class="toolbar" style="justify-content:center"><button class="btn" id="su-edit">Edit my answers</button><a class="btn primary" href="#/schedule">Go to schedule</a></div></div>`;
      $("#su-edit").onclick = () => { st.member_id = r.member_id; st.new_name = ""; pageSignup(); };
      window.scrollTo(0, 0);
    } catch (err) { fail(err); btn.disabled = false; }
  };
  draw();
}

/* Name field: pick an existing member, or type a new full name. */
function nameField(container, st, onPick) {
  container.classList.add("combo");
  container.innerHTML = `<input class="input" autocomplete="off" placeholder="Start typing your name…"><button type="button" class="clear" tabindex="-1" aria-label="Clear">×</button>`;
  const inp = $("input", container), clr = $(".clear", container);
  let list = null, hl = 0, shown = [];
  const members = () => S.boot.members;
  const cur = () => st.member_id ? members().find((m) => m.id === st.member_id)?.name || "" : st.new_name;
  const sync = () => { inp.value = cur(); clr.style.display = inp.value ? "" : "none"; };
  const close = () => { list?.remove(); list = null; };
  const draw = () => {
    const q = inp.value.trim().toLowerCase();
    const matches = members().filter((m) => !q || m.name.toLowerCase().includes(q)).slice(0, 8);
    const exact = members().some((m) => m.name.toLowerCase() === q);
    shown = matches.map((m) => ({ id: m.id, label: m.name }));
    if (q.length >= 3 && !exact) shown.push({ id: null, label: inp.value.trim().replace(/\s+/g, " "), isNew: true });
    hl = Math.min(hl, Math.max(0, shown.length - 1));
    if (!list) { list = document.createElement("div"); list.className = "combo-list"; container.appendChild(list); }
    list.innerHTML = shown.length ? shown.map((i, k) => `<div class="combo-item ${k === hl ? "hl" : ""}" data-k="${k}">${i.isNew ? `<span class="nm"><b>I'm new:</b> “${esc(i.label)}”</span><span class="why"><span class="chip accent">${I.plus}Add me</span></span>` : `<span class="nm">${esc(i.label)}</span>`}</div>`).join("")
      : `<div class="combo-empty">Keep typing your full name…</div>`;
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
    if (v && v !== cur()) { const m = members().find((x) => x.name.toLowerCase() === v.toLowerCase()); if (m) return pick({ id: m.id }); st.member_id = null; st.new_name = v; }
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

// ---- admin: manage sessions & responses ----
async function pageSignupAdmin() {
  if (!S.suWeek) S.suWeek = addDays(S.boot.this_week, 7);
  if (!S.suTab) S.suTab = "responses";
  let d;
  try { d = await api(`/api/admin/signup/${S.suWeek}`); } catch (e) { return fail(e); }
  const ws = d.week.week_start, main = $("#main");
  const R = d.responses;
  const nRow = R.filter((r) => ["rower", "both"].includes(r.role)).length, nCox = R.filter((r) => ["cox", "both"].includes(r.role)).length;
  const nBank = R.filter((r) => r.can_bankride).length, nNew = R.filter((r) => r.needs_review).length;
  const roleShort = { rower: "Rower", cox: "Cox", both: "Row + cox", bankrider: "Bankrider" };
  main.innerHTML = `
    <div class="page-head"><div><h1>Sign-ups</h1><p>Week of ${fmtLong(ws)} – ${fmtShort(addDays(ws, 6))} ·
        ${d.week.open ? `<span class="status-pill" style="background:var(--ok-soft);color:var(--ok)"><span class="dot"></span>Open to rowers</span>` : `<span class="status-pill" style="background:var(--surface-3);color:var(--text-2)"><span class="dot"></span>Closed</span>`}</p></div>
      <div class="toolbar">
        <div class="weekbar"><button class="btn icon" id="sw-prev">${I.left}</button><button class="btn icon" id="sw-next">${I.right}</button></div>
        <a class="btn" href="#/signup?form=1">${I.eye}Open form</a>
        ${d.week.open ? `<button class="btn" id="sw-toggle">Close sign-ups</button>` : `<button class="btn primary" id="sw-toggle">${I.send}Open sign-ups</button>`}
      </div></div>
    ${!d.week.open && !d.slots.length ? `<div class="callout warn" style="margin-bottom:16px">${I.info}<div><b>Next step:</b> add this week's water, erg and tank sessions so rowers can tick when they're free, then open sign-ups. <a href="#" id="sw-go-sessions">Add sessions</a> or <a href="#" id="sw-copy-top">copy last week's</a>.</div></div>` : ""}
    <div class="stats" style="margin-bottom:16px">
      <div class="card stat"><div class="k">Responses</div><div class="v">${R.length}</div><div class="s">${nNew ? `${nNew} new name${nNew === 1 ? "" : "s"} to review` : "for this week"}</div></div>
      <div class="card stat"><div class="k">Rowers</div><div class="v">${nRow}</div><div class="s">${R.reduce((a, r) => a + (r.want_row || 0), 0)} outings wanted</div></div>
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
        <div class="slot-admin">${list.map((sl) => `<div class="card slot-row" data-id="${sl.id}">
          <div class="slot-time tnum">${esc(tRange(sl) || "TBC")}</div>${slotChip(sl.kind)}
          <div class="slot-meta" style="flex:1">${esc([sl.location, sl.note].filter(Boolean).join(" · "))}</div>
          <div class="slot-counts"><span title="Free in total"><b>${sl.count}</b> free</span><span title="Rowers">${sl.rowers} row</span><span title="Coxes">${sl.coxes} cox</span><span title="Can bankride">${sl.bankriders} BR</span></div>
          <button class="btn sm" data-mk="${sl.id}">${I.plus}Create session</button>
          <button class="btn sm ghost" data-ed="${sl.id}">Edit</button></div>`).join("")}</div>`).join("")
        : `<div class="card empty">${I.calendar}<h3>No sessions listed</h3><p>Add the water, erg and tank sessions people can sign up for, or copy last week's.</p></div>`}`;
    $("#sw-note-save").onclick = async () => { await api(`/api/admin/signup/${ws}`, { method: "PUT", body: { open: d.week.open, note: $("#sw-note").value } }).catch(fail); toast("Message saved"); };
    $$("[data-ed]").forEach((b) => b.onclick = () => editSlot(d.slots.find((x) => x.id === +b.dataset.ed), ws));
    $$("[data-mk]").forEach((b) => b.onclick = () => {
      const sl = d.slots.find((x) => x.id === +b.dataset.mk);
      S.week = ws; S.pendingNew = { kind: sl.kind === "water" ? "water" : "land", date: sl.date, time: sl.time, end_time: sl.end_time, location: sl.location, title: sl.kind === "water" ? "" : (sl.kind === "erg" ? "Erg" : "Tank") };
      location.hash = "#/schedule";
    });
    $("#sw-add").onclick = () => editSlot(null, ws);
    $("#sw-copy").onclick = async () => {
      try { const r = await api(`/api/admin/signup/${ws}/copy-slots`, { method: "POST", body: { source: addDays(ws, -7) } }); toast(`Copied ${r.copied} session${r.copied === 1 ? "" : "s"}`); pageSignupAdmin(); } catch (e) { fail(e); }
    };
  } else if (S.suTab === "grid") {
    body.innerHTML = !R.length || !d.slots.length ? `<div class="card empty">${I.user}<h3>Nothing to show yet</h3><p>Responses will appear here as people sign up.</p></div>` :
      `<div class="card table-wrap"><table class="t grid-t"><thead><tr><th>Name</th>${d.slots.map((sl) => `<th class="gc" title="${esc([sl.location, sl.note].filter(Boolean).join(" · "))}"><div>${slotLabel(sl)}</div><div>${slotChip(sl.kind)}</div></th>`).join("")}</tr></thead>
      <tbody>${R.slice().sort((a, b) => a.name.localeCompare(b.name)).map((r) => `<tr><td><b>${esc(r.name)}</b> <span class="faint small">${roleShort[r.role]}</span></td>${d.slots.map((sl) => `<td class="gc">${r.slot_ids.includes(sl.id) ? `<span class="tick ${sl.kind}">${I.check}</span>` : ""}</td>`).join("")}</tr>`).join("")}
      <tr class="tot"><td>Total free</td>${d.slots.map((sl) => `<td class="gc"><b>${sl.count}</b></td>`).join("")}</tr></tbody></table></div>`;
  } else {
    body.innerHTML = R.length ? `<div class="card table-wrap"><table class="t"><thead><tr><th>Name</th><th>Phone</th><th>College</th><th>As</th><th class="num">Row</th><th class="num">Cox</th><th>Side</th><th class="num">Sched / max</th><th>Bankride</th><th class="num">Free for</th></tr></thead>
      <tbody>${R.map((r) => `<tr class="clickable" data-id="${r.id}">
        <td><b>${esc(r.name)}</b>${r.needs_review ? ` <span class="chip warn" title="Added through the form — check their details in Rowers">New</span>` : ""}${r.comments ? ` <span title="${esc(r.comments)}">💬</span>` : ""}</td>
        <td>${phoneCell(r.member_id, r.phone_masked, r.has_phone)}</td>
        <td>${esc(r.college)}</td><td><span class="chip ${r.role === "bankrider" ? "violet" : r.role === "rower" ? "" : "accent"}">${roleShort[r.role]}</span></td>
        <td class="num">${r.want_row || ""}</td><td class="num">${r.want_cox || ""}</td><td>${r.side ? `<span class="chip">${esc(SIDE_SHORT[r.side] || r.side)}</span>` : ""}</td>
        <td class="num"><span class="${r.max_outings && r.scheduled > r.max_outings ? "chip bad" : ""}">${r.scheduled}${r.max_outings ? ` / ${r.max_outings}` : ""}</span></td>
        <td>${r.can_bankride ? `<span class="chip ok">${I.check}Yes</span>` : `<span class="faint">No</span>`}</td>
        <td class="num">${r.slot_ids.length}</td></tr>`).join("")}</tbody></table></div>`
      : `<div class="card empty">${I.user}<h3>No responses yet</h3><p>${d.week.open ? "The form is open — share the site link with the squad." : "Add sessions, then open sign-ups so rowers can respond."}</p></div>`;
    $$("tr[data-id]", body).forEach((tr) => tr.onclick = () => responseDetail(R.find((x) => x.id === +tr.dataset.id), d, roleShort));
    wireReveal(body);
  }
  $$("#sw-tabs button").forEach((b) => b.onclick = () => { S.suTab = b.dataset.t; pageSignupAdmin(); });
  const swx = $("#sw-export"); if (swx) swx.onclick = () => exportModal(`/api/admin/signup/${ws}/responses.csv`, `sign-ups for the week of ${fmtShort(ws)}`);
  $("#sw-prev").onclick = () => { S.suWeek = addDays(ws, -7); pageSignupAdmin(); };
  $("#sw-next").onclick = () => { S.suWeek = addDays(ws, 7); pageSignupAdmin(); };
  const goSessions = $("#sw-go-sessions");
  if (goSessions) goSessions.onclick = (e) => { e.preventDefault(); S.suTab = "sessions"; pageSignupAdmin().then(() => $("#sw-add")?.click()); };
  const copyTop = $("#sw-copy-top");
  if (copyTop) copyTop.onclick = async (e) => {
    e.preventDefault();
    try { const r = await api(`/api/admin/signup/${ws}/copy-slots`, { method: "POST", body: { source: addDays(ws, -7) } });
      toast(r.copied ? `Copied ${r.copied} session${r.copied === 1 ? "" : "s"}` : "Last week had no sessions to copy", !r.copied); S.suTab = "sessions"; pageSignupAdmin(); } catch (err) { fail(err); }
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
      if (go === "add") { S.suTab = "sessions"; await pageSignupAdmin(); $("#sw-add")?.click(); return; }
      if (go !== "open") return;
    }
    try { await api(`/api/admin/signup/${ws}`, { method: "PUT", body: { open: !d.week.open, note: d.week.note } }); toast(d.week.open ? "Sign-ups closed" : "Sign-ups are open"); pageSignupAdmin(); } catch (e) { fail(e); }
  };
}

function responseDetail(r, d, roleShort) {
  const slots = d.slots.filter((sl) => r.slot_ids.includes(sl.id));
  modal({
    title: esc(r.name),
    body: `<dl class="kv"><dt>Phone</dt><dd>${phoneCell(r.member_id, r.phone_masked, r.has_phone)}${r.has_phone ? ` <button type="button" class="btn sm ghost danger" id="rd-delphone">Delete number</button>` : ""}</dd>
      <dt>College</dt><dd>${esc(r.college)}</dd><dt>Signing up as</dt><dd>${roleShort[r.role]}</dd>
      ${r.want_row ? `<dt>Rowing outings</dt><dd>${r.want_row}</dd>` : ""}${r.want_cox ? `<dt>Coxing outings</dt><dd>${r.want_cox}</dd>` : ""}
      ${r.side ? `<dt>Side</dt><dd>${esc(r.side)}</dd>` : ""}${r.max_outings ? `<dt>Max this week</dt><dd>${r.max_outings} (scheduled: ${r.scheduled})</dd>` : ""}
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
        try { await api(`/api/admin/members/${r.member_id}/phone`, { method: "DELETE" }); toast("Phone number deleted"); pageSignupAdmin(); } catch (e) { fail(e); }
      };
      $("#rd-del", m).onclick = async () => {
        if (!await confirmBox("Delete this response?", `${esc(r.name)}'s sign-up for this week will be removed. Their member record stays.`, "Delete", true)) return;
        try { await api(`/api/admin/signup/responses/${r.id}`, { method: "DELETE" }); toast("Response deleted"); pageSignupAdmin(); } catch (e) { fail(e); }
      };
    },
  });
}

async function editSlot(sl, ws, tpl) {
  await loadPlaces(true);
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  const v = sl || tpl || { date: days[0], time: "", kind: "water", location: "", note: "" };
  modal({
    title: sl ? "Edit session" : "Add session",
    body: `<div class="seg" id="sl-kind">${[["water", "Water"], ["erg", "Erg"], ["tank", "Tank"]].map(([k, l]) => `<button data-k="${k}" class="${v.kind === k ? "on" : ""}">${l}</button>`).join("")}</div>
      <div class="grid-2"><label class="field"><span>Day</span><select class="input" id="sl-date">${days.map((d) => `<option value="${d}" ${d === v.date ? "selected" : ""}>${fmtLong(d)}</option>`).join("")}</select></label>
        <div class="field"><span>Time <span class="faint">(start – end)</span></span><div class="time-range"><input class="input tnum" type="time" id="sl-time" value="${esc(v.time)}" aria-label="Start time"><span class="faint">–</span><input class="input tnum" type="time" id="sl-end" value="${esc(v.end_time || "")}" aria-label="End time (optional)"></div><span class="hint">Use the same time when you create the outing, so availability matches.</span></div></div>
      <div class="grid-2"><label class="field"><span>Where (optional)</span><input class="input" id="sl-loc" list="sl-places" value="${esc(v.location)}" placeholder="e.g. Boathouse, College gym">${placesDatalist("sl-places")}</label>
        <label class="field"><span>Note (optional)</span><input class="input" id="sl-note" value="${esc(v.note)}" placeholder="e.g. Novices only"></label></div>
      ${sl ? "" : `<label class="check small"><input type="checkbox" id="sl-more"> Add another after this one</label>`}`,
    foot: `${sl ? `<button class="btn danger" id="sl-del">Delete</button>` : ""}<div class="r"><button class="btn" data-close>Cancel</button><button class="btn primary" id="sl-save">Save</button></div>`,
    onMount: (m, close) => {
      let kind = v.kind;
      $$("#sl-kind button", m).forEach((b) => b.onclick = () => { kind = b.dataset.k; $$("#sl-kind button", m).forEach((x) => x.classList.toggle("on", x === b)); });
      $("#sl-save", m).onclick = async () => {
        const body = { date: $("#sl-date", m).value, time: $("#sl-time", m).value.trim(), end_time: $("#sl-end", m).value.trim(), kind, location: $("#sl-loc", m).value, note: $("#sl-note", m).value };
        try {
          await api(sl ? `/api/admin/signup/slots/${sl.id}` : "/api/admin/signup/slots", { method: sl ? "PUT" : "POST", body });
          const more = $("#sl-more", m)?.checked; close(); toast("Session saved"); await pageSignupAdmin();
          if (more) editSlot(null, ws, { ...body, time: "", end_time: "" });
        } catch (e) { fail(e); }
      };
      const del = $("#sl-del", m);
      if (del) del.onclick = async () => {
        if (!await confirmBox("Delete this session?", "Anyone who ticked it loses that availability.", "Delete", true)) return;
        try { await api(`/api/admin/signup/slots/${sl.id}`, { method: "DELETE" }); toast("Session deleted"); pageSignupAdmin(); } catch (e) { fail(e); }
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
        try { await api(p ? `/api/admin/places/${p.id}` : "/api/admin/places", { method: p ? "PUT" : "POST", body }); close(); toast("Place saved"); after && after(); } catch (e) { fail(e); }
      };
      const d = $("#pl-del", m);
      if (d) d.onclick = async () => { try { await api(`/api/admin/places/${p.id}`, { method: "DELETE" }); close(); toast("Place deleted"); after && after(); } catch (e) { fail(e); } };
    },
  });
}

// ----------------------------------------------------------------- router --
async function reboot() { S.boot = await api("/api/bootstrap"); S.role = S.boot.role; }

function route() {
  if (!S.role) return renderLogin();
  const id = (location.hash.replace(/^#\/?/, "") || "schedule").split("?")[0];
  const r = ROUTES.find((x) => x.id === id && (!x.admin || isAdmin())) || ROUTES[0];
  shell(r.id);
  ({ schedule: pageSchedule, signup: pageSignup, subs: pageSubs, me: pageMe, stats: pageStats, rowers: pageRowers, boats: pageBoats, coaches: pageCoaches, settings: pageSettings })[r.id]();
  window.scrollTo(0, 0);
}

async function start() {
  try { await reboot(); } catch { return renderLogin(); }
  if (S.me && !meName()) setMe(null);
  refreshSubsCount();
  route();
}

window.addEventListener("hashchange", () => { $("#modal-root").innerHTML = ""; route(); });
(async () => {
  try { const r = await api("/api/me"); S.role = r.role; } catch {}
  S.role ? start() : renderLogin();
})();
