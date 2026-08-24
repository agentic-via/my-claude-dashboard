import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Truck, Building2, User, Users, ShieldCheck, SlidersHorizontal, Plus, Trash2,
  Check, X, PenLine, AlertTriangle, Lock, ClipboardList, Menu, TrendingUp,
} from "lucide-react";

/* ==================================================================
   Truck Loading — ADMIN / OWNER workspace
   Standalone demo. Its own sample data, its own storage key.
   ================================================================== */

const KEY = "tl-admin-demo:v1";
const DAY = 86400000;

const uid = () => Math.random().toString(36).slice(2, 9);
const now = () => new Date().toISOString();
const isoIn = (d) => new Date(Date.now() + d * DAY).toISOString().slice(0, 10);
const num = (x) => Number(x) || 0;
const usd = (n) =>
  "$" + num(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (iso) =>
  iso ? new Date(iso).toLocaleDateString([], { day: "2-digit", month: "short" }) : "—";

/* ---------------- compliance ---------------- */

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d)) return null;
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return Math.round((d - t) / DAY);
}

function expiryState(dateStr) {
  const n = daysUntil(dateStr);
  if (n === null) return { k: "missing", label: "Not recorded", tone: "exc", n: -9999 };
  if (n < 0) return { k: "expired", label: `Expired ${Math.abs(n)}d ago`, tone: "exc", n };
  if (n <= 7) return { k: "due", label: `${n}d left`, tone: "exc", n };
  if (n <= 30) return { k: "soon", label: `${n}d left`, tone: "now", n };
  return { k: "ok", label: `${n}d left`, tone: "done", n };
}

const VEHICLE_DOCS = [
  { k: "insuranceExpiry", label: "Insurance" },
  { k: "safetyExpiry", label: "Safety inspection" },
  { k: "plateExpiry", label: "Plate / registration" },
];
const DRIVER_DOCS = [
  { k: "licenceExpiry", label: "Driver's licence" },
  { k: "medicalExpiry", label: "Medical certificate" },
];

function serviceState(v) {
  const left = num(v.nextServiceOdo) - num(v.odometer);
  if (!num(v.nextServiceOdo)) return null;
  if (left <= 0) return { k: "expired", label: `Overdue ${Math.abs(left).toLocaleString()} mi`, tone: "exc", n: -1 };
  if (left <= 2000) return { k: "soon", label: `${left.toLocaleString()} mi`, tone: "now", n: 20 };
  return { k: "ok", label: `${left.toLocaleString()} mi`, tone: "done", n: 200 };
}

/* ---------------- money ---------------- */

function weekendFeeOf(trip, rates) {
  const d = trip.date ? new Date(trip.date + "T00:00:00") : null;
  const day = d && !isNaN(d) ? d.getDay() : null;
  if (day !== 0 && day !== 6) return 0;
  return num(trip.timingFeeOverride != null ? trip.timingFeeOverride : rates.weekendFee);
}

function grossOf(trip, rates) {
  const flat = num(trip.flatRate);
  const extras = Math.max(0, num(trip.stops) - 2);
  const extraStops = extras * num(rates.extraStopRate);
  const linehaul = flat + extraStops;
  const fuel = linehaul * num(rates.fuelPct) / 100;
  return linehaul + fuel + weekendFeeOf(trip, rates) + num(trip.extraCharges);
}

/* is this driver / unit legal to dispatch today? */
function blockers(vehicle, driver) {
  const out = [];
  if (vehicle) VEHICLE_DOCS.forEach((doc) => {
    const st = expiryState(vehicle[doc.k]);
    if (st.k === "expired" || st.k === "missing") {
      out.push(`Unit ${vehicle.unitNo}: ${doc.label.toLowerCase()} ${st.k === "missing" ? "not recorded" : "expired"}`);
    }
  });
  if (driver) DRIVER_DOCS.forEach((doc) => {
    const st = expiryState(driver[doc.k]);
    if (st.k === "expired" || st.k === "missing") {
      out.push(`${driver.name}: ${doc.label.toLowerCase()} ${st.k === "missing" ? "not recorded" : "expired"}`);
    }
  });
  return out;
}

/* ---------------- pay ---------------- */

function payOf(trip, driver, rates = DEFAULT_RATES) {
  const g = grossOf(trip, rates);
  const adj = num(trip.payAdjust);
  if (!driver) return { gross: g, base: 0, adjust: adj, pay: adj, basis: "no driver record" };
  const r = num(driver.payRate);
  let base, basis;
  if (driver.payType === "flat") { base = r; basis = `${usd(r)} flat`; }
  else if (driver.payType === "per_stop") { base = r * num(trip.stops); basis = `${usd(r)} × ${num(trip.stops)} stops`; }
  else { base = g * r / 100; basis = `${r}% of ${usd(g)}`; }
  return { gross: g, base, adjust: adj, pay: base + adj, basis };
}

/* ---------------- permissions ---------------- */

const PERMS = [
  { k: "bookTrips", label: "Book and assign trips", hint: "Create trips, pick drivers, set the route" },
  { k: "seeRates", label: "See what the client is charged", hint: "Flat rate, detention, gross revenue" },
  { k: "editRates", label: "Change client rates", hint: "Edit any charge on a trip" },
  { k: "seeDriverPay", label: "See driver pay", hint: "What each driver earns per trip" },
  { k: "editDriverPay", label: "Adjust driver pay", hint: "Override the formula after a trip" },
  { k: "manageDrivers", label: "Manage the driver roster", hint: "Add drivers, set percentages" },
  { k: "manageFleet", label: "Manage the fleet", hint: "Add trucks, set capacity and expiry dates" },
  { k: "splitTrips", label: "Reassign and split trips", hint: "Hand stops to another driver mid-route" },
  { k: "exportDocs", label: "Open BOLs and invoices", hint: "View and print customer paperwork" },
  { k: "notifyClients", label: "Message clients", hint: "Send delivery notices" },
];

const DEFAULT_RATES = {
  freeMinPickup: 120, freeMinDrop: 60, detentionRate: 60,
  fuelPct: 18, afterHoursFee: 90, weekendFee: 120,
  extraStopRate: 75, attemptRate: 100,
};

/* ---------------- sample data ---------------- */

function seedState() {
  const drivers = [
    { id: "d1", name: "Harjit Singh", phone: "+1 682 555 0142", email: "harjit@example.com",
      payType: "percent", payRate: 25, active: true,
      licenceNo: "S1234-56789", licenceClass: "AZ",
      licenceExpiry: isoIn(400), medicalExpiry: isoIn(48), notes: "" },
    { id: "d2", name: "Marcus Bell", phone: "+1 682 555 0198", email: "marcus@example.com",
      payType: "percent", payRate: 28, active: true,
      licenceNo: "B7788-11220", licenceClass: "DZ",
      licenceExpiry: isoIn(95), medicalExpiry: isoIn(12), notes: "Weekends only" },
    { id: "d3", name: "Ana Ruiz", phone: "+1 682 555 0121", email: "ana@example.com",
      payType: "flat", payRate: 240, active: true,
      licenceNo: "R2211-99871", licenceClass: "AZ",
      licenceExpiry: isoIn(-6), medicalExpiry: isoIn(210), notes: "" },
  ];

  const vehicles = [
    { id: "v1", unitNo: "T-104", type: "Tractor + 53' dry van", plate: "AJ-8821",
      make: "Freightliner", model: "Cascadia", year: "2021", trailerNo: "TR-2290",
      capacityLb: 44000, defaultDriverId: "d1", active: true, notes: "",
      insuranceExpiry: isoIn(240), safetyExpiry: isoIn(21), plateExpiry: isoIn(150),
      odometer: 418200, nextServiceOdo: 425000 },
    { id: "v2", unitNo: "T-107", type: "Straight truck 26'", plate: "BK-3390",
      make: "Hino", model: "268A", year: "2019", trailerNo: "",
      capacityLb: 12000, defaultDriverId: "d2", active: true, notes: "Liftgate",
      insuranceExpiry: isoIn(310), safetyExpiry: isoIn(120), plateExpiry: isoIn(-4),
      odometer: 96400, nextServiceOdo: 97000 },
    { id: "v3", unitNo: "T-111", type: "Tractor + 48' flatbed", plate: "CC-1042",
      make: "Volvo", model: "VNL", year: "2020", trailerNo: "FB-880",
      capacityLb: 48000, defaultDriverId: "d3", active: true, notes: "Straps and coil racks",
      insuranceExpiry: isoIn(60), safetyExpiry: isoIn(340), plateExpiry: isoIn(200),
      odometer: 302900, nextServiceOdo: 310000 },
  ];

  const staff = [
    { id: "u1", name: "You", role: "owner", perms: Object.fromEntries(PERMS.map((p) => [p.k, true])) },
    { id: "u2", name: "Dana Okafor", role: "dispatcher", away: false, awayUntil: "",
      perms: { bookTrips: true, seeRates: true, exportDocs: true, notifyClients: true,
        splitTrips: true, manageFleet: true } },
    { id: "u3", name: "Priya Nair", role: "dispatcher", away: false, awayUntil: "",
      perms: { bookTrips: true, exportDocs: true } },
  ];

  const trip = (n, driverId, vehicleId, client, stops, flatRate, daysAgo, status, extra = 0, payAdjust = 0) => ({
    id: uid(), tripNo: `TL-${n}`, driverId, vehicleId, client, stops,
    flatRate, extraCharges: extra, payAdjust,
    status,
    dispatcherId: "u2",
    closedAt: status === "closed" ? new Date(Date.now() - daysAgo * DAY).toISOString() : null,
    date: isoIn(-daysAgo),
  });

  const trips = [
    trip(1036, "d1", "v1", "Meridian Freight Co.", 4, 720, 6, "closed"),
    trip(1037, "d2", "v2", "Arsenal Circulating", 3, 620, 5, "closed"),
    trip(1038, "d1", "v1", "Meridian Freight Co.", 5, 850, 4, "closed", 120),
    trip(1039, "d3", "v3", "Northline Steel", 2, 580, 3, "closed", 0, -60),
    trip(1040, "d2", "v2", "Arsenal Circulating", 6, 940, 2, "closed", 90),
    trip(1041, "d1", "v1", "Northline Steel", 3, 660, 1, "closed", 0, 45),
    trip(1042, "d1", "v1", "Meridian Freight Co.", 5, 820, 0, "running"),
    trip(1043, "d3", "v3", "Northline Steel", 3, 700, -1, "assigned"),
  ];

  return {
    staff, drivers, vehicles, trips,
    policy: { driverSeesPay: true, driverSeesClientRate: false, rates: { ...DEFAULT_RATES } },
  };
}

