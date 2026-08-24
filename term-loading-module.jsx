import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Truck, Camera, FileText, Check, X, Plus, Trash2, AlertTriangle, Paperclip,
  Receipt, CalendarDays, Layers, Printer,
  ArrowUp, ArrowDown, Loader2, RotateCcw, ClipboardList, Route,
  Lock, ChevronRight, Building2, MapPin, MessageSquare,
} from "lucide-react";

/* ==================================================================
   Truck Loading — TERM LOADING (dock intake)
   For customers who hand the driver paper and fill in nothing.
   The customer portal booking form is unaffected — this is a
   separate path used by driver, dispatcher or admin at the dock.
   ================================================================== */

const KEY = "tl-termloading:v1";
const uid = () => Math.random().toString(36).slice(2, 9);
const now = () => new Date().toISOString();
const num = (x) => Number(x) || 0;
const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—");
const dmy = (iso) => (iso ? new Date(iso).toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" }) : "—");

/* ---------------- saved shippers ----------------
   The whole point: these customers always collect from the same
   dock, so the shipper block never has to be typed.               */

const SHIPPERS = [
  {
    id: "ulterra",
    name: "Ulterra Drilling Technologies",
    address: "6795 Corporation Parkway Suite 200",
    city: "Fort Worth", state: "TX", zip: "76126",
    phone: "817-551-9776", email: "pdcshipping@ulterra.com",
    plant: "FT. WORTH PLANT 3110",
    note: "Texts the pickup address only. Paperwork is handed over at the dock, and the handwritten codes change every load.",
    /* destinations seen before — order-number prefix maps to the site code */
    /* Sites this shipper has sent freight to before. Purely a shortcut —
       the destination for any given load comes off that load's paperwork. */
    knownDrops: [
      { code: "", name: "DSV — Grapevine", address: "2400 Esters Blvd", city: "Grapevine", state: "TX", zip: "75261" },
      { code: "", name: "OKC Warehouse", address: "", city: "Oklahoma City", state: "OK", zip: "" },
      { code: "", name: "Ulterra Ft. Worth Plant", address: "6795 Corporation Parkway Suite 200", city: "Fort Worth", state: "TX", zip: "76126" },
    ],
  },
];

const BLANK_BOL = () => ({
  date: new Date().toISOString().slice(0, 10),
  bolNumber: "", pageOf: "",
  fromName: "", fromAddress: "", fromCity: "", fromState: "", fromZip: "", sid: "",
  toName: "", toAddress: "", toCity: "", toState: "", toZip: "", locationNo: "",
  tpName: "", tpAddress: "", tpCity: "", tpState: "", tpZip: "",
  specialInstructions: "",
  carrierName: "NQ Visiorence LLC", trailerNo: "", sealNos: "", scac: "", proNo: "",
  freightTerms: "prepaid", masterBol: false,
  codAmount: "", codFeeTerms: "", checkAcceptable: false,
  trailerLoadedBy: "shipper", freightCountedBy: "driver_pieces",
  shipperSignedBy: "", shipperSignedDate: "",
});

const BLANK_ORDER = () => ({ id: uid(), orderNo: "", pkgs: "", weight: "", pallet: "", shipperInfo: "" });
const BLANK_ITEM = () => ({ id: uid(), description: "", serialNo: "", qty: "", weight: "", nmfc: "", freightClass: "", hazmat: false, dropId: "" });
const BLANK_DROP = () => ({ id: uid(), code: "", name: "", address: "", city: "", state: "", zip: "",
  window: "", contact: "", contactPhone: "", ref: "", status: "wait", runNo: 1 });

/* ---------------- dropped pins (US only) ---------------- */
const SHORT_LINK = /(maps\.app\.goo\.gl|goo\.gl\/maps|maps\.apple\/p\/|share\.google)/i;

function parsePin(raw) {
  const t = (raw || "").trim();
  if (!t) return null;
  let dec = t;
  try { dec = decodeURIComponent(t); } catch { /* keep raw */ }
  const coord = (la, ln) => {
    const lat = parseFloat(la), lng = parseFloat(ln);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    if (lat < 24 || lat > 50 || lng < -125 || lng > -66) return null;   // continental US only
    return { lat: +lat.toFixed(6), lng: +lng.toFixed(6) };
  };
  let m, c = null, how = "";
  if ((m = dec.match(/!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)/))) { c = coord(m[1], m[2]); how = "Google place"; }
  else if ((m = dec.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/))) { c = coord(m[1], m[2]); how = "Google map centre"; }
  else if ((m = dec.match(/(?:^|[?&])(?:ll|sll|coordinate)=(-?\d+\.?\d*),(-?\d+\.?\d*)/))) { c = coord(m[1], m[2]); how = "Apple pin"; }
  else if ((m = dec.match(/(?:daddr|q|destination)=(-?\d+\.?\d*),\s*(-?\d+\.?\d*)/))) { c = coord(m[1], m[2]); how = "link coordinates"; }
  else if ((m = dec.match(/geo:(-?\d+\.?\d*),(-?\d+\.?\d*)/))) { c = coord(m[1], m[2]); how = "Android pin"; }
  else if ((m = dec.match(/(?:^|\s)(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})(?:\s|$)/))) { c = coord(m[1], m[2]); how = "pasted coordinates"; }
  if (c) return { ...c, how };
  if (SHORT_LINK.test(dec)) return { short: true };
  return null;
}

/* ---------------- navigation ----------------
   Google takes avoid-tolls from the link. Apple cannot — that's Apple's
   limitation, so we say so rather than pretend it worked.            */

function fullAddress(d) {
  return [d.address, d.city, [d.state, d.zip].filter(Boolean).join(" ")]
    .filter(Boolean).join(", ");
}

function navHref(dest, provider, avoidTolls, pin) {
  const target = (pin && pin.lat != null) ? `${pin.lat},${pin.lng}` : dest;
  const q = encodeURIComponent(target || "");
  if (provider === "apple") return `https://maps.apple.com/?daddr=${q}&dirflg=d`;
  return `https://www.google.com/maps/dir/?api=1&destination=${q}&travelmode=driving${avoidTolls ? "&avoid=tolls" : ""}`;
}

const DEFAULT_NAV = { mapPref: "google", avoidTolls: true };

function NavBlock({ drop, nav, setNav, label }) {
  const prov = nav.mapPref || "google";
  const avoid = nav.avoidTolls !== false;
  const dest = fullAddress(drop);
  const usingPin = drop.pin && drop.pin.lat != null;

  if (!dest && !usingPin) {
    return <p className="tw-note">No address yet — add one and a navigate button appears here.</p>;
  }

  return (
    <div style={{ marginTop: 9 }}>
      <a href={navHref(dest, prov, avoid, drop.pin)} target="_blank" rel="noreferrer"
        className="tw-btn" data-v="ghost" style={{ textDecoration: "none" }}>
        <Route size={16} /> {label || "Navigate"}
      </a>
      {usingPin && (
        <p className="tw-note tw-data" style={{ margin: "0 0 7px" }}>
          Going to the exact pin ({drop.pin.lat}, {drop.pin.lng}), not the street address.
        </p>
      )}

      <div style={{ display: "flex", gap: 6 }}>
        {[["google", "Google Maps"], ["apple", "Apple Maps"]].map(([k, l]) => (
          <button key={k} onClick={() => setNav({ ...nav, mapPref: k })} aria-pressed={prov === k}
            style={{
              flex: 1, padding: "9px 6px", borderRadius: 3, cursor: "pointer", fontSize: 12, fontWeight: 800,
              border: prov === k ? "2px solid var(--ink)" : "1px solid var(--line)",
              background: prov === k ? "var(--hiviz)" : "#fff", color: "var(--ink)",
            }}>{l}</button>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
        <button onClick={() => setNav({ ...nav, avoidTolls: !avoid })} aria-pressed={avoid}
          style={{
            width: 42, height: 23, borderRadius: 12, border: "1px solid var(--line)", flex: "0 0 42px",
            background: avoid ? "var(--go)" : "#CFD4D0", position: "relative", cursor: "pointer",
          }}>
          <span style={{ position: "absolute", top: 2, left: avoid ? 21 : 2, width: 17, height: 17,
            borderRadius: "50%", background: "#fff", transition: "left .15s" }} />
        </button>
        <span style={{ fontSize: 13, fontWeight: 700 }}>{avoid ? "Avoiding tolls" : "Tolls allowed"}</span>
      </div>

      {prov === "apple" && avoid && (
        <p className="tw-note" style={{ color: "var(--stop)" }}>
          Apple Maps ignores avoid-tolls from a link. Switch to Google above, or set it once
          in Settings → Maps → Driving → Avoid Tolls.
        </p>
      )}
    </div>
  );
}

/* ---------------- people, trucks, pay ---------------- */
const DRIVER_PCT = 22.5;          // share of gross revenue

const DRIVERS = [
  { id: "d1", name: "Harjit Singh", phone: "+1 682 555 0142", payPct: DRIVER_PCT, active: true },
  { id: "d2", name: "Marcus Bell", phone: "+1 682 555 0198", payPct: DRIVER_PCT, active: true },
  { id: "d3", name: "Ana Ruiz", phone: "+1 682 555 0121", payPct: DRIVER_PCT, active: true },
];
const VEHICLES = [
  { id: "v1", unitNo: "T-104", trailerNo: "TR-2290", type: "Tractor + 53' dry van", capacityLb: 44000, active: true },
  { id: "v2", unitNo: "T-107", trailerNo: "", type: "Straight truck 26'", capacityLb: 12000, active: true },
  { id: "v3", unitNo: "T-111", trailerNo: "FB-880", type: "Tractor + 48' flatbed", capacityLb: 48000, active: true },
];

const RUN_FLOW = ["draft", "assigned", "accepted", "at_pickup", "in_transit", "completed", "closed"];
const RUN_LABEL = {
  draft: "Not assigned", assigned: "Sent to driver", accepted: "Driver accepted",
  at_pickup: "At the dock", in_transit: "On the road", completed: "All drops done", closed: "Closed",
};
const RUN_TONE = {
  draft: "wait", assigned: "now", accepted: "now", at_pickup: "now",
  in_transit: "now", completed: "done", closed: "done",
};

/* ---------------- rates for invoicing ---------------- */
const RATES = { flatRate: 650, extraStopRate: 75, fuelPct: 18, freeStops: 2 };

function runCharges(run, rates = RATES) {
  const stops = (run.drops || []).filter((d) => d.status !== "cancelled");
  const extras = Math.max(0, stops.length - rates.freeStops);
  const flat = num(run.flatRate ?? rates.flatRate);
  const extraStops = extras * num(run.extraStopRate ?? rates.extraStopRate);
  const linehaul = flat + extraStops;
  const fuel = linehaul * num(run.fuelPct ?? rates.fuelPct) / 100;
  const other = num(run.extraCharges);
  const total = linehaul + fuel + other;
  return { stops: stops.length, extras, flat, extraStops, linehaul, fuel, other, total,
    driverPay: total * DRIVER_PCT / 100 };
}

const usd = (n) => "$" + num(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dayKey = (iso) => (iso || "").slice(0, 10);

/* ---------------- storage ---------------- */

function seedState() {
  /* one worked example, modelled on a real Ulterra dock handover,
     so the BOL and invoice views have something to show straight away */
  const sh = SHIPPERS[0];
  const d1 = { ...BLANK_DROP(), id: uid(), name: "DSV — Grapevine", address: "2400 Esters Blvd",
    city: "Grapevine", state: "TX", zip: "75261", ref: "CI37533", runNo: 1, status: "wait" };
  const d2 = { ...BLANK_DROP(), id: uid(), name: "OKC Warehouse", address: "",
    city: "Oklahoma City", state: "OK", zip: "", ref: "CI37539", runNo: 1, status: "wait" };

  const sample = {
    id: uid(), createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    ref: "TERM-1001", shipperId: sh.id,
    bol: {
      ...BLANK_BOL(),
      date: new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10),
      bolNumber: "81326",
      fromName: sh.name, fromAddress: sh.address, fromCity: sh.city, fromState: sh.state, fromZip: sh.zip,
      toName: "DSV", toAddress: "2400 Esters Blvd", toCity: "Grapevine", toState: "TX", toZip: "75261",
      shipperSignedBy: "Kenia Leon", shipperSignedDate: "8/13/26",
      trailerLoadedBy: "shipper", freightCountedBy: "driver_pieces",
    },
    orders: [
      { id: uid(), orderNo: "1110-CI37533", pkgs: "2", weight: "876", pallet: "N", shipperInfo: "2 boxes" },
      { id: uid(), orderNo: "1110-CI37539", pkgs: "2", weight: "851", pallet: "N", shipperInfo: "2 boxes" },
    ],
    items: [
      { ...BLANK_ITEM(), id: uid(), description: "1000637 5.0000\" MG515X", serialNo: "700410", qty: "1", weight: "0" },
    ],
    photos: [],
    drops: [d1, d2],
    status: "assigned", driverId: "d1", vehicleId: "v1",
    assignedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    notify: { at: new Date(Date.now() - 2 * 86400000).toISOString(),
      text: "New Term Loading run TERM-1001 — 2 drops from Ulterra Ft. Worth", seen: false },
    extraDocs: [], loadPhotos: [], shipperSig: null, shipperSignedBy: "",
    flatRate: 650, extraStopRate: 75, fuelPct: 18, extraCharges: 0,
    audit: [{ id: uid(), at: new Date(Date.now() - 2 * 86400000).toISOString(), what: "Intake completed at the dock" }],
    routeChange: null,
  };
  return { runs: [sample], draft: null };
}
async function load() {
  try {
    const r = await window.storage.get(KEY);
    if (!r) return seedState();
    const p = JSON.parse(r.value);
    return { runs: p.runs || [], draft: p.draft || null, nav: p.nav || DEFAULT_NAV };
  } catch { return seedState(); }
}
async function save(st) {
  try { await window.storage.set(KEY, JSON.stringify(st)); }
  catch (e) { console.error("save failed", e); }
}

const readAsDataUrl = (file) => new Promise((res, rej) => {
  const fr = new FileReader();
  fr.onerror = () => rej(new Error("read"));
  fr.onload = () => res(fr.result);
  fr.readAsDataURL(file);
});

/* photos need to stay legible for extraction, but small enough to store */
function shrink(file, max = 1400, q = 0.72) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onerror = () => rej(new Error("read"));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => rej(new Error("decode"));
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        res(c.toDataURL("image/jpeg", q));
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

/* ---------------- reading the paperwork ---------------- */

const EXTRACT_PROMPT = `You are reading ONE page of freight paperwork photographed at a US loading dock.

Read only what is on THIS page. Do not infer anything from other pages, and do not
assume this page belongs to the same load as any other page. Read handwriting as
carefully as print. If a box is blank or you cannot read it, return an empty string —
never guess, and never invent a code.

Reply with ONLY a JSON object, no markdown fences, no preamble:
{
  "docType": "bill_of_lading" | "packing_list" | "delivery_note" | "other",
  "docNumber": "the number identifying this page (BOL number, packing list number)",
  "date": "YYYY-MM-DD if unambiguous, else as written",
  "pageOf": "",
  "shipFrom": {"name":"","address":"","city":"","state":"","zip":"","sid":"","plantCode":""},
  "shipTo":   {"name":"","address":"","city":"","state":"","zip":"","locationNo":"","siteCode":""},
  "thirdParty": {"name":"","address":"","city":"","state":"","zip":""},
  "carrier": {"name":"","trailerNo":"","sealNos":"","scac":"","proNo":""},
  "freightTerms": "prepaid|collect|third_party|",
  "specialInstructions": "",
  "orders": [{"orderNo":"","pkgs":"","weight":"","pallet":"Y|N|","shipperInfo":""}],
  "items":  [{"description":"","serialNo":"","qty":"","weight":"","nmfc":"","freightClass":"","hazmat":false}],
  "codes": ["every reference, order, site or warehouse code visible on this page, exactly as written"],
  "totals": {"pkgs":"","weight":""},
  "shipperSignedBy": "",
  "notes": "anything unusual or hard to read, max 25 words"
}

Notes that matter:
- Weight is pounds unless a column says kg.
- Codes are often handwritten and change load to load. Copy them exactly. Do not
  interpret what a code means or map it to a destination.`;

async function extractOne(doc) {
  const b64 = doc.data.split(",")[1];
  const block = doc.mime === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
    : { type: "image", source: { type: "base64", media_type: doc.mime || "image/jpeg", data: b64 } };

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [{ role: "user", content: [block, { type: "text", text: EXTRACT_PROMPT }] }],
    }),
  });
  const data = await r.json();
  const text = data.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("no json");
  return JSON.parse(m[0]);
}

