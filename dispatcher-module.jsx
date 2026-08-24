import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Truck, ClipboardList, Plus, Check, X, MapPin, Package, AlertTriangle, Trash2,
  FileText, Printer, User, Clock, Lock, ArrowUp, ArrowDown, Users, Menu,
  MessageSquare, Mail, Copy, Building2, Route, Loader2,
} from "lucide-react";

/* ==================================================================
   Truck Loading — DISPATCHER workspace
   Standalone demo. Own sample data, own storage key.
   ================================================================== */

const KEY = "tl-dispatch-demo:v1";
const DAY = 86400000;
const MIN = 60000;

const uid = () => Math.random().toString(36).slice(2, 9);
const now = () => new Date().toISOString();
const num = (x) => Number(x) || 0;
const usd = (n) => "$" + num(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—");
const dmy = (iso) => (iso ? new Date(iso).toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" }) : "—");
const ago = (min) => new Date(Date.now() - min * MIN).toISOString();

/* a scribble so the paperwork looks like paperwork */
const SIG = "data:image/svg+xml;utf8," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="52"><path d="M8 38 C22 10, 34 46, 46 24 S72 8, 84 32 S106 44, 120 20 S150 12, 168 34" fill="none" stroke="#16202B" stroke-width="2.2" stroke-linecap="round"/></svg>`
);

/* ---------------- stop model ---------------- */

const isPickup = (st) => st.kind === "pickup";
const isDrop = (st) => (st.kind || "drop") === "drop";
const isOpen = (st) => st.status === "wait";

const OUTCOMES = {
  done: { label: "Delivered", tone: "done" },
  attempted: { label: "Couldn't deliver", tone: "exc" },
  refused: { label: "Refused", tone: "exc" },
  cancelled: { label: "Cancelled", tone: "wait" },
  rescheduled: { label: "Rebooked", tone: "wait" },
  moved: { label: "Moved", tone: "wait" },
  wait: { label: "Pending", tone: "wait" },
};

function labelsOf(stops) {
  let p = 0, d = 0;
  const m = {};
  stops.forEach((x) => { m[x.id] = isPickup(x) ? `P${++p}` : `${++d}`; });
  return m;
}
const titleOf = (st, L) => (isPickup(st) ? `Pickup ${L[st.id]}` : `Load ${L[st.id]}`);

/* ---------------- money ---------------- */

const RATES = {
  freeMinPickup: 120, freeMinDrop: 60, detentionRate: 60,
  fuelPct: 18, extraStopRate: 75, attemptRate: 100,
  afterHoursFee: 90, weekendFee: 120,
};
const FREE_STOPS = 2;

function dwell(st) {
  const a = st.arrivedAt, b = st.departedAt || st.deliveredAt;
  if (!a || !b) return 0;
  const m = Math.round((new Date(b) - new Date(a)) / MIN);
  return m > 0 ? m : 0;
}

function detentionOf(trip) {
  const rows = [];
  let billed = 0;
  (trip.stops || []).forEach((st) => {
    if (st.status === "moved") return;
    const d = dwell(st);
    if (!d) return;
    const free = isPickup(st) ? (trip.freeMinPickup ?? RATES.freeMinPickup) : (trip.freeMinDrop ?? RATES.freeMinDrop);
    const over = d - free;
    if (over <= 0) return;
    const blk = Math.ceil(over / 15) * 15;
    billed += blk;
    rows.push({ id: st.id, name: st.name, dwell: d, free, over, blk });
  });
  const rate = trip.detentionRate ?? RATES.detentionRate;
  return { rows, hours: billed / 60, rate, fee: billed / 60 * rate };
}

/* Weekend and after-hours are worked out from the booked date and the first
   pickup window, so nobody has to remember to add the fee. */
function timingOf(trip) {
  const d = trip.date ? new Date(trip.date + "T00:00:00") : null;
  const day = d && !isNaN(d) ? d.getDay() : null;
  const weekend = day === 0 || day === 6;
  const dayName = day !== null ? ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day] : "";

  const first = (trip.stops || []).find(isPickup);
  const hh = parseInt(String(first?.window || "").slice(0, 2), 10);
  const afterHours = !isNaN(hh) && (hh < 6 || hh >= 18);

  const auto = (weekend ? num(trip.weekendFee ?? RATES.weekendFee) : 0)
    + (afterHours ? num(trip.afterHoursFee ?? RATES.afterHoursFee) : 0);
  const fee = trip.timingFeeOverride != null ? num(trip.timingFeeOverride) : auto;

  const why = [
    weekend ? `${dayName} collection` : null,
    afterHours ? `pickup booked ${first?.window} — outside 06:00–18:00` : null,
  ].filter(Boolean).join(" · ");

  return { weekend, afterHours, dayName, auto, fee, why, overridden: trip.timingFeeOverride != null };
}

function billingOf(trip) {
  const stops = trip.stops || [];
  const delivered = stops.filter((x) => isDrop(x) && x.status === "done");
  const collected = stops.filter((x) => isPickup(x) && x.status === "done");
  const attempts = stops.filter((x) => x.status === "attempted" || x.status === "refused");
  const dropped = stops.filter((x) => x.status === "cancelled" || x.status === "rescheduled");
  const moved = stops.filter((x) => x.status === "moved");

  const worked = delivered.length + collected.length + attempts.length;
  const extras = Math.max(0, worked - FREE_STOPS);
  const flat = num(trip.flatRate);
  const extraStops = extras * num(trip.extraStopRate ?? RATES.extraStopRate);
  const attemptFees = attempts.length * num(trip.attemptRate ?? RATES.attemptRate);
  const linehaul = flat + extraStops;
  const det = detentionOf(trip);
  const timing = timingOf(trip);
  const fuelPct = trip.fuelPct ?? RATES.fuelPct;
  const fuel = linehaul * num(fuelPct) / 100;
  const other = num(trip.extraCharges);

  return {
    delivered, collected, attempts, dropped, moved, worked, extras,
    flat, extraStops, attemptFees, linehaul, det, timing, fuelPct, fuel, other,
    gross: linehaul + attemptFees + det.fee + timing.fee + fuel + other,
  };
}

function payOf(trip, driver) {
  const g = billingOf(trip).gross;
  const adj = num(trip.payAdjust);
  if (!driver) return { gross: g, base: 0, pay: adj, basis: "no driver" };
  const r = num(driver.payRate);
  const base = driver.payType === "flat" ? r
    : driver.payType === "per_stop" ? r * billingOf(trip).worked
      : g * r / 100;
  const basis = driver.payType === "flat" ? `${usd(r)} flat`
    : driver.payType === "per_stop" ? `${usd(r)} × ${billingOf(trip).worked} stops`
      : `${r}% of ${usd(g)}`;
  return { gross: g, base, adjust: adj, pay: base + adj, basis };
}

/* ---------------- sample data ---------------- */

function seedState() {
  const drivers = [
    { id: "d1", name: "Harjit Singh", phone: "+1 682 555 0142", payType: "percent", payRate: 25, active: true },
    { id: "d2", name: "Marcus Bell", phone: "+1 682 555 0198", payType: "percent", payRate: 28, active: true },
    { id: "d3", name: "Ana Ruiz", phone: "+1 682 555 0121", payType: "flat", payRate: 240, active: true },
  ];
  const vehicles = [
    { id: "v1", unitNo: "T-104", type: "Tractor + 53' dry van", plate: "AJ-8821", trailerNo: "TR-2290", active: true },
    { id: "v2", unitNo: "T-107", type: "Straight truck 26'", plate: "BK-3390", trailerNo: "", active: true },
    { id: "v3", unitNo: "T-111", type: "Tractor + 48' flatbed", plate: "CC-1042", trailerNo: "FB-880", active: true },
  ];

  const s = (kind, name, address, extra = {}) => ({
    id: uid(), kind, name, address, window: "", ref: "", contact: "", contactPhone: "", contactEmail: "",
    status: "wait", arrivedAt: null, departedAt: null, deliveredAt: null, ...extra,
  });

  /* TL-1042 — live, mid-route, one pickup ran long */
  const t42stops = [
    s("pickup", "Meridian Warehouse 3", "8200 Wallisville Rd, Houston, TX 77029", {
      window: "08:00", ref: "ACP03013P", contact: "S. Whitfield", contactPhone: "+1 713 555 0110",
      status: "done", arrivedAt: ago(330), departedAt: ago(140), paperPhoto: null,
    }),
    s("pickup", "Meridian Yard 7", "12000 Bay Area Blvd, Pasadena, TX 77507", {
      window: "10:30", ref: "ACP03014P", contact: "S. Whitfield",
      status: "done", arrivedAt: ago(120), departedAt: ago(75),
    }),
    s("drop", "Katy Distribution", "1500 Katy Fwy, Katy, TX 77094", {
      window: "12:00–15:00", ref: "PO-4471", contact: "R. Dhillon",
      contactPhone: "+1 281 555 0170", contactEmail: "receiving@katydist.example",
      status: "done", arrivedAt: ago(55), deliveredAt: ago(20),
      receiver: "R. Dhillon", sig: SIG, notes: "",
    }),
    s("drop", "Sugar Land Depot", "50 Industrial Blvd, Sugar Land, TX 77478", {
      window: "13:00–16:00", ref: "PO-4488", contact: "M. Torres", contactPhone: "+1 281 555 0185",
    }),
    s("drop", "Baytown Terminal", "4500 Decker Dr, Baytown, TX 77520", { ref: "PO-4490" }),
  ];
  const item = (d, q, w, sn, po, from, to) => ({
    id: uid(), description: d, qty: q, weight: w, serialNo: sn, poNumber: po,
    l: "", w2: "", h: "", fromStopId: from, stopId: to,
  });

  const t42 = {
    id: uid(), tripNo: "TL-1042", client: "Meridian Freight Co.",
    clientContact: "S. Whitfield", clientPhone: "+1 713 555 0110", clientEmail: "dispatch@meridian.example",
    driverId: "d1", vehicleId: "v1", status: "running", date: new Date().toISOString().slice(0, 10),
    flatRate: 650, extraStopRate: 75, attemptRate: 100, extraCharges: 0, payAdjust: 0,
    stops: t42stops,
    items: [
      item("Steel racking, palletised", "12", "1450", "SN-88213", "PO-4471", t42stops[0].id, t42stops[2].id),
      item("Anchor bolt cartons", "6", "310", "SN-88214", "PO-4471", t42stops[0].id, t42stops[2].id),
      item("Conveyor rollers, crated", "4", "880", "SN-90455", "PO-4488", t42stops[0].id, t42stops[3].id),
      item("Motor assembly", "1", "540", "SN-90456", "PO-4488", t42stops[1].id, t42stops[3].id),
      item("Spare drive belts", "2", "140", "SN-90512", "PO-4490", t42stops[1].id, t42stops[4].id),
    ],
    audit: [
      { id: uid(), at: ago(360), who: "Dana", what: "Trip booked and assigned to Harjit Singh" },
      { id: uid(), at: ago(345), who: "Harjit Singh", what: "Accepted trip" },
      { id: uid(), at: ago(140), who: "Harjit Singh", what: "Pickup P1 (Meridian Warehouse 3) — collected 3 items" },
      { id: uid(), at: ago(20), who: "Harjit Singh", what: "Load 1 (Katy Distribution) — Delivered" },
    ],
    pings: [
      { id: uid(), at: ago(330), label: "Arrived at Meridian Warehouse 3", pos: { lat: 43.6412, lng: -79.6009 } },
      { id: uid(), at: ago(140), label: "Left Meridian Warehouse 3, loaded", pos: { lat: 43.6414, lng: -79.6011 } },
      { id: uid(), at: ago(55), label: "Arrived at Katy Distribution", pos: { lat: 43.7152, lng: -79.7624 } },
    ],
    routeChange: null,
  };

  /* TL-1041 — a refusal waiting on a decision */
  const t41stops = [
    s("pickup", "Northline Steel Mill", "5600 Clinton Dr, Houston, TX 77020", {
      status: "done", arrivedAt: ago(1500), departedAt: ago(1380), ref: "NS-8830",
    }),
    s("drop", "Conroe Fabrication", "1200 N Loop 336 W, Conroe, TX 77304", {
      status: "done", arrivedAt: ago(1300), deliveredAt: ago(1260), receiver: "T. Novak", sig: SIG,
      contactEmail: "goods@conroefab.example", contactPhone: "+1 409 555 0144",
    }),
    s("drop", "Beaumont Depot", "2100 S 11th St, Beaumont, TX 77701", {
      status: "refused", arrivedAt: ago(1200), deliveredAt: ago(1170),
      reason: "Damage found on arrival", notes: "Two coils dented on the outer wrap. Consignee refused both.",
      contactEmail: "dock@beaumontdepot.example",
    }),
  ];
  const t41 = {
    id: uid(), tripNo: "TL-1041", client: "Northline Steel",
    clientContact: "P. Adeyemi", clientPhone: "+1 936 555 0133", clientEmail: "ops@northline.example",
    driverId: "d3", vehicleId: "v3", status: "ready_to_close",
    date: new Date(Date.now() - DAY).toISOString().slice(0, 10),
    flatRate: 700, extraStopRate: 75, attemptRate: 100, extraCharges: 0, payAdjust: 0,
    stops: t41stops,
    items: [
      item("Steel coil, banded", "2", "4400", "NS-1120", "PO-5510", t41stops[0].id, t41stops[1].id),
      item("Steel coil, banded", "2", "4400", "NS-1121", "PO-5511", t41stops[0].id, t41stops[2].id),
    ],
    audit: [
      { id: uid(), at: ago(1560), who: "Dana", what: "Trip booked and assigned to Ana Ruiz" },
      { id: uid(), at: ago(1170), who: "Ana Ruiz", what: "Load 2 (Beaumont Depot) — Refused: Damage found on arrival" },
    ],
    pings: [], routeChange: null,
  };

  /* TL-1039 — closed, ready to invoice */
  const t39stops = [
    s("pickup", "Arsenal Yard", "700 Louisiana St, Houston, TX 77002", { status: "done", arrivedAt: ago(4400), departedAt: ago(4300) }),
    s("drop", "Katy Distribution", "1500 Katy Fwy, Katy, TX 77094", { status: "done", arrivedAt: ago(4200), deliveredAt: ago(4150), receiver: "J. Alvarez", sig: SIG }),
    s("drop", "Sugar Land Depot", "50 Industrial Blvd, Sugar Land, TX 77478", { status: "done", arrivedAt: ago(4100), deliveredAt: ago(4060), receiver: "K. Osei", sig: SIG }),
  ];
  const t39 = {
    id: uid(), tripNo: "TL-1039", client: "Arsenal Circulating Products",
    clientContact: "L. Marsh", clientPhone: "+1 713 555 0180", clientEmail: "ap@arsenal.example",
    driverId: "d2", vehicleId: "v2", status: "closed",
    date: new Date(Date.now() - 3 * DAY).toISOString().slice(0, 10),
    closedAt: ago(4000),
    flatRate: 620, extraStopRate: 75, attemptRate: 100, extraCharges: 0, payAdjust: 0,
    stops: t39stops,
    items: [
      item("Tool inspection crates", "8", "960", "ACP-2201", "PO-3013", t39stops[0].id, t39stops[1].id),
      item("Safety joints", "1", "120", "ACP-2202", "PO-3013", t39stops[0].id, t39stops[2].id),
    ],
    audit: [{ id: uid(), at: ago(4000), who: "Marcus Bell", what: "Closed out trip" }],
    pings: [], routeChange: null,
  };

  return { drivers, vehicles, trips: [t42, t41, t39] };
}

async function load() {
  try {
    const r = await window.storage.get(KEY);
    if (!r) return seedState();
    const p = JSON.parse(r.value);
    const b = seedState();
    return { drivers: p.drivers || b.drivers, vehicles: p.vehicles || b.vehicles, trips: p.trips || b.trips };
  } catch { return seedState(); }
}
async function save(st) {
  try { await window.storage.set(KEY, JSON.stringify(st)); }
  catch (e) { console.error("save failed", e); }
}

/* ================================================================== */

const CSS = `
:root{
  --ink:#16202B; --ink2:#2A3A4B; --mute:#6B7A88;
  --dock:#DFE1DE; --card:#F8F9F7; --line:#C3C7C2;
  --hiviz:#F2B705; --sea:#2B5F8A; --go:#2E7D53; --stop:#B3392F;
}
*{box-sizing:border-box}
.dw{ background:var(--dock); color:var(--ink); min-height:100vh;
  font-family:system-ui,-apple-system,"Segoe UI",sans-serif; font-size:15px; line-height:1.45 }
.dw-display{ font-family:"Arial Narrow","Roboto Condensed",system-ui,sans-serif;
  text-transform:uppercase; letter-spacing:.06em; font-weight:800; line-height:1.05 }
.dw-data{ font-family:ui-monospace,"SF Mono",Menlo,monospace; font-variant-numeric:tabular-nums }
.dw-eyebrow{ font-size:10px; letter-spacing:.18em; text-transform:uppercase; color:var(--mute); font-weight:700 }

.dw-shell{ display:flex; min-height:100vh }
.dw-nav{ display:none }
.dw-main{ flex:1; min-width:0; max-width:820px; margin:0 auto; padding:14px; padding-bottom:44px }
.dw-bar{ background:var(--ink); color:#fff; padding:12px 14px; display:flex; align-items:center; gap:10px; position:sticky; top:0; z-index:20 }
.dw-bar h1{ margin:0; font-size:17px }
.dw-burger{ background:none; border:0; color:#fff; cursor:pointer; display:flex; padding:2px }
.dw-item{ display:flex; align-items:center; gap:10px; width:100%; padding:11px 13px; border:0; border-radius:3px;
  background:none; color:#C6D2DC; font-size:13.5px; font-weight:700; cursor:pointer; text-align:left; margin-bottom:2px }
.dw-item[data-on="1"]{ background:var(--hiviz); color:var(--ink) }
.dw-item:hover{ background:rgba(255,255,255,.07) }
.dw-item[data-on="1"]:hover{ background:var(--hiviz) }
.dw-cta{ background:var(--go); color:#fff; margin-bottom:10px }
.dw-navhead{ font-size:10px; letter-spacing:.16em; text-transform:uppercase; color:#7E93A5; font-weight:800; padding:14px 13px 5px }
.dw-scrim{ position:fixed; inset:0; background:rgba(10,16,22,.55); z-index:40 }
.dw-drawer{ position:fixed; top:0; left:0; bottom:0; width:244px; background:var(--ink); z-index:41; padding:12px; overflow:auto }
@media (min-width:760px){
  .dw-nav{ display:block; width:226px; flex:0 0 226px; background:var(--ink); padding:12px; position:sticky; top:0; height:100vh; overflow:auto }
  .dw-burger{ display:none }
  .dw-main{ padding:20px 24px }
}

.dw-card{ background:var(--card); border:1px solid var(--line); border-radius:3px; padding:14px; margin-bottom:12px }
.dw-card h3{ margin:0 0 3px; font-size:16px }
.dw-hr{ border:0; border-top:1px dashed var(--line); margin:12px 0 }
.dw-note{ font-size:12px; color:var(--mute); margin:6px 0 0 }

.dw-btn{ display:flex; align-items:center; justify-content:center; gap:8px; width:100%; padding:13px; border:0; border-radius:3px;
  background:var(--ink); color:#fff; font-size:13.5px; font-weight:800; letter-spacing:.07em; text-transform:uppercase;
  cursor:pointer; font-family:"Arial Narrow","Roboto Condensed",system-ui,sans-serif; margin-bottom:10px; text-decoration:none }
.dw-btn[data-v="go"]{ background:var(--go) } .dw-btn[data-v="hiviz"]{ background:var(--hiviz); color:var(--ink) }
.dw-btn[data-v="ghost"]{ background:none; color:var(--ink); border:1px solid var(--line) }
.dw-btn[data-v="danger"]{ background:none; color:var(--stop); border:1px solid var(--line) }
.dw-btn:disabled{ background:#AEB6BD; cursor:not-allowed }
.dw-btn-sm{ width:auto; padding:8px 12px; font-size:11.5px; margin-bottom:0 }
button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{ outline:3px solid var(--sea); outline-offset:2px }

.dw-fld{ margin-bottom:10px }
.dw-fld label{ display:block; font-size:10px; letter-spacing:.14em; text-transform:uppercase; color:var(--mute); font-weight:700; margin-bottom:4px }
.dw-fld input,.dw-fld select,.dw-fld textarea{ width:100%; padding:10px; border:1px solid var(--line); border-radius:2px; background:#fff;
  font-size:15px; font-family:ui-monospace,Menlo,monospace; color:var(--ink) }
.dw-row{ display:flex; gap:8px } .dw-row>*{ flex:1 }

.dw-tag{ display:inline-block; padding:2px 7px; border-radius:2px; font-size:10px; font-weight:800; letter-spacing:.09em; text-transform:uppercase }
.dw-tag[data-t="done"]{ background:#DCEEE3; color:var(--go) }
.dw-tag[data-t="now"]{ background:#FFF0C2; color:#6B5200 }
.dw-tag[data-t="wait"]{ background:#E4E7E4; color:var(--mute) }
.dw-tag[data-t="exc"]{ background:#F8E3E1; color:var(--stop) }

.dw-kv{ display:grid; grid-template-columns:1fr auto; gap:3px 10px; font-size:13px }
.dw-kv i{ font-style:normal; color:var(--mute) }

.dw-prog{ background:var(--card); border:1px solid var(--line); border-radius:3px; padding:11px 12px; margin-bottom:12px }
.dw-segs{ display:flex; gap:2px; height:9px; margin-top:8px }
.dw-seg{ flex:1; border-radius:2px; background:#D2D6D2; min-width:3px; position:relative }
.dw-seg[data-s="done"]{ background:var(--go) }
.dw-seg[data-s="exc"]{ background:var(--stop) }
.dw-seg[data-s="now"]{ background:var(--hiviz); box-shadow:0 0 0 2px var(--ink) }
.dw-seg[data-k="pickup"]::after{ content:""; position:absolute; left:50%; top:-5px; transform:translateX(-50%);
  width:0;height:0;border-left:3px solid transparent;border-right:3px solid transparent;border-bottom:4px solid var(--sea) }

.dw-stop{ border:1px solid var(--line); background:#fff; border-radius:2px; padding:11px; margin-bottom:8px; display:flex; gap:10px; align-items:flex-start }
.dw-stop[data-s="done"]{ border-left:4px solid var(--go) }
.dw-stop[data-s="now"]{ border-left:4px solid var(--hiviz) }
.dw-stop[data-s="exc"]{ border-left:4px solid var(--stop) }
.dw-stop[data-s="wait"]{ opacity:.68 }
.dw-seq{ width:30px;height:30px;flex:0 0 30px;border-radius:50%;background:var(--ink);color:#fff;
  display:grid;place-items:center;font-family:ui-monospace,monospace;font-size:13px;font-weight:700 }

.dw-triprow{ display:flex; gap:11px; align-items:flex-start; width:100%; text-align:left; cursor:pointer;
  background:var(--card); border:1px solid var(--line); border-radius:3px; padding:12px; margin-bottom:8px }
.dw-triprow:hover{ border-color:var(--sea) }
.dw-mini{ display:flex; gap:2px; height:5px; margin-top:7px }
.dw-mini div{ flex:1; border-radius:1px; background:#D2D6D2 }

.dw-alert{ border:2px solid var(--stop); background:#FDF1F0; border-radius:3px; padding:12px; margin-bottom:12px }
.dw-alert h4{ margin:0 0 4px; font-size:14px }
.dw-empty{ text-align:center; padding:26px 14px; color:var(--mute); font-size:14px }
.dw-item2{ border:1px solid var(--line); border-left:4px solid var(--sea); background:#fff; border-radius:2px; padding:10px; margin-bottom:8px }

.dw-bol{ background:#fff; border:1px solid var(--ink); padding:16px; font-family:ui-monospace,Menlo,monospace; font-size:11px; color:#000 }
.dw-bol h2{ font-size:15px; margin:0; letter-spacing:.1em }
.dw-bol table{ width:100%; border-collapse:collapse; margin:8px 0; font-size:10px }
.dw-bol th,.dw-bol td{ border:1px solid #999; padding:4px; text-align:left }
.dw-bol th{ background:#EEE }
.dw-bolhd{ display:flex; justify-content:space-between; border-bottom:2px solid #000; padding-bottom:6px; margin-bottom:8px }

@media print{
  body *{ visibility:hidden !important }
  .dw-print,.dw-print *{ visibility:visible !important }
  .dw-print{ position:absolute; left:0; top:0; width:100% }
  .dw-noprint{ display:none !important }
}
`;

/* ================================================================== */
/* Shared pieces                                                      */
/* ================================================================== */
/* ==================================================================
   US ADDRESS AUTOFILL — shared block
   Inserted into each standalone module (they can't import each other).
   ================================================================== */

const US_STATES = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"],
  ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia"],
  ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"],
  ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"],
  ["ME", "Maine"], ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"],
  ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"],
  ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"],
  ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"], ["OR", "Oregon"],
  ["PA", "Pennsylvania"], ["PR", "Puerto Rico"], ["RI", "Rhode Island"], ["SC", "South Carolina"],
  ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"], ["VT", "Vermont"],
  ["VA", "Virginia"], ["WA", "Washington"], ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
];
const STATE_SET = new Set(US_STATES.map(([a]) => a));
const STATE_BY_NAME = Object.fromEntries(US_STATES.map(([a, n]) => [n.toLowerCase(), a]));

/* Canada and other non-US input is rejected — this build is US-only. */
const CA_PROV = new Set(["ON","QC","BC","AB","MB","SK","NS","NB","NL","PE","YT","NT","NU"]);
const CA_POSTAL = /\b[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d\b/;

function nonUS(text) {
  const t = (text || "").trim();
  if (!t) return null;
  if (CA_POSTAL.test(t)) return "That looks like a Canadian postal code. This system handles US addresses only.";
  const m = t.match(/[,\s]+([A-Za-z]{2})\s*(?:[A-Za-z]\d[A-Za-z].*)?$/);
  if (m && CA_PROV.has(m[1].toUpperCase()) && !STATE_SET.has(m[1].toUpperCase())) {
    return `"${m[1].toUpperCase()}" is a Canadian province. US addresses only.`;
  }
  if (/\b(canada|ontario|quebec|british columbia|alberta|manitoba|saskatchewan|nova scotia)\b/i.test(t)) {
    return "This system handles US addresses only.";
  }
  return null;
}


/* USPS-style abbreviations — what freight offices actually type */
const SUFFIX = {
  street: "St", st: "St", avenue: "Ave", ave: "Ave", road: "Rd", rd: "Rd",
  boulevard: "Blvd", blvd: "Blvd", drive: "Dr", dr: "Dr", lane: "Ln", ln: "Ln",
  parkway: "Pkwy", pkwy: "Pkwy", highway: "Hwy", hwy: "Hwy", court: "Ct", ct: "Ct",
  circle: "Cir", place: "Pl", terrace: "Ter", trail: "Trl", freeway: "Fwy", fwy: "Fwy",
  expressway: "Expy", suite: "Ste", ste: "Ste", apartment: "Apt", building: "Bldg",
  north: "N", south: "S", east: "E", west: "W",
  northeast: "NE", northwest: "NW", southeast: "SE", southwest: "SW",
};

function tidyLine(line) {
  return line.split(/\s+/).map((w) => {
    const bare = w.replace(/[.,]/g, "").toLowerCase();
    if (SUFFIX[bare]) return SUFFIX[bare];
    if (/^\d+$/.test(w)) return w;
    if (/^[A-Z]{2,}$/.test(w) && w.length <= 4) return w;      // I-45, US, NW
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(" ").trim();
}

/* pull street / city / state / zip out of whatever they typed or pasted */
function parseUS(text) {
  const raw = (text || "").replace(/\s+/g, " ").trim();
  if (!raw) return { line1: "", city: "", state: "", zip: "" };

  let rest = raw, zip = "";
  const z = rest.match(/\b(\d{5})(?:-(\d{4}))?\b\s*(?:USA|US|United States)?\s*$/i);
  if (z) { zip = z[2] ? `${z[1]}-${z[2]}` : z[1]; rest = rest.slice(0, z.index).trim(); }
  rest = rest.replace(/,?\s*(USA|United States)\s*$/i, "").trim();

  let state = "";
  const st = rest.match(/[,\s]+([A-Za-z]{2})\s*$/);
  if (st && STATE_SET.has(st[1].toUpperCase())) {
    state = st[1].toUpperCase();
    rest = rest.slice(0, st.index).trim();
  } else {
    for (const [name, ab] of Object.entries(STATE_BY_NAME)) {
      const re = new RegExp(`[,\\s]+${name}\\s*$`, "i");
      if (re.test(rest)) { state = ab; rest = rest.replace(re, "").trim(); break; }
    }
  }

  const parts = rest.split(",").map((p) => p.trim()).filter(Boolean);
  let city = "", line1 = rest;
  if (parts.length >= 2) { city = parts[parts.length - 1]; line1 = parts.slice(0, -1).join(", "); }

  return {
    line1: tidyLine(line1.replace(/,$/, "")),
    city: city ? tidyLine(city) : "",
    state, zip,
  };
}

function joinUS(p) {
  const tail = [p.city, [p.state, p.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [p.line1, tail].filter(Boolean).join(", ");
}

function addressIssues(p) {
  const out = [];
  if (!p.line1) out.push("No street address.");
  if (!p.city) out.push("No city.");
  if (!p.state) out.push("No state.");
  else if (!STATE_SET.has(p.state)) out.push(`"${p.state}" isn't a US state code.`);
  if (p.zip && !/^\d{5}(-\d{4})?$/.test(p.zip)) out.push("ZIP should be 5 digits, or ZIP+4.");
  return out;
}

/* Ask the model, with web search, for real matching US addresses. */
async function lookupUS(query) {
  const prompt = `A freight dispatcher typed this partial US address or business name:

"${query}"

Search the web and return up to 4 real, currently valid street addresses that match.
CRITICAL: only addresses inside the United States. Never return Canadian, Mexican or other
non-US addresses — return [] instead.
Prefer commercial, industrial and warehouse addresses — this is for truck deliveries.

Reply with ONLY a JSON array, no markdown fences, no preamble:
[{"label":"<business or site name, or empty>","line1":"<street>","city":"<city>","state":"<2-letter>","zip":"<5 digit>"}]

If nothing credible matches, return [].`;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    }),
  });
  const data = await r.json();
  const text = data.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return [];
  const arr = JSON.parse(m[0]);
  return Array.isArray(arr) ? arr.filter((a) => a.line1 && a.state) : [];
}

function AddressField({ label, value, onChange, placeholder }) {
  const [text, setText] = useState(value || "");
  const [sugs, setSugs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [touched, setTouched] = useState(false);
  const timer = useRef(null);
  const seq = useRef(0);
  const lastQ = useRef("");
  const focused = useRef(false);

  useEffect(() => { setText(value || ""); }, [value]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const parts = parseUS(text);
  const foreign = nonUS(text);
  const issues = foreign ? [foreign] : (touched && text.trim() ? addressIssues(parts) : []);

  const run = async (q) => {
    const mine = ++seq.current;
    setBusy(true); setErr(null);
    try {
      const out = await lookupUS(q);
      if (mine === seq.current) setSugs(out);
    } catch {
      if (mine === seq.current) { setSugs([]); setErr("Couldn't reach address lookup. Type it in full."); }
    }
    if (mine === seq.current) setBusy(false);
  };

  const onType = (v) => {
    setText(v); onChange(v); setTouched(true);
    clearTimeout(timer.current);
    if (nonUS(v)) { setSugs([]); return; }
    const q = v.trim();
    if (q.length < 6) { setSugs([]); return; }
    /* already looked this up, or it's the address we just filled in */
    if (q === lastQ.current) return;
    timer.current = setTimeout(() => {
      if (!focused.current) return;          // they moved on — don't search
      lastQ.current = q;
      run(q);
    }, 900);
  };

  const take = (a) => {
    const full = joinUS({ line1: a.line1, city: a.city, state: a.state, zip: a.zip });
    clearTimeout(timer.current);             // kill the pending search
    seq.current++;                           // ignore any reply still in flight
    lastQ.current = full;                    // and never re-search what we just filled
    setText(full); onChange(full); setSugs([]); setBusy(false); setTouched(true);
  };

  const dismiss = () => {
    clearTimeout(timer.current);
    seq.current++;
    lastQ.current = text.trim();
    setSugs([]); setBusy(false);
  };

  return (
    <div className={"dw-fld"}>
      <label>{label}</label>
      <div style={{ position: "relative" }}>
        <input value={text} onChange={(e) => onType(e.target.value)}
          onFocus={() => { focused.current = true; }}
          onBlur={() => { focused.current = false; setTouched(true); }}
          onKeyDown={(e) => { if (e.key === "Escape") dismiss(); }}
          placeholder={placeholder || "US street or business name"} />
        {busy && (
          <span style={{ position: "absolute", right: 9, top: 11, color: "var(--mute)", fontSize: 11 }}>
            searching…
          </span>
        )}
      </div>

      {sugs.length > 0 && (
        <div style={{ border: "1px solid var(--line)", borderTop: 0, background: "#fff", borderRadius: "0 0 3px 3px" }}>
          {sugs.map((a, i) => (
            <button key={i} onClick={() => take(a)}
              style={{
                display: "block", width: "100%", textAlign: "left", padding: "9px 10px",
                background: "none", border: 0, borderBottom: "1px dashed var(--line)", cursor: "pointer",
              }}>
              {a.label && <b style={{ fontSize: 12.5, display: "block" }}>{a.label}</b>}
              <span style={{ fontSize: 12.5, fontFamily: "ui-monospace, Menlo, monospace" }}>
                {a.line1}, {a.city}, {a.state} {a.zip}
              </span>
            </button>
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", fontSize: 10.5, color: "var(--mute)" }}>
            <span style={{ flex: 1 }}>Found by web search — check it before dispatching a truck.</span>
            <button onClick={dismiss}
              style={{ background: "none", border: 0, cursor: "pointer", color: "var(--sea)", fontWeight: 800, fontSize: 10.5 }}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {text.trim() && (parts.city || parts.state || parts.zip) && (
        <p className={"dw-note"} style={{ margin: "5px 0 0", fontFamily: "ui-monospace, Menlo, monospace" }}>
          {parts.line1 || "—"} · {parts.city || "—"} · {parts.state || "—"} {parts.zip}
        </p>
      )}
      {issues.length > 0 && (
        <p className={"dw-note"} style={{ color: "var(--stop)", fontWeight: 700 }}>
          {issues.join(" ")}
        </p>
      )}
      {err && <p className={"dw-note"} style={{ color: "var(--stop)" }}>{err}</p>}
    </div>
  );
}


function Field({ label, value, onChange, type = "text", mode, placeholder }) {
  return (
    <div className="dw-fld">
      <label>{label}</label>
      <input type={type} inputMode={mode} placeholder={placeholder}
        value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/* Ask the model to sequence the stops. Geography only — no live traffic. */
async function askRoute(stops) {
  const list = stops.map((s, i) =>
    `${i + 1}. [${s.kind === "pickup" ? "PICKUP" : "DROP"}] ${s.name || "Unnamed"} — ${s.address || "no address"}${s.window ? ` (window ${s.window})` : ""}`
  ).join("\n");

  const prompt = `You are sequencing a US truck route with multiple pickups and drops.

Stops as currently entered:
${list}

Rules you must respect:
- Every PICKUP must come before any DROP that depends on it. When unsure, put all pickups first.
- Respect delivery windows where given.
- Minimise backtracking based on US geography.

Reply with ONLY a JSON object, no markdown fences:
{"order":[<the stop numbers above, reordered>],"reason":"<one short sentence, max 20 words>","caution":"<one short sentence if an address is vague or a window conflicts, else empty>"}`;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await r.json();
  const text = data.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

function RouteSuggest({ stops, onApply }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState(null);

  if (stops.length < 3) return null;
  const ready = stops.filter((s) => (s.address || "").trim()).length >= 2;

  const run = async () => {
    setBusy(true); setErr(null); setRes(null);
    try {
      const out = await askRoute(stops);
      if (!Array.isArray(out.order) || out.order.length !== stops.length) throw new Error("bad");
      setRes(out);
    } catch {
      setErr("Couldn't work out an order. Check the addresses and try again.");
    }
    setBusy(false);
  };

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 3, padding: 11, marginBottom: 10, background: "#fff" }}>
      <div className="dw-eyebrow" style={{ marginBottom: 6 }}>Route order</div>
      {!res && (
        <>
          <button className="dw-btn dw-btn-sm" data-v="ghost" onClick={run} disabled={busy || !ready}>
            {busy ? <Loader2 size={13} /> : <Route size={13} />} {busy ? "Working it out…" : "Suggest best order"}
          </button>
          {!ready && <p className="dw-note">Add at least two addresses first.</p>}
        </>
      )}
      {err && <p className="dw-note" style={{ color: "var(--stop)" }}>{err}</p>}
      {res && (
        <>
          <div className="dw-data" style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 5 }}>
            {res.order.map((n) => stops[n - 1]?.name || `Stop ${n}`).join("  →  ")}
          </div>
          <p className="dw-note" style={{ margin: "0 0 4px" }}>{res.reason}</p>
          {res.caution && (
            <p className="dw-note" style={{ color: "var(--stop)", fontWeight: 700 }}>
              <AlertTriangle size={11} /> {res.caution}
            </p>
          )}
          <p className="dw-note" style={{ fontStyle: "italic" }}>
            Based on geography, not live traffic or measured drive times. Sanity-check it.
          </p>
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <button className="dw-btn dw-btn-sm" data-v="go"
              onClick={() => { onApply(res.order.map((n) => stops[n - 1])); setRes(null); }}>
              <Check size={13} /> Use this order
            </button>
            <button className="dw-btn dw-btn-sm" data-v="ghost" onClick={() => setRes(null)}>
              <X size={13} /> Keep mine
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function stateOf(st, current) {

/* ---- dropped pins ---- */
const SHORT_LINK = /(maps\.app\.goo\.gl|goo\.gl\/maps|maps\.apple\/p\/|share\.google)/i;

function parsePin(raw) {
  const t = (raw || "").trim();
  if (!t) return null;
  let dec = t;
  try { dec = decodeURIComponent(t); } catch { /* keep raw */ }

  const coord = (la, ln) => {
    const lat = parseFloat(la), lng = parseFloat(ln);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat: +lat.toFixed(6), lng: +lng.toFixed(6) };
  };
  const inUS = (c) => c && c.lat > 24 && c.lat < 50 && c.lng > -125 && c.lng < -66;

  let m, c = null, how = "";
  if ((m = dec.match(/!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)/))) { c = coord(m[1], m[2]); how = "Google place"; }
  else if ((m = dec.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/))) { c = coord(m[1], m[2]); how = "Google map centre"; }
  else if ((m = dec.match(/(?:^|[?&])(?:ll|sll|coordinate)=(-?\d+\.?\d*),(-?\d+\.?\d*)/))) { c = coord(m[1], m[2]); how = "Apple pin"; }
  else if ((m = dec.match(/(?:daddr|q|destination)=(-?\d+\.?\d*),\s*(-?\d+\.?\d*)/))) { c = coord(m[1], m[2]); how = "link coordinates"; }
  else if ((m = dec.match(/geo:(-?\d+\.?\d*),(-?\d+\.?\d*)/))) { c = coord(m[1], m[2]); how = "Android pin"; }
  else if ((m = dec.match(/(?:^|\s)(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})(?:\s|$)/))) { c = coord(m[1], m[2]); how = "pasted coordinates"; }

  if (c) {
    if (!inUS(c)) return { outside: true };
    return { ...c, how };
  }
  if (SHORT_LINK.test(dec)) return { short: true };
  return { unknown: true };
}

function PinPaste({ value, onApply }) {
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState("");
  const p = raw.trim() ? parsePin(raw) : null;

  if (!open) {
    return (
      <div style={{ marginBottom: 10 }}>
        <button className={"dw-btn " + "dw-btn-sm"} data-v="ghost" onClick={() => setOpen(true)}>
          <MapPin size={13} /> {value?.lat != null ? "Change dropped pin" : "Paste a dropped pin"}
        </button>
        {value?.lat != null && (
          <p className={"dw-note"} style={{ margin: "5px 0 0", fontFamily: "ui-monospace, Menlo, monospace" }}>
            Pin set: {value.lat}, {value.lng}{value.how ? ` · ${value.how}` : ""}
          </p>
        )}
      </div>
    );
  }

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 3, padding: 10, marginBottom: 10, background: "#fff" }}>
      <div className={"dw-eyebrow"} style={{ marginBottom: 6 }}>Paste whatever the client sent</div>
      <textarea rows={3} value={raw} onChange={(e) => setRaw(e.target.value)}
        style={{ width: "100%", padding: 10, border: "1px solid var(--line)", borderRadius: 2,
          fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12.5 }}
        placeholder="Google or Apple maps link, or plain coordinates like 29.7604, -95.3698" />

      {p?.short && (
        <p className={"dw-note"} style={{ color: "var(--stop)" }}>
          That's a shortened link — a browser can't open it. Tap it on your phone, let it open in maps,
          then share the full link or the address instead.
        </p>
      )}
      {p?.outside && (
        <p className={"dw-note"} style={{ color: "var(--stop)", fontWeight: 700 }}>
          Those coordinates are outside the United States. US only.
        </p>
      )}
      {p?.unknown && (
        <p className={"dw-note"} style={{ color: "var(--stop)" }}>
          Nothing recognisable in that. Paste coordinates or a full maps link.
        </p>
      )}
      {p && p.lat != null && (
        <>
          <div style={{ background: "#F1F4F1", padding: 8, borderRadius: 2, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12.5 }}>
            <b>{p.lat}, {p.lng}</b>
            <div style={{ color: "var(--mute)", fontSize: 11 }}>Read as: {p.how}</div>
          </div>
          <button className={"dw-btn " + "dw-btn-sm"} data-v="go" style={{ marginTop: 8 }}
            onClick={() => { onApply(p); setRaw(""); setOpen(false); }}>
            <Check size={13} /> Use this pin
          </button>
        </>
      )}
      <button className={"dw-btn " + "dw-btn-sm"} data-v="ghost" style={{ marginTop: 8 }}
        onClick={() => { setOpen(false); setRaw(""); }}>
        <X size={13} /> Cancel
      </button>
    </div>
  );
}

  if (st.status === "done") return "done";
  if (st.status === "attempted" || st.status === "refused") return "exc";
  if (st.status === "cancelled" || st.status === "rescheduled" || st.status === "moved") return "wait";
  return current?.id === st.id ? "now" : "wait";
}

function Progress({ trip }) {
  const stops = (trip.stops || []).filter((x) => x.status !== "moved");
  const L = labelsOf(trip.stops || []);
  const current = stops.find(isOpen);
  const done = stops.filter((x) => x.status === "done").length;
  const exc = stops.filter((x) => x.status === "attempted" || x.status === "refused").length;

  return (
    <div className="dw-prog">
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <b className="dw-display" style={{ fontSize: 14 }}>
          {current ? `${isPickup(current) ? "Pickup" : "Drop"} ${L[current.id]} next` : "Route complete"}
        </b>
        <span className="dw-note dw-data" style={{ margin: 0, flex: 1 }}>
          {done} done{exc ? ` · ${exc} failed` : ""} · {stops.filter(isOpen).length} left
        </span>
      </div>
      <div className="dw-segs">
        {stops.map((x) => (
          <div key={x.id} className="dw-seg" data-s={stateOf(x, current)} data-k={x.kind}
            title={`${titleOf(x, L)} — ${x.name}`} />
        ))}
      </div>
    </div>
  );
}

/* ================================================================== */
/* Board — what needs a decision today                                */
/* ================================================================== */

function Board({ trips, drivers, onOpen, onNew }) {
  const live = trips.filter((t) => t.status === "running");
  const toClose = trips.filter((t) => t.status === "ready_to_close");
  const exceptions = trips.flatMap((t) =>
    (t.stops || []).filter((x) => x.status === "attempted" || x.status === "refused")
      .map((x) => ({ trip: t, stop: x })));
  const openRevenue = trips.filter((t) => t.status !== "closed")
    .reduce((a, t) => a + billingOf(t).gross, 0);

  return (
    <>
      <button className="dw-btn" data-v="go" onClick={onNew}><Plus size={16} /> New booking</button>

      {exceptions.length > 0 && (
        <div className="dw-alert dw-noprint">
          <h4 className="dw-display"><AlertTriangle size={14} /> {exceptions.length} stop{exceptions.length === 1 ? "" : "s"} need a decision</h4>
          {exceptions.map(({ trip, stop }) => (
            <button key={stop.id} onClick={() => onOpen(trip.id)}
              style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: 0, cursor: "pointer", padding: "6px 0", borderBottom: "1px dashed #E0C7C4" }}>
              <b style={{ fontSize: 13 }}>{trip.tripNo} · {stop.name}</b>
              <div className="dw-note" style={{ margin: 0 }}>{stop.reason} — freight still on the truck</div>
            </button>
          ))}
        </div>
      )}

      {toClose.length > 0 && (
        <div className="dw-card" style={{ borderLeft: "4px solid var(--hiviz)" }}>
          <div className="dw-eyebrow">Waiting on you</div>
          <h3 className="dw-display" style={{ fontSize: 18 }}>{toClose.length} ready to close</h3>
          <hr className="dw-hr" />
          {toClose.map((t) => (
            <button key={t.id} onClick={() => onOpen(t.id)}
              style={{ display: "flex", gap: 8, width: "100%", background: "none", border: 0, cursor: "pointer", padding: "6px 0", textAlign: "left" }}>
              <b className="dw-data" style={{ fontSize: 13 }}>{t.tripNo}</b>
              <span className="dw-note" style={{ margin: 0, flex: 1 }}>{t.client}</span>
              <span className="dw-data" style={{ fontSize: 12.5 }}>{usd(billingOf(t).gross)}</span>
            </button>
          ))}
        </div>
      )}

      <div className="dw-card">
        <div className="dw-eyebrow">On the road</div>
        <h3 className="dw-display" style={{ fontSize: 19 }}>
          {live.length} running · {usd(openRevenue)} in the air
        </h3>
        <hr className="dw-hr" />
        {live.length === 0 ? <p className="dw-note">Nothing moving right now.</p> : live.map((t) => {
          const d = drivers.find((x) => x.id === t.driverId);
          const stops = (t.stops || []).filter((x) => x.status !== "moved");
          const cur = stops.find(isOpen);
          const lastPing = (t.pings || [])[t.pings.length - 1];
          return (
            <button key={t.id} className="dw-triprow" onClick={() => onOpen(t.id)}>
              <div className="dw-seq">{stops.filter((x) => x.status === "done").length}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", gap: 7, alignItems: "baseline" }}>
                  <b className="dw-data" style={{ fontSize: 13.5 }}>{t.tripNo}</b>
                  <span className="dw-note" style={{ margin: 0, flex: 1 }}>{d?.name}</span>
                  <span className="dw-tag" data-t="now">running</span>
                </div>
                <p className="dw-note" style={{ margin: "3px 0 0" }}>
                  {cur ? `Next: ${cur.name}` : "Route complete"}
                  {lastPing ? ` · last seen ${hhmm(lastPing.at)}` : ""}
                </p>
                <div className="dw-mini">
                  {stops.map((x) => (
                    <div key={x.id} style={{
                      background: x.status === "done" ? "var(--go)"
                        : (x.status === "attempted" || x.status === "refused") ? "var(--stop)"
                          : cur?.id === x.id ? "var(--hiviz)" : "#D2D6D2",
                    }} />
                  ))}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}

/* ================================================================== */
/* Trip list                                                          */
/* ================================================================== */

function TripsPage({ trips, drivers, vehicles, onOpen, onNew }) {
  const [filter, setFilter] = useState("open");
  const open = trips.filter((t) => t.status !== "closed");
  const closed = trips.filter((t) => t.status === "closed");
  const shown = filter === "open" ? open : filter === "closed" ? closed : trips;

  return (
    <>
      <button className="dw-btn" data-v="go" onClick={onNew}><Plus size={16} /> New booking</button>

      <div style={{ display: "flex", background: "#D3D7D3", borderRadius: 2, overflow: "hidden", marginBottom: 12 }}>
        {[["open", `Open (${open.length})`], ["closed", `Closed (${closed.length})`], ["all", "All"]].map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)}
            style={{
              flex: 1, border: 0, cursor: "pointer", padding: "8px 6px", fontSize: 11, fontWeight: 800,
              letterSpacing: ".08em", textTransform: "uppercase",
              background: filter === k ? "var(--hiviz)" : "transparent",
              color: filter === k ? "var(--ink)" : "var(--mute)",
            }}>{l}</button>
        ))}
      </div>

      {shown.length === 0 ? <div className="dw-empty"><ClipboardList size={26} /><p>Nothing here.</p></div>
        : shown.map((t) => {
          const d = drivers.find((x) => x.id === t.driverId);
          const v = vehicles.find((x) => x.id === t.vehicleId);
          const stops = (t.stops || []).filter((x) => x.status !== "moved");
          const cur = stops.find(isOpen);
          const exc = stops.filter((x) => x.status === "attempted" || x.status === "refused").length;
          const tone = t.status === "closed" ? "done" : t.status === "running" ? "now" : "wait";
          return (
            <button key={t.id} className="dw-triprow" onClick={() => onOpen(t.id)}>
              <div className="dw-seq" style={{ background: t.status === "closed" ? "var(--go)" : "var(--ink)" }}>
                {t.status === "closed" ? "✓" : stops.filter((x) => x.status === "done").length}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", gap: 7, alignItems: "baseline" }}>
                  <b className="dw-data" style={{ fontSize: 13.5 }}>{t.tripNo}</b>
                  <span className="dw-note" style={{ margin: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.client}</span>
                  <span className="dw-tag" data-t={tone}>{t.status.replace("_", " ")}</span>
                </div>
                <p className="dw-note" style={{ margin: "3px 0 0" }}>
                  {d?.name}{v ? ` · Unit ${v.unitNo}` : ""} · {usd(billingOf(t).gross)}
                  {cur ? ` · next: ${cur.name}` : ""}
                </p>
                <div className="dw-mini">
                  {stops.map((x) => (
                    <div key={x.id} style={{
                      background: x.status === "done" ? "var(--go)"
                        : (x.status === "attempted" || x.status === "refused") ? "var(--stop)"
                          : cur?.id === x.id ? "var(--hiviz)" : "#D2D6D2",
                    }} />
                  ))}
                </div>
                {exc > 0 && (
                  <p className="dw-note" style={{ margin: "5px 0 0", color: "var(--stop)", fontWeight: 700 }}>
                    {exc} stop{exc === 1 ? "" : "s"} need attention
                  </p>
                )}
              </div>
            </button>
          );
        })}
    </>
  );
}

/* ================================================================== */
/* BOL                                                                */
/* ================================================================== */

function Bol({ trip, stop, vehicles, onBack }) {
  const L = labelsOf(trip.stops || []);
  const items = stop ? (trip.items || []).filter((i) => i.stopId === stop.id) : (trip.items || []);
  const wt = items.reduce((a, b) => a + num(b.weight), 0);
  const v = vehicles.find((x) => x.id === trip.vehicleId);
  const originIds = new Set(items.map((i) => i.fromStopId));
  const origins = (trip.stops || []).filter((x) => isPickup(x) && originIds.has(x.id));
  const drops = (trip.stops || []).filter(isDrop);
  const dep = (trip.stops || []).find((x) => isPickup(x) && x.departedAt)?.departedAt;

  return (
    <>
      <div className="dw-noprint" style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button className="dw-btn dw-btn-sm" data-v="ghost" onClick={onBack}><X size={13} /> Back</button>
        <button className="dw-btn dw-btn-sm" onClick={() => window.print()}><Printer size={13} /> Print / Save PDF</button>
      </div>

      <div className="dw-bol dw-print">
        <div className="dw-bolhd">
          <div>
            <h2>BILL OF LADING</h2>
            <div>{stop ? `LOAD ${L[stop.id]} OF ${drops.length}` : `MASTER — ${origins.length || 1} PICKUP(S), ${drops.length} DROP(S)`}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div>BOL #: {trip.tripNo}{stop ? `-${L[stop.id]}` : "-M"}</div>
            <div>Date: {dmy(dep || trip.date)}</div>
            <div>Status: {trip.status === "closed" ? "FINAL / LOCKED" : "DRAFT"}</div>
          </div>
        </div>

        {stop && stop.status !== "done" && stop.status !== "wait" && (
          <div style={{ border: "2px solid #000", padding: 6, marginBottom: 8, fontWeight: "bold" }}>
            NOT DELIVERED — {String(OUTCOMES[stop.status]?.label || stop.status).toUpperCase()}
            {stop.reason ? ` · ${stop.reason}` : ""}
            {stop.notes ? <div style={{ fontWeight: "normal", marginTop: 3 }}>{stop.notes}</div> : null}
          </div>
        )}

        <table><tbody>
          <tr><th style={{ width: "50%" }}>SHIPPER / ORIGIN</th><th>CONSIGNEE / DESTINATION</th></tr>
          <tr>
            <td>
              {(origins.length ? origins : (trip.stops || []).filter(isPickup)).map((o) => (
                <div key={o.id}>{o.name} — {o.address}</div>
              ))}
              <br />Client: {trip.client}
            </td>
            <td>{stop ? <>{stop.name}<br />{stop.address}</>
              : drops.map((x) => <div key={x.id}>{L[x.id]}. {x.name} — {x.address}</div>)}</td>
          </tr>
        </tbody></table>

        <table><tbody>
          <tr><th>UNIT</th><th>TRAILER</th><th>PLATE</th><th>EQUIPMENT</th></tr>
          <tr><td>{v?.unitNo || "—"}</td><td>{v?.trailerNo || "—"}</td><td>{v?.plate || "—"}</td><td>{v?.type || "—"}</td></tr>
        </tbody></table>

        <table>
          <thead><tr><th>#</th><th>DESCRIPTION</th><th>FROM</th><th>QTY</th><th>WEIGHT</th><th>SERIAL</th><th>PO</th></tr></thead>
          <tbody>
            {items.map((i, n) => (
              <tr key={i.id}>
                <td>{n + 1}</td>
                <td>{i.description || "—"}</td>
                <td>{(trip.stops || []).find((x) => x.id === i.fromStopId)?.name || "—"}</td>
                <td>{i.qty || "—"}</td>
                <td>{i.weight ? `${i.weight} lb` : "—"}</td>
                <td>{i.serialNo || "—"}</td>
                <td>{i.poNumber || "—"}</td>
              </tr>
            ))}
            <tr><td colSpan={3}><b>TOTAL</b></td>
              <td colSpan={4}><b>{wt.toLocaleString()} lb · {items.length} lines{origins.length > 1 ? ` · ${origins.length} origins` : ""}</b></td></tr>
          </tbody>
        </table>

        {!stop && (
          <table>
            <thead><tr><th>LOAD</th><th>CONSIGNEE</th><th>OUTCOME</th><th>TIME</th></tr></thead>
            <tbody>
              {drops.map((x) => (
                <tr key={x.id}>
                  <td>{L[x.id]}</td><td>{x.name}</td>
                  <td>{x.status === "done" ? `Delivered — ${x.receiver || "signed"}` : (OUTCOMES[x.status]?.label || x.status) + (x.reason ? ` — ${x.reason}` : "")}</td>
                  <td>{x.deliveredAt ? hhmm(x.deliveredAt) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <table><tbody>
          <tr><th>DRIVER</th><th>RECEIVED BY</th><th>SIGNATURE</th></tr>
          <tr>
            <td>{trip.driverName || "—"}<br />Loaded {hhmm(dep)}</td>
            <td>{stop ? (stop.receiver || "—") : "See individual loads"}<br />{stop ? hhmm(stop.deliveredAt) : ""}</td>
            <td style={{ height: 56 }}>{stop?.sig ? <img src={stop.sig} alt="signature" style={{ height: 44 }} /> : "—"}</td>
          </tr>
        </tbody></table>

        <div style={{ marginTop: 6, fontSize: 9 }}>
          Goods received in apparent good order except as noted. Subject to the carrier's terms and conditions.
        </div>
      </div>
    </>
  );
}

/* ================================================================== */
/* Trip detail                                                        */
/* ================================================================== */

function NotifyClient({ trip, stop }) {
  const [open, setOpen] = useState(false);
  const L = labelsOf(trip.stops || []);
  const [msg, setMsg] = useState(() => {
    const items = (trip.items || []).filter((i) => i.stopId === stop.id);
    const wt = items.reduce((a, b) => a + num(b.weight), 0);
    return [
      `Delivery update — ${trip.tripNo}`, ``,
      stop.status === "done"
        ? `Load ${L[stop.id]} delivered to ${stop.name} at ${hhmm(stop.deliveredAt)}.`
        : `Load ${L[stop.id]} could not be delivered to ${stop.name}. Reason: ${stop.reason || "see notes"}.`,
      `Received by: ${stop.receiver || "—"}`,
      `Pieces: ${items.length}${wt ? ` · ${wt.toLocaleString()} lb` : ""}`,
      stop.notes ? `Note: ${stop.notes}` : ``, ``,
      `Signed BOL is on file.`,
    ].filter(Boolean).join("\n");
  });
  const [to, setTo] = useState({ phone: stop.contactPhone || trip.clientPhone || "", email: stop.contactEmail || trip.clientEmail || "" });

  if (!open) {
    return (
      <button className="dw-btn dw-btn-sm" data-v="ghost" style={{ marginTop: 8 }} onClick={() => setOpen(true)}>
        <MessageSquare size={13} /> Tell the client
      </button>
    );
  }

  const sms = `sms:${to.phone}?body=${encodeURIComponent(msg)}`;
  const mail = `mailto:${to.email}?subject=${encodeURIComponent(`${trip.tripNo} — Load ${L[stop.id]}`)}&body=${encodeURIComponent(msg)}`;

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 3, padding: 11, marginTop: 8, background: "#fff" }}>
      <div className="dw-eyebrow" style={{ marginBottom: 6 }}>Delivery notice</div>
      <div className="dw-row">
        <Field label="Phone" value={to.phone} onChange={(v) => setTo({ ...to, phone: v })} />
        <Field label="Email" value={to.email} onChange={(v) => setTo({ ...to, email: v })} />
      </div>
      <div className="dw-fld">
        <label>Message</label>
        <textarea rows={8} value={msg} onChange={(e) => setMsg(e.target.value)} style={{ fontSize: 12.5 }} />
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <a href={sms} className="dw-btn dw-btn-sm"><MessageSquare size={13} /> Messages</a>
        <a href={mail} className="dw-btn dw-btn-sm" data-v="ghost"><Mail size={13} /> Mail</a>
        <button className="dw-btn dw-btn-sm" data-v="ghost"
          onClick={() => navigator.clipboard?.writeText(msg)}><Copy size={13} /> Copy</button>
        <button className="dw-btn dw-btn-sm" data-v="ghost" onClick={() => setOpen(false)}><X size={13} /> Close</button>
      </div>
      <p className="dw-note">Opens your own Messages or Mail app with this ready to send.</p>
    </div>
  );
}

function Reorder({ trip, onApply }) {
  const [open, setOpen] = useState(false);
  const openStops = (trip.stops || []).filter(isOpen);
  const [order, setOrder] = useState(openStops.map((x) => x.id));
  const [note, setNote] = useState("");
  useEffect(() => { setOrder((trip.stops || []).filter(isOpen).map((x) => x.id)); }, [trip.id, openStops.length]);

  if (openStops.length < 2) return null;
  const byId = Object.fromEntries((trip.stops || []).map((x) => [x.id, x]));
  const changed = order.join() !== openStops.map((x) => x.id).join();
  const move = (i, d) => {
    const n = [...order]; const j = i + d;
    if (j < 0 || j >= n.length) return;
    [n[i], n[j]] = [n[j], n[i]]; setOrder(n);
  };

  if (!open) {
    return <button className="dw-btn dw-btn-sm" data-v="ghost" style={{ marginBottom: 10 }} onClick={() => setOpen(true)}>
      <ArrowUp size={13} /> Reorder remaining stops
    </button>;
  }

  return (
    <div className="dw-card" style={{ borderLeft: "4px solid var(--sea)" }}>
      <div className="dw-eyebrow">Mid-route change</div>
      <h3 className="dw-display" style={{ fontSize: 18 }}>Reorder what's left</h3>
      <p className="dw-note">Completed stops can't move. The driver must acknowledge on his phone.</p>
      <hr className="dw-hr" />
      {order.map((id, i) => (
        <div key={id} style={{ display: "flex", alignItems: "center", gap: 8, padding: 8, marginBottom: 6, border: "1px solid var(--line)", borderRadius: 3, background: "#fff" }}>
          <div className="dw-seq" style={{ width: 24, height: 24, flex: "0 0 24px", fontSize: 12 }}>{i + 1}</div>
          <span style={{ flex: 1, fontSize: 13 }}><b>{byId[id]?.name}</b></span>
          <button onClick={() => move(i, -1)} disabled={i === 0} aria-label="Up"
            style={{ background: "none", border: "1px solid var(--line)", borderRadius: 2, padding: "3px 5px", cursor: "pointer", opacity: i === 0 ? .35 : 1 }}><ArrowUp size={12} /></button>
          <button onClick={() => move(i, 1)} disabled={i === order.length - 1} aria-label="Down"
            style={{ background: "none", border: "1px solid var(--line)", borderRadius: 2, padding: "3px 5px", cursor: "pointer", opacity: i === order.length - 1 ? .35 : 1 }}><ArrowDown size={12} /></button>
        </div>
      ))}
      <Field label="Message to the driver" value={note} onChange={setNote} placeholder="Client wants Load 3 first" />
      <button className="dw-btn" data-v="go" disabled={!changed}
        onClick={() => { onApply(order, note.trim() || "Stop order changed by dispatch."); setOpen(false); }}>
        <Check size={15} /> Send new order
      </button>
      <button className="dw-btn dw-btn-sm" data-v="ghost" onClick={() => setOpen(false)}>Cancel</button>
    </div>
  );
}

function SplitTrip({ trip, drivers, onSplit }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState([]);
  const [to, setTo] = useState("");
  const [why, setWhy] = useState("");
  const openStops = (trip.stops || []).filter(isOpen);
  if (!openStops.length) return null;

  if (!open) {
    return <button className="dw-btn dw-btn-sm" data-v="ghost" style={{ marginBottom: 10 }} onClick={() => setOpen(true)}>
      <Users size={13} /> Hand stops to another driver
    </button>;
  }

  return (
    <div className="dw-card" style={{ borderLeft: "4px solid var(--stop)" }}>
      <div className="dw-eyebrow">Driver can't finish</div>
      <h3 className="dw-display" style={{ fontSize: 18 }}>Split this trip</h3>
      <p className="dw-note">Completed stops stay locked here. What you pick moves to a new trip.</p>
      <hr className="dw-hr" />
      {openStops.map((st) => {
        const on = picked.includes(st.id);
        const cnt = (trip.items || []).filter((i) => i.stopId === st.id).length;
        return (
          <button key={st.id} onClick={() => setPicked(on ? picked.filter((x) => x !== st.id) : [...picked, st.id])}
            style={{
              display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: "left",
              padding: 10, marginBottom: 6, cursor: "pointer", borderRadius: 3,
              border: on ? "2px solid var(--stop)" : "1px solid var(--line)", background: on ? "#FDF1F0" : "#fff",
            }}>
            <span style={{ width: 20, height: 20, flex: "0 0 20px", borderRadius: 3, display: "grid", placeItems: "center", border: "1px solid var(--line)", background: on ? "var(--stop)" : "#fff", color: "#fff" }}>
              {on ? "✓" : ""}
            </span>
            <span style={{ flex: 1 }}>
              <b style={{ fontSize: 13 }}>{st.name}</b>
              <span className="dw-note" style={{ display: "block", margin: 0 }}>{cnt} item{cnt === 1 ? "" : "s"}</span>
            </span>
          </button>
        );
      })}
      <div className="dw-fld">
        <label>New driver</label>
        <select value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">— pick a driver —</option>
          {drivers.filter((d) => d.active && d.id !== trip.driverId).map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </div>
      <Field label="Why (goes on the record)" value={why} onChange={setWhy} placeholder="Family emergency" />
      <button className="dw-btn" style={{ background: "var(--stop)" }}
        disabled={!picked.length || !to}
        onClick={() => { onSplit(picked, to, why.trim()); setOpen(false); setPicked([]); }}>
        <Users size={15} /> Create handover trip
      </button>
      <button className="dw-btn dw-btn-sm" data-v="ghost" onClick={() => setOpen(false)}>Cancel</button>
    </div>
  );
}

function TripDetail({ trip, drivers, vehicles, trips, onPatch, onSplitCreate, onBack, onBol }) {
  const L = labelsOf(trip.stops || []);
  const d = drivers.find((x) => x.id === trip.driverId);
  const v = vehicles.find((x) => x.id === trip.vehicleId);
  const b = billingOf(trip);
  const p = payOf(trip, d);
  const stops = (trip.stops || []).filter((x) => x.status !== "moved");
  const cur = stops.find(isOpen);

  const log = (what) => [...(trip.audit || []), { id: uid(), at: now(), who: "Dispatch", what }];

  return (
    <>
      <button className="dw-btn dw-btn-sm" data-v="ghost" style={{ marginBottom: 12 }} onClick={onBack}>
        <ArrowUp size={13} style={{ transform: "rotate(-90deg)" }} /> All trips
      </button>

      <div className="dw-card">
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <div className="dw-eyebrow">{trip.tripNo} · {trip.client}</div>
            <h3 className="dw-display" style={{ fontSize: 19 }}>
              {(trip.stops || []).filter(isPickup).map((x) => x.name).join(" + ")}
            </h3>
          </div>
          <span className="dw-tag" data-t={trip.status === "closed" ? "done" : "now"}>{trip.status.replace("_", " ")}</span>
        </div>
        <hr className="dw-hr" />
        <div className="dw-kv dw-data">
          <div><i><User size={11} /> Driver</i></div><div>{d?.name || "—"}</div>
          <div><i><Truck size={11} /> Unit</i></div><div>{v ? `${v.unitNo} / ${v.trailerNo || "no trailer"}` : "—"}</div>
          <div><i><Clock size={11} /> Date</i></div><div>{dmy(trip.date)}</div>
          <div><i>Stops</i></div><div>{(trip.stops || []).filter(isPickup).length} pickups, {(trip.stops || []).filter(isDrop).length} drops</div>
        </div>
      </div>

      <Progress trip={trip} />

      {trip.routeChange && !trip.routeChange.ack && (
        <div className="dw-card" style={{ borderLeft: "4px solid var(--sea)", background: "#EAF1F8" }}>
          <div className="dw-eyebrow" style={{ color: "var(--sea)" }}>Sent to driver</div>
          <h3 className="dw-display" style={{ fontSize: 16 }}>Waiting for him to acknowledge</h3>
          <p className="dw-note">"{trip.routeChange.note}" — sent {hhmm(trip.routeChange.at)}</p>
        </div>
      )}

      {trip.status !== "closed" && (
        <>
          <Reorder trip={trip} onApply={(order, note) => {
            const openIds = new Set(order);
            const rest = (trip.stops || []).filter((x) => !openIds.has(x.id));
            const re = order.map((id) => (trip.stops || []).find((x) => x.id === id));
            onPatch({
              stops: [...rest, ...re],
              routeChange: { at: now(), note, ack: null },
              audit: log(`Reordered remaining stops — ${note}`),
            });
          }} />
          <SplitTrip trip={trip} drivers={drivers}
            onSplit={(ids, toDriver, why) => onSplitCreate(trip, ids, toDriver, why)} />
        </>
      )}

      <div className="dw-card">
        <div className="dw-eyebrow">Route</div>
        <h3 className="dw-display" style={{ fontSize: 18 }}>
          {stops.filter((x) => x.status === "done").length} of {stops.length} complete
        </h3>
        <hr className="dw-hr" />
        {stops.map((x) => {
          const st = stateOf(x, cur);
          const cnt = isPickup(x)
            ? (trip.items || []).filter((i) => i.fromStopId === x.id).length
            : (trip.items || []).filter((i) => i.stopId === x.id).length;
          const dw = dwell(x);
          return (
            <div key={x.id} className="dw-stop" data-s={st}>
              <div className="dw-seq" style={{
                background: st === "done" ? "var(--go)" : st === "exc" ? "var(--stop)"
                  : st === "now" ? "var(--hiviz)" : isPickup(x) ? "var(--sea)" : "var(--ink)",
                color: st === "now" ? "var(--ink)" : "#fff",
              }}>
                {st === "done" ? "✓" : st === "exc" ? "!" : L[x.id]}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <b style={{ fontSize: 14 }}>{isPickup(x) ? "Collect from" : "Deliver to"} {x.name}</b>
                <p className="dw-note" style={{ margin: "2px 0 6px" }}>
                  {x.address}{x.window ? ` · ${x.window}` : ""}{x.ref ? ` · ${x.ref}` : ""}
                </p>
                {x.pin?.lat != null && (
                  <p className="dw-note dw-data" style={{ margin: "0 0 6px" }}>
                    <MapPin size={11} /> Exact pin {x.pin.lat}, {x.pin.lng} — the driver navigates to this, not the street address.
                  </p>
                )}
                <span className="dw-tag" data-t={OUTCOMES[x.status]?.tone || "wait"}>
                  {x.status === "done"
                    ? (isPickup(x) ? `Collected ${hhmm(x.departedAt)}` : `Signed by ${x.receiver} · ${hhmm(x.deliveredAt)}`)
                    : x.status === "wait" ? (st === "now" ? "Driver heading here" : "Waiting")
                      : `${OUTCOMES[x.status]?.label}${x.reason ? ` · ${x.reason}` : ""}`}
                </span>{" "}
                <span className="dw-note dw-data">{cnt} item{cnt === 1 ? "" : "s"}</span>
                {dw > 0 && (
                  <p className="dw-note dw-data" style={{ margin: "4px 0 0" }}>
                    On site {Math.floor(dw / 60)}h {String(dw % 60).padStart(2, "0")}m
                  </p>
                )}
                {x.notes && <p className="dw-note" style={{ color: "var(--stop)" }}>{x.notes}</p>}
                {x.sig && <img src={x.sig} alt="signature" style={{ height: 34, border: "1px solid var(--line)", background: "#fff", marginTop: 6 }} />}
                {(x.status === "done" || x.status === "refused" || x.status === "attempted") && isDrop(x) && (
                  <>
                    <div style={{ marginTop: 8 }}>
                      <button className="dw-btn dw-btn-sm" data-v="ghost" onClick={() => onBol(x.id)}>
                        <FileText size={13} /> BOL for Load {L[x.id]}
                      </button>
                    </div>
                    <NotifyClient trip={trip} stop={x} />
                  </>
                )}
              </div>
            </div>
          );
        })}
        <hr className="dw-hr" />
        <button className="dw-btn" data-v="ghost" onClick={() => onBol(null)}>
          <FileText size={15} /> Master BOL
        </button>
      </div>

      <div className="dw-card" style={{ borderLeft: "4px solid var(--sea)" }}>
        <div className="dw-eyebrow">Money</div>
        <h3 className="dw-display" style={{ fontSize: 20 }}>{usd(b.gross)} gross</h3>
        <hr className="dw-hr" />
        <div className="dw-kv dw-data">
          <div><i>Flat rate</i></div><div>{usd(b.flat)}</div>
          <div><i>Extra stops ({b.extras})</i></div><div>{usd(b.extraStops)}</div>
          {b.attempts.length > 0 && <><div><i>Failed attempts ({b.attempts.length})</i></div><div>{usd(b.attemptFees)}</div></>}
          <div><i>Detention ({b.det.hours.toFixed(2)} hr)</i></div><div>{usd(b.det.fee)}</div>
          {(b.timing.weekend || b.timing.afterHours) && (
            <>
              <div><i>{b.timing.weekend ? "Weekend service" : "After-hours service"}</i></div>
              <div>{usd(b.timing.fee)}</div>
            </>
          )}
          <div><i>Fuel ({b.fuelPct}%)</i></div><div>{usd(b.fuel)}</div>
          <div><i>Other</i></div><div>{usd(b.other)}</div>
        </div>
        <div className="dw-row" style={{ marginTop: 10 }}>
          <Field label="Flat rate ($)" value={trip.flatRate} onChange={(x) => onPatch({ flatRate: num(x) })} mode="decimal" />
          <Field label="Other ($)" value={trip.extraCharges} onChange={(x) => onPatch({ extraCharges: num(x) })} mode="decimal" />
        </div>
        {(b.timing.weekend || b.timing.afterHours) && (
          <>
            <p className="dw-note" style={{ color: "var(--sea)", fontWeight: 700 }}>
              Added automatically: {b.timing.why}.
            </p>
            <Field label={`${b.timing.weekend ? "Weekend" : "After-hours"} fee ($)`}
              value={b.timing.fee} mode="decimal"
              onChange={(x) => onPatch({ timingFeeOverride: num(x) })} />
            {b.timing.overridden && (
              <button className="dw-btn dw-btn-sm" data-v="ghost"
                onClick={() => onPatch({ timingFeeOverride: null })}>
                Back to standard {usd(b.timing.auto)}
              </button>
            )}
          </>
        )}
        <hr className="dw-hr" />
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 1, background: "#EDF3EE", border: "1px solid var(--go)", borderRadius: 3, padding: 9 }}>
            <div className="dw-eyebrow" style={{ color: "var(--go)" }}>Driver</div>
            <div className="dw-data" style={{ fontSize: 18, fontWeight: 700 }}>{usd(p.pay)}</div>
            <p className="dw-note" style={{ margin: 0, fontSize: 11 }}>{p.basis}</p>
          </div>
          <div style={{ flex: 1, background: "#EEF2F6", border: "1px solid var(--sea)", borderRadius: 3, padding: 9 }}>
            <div className="dw-eyebrow" style={{ color: "var(--sea)" }}>You keep</div>
            <div className="dw-data" style={{ fontSize: 18, fontWeight: 700 }}>{usd(b.gross - p.pay)}</div>
            <p className="dw-note" style={{ margin: 0, fontSize: 11 }}>
              {b.gross ? Math.round((b.gross - p.pay) / b.gross * 100) : 0}% before fuel cost
            </p>
          </div>
        </div>
      </div>

      {b.det.rows.length > 0 && (
        <div className="dw-card" style={{ borderLeft: "4px solid var(--stop)" }}>
          <div className="dw-eyebrow">Detention</div>
          <h3 className="dw-display" style={{ fontSize: 18 }}>{usd(b.det.fee)} chargeable</h3>
          <hr className="dw-hr" />
          {b.det.rows.map((r) => (
            <div key={r.id} style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "5px 0", borderBottom: "1px dashed var(--line)" }}>
              <span style={{ flex: 1, fontSize: 12.5 }}>{r.name}</span>
              <span className="dw-data" style={{ fontSize: 11.5, color: "var(--mute)" }}>
                {Math.floor(r.dwell / 60)}h {String(r.dwell % 60).padStart(2, "0")}m on site
              </span>
              <span className="dw-tag" data-t="exc">+{r.blk} min</span>
            </div>
          ))}
          <p className="dw-note">
            Free time {trip.freeMinPickup ?? RATES.freeMinPickup} min at pickups, {trip.freeMinDrop ?? RATES.freeMinDrop} at drops.
            Billed in 15-minute blocks from the driver's own timestamps.
          </p>
        </div>
      )}

      {(trip.pings || []).length > 0 && (
        <div className="dw-card">
          <div className="dw-eyebrow">Check-ins</div>
          <h3 className="dw-display" style={{ fontSize: 17 }}>{trip.pings.length} positions</h3>
          <hr className="dw-hr" />
          {trip.pings.map((x) => (
            <div key={x.id} style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "5px 0", borderBottom: "1px dashed var(--line)" }}>
              <span className="dw-data" style={{ fontSize: 12, color: "var(--mute)", flex: "0 0 46px" }}>{hhmm(x.at)}</span>
              <span style={{ flex: 1, fontSize: 13 }}>{x.label}</span>
              {x.pos && (
                <a href={`https://www.google.com/maps/search/?api=1&query=${x.pos.lat},${x.pos.lng}`}
                  target="_blank" rel="noreferrer" className="dw-data" style={{ fontSize: 11, color: "var(--sea)" }}>
                  {x.pos.lat}, {x.pos.lng}
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {(trip.audit || []).length > 0 && (
        <div className="dw-card">
          <div className="dw-eyebrow">Record of changes</div>
          <h3 className="dw-display" style={{ fontSize: 17 }}>{trip.audit.length} events</h3>
          <hr className="dw-hr" />
          {[...trip.audit].reverse().map((e) => (
            <div key={e.id} style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "5px 0", borderBottom: "1px dashed var(--line)" }}>
              <span className="dw-data" style={{ fontSize: 11, color: "var(--mute)", flex: "0 0 46px" }}>{hhmm(e.at)}</span>
              <span style={{ flex: 1, fontSize: 12.5 }}>{e.what}</span>
              <span className="dw-note" style={{ fontSize: 10.5, margin: 0 }}>{e.who}</span>
            </div>
          ))}
        </div>
      )}

      {trip.status === "ready_to_close" && (
        <button className="dw-btn" data-v="go"
          onClick={() => onPatch({ status: "closed", closedAt: now(), audit: log("Closed out and ready to invoice") })}>
          <Lock size={16} /> Close out and invoice
        </button>
      )}
    </>
  );
}

/* ================================================================== */
/* Booking                                                            */
/* ================================================================== */

const blankStop = (kind = "drop") => ({
  id: uid(), kind, name: "", address: "", pin: null, window: "", ref: "",
  contact: "", contactPhone: "", contactEmail: "", status: "wait",
  arrivedAt: null, departedAt: null, deliveredAt: null,
});

function Booking({ drivers, vehicles, trips, onCreate, onCancel }) {
  const [f, setF] = useState({
    client: "", clientContact: "", clientPhone: "", clientEmail: "",
    driverId: "", vehicleId: "", date: new Date().toISOString().slice(0, 10),
    flatRate: "", notes: "",
  });
  const [stops, setStops] = useState([blankStop("pickup"), blankStop("drop")]);
  const set = (k) => (v) => setF({ ...f, [k]: v });
  const setStop = (id, k) => (v) =>
    setStops(stops.map((s) => (s.id === id ? { ...s, [k]: (v && v.target) ? v.target.value : v } : s)));
  const move = (i, dir) => {
    const n = [...stops]; const j = i + dir;
    if (j < 0 || j >= n.length) return;
    [n[i], n[j]] = [n[j], n[i]]; setStops(n);
  };

  const L = labelsOf(stops);
  const nPick = stops.filter(isPickup).length;
  const nDrop = stops.filter(isDrop).length;
  const driver = drivers.find((x) => x.id === f.driverId);
  const preview = billingOf({ flatRate: num(f.flatRate), stops: stops.map((s) => ({ ...s, status: "done" })), items: [] });
  const clash = trips.find((t) => t.vehicleId === f.vehicleId && t.status !== "closed");
  const nextNo = 1044 + trips.filter((t) => Number(t.tripNo.replace("TL-", "")) >= 1044).length;

  return (
    <div className="dw-card" style={{ borderLeft: "4px solid var(--hiviz)" }}>
      <div className="dw-eyebrow">New booking</div>
      <h3 className="dw-display" style={{ fontSize: 20 }}>Book a trip</h3>
      <hr className="dw-hr" />

      <div className="dw-eyebrow" style={{ marginBottom: 6 }}><Building2 size={11} /> Client</div>
      <Field label="Company" value={f.client} onChange={set("client")} placeholder="Who is paying" />
      <div className="dw-row">
        <Field label="Contact" value={f.clientContact} onChange={set("clientContact")} />
        <Field label="Phone" value={f.clientPhone} onChange={set("clientPhone")} />
      </div>
      <Field label="Email" value={f.clientEmail} onChange={set("clientEmail")} />

      <hr className="dw-hr" />
      <div className="dw-eyebrow" style={{ marginBottom: 6 }}><User size={11} /> Driver &amp; vehicle</div>
      <div className="dw-fld">
        <label>Driver</label>
        <select value={f.driverId} onChange={(e) => setF({ ...f, driverId: e.target.value })}>
          <option value="">— pick a driver —</option>
          {drivers.filter((d) => d.active).map((d) => (
            <option key={d.id} value={d.id}>{d.name} · {d.payType === "percent" ? `${d.payRate}%` : usd(d.payRate)}</option>
          ))}
        </select>
      </div>
      <div className="dw-fld">
        <label>Vehicle</label>
        <select value={f.vehicleId} onChange={(e) => setF({ ...f, vehicleId: e.target.value })}>
          <option value="">— pick a unit —</option>
          {vehicles.filter((v) => v.active).map((v) => <option key={v.id} value={v.id}>Unit {v.unitNo} · {v.type}</option>)}
        </select>
      </div>
      {clash && f.vehicleId && (
        <p className="dw-note" style={{ color: "var(--stop)", fontWeight: 700 }}>
          That unit is already out on {clash.tripNo}.
        </p>
      )}
      <Field label="Date" type="date" value={f.date} onChange={set("date")} />
      {(() => {
        const d = f.date ? new Date(f.date + "T00:00:00") : null;
        const day = d && !isNaN(d) ? d.getDay() : null;
        if (day !== 0 && day !== 6) return null;
        return (
          <p className="dw-note" style={{ color: "var(--sea)", fontWeight: 700 }}>
            That's a {day === 0 ? "Sunday" : "Saturday"} — a {usd(RATES.weekendFee)} weekend fee is added automatically.
          </p>
        );
      })()}

      <hr className="dw-hr" />
      <div className="dw-eyebrow" style={{ marginBottom: 6 }}>
        <MapPin size={11} /> Route · {nPick} pickup{nPick === 1 ? "" : "s"}, {nDrop} drop{nDrop === 1 ? "" : "s"}
      </div>
      <p className="dw-note" style={{ marginTop: 0 }}>
        The driver works straight down this list. Put each pickup above the drops it feeds.
      </p>

      <RouteSuggest stops={stops} onApply={setStops} />

      {stops.map((s, i) => (
        <div key={s.id} style={{ border: "1px solid var(--line)", borderLeft: `4px solid ${isPickup(s) ? "var(--sea)" : "var(--ink)"}`, borderRadius: 3, padding: 10, marginBottom: 8, background: "#fff" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <div className="dw-seq" style={{ width: 24, height: 24, flex: "0 0 24px", fontSize: 12, background: isPickup(s) ? "var(--sea)" : "var(--ink)" }}>{L[s.id]}</div>
            <button onClick={() => setStops(stops.map((x) => (x.id === s.id ? { ...x, kind: isPickup(x) ? "drop" : "pickup" } : x)))}
              style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", padding: "4px 8px", borderRadius: 3, cursor: "pointer", border: "1px solid var(--line)", background: isPickup(s) ? "var(--sea)" : "var(--ink)", color: "#fff" }}>
              {isPickup(s) ? "Pickup" : "Drop"}
            </button>
            <div style={{ marginLeft: "auto", display: "flex", gap: 3 }}>
              <button onClick={() => move(i, -1)} disabled={i === 0} aria-label="Up"
                style={{ background: "none", border: "1px solid var(--line)", borderRadius: 2, padding: "3px 5px", cursor: "pointer", opacity: i === 0 ? .35 : 1 }}><ArrowUp size={12} /></button>
              <button onClick={() => move(i, 1)} disabled={i === stops.length - 1} aria-label="Down"
                style={{ background: "none", border: "1px solid var(--line)", borderRadius: 2, padding: "3px 5px", cursor: "pointer", opacity: i === stops.length - 1 ? .35 : 1 }}><ArrowDown size={12} /></button>
              {stops.length > 1 && (
                <button onClick={() => setStops(stops.filter((x) => x.id !== s.id))} aria-label="Remove"
                  style={{ background: "none", border: "1px solid var(--line)", borderRadius: 2, padding: "3px 5px", cursor: "pointer", color: "var(--stop)" }}><Trash2 size={12} /></button>
              )}
            </div>
          </div>
          <Field label="Site name" value={s.name} onChange={setStop(s.id, "name")}
            placeholder={isPickup(s) ? "Warehouse 3" : "Katy Distribution"} />
          <AddressField label="Address" value={s.address} onChange={setStop(s.id, "address")}
            placeholder="e.g. 1500 Katy Fwy, Katy TX — or a business name" />
          <PinPaste value={s.pin} onApply={(p) => setStop(s.id, "pin")(p)} />
          <div className="dw-row">
            <Field label={isPickup(s) ? "Appointment" : "Delivery window"} value={s.window} onChange={setStop(s.id, "window")} />
            <Field label="Reference" value={s.ref} onChange={setStop(s.id, "ref")} placeholder="PO-4471" />
          </div>
          <div className="dw-row">
            <Field label="Site contact" value={s.contact} onChange={setStop(s.id, "contact")} />
            <Field label="Phone" value={s.contactPhone} onChange={setStop(s.id, "contactPhone")} />
          </div>
          <Field label="Email for notices" value={s.contactEmail} onChange={setStop(s.id, "contactEmail")} />
        </div>
      ))}

      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        <button className="dw-btn dw-btn-sm" data-v="ghost" onClick={() => setStops([...stops, blankStop("pickup")])}>
          <Plus size={13} /> Add pickup
        </button>
        <button className="dw-btn dw-btn-sm" data-v="ghost" onClick={() => setStops([...stops, blankStop("drop")])}>
          <Plus size={13} /> Add drop
        </button>
      </div>

      <hr className="dw-hr" />
      <Field label="Flat rate ($)" value={f.flatRate} onChange={set("flatRate")} mode="decimal" placeholder="650" />
      {num(f.flatRate) > 0 && (
        <div style={{ background: "#EEF2F6", border: "1px solid var(--sea)", borderRadius: 3, padding: 9, marginBottom: 10 }}>
          <div className="dw-data" style={{ fontSize: 13, fontWeight: 700 }}>Gross {usd(preview.gross)}</div>
          <p className="dw-note" style={{ margin: 0 }}>
            Flat + {preview.extras} extra stop(s) + {RATES.fuelPct}% fuel.
            {driver && ` ${driver.name} gets ${usd(payOf({ flatRate: num(f.flatRate), stops: stops.map((s) => ({ ...s, status: "done" })), items: [], payAdjust: 0 }, driver).pay)}.`}
          </p>
        </div>
      )}

      <button className="dw-btn" data-v="go" disabled={!f.driverId || !num(f.flatRate)}
        onClick={() => onCreate({
          id: uid(), tripNo: `TL-${nextNo}`,
          client: f.client.trim() || "—", clientContact: f.clientContact.trim(),
          clientPhone: f.clientPhone.trim(), clientEmail: f.clientEmail.trim(),
          driverId: f.driverId, driverName: driver?.name || "",
          vehicleId: f.vehicleId || null, date: f.date,
          flatRate: num(f.flatRate), extraStopRate: RATES.extraStopRate, attemptRate: RATES.attemptRate,
          extraCharges: 0, payAdjust: 0, status: "assigned",
          stops: stops.map((s) => ({ ...s, name: s.name.trim() || (isPickup(s) ? "Pickup" : "Drop"), address: s.address.trim() || "To be confirmed" })),
          items: [], pings: [], routeChange: null,
          audit: [{ id: uid(), at: now(), who: "Dispatch", what: `Booked and assigned to ${driver?.name}` }],
        })}>
        Assign to driver
      </button>
      <button className="dw-btn dw-btn-sm" data-v="ghost" onClick={onCancel}>Cancel</button>
    </div>
  );
}

/* ================================================================== */
/* Shell                                                              */
/* ================================================================== */

const NAV = [
  { k: "board", label: "Board", icon: <Route size={16} /> },
  { k: "trips", label: "Trips", icon: <ClipboardList size={16} /> },
];

function NavList({ view, go, onClose, onNew }) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px 12px" }}>
        <Truck size={20} color="#F2B705" />
        <h1 className="dw-display" style={{ margin: 0, fontSize: 16, color: "#fff" }}>Truck Loading</h1>
        {onClose && (
          <button onClick={onClose} aria-label="Close"
            style={{ marginLeft: "auto", background: "none", border: 0, color: "#9FB0BF", cursor: "pointer" }}>
            <X size={18} />
          </button>
        )}
      </div>
      <button className="dw-item dw-cta" onClick={() => { onNew(); onClose?.(); }}>
        <Plus size={16} />New booking
      </button>
      <div className="dw-navhead">Dispatcher</div>
      {NAV.map((it) => (
        <button key={it.k} className="dw-item" data-on={view === it.k ? "1" : "0"}
          onClick={() => { go(it.k); onClose?.(); }}>{it.icon}{it.label}</button>
      ))}
      <div className="dw-navhead">Other workspaces</div>
      <div style={{ padding: "0 13px 12px", fontSize: 11.5, color: "#7E93A5", lineHeight: 1.5 }}>
        Admin, Driver and Customer are separate demos.
      </div>
    </>
  );
}

export default function DispatcherWorkspace() {
  const [view, setView] = useState("board");
  const [menu, setMenu] = useState(false);
  const [st, setSt] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [bolStop, setBolStop] = useState(undefined); // undefined = closed, null = master

  useEffect(() => { load().then(setSt); }, []);

  const put = useCallback((patch) => {
    setSt((prev) => { const next = { ...prev, ...patch }; save(next); return next; });
  }, []);

  if (!st) {
    return <div className="dw"><style>{CSS}</style>
      <div className="dw-empty"><ClipboardList size={26} /><p>Opening the desk…</p></div></div>;
  }

  const trip = st.trips.find((t) => t.id === activeId);
  const patchTrip = (p) => put({ trips: st.trips.map((t) => (t.id === activeId ? { ...t, ...p } : t)) });

  const splitCreate = (src, stopIds, toDriver, why) => {
    const moving = (src.stops || []).filter((x) => stopIds.includes(x.id));
    const nd = st.drivers.find((d) => d.id === toDriver);
    const map = {};
    const childStops = moving.map((x) => { const nid = uid(); map[x.id] = nid; return { ...x, id: nid, status: "wait" }; });
    const child = {
      ...src, id: uid(), tripNo: `${src.tripNo}-B`, driverId: toDriver, driverName: nd?.name,
      status: "assigned", stops: childStops,
      items: (src.items || []).filter((i) => map[i.stopId]).map((i) => ({ ...i, id: uid(), stopId: map[i.stopId] })),
      flatRate: 0, extraCharges: 0, payAdjust: 0, pings: [], routeChange: null, closedAt: null,
      audit: [{ id: uid(), at: now(), who: "Dispatch", what: `Created from ${src.tripNo}${why ? ` — ${why}` : ""}` }],
    };
    const parentStops = (src.stops || []).map((x) => (stopIds.includes(x.id) ? { ...x, status: "moved" } : x));
    const nothingOpen = parentStops.filter((x) => x.status !== "moved").every((x) => !isOpen(x));
    put({
      trips: [
        ...st.trips.map((t) => (t.id === src.id ? {
          ...t, stops: parentStops,
          status: nothingOpen && t.status !== "closed" ? "ready_to_close" : t.status,
          audit: [...(t.audit || []), { id: uid(), at: now(), who: "Dispatch", what: `${moving.length} stop(s) handed to ${nd?.name}${why ? ` — ${why}` : ""}` }],
        } : t)),
        child,
      ],
    });
    setActiveId(child.id);
  };

  const page = () => {
    if (view === "booking") {
      return <Booking drivers={st.drivers} vehicles={st.vehicles} trips={st.trips}
        onCancel={() => setView("trips")}
        onCreate={(t) => { put({ trips: [...st.trips, t] }); setActiveId(t.id); setView("detail"); }} />;
    }
    if (view === "detail" && trip) {
      if (bolStop !== undefined) {
        return <Bol trip={trip} vehicles={st.vehicles}
          stop={bolStop ? trip.stops.find((x) => x.id === bolStop) : null}
          onBack={() => setBolStop(undefined)} />;
      }
      return <TripDetail trip={trip} drivers={st.drivers} vehicles={st.vehicles} trips={st.trips}
        onPatch={patchTrip} onSplitCreate={splitCreate}
        onBack={() => setView("trips")} onBol={(id) => setBolStop(id)} />;
    }
    if (view === "trips") {
      return <TripsPage trips={st.trips} drivers={st.drivers} vehicles={st.vehicles}
        onOpen={(id) => { setActiveId(id); setBolStop(undefined); setView("detail"); }}
        onNew={() => setView("booking")} />;
    }
    return <Board trips={st.trips} drivers={st.drivers}
      onOpen={(id) => { setActiveId(id); setBolStop(undefined); setView("detail"); }}
      onNew={() => setView("booking")} />;
  };

  const title = view === "booking" ? "New booking"
    : view === "detail" ? (bolStop !== undefined ? "Bill of lading" : trip?.tripNo || "Trip")
      : view === "trips" ? "Trips" : "Board";

  return (
    <div className="dw">
      <style>{CSS}</style>
      <div className="dw-shell">
        <nav className="dw-nav dw-noprint">
          <NavList view={view} go={setView} onNew={() => setView("booking")} />
        </nav>
        {menu && (
          <>
            <div className="dw-scrim dw-noprint" onClick={() => setMenu(false)} />
            <nav className="dw-drawer dw-noprint">
              <NavList view={view} go={setView} onNew={() => setView("booking")} onClose={() => setMenu(false)} />
            </nav>
          </>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="dw-bar dw-noprint">
            <button className="dw-burger" onClick={() => setMenu(true)} aria-label="Menu"><Menu size={20} /></button>
            <h1 className="dw-display">{title}</h1>
            <span className="dw-tag" data-t="done" style={{ marginLeft: "auto" }}>Dispatcher</span>
          </div>
          <div className="dw-main">{page()}</div>
        </div>
      </div>
    </div>
  );
}