async function load() {
  try {
    const r = await window.storage.get(KEY);
    if (!r) return seedState();
    const p = JSON.parse(r.value);
    const b = seedState();
    return {
      staff: p.staff || b.staff, drivers: p.drivers || b.drivers,
      vehicles: p.vehicles || b.vehicles, trips: p.trips || b.trips,
      policy: { ...b.policy, ...(p.policy || {}), rates: { ...DEFAULT_RATES, ...((p.policy || {}).rates || {}) } },
    };
  } catch {
    return seedState();
  }
}
async function save(st) {
  try { await window.storage.set(KEY, JSON.stringify(st)); }
  catch (e) { console.error("save failed", e); }
}

/* ================================================================== */
/* Styles                                                             */
/* ================================================================== */

const CSS = `
:root{
  --ink:#16202B; --ink2:#2A3A4B; --mute:#6B7A88;
  --dock:#DFE1DE; --card:#F8F9F7; --line:#C3C7C2;
  --hiviz:#F2B705; --sea:#2B5F8A; --go:#2E7D53; --stop:#B3392F;
}
*{box-sizing:border-box}
.aw{ background:var(--dock); color:var(--ink); min-height:100vh;
  font-family:system-ui,-apple-system,"Segoe UI",sans-serif; font-size:15px; line-height:1.45 }
.aw-display{ font-family:"Arial Narrow","Roboto Condensed",system-ui,sans-serif;
  text-transform:uppercase; letter-spacing:.06em; font-weight:800; line-height:1.05 }
.aw-data{ font-family:ui-monospace,"SF Mono",Menlo,monospace; font-variant-numeric:tabular-nums }
.aw-eyebrow{ font-size:10px; letter-spacing:.18em; text-transform:uppercase; color:var(--mute); font-weight:700 }

.aw-shell{ display:flex; min-height:100vh }
.aw-nav{ display:none }
.aw-main{ flex:1; min-width:0; max-width:800px; margin:0 auto; padding:14px; padding-bottom:40px }
.aw-bar{ background:var(--ink); color:#fff; padding:12px 14px; display:flex; align-items:center; gap:10px; position:sticky; top:0; z-index:20 }
.aw-bar h1{ margin:0; font-size:17px }
.aw-burger{ background:none; border:0; color:#fff; cursor:pointer; display:flex; padding:2px }

.aw-item{ display:flex; align-items:center; gap:10px; width:100%; padding:11px 13px; border:0; border-radius:3px;
  background:none; color:#C6D2DC; font-size:13.5px; font-weight:700; cursor:pointer; text-align:left; margin-bottom:2px }
.aw-item[data-on="1"]{ background:var(--hiviz); color:var(--ink) }
.aw-item:hover{ background:rgba(255,255,255,.07) }
.aw-item[data-on="1"]:hover{ background:var(--hiviz) }
.aw-navhead{ font-size:10px; letter-spacing:.16em; text-transform:uppercase; color:#7E93A5; font-weight:800; padding:14px 13px 5px }
.aw-scrim{ position:fixed; inset:0; background:rgba(10,16,22,.55); z-index:40 }
.aw-drawer{ position:fixed; top:0; left:0; bottom:0; width:242px; background:var(--ink); z-index:41; padding:12px; overflow:auto }
@media (min-width:760px){
  .aw-nav{ display:block; width:224px; flex:0 0 224px; background:var(--ink); padding:12px; position:sticky; top:0; height:100vh; overflow:auto }
  .aw-burger{ display:none }
  .aw-main{ padding:20px 24px }
}

.aw-card{ background:var(--card); border:1px solid var(--line); border-radius:3px; padding:14px; margin-bottom:12px }
.aw-card h3{ margin:0 0 3px; font-size:16px }
.aw-hr{ border:0; border-top:1px dashed var(--line); margin:12px 0 }
.aw-note{ font-size:12px; color:var(--mute); margin:6px 0 0 }

.aw-btn{ display:flex; align-items:center; justify-content:center; gap:8px; width:100%; padding:13px; border:0; border-radius:3px;
  background:var(--ink); color:#fff; font-size:13.5px; font-weight:800; letter-spacing:.07em; text-transform:uppercase;
  cursor:pointer; font-family:"Arial Narrow","Roboto Condensed",system-ui,sans-serif; margin-bottom:10px }
.aw-btn[data-v="go"]{ background:var(--go) } .aw-btn[data-v="hiviz"]{ background:var(--hiviz); color:var(--ink) }
.aw-btn[data-v="ghost"]{ background:none; color:var(--ink); border:1px solid var(--line) }
.aw-btn[data-v="danger"]{ background:none; color:var(--stop); border:1px solid var(--line) }
.aw-btn:disabled{ background:#AEB6BD; cursor:not-allowed }
.aw-btn-sm{ width:auto; padding:8px 12px; font-size:11.5px; margin-bottom:0 }
button:focus-visible,input:focus-visible,select:focus-visible{ outline:3px solid var(--sea); outline-offset:2px }

.aw-fld{ margin-bottom:10px }
.aw-fld label{ display:block; font-size:10px; letter-spacing:.14em; text-transform:uppercase; color:var(--mute); font-weight:700; margin-bottom:4px }
.aw-fld input,.aw-fld select{ width:100%; padding:10px; border:1px solid var(--line); border-radius:2px; background:#fff;
  font-size:15px; font-family:ui-monospace,Menlo,monospace; color:var(--ink) }
.aw-row{ display:flex; gap:8px } .aw-row>*{ flex:1 }

.aw-tag{ display:inline-block; padding:2px 7px; border-radius:2px; font-size:10px; font-weight:800; letter-spacing:.09em; text-transform:uppercase }
.aw-tag[data-t="done"]{ background:#DCEEE3; color:var(--go) }
.aw-tag[data-t="now"]{ background:#FFF0C2; color:#6B5200 }
.aw-tag[data-t="wait"]{ background:#E4E7E4; color:var(--mute) }
.aw-tag[data-t="exc"]{ background:#F8E3E1; color:var(--stop) }

.aw-kv{ display:grid; grid-template-columns:1fr auto; gap:3px 10px; font-size:13px }
.aw-kv i{ font-style:normal; color:var(--mute) }

.aw-stat{ display:flex; gap:8px; margin-bottom:12px }
.aw-stat>div{ flex:1; border-radius:3px; padding:11px; border:1px solid var(--line); background:#fff }
.aw-stat b{ display:block; font-size:19px; font-family:ui-monospace,monospace; margin-top:3px }

.aw-perm{ display:flex; align-items:center; gap:10px; padding:9px 0; border-bottom:1px dashed var(--line) }
.aw-perm span{ flex:1; font-size:13px; font-weight:700 }
.aw-perm small{ display:block; color:var(--mute); font-size:11px; font-weight:400 }
.aw-sw{ width:42px; height:23px; border-radius:12px; border:1px solid var(--line); position:relative; cursor:pointer; flex:0 0 42px }
.aw-sw i{ position:absolute; top:2px; width:17px; height:17px; border-radius:50%; background:#fff; transition:left .15s }

.aw-row2{ display:flex; gap:8px; align-items:baseline; padding:6px 0; border-bottom:1px dashed var(--line) }
.aw-bar-mini{ height:8px; border-radius:4px; background:#D2D6D2; overflow:hidden; margin-top:6px }
.aw-bar-mini div{ height:100%; background:var(--go) }
.aw-empty{ text-align:center; padding:26px 14px; color:var(--mute); font-size:14px }
`;