const DOC_LABEL = {
  bill_of_lading: "Bill of lading",
  packing_list: "Packing list",
  delivery_note: "Delivery note",
  other: "Other document",
};

/* ---------------- route ordering ---------------- */

async function askRoute(pickup, drops) {
  const list = drops.map((d, i) =>
    `${i + 1}. ${d.name || "Unnamed"} — ${[d.address, d.city, d.state, d.zip].filter(Boolean).join(", ") || "no address"}${d.window ? ` (window ${d.window})` : ""}`
  ).join("\n");
  const prompt = `Sequence a US truck route.

Start (pickup): ${pickup || "not given"}

Deliveries:
${list}

Minimise backtracking using US geography. Respect any delivery windows.
Reply with ONLY JSON, no fences:
{"order":[<the numbers above reordered>],"reason":"<max 20 words>","caution":"<max 20 words, or empty>"}`;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6", max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await r.json();
  const text = data.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

/* ================================================================== */

const CSS = `
:root{
  --ink:#16202B; --ink2:#2A3A4B; --mute:#6B7A88;
  --dock:#DFE1DE; --card:#F8F9F7; --line:#C3C7C2;
  --hiviz:#F2B705; --sea:#2B5F8A; --go:#2E7D53; --stop:#B3392F;
}
*{box-sizing:border-box}
.tw{ background:var(--dock); color:var(--ink); min-height:100vh; padding-bottom:44px;
  font-family:system-ui,-apple-system,"Segoe UI",sans-serif; font-size:15px; line-height:1.45 }
.tw-display{ font-family:"Arial Narrow","Roboto Condensed",system-ui,sans-serif;
  text-transform:uppercase; letter-spacing:.06em; font-weight:800; line-height:1.05 }
.tw-data{ font-family:ui-monospace,"SF Mono",Menlo,monospace; font-variant-numeric:tabular-nums }
.tw-eyebrow{ font-size:10px; letter-spacing:.18em; text-transform:uppercase; color:var(--mute); font-weight:700 }
.tw-note{ font-size:12.5px; color:var(--mute); margin:6px 0 0 }

.tw-bar{ background:var(--ink); color:#fff; padding:12px 14px; display:flex; align-items:center; gap:10px; position:sticky; top:0; z-index:20 }
.tw-bar h1{ margin:0; font-size:17px }
.tw-wrap{ max-width:640px; margin:0 auto; padding:14px }

/* step rail */
.tw-steps{ display:flex; gap:3px; margin-bottom:14px }
.tw-step{ flex:1; text-align:center; padding:7px 3px; border-radius:2px; background:#D2D6D2;
  font-size:9.5px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; color:var(--mute);
  cursor:pointer; border:0 }
.tw-step[data-s="done"]{ background:var(--go); color:#fff }
.tw-step[data-s="now"]{ background:var(--hiviz); color:var(--ink) }

.tw-card{ background:var(--card); border:1px solid var(--line); border-radius:3px; padding:14px; margin-bottom:12px }
.tw-hr{ border:0; border-top:1px dashed var(--line); margin:12px 0 }

.tw-btn{ display:flex; align-items:center; justify-content:center; gap:8px; width:100%; padding:14px; border:0; border-radius:3px;
  background:var(--ink); color:#fff; font-size:14px; font-weight:800; letter-spacing:.07em; text-transform:uppercase;
  cursor:pointer; font-family:"Arial Narrow","Roboto Condensed",system-ui,sans-serif; margin-bottom:10px }
.tw-btn[data-v="go"]{ background:var(--go) } .tw-btn[data-v="hiviz"]{ background:var(--hiviz); color:var(--ink) }
.tw-btn[data-v="ghost"]{ background:none; color:var(--ink); border:1px solid var(--line) }
.tw-btn[data-v="danger"]{ background:none; color:var(--stop); border:1px solid var(--line) }
.tw-btn:disabled{ background:#AEB6BD; cursor:not-allowed }
.tw-btn-sm{ width:auto; padding:9px 12px; font-size:12px; margin-bottom:0 }
button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{ outline:3px solid var(--sea); outline-offset:2px }

.tw-fld{ margin-bottom:10px }
.tw-fld label{ display:block; font-size:10px; letter-spacing:.14em; text-transform:uppercase; color:var(--mute); font-weight:700; margin-bottom:4px }
.tw-fld input,.tw-fld select,.tw-fld textarea{ width:100%; padding:11px; border:1px solid var(--line); border-radius:2px; background:#fff;
  font-size:15px; font-family:ui-monospace,Menlo,monospace; color:var(--ink) }
.tw-fld input[data-auto="1"]{ background:#F4F9F5; border-color:var(--go) }
.tw-row{ display:flex; gap:8px } .tw-row>*{ flex:1 }

.tw-tag{ display:inline-block; padding:2px 7px; border-radius:2px; font-size:10px; font-weight:800; letter-spacing:.09em; text-transform:uppercase }
.tw-tag[data-t="done"]{ background:#DCEEE3; color:var(--go) }
.tw-tag[data-t="now"]{ background:#FFF0C2; color:#6B5200 }
.tw-tag[data-t="wait"]{ background:#E4E7E4; color:var(--mute) }
.tw-tag[data-t="exc"]{ background:#F8E3E1; color:var(--stop) }

.tw-doc{ position:relative; border:1px solid var(--line); border-radius:3px; overflow:hidden; background:#fff; margin-bottom:8px }
.tw-doc img{ width:100%; max-height:210px; object-fit:cover; display:block }
.tw-doc-foot{ display:flex; align-items:center; gap:8px; padding:8px 10px }

.tw-block{ border:2px solid var(--ink); border-radius:3px; margin-bottom:12px; overflow:hidden }
.tw-block-top{ height:9px; background:repeating-linear-gradient(45deg,var(--hiviz) 0 10px,var(--ink) 10px 20px) }
.tw-block-body{ background:#FFF8E1; padding:11px 13px }

.tw-sub{ border:1px solid var(--line); border-left:4px solid var(--sea); background:#fff; border-radius:2px; padding:11px; margin-bottom:8px }
.tw-seq{ width:26px;height:26px;flex:0 0 26px;border-radius:50%;background:var(--ink);color:#fff;
  display:grid;place-items:center;font-family:ui-monospace,monospace;font-size:12px;font-weight:700 }
.tw-empty{ text-align:center; padding:26px 14px; color:var(--mute) }
.tw-bol{ background:#fff; border:1px solid var(--ink); padding:16px; font-family:ui-monospace,Menlo,monospace; font-size:11px; color:#000; margin-bottom:12px }
.tw-bol h2{ font-size:15px; margin:0; letter-spacing:.1em }
.tw-bol table{ width:100%; border-collapse:collapse; margin:8px 0; font-size:10px }
.tw-bol th,.tw-bol td{ border:1px solid #999; padding:4px; text-align:left; vertical-align:top }
.tw-bol th{ background:#EEE }
.tw-bolhd{ display:flex; justify-content:space-between; border-bottom:2px solid #000; padding-bottom:6px; margin-bottom:8px }
@media print{
  body *{ visibility:hidden !important }
  .tw-print,.tw-print *{ visibility:visible !important }
  .tw-print{ position:relative; left:0; top:0; width:100% }
  .tw-noprint{ display:none !important }
}
.tw-hint{ background:#EAF1F8; border:1px solid var(--sea); border-radius:3px; padding:10px; margin-bottom:10px; font-size:12.5px }
`;

/* ================================================================== */
/* Small pieces                                                       */
/* ================================================================== */

function F({ label, value, onChange, auto, type = "text", mode, placeholder }) {
  return (
    <div className="tw-fld">
      <label>{label}</label>
      <input type={type} inputMode={mode} placeholder={placeholder}
        data-auto={auto && String(value || "").trim() ? "1" : undefined}
        value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function Steps({ step, go, max }) {
  const names = ["Start", "Docs", "Details", "Freight", "Drops", "Done"];
  return (
    <div className="tw-steps">
      {names.map((n, i) => (
        <button key={n} className="tw-step" disabled={i > max}
          data-s={i < step ? "done" : i === step ? "now" : ""}
          onClick={() => i <= max && go(i)}>{n}</button>
      ))}
    </div>
  );
}

/* ================================================================== */
/* Step 0 — start                                                     */
/* ================================================================== */

function Start({ onPick, onQuick, runs }) {
  return (
    <>
      <div className="tw-card" style={{ borderLeft: "4px solid var(--go)" }}>
        <div className="tw-eyebrow">Usual sequence</div>
        <h3 className="tw-display" style={{ fontSize: 18, margin: "3px 0 0" }}>The text comes first</h3>
        <p className="tw-note">
          Ulterra texts an address. You send a driver straight away — that takes about twenty seconds.
          He photographs the paperwork at the dock and builds the drops from it.
          Only use the wizard below if you already have the documents in hand.
        </p>
        <hr className="tw-hr" />
        <QuickDispatch runs={runs} onCreate={onQuick} />
      </div>

      <div className="tw-card">
        <div className="tw-eyebrow">Or start from the paperwork</div>
        <h3 className="tw-display" style={{ fontSize: 21, margin: "3px 0 0" }}>Paperwork at the dock</h3>
        <p className="tw-note">
          For customers who text you a pickup address and hand the driver paper on arrival.
          Nothing here is mandatory — fill what you have, correct it later.
        </p>
      </div>

      <div className="tw-eyebrow" style={{ margin: "0 0 8px" }}>Regular shippers</div>
      {SHIPPERS.map((sh) => (
        <button key={sh.id} className="tw-card" onClick={() => onPick(sh)}
          style={{ display: "flex", gap: 10, width: "100%", textAlign: "left", cursor: "pointer", alignItems: "flex-start" }}>
          <Building2 size={18} color="var(--sea)" style={{ marginTop: 2, flex: "0 0 18px" }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <b style={{ fontSize: 15 }}>{sh.name}</b>
            <p className="tw-note tw-data" style={{ margin: "3px 0 0" }}>
              {sh.address}, {sh.city}, {sh.state} {sh.zip}
            </p>
            <p className="tw-note" style={{ margin: "4px 0 0" }}>{sh.note}</p>
          </div>
          <ChevronRight size={16} color="var(--mute)" style={{ flex: "0 0 16px", marginTop: 4 }} />
        </button>
      ))}

      <button className="tw-btn" data-v="ghost" onClick={() => onPick(null)}>
        <Plus size={16} /> Different shipper — start blank
      </button>
    </>
  );
}

/* ================================================================== */
/* Step 1 — documents + autofill                                      */
/* ================================================================== */

function DocCard({ doc, index, drops, onRead, onPatch, onRemove }) {
  const f = doc.fields;
  return (
    <div className="tw-doc">
      {doc.mime === "application/pdf" ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 16, background: "#EEF2F6" }}>
          <FileText size={26} color="var(--sea)" />
          <div style={{ minWidth: 0 }}>
            <b style={{ fontSize: 13.5 }}>{doc.fileName || "Attached PDF"}</b>
            <p className="tw-note" style={{ margin: 0 }}>PDF attachment</p>
          </div>
        </div>
      ) : (
        <img src={doc.data} alt={`Page ${index + 1}`} />
      )}
      <div style={{ padding: "10px 11px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 7 }}>
          <span className="tw-tag" data-t={doc.read ? "done" : "wait"}>
            {doc.read ? DOC_LABEL[doc.type] || "Document" : `Page ${index + 1}`}
          </span>
          {doc.read && f?.docNumber && (
            <span className="tw-data" style={{ fontSize: 12, fontWeight: 700 }}>{f.docNumber}</span>
          )}
          <span style={{ flex: 1 }} />
          <button className="tw-btn tw-btn-sm" data-v="danger" onClick={onRemove}>
            <Trash2 size={12} />
          </button>
        </div>

        {!doc.read && (
          <button className="tw-btn tw-btn-sm" data-v="go" style={{ width: "100%" }}
            onClick={onRead} disabled={doc.busy}>
            {doc.busy ? <Loader2 size={13} /> : <FileText size={13} />}
            {doc.busy ? "Reading…" : "Read this page"}
          </button>
        )}
        {doc.err && <p className="tw-note" style={{ color: "var(--stop)" }}>{doc.err}</p>}

        {doc.read && (
          <>
            <div className="tw-data" style={{ fontSize: 12, lineHeight: 1.6 }}>
              {f.shipTo?.name || f.shipTo?.siteCode
                ? <div>To: {f.shipTo.name || ""} {f.shipTo.siteCode ? `(${f.shipTo.siteCode})` : ""}</div> : null}
              <div>{doc.orders.length} order line(s) · {doc.items.length} item(s)</div>
              {f.codes?.length > 0 && (
                <div style={{ color: "var(--mute)" }}>Codes read: {f.codes.join(", ")}</div>
              )}
            </div>
            {f.notes && <p className="tw-note">{f.notes}</p>}

            <div className="tw-fld" style={{ marginTop: 9, marginBottom: 0 }}>
              <label>This page belongs to</label>
              <select value={doc.dropId} onChange={(e) => onPatch({ dropId: e.target.value })}>
                <option value="">— not decided yet —</option>
                <option value="__trip">The whole run (header paperwork)</option>
                {drops.map((d, i) => (
                  <option key={d.id} value={d.id}>Drop {i + 1} — {d.name || "unnamed"}</option>
                ))}
                <option value="__other">A different load — ignore this page</option>
              </select>
            </div>
            {doc.dropId === "__other" && (
              <p className="tw-note">Kept on file, but nothing from it will be used.</p>
            )}
            {!doc.dropId && (
              <p className="tw-note" style={{ color: "var(--sea)", fontWeight: 700 }}>
                Say which load this belongs to — pages often come from different loads.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Docs({ docs, setDocs, drops, onReadOne, onReadAll }) {
  const camRef = useRef(null);
  const fileRef = useRef(null);
  const [adding, setAdding] = useState(false);
  const [warn, setWarn] = useState(null);

  const ingest = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setAdding(true); setWarn(null);
    const out = [];
    for (const f of files) {
      try {
        if (f.type === "application/pdf") {
          if (f.size > 4 * 1024 * 1024) { setWarn(`${f.name} is over 4 MB — split it or photograph the page instead.`); continue; }
          out.push({ id: uid(), data: await readAsDataUrl(f), mime: "application/pdf", fileName: f.name,
            read: false, busy: false, type: "other", fields: null, orders: [], items: [], dropId: "", err: null });
        } else if (f.type.startsWith("image/")) {
          out.push({ id: uid(), data: await shrink(f), mime: "image/jpeg", fileName: f.name,
            read: false, busy: false, type: "other", fields: null, orders: [], items: [], dropId: "", err: null });
        } else {
          setWarn(`${f.name} isn't a photo or a PDF.`);
        }
      } catch { setWarn("One of those files couldn't be read."); }
    }
    setDocs([...docs, ...out]);
    setAdding(false);
    e.target.value = "";
  };

  const unread = docs.filter((d) => !d.read).length;

  return (
    <>
      <div className="tw-card">
        <div className="tw-eyebrow">Step 2 · what they handed you</div>
        <h3 className="tw-display" style={{ fontSize: 19, margin: "3px 0 0" }}>Photograph every page</h3>
        <p className="tw-note">
          Each page is read on its own, then you say which load it belongs to.
          Paperwork handed over together often covers different loads — the app never assumes they match.
        </p>
        <hr className="tw-hr" />

        {docs.map((d, i) => (
          <DocCard key={d.id} doc={d} index={i} drops={drops}
            onRead={() => onReadOne(d.id)}
            onPatch={(p) => setDocs(docs.map((x) => (x.id === d.id ? { ...x, ...p } : x)))}
            onRemove={() => setDocs(docs.filter((x) => x.id !== d.id))} />
        ))}

        <div style={{ display: "flex", gap: 8 }}>
          <button className="tw-btn" data-v="ghost" onClick={() => camRef.current?.click()} disabled={adding}>
            <Camera size={17} /> {adding ? "Working…" : "Take photo"}
          </button>
          <button className="tw-btn" data-v="ghost" onClick={() => fileRef.current?.click()} disabled={adding}>
            <Paperclip size={17} /> Attach file
          </button>
        </div>
        <p className="tw-note" style={{ marginTop: 0 }}>
          Photos or PDFs. Emailed paperwork can be attached straight from the phone —
          no need to print it and photograph it.
        </p>
        {warn && <p className="tw-note" style={{ color: "var(--stop)", fontWeight: 700 }}>{warn}</p>}
        <input ref={camRef} type="file" accept="image/*" capture="environment" multiple
          onChange={ingest} style={{ display: "none" }} />
        <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple
          onChange={ingest} style={{ display: "none" }} />

        {unread > 0 && (
          <button className="tw-btn" data-v="go" onClick={onReadAll}>
            <FileText size={16} /> Read the {unread} unread page{unread === 1 ? "" : "s"}
          </button>
        )}
      </div>

      {docs.length === 0 && (
        <p className="tw-note" style={{ textAlign: "center" }}>
          You can skip this and type everything by hand instead.
        </p>
      )}
    </>
  );
}

/* ================================================================== */
/* Step 2 — BOL details                                               */
/* ================================================================== */

function Details({ bol, set, autoKeys }) {
  const A = (k) => autoKeys.has(k);
  return (
    <>
      <div className="tw-card">
        <div className="tw-eyebrow">Step 3 · bill of lading</div>
        <h3 className="tw-display" style={{ fontSize: 19, margin: "3px 0 0" }}>Header</h3>
        <p className="tw-note">Green fields were read from the photos. Everything is optional.</p>
        <hr className="tw-hr" />
        <div className="tw-row">
          <F label="Date" type="date" value={bol.date} onChange={set("date")} auto={A("date")} />
          <F label="BOL number" value={bol.bolNumber} onChange={set("bolNumber")} auto={A("bolNumber")} />
          <F label="Page of" value={bol.pageOf} onChange={set("pageOf")} auto={A("pageOf")} />
        </div>
      </div>

      <div className="tw-card">
        <div className="tw-eyebrow">Ship from</div>
        <hr className="tw-hr" />
        <F label="Name" value={bol.fromName} onChange={set("fromName")} auto={A("fromName")} />
        <F label="Address" value={bol.fromAddress} onChange={set("fromAddress")} auto={A("fromAddress")} />
        <div className="tw-row">
          <F label="City" value={bol.fromCity} onChange={set("fromCity")} auto={A("fromCity")} />
          <F label="State" value={bol.fromState} onChange={set("fromState")} auto={A("fromState")} />
          <F label="ZIP" value={bol.fromZip} onChange={set("fromZip")} auto={A("fromZip")} mode="numeric" />
        </div>
        <F label="SID #" value={bol.sid} onChange={set("sid")} auto={A("sid")} />
      </div>

      <div className="tw-card">
        <div className="tw-eyebrow">Ship to (as printed on the BOL)</div>
        <hr className="tw-hr" />
        <F label="Name" value={bol.toName} onChange={set("toName")} auto={A("toName")} />
        <F label="Address" value={bol.toAddress} onChange={set("toAddress")} auto={A("toAddress")} />
        <div className="tw-row">
          <F label="City" value={bol.toCity} onChange={set("toCity")} auto={A("toCity")} />
          <F label="State" value={bol.toState} onChange={set("toState")} auto={A("toState")} />
          <F label="ZIP" value={bol.toZip} onChange={set("toZip")} auto={A("toZip")} mode="numeric" />
        </div>
        <F label="Location #" value={bol.locationNo} onChange={set("locationNo")} auto={A("locationNo")} />
        <p className="tw-note">
          This is what the paper says. The actual drops get built in the next step —
          they don't always match.
        </p>
      </div>

      <div className="tw-card">
        <div className="tw-eyebrow">Carrier &amp; equipment</div>
        <hr className="tw-hr" />
        <F label="Carrier name" value={bol.carrierName} onChange={set("carrierName")} />
        <div className="tw-row">
          <F label="Trailer number" value={bol.trailerNo} onChange={set("trailerNo")} auto={A("trailerNo")} />
          <F label="Seal number(s)" value={bol.sealNos} onChange={set("sealNos")} auto={A("sealNos")} />
        </div>
        <div className="tw-row">
          <F label="SCAC" value={bol.scac} onChange={set("scac")} auto={A("scac")} />
          <F label="Pro number" value={bol.proNo} onChange={set("proNo")} auto={A("proNo")} />
        </div>
      </div>

      <div className="tw-card">
        <div className="tw-eyebrow">Charges &amp; handling</div>
        <hr className="tw-hr" />
        <div className="tw-fld">
          <label>Freight charge terms</label>
          <select value={bol.freightTerms} onChange={(e) => set("freightTerms")(e.target.value)}>
            <option value="prepaid">Prepaid</option>
            <option value="collect">Collect</option>
            <option value="third_party">3rd party</option>
          </select>
        </div>
        <div className="tw-row">
          <div className="tw-fld">
            <label>Trailer loaded by</label>
            <select value={bol.trailerLoadedBy} onChange={(e) => set("trailerLoadedBy")(e.target.value)}>
              <option value="shipper">Shipper</option>
              <option value="driver">Driver</option>
            </select>
          </div>
          <div className="tw-fld">
            <label>Freight counted by</label>
            <select value={bol.freightCountedBy} onChange={(e) => set("freightCountedBy")(e.target.value)}>
              <option value="shipper">Shipper</option>
              <option value="driver_pallets">Driver — pallets said to contain</option>
              <option value="driver_pieces">Driver — pieces</option>
            </select>
          </div>
        </div>
        <div className="tw-row">
          <F label="COD amount ($)" value={bol.codAmount} onChange={set("codAmount")} mode="decimal" />
          <div className="tw-fld">
            <label>COD fee terms</label>
            <select value={bol.codFeeTerms} onChange={(e) => set("codFeeTerms")(e.target.value)}>
              <option value="">—</option><option value="collect">Collect</option><option value="prepaid">Prepaid</option>
            </select>
          </div>
        </div>
        <F label="Third party bill to" value={bol.tpName} onChange={set("tpName")} auto={A("tpName")} />
        <div className="tw-fld">
          <label>Special instructions</label>
          <textarea rows={2} value={bol.specialInstructions}
            onChange={(e) => set("specialInstructions")(e.target.value)} />
        </div>
        <div className="tw-row">
          <F label="Shipper signed by" value={bol.shipperSignedBy} onChange={set("shipperSignedBy")} auto={A("shipperSignedBy")} />
          <F label="Signed date" value={bol.shipperSignedDate} onChange={set("shipperSignedDate")} auto={A("shipperSignedDate")} />
        </div>
      </div>
    </>
  );
}

/* ================================================================== */
/* Step 3 — freight                                                   */
/* ================================================================== */

function Freight({ orders, setOrders, items, setItems, drops, docs = [] }) {
  const pending = docs.filter((d) => d.read && !d.dropId).length;
  const totalPkgs = orders.reduce((a, b) => a + num(b.pkgs), 0);
  const totalWt = orders.reduce((a, b) => a + num(b.weight), 0);
  const itemWt = items.reduce((a, b) => a + num(b.weight), 0);

  const up = (list, setList, id, k) => (v) =>
    setList(list.map((x) => (x.id === id ? { ...x, [k]: v } : x)));

  return (
    <>
      {pending > 0 && (
        <div className="tw-block">
          <div className="tw-block-top" />
          <div className="tw-block-body">
            <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700 }}>
              <AlertTriangle size={14} /> {pending} page{pending === 1 ? "" : "s"} not assigned to a load yet
            </p>
            <p style={{ margin: "6px 0 0", fontSize: 13 }}>
              Go back a step and say which load each page belongs to. Nothing from an
              unassigned page is counted here.
            </p>
          </div>
        </div>
      )}

      <div className="tw-card">
        <div className="tw-eyebrow">Step 4 · customer order information</div>
        <h3 className="tw-display" style={{ fontSize: 19, margin: "3px 0 0" }}>
          {orders.length} order line{orders.length === 1 ? "" : "s"} · {totalPkgs} pkgs · {totalWt.toLocaleString()} lb
        </h3>
        <p className="tw-note">Straight off the BOL grid. Blank rows are fine.</p>
        <hr className="tw-hr" />
        {orders.map((o, i) => (
          <div key={o.id} className="tw-sub">
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
              <div className="tw-seq">{i + 1}</div>
              <b style={{ fontSize: 13, flex: 1 }}>Order line</b>
              <button onClick={() => setOrders(orders.filter((x) => x.id !== o.id))} aria-label="Remove"
                style={{ background: "none", border: "1px solid var(--line)", borderRadius: 2, padding: "3px 6px", cursor: "pointer", color: "var(--stop)" }}>
                <Trash2 size={12} />
              </button>
            </div>
            <F label="Customer order number" value={o.orderNo} onChange={up(orders, setOrders, o.id, "orderNo")} auto />
            <div className="tw-row">
              <F label="# pkgs" value={o.pkgs} onChange={up(orders, setOrders, o.id, "pkgs")} mode="numeric" auto />
              <F label="Weight (lb)" value={o.weight} onChange={up(orders, setOrders, o.id, "weight")} mode="numeric" auto />
              <div className="tw-fld">
                <label>Pallet / slip</label>
                <select value={o.pallet} onChange={(e) => up(orders, setOrders, o.id, "pallet")(e.target.value)}>
                  <option value="">—</option><option value="Y">Y</option><option value="N">N</option>
                </select>
              </div>
            </div>
            <F label="Additional shipper info" value={o.shipperInfo} onChange={up(orders, setOrders, o.id, "shipperInfo")} auto />
          </div>
        ))}
        <button className="tw-btn tw-btn-sm" data-v="ghost" onClick={() => setOrders([...orders, BLANK_ORDER()])}>
          <Plus size={13} /> Add order line
        </button>
      </div>

      <div className="tw-card">
        <div className="tw-eyebrow">Packing list assets</div>
        <h3 className="tw-display" style={{ fontSize: 19, margin: "3px 0 0" }}>
          {items.length} item{items.length === 1 ? "" : "s"} · {itemWt.toLocaleString()} lb
        </h3>
        <p className="tw-note">Serial numbers matter here — this is what a claim gets argued over.</p>
        <hr className="tw-hr" />
        {items.length === 0 && <p className="tw-note">Nothing yet.</p>}
        {items.map((it, i) => (
          <div key={it.id} className="tw-sub">
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
              <div className="tw-seq">{i + 1}</div>
              <b style={{ fontSize: 13, flex: 1 }}>Item</b>
              <button onClick={() => setItems(items.filter((x) => x.id !== it.id))} aria-label="Remove"
                style={{ background: "none", border: "1px solid var(--line)", borderRadius: 2, padding: "3px 6px", cursor: "pointer", color: "var(--stop)" }}>
                <Trash2 size={12} />
              </button>
            </div>
            {it.docId && (
              <p className="tw-note" style={{ margin: "0 0 7px" }}>
                Read from page {docs.findIndex((d) => d.id === it.docId) + 1}
                {docs.find((d) => d.id === it.docId)?.fields?.docNumber
                  ? ` · ${docs.find((d) => d.id === it.docId).fields.docNumber}` : ""}
              </p>
            )}
            <F label="Description" value={it.description} onChange={up(items, setItems, it.id, "description")} auto />
            <div className="tw-row">
              <F label="Serial #" value={it.serialNo} onChange={up(items, setItems, it.id, "serialNo")} auto />
              <F label="Qty" value={it.qty} onChange={up(items, setItems, it.id, "qty")} mode="numeric" auto />
              <F label="Weight (lb)" value={it.weight} onChange={up(items, setItems, it.id, "weight")} mode="numeric" auto />
            </div>
            <div className="tw-row">
              <F label="NMFC #" value={it.nmfc} onChange={up(items, setItems, it.id, "nmfc")} />
              <F label="Class" value={it.freightClass} onChange={up(items, setItems, it.id, "freightClass")} />
            </div>
            <div className="tw-fld">
              <label>Drops at</label>
              <select value={it.dropId} onChange={(e) => up(items, setItems, it.id, "dropId")(e.target.value)}>
                <option value="">Not assigned yet</option>
                {drops.map((d, n) => <option key={d.id} value={d.id}>{n + 1}. {d.name || "Unnamed"}</option>)}
              </select>
            </div>
          </div>
        ))}
        <button className="tw-btn tw-btn-sm" data-v="ghost" onClick={() => setItems([...items, BLANK_ITEM()])}>
          <Plus size={13} /> Add item
        </button>
      </div>
    </>
  );
}

/* ================================================================== */
/* Step 4 — drops                                                     */
/* ================================================================== */

function Drops({ drops, setDrops, shipper, pickupLabel, codes, nav, setNav }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState(null);

  const up = (id, k) => (v) => setDrops(drops.map((d) => (d.id === id ? { ...d, [k]: v } : d)));
  const move = (i, dir) => {
    const n = [...drops]; const j = i + dir;
    if (j < 0 || j >= n.length) return;
    [n[i], n[j]] = [n[j], n[i]]; setDrops(n);
  };

  const suggest = async () => {
    setBusy(true); setErr(null); setRes(null);
    try {
      const out = await askRoute(pickupLabel, drops);
      if (!Array.isArray(out.order) || out.order.length !== drops.length) throw new Error("bad");
      setRes(out);
    } catch { setErr("Couldn't work out an order. Check the addresses."); }
    setBusy(false);
  };

  return (
    <>
      <div className="tw-card">
        <div className="tw-eyebrow">Step 5 · where it's going</div>
        <h3 className="tw-display" style={{ fontSize: 19, margin: "3px 0 0" }}>
          {drops.length} drop{drops.length === 1 ? "" : "s"}
        </h3>
        <p className="tw-note">Collecting from {pickupLabel || "the pickup site"}.</p>
        {(() => {
          const runs = [...new Set(drops.map((d) => d.runNo || 1))].sort();
          if (runs.length < 2) return (
            <p className="tw-note">
              All drops are on one run. If this pickup is really two separate jobs,
              put some drops on Run 2 and you'll get a separate BOL and invoice line for each.
            </p>
          );
          return (
            <p className="tw-note" style={{ color: "var(--sea)", fontWeight: 700 }}>
              Splitting into {runs.length} runs — each gets its own BOL and bills separately.
            </p>
          );
        })()}
        {codes?.length > 0 && (
          <div className="tw-hint" style={{ marginTop: 10 }}>
            <b>Codes read off the paperwork:</b>{" "}
            <span className="tw-data">{codes.join(" · ")}</span>
            <div style={{ marginTop: 4 }}>
              These are copied exactly as written. They change from load to load, so match them
              to a destination yourself — nothing is assumed.
            </div>
          </div>
        )}
      </div>

      {shipper?.knownDrops?.length > 0 && (
        <div className="tw-card">
          <div className="tw-eyebrow">Sites you've delivered to before</div>
          <hr className="tw-hr" />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {shipper.knownDrops.map((k) => (
              <button key={k.code} className="tw-btn tw-btn-sm" data-v="ghost"
                onClick={() => setDrops([...drops, { ...BLANK_DROP(), ...k, id: uid(), status: "wait" }])}>
                <Plus size={12} /> {k.name}
              </button>
            ))}
          </div>
          <p className="tw-note">
            Sites you've delivered to before. One tap adds it — correct the address if it's changed.
            Which site a load goes to comes off the paperwork each time, not from these.
          </p>
        </div>
      )}

      {drops.map((d, i) => (
        <div key={d.id} className="tw-card" style={{ borderLeft: "4px solid var(--ink)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
            <div className="tw-seq">{i + 1}</div>
            <b style={{ fontSize: 14, flex: 1 }}>Drop {i + 1}</b>
            <button onClick={() => move(i, -1)} disabled={i === 0} aria-label="Up"
              style={{ background: "none", border: "1px solid var(--line)", borderRadius: 2, padding: "4px 6px", cursor: "pointer", opacity: i === 0 ? .35 : 1 }}><ArrowUp size={12} /></button>
            <button onClick={() => move(i, 1)} disabled={i === drops.length - 1} aria-label="Down"
              style={{ background: "none", border: "1px solid var(--line)", borderRadius: 2, padding: "4px 6px", cursor: "pointer", opacity: i === drops.length - 1 ? .35 : 1 }}><ArrowDown size={12} /></button>
            <button onClick={() => setDrops(drops.filter((x) => x.id !== d.id))} aria-label="Remove"
              style={{ background: "none", border: "1px solid var(--line)", borderRadius: 2, padding: "4px 6px", cursor: "pointer", color: "var(--stop)" }}><Trash2 size={12} /></button>
          </div>
          <div className="tw-row">
            <F label="Site code" value={d.code} onChange={up(d.id, "code")} />
            <F label="Site name" value={d.name} onChange={up(d.id, "name")} />
            <div className="tw-fld">
              <label>Run</label>
              <select value={d.runNo || 1} onChange={(e) => up(d.id, "runNo")(Number(e.target.value))}>
                {[1, 2, 3, 4].map((n) => <option key={n} value={n}>Run {n}</option>)}
              </select>
            </div>
          </div>
          <F label="Address" value={d.address} onChange={up(d.id, "address")} />
          <div className="tw-row">
            <F label="City" value={d.city} onChange={up(d.id, "city")} />
            <F label="State" value={d.state} onChange={up(d.id, "state")} />
            <F label="ZIP" value={d.zip} onChange={up(d.id, "zip")} mode="numeric" />
          </div>
          <div className="tw-row">
            <F label="Window" value={d.window} onChange={up(d.id, "window")} placeholder="09:00–12:00" />
            <F label="Reference" value={d.ref} onChange={up(d.id, "ref")} />
          </div>
          <div className="tw-row">
            <F label="Contact" value={d.contact} onChange={up(d.id, "contact")} />
            <F label="Phone" value={d.contactPhone} onChange={up(d.id, "contactPhone")} />
          </div>
          <F label="Dropped pin (paste a maps link or coordinates)" value={d.pinText || ""}
            onChange={(v) => {
              const p = parsePin(v);
              setDrops(drops.map((x) => (x.id === d.id
                ? { ...x, pinText: v, pin: p && p.lat != null ? p : null } : x)));
            }}
            placeholder="29.7604, -95.3698 or a Google maps link" />
          {d.pin?.lat != null && (
            <p className="tw-note tw-data" style={{ color: "var(--go)", fontWeight: 700 }}>
              Pin set: {d.pin.lat}, {d.pin.lng} · {d.pin.how}
            </p>
          )}
          {d.pinText && !d.pin && (
            <p className="tw-note" style={{ color: "var(--stop)" }}>
              Couldn't read coordinates from that. A shortened link won't open in a browser —
              tap it on the phone first, then paste the full link.
            </p>
          )}
          <NavBlock drop={d} nav={nav} setNav={setNav} label={`Navigate to ${d.name || "this drop"}`} />
        </div>
      ))}

      <button className="tw-btn tw-btn-sm" data-v="ghost" style={{ marginBottom: 12 }}
        onClick={() => setDrops([...drops, BLANK_DROP()])}>
        <Plus size={13} /> Add a drop
      </button>

      {drops.length > 1 && (
        <div className="tw-card" style={{ borderLeft: "4px solid var(--sea)" }}>
          <div className="tw-eyebrow">Route order</div>
          {!res && (
            <button className="tw-btn tw-btn-sm" data-v="ghost" onClick={suggest} disabled={busy}>
              {busy ? <Loader2 size={13} /> : <Route size={13} />} {busy ? "Working it out…" : "Suggest best order"}
            </button>
          )}
          {err && <p className="tw-note" style={{ color: "var(--stop)" }}>{err}</p>}
          {res && (
            <>
              <div className="tw-data" style={{ fontSize: 12.5, fontWeight: 700, margin: "6px 0 5px" }}>
                {res.order.map((n) => drops[n - 1]?.name || `Drop ${n}`).join("  →  ")}
              </div>
              <p className="tw-note" style={{ margin: "0 0 4px" }}>{res.reason}</p>
              {res.caution && (
                <p className="tw-note" style={{ color: "var(--stop)", fontWeight: 700 }}>
                  <AlertTriangle size={11} /> {res.caution}
                </p>
              )}
              <p className="tw-note" style={{ fontStyle: "italic" }}>
                Geography only — no live traffic. Dispatch can change this at any point on the road.
              </p>
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                <button className="tw-btn tw-btn-sm" data-v="go"
                  onClick={() => { setDrops(res.order.map((n) => drops[n - 1])); setRes(null); }}>
                  <Check size={13} /> Use this order
                </button>
                <button className="tw-btn tw-btn-sm" data-v="ghost" onClick={() => setRes(null)}>
                  <X size={13} /> Keep mine
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

/* ================================================================== */
/* Live route — dispatch changing things mid-trip                     */
/* ================================================================== */

function LiveRoute({ run, onPatch, nav, setNav }) {
  const [note, setNote] = useState("");
  const drops = run.drops || [];
  const openIdx = drops.map((d, i) => (d.status === "wait" ? i : -1)).filter((i) => i >= 0);

  const move = (i, dir) => {
    const j = i + dir;
    if (!openIdx.includes(i) || !openIdx.includes(j)) return;   // completed stops can't move
    const n = [...drops];
    [n[i], n[j]] = [n[j], n[i]];
    onPatch({ drops: n, routeChange: { at: now(), note: note.trim() || "Stop order changed by dispatch.", ack: null } });
  };

  const setStatus = (id, status, reason) =>
    onPatch({
      drops: drops.map((d) => (d.id === id ? { ...d, status, reason, doneAt: now() } : d)),
      audit: [...(run.audit || []), { id: uid(), at: now(), what: `${drops.find((d) => d.id === id)?.name} — ${status}${reason ? `: ${reason}` : ""}` }],
    });

  return (
    <div className="tw-card" style={{ borderLeft: "4px solid var(--hiviz)" }}>
      <div className="tw-eyebrow">Live route</div>
      <h3 className="tw-display" style={{ fontSize: 18, margin: "3px 0 0" }}>Change things while he's driving</h3>
      <p className="tw-note">
        Delivered stops lock. Anything still open can be moved, cancelled or rebooked —
        this is what you use when Drop 3 falls over while he's at Drop 1.
      </p>
      <hr className="tw-hr" />

      {drops.map((d, i) => {
        const locked = d.status !== "wait";
        return (
          <div key={d.id} style={{
            border: "1px solid var(--line)", borderLeft: `4px solid ${d.status === "done" ? "var(--go)" : d.status === "wait" ? "var(--hiviz)" : "var(--stop)"}`,
            borderRadius: 2, padding: 10, marginBottom: 8, background: "#fff", opacity: locked && d.status !== "done" ? 0.85 : 1,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div className="tw-seq" style={{ background: d.status === "done" ? "var(--go)" : d.status === "wait" ? "var(--ink)" : "var(--stop)" }}>
                {d.status === "done" ? "✓" : d.status === "wait" ? i + 1 : "!"}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <b style={{ fontSize: 13.5 }}>{d.name || `Drop ${i + 1}`}</b>
                <p className="tw-note" style={{ margin: "2px 0 0" }}>
                  {[d.address, d.city, d.state].filter(Boolean).join(", ")}
                </p>
              </div>
              {!locked && (
                <>
                  <button onClick={() => move(i, -1)} aria-label="Up"
                    style={{ background: "none", border: "1px solid var(--line)", borderRadius: 2, padding: "4px 6px", cursor: "pointer" }}><ArrowUp size={12} /></button>
                  <button onClick={() => move(i, 1)} aria-label="Down"
                    style={{ background: "none", border: "1px solid var(--line)", borderRadius: 2, padding: "4px 6px", cursor: "pointer" }}><ArrowDown size={12} /></button>
                </>
              )}
              {locked && <Lock size={13} color="var(--mute)" />}
            </div>

            {d.status !== "wait" && (
              <p className="tw-note" style={{ marginTop: 6 }}>
                <span className="tw-tag" data-t={d.status === "done" ? "done" : "exc"}>{d.status}</span>{" "}
                {d.reason || ""} {d.doneAt ? `· ${hhmm(d.doneAt)}` : ""}
              </p>
            )}

            {d.status === "wait" && i === drops.findIndex((x) => x.status === "wait") && (
              <NavBlock drop={d} nav={nav} setNav={setNav} label={`Navigate to ${d.name || "next drop"}`} />
            )}
            {d.status === "wait" && (
              <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                <button className="tw-btn tw-btn-sm" data-v="go" onClick={() => setStatus(d.id, "done", "")}>
                  <Check size={12} /> Delivered
                </button>
                <button className="tw-btn tw-btn-sm" data-v="danger"
                  onClick={() => setStatus(d.id, "cancelled", "Client cancelled while en route")}>
                  Cancel this drop
                </button>
                <button className="tw-btn tw-btn-sm" data-v="ghost"
                  onClick={() => setStatus(d.id, "rescheduled", "Rebooked for another day")}>
                  Rebook
                </button>
              </div>
            )}
          </div>
        );
      })}

      <div className="tw-fld">
        <label>Message sent with any change</label>
        <input value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="Client wants Drop 3 first — go there next" />
      </div>
      {run.routeChange && (
        <p className="tw-note" style={{ color: run.routeChange.ack ? "var(--go)" : "var(--sea)", fontWeight: 700 }}>
          {run.routeChange.ack
            ? `Driver acknowledged at ${hhmm(run.routeChange.ack)}`
            : `Sent ${hhmm(run.routeChange.at)} — waiting for the driver to acknowledge`}
        </p>
      )}
      {run.routeChange && !run.routeChange.ack && (
        <button className="tw-btn tw-btn-sm" data-v="ghost"
          onClick={() => onPatch({ routeChange: { ...run.routeChange, ack: now() } })}>
          Simulate driver acknowledging
        </button>
      )}
    </div>
  );
}



/* ================================================================== */
/* Signature + quick photo                                            */
/* ================================================================== */

function SignaturePad({ value, onChange, label }) {
  const cv = useRef(null);
  const drawing = useRef(false);
  const dirty = useRef(false);

  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    c.width = w * dpr; c.height = 150 * dpr;
    const x = c.getContext("2d");
    x.scale(dpr, dpr);
    x.lineWidth = 2.3; x.lineCap = "round"; x.strokeStyle = "#16202B";
    x.fillStyle = "#fff"; x.fillRect(0, 0, w, 150);
  }, [value]);

  const pos = (e) => {
    const r = cv.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e) => { e.preventDefault(); drawing.current = true; const p = pos(e); const x = cv.current.getContext("2d"); x.beginPath(); x.moveTo(p.x, p.y); };
  const move = (e) => { if (!drawing.current) return; e.preventDefault(); const p = pos(e); const x = cv.current.getContext("2d"); x.lineTo(p.x, p.y); x.stroke(); dirty.current = true; };
  const up = () => { if (!drawing.current) return; drawing.current = false; if (dirty.current) onChange(cv.current.toDataURL("image/png")); };

  if (value) {
    return (
      <div style={{ marginBottom: 11 }}>
        <div className="tw-eyebrow" style={{ marginBottom: 6 }}>{label}</div>
        <img src={value} alt={label} style={{ width: "100%", border: "1px solid var(--line)", background: "#fff" }} />
        <button className="tw-btn tw-btn-sm" data-v="ghost" style={{ marginTop: 6 }} onClick={() => onChange(null)}>
          <RotateCcw size={13} /> Sign again
        </button>
      </div>
    );
  }
  return (
    <div style={{ marginBottom: 11 }}>
      <div className="tw-eyebrow" style={{ marginBottom: 6 }}>{label}</div>
      <canvas ref={cv} style={{ width: "100%", height: 150, border: "1px dashed var(--ink)", background: "#fff", touchAction: "none", display: "block" }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} />
    </div>
  );
}

function PhotoStrip({ label, photos, onAdd, onRemove, hint }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const pick = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setBusy(true);
    for (const f of files) {
      try { onAdd({ id: uid(), data: await shrink(f, 900, 0.62), at: now() }); } catch { /* skip */ }
    }
    setBusy(false); e.target.value = "";
  };
  return (
    <div style={{ marginBottom: 11 }}>
      <div className="tw-eyebrow" style={{ marginBottom: 6 }}>{label}</div>
      {photos.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 7 }}>
          {photos.map((p) => (
            <div key={p.id} style={{ position: "relative" }}>
              <img src={p.data} alt="" style={{ width: 84, height: 62, objectFit: "cover", border: "1px solid var(--line)", borderRadius: 2 }} />
              <button onClick={() => onRemove(p.id)} aria-label="Remove"
                style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: "50%",
                  border: "1px solid var(--line)", background: "#fff", cursor: "pointer", color: "var(--stop)", fontSize: 11, lineHeight: 1 }}>×</button>
            </div>
          ))}
        </div>
      )}
      <button className="tw-btn tw-btn-sm" data-v="ghost" onClick={() => ref.current?.click()} disabled={busy}>
        <Camera size={13} /> {busy ? "Working…" : photos.length ? "Add another" : "Take photos"}
      </button>
      {hint && <p className="tw-note">{hint}</p>}
      <input ref={ref} type="file" accept="image/*" capture="environment" multiple onChange={pick} style={{ display: "none" }} />
    </div>
  );
}

/* ================================================================== */
/* Assignment                                                         */
/* ================================================================== */

function Assign({ run, onPatch }) {
  const d = DRIVERS.find((x) => x.id === run.driverId);
  const v = VEHICLES.find((x) => x.id === run.vehicleId);

  return (
    <div className="tw-card" style={{ borderLeft: "4px solid var(--sea)" }}>
      <div className="tw-eyebrow">Assignment</div>
      <h3 className="tw-display" style={{ fontSize: 18, margin: "3px 0 0" }}>
        {d ? `${d.name}${v ? ` · Unit ${v.unitNo}` : ""}` : "Nobody assigned yet"}
      </h3>
      <hr className="tw-hr" />
      <div className="tw-fld">
        <label>Driver</label>
        <select value={run.driverId || ""} onChange={(e) => onPatch({ driverId: e.target.value })}>
          <option value="">— pick a driver —</option>
          {DRIVERS.filter((x) => x.active).map((x) => (
            <option key={x.id} value={x.id}>{x.name} · {x.payPct}% of gross</option>
          ))}
        </select>
      </div>
      <div className="tw-fld">
        <label>Vehicle</label>
        <select value={run.vehicleId || ""} onChange={(e) => onPatch({ vehicleId: e.target.value })}>
          <option value="">— pick a unit —</option>
          {VEHICLES.filter((x) => x.active).map((x) => (
            <option key={x.id} value={x.id}>Unit {x.unitNo} · {x.type}</option>
          ))}
        </select>
      </div>

      {run.status === "draft" && (
        <>
          <button className="tw-btn" data-v="go" disabled={!run.driverId}
            onClick={() => onPatch({
              status: "assigned", assignedAt: now(),
              notify: { at: now(), text: `New Term Loading run ${run.ref} — ${(run.drops || []).length} drop(s)`, seen: false },
              audit: [...(run.audit || []), { id: uid(), at: now(), what: `Assigned to ${DRIVERS.find((x) => x.id === run.driverId)?.name}` }],
            })}>
            Send to the driver
          </button>
          {!run.driverId && <p className="tw-note">Pick a driver first.</p>}
        </>
      )}
      {run.status !== "draft" && (
        <p className="tw-note">
          Sent {hhmm(run.assignedAt)}{run.acceptedAt ? ` · accepted ${hhmm(run.acceptedAt)}` : " · not accepted yet"}
        </p>
      )}
    </div>
  );
}

/* ================================================================== */
/* Booking fields — editable by admin, dispatcher and driver          */
/* ================================================================== */

function EditBooking({ run, onPatch }) {
  const [open, setOpen] = useState(false);
  const b = run.bol || {};
  const setB = (k) => (v) => onPatch({ bol: { ...b, [k]: v } });
  const setDrop = (id, k) => (v) =>
    onPatch({ drops: (run.drops || []).map((d) => (d.id === id ? { ...d, [k]: v } : d)) });

  if (!open) {
    return (
      <button className="tw-btn tw-btn-sm" data-v="ghost" style={{ marginBottom: 10 }} onClick={() => setOpen(true)}>
        <FileText size={13} /> Edit the booking
      </button>
    );
  }
  return (
    <div className="tw-card" style={{ borderLeft: "4px solid var(--hiviz)" }}>
      <div className="tw-eyebrow">Anyone can correct this</div>
      <h3 className="tw-display" style={{ fontSize: 18, margin: "3px 0 0" }}>Booking details</h3>
      <p className="tw-note">Admin, dispatcher or driver — whoever spots the mistake fixes it.</p>
      <hr className="tw-hr" />
      <div className="tw-row">
        <F label="BOL number" value={b.bolNumber} onChange={setB("bolNumber")} />
        <F label="Date" type="date" value={b.date} onChange={setB("date")} />
      </div>
      <F label="Ship from" value={b.fromName} onChange={setB("fromName")} />
      <F label="Pickup address" value={b.fromAddress} onChange={setB("fromAddress")} />
      <div className="tw-row">
        <F label="Trailer" value={b.trailerNo} onChange={setB("trailerNo")} />
        <F label="Seal(s)" value={b.sealNos} onChange={setB("sealNos")} />
      </div>
      <div className="tw-fld">
        <label>Special instructions</label>
        <textarea rows={2} value={b.specialInstructions || ""} onChange={(e) => setB("specialInstructions")(e.target.value)} />
      </div>
      <hr className="tw-hr" />
      <div className="tw-eyebrow" style={{ marginBottom: 6 }}>Drops</div>
      {(run.drops || []).map((d, i) => (
        <div key={d.id} className="tw-sub">
          <b style={{ fontSize: 13 }}>Drop {i + 1}</b>
          <F label="Site name" value={d.name} onChange={setDrop(d.id, "name")} />
          <F label="Address" value={d.address} onChange={setDrop(d.id, "address")} />
          <div className="tw-row">
            <F label="City" value={d.city} onChange={setDrop(d.id, "city")} />
            <F label="State" value={d.state} onChange={setDrop(d.id, "state")} />
            <F label="ZIP" value={d.zip} onChange={setDrop(d.id, "zip")} mode="numeric" />
          </div>
          <F label="Reference" value={d.ref} onChange={setDrop(d.id, "ref")} />
        </div>
      ))}
      <button className="tw-btn tw-btn-sm" data-v="go" onClick={() => setOpen(false)}>
        <Check size={13} /> Done
      </button>
    </div>
  );
}

/* ================================================================== */
/* Delivery at a drop                                                 */
/* ================================================================== */

function DeliverPanel({ run, drop, onDone, onCancel }) {
  const [outcome, setOutcome] = useState("done");
  const [receiver, setReceiver] = useState("");
  const [sig, setSig] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const items = (run.items || []).filter((i) => i.dropId === drop.id);
  const deliver = outcome === "done";

  const blocks = [];
  if (deliver) {
    if (!photos.length) blocks.push("At least one photo of the goods where you left them.");
    if (!receiver.trim()) blocks.push("Receiver's name is missing.");
    if (!sig) blocks.push("Nobody has signed.");
  } else if (!reason.trim()) {
    blocks.push("Say why it couldn't be delivered.");
  }

  return (
    <div className="tw-card" style={{ borderLeft: `4px solid ${deliver ? "var(--hiviz)" : "var(--stop)"}` }}>
      <div className="tw-eyebrow">Closing out this drop</div>
      <h3 className="tw-display" style={{ fontSize: 19, margin: "3px 0 0" }}>{drop.name || "Drop"}</h3>
      <p className="tw-note">{fullAddress(drop)}</p>
      <hr className="tw-hr" />

      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {[["done", "Delivered"], ["refused", "Refused"], ["attempted", "Couldn't deliver"]].map(([k, l]) => (
          <button key={k} onClick={() => setOutcome(k)} aria-pressed={outcome === k}
            style={{
              flex: 1, padding: "10px 6px", borderRadius: 3, cursor: "pointer", fontSize: 12, fontWeight: 800,
              border: outcome === k ? "2px solid var(--ink)" : "1px solid var(--line)",
              background: outcome === k ? (k === "done" ? "var(--go)" : "var(--stop)") : "#fff",
              color: outcome === k ? "#fff" : "var(--ink)",
            }}>{l}</button>
        ))}
      </div>

      {items.length > 0 && (
        <>
          <div className="tw-eyebrow" style={{ marginBottom: 6 }}>Freight for this drop</div>
          {items.map((i) => (
            <div key={i.id} className="tw-data" style={{ fontSize: 12.5, padding: "4px 0", borderBottom: "1px dashed var(--line)" }}>
              {i.description || "Item"} {i.serialNo ? `· ${i.serialNo}` : ""} {i.qty ? `· ${i.qty} pc` : ""}
            </div>
          ))}
          <div style={{ height: 10 }} />
        </>
      )}

      <PhotoStrip label={deliver ? "Proof of delivery photos" : "Photo of the problem"}
        photos={photos} onAdd={(p) => setPhotos([...photos, p])}
        onRemove={(id) => setPhotos(photos.filter((x) => x.id !== id))}
        hint={deliver ? "Show the goods where you left them." : "A closed gate, damage, an empty dock."} />

      {deliver ? (
        <>
          <F label="Received by (print name)" value={receiver} onChange={setReceiver} />
          <SignaturePad value={sig} onChange={setSig} label="Receiver's signature" />
          <div className="tw-fld">
            <label>Damage or exceptions (optional)</label>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </>
      ) : (
        <>
          <F label="Reason" value={reason} onChange={setReason} placeholder="Consignee refused — damage on arrival" />
          <div className="tw-fld">
            <label>What happened, in your words</label>
            <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <p className="tw-note">Freight stays on the truck. Dispatch decides where it goes.</p>
        </>
      )}

      {blocks.length > 0 && (
        <div className="tw-block">
          <div className="tw-block-top" />
          <div className="tw-block-body">
            <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700 }}>
              <AlertTriangle size={14} /> Not finished yet
            </p>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 13 }}>
              {blocks.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
          </div>
        </div>
      )}

      <button className="tw-btn" data-v={deliver ? "go" : "danger"} disabled={blocks.length > 0}
        onClick={() => onDone({
          status: outcome, podPhotos: photos, receiver: receiver.trim(),
          sig, reason: reason.trim(), notes: notes.trim(), doneAt: now(),
        })}>
        {deliver ? <><Check size={16} /> Confirm delivery</> : <><AlertTriangle size={16} /> Record exception</>}
      </button>
      <button className="tw-btn tw-btn-sm" data-v="ghost" style={{ width: "100%" }} onClick={onCancel}>Go back</button>
    </div>
  );
}



/* ================================================================== */
/* Quick dispatch — the text has arrived, send a truck                 */
/* ================================================================== */

function QuickDispatch({ runs, onCreate }) {
  const [open, setOpen] = useState(false);
  const sh = SHIPPERS[0];
  const [f, setF] = useState({
    shipperId: sh.id,
    pickupName: sh.name, pickupAddress: sh.address,
    pickupCity: sh.city, pickupState: sh.state, pickupZip: sh.zip,
    when: new Date().toISOString().slice(0, 10), time: "",
    driverId: "", vehicleId: "", note: "",
  });
  const set = (k) => (v) => setF({ ...f, [k]: v });
  const d = DRIVERS.find((x) => x.id === f.driverId);
  const v = VEHICLES.find((x) => x.id === f.vehicleId);
  const clash = v && runs.find((r) => r.vehicleId === v.id && !["closed", "completed"].includes(r.status));

  if (!open) {
    return (
      <button className="tw-btn" data-v="go" onClick={() => setOpen(true)}>
        <MessageSquare size={17} /> Text received — send a driver
      </button>
    );
  }

  return (
    <div className="tw-card" style={{ borderLeft: "4px solid var(--go)" }}>
      <div className="tw-eyebrow">Straight off the phone</div>
      <h3 className="tw-display" style={{ fontSize: 19, margin: "3px 0 0" }}>Dispatch a driver now</h3>
      <p className="tw-note">
        The customer has texted a pickup address and nothing else. Send someone now —
        the paperwork gets photographed at the dock and the drops built from it there.
      </p>
      <hr className="tw-hr" />

      <div className="tw-fld">
        <label>Shipper</label>
        <select value={f.shipperId} onChange={(e) => {
          const nsh = SHIPPERS.find((x) => x.id === e.target.value);
          setF({ ...f, shipperId: e.target.value,
            pickupName: nsh?.name || "", pickupAddress: nsh?.address || "",
            pickupCity: nsh?.city || "", pickupState: nsh?.state || "", pickupZip: nsh?.zip || "" });
        }}>
          {SHIPPERS.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          <option value="">Someone else</option>
        </select>
      </div>

      <F label="Collect from" value={f.pickupName} onChange={set("pickupName")} />
      <F label="Pickup address (what they texted)" value={f.pickupAddress} onChange={set("pickupAddress")} />
      <div className="tw-row">
        <F label="City" value={f.pickupCity} onChange={set("pickupCity")} />
        <F label="State" value={f.pickupState} onChange={set("pickupState")} />
        <F label="ZIP" value={f.pickupZip} onChange={set("pickupZip")} mode="numeric" />
      </div>
      <div className="tw-row">
        <F label="Date" type="date" value={f.when} onChange={set("when")} />
        <F label="Be there by" value={f.time} onChange={set("time")} placeholder="10:00" />
      </div>

      <hr className="tw-hr" />
      <div className="tw-eyebrow" style={{ marginBottom: 6 }}>Who's going</div>
      <div className="tw-fld">
        <label>Driver</label>
        <select value={f.driverId} onChange={(e) => set("driverId")(e.target.value)}>
          <option value="">— pick a driver —</option>
          {DRIVERS.filter((x) => x.active).map((x) => (
            <option key={x.id} value={x.id}>{x.name} · {x.payPct}% of gross</option>
          ))}
        </select>
      </div>
      <div className="tw-fld">
        <label>Vehicle</label>
        <select value={f.vehicleId} onChange={(e) => set("vehicleId")(e.target.value)}>
          <option value="">— pick a unit —</option>
          {VEHICLES.filter((x) => x.active).map((x) => (
            <option key={x.id} value={x.id}>Unit {x.unitNo} · {x.type}</option>
          ))}
        </select>
      </div>
      {clash && (
        <p className="tw-note" style={{ color: "var(--stop)", fontWeight: 700 }}>
          Unit {v.unitNo} is already out on {clash.ref}.
        </p>
      )}
      <div className="tw-fld">
        <label>Anything else from the text</label>
        <textarea rows={2} value={f.note} onChange={(e) => set("note")(e.target.value)}
          placeholder="Gate code, ask for Sam at dock 3, 2 skids expected" />
      </div>

      <button className="tw-btn" data-v="go" disabled={!f.driverId}
        onClick={() => { onCreate(f); setOpen(false); }}>
        <Truck size={16} /> Send {d ? d.name.split(" ")[0] : "the driver"}
      </button>
      {!f.driverId && <p className="tw-note">Pick a driver — that's the only thing needed.</p>}
      <button className="tw-btn tw-btn-sm" data-v="ghost" style={{ width: "100%" }} onClick={() => setOpen(false)}>Cancel</button>
    </div>
  );
}

/* ================================================================== */
/* Run detail — same record, different job depending on who's looking  */
/* ================================================================== */

function RunDetail({ run, role, nav, setNav, onPatch, onBack }) {
  const [delivering, setDelivering] = useState(null);
  const isDriver = role === "driver";
  const c = runCharges(run);
  const drops = run.drops || [];
  const nextDrop = drops.find((d) => d.status === "wait");
  const d = DRIVERS.find((x) => x.id === run.driverId);
  const v = VEHICLES.find((x) => x.id === run.vehicleId);
  const log = (what) => [...(run.audit || []), { id: uid(), at: now(), what }];

  const finishDrop = (drop, payload) => {
    const nd = drops.map((x) => (x.id === drop.id ? { ...x, ...payload } : x));
    const allDone = nd.every((x) => x.status !== "wait");
    onPatch({
      drops: nd,
      ...(allDone ? { status: "completed", completedAt: now() } : {}),
      audit: log(`${drop.name || "Drop"} — ${payload.status}${payload.reason ? `: ${payload.reason}` : ""}`),
    });
    setDelivering(null);
  };

  if (delivering) {
    const drop = drops.find((x) => x.id === delivering);
    return <DeliverPanel run={run} drop={drop} onCancel={() => setDelivering(null)}
      onDone={(p) => finishDrop(drop, p)} />;
  }

  return (
    <>
      <button className="tw-btn tw-btn-sm" data-v="ghost" style={{ marginBottom: 12 }} onClick={onBack}>
        <X size={13} /> All runs
      </button>

      <div className="tw-card">
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <div className="tw-eyebrow">{run.bol?.fromName || "Term Loading"}</div>
            <h3 className="tw-display" style={{ fontSize: 21, margin: "3px 0 0" }}>{run.ref}</h3>
          </div>
          <span className="tw-tag" data-t={RUN_TONE[run.status] || "wait"}>{RUN_LABEL[run.status] || run.status}</span>
        </div>
        <hr className="tw-hr" />
        <div className="tw-data" style={{ fontSize: 13, lineHeight: 1.7 }}>
          <div>Driver: {d?.name || "unassigned"}{v ? ` · Unit ${v.unitNo}${v.trailerNo ? ` / ${v.trailerNo}` : ""}` : ""}</div>
          <div>{drops.length} drop(s) · {(run.items || []).length} item(s)</div>
          <div>BOL {run.bol?.bolNumber || "—"} · {(run.photos || []).length} document(s)</div>
        </div>
      </div>

      {/* --- money --- */}
      {isDriver ? (
        <div className="tw-card" style={{ borderLeft: "4px solid var(--go)", background: "#EDF3EE" }}>
          <div className="tw-eyebrow" style={{ color: "var(--go)" }}>Your earnings on this run</div>
          <div className="tw-data" style={{ fontSize: 26, fontWeight: 700 }}>{usd(c.driverPay)}</div>
          <p className="tw-note" style={{ margin: 0 }}>
            {DRIVER_PCT}% of {usd(c.total)} gross{run.status === "closed" ? "" : " — final once the run is closed"}
          </p>
        </div>
      ) : (
        <div className="tw-card" style={{ borderLeft: "4px solid var(--sea)" }}>
          <div className="tw-eyebrow">Money</div>
          <h3 className="tw-display" style={{ fontSize: 19, margin: "3px 0 0" }}>{usd(c.total)} gross</h3>
          <hr className="tw-hr" />
          <div className="tw-data" style={{ fontSize: 13, lineHeight: 1.7 }}>
            <div>Flat {usd(c.flat)} · {c.extras} extra stop(s) {usd(c.extraStops)} · fuel {usd(c.fuel)}</div>
            <div>Driver {d?.name || "—"} takes {usd(c.driverPay)} ({DRIVER_PCT}%)</div>
            <div><b>You keep {usd(c.total - c.driverPay)}</b></div>
          </div>
          <div className="tw-row" style={{ marginTop: 10 }}>
            <F label="Flat rate ($)" value={run.flatRate} onChange={(x) => onPatch({ flatRate: num(x) })} mode="decimal" />
            <F label="Other ($)" value={run.extraCharges} onChange={(x) => onPatch({ extraCharges: num(x) })} mode="decimal" />
          </div>
        </div>
      )}

      {!isDriver && <Assign run={run} onPatch={onPatch} />}
      <EditBooking run={run} onPatch={onPatch} />

      {/* --- driver's actions --- */}
      {isDriver && run.status === "assigned" && (
        <button className="tw-btn" data-v="go"
          onClick={() => onPatch({ status: "accepted", acceptedAt: now(), notify: { ...(run.notify || {}), seen: true }, audit: log("Driver accepted the run") })}>
          <Check size={16} /> Accept this run
        </button>
      )}

      {isDriver && run.status === "accepted" && (
        <div className="tw-card">
          <div className="tw-eyebrow">Heading to the dock</div>
          <h3 className="tw-display" style={{ fontSize: 18, margin: "3px 0 0" }}>{run.bol?.fromName}</h3>
          <p className="tw-note">{run.bol?.fromAddress}</p>
          <NavBlock drop={{ address: run.bol?.fromAddress, city: run.bol?.fromCity, state: run.bol?.fromState, zip: run.bol?.fromZip }}
            nav={nav} setNav={setNav} label="Navigate to pickup" />
          <button className="tw-btn" data-v="hiviz" style={{ marginTop: 8 }}
            onClick={() => onPatch({ status: "at_pickup", arrivedAt: now(), audit: log("Arrived at the dock") })}>
            <MapPin size={16} /> I've arrived
          </button>
        </div>
      )}

      {isDriver && run.status === "at_pickup" && (
        <div className="tw-card">
          <div className="tw-eyebrow">At the dock</div>
          <h3 className="tw-display" style={{ fontSize: 18, margin: "3px 0 0" }}>Paperwork and freight</h3>
          <p className="tw-note">
            Scan or attach anything they hand you now, photograph what you're loading,
            and get the shipper to sign.
          </p>
          <hr className="tw-hr" />
          <PhotoStrip label="Extra documents handed over here"
            photos={run.extraDocs || []}
            onAdd={(p) => onPatch({ extraDocs: [...(run.extraDocs || []), p] })}
            onRemove={(id) => onPatch({ extraDocs: (run.extraDocs || []).filter((x) => x.id !== id) })}
            hint="Anything not already on file. Correct the booking above if it doesn't match." />
          <PhotoStrip label="Photos of the items loaded"
            photos={run.loadPhotos || []}
            onAdd={(p) => onPatch({ loadPhotos: [...(run.loadPhotos || []), p] })}
            onRemove={(id) => onPatch({ loadPhotos: (run.loadPhotos || []).filter((x) => x.id !== id) })}
            hint="Condition at pickup. This is what settles a damage claim later." />
          <SignaturePad label="Shipper's signature" value={run.shipperSig}
            onChange={(v2) => onPatch({ shipperSig: v2 })} />
          <hr className="tw-hr" />
          <div className="tw-eyebrow" style={{ marginBottom: 6 }}>Where is it going?</div>
          <p className="tw-note" style={{ marginTop: 0 }}>
            Read the destinations off the paperwork and add a drop for each one.
          </p>
          <Drops drops={run.drops || []} setDrops={(nd) => onPatch({ drops: typeof nd === "function" ? nd(run.drops || []) : nd })}
            shipper={SHIPPERS.find((x) => x.id === run.shipperId)}
            pickupLabel={run.bol?.fromName} codes={[]} nav={nav} setNav={setNav} />
          <F label="Signed by" value={run.shipperSignedBy} onChange={(x) => onPatch({ shipperSignedBy: x })} />
          <button className="tw-btn" data-v="go" disabled={(run.drops || []).length === 0}
            onClick={() => onPatch({ status: "in_transit", loadedAt: now(), audit: log("Loaded and left the dock") })}>
            <Truck size={16} /> Loaded — start delivering
          </button>
          {(run.drops || []).length === 0 && (
            <p className="tw-note" style={{ color: "var(--stop)", fontWeight: 700 }}>
              Add at least one drop before you leave — otherwise nobody knows where this freight is going.
            </p>
          )}
          <p className="tw-note">Nothing above is compulsory, but a missing signature is hard to explain later.</p>
        </div>
      )}

      {/* --- the route --- */}
      <div className="tw-card">
        <div className="tw-eyebrow">Route</div>
        <h3 className="tw-display" style={{ fontSize: 18, margin: "3px 0 0" }}>
          {drops.filter((x) => x.status === "done").length} of {drops.length} delivered
        </h3>
        <hr className="tw-hr" />
        {drops.map((x, i) => {
          const state = x.status === "done" ? "done"
            : x.status === "wait" ? (nextDrop?.id === x.id ? "now" : "wait") : "exc";
          return (
            <div key={x.id} style={{
              border: "1px solid var(--line)", borderRadius: 2, padding: 11, marginBottom: 8, background: "#fff",
              borderLeft: `4px solid ${state === "done" ? "var(--go)" : state === "now" ? "var(--hiviz)" : state === "exc" ? "var(--stop)" : "var(--line)"}`,
            }}>
              <div style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
                <div className="tw-seq" style={{ background: state === "done" ? "var(--go)" : state === "exc" ? "var(--stop)" : "var(--ink)" }}>
                  {state === "done" ? "✓" : state === "exc" ? "!" : i + 1}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ fontSize: 14 }}>{x.name || `Drop ${i + 1}`}</b>
                  <p className="tw-note" style={{ margin: "2px 0 5px" }}>{fullAddress(x) || "No address"}</p>
                  <span className="tw-tag" data-t={state === "wait" ? "wait" : state}>
                    {x.status === "done" ? `Signed by ${x.receiver || "—"} · ${hhmm(x.doneAt)}`
                      : x.status === "wait" ? (state === "now" ? "Next" : "Waiting")
                        : `${x.status} · ${x.reason || ""}`}
                  </span>
                  {(x.podPhotos || []).length > 0 && (
                    <div style={{ display: "flex", gap: 5, marginTop: 7 }}>
                      {x.podPhotos.slice(0, 3).map((p) => (
                        <img key={p.id} src={p.data} alt="" style={{ width: 56, height: 42, objectFit: "cover", border: "1px solid var(--line)" }} />
                      ))}
                      {x.sig && <img src={x.sig} alt="signature" style={{ height: 42, border: "1px solid var(--line)", background: "#fff" }} />}
                    </div>
                  )}

                  {isDriver && run.status === "in_transit" && state === "now" && (
                    <>
                      <NavBlock drop={x} nav={nav} setNav={setNav} label={`Navigate to ${x.name || "drop"}`} />
                      <button className="tw-btn" data-v="hiviz" style={{ marginTop: 8 }}
                        onClick={() => { onPatch({ drops: drops.map((y) => (y.id === x.id ? { ...y, arrivedAt: now() } : y)) }); setDelivering(x.id); }}>
                        <MapPin size={15} /> Arrived — deliver
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {isDriver && run.status === "completed" && (
        <div className="tw-card" style={{ borderLeft: "4px solid var(--go)" }}>
          <div className="tw-eyebrow">Every drop accounted for</div>
          <h3 className="tw-display" style={{ fontSize: 19, margin: "3px 0 0" }}>Close out {run.ref}</h3>
          <p className="tw-note">After this the paperwork locks and dispatch bills it.</p>
          <button className="tw-btn" data-v="go" style={{ marginTop: 10 }}
            onClick={() => onPatch({ status: "closed", closedAt: now(), audit: log("Driver closed out the run") })}>
            <Lock size={16} /> Close out
          </button>
        </div>
      )}

      {!isDriver && run.status !== "closed" && (
        <LiveRoute run={run} onPatch={onPatch} nav={nav} setNav={setNav} />
      )}

      {(run.audit || []).length > 0 && (
        <div className="tw-card">
          <div className="tw-eyebrow">Record of changes</div>
          <hr className="tw-hr" />
          {[...run.audit].reverse().map((e) => (
            <div key={e.id} style={{ display: "flex", gap: 8, padding: "4px 0", borderBottom: "1px dashed var(--line)" }}>
              <span className="tw-data" style={{ fontSize: 11, color: "var(--mute)", flex: "0 0 44px" }}>{hhmm(e.at)}</span>
              <span style={{ fontSize: 12.5, flex: 1 }}>{e.what}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function RunList({ runs, role, driverId, onOpen, onQuick }) {
  const mine = role === "driver" ? runs.filter((r) => r.driverId === driverId) : runs;
  const pending = mine.filter((r) => r.status === "assigned");

  return (
    <>
      {role !== "driver" && <QuickDispatch runs={runs} onCreate={onQuick} />}
      {role === "driver" && pending.length > 0 && (
        <div className="tw-card" style={{ borderLeft: "4px solid var(--hiviz)", background: "#FFF8E1" }}>
          <div className="tw-eyebrow" style={{ color: "#6B5200" }}>New work</div>
          <h3 className="tw-display" style={{ fontSize: 18, margin: "3px 0 0" }}>
            {pending.length} run{pending.length === 1 ? "" : "s"} waiting for you to accept
          </h3>
          {pending.map((r) => (
            <p key={r.id} className="tw-note" style={{ margin: "5px 0 0" }}>
              {r.notify?.text || r.ref} · sent {hhmm(r.assignedAt)}
            </p>
          ))}
        </div>
      )}

      {mine.length === 0 && <div className="tw-empty"><ClipboardList size={26} /><p>Nothing here yet.</p></div>}

      {mine.map((r) => {
        const c = runCharges(r);
        const d = DRIVERS.find((x) => x.id === r.driverId);
        const done = (r.drops || []).filter((x) => x.status === "done").length;
        return (
          <button key={r.id} className="tw-card" onClick={() => onOpen(r.id)}
            style={{ display: "flex", gap: 10, width: "100%", textAlign: "left", cursor: "pointer", alignItems: "flex-start" }}>
            <div className="tw-seq" style={{ background: r.status === "closed" ? "var(--go)" : "var(--ink)" }}>
              {r.status === "closed" ? "✓" : done}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", gap: 7, alignItems: "baseline" }}>
                <b className="tw-data" style={{ fontSize: 13.5 }}>{r.ref}</b>
                <span className="tw-note" style={{ margin: 0, flex: 1 }}>{dmy(r.createdAt)}</span>
                <span className="tw-tag" data-t={RUN_TONE[r.status] || "wait"}>{RUN_LABEL[r.status] || r.status}</span>
              </div>
              <p className="tw-note" style={{ margin: "3px 0 0" }}>
                {done} of {(r.drops || []).length} delivered
                {role === "driver" ? ` · you earn ${usd(c.driverPay)}` : ` · ${d?.name || "unassigned"} · ${usd(c.total)}`}
              </p>
            </div>
            <ChevronRight size={16} color="var(--mute)" style={{ flex: "0 0 16px", marginTop: 5 }} />
          </button>
        );
      })}
    </>
  );
}

/* ================================================================== */
/* Bill of lading — master or per-drop                                */
/* ================================================================== */

function BolDoc({ run, drop, shipper }) {
  const b = run.bol || {};
  const drops = (run.drops || []).filter((d) => d.status !== "cancelled");
  const items = drop ? (run.items || []).filter((i) => i.dropId === drop.id) : (run.items || []);
  const orders = run.orders || [];
  const wt = items.reduce((a, x) => a + num(x.weight), 0)
    || orders.reduce((a, x) => a + num(x.weight), 0);
  const pkgs = orders.reduce((a, x) => a + num(x.pkgs), 0);
  const addr = (o) => [o.address, [o.city, o.state, o.zip].filter(Boolean).join(", ")].filter(Boolean).join(" · ");

  return (
    <div className="tw-bol tw-print">
      <div className="tw-bolhd">
        <div>
          <h2>BILL OF LADING</h2>
          <div>{drop ? "SUB-BOL — ONE DELIVERY" : `MASTER — ${drops.length} DELIVER${drops.length === 1 ? "Y" : "IES"}`}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div>BOL #: {b.bolNumber || run.ref}{drop ? `-${drops.findIndex((d) => d.id === drop.id) + 1}` : "-M"}</div>
          <div>Date: {b.date || dayKey(run.createdAt)}</div>
          <div>Run: {run.ref}</div>
        </div>
      </div>

      <table><tbody>
        <tr><th style={{ width: "50%" }}>SHIP FROM</th><th>SHIP TO</th></tr>
        <tr>
          <td>
            {b.fromName || shipper?.name || "—"}<br />
            {b.fromAddress || ""}<br />
            {[b.fromCity, b.fromState, b.fromZip].filter(Boolean).join(", ")}
            {b.sid ? <div>SID #: {b.sid}</div> : null}
          </td>
          <td>
            {drop
              ? <>{drop.name || "—"}<br />{addr(drop)}{drop.code ? <div>Site code: {drop.code}</div> : null}</>
              : drops.map((d, i) => <div key={d.id}>{i + 1}. {d.name} — {addr(d)}</div>)}
          </td>
        </tr>
      </tbody></table>

      <table><tbody>
        <tr><th>CARRIER</th><th>TRAILER</th><th>SEAL(S)</th><th>SCAC</th><th>PRO</th></tr>
        <tr>
          <td>{b.carrierName || "NQ Visiorence LLC"}</td>
          <td>{b.trailerNo || "—"}</td><td>{b.sealNos || "—"}</td>
          <td>{b.scac || "—"}</td><td>{b.proNo || "—"}</td>
        </tr>
      </tbody></table>

      <table>
        <thead><tr><th>CUSTOMER ORDER NUMBER</th><th># PKGS</th><th>WEIGHT</th><th>PALLET/SLIP</th><th>ADDITIONAL SHIPPER INFO</th></tr></thead>
        <tbody>
          {orders.length === 0 && <tr><td colSpan={5}>—</td></tr>}
          {orders.map((o) => (
            <tr key={o.id}>
              <td>{o.orderNo || "—"}</td><td>{o.pkgs || "—"}</td>
              <td>{o.weight ? `${o.weight} lb` : "—"}</td>
              <td>{o.pallet || "—"}</td><td>{o.shipperInfo || "—"}</td>
            </tr>
          ))}
          <tr><td><b>GRAND TOTAL</b></td><td><b>{pkgs || "—"}</b></td><td><b>{wt ? `${wt.toLocaleString()} lb` : "—"}</b></td><td colSpan={2}></td></tr>
        </tbody>
      </table>

      <table>
        <thead><tr><th>#</th><th>COMMODITY DESCRIPTION</th><th>SERIAL</th><th>QTY</th><th>WEIGHT</th><th>NMFC</th><th>CLASS</th></tr></thead>
        <tbody>
          {items.length === 0 && <tr><td colSpan={7}>—</td></tr>}
          {items.map((i, n) => (
            <tr key={i.id}>
              <td>{n + 1}</td><td>{i.description || "—"}</td><td>{i.serialNo || "—"}</td>
              <td>{i.qty || "—"}</td><td>{i.weight ? `${i.weight} lb` : "—"}</td>
              <td>{i.nmfc || "—"}</td><td>{i.freightClass || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {b.specialInstructions && <div><b>SPECIAL INSTRUCTIONS:</b> {b.specialInstructions}</div>}

      <table><tbody>
        <tr><th>FREIGHT TERMS</th><th>TRAILER LOADED BY</th><th>FREIGHT COUNTED BY</th><th>COD</th></tr>
        <tr>
          <td>{(b.freightTerms || "prepaid").replace("_", " ")}</td>
          <td>{b.trailerLoadedBy || "—"}</td>
          <td>{(b.freightCountedBy || "—").replace(/_/g, " ")}</td>
          <td>{b.codAmount ? usd(b.codAmount) : "—"}</td>
        </tr>
      </tbody></table>

      <table><tbody>
        <tr><th>SHIPPER SIGNATURE / DATE</th><th>CARRIER SIGNATURE / PICKUP DATE</th><th>RECEIVED BY</th></tr>
        <tr style={{ height: 52 }}>
          <td>{b.shipperSignedBy || ""}{b.shipperSignedDate ? ` · ${b.shipperSignedDate}` : ""}</td>
          <td>{b.carrierName || "NQ Visiorence LLC"}</td>
          <td>{drop?.status === "done" ? "Delivered" : ""}</td>
        </tr>
      </tbody></table>

      <div style={{ marginTop: 6, fontSize: 9 }}>
        Received, subject to individually determined rates or contracts that have been agreed upon in writing.
        Goods received in apparent good order except as noted.
      </div>
    </div>
  );
}

function BolView({ runs, shipper, onBack }) {
  const [runId, setRunId] = useState(runs[0]?.id || "");
  const [mode, setMode] = useState("");          // "" = ask, "master", "sub"
  const [dropId, setDropId] = useState("");
  const run = runs.find((r) => r.id === runId);
  const drops = (run?.drops || []).filter((d) => d.status !== "cancelled");

  if (!runs.length) {
    return <div className="tw-empty"><FileText size={26} /><p>No runs yet. Do an intake first.</p></div>;
  }

  return (
    <>
      <div className="tw-card">
        <div className="tw-eyebrow tw-noprint">Bill of lading</div>
        <h3 className="tw-display tw-noprint" style={{ fontSize: 19, margin: "3px 0 0" }}>Generate paperwork</h3>
        <div className="tw-noprint">
          <hr className="tw-hr" />
          <div className="tw-fld">
            <label>Run</label>
            <select value={runId} onChange={(e) => { setRunId(e.target.value); setMode(""); setDropId(""); }}>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.ref} · {dmy(r.createdAt)} · {(r.drops || []).length} drop(s)
                </option>
              ))}
            </select>
          </div>

          <div className="tw-eyebrow" style={{ marginBottom: 6 }}>Which document?</div>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <button className="tw-btn tw-btn-sm" data-v={mode === "master" ? "go" : "ghost"}
              style={{ flex: 1 }} onClick={() => { setMode("master"); setDropId(""); }}>
              <Layers size={13} /> Master BOL
            </button>
            <button className="tw-btn tw-btn-sm" data-v={mode === "sub" ? "go" : "ghost"}
              style={{ flex: 1 }} onClick={() => { setMode("sub"); setDropId(drops[0]?.id || ""); }}>
              <FileText size={13} /> Sub-BOL per drop
            </button>
          </div>
          <p className="tw-note" style={{ marginTop: 0 }}>
            A master covers the whole run on one sheet. Sub-BOLs give each consignee their own,
            which is what most receiving docks want to sign.
          </p>

          {mode === "sub" && (
            <div className="tw-fld" style={{ marginTop: 10 }}>
              <label>Which drop</label>
              <select value={dropId} onChange={(e) => setDropId(e.target.value)}>
                {drops.map((d, i) => <option key={d.id} value={d.id}>{i + 1}. {d.name || "Unnamed"}</option>)}
              </select>
            </div>
          )}

          {mode && (
            <button className="tw-btn" data-v="hiviz" style={{ marginTop: 8 }} onClick={() => window.print()}>
              <Printer size={15} /> Print / Save as PDF
            </button>
          )}
        </div>
      </div>

      {mode && run && (
        <BolDoc run={run} shipper={shipper}
          drop={mode === "sub" ? drops.find((d) => d.id === dropId) : null} />
      )}
    </>
  );
}

/* ================================================================== */
/* Invoicing — pick the dates                                         */
/* ================================================================== */

function InvoiceView({ runs, shipper }) {
  const today = new Date().toISOString().slice(0, 10);
  const back = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(back(4));
  const [to, setTo] = useState(today);
  const [grouped, setGrouped] = useState("cumulative");   // or "per_day"
  const [show, setShow] = useState(false);
  const [rates, setRates] = useState(RATES);

  const inRange = runs.filter((r) => {
    const d = dayKey(r.createdAt);
    return d >= from && d <= to;
  }).map((r) => ({ ...r, flatRate: r.flatRate ?? rates.flatRate,
    extraStopRate: r.extraStopRate ?? rates.extraStopRate, fuelPct: r.fuelPct ?? rates.fuelPct }));
  const days = [...new Set(inRange.map((r) => dayKey(r.createdAt)))].sort();
  const total = inRange.reduce((a, r) => a + runCharges(r, rates).total, 0);

  return (
    <>
      <div className="tw-card tw-noprint">
        <div className="tw-eyebrow"><CalendarDays size={11} /> Invoicing</div>
        <h3 className="tw-display" style={{ fontSize: 19, margin: "3px 0 0" }}>Pick the dates</h3>
        <hr className="tw-hr" />
        <div className="tw-row">
          <F label="From" type="date" value={from} onChange={setFrom} />
          <F label="To" type="date" value={to} onChange={setTo} />
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          <button className="tw-btn tw-btn-sm" data-v="ghost" onClick={() => { setFrom(today); setTo(today); }}>Today</button>
          <button className="tw-btn tw-btn-sm" data-v="ghost" onClick={() => { setFrom(back(1)); setTo(back(1)); }}>Yesterday</button>
          <button className="tw-btn tw-btn-sm" data-v="ghost" onClick={() => { setFrom(back(4)); setTo(today); }}>Last 5 days</button>
          <button className="tw-btn tw-btn-sm" data-v="ghost" onClick={() => { setFrom(back(6)); setTo(today); }}>Last 7 days</button>
        </div>

        <div className="tw-eyebrow" style={{ marginBottom: 6 }}>Rates on this invoice</div>
        <div className="tw-row">
          <F label="Flat rate ($)" value={rates.flatRate} mode="decimal"
            onChange={(v) => setRates({ ...rates, flatRate: num(v) })} />
          <F label="Extra stop ($)" value={rates.extraStopRate} mode="decimal"
            onChange={(v) => setRates({ ...rates, extraStopRate: num(v) })} />
          <F label="Fuel (%)" value={rates.fuelPct} mode="decimal"
            onChange={(v) => setRates({ ...rates, fuelPct: num(v) })} />
        </div>
        <p className="tw-note" style={{ marginTop: 0 }}>
          Applied to any run without its own agreed rate. First {rates.freeStops} stops are in the flat rate.
        </p>

        <hr className="tw-hr" />
        <div className="tw-eyebrow" style={{ marginBottom: 6 }}>How to bill it</div>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="tw-btn tw-btn-sm" style={{ flex: 1 }}
            data-v={grouped === "cumulative" ? "go" : "ghost"} onClick={() => setGrouped("cumulative")}>
            One invoice
          </button>
          <button className="tw-btn tw-btn-sm" style={{ flex: 1 }}
            data-v={grouped === "per_day" ? "go" : "ghost"} onClick={() => setGrouped("per_day")}>
            Split by day
          </button>
        </div>
        <p className="tw-note">
          {grouped === "cumulative"
            ? `One invoice covering ${inRange.length} run(s) across ${days.length} day(s).`
            : `${days.length} separate invoice(s), one per day worked.`}
        </p>

        <hr className="tw-hr" />
        <div className="tw-data" style={{ fontSize: 15, fontWeight: 700 }}>
          {inRange.length} run(s) · {usd(total)}
        </div>
        <button className="tw-btn" data-v="hiviz" style={{ marginTop: 10 }}
          disabled={!inRange.length} onClick={() => setShow(true)}>
          <Receipt size={15} /> Build the invoice
        </button>
        {!inRange.length && <p className="tw-note">Nothing in that range.</p>}
      </div>

      {show && inRange.length > 0 && (
        <>
          <div className="tw-noprint" style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button className="tw-btn tw-btn-sm" data-v="ghost" onClick={() => setShow(false)}><X size={13} /> Close</button>
            <button className="tw-btn tw-btn-sm" onClick={() => window.print()}><Printer size={13} /> Print / Save PDF</button>
          </div>
          {(grouped === "cumulative" ? [inRange] : days.map((d) => inRange.filter((r) => dayKey(r.createdAt) === d)))
            .map((group, gi) => (
              <InvoiceDoc key={gi} runs={group} shipper={shipper} no={1044 + gi} rates={rates}
                from={grouped === "cumulative" ? from : dayKey(group[0].createdAt)}
                to={grouped === "cumulative" ? to : dayKey(group[0].createdAt)} />
            ))}
        </>
      )}
    </>
  );
}

function InvoiceDoc({ runs, shipper, no, from, to, rates = RATES }) {
  const lines = runs.map((r) => ({ run: r, c: runCharges(r, rates) }));
  const total = lines.reduce((a, l) => a + l.c.total, 0);
  const due = new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10);

  return (
    <div className="tw-bol tw-print" style={{ marginBottom: 16 }}>
      <div className="tw-bolhd">
        <div>
          <h2>INVOICE</h2>
          <div>NQ Visiorence LLC</div>
          <div>509 Crownpoint Ln, Arlington TX 76002</div>
          <div>nqvisiorencellc@gmail.com · +1 602 621 0535</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div>Invoice no.: {no}</div>
          <div>Period: {from === to ? dmy(from) : `${dmy(from)} — ${dmy(to)}`}</div>
          <div>Terms: Net 15</div>
          <div>Due: {dmy(due)}</div>
        </div>
      </div>

      <table><tbody>
        <tr><th style={{ width: "50%" }}>BILL TO</th><th>RUNS COVERED</th></tr>
        <tr>
          <td>{shipper?.name || runs[0]?.bol?.fromName || "Customer"}<br />
            {shipper?.address || ""}<br />
            {[shipper?.city, shipper?.state, shipper?.zip].filter(Boolean).join(", ")}</td>
          <td>{runs.map((r) => r.ref).join(", ")}</td>
        </tr>
      </tbody></table>

      <table>
        <thead>
          <tr><th>#</th><th>DATE</th><th>RUN</th><th>DESCRIPTION</th><th>STOPS</th><th>AMOUNT</th></tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.run.id}>
              <td>{i + 1}</td>
              <td>{dmy(l.run.createdAt)}</td>
              <td>{l.run.ref}</td>
              <td>
                Truck loading — {l.run.bol?.bolNumber ? `BOL ${l.run.bol.bolNumber}` : "term loading"}
                <div style={{ color: "#555" }}>
                  Flat {usd(l.c.flat)}
                  {l.c.extras > 0 ? ` + ${l.c.extras} extra stop(s) ${usd(l.c.extraStops)}` : ""}
                  {` + fuel ${usd(l.c.fuel)}`}
                  {l.c.other ? ` + other ${usd(l.c.other)}` : ""}
                </div>
              </td>
              <td>{l.c.stops}</td>
              <td>{usd(l.c.total)}</td>
            </tr>
          ))}
          <tr><td colSpan={4}></td><td><b>TOTAL</b></td><td><b>{usd(total)}</b></td></tr>
        </tbody>
      </table>

      <div style={{ marginTop: 6, fontSize: 9 }}>
        Fuel surcharge applied to linehaul only. Detention, weekend and after-hours charges billed separately where they apply.
        Queries on any line to be raised within 7 days.
      </div>
    </div>
  );
}

/* ================================================================== */
/* Root                                                               */
/* ================================================================== */

export default function TermLoading() {
  const [st, setSt] = useState(null);
  const [role, setRole] = useState("admin");        // admin | dispatcher | driver
  const [seatDriver, setSeatDriver] = useState("d1");
  const [openId, setOpenId] = useState(null);
  const [tab, setTab] = useState("intake");
  const [step, setStep] = useState(0);
  const [maxStep, setMaxStep] = useState(0);

  const [shipper, setShipper] = useState(null);
  const [docs, setDocs] = useState([]);
  const [bol, setBol] = useState(BLANK_BOL());
  const [orders, setOrders] = useState([]);
  const [items, setItems] = useState([]);
  const [drops, setDrops] = useState([]);
  const [autoKeys, setAutoKeys] = useState(new Set());
  const [openRun, setOpenRun] = useState(null);
  const [nav, setNavRaw] = useState(DEFAULT_NAV);
  const setNav = (n) => { setNavRaw(n); put({ nav: n }); };

  useEffect(() => { load().then((x) => { setSt(x); if (x.nav) setNavRaw(x.nav); }); }, []);
  const put = useCallback((patch) => {
    setSt((prev) => { const next = { ...prev, ...patch }; save(next); return next; });
  }, []);

  if (!st) {
    return <div className="tw"><style>{CSS}</style>
      <div className="tw-empty"><ClipboardList size={26} /><p>Opening…</p></div></div>;
  }

  const goStep = (n) => { setStep(n); setMaxStep((m) => Math.max(m, n)); };

  const pickShipper = (sh) => {
    setShipper(sh);
    if (sh) {
      setBol({
        ...BLANK_BOL(),
        fromName: sh.name, fromAddress: sh.address,
        fromCity: sh.city, fromState: sh.state, fromZip: sh.zip,
      });
    } else {
      setBol(BLANK_BOL());
    }
    goStep(1);
  };

  /* Read one page. Nothing is merged across pages — a page only contributes
     once you say which load it belongs to. */
  const readOne = async (id) => {
    setDocs((ds) => ds.map((d) => (d.id === id ? { ...d, busy: true, err: null } : d)));
    let out = null, error = null;
    try {
      out = await extractOne(docs.find((d) => d.id === id));
    } catch {
      error = "Couldn't read that page. Try again in better light, or type it in.";
    }
    setDocs((ds) => ds.map((d) => (d.id !== id ? d : {
      ...d, busy: false, err: error,
      read: !error, type: out?.docType || "other", fields: out || null,
      orders: (out?.orders || []).map((o) => ({
        id: uid(), orderNo: o.orderNo || "", pkgs: o.pkgs || "", weight: o.weight || "",
        pallet: o.pallet || "", shipperInfo: o.shipperInfo || "", docId: id,
      })),
      items: (out?.items || []).map((i) => ({
        ...BLANK_ITEM(), id: uid(), docId: id,
        description: i.description || "", serialNo: i.serialNo || "", qty: i.qty || "",
        weight: i.weight || "", nmfc: i.nmfc || "", freightClass: i.freightClass || "",
        hazmat: !!i.hazmat,
      })),
    })));

    /* the first bill of lading fills the header, and only that */
    if (out && out.docType === "bill_of_lading") {
      const keys = new Set(autoKeys);
      const b2 = { ...bol };
      const put2 = (k, v) => { if (v && String(v).trim()) { b2[k] = String(v).trim(); keys.add(k); } };
      if (out.date && /^\d{4}-\d{2}-\d{2}$/.test(out.date)) put2("date", out.date);
      put2("bolNumber", out.docNumber); put2("pageOf", out.pageOf);
      const f = out.shipFrom || {}, t = out.shipTo || {}, tp = out.thirdParty || {}, c = out.carrier || {};
      put2("fromName", f.name); put2("fromAddress", f.address); put2("fromCity", f.city);
      put2("fromState", f.state); put2("fromZip", f.zip); put2("sid", f.sid);
      put2("toName", t.name); put2("toAddress", t.address); put2("toCity", t.city);
      put2("toState", t.state); put2("toZip", t.zip); put2("locationNo", t.locationNo);
      put2("tpName", tp.name);
      put2("trailerNo", c.trailerNo); put2("sealNos", c.sealNos); put2("scac", c.scac); put2("proNo", c.proNo);
      put2("specialInstructions", out.specialInstructions);
      put2("shipperSignedBy", out.shipperSignedBy);
      if (out.freightTerms) b2.freightTerms = out.freightTerms;
      setBol(b2); setAutoKeys(keys);
    }
  };

  const readAll = async () => {
    for (const d of docs.filter((x) => !x.read)) {
      // one at a time — a dock connection won't take four at once
      // eslint-disable-next-line no-await-in-loop
      await readOne(d.id);
    }
  };

  /* only pages assigned to this run contribute freight */
  const usedDocs = docs.filter((d) => d.read && d.dropId && d.dropId !== "__other");
  const docOrders = usedDocs.flatMap((d) => d.orders);
  const docItems = usedDocs.flatMap((d) =>
    d.items.map((i) => ({ ...i, dropId: d.dropId === "__trip" ? i.dropId : d.dropId })));
  const paperCodes = [...new Set(usedDocs.flatMap((d) => d.fields?.codes || []))];

  const setBolK = (k) => (v) => setBol({ ...bol, [k]: v });

  const pickupLabel = [bol.fromName, bol.fromCity, bol.fromState].filter(Boolean).join(", ");

  const allOrders = [...docOrders, ...orders.filter((o) => !o.docId)];
  const allItems = [...docItems, ...items.filter((i) => !i.docId)];

  const createRun = () => {
    const groups = [...new Set(drops.map((d) => d.runNo || 1))].sort((a, b) => a - b);
    const base = 1000 + st.runs.length;
    const made = groups.map((g, gi) => {
      const mine = drops.filter((d) => (d.runNo || 1) === g);
      const ids = new Set(mine.map((d) => d.id));
      return {
        id: uid(), createdAt: now(),
        ref: groups.length > 1 ? `TERM-${base + 1}-${String.fromCharCode(65 + gi)}` : `TERM-${base + 1}`,
        shipperId: shipper?.id || null,
        bol, orders: allOrders,
        items: allItems.filter((i) => !i.dropId || ids.has(i.dropId)),
        photos: docs.filter((d) => d.dropId === "__trip" || ids.has(d.dropId))
          .map((d) => ({ id: d.id, data: d.data, mime: d.mime, type: d.type, dropId: d.dropId })),
        drops: mine.map((d) => ({ ...d, status: "wait" })),
        status: "draft", driverId: "", vehicleId: "",
        flatRate: RATES.flatRate, extraStopRate: RATES.extraStopRate, fuelPct: RATES.fuelPct, extraCharges: 0,
        extraDocs: [], loadPhotos: [], shipperSig: null, shipperSignedBy: "",
        audit: [{ id: uid(), at: now(), what: `Intake completed at the dock${groups.length > 1 ? ` — run ${gi + 1} of ${groups.length}` : ""}` }],
        routeChange: null,
      };
    });
    put({ runs: [...made, ...st.runs] });
    setOpenRun(made[0].id);
    goStep(5);
  };

  const run = st.runs.find((r) => r.id === openRun);
  const openRunRec = st.runs.find((r) => r.id === openId);

  /* Text arrives → a driver is on the road inside a minute.
     No documents, no drops — those come from the dock.        */
  const quickDispatch = (f) => {
    const sh = SHIPPERS.find((x) => x.id === f.shipperId);
    const run = {
      id: uid(), createdAt: now(),
      ref: `TERM-${1000 + st.runs.length + 1}`,
      shipperId: f.shipperId || null,
      bol: {
        ...BLANK_BOL(), date: f.when,
        fromName: f.pickupName, fromAddress: f.pickupAddress,
        fromCity: f.pickupCity, fromState: f.pickupState, fromZip: f.pickupZip,
        specialInstructions: f.note,
      },
      orders: [], items: [], photos: [], drops: [],
      extraDocs: [], loadPhotos: [], shipperSig: null, shipperSignedBy: "",
      status: "assigned", driverId: f.driverId, vehicleId: f.vehicleId,
      assignedAt: now(), beThereBy: f.time,
      notify: {
        at: now(), seen: false,
        text: `New Term Loading run — collect from ${f.pickupName || "the shipper"}${f.time ? ` by ${f.time}` : ""}`,
      },
      flatRate: RATES.flatRate, extraStopRate: RATES.extraStopRate, fuelPct: RATES.fuelPct, extraCharges: 0,
      audit: [{ id: uid(), at: now(),
        what: `Dispatched from a phone message — ${DRIVERS.find((x) => x.id === f.driverId)?.name}${f.vehicleId ? `, Unit ${VEHICLES.find((x) => x.id === f.vehicleId)?.unitNo}` : ""}` }],
      routeChange: null,
    };
    put({ runs: [run, ...st.runs] });
    setTab("runs"); setOpenId(run.id);
  };
  const patchRun = (p) =>
    put({ runs: st.runs.map((r) => (r.id === openRun ? { ...r, ...p } : r)) });

  const reset = () => {
    setShipper(null); setDocs([]); setBol(BLANK_BOL());
    setOrders([]); setItems([]); setDrops([]);
    setAutoKeys(new Set());
    setOpenRun(null); setStep(0); setMaxStep(0);
  };

  const body = () => {
    if (step === 0) return <Start onPick={pickShipper} onQuick={quickDispatch} runs={st.runs} />;
    if (step === 1) return <Docs docs={docs} setDocs={setDocs} drops={drops} onReadOne={readOne} onReadAll={readAll} />;
    if (step === 2) return <Details bol={bol} set={setBolK} autoKeys={autoKeys} />;
    if (step === 3) return <Freight orders={allOrders} setOrders={setOrders} items={allItems} setItems={setItems} drops={drops} docs={docs} />;
    if (step === 4) return <Drops drops={drops} setDrops={setDrops} shipper={shipper}
      pickupLabel={pickupLabel} codes={paperCodes} nav={nav} setNav={setNav} />;

    /* step 5 — done */
    if (!run) return <div className="tw-empty"><p>Nothing created yet.</p></div>;
    const sibling = st.runs.filter((r) => r.id !== run.id && Math.abs(new Date(r.createdAt) - new Date(run.createdAt)) < 5000);
    const wt = run.items.reduce((a, b) => a + num(b.weight), 0)
      || run.orders.reduce((a, b) => a + num(b.weight), 0);
    return (
      <>
        <div className="tw-card" style={{ borderLeft: "4px solid var(--go)" }}>
          <div className="tw-eyebrow">Created</div>
          <h3 className="tw-display" style={{ fontSize: 21, margin: "3px 0 0" }}>{run.ref}</h3>
          <p className="tw-note">
            {run.bol.fromName || "Shipper"} → {run.drops.length} drop{run.drops.length === 1 ? "" : "s"} ·{" "}
            {run.items.length} item{run.items.length === 1 ? "" : "s"} · {wt.toLocaleString()} lb
          </p>
          <hr className="tw-hr" />
          {sibling.length > 0 && (
            <p className="tw-note" style={{ color: "var(--sea)", fontWeight: 700 }}>
              Split into {sibling.length + 1} runs: {[run, ...sibling].map((r) => r.ref).join(", ")}.
              Each gets its own BOL and invoice line.
            </p>
          )}
          <div className="tw-data" style={{ fontSize: 13 }}>
            <div>BOL {run.bol.bolNumber || "—"} · {run.photos.length} document(s) on file</div>
            <div style={{ color: "var(--mute)", marginTop: 4 }}>
              Dispatch can now assign a driver, and the BOL prints from this record.
            </div>
          </div>
        </div>

        <Assign run={run} onPatch={patchRun} />

        <LiveRoute run={run} onPatch={patchRun} nav={nav} setNav={setNav} />

        <button className="tw-btn" data-v="ghost" onClick={reset}>
          <RotateCcw size={15} /> Start another intake
        </button>
      </>
    );
  };

  const canNext = step < 5;
  const nextLabel = step === 4 ? "Create the run" : "Next";

  return (
    <div className="tw">
      <style>{CSS}</style>
      <div className="tw-bar">
        <Truck size={20} color="#F2B705" />
        <h1 className="tw-display">Term Loading</h1>
        <select value={role} onChange={(e) => { setRole(e.target.value); setOpenId(null); setTab(e.target.value === "driver" ? "runs" : "intake"); }}
          style={{ marginLeft: "auto", background: "var(--ink2)", color: "#fff", border: "1px solid #3B4C5E",
            borderRadius: 3, padding: "5px 7px", fontSize: 12 }}>
          <option value="admin">Admin</option>
          <option value="dispatcher">Dispatcher</option>
          <option value="driver">Driver</option>
        </select>
      </div>

      <div className="tw-wrap">
        {role === "driver" && (
          <div className="tw-fld">
            <label>Signed in as</label>
            <select value={seatDriver} onChange={(e) => { setSeatDriver(e.target.value); setOpenId(null); }}>
              {DRIVERS.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        )}

        <div className="tw-noprint" style={{ display: "flex", background: "#D3D7D3", borderRadius: 2, overflow: "hidden", marginBottom: 12 }}>
          {(role === "driver"
            ? [["runs", "My runs"]]
            : [["intake", "Intake"], ["runs", "Runs"], ["bol", "Bill of lading"], ["invoice", "Invoicing"]]
          ).map(([k, l]) => (
            <button key={k} onClick={() => { setTab(k); setOpenId(null); }}
              style={{
                flex: 1, border: 0, cursor: "pointer", padding: "9px 6px", fontSize: 11, fontWeight: 800,
                letterSpacing: ".08em", textTransform: "uppercase",
                background: tab === k ? "var(--hiviz)" : "transparent",
                color: tab === k ? "var(--ink)" : "var(--mute)",
              }}>{l}</button>
          ))}
        </div>

        {openRunRec ? (
          <RunDetail run={openRunRec} role={role} nav={nav} setNav={setNav}
            onPatch={(p) => put({ runs: st.runs.map((r) => (r.id === openId ? { ...r, ...p } : r)) })}
            onBack={() => setOpenId(null)} />
        ) : tab === "runs" ? (
          <RunList runs={st.runs} role={role} driverId={seatDriver} onOpen={setOpenId} onQuick={quickDispatch} />
        ) : tab === "bol" ? (
          <BolView runs={st.runs} shipper={SHIPPERS[0]} />
        ) : tab === "invoice" ? (
          <InvoiceView runs={st.runs} shipper={SHIPPERS[0]} />
        ) : (
          <>
            <Steps step={step} go={goStep} max={maxStep} />
            {body()}
          </>
        )}

        {!openRunRec && tab === "intake" && role !== "driver" && canNext && step > 0 && (
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button className="tw-btn" data-v="ghost" onClick={() => goStep(step - 1)}>Back</button>
            <button className="tw-btn" data-v={step === 4 ? "go" : "hiviz"}
              onClick={() => (step === 4 ? createRun() : goStep(step + 1))}>
              {nextLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