/* ================================================================== */
/* Small pieces                                                       */
/* ================================================================== */
function Toggle({ on, onChange, tone = "var(--go)" }) {
  return (
    <button className="aw-sw" aria-pressed={on} onClick={() => onChange(!on)}
      style={{ background: on ? tone : "#CFD4D0" }}>
      <i style={{ left: on ? 21 : 2 }} />
    </button>
  );
}

function Field({ label, value, onChange, type = "text", mode }) {
  return (
    <div className="aw-fld">
      <label>{label}</label>
      <input type={type} inputMode={mode} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function ComplianceBoard({ vehicles, drivers, onGo }) {
  const rows = [];
  vehicles.filter((v) => v.active).forEach((v) => {
    VEHICLE_DOCS.forEach((doc) => {
      const st = expiryState(v[doc.k]);
      if (st.k !== "ok") rows.push({ key: v.id + doc.k, who: `Unit ${v.unitNo}`, what: doc.label, st, to: "fleet" });
    });
    const sv = serviceState(v);
    if (sv && sv.k !== "ok") rows.push({ key: v.id + "svc", who: `Unit ${v.unitNo}`, what: "Service due", st: sv, to: "fleet" });
  });
  drivers.filter((d) => d.active).forEach((d) => {
    DRIVER_DOCS.forEach((doc) => {
      const st = expiryState(d[doc.k]);
      if (st.k !== "ok") rows.push({ key: d.id + doc.k, who: d.name, what: doc.label, st, to: "drivers" });
    });
  });
  rows.sort((a, b) => a.st.n - b.st.n);
  const bad = rows.filter((r) => r.st.k === "expired" || r.st.k === "missing").length;

  return (
    <div className="aw-card" style={{ borderLeft: `4px solid ${bad ? "var(--stop)" : rows.length ? "var(--hiviz)" : "var(--go)"}` }}>
      <div className="aw-eyebrow"><ShieldCheck size={11} /> Compliance</div>
      <h3 className="aw-display" style={{ fontSize: 19 }}>
        {bad ? `${bad} out of date` : rows.length ? `${rows.length} coming up` : "Everything current"}
      </h3>
      {rows.length === 0 ? (
        <p className="aw-note">Nothing expiring in the next 30 days.</p>
      ) : (
        <>
          <hr className="aw-hr" />
          {rows.map((r) => (
            <button key={r.key} className="aw-row2" onClick={() => onGo?.(r.to)}
              style={{ width: "100%", background: "none", border: 0, borderBottom: "1px dashed var(--line)", cursor: onGo ? "pointer" : "default", textAlign: "left" }}>
              <span style={{ flex: "0 0 96px", fontSize: 12.5, fontWeight: 700 }}>{r.who}</span>
              <span style={{ flex: 1, fontSize: 12.5 }}>{r.what}</span>
              <span className="aw-tag" data-t={r.st.tone}>{r.st.label}</span>
            </button>
          ))}
          <p className="aw-note">Expired items stop that unit or driver being dispatched.</p>
        </>
      )}
    </div>
  );
}

/* ================================================================== */
/* 1. Overview                                                        */
/* ================================================================== */

function Overview({ trips, drivers, vehicles, staff, onGo, rates = DEFAULT_RATES }) {
  const closed = trips.filter((t) => t.status === "closed");
  const revenue = closed.reduce((a, t) => a + grossOf(t, rates), 0);
  const wages = closed.reduce((a, t) => a + payOf(t, drivers.find((d) => d.id === t.driverId), rates).pay, 0);
  const margin = revenue - wages;
  const pct = revenue ? Math.round(margin / revenue * 100) : 0;

  const byDriver = drivers.map((d) => {
    const mine = closed.filter((t) => t.driverId === d.id);
    return {
      d,
      trips: mine.length,
      revenue: mine.reduce((a, t) => a + grossOf(t, rates), 0),
      pay: mine.reduce((a, t) => a + payOf(t, d, rates).pay, 0),
    };
  }).sort((a, b) => b.revenue - a.revenue);
  const top = byDriver[0]?.revenue || 1;

  const byClient = {};
  closed.forEach((t) => { byClient[t.client] = (byClient[t.client] || 0) + grossOf(t, rates); });
  const clients = Object.entries(byClient).sort((a, b) => b[1] - a[1]);

  return (
    <>
      <div className="aw-stat">
        <div>
          <span className="aw-eyebrow">Revenue</span>
          <b>{usd(revenue)}</b>
        </div>
        <div style={{ borderColor: "var(--go)" }}>
          <span className="aw-eyebrow" style={{ color: "var(--go)" }}>You keep</span>
          <b>{usd(margin)}</b>
        </div>
      </div>

      <div className="aw-card">
        <div className="aw-eyebrow"><TrendingUp size={11} /> Last {closed.length} closed trips</div>
        <h3 className="aw-display" style={{ fontSize: 19 }}>{pct}% margin before fuel</h3>
        <hr className="aw-hr" />
        <div className="aw-kv aw-data">
          <div><i>Billed to clients</i></div><div>{usd(revenue)}</div>
          <div><i>Paid to drivers</i></div><div>{usd(wages)}</div>
          <div><i>Gross margin</i></div><div><b>{usd(margin)}</b></div>
          <div><i>Average per trip</i></div><div>{usd(closed.length ? revenue / closed.length : 0)}</div>
          <div><i>Open right now</i></div><div>{trips.filter((t) => t.status !== "closed").length}</div>
        </div>
        <p className="aw-note">
          Margin is before fuel, insurance and maintenance. It is not profit.
        </p>
      </div>

      {staff.filter((u) => u.role === "dispatcher" && u.away).length > 0 && (
        <div className="aw-card" style={{ borderLeft: "4px solid var(--sea)", background: "#EAF1F8" }}>
          <div className="aw-eyebrow" style={{ color: "var(--sea)" }}>Cover</div>
          <h3 className="aw-display" style={{ fontSize: 18 }}>
            {staff.filter((u) => u.role === "dispatcher" && u.away).map((u) => u.name).join(", ")} away
          </h3>
          <p className="aw-note">You have the dispatch desk. Open Dispatch to book and manage trips.</p>
          <button className="aw-btn aw-btn-sm" data-v="ghost" style={{ marginTop: 8 }}
            onClick={() => onGo?.("dispatch")}>
            <ClipboardList size={13} /> Go to Dispatch
          </button>
        </div>
      )}

      <ComplianceBoard vehicles={vehicles} drivers={drivers} onGo={onGo} />

      <div className="aw-card">
        <div className="aw-eyebrow">By driver</div>
        <h3 className="aw-display" style={{ fontSize: 17 }}>Who is hauling what</h3>
        <hr className="aw-hr" />
        {byDriver.map((r) => (
          <div key={r.d.id} style={{ marginBottom: 11 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
              <b style={{ fontSize: 13.5, flex: 1 }}>{r.d.name}</b>
              <span className="aw-data" style={{ fontSize: 12.5 }}>{usd(r.revenue)}</span>
              <span className="aw-note" style={{ margin: 0, fontSize: 11 }}>{r.trips} trips</span>
            </div>
            <div className="aw-bar-mini">
              <div style={{ width: `${r.revenue / top * 100}%` }} />
            </div>
            <p className="aw-note" style={{ margin: "3px 0 0" }}>
              Earned {usd(r.pay)} · you kept {usd(r.revenue - r.pay)}
            </p>
          </div>
        ))}
      </div>

      <div className="aw-card">
        <div className="aw-eyebrow">By client</div>
        <h3 className="aw-display" style={{ fontSize: 17 }}>{clients.length} clients</h3>
        <hr className="aw-hr" />
        {clients.map(([name, amt]) => (
          <div key={name} className="aw-row2">
            <span style={{ flex: 1, fontSize: 13 }}>{name}</span>
            <span className="aw-data" style={{ fontSize: 12.5, fontWeight: 700 }}>{usd(amt)}</span>
            <span className="aw-note" style={{ margin: 0, fontSize: 11 }}>
              {Math.round(amt / revenue * 100)}%
            </span>
          </div>
        ))}
        {clients.length > 0 && clients[0][1] / revenue > 0.5 && (
          <p className="aw-note" style={{ color: "var(--stop)", fontWeight: 700 }}>
            {clients[0][0]} is over half your revenue. Losing them would hurt.
          </p>
        )}
      </div>

      <div className="aw-card">
        <div className="aw-eyebrow">Headcount</div>
        <div className="aw-kv aw-data" style={{ marginTop: 6 }}>
          <div><i>Office staff</i></div><div>{staff.length}</div>
          <div><i>Active drivers</i></div><div>{drivers.filter((d) => d.active).length}</div>
          <div><i>Vehicles in service</i></div><div>{vehicles.filter((v) => v.active).length}</div>
        </div>
      </div>
    </>
  );
}

/* ================================================================== */
/* 1b. Dispatch — the owner covering the desk                          */
/* ================================================================== */

function BookTrip({ drivers, vehicles, rates, onCreate, onCancel, nextNo }) {
  const [f, setF] = useState({
    client: "", driverId: "", vehicleId: "", stops: 3, flatRate: "", date: isoIn(0), extraCharges: 0,
  });
  const set = (k) => (v) => setF({ ...f, [k]: v });

  const driver = drivers.find((d) => d.id === f.driverId);
  const vehicle = vehicles.find((v) => v.id === f.vehicleId);
  const stop = blockers(vehicle, driver);
  const preview = grossOf({ ...f, flatRate: num(f.flatRate) }, rates);
  const pay = driver ? payOf({ ...f, flatRate: num(f.flatRate), payAdjust: 0 }, driver, rates).pay : 0;
  const busy = vehicle && null;

  return (
    <div className="aw-card" style={{ borderLeft: "4px solid var(--hiviz)" }}>
      <div className="aw-eyebrow">Covering dispatch</div>
      <h3 className="aw-display" style={{ fontSize: 19 }}>Book a trip</h3>
      <p className="aw-note">Same booking the dispatcher uses. It goes on the record as booked by you.</p>
      <hr className="aw-hr" />

      <Field label="Client" value={f.client} onChange={set("client")} />
      <div className="aw-fld">
        <label>Driver</label>
        <select value={f.driverId} onChange={(e) => {
          const id = e.target.value;
          const usual = vehicles.find((v) => v.active && v.defaultDriverId === id);
          setF({ ...f, driverId: id, vehicleId: usual ? usual.id : f.vehicleId });
        }}>
          <option value="">— pick a driver —</option>
          {drivers.filter((d) => d.active).map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} · {d.payType === "percent" ? `${d.payRate}%` : usd(d.payRate)}
            </option>
          ))}
        </select>
      </div>
      <div className="aw-fld">
        <label>Vehicle</label>
        <select value={f.vehicleId} onChange={(e) => setF({ ...f, vehicleId: e.target.value })}>
          <option value="">— pick a unit —</option>
          {vehicles.filter((v) => v.active).map((v) => (
            <option key={v.id} value={v.id}>Unit {v.unitNo} · {v.type}</option>
          ))}
        </select>
      </div>
      <div className="aw-row">
        <Field label="Date" type="date" value={f.date} onChange={set("date")} />
        <Field label="Total stops" value={f.stops} onChange={set("stops")} mode="numeric" />
      </div>
      {weekendFeeOf(f, rates) > 0 && (
        <p className="aw-note" style={{ color: "var(--sea)", fontWeight: 700 }}>
          That date is a weekend — {usd(rates.weekendFee)} is added automatically.
        </p>
      )}
      <div className="aw-row">
        <Field label="Flat rate ($)" value={f.flatRate} onChange={set("flatRate")} mode="decimal" />
        <Field label="Other charges ($)" value={f.extraCharges} onChange={set("extraCharges")} mode="decimal" />
      </div>

      {num(f.flatRate) > 0 && (
        <div style={{ background: "#EEF2F6", border: "1px solid var(--sea)", borderRadius: 3, padding: 9, marginBottom: 10 }}>
          <div className="aw-data" style={{ fontSize: 13, fontWeight: 700 }}>Gross {usd(preview)}</div>
          <p className="aw-note" style={{ margin: 0 }}>
            {driver ? `${driver.name} gets ${usd(pay)} · you keep ${usd(preview - pay)}`
              : "Pick a driver to see the split."}
            {" "}Includes {rates.fuelPct}% fuel and {Math.max(0, num(f.stops) - 2)} extra stop(s).
          </p>
        </div>
      )}

      {stop.length > 0 && (
        <div style={{ border: "2px solid var(--ink)", borderRadius: 3, overflow: "hidden", marginBottom: 10 }}>
          <div style={{ height: 9, background: "repeating-linear-gradient(45deg,var(--hiviz) 0 10px,var(--ink) 10px 20px)" }} />
          <div style={{ background: "#FFF8E1", padding: 11 }}>
            <p style={{ margin: "0 0 5px", fontSize: 13, fontWeight: 700 }}>
              <AlertTriangle size={14} /> Can't dispatch this
            </p>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              {stop.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          </div>
        </div>
      )}

      <button className="aw-btn" data-v="go" disabled={!f.driverId || !num(f.flatRate) || stop.length > 0}
        onClick={() => {
          onCreate({
            id: uid(), tripNo: `TL-${nextNo}`, client: f.client.trim() || "—",
            driverId: f.driverId, vehicleId: f.vehicleId || null,
            stops: num(f.stops), flatRate: num(f.flatRate), extraCharges: num(f.extraCharges),
            payAdjust: 0, status: "assigned", date: f.date, closedAt: null,
            dispatcherId: "u1", bookedByOwner: true,
          });
        }}>
        Assign to driver
      </button>
      <button className="aw-btn aw-btn-sm" data-v="ghost" onClick={onCancel}>Cancel</button>
    </div>
  );
}

function TripRow({ t, drivers, vehicles, rates, onPatch, onRemove, expanded, onToggle }) {
  const d = drivers.find((x) => x.id === t.driverId);
  const v = vehicles.find((x) => x.id === t.vehicleId);
  const g = grossOf(t, rates);
  const p = payOf(t, d, rates);
  const tone = t.status === "closed" ? "done" : t.status === "running" ? "now" : "wait";

  return (
    <div className="aw-card" style={{ borderLeft: `4px solid ${t.status === "closed" ? "var(--go)" : "var(--hiviz)"}` }}>
      <button onClick={onToggle}
        style={{ display: "flex", gap: 9, alignItems: "flex-start", width: "100%", background: "none", border: 0, cursor: "pointer", textAlign: "left", padding: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", gap: 7, alignItems: "baseline" }}>
            <b className="aw-data" style={{ fontSize: 13.5 }}>{t.tripNo}</b>
            <span className="aw-note" style={{ margin: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {t.client}
            </span>
            <span className="aw-tag" data-t={tone}>{t.status}</span>
          </div>
          <p className="aw-note" style={{ margin: "3px 0 0" }}>
            {d?.name || "unassigned"}{v ? ` · Unit ${v.unitNo}` : ""} · {t.stops} stops · {usd(g)}
          </p>
          {t.bookedByOwner && (
            <p className="aw-note" style={{ margin: "2px 0 0", color: "var(--sea)", fontWeight: 700 }}>
              Booked by you while covering
            </p>
          )}
        </div>
      </button>

      {expanded && (
        <>
          <hr className="aw-hr" />
          <div className="aw-kv aw-data">
            {weekendFeeOf(t, rates) > 0 && (
              <>
                <div><i>Weekend fee (auto)</i></div><div>{usd(weekendFeeOf(t, rates))}</div>
              </>
            )}
            <div><i>Gross</i></div><div>{usd(g)}</div>
            <div><i>Driver pay</i></div><div>{usd(p.pay)} <span style={{ color: "var(--mute)" }}>({p.basis})</span></div>
            <div><i>You keep</i></div><div><b>{usd(g - p.pay)}</b></div>
          </div>

          <hr className="aw-hr" />
          <div className="aw-eyebrow" style={{ marginBottom: 6 }}>Change this trip</div>
          <div className="aw-fld">
            <label>Driver</label>
            <select value={t.driverId || ""} onChange={(e) => onPatch({ driverId: e.target.value })}>
              {drivers.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </div>
          <div className="aw-fld">
            <label>Vehicle</label>
            <select value={t.vehicleId || ""} onChange={(e) => onPatch({ vehicleId: e.target.value })}>
              <option value="">— none —</option>
              {vehicles.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>Unit {x.unitNo}</option>)}
            </select>
          </div>
          <div className="aw-row">
            <Field label="Flat rate ($)" value={t.flatRate} onChange={(val) => onPatch({ flatRate: num(val) })} mode="decimal" />
            <Field label="Stops" value={t.stops} onChange={(val) => onPatch({ stops: num(val) })} mode="numeric" />
            <Field label="Other ($)" value={t.extraCharges} onChange={(val) => onPatch({ extraCharges: num(val) })} mode="decimal" />
          </div>
          <Field label="Adjust driver pay ($)" value={t.payAdjust}
            onChange={(val) => onPatch({ payAdjust: num(val) })} mode="decimal" />

          {blockers(v, d).length > 0 && (
            <p className="aw-note" style={{ color: "var(--stop)", fontWeight: 700 }}>
              <AlertTriangle size={11} /> {blockers(v, d).join(" · ")}
            </p>
          )}

          <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
            {t.status !== "closed" && (
              <button className="aw-btn aw-btn-sm" data-v="go"
                onClick={() => onPatch({ status: "closed", closedAt: now() })}>
                <Lock size={13} /> Close out
              </button>
            )}
            {t.status === "closed" && (
              <button className="aw-btn aw-btn-sm" data-v="ghost"
                onClick={() => onPatch({ status: "running", closedAt: null })}>
                Reopen
              </button>
            )}
            <button className="aw-btn aw-btn-sm" data-v="danger" onClick={onRemove}>
              <Trash2 size={13} /> Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Dispatch({ trips, setTrips, drivers, vehicles, staff, policy }) {
  const [booking, setBooking] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [filter, setFilter] = useState("open");
  const rates = policy.rates || DEFAULT_RATES;

  const away = staff.filter((u) => u.role === "dispatcher" && u.away);
  const openT = trips.filter((t) => t.status !== "closed");
  const closedT = trips.filter((t) => t.status === "closed");
  const shown = filter === "open" ? openT : filter === "closed" ? closedT : trips;
  const nextNo = 1044 + trips.filter((t) => Number(t.tripNo.replace("TL-", "")) >= 1044).length;

  if (booking) {
    return (
      <BookTrip drivers={drivers} vehicles={vehicles} rates={rates} nextNo={nextNo}
        onCancel={() => setBooking(false)}
        onCreate={(t) => { setTrips([...trips, t]); setBooking(false); }} />
    );
  }

  return (
    <>
      {away.length > 0 && (
        <div className="aw-card" style={{ borderLeft: "4px solid var(--sea)", background: "#EAF1F8" }}>
          <div className="aw-eyebrow" style={{ color: "var(--sea)" }}>Covering</div>
          <h3 className="aw-display" style={{ fontSize: 18 }}>
            {away.map((u) => u.name).join(", ")} {away.length === 1 ? "is" : "are"} away
          </h3>
          <p className="aw-note">
            You have the desk. Anything you book is tagged so it's clear who did it.
          </p>
        </div>
      )}

      <button className="aw-btn" data-v="go" onClick={() => setBooking(true)}>
        <Plus size={16} /> New booking
      </button>

      <div style={{ display: "flex", background: "#D3D7D3", borderRadius: 2, overflow: "hidden", marginBottom: 12 }}>
        {[["open", `Open (${openT.length})`], ["closed", `Closed (${closedT.length})`], ["all", "All"]].map(([k, lbl]) => (
          <button key={k} onClick={() => setFilter(k)}
            style={{
              flex: 1, border: 0, cursor: "pointer", padding: "8px 6px",
              fontSize: 11, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase",
              background: filter === k ? "var(--hiviz)" : "transparent",
              color: filter === k ? "var(--ink)" : "var(--mute)",
            }}>{lbl}</button>
        ))}
      </div>

      {shown.length === 0
        ? <div className="aw-empty"><ClipboardList size={26} /><p>Nothing here.</p></div>
        : shown.map((t) => (
          <TripRow key={t.id} t={t} drivers={drivers} vehicles={vehicles} rates={rates}
            expanded={openId === t.id} onToggle={() => setOpenId(openId === t.id ? null : t.id)}
            onPatch={(p) => setTrips(trips.map((x) => (x.id === t.id ? { ...x, ...p } : x)))}
            onRemove={() => { setTrips(trips.filter((x) => x.id !== t.id)); setOpenId(null); }} />
        ))}
    </>
  );
}

/* ================================================================== */
/* 2. People & permissions                                            */
/* ================================================================== */

function StaffCard({ u, onSave, onRemove }) {
  const [open, setOpen] = useState(false);
  const isOwner = u.role === "owner";
  const granted = isOwner ? PERMS.length : PERMS.filter((p) => u.perms?.[p.k]).length;
  const backOn = u.awayUntil ? daysUntil(u.awayUntil) : null;

  return (
    <div className="aw-card" style={{ borderLeft: `4px solid ${isOwner ? "var(--hiviz)" : "var(--sea)"}` }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <h3 className="aw-display" style={{ fontSize: 17 }}>{u.name}</h3>
          <p className="aw-note" style={{ margin: "2px 0 0" }}>
            {isOwner ? "Super admin — full control, cannot be limited"
              : `${granted} of ${PERMS.length} permissions${u.covering ? " · covering" : ""}`}
          </p>
        </div>
        <span className="aw-tag" data-t={isOwner ? "now" : u.away ? "exc" : "done"}>
          {isOwner ? "Owner" : u.away ? "Away" : "Dispatcher"}
        </span>
      </div>

      {isOwner && (
        <p className="aw-note">
          Can do everything any dispatcher can, plus payroll, fleet and permissions.
          Covers the desk when someone is away.
        </p>
      )}

      {!isOwner && (
        <>
          <hr className="aw-hr" />
          <div className="aw-perm">
            <span>Away from the desk
              <small>{u.away
                ? (backOn !== null && backOn >= 0 ? `Back in ${backOn} day${backOn === 1 ? "" : "s"}` : "You are covering their work")
                : "Turn on for holiday or sick leave"}</small></span>
            <Toggle on={!!u.away} tone="var(--stop)"
              onChange={(v) => onSave({ ...u, away: v, awayUntil: v ? u.awayUntil : "" })} />
          </div>
          {u.away && (
            <Field label="Back on" type="date" value={u.awayUntil}
              onChange={(v) => onSave({ ...u, awayUntil: v })} />
          )}
          <button className="aw-btn aw-btn-sm" data-v="ghost" onClick={() => setOpen(!open)}>
            <Lock size={13} /> {open ? "Hide permissions" : "What they can do"}
          </button>
          {open && (
            <div style={{ marginTop: 12 }}>
              {PERMS.map((p) => (
                <div key={p.k} className="aw-perm">
                  <span>{p.label}<small>{p.hint}</small></span>
                  <Toggle on={!!u.perms?.[p.k]}
                    onChange={(v) => onSave({ ...u, perms: { ...u.perms, [p.k]: v } })} />
                </div>
              ))}
              <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
                <button className="aw-btn aw-btn-sm" data-v="ghost"
                  onClick={() => onSave({ ...u, perms: Object.fromEntries(PERMS.map((p) => [p.k, true])) })}>
                  Grant all
                </button>
                <button className="aw-btn aw-btn-sm" data-v="ghost"
                  onClick={() => onSave({ ...u, perms: {} })}>
                  Revoke all
                </button>
                <button className="aw-btn aw-btn-sm" data-v="ghost"
                  onClick={() => onSave({ ...u, perms: { ...u.perms, bookTrips: true, seeRates: true,
                    editRates: true, splitTrips: true, exportDocs: true, notifyClients: true },
                    covering: true })}>
                  Cover for someone
                </button>
                <button className="aw-btn aw-btn-sm" data-v="danger" onClick={onRemove}>
                  <Trash2 size={13} /> Remove
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function People({ staff, setStaff }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  return (
    <>
      <div className="aw-card" style={{ borderLeft: "4px solid var(--ink)" }}>
        <div className="aw-eyebrow"><Users size={11} /> Office</div>
        <h3 className="aw-display" style={{ fontSize: 19 }}>
          {staff.length} people · {staff.filter((u) => u.role === "dispatcher").length} dispatchers
        </h3>
        <p className="aw-note">
          Permissions decide what each person sees. A dispatcher without “see driver pay” has no way
          to find out what anyone earns. You are the super admin — every permission is yours
          permanently, so you can cover the desk whenever someone is away.
        </p>
      </div>

      {staff.map((u) => (
        <StaffCard key={u.id} u={u}
          onSave={(nu) => setStaff(staff.map((x) => (x.id === u.id ? nu : x)))}
          onRemove={() => setStaff(staff.filter((x) => x.id !== u.id))} />
      ))}

      {adding ? (
        <div className="aw-card" style={{ borderLeft: "4px solid var(--hiviz)" }}>
          <div className="aw-eyebrow">New dispatcher</div>
          <h3 className="aw-display">Add to the office</h3>
          <hr className="aw-hr" />
          <Field label="Name" value={name} onChange={setName} />
          <p className="aw-note">Starts with booking and paperwork only. Turn the rest on yourself.</p>
          <button className="aw-btn" data-v="go" disabled={!name.trim()}
            onClick={() => {
              setStaff([...staff, { id: uid(), name: name.trim(), role: "dispatcher",
                perms: { bookTrips: true, exportDocs: true } }]);
              setName(""); setAdding(false);
            }}>Add dispatcher</button>
          <button className="aw-btn aw-btn-sm" data-v="ghost" onClick={() => setAdding(false)}>Cancel</button>
        </div>
      ) : (
        <button className="aw-btn" data-v="hiviz" onClick={() => setAdding(true)}>
          <Plus size={16} /> Add a dispatcher
        </button>
      )}
    </>
  );
}

/* ================================================================== */
/* 3. Drivers                                                         */
/* ================================================================== */

function DriverCard({ d, trips, onSave, onRemove, rates = DEFAULT_RATES }) {
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState(d);
  useEffect(() => setF(d), [d]);
  const set = (k) => (v) => setF({ ...f, [k]: v });

  const mine = trips.filter((t) => t.driverId === d.id && t.status === "closed");
  const earned = mine.reduce((a, t) => a + payOf(t, d, rates).pay, 0);
  const hauled = mine.reduce((a, t) => a + grossOf(t, rates), 0);
  const worst = [...DRIVER_DOCS.map((doc) => expiryState(d[doc.k]))].sort((a, b) => a.n - b.n)[0];

  if (!edit) {
    return (
      <div className="aw-card" style={{ borderLeft: `4px solid ${d.active ? "var(--go)" : "var(--mute)"}` }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <div style={{ flex: 1 }}>
            <h3 className="aw-display" style={{ fontSize: 17 }}>{d.name}</h3>
            <p className="aw-note" style={{ margin: "2px 0 0" }}>{d.phone} · {d.licenceClass} {d.licenceNo}</p>
          </div>
          <span className="aw-tag" data-t={d.active ? "done" : "wait"}>{d.active ? "Active" : "Inactive"}</span>
        </div>

        <hr className="aw-hr" />
        <div className="aw-kv aw-data">
          <div><i>Pay basis</i></div>
          <div>{d.payType === "percent" ? `${d.payRate}% of gross`
            : d.payType === "flat" ? `${usd(d.payRate)} per trip` : `${usd(d.payRate)} per stop`}</div>
          <div><i>Trips closed</i></div><div>{mine.length}</div>
          <div><i>Revenue hauled</i></div><div>{usd(hauled)}</div>
          <div><i>Owed</i></div><div><b>{usd(earned)}</b></div>
        </div>

        <hr className="aw-hr" />
        <div className="aw-eyebrow" style={{ marginBottom: 5 }}>Paperwork</div>
        {DRIVER_DOCS.map((doc) => {
          const st = expiryState(d[doc.k]);
          return (
            <div key={doc.k} className="aw-row2" style={{ borderBottom: 0, padding: "3px 0" }}>
              <span style={{ flex: 1, fontSize: 12.5 }}>{doc.label}</span>
              <span className="aw-note aw-data" style={{ margin: 0, fontSize: 11 }}>{d[doc.k] || "—"}</span>
              <span className="aw-tag" data-t={st.tone}>{st.label}</span>
            </div>
          );
        })}
        {worst && (worst.k === "expired" || worst.k === "missing") && (
          <p className="aw-note" style={{ color: "var(--stop)", fontWeight: 700 }}>
            <AlertTriangle size={11} /> Cannot be dispatched until this is renewed.
          </p>
        )}

        <button className="aw-btn aw-btn-sm" data-v="ghost" style={{ marginTop: 11 }} onClick={() => setEdit(true)}>
          <PenLine size={13} /> Edit pay &amp; paperwork
        </button>
      </div>
    );
  }

  return (
    <div className="aw-card" style={{ borderLeft: "4px solid var(--hiviz)" }}>
      <div className="aw-eyebrow">Editing</div>
      <h3 className="aw-display" style={{ fontSize: 17 }}>{d.name}</h3>
      <hr className="aw-hr" />
      <Field label="Name" value={f.name} onChange={set("name")} />
      <div className="aw-row">
        <Field label="Phone" value={f.phone} onChange={set("phone")} />
        <Field label="Email" value={f.email} onChange={set("email")} />
      </div>

      <hr className="aw-hr" />
      <div className="aw-eyebrow" style={{ marginBottom: 6 }}>How he's paid</div>
      <div className="aw-row">
        <div className="aw-fld">
          <label>Basis</label>
          <select value={f.payType} onChange={(e) => setF({ ...f, payType: e.target.value })}>
            <option value="percent">% of gross</option>
            <option value="flat">Flat per trip</option>
            <option value="per_stop">Per stop</option>
          </select>
        </div>
        <Field label={f.payType === "percent" ? "Percent" : "Amount ($)"}
          value={f.payRate} onChange={set("payRate")} mode="decimal" />
      </div>
      <p className="aw-note">Gross means everything billed to the client. Fuel and tolls are not deducted first.</p>

      <hr className="aw-hr" />
      <div className="aw-eyebrow" style={{ marginBottom: 6 }}>Licence &amp; medical</div>
      <div className="aw-row">
        <Field label="Licence number" value={f.licenceNo} onChange={set("licenceNo")} />
        <Field label="Class" value={f.licenceClass} onChange={set("licenceClass")} />
      </div>
      {DRIVER_DOCS.map((doc) => (
        <Field key={doc.k} label={`${doc.label} expires`} type="date"
          value={f[doc.k]} onChange={set(doc.k)} />
      ))}

      <div className="aw-fld">
        <label>Status</label>
        <select value={f.active ? "1" : "0"} onChange={(e) => setF({ ...f, active: e.target.value === "1" })}>
          <option value="1">Active</option><option value="0">Inactive</option>
        </select>
      </div>

      <div style={{ display: "flex", gap: 6 }}>
        <button className="aw-btn aw-btn-sm" data-v="go"
          onClick={() => { onSave({ ...f, payRate: num(f.payRate) }); setEdit(false); }}>
          <Check size={13} /> Save
        </button>
        <button className="aw-btn aw-btn-sm" data-v="ghost" onClick={() => { setF(d); setEdit(false); }}>
          <X size={13} /> Cancel
        </button>
        {mine.length === 0 && (
          <button className="aw-btn aw-btn-sm" data-v="danger" onClick={onRemove}>
            <Trash2 size={13} /> Remove
          </button>
        )}
      </div>
    </div>
  );
}

function Drivers({ drivers, setDrivers, trips, rates = DEFAULT_RATES }) {
  const [adding, setAdding] = useState(false);
  const [n, setN] = useState({ name: "", phone: "", payType: "percent", payRate: 25 });

  const owed = drivers.reduce((a, d) =>
    a + trips.filter((t) => t.driverId === d.id && t.status === "closed")
      .reduce((s, t) => s + payOf(t, d, rates).pay, 0), 0);

  return (
    <>
      <div className="aw-card" style={{ borderLeft: "4px solid var(--go)" }}>
        <div className="aw-eyebrow">Payroll</div>
        <h3 className="aw-display" style={{ fontSize: 20 }}>{usd(owed)} owed</h3>
        <p className="aw-note">Across {drivers.filter((d) => d.active).length} active drivers, from closed trips only.</p>
      </div>

      {drivers.map((d) => (
        <DriverCard key={d.id} d={d} trips={trips} rates={rates}
          onSave={(u) => setDrivers(drivers.map((x) => (x.id === d.id ? u : x)))}
          onRemove={() => setDrivers(drivers.filter((x) => x.id !== d.id))} />
      ))}

      {adding ? (
        <div className="aw-card" style={{ borderLeft: "4px solid var(--hiviz)" }}>
          <div className="aw-eyebrow">New driver</div>
          <h3 className="aw-display">Add to roster</h3>
          <hr className="aw-hr" />
          <Field label="Name" value={n.name} onChange={(v) => setN({ ...n, name: v })} />
          <Field label="Phone" value={n.phone} onChange={(v) => setN({ ...n, phone: v })} />
          <div className="aw-row">
            <div className="aw-fld">
              <label>Pay basis</label>
              <select value={n.payType} onChange={(e) => setN({ ...n, payType: e.target.value })}>
                <option value="percent">% of gross</option>
                <option value="flat">Flat per trip</option>
                <option value="per_stop">Per stop</option>
              </select>
            </div>
            <Field label={n.payType === "percent" ? "Percent" : "Amount ($)"}
              value={n.payRate} onChange={(v) => setN({ ...n, payRate: v })} mode="decimal" />
          </div>
          <button className="aw-btn" data-v="go" disabled={!n.name.trim()}
            onClick={() => {
              setDrivers([...drivers, { ...n, id: uid(), name: n.name.trim(), payRate: num(n.payRate),
                active: true, email: "", licenceNo: "", licenceClass: "", licenceExpiry: "", medicalExpiry: "" }]);
              setN({ name: "", phone: "", payType: "percent", payRate: 25 });
              setAdding(false);
            }}>Add driver</button>
          <button className="aw-btn aw-btn-sm" data-v="ghost" onClick={() => setAdding(false)}>Cancel</button>
        </div>
      ) : (
        <button className="aw-btn" data-v="hiviz" onClick={() => setAdding(true)}>
          <Plus size={16} /> Add a driver
        </button>
      )}
    </>
  );
}

/* ================================================================== */
/* 4. Fleet                                                           */
/* ================================================================== */

function VehicleCard({ v, drivers, trips, onSave, onRemove }) {
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState(v);
  useEffect(() => setF(v), [v]);
  const set = (k) => (val) => setF({ ...f, [k]: val });

  const used = trips.filter((t) => t.vehicleId === v.id);
  const usual = drivers.find((d) => d.id === v.defaultDriverId);
  const sv = serviceState(v);
  const worst = VEHICLE_DOCS.map((doc) => expiryState(v[doc.k])).sort((a, b) => a.n - b.n)[0];

  if (!edit) {
    return (
      <div className="aw-card" style={{ borderLeft: `4px solid ${v.active ? "var(--sea)" : "var(--mute)"}` }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <div style={{ flex: 1 }}>
            <h3 className="aw-display" style={{ fontSize: 18 }}>Unit {v.unitNo}</h3>
            <p className="aw-note" style={{ margin: "2px 0 0" }}>
              {[v.year, v.make, v.model].filter(Boolean).join(" ")} · {v.type}
            </p>
          </div>
          <span className="aw-tag" data-t={v.active ? "done" : "wait"}>{v.active ? "In service" : "Off road"}</span>
        </div>

        <hr className="aw-hr" />
        <div className="aw-kv aw-data">
          <div><i>Plate</i></div><div>{v.plate || "—"}</div>
          <div><i>Trailer</i></div><div>{v.trailerNo || "—"}</div>
          <div><i>Capacity</i></div><div>{num(v.capacityLb) ? `${num(v.capacityLb).toLocaleString()} lb` : "—"}</div>
          <div><i>Odometer</i></div><div>{num(v.odometer) ? `${num(v.odometer).toLocaleString()} mi` : "—"}</div>
          <div><i>Usual driver</i></div><div>{usual?.name || "Any"}</div>
          <div><i>Trips run</i></div><div>{used.length}</div>
        </div>

        <hr className="aw-hr" />
        <div className="aw-eyebrow" style={{ marginBottom: 5 }}>Paperwork</div>
        {VEHICLE_DOCS.map((doc) => {
          const st = expiryState(v[doc.k]);
          return (
            <div key={doc.k} className="aw-row2" style={{ borderBottom: 0, padding: "3px 0" }}>
              <span style={{ flex: 1, fontSize: 12.5 }}>{doc.label}</span>
              <span className="aw-note aw-data" style={{ margin: 0, fontSize: 11 }}>{v[doc.k] || "—"}</span>
              <span className="aw-tag" data-t={st.tone}>{st.label}</span>
            </div>
          );
        })}
        {sv && (
          <div className="aw-row2" style={{ borderBottom: 0, padding: "3px 0" }}>
            <span style={{ flex: 1, fontSize: 12.5 }}>Next service</span>
            <span className="aw-note aw-data" style={{ margin: 0, fontSize: 11 }}>
              at {num(v.nextServiceOdo).toLocaleString()} mi
            </span>
            <span className="aw-tag" data-t={sv.tone}>{sv.label}</span>
          </div>
        )}
        {worst && (worst.k === "expired" || worst.k === "missing") && (
          <p className="aw-note" style={{ color: "var(--stop)", fontWeight: 700 }}>
            <AlertTriangle size={11} /> This unit cannot be dispatched.
          </p>
        )}
        {v.notes && <p className="aw-note">{v.notes}</p>}

        <button className="aw-btn aw-btn-sm" data-v="ghost" style={{ marginTop: 11 }} onClick={() => setEdit(true)}>
          <PenLine size={13} /> Edit this unit
        </button>
      </div>
    );
  }

  return (
    <div className="aw-card" style={{ borderLeft: "4px solid var(--hiviz)" }}>
      <div className="aw-eyebrow">Editing</div>
      <h3 className="aw-display" style={{ fontSize: 17 }}>Unit {v.unitNo}</h3>
      <hr className="aw-hr" />
      <div className="aw-row">
        <Field label="Unit number" value={f.unitNo} onChange={set("unitNo")} />
        <Field label="Plate" value={f.plate} onChange={set("plate")} />
      </div>
      <div className="aw-fld">
        <label>Type</label>
        <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
          {["Tractor + 53' dry van", "Tractor + 48' flatbed", "Tractor + reefer",
            "Straight truck 26'", "Cube van", "Sprinter van"].map((t) => <option key={t}>{t}</option>)}
        </select>
      </div>
      <div className="aw-row">
        <Field label="Year" value={f.year} onChange={set("year")} mode="numeric" />
        <Field label="Make" value={f.make} onChange={set("make")} />
        <Field label="Model" value={f.model} onChange={set("model")} />
      </div>
      <div className="aw-row">
        <Field label="Trailer" value={f.trailerNo} onChange={set("trailerNo")} />
        <Field label="Capacity (lb)" value={f.capacityLb} onChange={set("capacityLb")} mode="numeric" />
      </div>

      <hr className="aw-hr" />
      <div className="aw-eyebrow" style={{ marginBottom: 6 }}>Paperwork &amp; maintenance</div>
      {VEHICLE_DOCS.map((doc) => (
        <Field key={doc.k} label={`${doc.label} expires`} type="date" value={f[doc.k]} onChange={set(doc.k)} />
      ))}
      <div className="aw-row">
        <Field label="Odometer (mi)" value={f.odometer} onChange={set("odometer")} mode="numeric" />
        <Field label="Next service at (mi)" value={f.nextServiceOdo} onChange={set("nextServiceOdo")} mode="numeric" />
      </div>

      <div className="aw-fld">
        <label>Usual driver</label>
        <select value={f.defaultDriverId || ""} onChange={(e) => setF({ ...f, defaultDriverId: e.target.value })}>
          <option value="">Any driver</option>
          {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>
      <Field label="Notes" value={f.notes} onChange={set("notes")} />
      <div className="aw-fld">
        <label>Status</label>
        <select value={f.active ? "1" : "0"} onChange={(e) => setF({ ...f, active: e.target.value === "1" })}>
          <option value="1">In service</option><option value="0">Off road</option>
        </select>
      </div>

      <div style={{ display: "flex", gap: 6 }}>
        <button className="aw-btn aw-btn-sm" data-v="go"
          onClick={() => {
            onSave({ ...f, capacityLb: num(f.capacityLb), odometer: num(f.odometer), nextServiceOdo: num(f.nextServiceOdo) });
            setEdit(false);
          }}>
          <Check size={13} /> Save
        </button>
        <button className="aw-btn aw-btn-sm" data-v="ghost" onClick={() => { setF(v); setEdit(false); }}>
          <X size={13} /> Cancel
        </button>
        {used.length === 0 && (
          <button className="aw-btn aw-btn-sm" data-v="danger" onClick={onRemove}>
            <Trash2 size={13} /> Remove
          </button>
        )}
      </div>
    </div>
  );
}

function Fleet({ vehicles, setVehicles, drivers, trips }) {
  const [adding, setAdding] = useState(false);
  const [n, setN] = useState({ unitNo: "", type: "Tractor + 53' dry van", plate: "", capacityLb: "" });

  const grounded = vehicles.filter((v) =>
    v.active && VEHICLE_DOCS.some((doc) => ["expired", "missing"].includes(expiryState(v[doc.k]).k))).length;

  return (
    <>
      <div className="aw-card" style={{ borderLeft: `4px solid ${grounded ? "var(--stop)" : "var(--sea)"}` }}>
        <div className="aw-eyebrow"><Truck size={11} /> Fleet</div>
        <h3 className="aw-display" style={{ fontSize: 19 }}>
          {vehicles.filter((v) => v.active).length} in service
          {grounded ? ` · ${grounded} grounded` : ""}
        </h3>
        <p className="aw-note">Grounded means expired paperwork. Dispatch cannot book those units.</p>
      </div>

      {vehicles.map((v) => (
        <VehicleCard key={v.id} v={v} drivers={drivers} trips={trips}
          onSave={(u) => setVehicles(vehicles.map((x) => (x.id === v.id ? u : x)))}
          onRemove={() => setVehicles(vehicles.filter((x) => x.id !== v.id))} />
      ))}

      {adding ? (
        <div className="aw-card" style={{ borderLeft: "4px solid var(--hiviz)" }}>
          <div className="aw-eyebrow">New unit</div>
          <h3 className="aw-display">Add to fleet</h3>
          <hr className="aw-hr" />
          <div className="aw-row">
            <Field label="Unit number" value={n.unitNo} onChange={(v) => setN({ ...n, unitNo: v })} />
            <Field label="Plate" value={n.plate} onChange={(v) => setN({ ...n, plate: v })} />
          </div>
          <div className="aw-fld">
            <label>Type</label>
            <select value={n.type} onChange={(e) => setN({ ...n, type: e.target.value })}>
              {["Tractor + 53' dry van", "Tractor + 48' flatbed", "Tractor + reefer",
                "Straight truck 26'", "Cube van", "Sprinter van"].map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
          <Field label="Capacity (lb)" value={n.capacityLb} onChange={(v) => setN({ ...n, capacityLb: v })} mode="numeric" />
          <button className="aw-btn" data-v="go" disabled={!n.unitNo.trim()}
            onClick={() => {
              setVehicles([...vehicles, { ...n, id: uid(), unitNo: n.unitNo.trim(), capacityLb: num(n.capacityLb),
                active: true, trailerNo: "", make: "", model: "", year: "", notes: "",
                defaultDriverId: "", odometer: 0, nextServiceOdo: 0,
                insuranceExpiry: "", safetyExpiry: "", plateExpiry: "" }]);
              setN({ unitNo: "", type: "Tractor + 53' dry van", plate: "", capacityLb: "" });
              setAdding(false);
            }}>Add unit</button>
          <button className="aw-btn aw-btn-sm" data-v="ghost" onClick={() => setAdding(false)}>Cancel</button>
        </div>
      ) : (
        <button className="aw-btn" data-v="hiviz" onClick={() => setAdding(true)}>
          <Plus size={16} /> Add a vehicle
        </button>
      )}
    </>
  );
}

/* ================================================================== */
/* 5. Rates & policy                                                  */
/* ================================================================== */

function Rates({ policy, setPolicy }) {
  const rates = policy.rates || DEFAULT_RATES;
  const setRate = (k) => (v) => setPolicy({ ...policy, rates: { ...rates, [k]: num(v) } });

  return (
    <>
      <div className="aw-card" style={{ borderLeft: "4px solid var(--ink)" }}>
        <div className="aw-eyebrow"><SlidersHorizontal size={11} /> Standard rates</div>
        <h3 className="aw-display" style={{ fontSize: 19 }}>Applied to every new trip</h3>
        <p className="aw-note">Any single trip can override these. Change here and future trips follow.</p>
        <hr className="aw-hr" />

        <div className="aw-eyebrow" style={{ marginBottom: 6 }}>Accessorials</div>
        <div className="aw-row">
          <Field label="Extra stop ($)" value={rates.extraStopRate} onChange={setRate("extraStopRate")} mode="decimal" />
          <Field label="Failed attempt ($)" value={rates.attemptRate} onChange={setRate("attemptRate")} mode="decimal" />
        </div>

        <hr className="aw-hr" />
        <div className="aw-eyebrow" style={{ marginBottom: 6 }}>Detention</div>
        <div className="aw-row">
          <Field label="Free at pickup (min)" value={rates.freeMinPickup} onChange={setRate("freeMinPickup")} mode="numeric" />
          <Field label="Free at drop (min)" value={rates.freeMinDrop} onChange={setRate("freeMinDrop")} mode="numeric" />
          <Field label="Rate ($/hr)" value={rates.detentionRate} onChange={setRate("detentionRate")} mode="decimal" />
        </div>
        <p className="aw-note">
          Billed in 15-minute blocks from the driver's own arrival and departure times — which is what
          makes the charge defensible when a client argues it.
        </p>

        <hr className="aw-hr" />
        <div className="aw-eyebrow" style={{ marginBottom: 6 }}>Surcharges</div>
        <div className="aw-row">
          <Field label="Fuel (% of linehaul)" value={rates.fuelPct} onChange={setRate("fuelPct")} mode="decimal" />
          <Field label="After hours ($)" value={rates.afterHoursFee} onChange={setRate("afterHoursFee")} mode="decimal" />
          <Field label="Weekend ($)" value={rates.weekendFee} onChange={setRate("weekendFee")} mode="decimal" />
        </div>
        <p className="aw-note">Fuel applies to linehaul only — not to detention or other accessorials.</p>
      </div>

      <div className="aw-card" style={{ borderLeft: "4px solid var(--sea)" }}>
        <div className="aw-eyebrow">Driver workspace</div>
        <h3 className="aw-display" style={{ fontSize: 18 }}>What drivers see on their phones</h3>
        <hr className="aw-hr" />
        <div className="aw-perm">
          <span>Their own pay<small>What this trip earns them</small></span>
          <Toggle on={policy.driverSeesPay} tone="var(--sea)"
            onChange={(v) => setPolicy({ ...policy, driverSeesPay: v })} />
        </div>
        <div className="aw-perm" style={{ borderBottom: 0 }}>
          <span>What the client pays<small>Most fleets keep this off — it invites rate arguments</small></span>
          <Toggle on={policy.driverSeesClientRate} tone="var(--sea)"
            onChange={(v) => setPolicy({ ...policy, driverSeesClientRate: v })} />
        </div>
        <p className="aw-note">
          Drivers only ever see trips assigned to them. That is not adjustable.
        </p>
      </div>
    </>
  );
}

/* ================================================================== */
/* Shell                                                              */
/* ================================================================== */

const NAV = [
  { k: "overview", label: "Overview", icon: <Building2 size={16} /> },
  { k: "dispatch", label: "Dispatch", icon: <ClipboardList size={16} /> },
  { k: "people", label: "People", icon: <Users size={16} /> },
  { k: "drivers", label: "Drivers", icon: <User size={16} /> },
  { k: "fleet", label: "Fleet", icon: <Truck size={16} /> },
  { k: "rates", label: "Rates & policy", icon: <SlidersHorizontal size={16} /> },
];

function NavList({ view, go, onClose }) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px 12px" }}>
        <Truck size={20} color="#F2B705" />
        <h1 className="aw-display" style={{ margin: 0, fontSize: 16, color: "#fff" }}>Truck Loading</h1>
        {onClose && (
          <button onClick={onClose} aria-label="Close menu"
            style={{ marginLeft: "auto", background: "none", border: 0, color: "#9FB0BF", cursor: "pointer" }}>
            <X size={18} />
          </button>
        )}
      </div>
      <div className="aw-navhead">Super admin</div>
      {NAV.map((it) => (
        <button key={it.k} className="aw-item" data-on={view === it.k ? "1" : "0"}
          onClick={() => { go(it.k); onClose?.(); }}>
          {it.icon}{it.label}
        </button>
      ))}
      <div className="aw-navhead">Other workspaces</div>
      <div style={{ padding: "0 13px 12px", fontSize: 11.5, color: "#7E93A5", lineHeight: 1.5 }}>
        Dispatcher, Driver and Customer are separate demos.
      </div>
    </>
  );
}

export default function AdminWorkspace() {
  const [view, setView] = useState("overview");
  const [menu, setMenu] = useState(false);
  const [st, setSt] = useState(null);

  useEffect(() => { load().then(setSt); }, []);

  const put = useCallback((patch) => {
    setSt((prev) => {
      const next = { ...prev, ...patch };
      save(next);
      return next;
    });
  }, []);

  if (!st) {
    return (
      <div className="aw">
        <style>{CSS}</style>
        <div className="aw-empty"><ClipboardList size={26} /><p>Opening the workspace…</p></div>
      </div>
    );
  }

  const page = () => {
    if (view === "dispatch") return <Dispatch trips={st.trips} setTrips={(v) => put({ trips: v })}
      drivers={st.drivers} vehicles={st.vehicles} staff={st.staff} policy={st.policy} />;
    if (view === "people") return <People staff={st.staff} setStaff={(v) => put({ staff: v })} />;
    if (view === "drivers") return <Drivers drivers={st.drivers} setDrivers={(v) => put({ drivers: v })}
      trips={st.trips} rates={st.policy.rates} />;
    if (view === "fleet") return <Fleet vehicles={st.vehicles} setVehicles={(v) => put({ vehicles: v })} drivers={st.drivers} trips={st.trips} />;
    if (view === "rates") return <Rates policy={st.policy} setPolicy={(v) => put({ policy: v })} />;
    return <Overview trips={st.trips} drivers={st.drivers} vehicles={st.vehicles} staff={st.staff}
      onGo={setView} rates={st.policy.rates} />;
  };

  const title = NAV.find((n) => n.k === view)?.label || "Overview";

  return (
    <div className="aw">
      <style>{CSS}</style>
      <div className="aw-shell">
        <nav className="aw-nav">
          <NavList view={view} go={setView} />
        </nav>

        {menu && (
          <>
            <div className="aw-scrim" onClick={() => setMenu(false)} />
            <nav className="aw-drawer">
              <NavList view={view} go={setView} onClose={() => setMenu(false)} />
            </nav>
          </>
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="aw-bar">
            <button className="aw-burger" onClick={() => setMenu(true)} aria-label="Menu">
              <Menu size={20} />
            </button>
            <h1 className="aw-display">{title}</h1>
            <span className="aw-tag" data-t="now" style={{ marginLeft: "auto" }}>Super admin</span>
          </div>
          <div className="aw-main">{page()}</div>
        </div>
      </div>
    </div>
  );
}
