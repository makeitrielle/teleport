import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  MapPin, Bus, CheckCircle2, Home, ClipboardList, Bell, User, ArrowLeft,
  Plus, Trash2, Pencil, LogOut, Navigation, Users, Route as RouteIcon,
  LayoutDashboard, ChevronRight, Shield, Monitor, Smartphone, X, Radio,
  Clock, TrendingUp, Armchair, Save, PlayCircle, StopCircle, AlertTriangle,
  Wifi, RefreshCw, Ticket, QrCode, ScanLine, Check, Eye, EyeOff, UserPlus, LogIn, Mail
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { MapContainer, TileLayer, Marker, Polyline, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { BrowserQRCodeReader } from "@zxing/browser";
import { api, withId, withIds } from "./api";

/* Route stops are resolved from the bus configuration. Do not hard-code unverified coordinates. */
const ROUTE_STOPS = [];

// Haversine distance in meters between two lat/lon points.
function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Given a polyline (array of [lat, lon]) and a progress fraction (0-1),
// returns the interpolated [lat, lon] point that fraction of the way along
// the ACTUAL path length (not just index-based), plus the total distance.
function pointAlongRoute(coords, progress) {
  if (!coords || coords.length < 2) return { point: coords?.[0] || [0, 0], totalMeters: 0 };
  const segLens = [];
  let total = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const d = haversineMeters(coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1]);
    segLens.push(d);
    total += d;
  }
  const target = Math.max(0, Math.min(1, progress)) * total;
  let covered = 0;
  for (let i = 0; i < segLens.length; i++) {
    if (covered + segLens[i] >= target || i === segLens.length - 1) {
      const segFrac = segLens[i] > 0 ? (target - covered) / segLens[i] : 0;
      const [lat1, lon1] = coords[i];
      const [lat2, lon2] = coords[i + 1];
      return {
        point: [lat1 + (lat2 - lat1) * segFrac, lon1 + (lon2 - lon1) * segFrac],
        totalMeters: total,
      };
    }
    covered += segLens[i];
  }
  return { point: coords[coords.length - 1], totalMeters: total };
}

// Fetches the real driving route geometry from OSRM's public demo server
// (free, no API key). Returns an array of [lat, lon] pairs, or null if the
// request fails (e.g. offline) so callers can fall back to a straight line.
async function fetchRoadRoute(a, b) {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("OSRM request failed");
    const data = await res.json();
    const coords = data?.routes?.[0]?.geometry?.coordinates;
    if (!coords || coords.length < 2) throw new Error("No route geometry");
    return coords.map(([lon, lat]) => [lat, lon]); // OSRM returns [lon,lat]; Leaflet wants [lat,lon]
  } catch (err) {
    console.warn("[map] road route fetch failed, falling back to straight line:", err.message);
    return null;
  }
}

const geocodedStopCache = new Map();
async function resolveConfiguredStop(name) {
  const known = ROUTE_STOPS.find((stop) => stop.name.toLowerCase() === String(name).trim().toLowerCase());
  if (known) return { ...known, name };
  if (geocodedStopCache.has(name)) return geocodedStopCache.get(name);
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=ph&q=${encodeURIComponent(name + ", Philippines")}`;
  const response = await fetch(url, { headers: { "Accept-Language": "en" } });
  if (!response.ok) throw new Error("Could not look up route stop: " + name);
  const results = await response.json();
  if (!results.length) throw new Error("Route stop could not be located: " + name);
  const stop = { name, lat: Number(results[0].lat), lon: Number(results[0].lon) };
  geocodedStopCache.set(name, stop);
  return stop;
}

async function fetchConfiguredBusRoute(bus) {
  const configuredStops = Array.isArray(bus.stops) && bus.stops.length >= 2 ? bus.stops : [];
  const endpointsMatch = configuredStops.length >= 2 && String(configuredStops[0]).trim().toLowerCase() === String(bus.from).trim().toLowerCase() && String(configuredStops[configuredStops.length - 1]).trim().toLowerCase() === String(bus.to).trim().toLowerCase();
  const names = endpointsMatch ? configuredStops : [bus.from, bus.to];
  const stops = await Promise.all(names.filter(Boolean).map(resolveConfiguredStop));
  if (stops.length < 2) throw new Error("This bus needs an origin and destination stop.");
  const points = stops.map((stop) => `${stop.lon},${stop.lat}`).join(";");
  const url = `https://router.project-osrm.org/route/v1/driving/${points}?overview=full&geometries=geojson&steps=false`;
  const response = await fetch(url);
  if (!response.ok) throw new Error("Could not load the road route.");
  const data = await response.json();
  const coords = data?.routes?.[0]?.geometry?.coordinates;
  if (!coords || coords.length < 2) throw new Error("No drivable route found for this bus.");
  return { stops, coords: coords.map(([lon, lat]) => [lat, lon]) };
}
// Re-centers/fits the map whenever the route bounds are ready.
function FitRouteBounds({ coords }) {
  const map = useMap();
  useEffect(() => {
    if (!coords || coords.length < 2) return;
    map.fitBounds(coords, { padding: [28, 28] });
  }, [coords, map]);
  return null;
}

function DropoffMapClick({ coords, onSelect }) {
  useMapEvents({ click(event) {
    if (!coords || coords.length < 2) return;
    let nearest = null, distance = Infinity;
    for (const point of coords) {
      const d = haversineMeters(event.latlng.lat, event.latlng.lng, point[0], point[1]);
      if (d < distance) { distance = d; nearest = point; }
    }
    if (nearest && distance <= 500) onSelect({ lat: nearest[0], lon: nearest[1] });
  }});
  return null;
}
/* ---------------------------------- THEME ---------------------------------- */

const C = {
  orange: "#FF7A1A",
  orangeDeep: "#E8432B",
  orangeSoft: "#FFE2C7",
  yellow: "#FFCB4D",
  ink: "#14162B",
  panel: "#1B1E3B",
  panel2: "#242850",
  cream: "#FFF9F3",
  card: "#FFFFFF",
  line: "#F0E3D6",
  text: "#241C14",
  sub: "#9A8C7C",
  subDark: "#9AA0C4",
  available: "#2E6EEA",
  booked: "#FF5A5A",
  success: "#22C55E",
  fault: "#B7BBD6",
};

const busDivIcon = L.divIcon({
  className: "",
  html: `<div style="width:26px;height:26px;border-radius:999px;background:${C.orange};
    display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 6px ${C.orange}33, 0 3px 10px rgba(0,0,0,0.35);
    border:2px solid #fff;animation:jj-pulse 1.6s ease-in-out infinite;">
    <span style="font-size:13px;line-height:1;">🚌</span></div>`,
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

const stopDivIcon = (color) => L.divIcon({
  className: "",
  html: `<div style="width:14px;height:14px;border-radius:999px;background:${color};border:2.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3);"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

const FONT_DISPLAY = "'Baloo 2', ui-rounded, system-ui, sans-serif";
const FONT_BODY = "'Plus Jakarta Sans', ui-sans-serif, system-ui, -apple-system, sans-serif";

function GlobalStyle() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; overflow-x: hidden; max-width: 100%; }
      @media print {
        @page { size: 80mm auto; margin: 3mm; }
        body * { visibility: hidden !important; }
        .ticket-print-area, .ticket-print-area * { visibility: visible !important; }
        .ticket-print-area { position: absolute !important; left: 0 !important; top: 0 !important; width: 74mm !important; margin: 0 !important; }
        .ticket-print-card { width: 74mm !important; padding: 3mm !important; border: 0 !important; border-radius: 0 !important; box-shadow: none !important; color: #111 !important; background: #fff !important; font-size: 10pt !important; }
        .ticket-print-card > div { break-inside: avoid; }
        .ticket-no-print { display: none !important; }
      }

      /* =====================================================================
         RESPONSIVE: passenger app (mobile -> tablet -> desktop dashboard)
         Breakpoints: <768px mobile (unchanged), 768-1023px tablet (expanded
         mobile-style), >=1024px desktop (sidebar + dashboard grid).
         ===================================================================== */

      /* ---- TABLET: 768px - 1023px. Same phone-app look, just roomier. ---- */
      @media (min-width: 768px) and (max-width: 1023px) {
        html, body {
          background: radial-gradient(circle at 50% 0%, ${C.orangeSoft} 0%, ${C.cream} 45%, #F3E8DC 100%);
        }
        .phoneShell {
          min-height: calc(100vh - 56px) !important;
          max-width: 600px !important;
          margin: 28px auto !important;
          border-radius: 32px !important;
          overflow: hidden;
          box-shadow: 0 30px 80px rgba(20,22,43,0.22), 0 0 0 1px rgba(20,22,43,0.04) !important;
        }
        .homeCardGrid { padding: 14px 26px !important; gap: 16px !important; }
      }

      /* ---- DESKTOP: >=1024px. Real dashboard: left sidebar + content. ---- */
      @media (min-width: 1024px) {
        html, body { background: ${C.cream}; }
        .dashboardShell {
          display: flex !important;
          max-width: 1280px;
          margin: 0 auto;
          min-height: 100vh;
          background: #fff;
          box-shadow: 0 0 0 1px ${C.line};
        }
        .desktopSidebar { display: flex !important; }
        .mobileBottomNav { display: none !important; }
        .phoneShell {
          flex: 1;
          width: auto !important;
          max-width: none !important;
          margin: 0 !important;
          border-radius: 0 !important;
          box-shadow: none !important;
          min-height: 100vh !important;
        }
        .homeCardGrid {
          display: grid !important;
          grid-template-columns: 1fr 1fr !important;
          gap: 18px !important;
          padding: 18px 32px 28px !important;
        }
      }
      @keyframes jj-pulse { 0%,100% { opacity:1; transform:scale(1);} 50% { opacity:.55; transform:scale(1.35);} }
      @keyframes jj-dash { to { stroke-dashoffset: -24; } }
      @keyframes jj-fade { from { opacity:0; transform:translateY(6px);} to {opacity:1; transform:translateY(0);} }
      .jj-fade { animation: jj-fade .25s ease both; }
      ::-webkit-scrollbar { width:6px; height:6px; }
      ::-webkit-scrollbar-thumb { background:#00000022; border-radius:4px; }

      /* ---------------- RESPONSIVE: admin/kiosk dashboards ---------------- */
      @media (max-width: 860px) {
        .saShell { flex-direction: column !important; }
        .saSidebar {
          width: 100% !important;
          flex-direction: row !important;
          align-items: center !important;
          overflow-x: auto !important;
          border-right: none !important;
          border-bottom: 1px solid ${C.panel2};
          padding: 8px 10px !important;
          gap: 6px !important;
        }
        .saSidebar .saLogo { display: none; }
        .saSidebar .saSpacer { display: none; }
        .sidebarItem { width: auto !important; white-space: nowrap; flex-shrink: 0; }
        .saContent { padding: 14px !important; }
        .twoColGrid { grid-template-columns: 1fr !important; }
      }
      @media (max-width: 480px) {
        .twoColGrid { padding: 12px !important; }
      }
    `}</style>
  );
}

/* ---------------------------------- MOCK DATA ---------------------------------- */

// Groups a flat seat array into bus rows: 3-2 configuration (5 seats per
// row, aisle after the 3rd seat) for the main cabin, with a 6-across
// bench spanning the full width (no aisle) as the very last row — the
// standard layout for a 61-seat provincial bus: 11 rows of 5 (55)
// plus the 6-seat back bench = 61.
// Use the 3-2 arrangement throughout the cabin. For the 61-seat bus,
// the 11 rows of five are followed by a six-seat rear bench.
function buildSeatRows(seats) {
  const fullLayout = Array.from({ length: 61 }, (_, index) =>
    seats.find((seat) => Number(seat.id) === index + 1) || {
      id: index + 1, status: "available", sensor: "fault", updatedAt: Date.now(),
    });
  const rows = [];
  let idx = 0;
  for (let r = 0; r < 11; r++) {
    rows.push({ seats: fullLayout.slice(idx, idx + 5), aisleAfter: 3 });
    idx += 5;
  }
  rows.push({ seats: fullLayout.slice(idx, idx + 6), aisleAfter: null });
  return rows;
}
// Grid-template-columns for one seat row: each seat gets 1fr, with a
// narrow fixed-width aisle column inserted after `aisleAfter` seats
// (or no aisle at all for a full-width back bench, aisleAfter: null).
function seatRowGridStyle(row, aislePx = 20) {
  const n = row.seats.length;
  if (row.aisleAfter == null) {
    return { display: "grid", gridTemplateColumns: `repeat(${n}, 1fr)`, gap: 8, width: "100%" };
  }
  const cols = Array.from({ length: n }, () => "1fr");
  cols.splice(row.aisleAfter, 0, `${aislePx}px`);
  return { display: "grid", gridTemplateColumns: cols.join(" "), gap: 8, width: "100%" };
}

function makeSeats(total, bookedCount, faultyIds = []) {
  return Array.from({ length: total }, (_, i) => ({
    id: i + 1,
    status: i < bookedCount ? "booked" : "available",
    sensor: i < 5 && !faultyIds.includes(i + 1) ? "ok" : "fault",
    updatedAt: Date.now(),
  }));
}

function normalizeBusLayout(bus) {
  const byId = new Map((bus.seats || []).map((seat) => [Number(seat.id), seat]));
  const seats = Array.from({ length: 61 }, (_, index) => {
    const id = index + 1;
    const existing = byId.get(id);
    return existing
      ? { ...existing, id, sensor: id <= 5 && existing.sensor !== "fault" ? "ok" : "fault" }
      : { id, status: "available", sensor: "fault", updatedAt: Date.now() };
  });
  return { ...bus, totalSeats: 61, seats };
}
// This app represents exactly ONE physical bus. busId is the stable,
// human-readable identifier shared by GPS data, seat sensor data, the
// backend API, and every screen below - see backend/models/Bus.js and
// backend/routes/bus.js for the server-side half of this single source
// of truth.
const seedBuses = [
  { id: 1, busId: "BUS-001", name: "Bus 1", driver: "J. Cruz", from: "Iron District Mall", to: "SM Pala Pala",
    stops: ["Iron District Mall", "SM Pala Pala"],
    totalSeats: 61, seats: makeSeats(61, 0), progress: 0.32, status: "active", adminId: 1, etaMin: 20 },
];

const seedRoutes = [
  { id: 1, name: "Iron District Mall - SM Pala Pala", stops: ["Iron District Mall", "SM Pala Pala"] },
];

const seedAdmins = [
  { id: 1, name: "Kiosk Operator", kioskId: "KSK-001", busId: 1 },
];

const seedPassengers = [
  { id: 1, name: "Ana Reyes", email: "ana@example.com", trips: 14 },
  { id: 2, name: "Marco Dela Cruz", email: "marco@example.com", trips: 6 },
  { id: 3, name: "Liza Uy", email: "liza@example.com", trips: 22 },
];

const seedNotifications = [
  { id: 1, title: "Bus 1 is 5 minutes away", body: "Arriving at SM Pala Pala.", time: "2m ago" },
  { id: 2, title: "Fare update", body: "Regular fare is now available for the Iron District Mall - SM Pala Pala.", time: "1h ago" },
];

/* ---------------------------------- SMALL HELPERS ---------------------------------- */

function bezier(t, p0, p1, p2) {
  const x = (1 - t) ** 2 * p0.x + 2 * (1 - t) * t * p1.x + t ** 2 * p2.x;
  const y = (1 - t) ** 2 * p0.y + 2 * (1 - t) * t * p1.y + t ** 2 * p2.y;
  return { x, y };
}

function isSeatSensorOnline(seat) {
  return seat.id <= 5 && seat.sensor !== "fault";
}

function seatCounts(bus) {
  const onlineSeats = bus.seats.filter(isSeatSensorOnline);
  const booked = onlineSeats.filter((s) => s.status === "booked").length;
  const faulty = bus.totalSeats - onlineSeats.length;
  return { booked, available: onlineSeats.length - booked, faulty, online: onlineSeats.length };
}
function timeAgo(ts) {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return `${m}m ago`;
}

function IconBadge({ icon, bg, color, size = 20 }) {
  return (
    <div style={{ width: 40, height: 40, borderRadius: 12, background: bg, display: "flex",
      alignItems: "center", justifyContent: "center", color, flexShrink: 0 }}>
      {React.cloneElement(icon, { size })}
    </div>
  );
}

/* ---------------------------------- LOGO ---------------------------------- */

function Logo({ scale = 1 }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", lineHeight: 0.85, transform: `scale(${scale})` }}>
      <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 26, color: C.yellow,
        WebkitTextStroke: `2px ${C.ink}`, letterSpacing: 1 }}>TELE</span>
      <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 26, color: "#fff",
        WebkitTextStroke: `2px ${C.ink}`, letterSpacing: 1, marginTop: 2 }}>PORT</span>
    </div>
  );
}

/* ---------------------------------- TICKET (shared by kiosk + passenger) ---------------------------------- */

function qrUrl(payload, size = 170) {
  const qrValue = typeof payload === "string" ? payload : JSON.stringify(payload);
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=8&data=${encodeURIComponent(qrValue)}`;
}

function ticketLink(code) {
  const url = new URL(window.location.pathname || "/", window.location.origin);
  url.search = "";
  url.searchParams.set("ticket", code);
  return url.toString();
}

function TicketCard({ ticket, dark }) {
  const issued = ticket.issuedAt || ticket.createdAt || Date.now();
  const issuedAt = new Date(issued);
  const dateText = issuedAt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
  const timeText = issuedAt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const labelStyle = { fontSize: 11, color: "#252525", whiteSpace: "nowrap" };
  const valueStyle = { fontSize: 12, color: "#171717", fontWeight: 600, overflowWrap: "anywhere" };
  const rowStyle = { display: "grid", gridTemplateColumns: "112px minmax(0,1fr)", gap: 6, padding: "3px 0" };
  const separator = "*".repeat(38);
  return (
    <div className="ticket-print-card" style={{ width: "min(100%, 340px)", margin: "0 auto", padding: "16px 15px 14px",
      color: "#171717", background: "#fff", border: "1px solid #dedbd5", boxShadow: "0 8px 24px rgba(0,0,0,.12)",
      fontFamily: "'Courier New', monospace" }}>
      <div style={{ textAlign: "center", paddingBottom: 8 }}>
        <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: ".02em" }}>JASPER JEAN</div>
        <div style={{ fontSize: 11, fontWeight: 700, marginTop: 2 }}>BUS LINER · PASSENGER TICKET</div>
      </div>
      <div aria-hidden="true" style={{ whiteSpace: "nowrap", overflow: "hidden", fontSize: 10, lineHeight: 1.5 }}>{separator}</div>
      <div style={rowStyle}><span style={labelStyle}>Route:</span><span style={valueStyle}>{ticket.from || "Boarding point"} - {ticket.routeTo || ticket.busRouteTo || ticket.dropoff || "—"}</span></div>
      <div style={rowStyle}><span style={labelStyle}>Bus Number:</span><span style={valueStyle}>{ticket.busNumber || ticket.busId || ticket.busName || "—"}</span></div>
      <div style={rowStyle}><span style={labelStyle}>Date:</span><span style={valueStyle}>{dateText} {timeText}</span></div>
      <div style={rowStyle}><span style={labelStyle}>Driver:</span><span style={valueStyle}>{ticket.driver || "—"}</span></div>
      <div style={rowStyle}><span style={labelStyle}>Passenger Type:</span><span style={valueStyle}>REGULAR</span></div>
      <div style={rowStyle}><span style={labelStyle}>Ride:</span><span style={valueStyle}>{ticket.standing || ticket.seat === "Standing" ? "STANDING" : `SEAT ${ticket.seat ?? "—"}`}</span></div>
      <div style={rowStyle}><span style={labelStyle}>From:</span><span style={valueStyle}>{ticket.from || "Boarding point"}</span></div>
      <div style={rowStyle}><span style={labelStyle}>To:</span><span style={valueStyle}>{ticket.dropoff || "—"}</span></div>
      <div aria-hidden="true" style={{ whiteSpace: "nowrap", overflow: "hidden", fontSize: 10, lineHeight: 1.5, marginTop: 2 }}>{separator}</div>
      <div style={{ textAlign: "center", fontSize: 11, margin: "5px 0" }}>TICKET NO. {ticket.code}</div>
      <div style={{ textAlign: "center", fontSize: 19, fontWeight: 700, margin: "6px 0" }}>
        Php {Number(ticket.fare || 0).toFixed(2)}
      </div>
      <div aria-hidden="true" style={{ whiteSpace: "nowrap", overflow: "hidden", fontSize: 10, lineHeight: 1.5 }}>{separator}</div>
      <div style={{ width: 144, height: 144, background: "#fff", margin: "7px auto 5px", display: "grid", placeItems: "center" }}>
        <img src={qrUrl(ticketLink(ticket.code), 280)} alt="Ticket QR code" width={144} height={144}
          style={{ display: "block", imageRendering: "pixelated" }} />
      </div>
      <div style={{ fontSize: 10, lineHeight: 1.45, textAlign: "center" }}>Scan QR for bus ETA and seat availability<br />Powered by Jasper Jean</div>
    </div>
  );
}

/* ================================================================================
   PASSENGER APP
   ================================================================================ */

function PhoneShell({ children, dark }) {
  return (
    <div className="phoneShell" style={{ width: "100%", maxWidth: 430, margin: "0 auto", minHeight: "100vh",
      background: dark ? C.ink : C.cream, display: "flex", flexDirection: "column",
      boxShadow: "0 0 60px rgba(0,0,0,0.15)", fontFamily: FONT_BODY }}>
      {children}
    </div>
  );
}

function PassengerHeader({ title, onBack }) {
  return (
    <div style={{ background: `linear-gradient(135deg, ${C.orange}, ${C.orangeDeep})`,
      padding: "18px 18px 22px", borderBottomLeftRadius: 28, borderBottomRightRadius: 28,
      display: "flex", alignItems: "center", gap: 12, position: "relative" }}>
      {onBack && (
        <button onClick={onBack} style={{ background: "rgba(255,255,255,0.25)", border: "none",
          width: 34, height: 34, borderRadius: 10, display: "flex", alignItems: "center",
          justifyContent: "center", color: "#fff", cursor: "pointer" }}>
          <ArrowLeft size={18} />
        </button>
      )}
      {!onBack && <Logo scale={0.62} />}
      {onBack && <span style={{ color: "#fff", fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18 }}>{title}</span>}
    </div>
  );
}

function BottomNav({ active, onChange }) {
  const items = [
    { id: "home", label: "Home", icon: <Home size={20} /> },
    { id: "activity", label: "Activity", icon: <ClipboardList size={20} /> },
    { id: "notif", label: "Notification", icon: <Bell size={20} /> },
    { id: "profile", label: "Profile", icon: <User size={20} /> },
  ];
  return (
    <div style={{ display: "flex", background: "#fff", borderTop: `1px solid ${C.line}`,
      padding: "10px 6px calc(10px + env(safe-area-inset-bottom))", position: "sticky", bottom: 0 }}>
      {items.map((it) => {
        const isActive = active === it.id;
        return (
          <button key={it.id} onClick={() => onChange(it.id)} style={{ flex: 1, background: "none",
            border: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
            color: isActive ? C.orange : C.sub, cursor: "pointer", padding: "4px 0" }}>
            {it.icon}
            <span style={{ fontSize: 11, fontWeight: isActive ? 700 : 500 }}>{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// Desktop-only equivalent of BottomNav. Same items, same icons, same
// active/inactive colors as the mobile bottom nav — just arranged as a
// vertical sidebar instead of a bottom bar. Hidden by default; shown via
// the .desktopSidebar media query rule at >=1024px (see GlobalStyle).
function DesktopSidebar({ active, onChange }) {
  const items = [
    { id: "home", label: "Home", icon: <Home size={19} /> },
    { id: "activity", label: "Activity", icon: <ClipboardList size={19} /> },
    { id: "notif", label: "Notification", icon: <Bell size={19} /> },
    { id: "profile", label: "Profile", icon: <User size={19} /> },
  ];
  return (
    <div className="desktopSidebar" style={{ display: "none", width: 240, flexShrink: 0,
      background: "#fff", borderRight: `1px solid ${C.line}`, padding: "28px 16px",
      flexDirection: "column", gap: 4 }}>
      <div style={{ padding: "4px 10px 26px" }}><Logo scale={0.62} /></div>
      {items.map((it) => {
        const isActive = active === it.id;
        return (
          <button key={it.id} onClick={() => onChange(it.id)} style={{ display: "flex",
            alignItems: "center", gap: 12, width: "100%", padding: "12px 14px", borderRadius: 14,
            border: "none", cursor: "pointer", background: isActive ? C.orangeSoft : "transparent",
            color: isActive ? C.orangeDeep : C.sub, fontSize: 14, fontWeight: isActive ? 700 : 600,
            textAlign: "left" }}>
            {it.icon} {it.label}
          </button>
        );
      })}
    </div>
  );
}

function HomeCard({ icon, iconBg, iconColor, title, subtitle, onClick }) {
  return (
    <button onClick={onClick} style={{ width: "100%", textAlign: "left", background: "#fff",
      border: `1px solid ${C.line}`, borderRadius: 20, padding: 18, display: "flex",
      alignItems: "center", gap: 14, cursor: "pointer", boxShadow: "0 6px 18px rgba(20,22,43,0.06)" }}>
      <IconBadge icon={icon} bg={iconBg} color={iconColor} size={22} />
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15.5, color: C.text }}>{title}</div>
        <div style={{ fontSize: 12.5, color: C.sub, marginTop: 2 }}>{subtitle}</div>
      </div>
      <ChevronRight size={18} color={C.sub} />
    </button>
  );
}

function PassengerHome({ buses, goto, passengerName, myTicket }) {
  const trackedBus = buses[0];
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <PassengerHeader />
      <div style={{ padding: "18px 18px 8px" }}>
        <div style={{ fontSize: 13, color: C.sub }}>Good day,</div>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 19, color: C.text }}>{passengerName}</div>
      </div>
      <div className="homeCardGrid" style={{ padding: "10px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
        <HomeCard icon={<MapPin />} iconBg={C.orangeSoft} iconColor={C.orangeDeep}
          title="MAPS" subtitle={trackedBus?.status === "active" ? "Your bus is live right now" : "View the live route"} onClick={() => goto("map")} />
        <HomeCard icon={<Bus />} iconBg="#E3ECFF" iconColor={C.available}
          title="SEAT AVAILABILITY" subtitle="Live count straight from seat sensors" onClick={() => goto("seats")} />
        <HomeCard icon={<Ticket />} iconBg="#FFF1DB" iconColor="#C97A1A"
          title="MY TICKET" subtitle={myTicket ? `Seat ${myTicket.seat} · drop at ${myTicket.dropoff}` : "Scan the QR code from the kiosk"}
          onClick={() => goto("ticket")} />
        <HomeCard icon={<RouteIcon />} iconBg="#E8F9EE" iconColor={C.success}
          title="TRIP SCHEDULE" subtitle="View routes and stop times" onClick={() => goto("schedule")} />
      </div>
    </div>
  );
}

function MapScreen({ buses, setBuses, goto }) {
  // Only one bus exists in this system.
  const bus = buses[0];
  const [tracking, setTracking] = useState(true);
  const [routeCoords, setRouteCoords] = useState(null);   // [[lat,lon], ...] once loaded
  const [routeLoading, setRouteLoading] = useState(true);

  const origin = { name: bus?.from || "Origin" };
  const destination = { name: bus?.to || "Destination" };

  // Rebuild the map from this bus's configured stop sequence.
  useEffect(() => {
    let cancelled = false;
    setRouteLoading(true);
    (async () => {
      try {
        const route = await fetchConfiguredBusRoute(bus);
        if (!cancelled) setRouteCoords(route.coords);
      } catch (err) {
        console.warn("[map] configured bus route unavailable:", err.message);
        if (!cancelled) setRouteCoords(null);
      } finally {
        if (!cancelled) setRouteLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [bus?.from, bus?.to, bus?.stops?.join("|")]);
  useEffect(() => {
    if (!tracking || !bus || bus.status !== "active" || (bus.location?.lat != null && Date.now() - new Date(bus.location.updatedAt || 0).getTime() < 120000)) return;
    const t = setInterval(() => {
      setBuses((prev) => prev.map((b) => {
        if (b.id !== bus.id) return b;
        let np = b.progress + 0.01;
        if (np >= 1) np = 0;
        const eta = Math.max(1, Math.round(20 * (1 - np)));
        return { ...b, progress: np, etaMin: eta };
      }));
    }, 400);
    return () => clearInterval(t);
  }, [tracking, bus?.id, bus?.location?.updatedAt, setBuses]);

  if (!bus) return null;
  const counts = seatCounts(bus);
  const gpsFresh = bus.location?.lat != null && bus.location?.lon != null && Date.now() - new Date(bus.location.updatedAt || 0).getTime() < 120000;
  const busPoint = gpsFresh ? [bus.location.lat, bus.location.lon] : routeCoords ? pointAlongRoute(routeCoords, bus.progress).point : [0, 0];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <PassengerHeader title="Live map" onBack={() => goto("home")} />
      <div style={{ margin: "14px 14px 0", borderRadius: 22, overflow: "hidden", position: "relative",
        background: "#E9E4D6", height: 320 }}>
        {routeLoading ? (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center",
            justifyContent: "center", color: C.sub, fontSize: 12.5 }}>
            Loading route…
          </div>
        ) : !routeCoords?.length && !gpsFresh ? (
          <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", padding: 20,
            boxSizing: "border-box", textAlign: "center", color: C.subDark, background: C.ink }}>
            Could not map this bus route. Check the configured stop names or add a precise origin pin.
          </div>
        ) : (
          <MapContainer center={busPoint} zoom={12} style={{ width: "100%", height: "100%" }}
            zoomControl={false} attributionControl={true}>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {routeCoords?.length > 1 && <FitRouteBounds coords={routeCoords} />}
            {routeCoords?.length > 1 && <Polyline positions={routeCoords} pathOptions={{ color: C.orange, weight: 5, opacity: 0.85 }} />}
            {routeCoords?.length > 1 && <Marker position={routeCoords[0]} icon={stopDivIcon(C.orangeDeep)} />}
            {routeCoords?.length > 1 && <Marker position={routeCoords[routeCoords.length - 1]} icon={stopDivIcon(C.success)} />}
            <Marker position={busPoint} icon={busDivIcon} />
          </MapContainer>
        )}
        <div style={{ position: "absolute", top: 10, right: 10, background: gpsFresh ? C.success : C.orange, color: "#fff",
          fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 999, display: "flex",
          alignItems: "center", gap: 5, zIndex: 1000, pointerEvents: "none" }}>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: "#fff",
            animation: "jj-pulse 1s ease-in-out infinite" }} /> {gpsFresh ? "LIVE GPS" : bus.status === "active" ? "ROUTE ESTIMATE" : bus.status === "boarding" ? "BOARDING" : "IDLE"}
        </div>
      </div>
      <div style={{ margin: 14, background: `linear-gradient(135deg, ${C.orange}, ${C.orangeDeep})`,
        borderRadius: 22, padding: 16, color: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 12.5, opacity: 0.9 }}>Bus status</div>
          <div style={{ fontSize: 12.5, opacity: 0.9, fontWeight: 700 }}>{bus.status === "active" ? "ON TRIP" : bus.status === "boarding" ? "BOARDING" : "NOT BOARDING"}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "6px 0 10px" }}>
          <Bus size={20} />
          <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17 }}>{bus.name}</span>
          <span style={{ fontSize: 12.5, opacity: 0.85 }}>{origin.name} → {destination.name}</span>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1, background: "rgba(255,255,255,0.18)", borderRadius: 14, padding: "10px 12px" }}>
            <div style={{ fontSize: 11, opacity: 0.85 }}>Available seats</div>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20 }}>{counts.available}</div>
          </div>
          <div style={{ flex: 1, background: "rgba(255,255,255,0.18)", borderRadius: 14, padding: "10px 12px" }}>
            <div style={{ fontSize: 11, opacity: 0.85 }}>Not available</div>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20 }}>{counts.booked}</div>
          </div>
          <div style={{ flex: 1, background: "rgba(255,255,255,0.18)", borderRadius: 14, padding: "10px 12px" }}>
            <div style={{ fontSize: 11, opacity: 0.85 }}>ETA</div>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20 }}>{bus.etaMin}m</div>
          </div>
        </div>
        <button onClick={() => setTracking((t) => !t)} style={{ width: "100%", marginTop: 12,
          background: "#fff", color: C.orangeDeep, border: "none", borderRadius: 14, padding: "12px 0",
          fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 14.5, cursor: "pointer" }}>
          {tracking ? "Pause tracking" : "Track my bus"}
        </button>
      </div>
    </div>
  );
}

function SeatScreen({ buses, goto }) {
  // Only one bus exists in this system - no bus switcher needed.
  const bus = buses[0];
  const counts = seatCounts(bus);
  const rows = buildSeatRows(bus.seats);
  const seatColor = (seat) => !isSeatSensorOnline(seat) ? C.fault : seat.status === "booked" ? C.booked : C.available;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <PassengerHeader title="Seat availability" onBack={() => goto("home")} />
      <div style={{ padding: 14 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px",
          borderRadius: 999, border: `1px solid ${C.orange}`, background: C.orange, color: "#fff",
          fontSize: 12.5, fontWeight: 700 }}>
          {bus.busId || bus.name}
        </div>
      </div>
      <div style={{ margin: "0 14px", background: "#fff", border: `1px solid ${C.line}`, borderRadius: 24,
        padding: "18px 18px 18px", boxShadow: "0 6px 18px rgba(20,22,43,0.06)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 14 }}>
          <span style={{ width: 7, height: 7, borderRadius: 999, background: C.success,
            animation: "jj-pulse 1s ease-in-out infinite" }} />
          <span style={{ fontSize: 11.5, fontWeight: 700, color: C.sub, letterSpacing: 0.5 }}>LIVE FROM SEAT SENSORS</span>
        </div>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
          <div style={{ width: 46, height: 30, borderRadius: "16px 16px 6px 6px", background: C.ink,
            display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Navigation size={14} color="#fff" />
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
          {rows.map((row, idx) => (
            <div key={idx} style={seatRowGridStyle(row, 26)}>
              {row.seats.map((seat, i) => (
                <React.Fragment key={seat.id}>
                  {i === row.aisleAfter && <div />}
                  <div title={seat.sensor === "fault" ? `Seat ${seat.id} · sensor offline` : `Seat ${seat.id} · ${seat.status}`}
                    style={{ color: seatColor(seat), opacity: seat.status === "booked" && isSeatSensorOnline(seat) ? 0.55 : 1,
                      display: "flex", justifyContent: "center" }}>
                    <Armchair size={26} fill="currentColor" strokeWidth={1} />
                  </div>
                </React.Fragment>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "center", gap: 16, padding: "14px 0 6px", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: C.text }}>
          <span style={{ width: 12, height: 12, borderRadius: 4, background: C.available }} /> Available
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: C.text }}>
          <span style={{ width: 12, height: 12, borderRadius: 4, background: C.booked }} /> Occupied
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: C.text }}>
          <span style={{ width: 12, height: 12, borderRadius: 4, background: C.fault }} /> Sensor offline
        </div>
      </div>
      <div style={{ margin: "6px 14px 14px", background: C.ink, borderRadius: 18, padding: "14px 18px",
        display: "flex", justifyContent: "space-between", alignItems: "center", color: "#fff" }}>
        <div>
          <div style={{ fontSize: 11.5, color: C.subDark }}>{bus.name} · {bus.from} → {bus.to}</div>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16 }}>{counts.available} seats open</div>
        </div>
        {counts.faulty > 0 && (
          <div style={{ fontSize: 11.5, color: "#FFB86B", display: "flex", alignItems: "center", gap: 6 }}>
            <AlertTriangle size={14} /> {counts.faulty} sensor{counts.faulty > 1 ? "s" : ""} offline
          </div>
        )}
      </div>
    </div>
  );
}

function ScheduleScreen({ routes, goto }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <PassengerHeader title="Trip schedule" onBack={() => goto("home")} />
      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
        {routes.map((r) => (
          <div key={r.id} style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 18, padding: 16 }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.text, marginBottom: 10 }}>{r.name}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {r.stops.map((s, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: i === 0 ? C.orange : C.line,
                    border: `2px solid ${C.orange}` }} />
                  <span style={{ fontSize: 13.5, color: C.text }}>{s}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TicketScanScreen({ buses, tickets, setTickets, myTicket, setMyTicket, goto }) {
  const [scanning, setScanning] = useState(false);
  const [qrValue, setQrValue] = useState("");
  const [scanError, setScanError] = useState("");
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const videoRef = useRef(null);
  const connectRef = useRef(null);

  async function connectTicket(value = qrValue) {
    setScanError("");
    setScanning(true);
    try {
      let scannedCode = value.trim();
      try { const decoded = JSON.parse(scannedCode); if (decoded?.code) scannedCode = decoded.code; } catch { /* plain QR token */ }
      try {
        const scannedUrl = new URL(scannedCode);
        scannedCode = scannedUrl.searchParams.get("ticket") || scannedCode;
      } catch { /* scanner returned a plain ticket code */ }
      // QR scanners commonly type the decoded value into this field; lookup also
      // reconnects tickets issued by another kiosk/browser session.
      const target = tickets.find((t) => t.code === scannedCode);
      let found = target;
      if (!found && scannedCode) {
        const matches = await api.getTickets({ qrCode: scannedCode });
        const raw = matches?.[0];
        if (raw) {
          const busId = String(raw.busId);
          const busData = buses.find((b) => String(b.id) === busId);
          const stopIndex = (busData?.stops || []).findIndex((s) => (typeof s === "string" ? s : s.name) === raw.to);
          found = { id: String(raw._id || raw.id), code: raw.qrCode, busId, busNumber: busData?.busId,
            busName: busData?.name || "Bus", busRouteTo: busData?.to, driver: busData?.driver, fare: raw.fare, from: raw.from,
            seat: raw.standing ? "Standing" : raw.seatId, standing: raw.standing, dropoff: raw.to,
            issuedAt: raw.createdAt, dropoffIndex: Math.max(0, stopIndex), totalStops: busData?.stops?.length || 1, claimed: true };
        }
      }
      if (!found) throw new Error("Ticket not found. Scan or enter the QR code printed on your ticket.");
      setTickets((prev) => prev.map((t) => t.id !== found.id ? t : { ...t, claimed: true }));
      setMyTicket({ ...found, claimed: true });
      setQrValue("");
      const currentUrl = new URL(window.location.href);
      if (currentUrl.searchParams.has("ticket")) {
        currentUrl.searchParams.delete("ticket");
        window.history.replaceState({}, "", currentUrl.pathname + currentUrl.search + currentUrl.hash);
      }
    } catch (err) { setScanError(err.message || "Unable to connect to this ticket."); }
    finally { setScanning(false); }
  }
  connectRef.current = connectTicket;
  useEffect(() => {
    const ticketCode = new URLSearchParams(window.location.search).get("ticket");
    if (ticketCode) connectRef.current?.(ticketCode);
  }, []);
  useEffect(() => {
    if (!cameraOn) return undefined;
    let stopped = false;
    let controls;
    async function begin() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Camera access is unavailable. Open this site over HTTPS in Safari or Chrome and allow camera access.");
        }
        if (!videoRef.current) return;
        const reader = new BrowserQRCodeReader();
        controls = await reader.decodeFromConstraints(
          { audio: false, video: { facingMode: { ideal: "environment" } } },
          videoRef.current,
          (result) => {
            if (!result || stopped) return;
            const value = result.getText();
            setQrValue(value);
            setCameraOn(false);
            controls?.stop();
            connectRef.current?.(value);
          },
        );
        if (stopped) controls.stop();
      } catch (err) {
        if (!stopped) {
          const message = err.name === "NotAllowedError" || err.name === "PermissionDeniedError"
            ? "Camera permission was denied. Allow camera access for this website in your browser settings, then try again."
            : err.message || "Unable to access the camera. Open the site over HTTPS and allow camera access.";
          setCameraError(message);
          setCameraOn(false);
        }
      }
    }
    begin();
    return () => { stopped = true; controls?.stop(); };
  }, [cameraOn]);

  const bus = myTicket ? buses.find((b) => b.id === myTicket.busId) : null;
  let status = null;
  if (bus && myTicket) {
    const target = (myTicket.dropoffIndex + 1) / myTicket.totalStops;
    status = bus.progress >= target - 0.02 ? "arrived" : bus.progress >= target - 0.18 ? "approaching" : "enroute";
  }
  const statusMeta = {
    enroute: { label: "En route", color: C.available, bg: "#E3ECFF" },
    approaching: { label: "Approaching your stop", color: C.orangeDeep, bg: C.orangeSoft },
    arrived: { label: "Arriving now", color: C.success, bg: "#E8F9EE" },
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <PassengerHeader title="My ticket" onBack={() => goto("home")} />
      <div style={{ padding: 16 }}>
        {myTicket ? (
          <>
            <div className="ticket-print-area"><TicketCard ticket={myTicket} /></div>
            {bus && status && (
              <div style={{ marginTop: 14, background: statusMeta[status].bg, borderRadius: 16, padding: "14px 16px",
                display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ width: 10, height: 10, borderRadius: 999, background: statusMeta[status].color,
                  animation: status !== "enroute" ? "jj-pulse 1s ease-in-out infinite" : "none" }} />
                <div>
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 14, color: statusMeta[status].color }}>
                    {statusMeta[status].label}
                  </div>
                  <div style={{ fontSize: 12, color: C.sub }}>{bus.name} · {Math.round(bus.progress * 100)}% of route · ETA {bus.etaMin}m</div>
                </div>
              </div>
            )}
            {bus && (() => { const counts = seatCounts(bus); return (
              <div style={{ marginTop: 12, background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, padding: "12px 14px", fontSize: 13, color: C.text }}>
                <strong>Live bus connection</strong><div style={{ color: C.sub, marginTop: 4 }}>{counts.available} seats available · {counts.booked} occupied</div>
              </div>
            ); })()}
            <button onClick={() => setMyTicket(null)} style={{ marginTop: 14, width: "100%", background: "#fff",
              border: `1px solid ${C.line}`, borderRadius: 14, padding: "12px 0", color: C.sub, fontWeight: 700,
              fontSize: 13, cursor: "pointer" }}>
              Scan a different ticket
            </button>
          </>
        ) : (
          <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 22, padding: 26,
            display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
            <div style={{ width: 160, height: 160, borderRadius: 20, border: `2px dashed ${C.orange}`,
              display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 18, position: "relative" }}>
              <ScanLine size={40} color={C.orange} style={{ opacity: scanning ? 1 : 0.6 }} />
              {scanning && <span style={{ position: "absolute", inset: 8, borderRadius: 14, border: `2px solid ${C.orange}`,
                animation: "jj-pulse 0.7s ease-in-out infinite" }} />}
            </div>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.text, marginBottom: 6 }}>
              Scan your kiosk ticket
            </div>
            <div style={{ fontSize: 12.5, color: C.sub, marginBottom: 18 }}>
              Scan the QR code printed at the boarding kiosk. Your ticket connects to live bus ETA and seat availability.
            </div>
            <video ref={videoRef} muted playsInline style={{ display: cameraOn ? "block" : "none", width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: 12, marginBottom: 10 }} />
            <button type="button" onClick={() => { setCameraError(""); setCameraOn((active) => !active); }} style={{ width: "100%", background: "#fff", border: `1px solid ${C.line}`,
              color: C.text, borderRadius: 14, padding: "12px 0", fontWeight: 700, fontSize: 13, marginBottom: 10 }}>
              {cameraOn ? "Stop camera" : "Use camera to scan QR"}
            </button>
            {cameraError && <div role="alert" style={{ color: C.fault, fontSize: 12, marginBottom: 10 }}>{cameraError}</div>}
            <input value={qrValue} onChange={(e) => setQrValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") connectTicket(); }} placeholder="Scan QR code or enter its value" aria-label="Scanned QR code value"
              style={{ width: "100%", boxSizing: "border-box", padding: "12px 14px", border: `1px solid ${C.line}`, borderRadius: 12, marginBottom: 10, fontSize: 14 }} />
            {scanError && <div role="alert" style={{ color: C.fault, fontSize: 12, marginBottom: 10 }}>{scanError}</div>}
            <button onClick={() => connectTicket()} disabled={scanning} style={{ width: "100%", background: C.orange, border: "none",
              color: "#fff", borderRadius: 14, padding: "13px 0", fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 14,
              cursor: "pointer", opacity: scanning ? 0.7 : 1 }}>
              {scanning ? "Connecting…" : "Connect ticket"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ActivityScreen({ activity }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <PassengerHeader />
      <div style={{ padding: "16px 18px 6px", fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: C.text }}>Activity</div>
      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        {activity.length === 0 && (
          <div style={{ textAlign: "center", color: C.sub, fontSize: 13, padding: "30px 0" }}>
            No trips yet. Reserve a seat to see it here.
          </div>
        )}
        {activity.map((a) => (
          <div key={a.id} style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 16,
            padding: 14, display: "flex", gap: 12, alignItems: "center" }}>
            <IconBadge icon={<CheckCircle2 />} bg="#E8F9EE" color={C.success} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: C.text }}>Rode {a.busName} · seat {a.seatId}</div>
              <div style={{ fontSize: 12, color: C.sub }}>{a.time}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function NotifScreen({ notifications }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <PassengerHeader />
      <div style={{ padding: "16px 18px 6px", fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: C.text }}>Notifications</div>
      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        {notifications.map((n) => (
          <div key={n.id} style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 16, padding: 14, display: "flex", gap: 12 }}>
            <IconBadge icon={<Bell />} bg={C.orangeSoft} color={C.orangeDeep} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: C.text }}>{n.title}</div>
              <div style={{ fontSize: 12.5, color: C.sub, marginTop: 2 }}>{n.body}</div>
              <div style={{ fontSize: 11, color: C.sub, marginTop: 4 }}>{n.time}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProfileScreen({ passengerName, onLogout, previewMode }) {
  const menu = [
    { label: "My bookings", icon: <ClipboardList size={17} /> },
    { label: "Payment methods", icon: <Bus size={17} /> },
    { label: "Help center", icon: <Shield size={17} /> },
  ];
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <PassengerHeader />
      <div style={{ padding: "20px 18px", display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ width: 56, height: 56, borderRadius: "50%", background: C.orangeSoft, display: "flex",
          alignItems: "center", justifyContent: "center", color: C.orangeDeep, fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20 }}>
          {passengerName.split(" ").map((p) => p[0]).join("")}
        </div>
        <div>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: C.text }}>{passengerName}</div>
          <div style={{ fontSize: 12.5, color: C.sub }}>Passenger account</div>
        </div>
      </div>
      <div style={{ padding: "0 14px", display: "flex", flexDirection: "column", gap: 10 }}>
        {menu.map((m) => (
          <div key={m.label} style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14,
            padding: "13px 16px", display: "flex", alignItems: "center", gap: 12, color: C.text, fontSize: 13.5, fontWeight: 600 }}>
            {m.icon} {m.label} <span style={{ marginLeft: "auto" }}><ChevronRight size={16} color={C.sub} /></span>
          </div>
        ))}
        <button onClick={onLogout} style={{ marginTop: 8, background: "#fff", border: `1px solid ${C.booked}`,
          borderRadius: 14, padding: "13px 16px", display: "flex", alignItems: "center", gap: 12, color: C.booked,
          fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>
          <LogOut size={17} /> {previewMode ? "Exit preview" : "Log out"}
        </button>
      </div>
    </div>
  );
}

function PassengerApp({ shared, onLogout, passengerName, previewMode }) {
  const { buses, setBuses, routes, activity, notifications, tickets, setTickets, myTicket, setMyTicket } = shared;
  const [tab, setTab] = useState("home");
  const [screen, setScreen] = useState(() => new URLSearchParams(window.location.search).has("ticket") ? "ticket" : "home");
  function goto(s) { setScreen(s); }

  let body;
  if (tab === "home") {
    if (screen === "map") body = <MapScreen buses={buses} setBuses={setBuses} goto={goto} />;
    else if (screen === "seats") body = <SeatScreen buses={buses} goto={goto} />;
    else if (screen === "schedule") body = <ScheduleScreen routes={routes} goto={goto} />;
    else if (screen === "ticket") body = <TicketScanScreen buses={buses} tickets={tickets} setTickets={setTickets} myTicket={myTicket} setMyTicket={setMyTicket} goto={goto} />;
    else body = <PassengerHome buses={buses} goto={goto} passengerName={passengerName} myTicket={myTicket} />;
  } else if (tab === "activity") body = <ActivityScreen activity={activity} />;
  else if (tab === "notif") body = <NotifScreen notifications={notifications} />;
  else body = <ProfileScreen passengerName={passengerName} onLogout={onLogout} previewMode={previewMode} />;

  return (
    <div className="dashboardShell">
      <DesktopSidebar active={tab} onChange={(t) => { setTab(t); setScreen("home"); }} />
      <PhoneShell>
        {previewMode && (
          <div style={{ background: C.ink, color: "#fff", fontSize: 11.5, fontWeight: 700, padding: "8px 14px",
            display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span>👁 Previewing passenger app as Super Admin</span>
            <button onClick={onLogout} style={{ background: C.orange, border: "none", color: "#fff", borderRadius: 8,
              padding: "4px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Exit</button>
          </div>
        )}
        <div className="jj-fade" key={tab + screen} style={{ flex: 1, display: "flex", flexDirection: "column" }}>{body}</div>
        <div className="mobileBottomNav">
          <BottomNav active={tab} onChange={(t) => { setTab(t); setScreen("home"); }} />
        </div>
      </PhoneShell>
    </div>
  );
}

/* ================================================================================
   KIOSK ADMIN APP
   ================================================================================ */

function KioskWelcomeScreen({ onBegin }) {
  return (
    <main style={{ width: "100%", minHeight: "100vh", height: "100dvh", boxSizing: "border-box",
      display: "grid", placeItems: "center", overflow: "hidden", position: "relative",
      padding: "clamp(20px, 5vw, 64px)",
      background: `radial-gradient(ellipse at 0% 100%, ${C.orange} 0%, transparent 44%), radial-gradient(ellipse at 100% 0%, ${C.yellow} 0%, transparent 42%), #fff`,
      fontFamily: FONT_BODY }}>
      <div aria-hidden="true" style={{ position: "absolute", width: "min(75vw, 720px)", aspectRatio: "1",
        borderRadius: "50%", border: `2px solid ${C.orange}55`, opacity: .55, pointerEvents: "none" }} />
      <section style={{ width: "min(100%, 860px)", position: "relative", zIndex: 1, textAlign: "center",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: C.orange, fontFamily: FONT_DISPLAY, fontWeight: 800,
          fontSize: "clamp(44px, 10vw, 104px)", letterSpacing: "-.055em", lineHeight: 1,
          textShadow: `0 3px 0 ${C.yellow}` }}>TELE-PORT</div>
        <div style={{ marginTop: 18, color: C.orangeDeep, fontSize: "clamp(13px, 2vw, 20px)",
          fontWeight: 700, letterSpacing: ".2em" }}>BUS SERVICES</div>
        <div style={{ width: 72, height: 4, borderRadius: 5, background: C.orange, marginTop: 26 }} />
        <button onClick={onBegin} style={{ marginTop: 42, minHeight: 72, border: `2px solid ${C.yellow}`,
          borderRadius: 18, padding: "18px clamp(24px, 6vw, 58px)", display: "inline-flex",
          alignItems: "center", justifyContent: "center", gap: 14, background: C.orange, color: "#fff",
          boxShadow: "0 12px 34px rgba(232,67,43,.25)", fontFamily: FONT_DISPLAY, fontWeight: 700,
          fontSize: "clamp(17px, 2.8vw, 26px)", letterSpacing: ".035em", cursor: "pointer",
          touchAction: "manipulation" }}>
          <Ticket size={28} /> TOUCH SCREEN TO BEGIN
        </button>
      </section>
    </main>
  );
}function KioskAdminApp({ shared, kioskAdmin, onLogout, previewMode, publicKiosk = false }) {
  const { buses, setBuses, tickets, setTickets, usingMock } = shared;
  const bus = buses.find((b) => b.id === kioskAdmin.busId);
  const [mode, setMode] = useState(publicKiosk ? "welcome" : "operator");
  const [log, setLog] = useState([{ id: 1, text: "Kiosk session started", time: "just now" }]);

  function addLog(text) {
    setLog((prev) => [{ id: Date.now(), text, time: "just now" }, ...prev].slice(0, 12));
  }

  function openPassengerKiosk() {
    const url = new URL(window.location.href);
    url.searchParams.set("access", "kiosk");
    window.open(url.toString(), "_blank", "noopener,noreferrer");
  }
  async function overrideSeat(seatId) {
    if (!bus) return;
    const seat = bus.seats.find((s) => s.id === seatId);
    if (!seat || seat.id > 5 || seat.sensor !== "fault") return;
    const nextStatus = seat.status === "booked" ? "available" : "booked";

    if (!usingMock) {
      try {
        const updatedBus = withId(await api.updateSeat(bus.id, seatId, { status: nextStatus }));
        setBuses((prev) => prev.map((b) => (b.id !== bus.id ? b : { ...updatedBus })));
        addLog(`Seat ${seatId} set manually (sensor offline)`);
        return;
      } catch (err) {
        addLog(`Failed to update seat ${seatId}: ${err.message}`);
        return;
      }
    }

    setBuses((prev) => prev.map((b) => b.id !== bus.id ? b : {
      ...b, seats: b.seats.map((s) => s.id !== seatId ? s : { ...s, status: nextStatus, updatedAt: Date.now() }),
    }));
    addLog(`Seat ${seatId} set manually (sensor offline)`);
  }

  async function runDiagnostics() {
    if (!bus) return;
    const faultySeats = bus.seats.filter((s) => s.id <= 5 && s.sensor === "fault");
    const faultCount = faultySeats.length;

    if (!usingMock && faultCount > 0) {
      try {
        // recalibrate each faulty seat's sensor via the API
        let updatedBus = bus;
        for (const s of faultySeats) {
          updatedBus = withId(await api.updateSeat(bus.id, s.id, { sensor: "ok" }));
        }
        setBuses((prev) => prev.map((b) => (b.id !== bus.id ? b : { ...updatedBus })));
        addLog(`Diagnostics complete — ${faultCount} sensor(s) recalibrated`);
        return;
      } catch (err) {
        addLog(`Diagnostics failed: ${err.message}`);
        return;
      }
    }

    setBuses((prev) => prev.map((b) => b.id !== bus.id ? b : {
      ...b, seats: b.seats.map((s) => ({ ...s, sensor: "ok" })),
    }));
    addLog(faultCount > 0 ? `Diagnostics complete — ${faultCount} sensor(s) recalibrated` : "Diagnostics complete — all sensors nominal");
  }

  async function toggleTrip() {
    if (!bus) return;
    const nextStatus = bus.status === "active" ? "idle" : bus.status === "boarding" ? "active" : "boarding";

    if (!usingMock) {
      try {
        const updatedBus = withId(await api.updateBus(bus.id, { status: nextStatus }));
        setBuses((prev) => prev.map((b) => (b.id !== bus.id ? b : { ...updatedBus })));
        addLog(bus.status === "active" ? "Trip ended" : bus.status === "boarding" ? "Trip started" : "Boarding opened");
        return;
      } catch (err) {
        addLog(`Failed to toggle trip: ${err.message}`);
        return;
      }
    }

    setBuses((prev) => prev.map((b) => b.id !== bus.id ? b : { ...b, status: nextStatus }));
    addLog(bus.status === "active" ? "Trip ended" : bus.status === "boarding" ? "Trip started" : "Boarding opened");
  }

  async function pingLocation() {
    if (!bus) return;
    let np = bus.progress + 0.08;
    if (np > 1) np = 0;
    const etaMin = Math.max(1, Math.round(20 * (1 - np)));

    if (!usingMock) {
      try {
        const updatedBus = withId(await api.updateBus(bus.id, { progress: np, etaMin }));
        setBuses((prev) => prev.map((b) => (b.id !== bus.id ? b : { ...updatedBus })));
        addLog("Location ping sent");
        return;
      } catch (err) {
        addLog(`Failed to send ping: ${err.message}`);
        return;
      }
    }

    setBuses((prev) => prev.map((b) => (b.id !== bus.id ? b : { ...b, progress: np, etaMin })));
    addLog("Location ping sent");
  }

  async function issueTicket(seatId, dropoff, dropoffIndex, dropoffLocation, standing = false) {
    if (!bus) return null;

    if (!usingMock) {
      try {
        const created = withId(await api.createTicket({
          busId: bus.id, seatId, standing, from: bus.from, to: dropoff, fare: 0, dropoffLocation,
        }));
        // reflect the now-booked seat locally so the kiosk UI updates immediately
        if (!standing) setBuses((prev) => prev.map((b) => b.id !== bus.id ? b : {
          ...b, seats: b.seats.map((s) => s.id !== seatId ? s : { ...s, status: "booked", updatedAt: Date.now() }),
        }));
        const ticket = { id: created.id, code: created.qrCode, busId: bus.id, busNumber: bus.busId, busName: bus.name,
          busRouteTo: bus.to, driver: bus.driver, fare: created.fare, from: bus.from, issuedAt: created.createdAt,
          seat: standing ? "Standing" : seatId, standing, dropoff, dropoffIndex, dropoffLocation, totalStops: bus.stops.length, claimed: false, notified: false };
        setTickets((prev) => [...prev, ticket]);
        addLog(`Ticket ${ticket.code} issued — seat ${seatId} → ${dropoff}`);
        return ticket;
      } catch (err) {
        addLog(`Failed to issue ticket: ${err.message}`);
        return null;
      }
    }

    const code = `JJ-${Date.now().toString(36).toUpperCase()}`;
    const ticket = { id: Date.now(), code, busId: bus.id, busNumber: bus.busId, busName: bus.name, busRouteTo: bus.to,
      driver: bus.driver, fare: bus.fare ?? 0, from: bus.from, issuedAt: Date.now(), seat: standing ? "Standing" : seatId, standing,
      dropoff, dropoffIndex, dropoffLocation, totalStops: bus.stops.length, claimed: false, notified: false };
    if (!standing) setBuses((prev) => prev.map((b) => b.id !== bus.id ? b : {
      ...b, seats: b.seats.map((s) => s.id !== seatId ? s : { ...s, status: "booked", updatedAt: Date.now() }),
    }));
    setTickets((prev) => [...prev, ticket]);
    addLog(`Ticket ${code} issued — seat ${seatId} → ${dropoff}`);
    return ticket;
  }

  if (!bus) {
    return (
      <div style={{ minHeight: "100vh", background: C.ink, display: "flex", alignItems: "center",
        justifyContent: "center", color: "#fff", fontFamily: FONT_BODY }}>
        No bus assigned to this kiosk.
      </div>
    );
  }

  if (mode === "welcome") {
    return <KioskWelcomeScreen onBegin={() => setMode("ticket")} />;
  }

  return (
    <div style={{ minHeight: "100vh", background: C.ink, fontFamily: FONT_BODY }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "16px 20px", borderBottom: `1px solid ${C.panel2}`, flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Logo scale={0.5} />
          <div style={{ color: "#fff", fontSize: 12.5, marginLeft: 6 }}>
            <div style={{ color: C.subDark }}>{publicKiosk ? "Passenger ticket kiosk" : "Staff console"}</div>
            {!publicKiosk && <div style={{ fontWeight: 700 }}>{kioskAdmin.name} · {kioskAdmin.kioskId}</div>}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {!publicKiosk && <>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button onClick={openPassengerKiosk} style={{ background: C.orange, border: "none", color: "#fff", padding: "8px 12px", borderRadius: 10, cursor: "pointer", fontSize: 12.5, fontWeight: 700 }}>
                Open passenger kiosk
              </button>
              <span style={{ background: C.panel, color: "#fff", padding: "8px 12px", borderRadius: 10, fontSize: 12.5, fontWeight: 700 }}>Staff tools</span>
            </div>
            <button onClick={onLogout} style={{ background: C.panel2, border: "none", color: "#fff",
              padding: "8px 14px", borderRadius: 10, display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13 }}>
              <LogOut size={15} /> {previewMode ? "Exit preview" : "Log out"}
            </button>
          </>}
        </div>
      </div>

      {mode === "ticket" ? (
        <KioskTicketFlow bus={bus} issueTicket={issueTicket} onFinish={() => setMode("welcome")} />
      ) : (
        <KioskOperatorPanel bus={bus} log={log} toggleTrip={toggleTrip} pingLocation={pingLocation}
          overrideSeat={overrideSeat} runDiagnostics={runDiagnostics} />
      )}
    </div>
  );
}

function KioskOperatorPanel({ bus, log, toggleTrip, pingLocation, overrideSeat, runDiagnostics }) {
  const counts = seatCounts(bus);
  const rows = buildSeatRows(bus.seats);
  return (
    <div className="twoColGrid" style={{ maxWidth: 900, margin: "0 auto", padding: 20, display: "grid",
      gridTemplateColumns: "1.2fr 1fr", gap: 18 }}>
      <div>
        <div style={{ background: C.panel, borderRadius: 20, padding: 20, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div>
              <div style={{ color: C.subDark, fontSize: 12 }}>Assigned vehicle</div>
              <div style={{ color: "#fff", fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20 }}>{bus.name}</div>
              <div style={{ color: C.subDark, fontSize: 12.5, marginTop: 2 }}>{bus.from} → {bus.to} · Driver {bus.driver}</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
              <span style={{ padding: "6px 12px", borderRadius: 999, fontSize: 11.5, fontWeight: 700,
                background: bus.status === "active" ? "#1E3A2A" : "#3A2A1E",
                color: bus.status === "active" ? "#4ADE80" : "#FFB86B" }}>
                {bus.status === "active" ? "ON TRIP" : bus.status === "boarding" ? "BOARDING" : "IDLE"}
              </span>
              <span style={{ fontSize: 11, color: counts.faulty > 0 ? "#FFB86B" : C.subDark, display: "flex", alignItems: "center", gap: 4 }}>
                <Wifi size={12} /> {counts.online}/{bus.totalSeats} sensors online
              </span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={toggleTrip} style={{ flex: 1, background: bus.status === "active" ? C.booked : C.success,
              border: "none", color: "#fff", borderRadius: 12, padding: "12px 0", fontWeight: 700, fontSize: 13.5,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8, cursor: "pointer" }}>
              {bus.status === "active" ? <StopCircle size={16} /> : <PlayCircle size={16} />}
              {bus.status === "active" ? "End trip" : bus.status === "boarding" ? "Start trip" : "Start boarding"}
            </button>
            <button onClick={pingLocation} style={{ flex: 1, background: C.panel2, border: "none", color: "#fff",
              borderRadius: 12, padding: "12px 0", fontWeight: 700, fontSize: 13.5, display: "flex",
              alignItems: "center", justifyContent: "center", gap: 8, cursor: "pointer" }}>
              <Radio size={16} /> Send location update
            </button>
          </div>
          <div style={{ marginTop: 14, height: 6, background: C.panel2, borderRadius: 999, overflow: "hidden" }}>
            <div style={{ width: `${Math.round(bus.progress * 100)}%`, height: "100%", background: C.orange }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: C.subDark, marginTop: 6 }}>
            <span>Route progress · {Math.round(bus.progress * 100)}%</span>
            <span>ETA {bus.etaMin}m</span>
          </div>
        </div>

        <div style={{ background: C.panel, borderRadius: 20, padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
            <div>
              <div style={{ color: "#fff", fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15 }}>Seat sensor manifest</div>
              <div style={{ color: C.subDark, fontSize: 12, marginTop: 2 }}>Updates automatically · tap a grey seat to override</div>
            </div>
            <button onClick={runDiagnostics} style={{ background: C.panel2, border: "none", color: "#fff",
              borderRadius: 10, padding: "8px 12px", fontSize: 11.5, fontWeight: 700, display: "flex",
              alignItems: "center", gap: 6, cursor: "pointer", whiteSpace: "nowrap" }}>
              <RefreshCw size={13} /> Run diagnostics
            </button>
          </div>
          <div style={{ display: "flex", gap: 16, margin: "14px 0" }}>
            <div style={{ color: C.available, fontSize: 12.5 }}>● {counts.available} available</div>
            <div style={{ color: C.booked, fontSize: 12.5 }}>● {counts.booked} occupied</div>
            <div style={{ color: C.fault, fontSize: 12.5 }}>● {counts.faulty} offline</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {rows.map((row, idx) => (
              <div key={idx} style={seatRowGridStyle(row, 20)}>
                {row.seats.map((seat, i) => (
                  <React.Fragment key={seat.id}>
                    {i === row.aisleAfter && <div />}
                    <button onClick={() => overrideSeat(seat.id)}
                      style={{ border: "none", background: "none", padding: 0,
                        cursor: seat.id <= 5 && seat.sensor === "fault" ? "pointer" : "default",
                        color: !isSeatSensorOnline(seat) ? C.fault : (seat.status === "booked" ? C.booked : C.available) }}
                      title={seat.sensor === "fault" ? `Seat ${seat.id} · sensor offline, tap to override` : `Seat ${seat.id} · sensor reporting ${timeAgo(seat.updatedAt)}`}>
                      <Armchair size={22} fill="currentColor" strokeWidth={1} />
                    </button>
                  </React.Fragment>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ background: C.panel, borderRadius: 20, padding: 20, height: "fit-content" }}>
        <div style={{ color: "#fff", fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, marginBottom: 12 }}>Session log</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 420, overflowY: "auto" }}>
          {log.map((l) => (
            <div key={l.id} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <Clock size={14} color={C.subDark} style={{ marginTop: 2 }} />
              <div>
                <div style={{ color: "#fff", fontSize: 12.5 }}>{l.text}</div>
                <div style={{ color: C.subDark, fontSize: 11 }}>{l.time}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function KioskTicketFlow({ bus, issueTicket, onFinish }) {
  const [step, setStep] = useState("seat");
  const [seatId, setSeatId] = useState(null);
  const [standing, setStanding] = useState(false);
  const [dropoffIdx, setDropoffIdx] = useState(null);
  const [dropoffLocation, setDropoffLocation] = useState(null);
  const [dropoffName, setDropoffName] = useState("");
  const [lookingUpDropoff, setLookingUpDropoff] = useState(false);
  const dropoffLookupId = useRef(0);
  const [routeCoords, setRouteCoords] = useState(null);
  const [locationError, setLocationError] = useState("");
  const [ticket, setTicket] = useState(null);

  const rows = buildSeatRows(bus.seats);
  const hasAvailableSeat = bus.seats.some((seat) => isSeatSensorOnline(seat) && seat.status !== "booked");
  async function selectDropoffLocation(location) {
    setDropoffLocation(location);
    setDropoffName("Finding place name…");
    setLookingUpDropoff(true);
    const lookupId = ++dropoffLookupId.current;
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&lat=${location.lat}&lon=${location.lon}`;
      const response = await fetch(url, { headers: { "Accept-Language": "en" } });
      if (!response.ok) throw new Error("Location lookup failed");
      const result = await response.json();
      const address = result.address || {};
      const namedParts = [result.name, address.road, address.neighbourhood, address.suburb, address.city || address.town || address.village]
        .filter(Boolean).filter((part, index, all) => all.indexOf(part) === index);
      const placeName = namedParts.length ? namedParts.join(", ") : result.display_name;
      if (lookupId === dropoffLookupId.current) setDropoffName(placeName || `Route point (${location.lat.toFixed(5)}, ${location.lon.toFixed(5)})`);
    } catch {
      if (lookupId === dropoffLookupId.current) setDropoffName(`Route point (${location.lat.toFixed(5)}, ${location.lon.toFixed(5)})`);
    } finally {
      if (lookupId === dropoffLookupId.current) setLookingUpDropoff(false);
    }
  }
  useEffect(() => {
    let alive = true;
    fetchConfiguredBusRoute(bus).then((route) => { if (alive) setRouteCoords(route.coords); }).catch((err) => { if (alive) setLocationError(err.message); });
    return () => { alive = false; };
  }, []);
  function useCurrentLocation() {
    setLocationError("");
    if (!navigator.geolocation) { setLocationError("Location is unavailable."); return; }
    navigator.geolocation.getCurrentPosition((pos) => {
      if (!routeCoords || routeCoords.length < 2) { setLocationError("Route map is loading."); return; }
      let nearest = null, distance = Infinity;
      for (const point of routeCoords) {
        const d = haversineMeters(pos.coords.latitude, pos.coords.longitude, point[0], point[1]);
        if (d < distance) { distance = d; nearest = point; }
      }
      if (nearest && distance <= 500) selectDropoffLocation({ lat: nearest[0], lon: nearest[1] });
      else setLocationError("You are more than 500 m from this route. Tap a point on the route.");
    }, () => setLocationError("Location permission was denied or unavailable."), { enableHighAccuracy: true, timeout: 10000 });
  }


  function confirmSeat() { if (seatId || standing) setStep("dropoff"); }
  async function confirmDropoff() {
    if (!dropoffLocation || lookingUpDropoff) return;
    const label = dropoffName || `Route point (${dropoffLocation.lat.toFixed(5)}, ${dropoffLocation.lon.toFixed(5)})`;
    const t = await issueTicket(seatId, label, dropoffIdx, dropoffLocation, standing);
    if (!t) return; // issuing failed; stay on this step so staff can retry
    setTicket(t);
    setStep("ticket");
  }

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: "28px 20px 40px" }}>
      <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 22 }}>
        {["seat", "dropoff", "ticket"].map((s, i) => (
          <div key={s} style={{ width: 8, height: 8, borderRadius: 999,
            background: step === s ? C.orange : "#3A3D5C" }} />
        ))}
      </div>

      {step === "seat" && (
        <div className="jj-fade">
          <div style={{ textAlign: "center", marginBottom: 18 }}>
            <div style={{ color: "#fff", fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 19 }}>Tap your seat</div>
            <div style={{ color: C.subDark, fontSize: 12.5, marginTop: 4 }}>{bus.name} · {bus.from} → {bus.to}</div>
          </div>
          {!hasAvailableSeat && <button onClick={() => { setSeatId(null); setStanding(true); }} style={{ width: "100%", marginTop: 14,
            background: standing ? "#3A3D5C" : C.panel, border: `1px solid ${standing ? C.yellow : "#454966"}`, color: "#fff",
            borderRadius: 12, padding: "12px", fontWeight: 700, cursor: "pointer" }}>Ride standing · no seats available</button>}
          <div style={{ background: C.panel, borderRadius: 22, padding: 20 }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
              <div style={{ width: 46, height: 30, borderRadius: "16px 16px 6px 6px", background: C.ink,
                display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Navigation size={14} color="#fff" />
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
              {rows.map((row, idx) => (
                <div key={idx} style={seatRowGridStyle(row, 26)}>
                  {row.seats.map((seat, i) => {
                    const disabled = seat.status === "booked" || !isSeatSensorOnline(seat);
                    const selected = seatId === seat.id;
                    return (
                      <React.Fragment key={seat.id}>
                        {i === row.aisleAfter && <div />}
                        <button onClick={() => { if (!disabled) { setSeatId(seat.id); setStanding(false); } }} disabled={disabled}
                          style={{ border: "none", background: "none", padding: 0,
                            cursor: disabled ? "not-allowed" : "pointer",
                            color: selected ? C.yellow : disabled ? C.fault : C.available,
                            opacity: disabled ? 0.5 : 1, transform: selected ? "scale(1.15)" : "scale(1)",
                            transition: "transform .12s" }}
                          title={`Seat ${seat.id}`}>
                          <Armchair size={26} fill="currentColor" strokeWidth={1} />
                        </button>
                      </React.Fragment>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "center", gap: 16, margin: "14px 0 20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.subDark }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: C.available }} /> Open
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.subDark }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: C.yellow }} /> Selected
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.subDark }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: C.fault }} /> Unavailable
            </div>
          </div>
          <button onClick={confirmSeat} disabled={!seatId && !standing} style={{ width: "100%", background: seatId || standing ? C.orange : C.panel2,
            border: "none", color: "#fff", borderRadius: 14, padding: "14px 0", fontFamily: FONT_DISPLAY, fontWeight: 700,
            fontSize: 15, cursor: seatId || standing ? "pointer" : "not-allowed" }}>
            {standing ? "Continue standing" : seatId ? `Continue with seat ${seatId}` : "Select a seat to continue"}
          </button>
        </div>
      )}

      {step === "dropoff" && (
        <div className="jj-fade">
          <div style={{ textAlign: "center", marginBottom: 18 }}>
            <div style={{ color: "#fff", fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 19 }}>Where are you getting off?</div>
            <div style={{ color: C.subDark, fontSize: 12.5, marginTop: 4 }}>{standing ? "Standing" : `Seat ${seatId}`} · {bus.name}</div>
          </div>
          <div style={{ color: C.subDark, fontSize: 12, marginBottom: 8 }}>Tap the exact drop-off point on the route. The ticket will show its place name and save its coordinates.</div>
          <button onClick={useCurrentLocation} style={{ marginBottom: 8, background: C.panel, border: "1px solid #454966", color: "#fff", borderRadius: 10, padding: "9px 12px" }}>Use my current location</button>
          {locationError && <div style={{ color: "#FDBA74", fontSize: 12, marginBottom: 8 }}>{locationError}</div>}
          <div style={{ height: 220, borderRadius: 14, overflow: "hidden", marginBottom: 10 }}>
            {routeCoords && routeCoords.length > 1 ? <MapContainer center={routeCoords[Math.floor(routeCoords.length / 2)]} zoom={12} style={{ width: "100%", height: "100%" }}>
              <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              <Polyline positions={routeCoords} pathOptions={{ color: C.orange, weight: 5 }} />
              <DropoffMapClick coords={routeCoords} onSelect={selectDropoffLocation} />
              {dropoffLocation && <Marker position={[dropoffLocation.lat, dropoffLocation.lon]} />}
            </MapContainer> : <div style={{ height: "100%", display: "grid", placeItems: "center", background: C.panel, color: C.subDark }}>Loading route map...</div>}
          </div>
          <div style={{ color: dropoffLocation ? "#4ADE80" : C.subDark, fontSize: 12, lineHeight: 1.5, marginBottom: 18 }}>
            {dropoffLocation ? <><strong>{lookingUpDropoff ? "Finding place…" : dropoffName}</strong><br />Pin: {dropoffLocation.lat.toFixed(5)}, {dropoffLocation.lon.toFixed(5)}</> : "No drop-off location selected"}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => setStep("seat")} style={{ flex: 1, background: C.panel2, border: "none", color: "#fff",
              borderRadius: 14, padding: "13px 0", fontWeight: 700, fontSize: 13.5, cursor: "pointer" }}>
              Back
            </button>
            <button onClick={confirmDropoff} disabled={!dropoffLocation || lookingUpDropoff} style={{ flex: 2,
              background: dropoffLocation && !lookingUpDropoff ? C.orange : C.panel2, border: "none", color: "#fff", borderRadius: 14,
              padding: "13px 0", fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 14.5,
              cursor: dropoffLocation && !lookingUpDropoff ? "pointer" : "not-allowed" }}>
              {lookingUpDropoff ? "Finding location…" : "Print ticket"}
            </button>
          </div>
        </div>
      )}

      {step === "ticket" && ticket && (
        <div className="jj-fade">
          <div style={{ textAlign: "center", marginBottom: 18 }}>
            <div style={{ display: "inline-flex", width: 46, height: 46, borderRadius: 999, background: "#1E3A2A",
              alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
              <Check size={22} color="#4ADE80" />
            </div>
            <div style={{ color: "#fff", fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 19 }}>Ticket ready</div>
            <div style={{ color: C.subDark, fontSize: 12.5, marginTop: 4 }}>Scan the QR code with the passenger app</div>
          </div>
          <div className="ticket-print-area"><TicketCard ticket={ticket} dark /></div>
          <button className="ticket-no-print" onClick={() => window.print()} style={{ width: "100%", marginTop: 18, background: C.orange, border: "none",
            color: "#fff", borderRadius: 14, padding: "13px 0", fontWeight: 700, fontSize: 13.5, cursor: "pointer" }}>
            Print ticket
          </button>
          <button className="ticket-no-print" onClick={onFinish} style={{ width: "100%", marginTop: 10, background: C.panel2, border: "none",
            color: "#fff", borderRadius: 14, padding: "13px 0", fontWeight: 700, fontSize: 13.5, cursor: "pointer" }}>
            Finish
          </button>
        </div>
      )}
    </div>
  );
}

/* ================================================================================
   SUPER ADMIN APP
   ================================================================================ */

function SidebarItem({ icon, label, active, onClick }) {
  return (
    <button className="sidebarItem" onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 12, width: "100%",
      padding: "11px 14px", borderRadius: 12, border: "none", cursor: "pointer",
      background: active ? C.orange : "transparent", color: active ? "#fff" : C.subDark, fontSize: 13.5,
      fontWeight: 600, textAlign: "left" }}>
      {icon} {label}
    </button>
  );
}

function StatCard({ label, value, icon, color }) {
  return (
    <div style={{ background: C.panel, borderRadius: 16, padding: 16, flex: 1, display: "flex", alignItems: "center", gap: 12 }}>
      <IconBadge icon={icon} bg={color + "22"} color={color} />
      <div>
        <div style={{ color: C.subDark, fontSize: 12 }}>{label}</div>
        <div style={{ color: "#fff", fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20 }}>{value}</div>
      </div>
    </div>
  );
}

function InputSm(props) {
  return <input {...props} style={{ background: C.ink, border: `1px solid ${C.panel2}`, color: "#fff",
    borderRadius: 8, padding: "7px 10px", fontSize: 12.5, width: "100%", ...(props.style || {}) }} />;
}
function SelectSm(props) {
  return <select {...props} style={{ background: C.ink, border: `1px solid ${C.panel2}`, color: "#fff",
    borderRadius: 8, padding: "7px 10px", fontSize: 12.5, width: "100%", ...(props.style || {}) }} />;
}

function TableShell({ headers, children }) {
  return (
    <div style={{ background: C.panel, borderRadius: 16, overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: C.panel2 }}>
            {headers.map((h) => (
              <th key={h} style={{ textAlign: "left", padding: "10px 14px", color: C.subDark, fontWeight: 600, fontSize: 11.5 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
const td = { padding: "10px 14px", color: "#fff", borderTop: `1px solid ${C.ink}` };

function OverviewTab({ buses, admins, passengers }) {
  const totalSeatsBooked = buses.reduce((sum, b) => sum + seatCounts(b).booked, 0);
  const activeTrips = buses.filter((b) => b.status === "active").length;
  const totalFaulty = buses.reduce((sum, b) => sum + seatCounts(b).faulty, 0);
  return (
    <div>
      <div style={{ display: "flex", gap: 14, marginBottom: 18, flexWrap: "wrap" }}>
        <StatCard label="Total buses" value={buses.length} icon={<Bus />} color={C.orange} />
        <StatCard label="Active trips" value={activeTrips} icon={<Radio />} color={C.success} />
        <StatCard label="Seats occupied now" value={totalSeatsBooked} icon={<Armchair />} color={C.available} />
        <StatCard label="Sensors offline" value={totalFaulty} icon={<AlertTriangle />} color={totalFaulty > 0 ? "#FFB86B" : C.subDark} />
      </div>
      <div style={{ background: C.panel, borderRadius: 16, padding: 18 }}>
        <div style={{ color: "#fff", fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, marginBottom: 12 }}>Fleet pulse</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {buses.map((b) => (
            <div key={b.id}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 6 }}>
                <span style={{ color: "#fff", display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 999,
                    background: b.status === "active" ? C.success : C.subDark }} />
                  {b.name} · {b.from} → {b.to}
                </span>
                <span style={{ color: C.subDark }}>{b.status === "active" ? `ETA ${b.etaMin}m` : "idle"}</span>
              </div>
              <div style={{ height: 6, background: C.ink, borderRadius: 999, overflow: "hidden" }}>
                <div style={{ width: `${Math.round(b.progress * 100)}%`, height: "100%", background: C.orange }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function BusesTab({ buses, setBuses, routes, admins, usingMock }) {
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  function startEdit(b) { setEditingId(b.id); setDraft({ ...b }); }
  function startAdd() {
    setAdding(true);
    setDraft({ id: Date.now(), name: `Bus ${buses.length + 1}`, driver: "", from: "", to: "", totalSeats: 61, status: "idle", adminId: null, progress: 0, etaMin: 0 });
  }

  async function save() {
    const totalSeats = Number(draft.totalSeats);

    if (adding) {
      if (!usingMock) {
        setBusy(true);
        try {
          const created = withId(await api.createBus({
            name: draft.name, driver: draft.driver, from: draft.from, to: draft.to,
            stops: [draft.from, draft.to].filter(Boolean), totalSeats,
            seats: makeSeats(totalSeats, 0), progress: 0, status: "idle", etaMin: 0,
          }));
          setBuses((prev) => [...prev, created]);
        } catch (err) {
          alert(`Failed to create bus: ${err.message}`);
        } finally {
          setBusy(false);
        }
      } else {
        setBuses((prev) => [...prev, { ...draft, totalSeats, seats: makeSeats(totalSeats, 0) }]);
      }
      setAdding(false);
    } else {
      const current = buses.find((b) => b.id === editingId);
      const seats = totalSeats !== current.totalSeats ? makeSeats(totalSeats, 0) : current.seats;
      const patch = { name: draft.name, driver: draft.driver, from: draft.from, to: draft.to, totalSeats, seats };

      if (!usingMock) {
        setBusy(true);
        try {
          const updated = withId(await api.updateBus(editingId, patch));
          setBuses((prev) => prev.map((b) => (b.id !== editingId ? b : updated)));
        } catch (err) {
          alert(`Failed to update bus: ${err.message}`);
        } finally {
          setBusy(false);
        }
      } else {
        setBuses((prev) => prev.map((b) => (b.id !== editingId ? b : { ...b, ...patch })));
      }
      setEditingId(null);
    }
    setDraft(null);
  }

  async function remove(id) {
    if (!usingMock) {
      try {
        await api.deleteBus(id);
      } catch (err) {
        alert(`Failed to delete bus: ${err.message}`);
        return;
      }
    }
    setBuses((prev) => prev.filter((b) => b.id !== id));
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ color: "#fff", fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17 }}>Buses</div>
        <button onClick={startAdd} style={{ background: C.orange, border: "none", color: "#fff", borderRadius: 10,
          padding: "8px 14px", fontSize: 12.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <Plus size={15} /> Add bus
        </button>
      </div>
      <TableShell headers={["Name", "Route", "Driver", "Seats", "Sensors", "Status", "Actions"]}>
        {adding && (
          <tr>
            <td style={td}><InputSm value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></td>
            <td style={td}>
              <div style={{ display: "flex", gap: 6 }}>
                <InputSm placeholder="From" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
                <InputSm placeholder="To" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
              </div>
            </td>
            <td style={td}><InputSm value={draft.driver} onChange={(e) => setDraft({ ...draft, driver: e.target.value })} /></td>
            <td style={td}><InputSm type="number" value={draft.totalSeats} onChange={(e) => setDraft({ ...draft, totalSeats: e.target.value })} /></td>
            <td style={td}>—</td>
            <td style={td}>idle</td>
            <td style={td}>
              <button onClick={save} style={{ background: C.success, border: "none", borderRadius: 8, color: "#fff", padding: "6px 10px", cursor: "pointer" }}><Save size={13} /></button>
              <button onClick={() => { setAdding(false); setDraft(null); }} style={{ marginLeft: 6, background: C.panel2, border: "none", borderRadius: 8, color: "#fff", padding: "6px 10px", cursor: "pointer" }}><X size={13} /></button>
            </td>
          </tr>
        )}
        {buses.map((b) => {
          const admin = admins.find((a) => a.busId === b.id);
          const isEditing = editingId === b.id;
          return (
            <tr key={b.id}>
              {isEditing ? (
                <>
                  <td style={td}><InputSm value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></td>
                  <td style={td}>
                    <div style={{ display: "flex", gap: 6 }}>
                      <InputSm value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
                      <InputSm value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
                    </div>
                  </td>
                  <td style={td}><InputSm value={draft.driver} onChange={(e) => setDraft({ ...draft, driver: e.target.value })} /></td>
                  <td style={td}><InputSm type="number" value={draft.totalSeats} onChange={(e) => setDraft({ ...draft, totalSeats: e.target.value })} /></td>
                  <td style={td}>{seatCounts(b).online}/{b.totalSeats}</td>
                  <td style={td}>{b.status}</td>
                  <td style={td}>
                    <button onClick={save} style={{ background: C.success, border: "none", borderRadius: 8, color: "#fff", padding: "6px 10px", cursor: "pointer" }}><Save size={13} /></button>
                    <button onClick={() => { setEditingId(null); setDraft(null); }} style={{ marginLeft: 6, background: C.panel2, border: "none", borderRadius: 8, color: "#fff", padding: "6px 10px", cursor: "pointer" }}><X size={13} /></button>
                  </td>
                </>
              ) : (
                <>
                  <td style={td}>{b.name}</td>
                  <td style={td}>{b.from} → {b.to}</td>
                  <td style={td}>{b.driver || "—"}</td>
                  <td style={td}>{seatCounts(b).available}/{b.totalSeats} open</td>
                  <td style={td}>
                    <span style={{ color: seatCounts(b).faulty > 0 ? "#FFB86B" : C.subDark }}>
                      {seatCounts(b).online}/{b.totalSeats} online
                    </span>
                  </td>
                  <td style={td}>
                    <span style={{ padding: "3px 9px", borderRadius: 999, fontSize: 11,
                      background: b.status === "active" ? "#1E3A2A" : "#3A2A1E",
                      color: b.status === "active" ? "#4ADE80" : "#FFB86B" }}>{b.status}</span>
                  </td>
                  <td style={td}>
                    <button onClick={() => startEdit(b)} style={{ background: C.panel2, border: "none", borderRadius: 8, color: "#fff", padding: "6px 9px", cursor: "pointer" }}><Pencil size={13} /></button>
                    <button onClick={() => remove(b.id)} style={{ marginLeft: 6, background: "#3A1E1E", border: "none", borderRadius: 8, color: "#FF8787", padding: "6px 9px", cursor: "pointer" }}><Trash2 size={13} /></button>
                  </td>
                </>
              )}
            </tr>
          );
        })}
      </TableShell>
    </div>
  );
}

function RoutesTab({ routes, setRoutes, usingMock }) {
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [adding, setAdding] = useState(false);

  function startAdd() { setAdding(true); setDraft({ id: Date.now(), name: "", stopsText: "" }); }
  function startEdit(r) { setEditingId(r.id); setDraft({ id: r.id, name: r.name, stopsText: r.stops.join(", ") }); }

  async function save() {
    const stops = draft.stopsText.split(",").map((s) => s.trim()).filter(Boolean);

    if (adding) {
      if (!usingMock) {
        try {
          const created = withId(await api.createRoute({ name: draft.name, stops }));
          setRoutes((prev) => [...prev, created]);
        } catch (err) {
          alert(`Failed to create route: ${err.message}`);
        }
      } else {
        setRoutes((prev) => [...prev, { id: draft.id, name: draft.name, stops }]);
      }
      setAdding(false);
    } else {
      if (!usingMock) {
        try {
          const updated = withId(await api.updateRoute(editingId, { name: draft.name, stops }));
          setRoutes((prev) => prev.map((r) => (r.id !== editingId ? r : updated)));
        } catch (err) {
          alert(`Failed to update route: ${err.message}`);
        }
      } else {
        setRoutes((prev) => prev.map((r) => r.id !== editingId ? r : { id: r.id, name: draft.name, stops }));
      }
      setEditingId(null);
    }
    setDraft(null);
  }

  async function remove(id) {
    if (!usingMock) {
      try {
        await api.deleteRoute(id);
      } catch (err) {
        alert(`Failed to delete route: ${err.message}`);
        return;
      }
    }
    setRoutes((prev) => prev.filter((r) => r.id !== id));
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ color: "#fff", fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17 }}>Routes</div>
        <button onClick={startAdd} style={{ background: C.orange, border: "none", color: "#fff", borderRadius: 10,
          padding: "8px 14px", fontSize: 12.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <Plus size={15} /> Add route
        </button>
      </div>
      <TableShell headers={["Name", "Stops", "Actions"]}>
        {adding && (
          <tr>
            <td style={td}><InputSm placeholder="Route name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></td>
            <td style={td}><InputSm placeholder="Stop A, Stop B, Stop C" value={draft.stopsText} onChange={(e) => setDraft({ ...draft, stopsText: e.target.value })} /></td>
            <td style={td}>
              <button onClick={save} style={{ background: C.success, border: "none", borderRadius: 8, color: "#fff", padding: "6px 10px", cursor: "pointer" }}><Save size={13} /></button>
              <button onClick={() => { setAdding(false); setDraft(null); }} style={{ marginLeft: 6, background: C.panel2, border: "none", borderRadius: 8, color: "#fff", padding: "6px 10px", cursor: "pointer" }}><X size={13} /></button>
            </td>
          </tr>
        )}
        {routes.map((r) => {
          const isEditing = editingId === r.id;
          return (
            <tr key={r.id}>
              {isEditing ? (
                <>
                  <td style={td}><InputSm value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></td>
                  <td style={td}><InputSm value={draft.stopsText} onChange={(e) => setDraft({ ...draft, stopsText: e.target.value })} /></td>
                  <td style={td}>
                    <button onClick={save} style={{ background: C.success, border: "none", borderRadius: 8, color: "#fff", padding: "6px 10px", cursor: "pointer" }}><Save size={13} /></button>
                    <button onClick={() => { setEditingId(null); setDraft(null); }} style={{ marginLeft: 6, background: C.panel2, border: "none", borderRadius: 8, color: "#fff", padding: "6px 10px", cursor: "pointer" }}><X size={13} /></button>
                  </td>
                </>
              ) : (
                <>
                  <td style={td}>{r.name}</td>
                  <td style={td}>{r.stops.join(" → ")}</td>
                  <td style={td}>
                    <button onClick={() => startEdit(r)} style={{ background: C.panel2, border: "none", borderRadius: 8, color: "#fff", padding: "6px 9px", cursor: "pointer" }}><Pencil size={13} /></button>
                    <button onClick={() => remove(r.id)} style={{ marginLeft: 6, background: "#3A1E1E", border: "none", borderRadius: 8, color: "#FF8787", padding: "6px 9px", cursor: "pointer" }}><Trash2 size={13} /></button>
                  </td>
                </>
              )}
            </tr>
          );
        })}
      </TableShell>
    </div>
  );
}

function AdminsTab({ admins, setAdmins, buses, usingMock }) {
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [adding, setAdding] = useState(false);

  function startAdd() { setAdding(true); setDraft({ id: Date.now(), name: "", kioskId: "", busId: "" }); }
  function startEdit(a) { setEditingId(a.id); setDraft({ ...a }); }

  async function save() {
    const busId = draft.busId ? String(draft.busId) : null;

    if (adding) {
      if (!usingMock) {
        try {
          // default password for newly-created kiosk admins in the demo UI;
          // in production you'd prompt for this instead.
          const created = withId(await api.createAdmin({
            name: draft.name, kioskId: draft.kioskId, busId, password: "password123",
          }));
          setAdmins((prev) => [...prev, { ...created, busId: created.busId ? String(created.busId) : null }]);
        } catch (err) {
          alert(`Failed to create admin: ${err.message}`);
        }
      } else {
        setAdmins((prev) => [...prev, { ...draft, busId }]);
      }
      setAdding(false);
    } else {
      if (!usingMock) {
        try {
          const updated = withId(await api.updateAdmin(editingId, { name: draft.name, kioskId: draft.kioskId, busId }));
          setAdmins((prev) => prev.map((a) => (a.id !== editingId ? a : { ...updated, busId: updated.busId ? String(updated.busId) : null })));
        } catch (err) {
          alert(`Failed to update admin: ${err.message}`);
        }
      } else {
        setAdmins((prev) => prev.map((a) => a.id !== editingId ? a : { ...draft, busId }));
      }
      setEditingId(null);
    }
    setDraft(null);
  }

  async function remove(id) {
    if (!usingMock) {
      try {
        await api.deleteAdmin(id);
      } catch (err) {
        alert(`Failed to delete admin: ${err.message}`);
        return;
      }
    }
    setAdmins((prev) => prev.filter((a) => a.id !== id));
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ color: "#fff", fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17 }}>Kiosk admins</div>
        <button onClick={startAdd} style={{ background: C.orange, border: "none", color: "#fff", borderRadius: 10,
          padding: "8px 14px", fontSize: 12.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <Plus size={15} /> Add admin
        </button>
      </div>
      <TableShell headers={["Name", "Kiosk ID", "Assigned bus", "Actions"]}>
        {adding && (
          <tr>
            <td style={td}><InputSm value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></td>
            <td style={td}><InputSm value={draft.kioskId} onChange={(e) => setDraft({ ...draft, kioskId: e.target.value })} /></td>
            <td style={td}>
              <SelectSm value={draft.busId} onChange={(e) => setDraft({ ...draft, busId: e.target.value })}>
                <option value="">Unassigned</option>
                {buses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </SelectSm>
            </td>
            <td style={td}>
              <button onClick={save} style={{ background: C.success, border: "none", borderRadius: 8, color: "#fff", padding: "6px 10px", cursor: "pointer" }}><Save size={13} /></button>
              <button onClick={() => { setAdding(false); setDraft(null); }} style={{ marginLeft: 6, background: C.panel2, border: "none", borderRadius: 8, color: "#fff", padding: "6px 10px", cursor: "pointer" }}><X size={13} /></button>
            </td>
          </tr>
        )}
        {admins.map((a) => {
          const isEditing = editingId === a.id;
          const bus = buses.find((b) => b.id === a.busId);
          return (
            <tr key={a.id}>
              {isEditing ? (
                <>
                  <td style={td}><InputSm value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></td>
                  <td style={td}><InputSm value={draft.kioskId} onChange={(e) => setDraft({ ...draft, kioskId: e.target.value })} /></td>
                  <td style={td}>
                    <SelectSm value={draft.busId || ""} onChange={(e) => setDraft({ ...draft, busId: e.target.value })}>
                      <option value="">Unassigned</option>
                      {buses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </SelectSm>
                  </td>
                  <td style={td}>
                    <button onClick={save} style={{ background: C.success, border: "none", borderRadius: 8, color: "#fff", padding: "6px 10px", cursor: "pointer" }}><Save size={13} /></button>
                    <button onClick={() => { setEditingId(null); setDraft(null); }} style={{ marginLeft: 6, background: C.panel2, border: "none", borderRadius: 8, color: "#fff", padding: "6px 10px", cursor: "pointer" }}><X size={13} /></button>
                  </td>
                </>
              ) : (
                <>
                  <td style={td}>{a.name}</td>
                  <td style={td}>{a.kioskId}</td>
                  <td style={td}>{bus ? bus.name : "Unassigned"}</td>
                  <td style={td}>
                    <button onClick={() => startEdit(a)} style={{ background: C.panel2, border: "none", borderRadius: 8, color: "#fff", padding: "6px 9px", cursor: "pointer" }}><Pencil size={13} /></button>
                    <button onClick={() => remove(a.id)} style={{ marginLeft: 6, background: "#3A1E1E", border: "none", borderRadius: 8, color: "#FF8787", padding: "6px 9px", cursor: "pointer" }}><Trash2 size={13} /></button>
                  </td>
                </>
              )}
            </tr>
          );
        })}
      </TableShell>
    </div>
  );
}

function PassengersTab({ passengers }) {
  return (
    <div>
      <div style={{ color: "#fff", fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, marginBottom: 14 }}>Passengers</div>
      <TableShell headers={["Name", "Email", "Trips taken"]}>
        {passengers.map((p) => (
          <tr key={p.id}>
            <td style={td}>{p.name}</td>
            <td style={td}>{p.email}</td>
            <td style={td}>{p.trips}</td>
          </tr>
        ))}
      </TableShell>
    </div>
  );
}

function ReportsTab({ buses }) {
  const data = buses.map((b) => ({ name: b.name, booked: seatCounts(b).booked, available: seatCounts(b).available }));
  return (
    <div>
      <div style={{ color: "#fff", fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, marginBottom: 14 }}>Reports</div>
      <div style={{ background: C.panel, borderRadius: 16, padding: 18, height: 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.panel2} />
            <XAxis dataKey="name" stroke={C.subDark} fontSize={12} />
            <YAxis stroke={C.subDark} fontSize={12} />
            <Tooltip contentStyle={{ background: C.ink, border: `1px solid ${C.panel2}`, borderRadius: 8, color: "#fff" }} />
            <Bar dataKey="booked" fill={C.booked} radius={[6, 6, 0, 0]} name="Booked" />
            <Bar dataKey="available" fill={C.available} radius={[6, 6, 0, 0]} name="Available" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function PreviewTab({ admins, onPreviewPassenger, onPreviewKiosk }) {
  return (
    <div>
      <div style={{ color: "#fff", fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, marginBottom: 4 }}>App access</div>
      <div style={{ color: C.subDark, fontSize: 12.5, marginBottom: 18 }}>
        Only super admins can jump into these views. Passengers and kiosks never see this screen.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
        <RoleCard icon={<Smartphone />} title="Passenger app" desc="Preview the live map, seats and ticket flow."
          onClick={onPreviewPassenger} />
        {admins.map((a) => (
          <RoleCard key={a.id} icon={<Monitor />} title={`Kiosk · ${a.kioskId}`} desc={`Preview as ${a.name}`}
            onClick={() => onPreviewKiosk(a.id)} />
        ))}
      </div>
    </div>
  );
}

function SuperAdminApp({ shared, onLogout, onPreviewPassenger, onPreviewKiosk }) {
  const { buses, setBuses, routes, setRoutes, admins, setAdmins, passengers, usingMock } = shared;
  const [tab, setTab] = useState("overview");
  const tabs = [
    { id: "overview", label: "Overview", icon: <LayoutDashboard size={17} /> },
    { id: "buses", label: "Buses", icon: <Bus size={17} /> },
    { id: "routes", label: "Routes", icon: <RouteIcon size={17} /> },
    { id: "admins", label: "Kiosk admins", icon: <Monitor size={17} /> },
    { id: "passengers", label: "Passengers", icon: <Users size={17} /> },
    { id: "reports", label: "Reports", icon: <TrendingUp size={17} /> },
    { id: "preview", label: "App access", icon: <Eye size={17} /> },
  ];
  return (
    <div className="saShell" style={{ minHeight: "100vh", background: C.ink, fontFamily: FONT_BODY, display: "flex" }}>
      <div className="saSidebar" style={{ width: 230, borderRight: `1px solid ${C.panel2}`, padding: 16, display: "flex",
        flexDirection: "column", gap: 4, flexShrink: 0 }}>
        <div className="saLogo" style={{ padding: "6px 6px 18px" }}><Logo scale={0.5} /></div>
        {tabs.map((t) => (
          <SidebarItem key={t.id} icon={t.icon} label={t.label} active={tab === t.id} onClick={() => setTab(t.id)} />
        ))}
        <div className="saSpacer" style={{ flex: 1 }} />
        <button onClick={onLogout} style={{ display: "flex", alignItems: "center", gap: 12, background: "none",
          border: `1px solid ${C.panel2}`, color: C.subDark, borderRadius: 12, padding: "11px 14px", cursor: "pointer", fontSize: 13.5,
          whiteSpace: "nowrap", flexShrink: 0 }}>
          <LogOut size={16} /> Log out
        </button>
      </div>
      <div className="saContent" style={{ flex: 1, padding: 24, overflowX: "auto" }}>
        <div className="jj-fade" key={tab}>
          {tab === "overview" && <OverviewTab buses={buses} admins={admins} passengers={passengers} />}
          {tab === "buses" && <BusesTab buses={buses} setBuses={setBuses} routes={routes} admins={admins} usingMock={usingMock} />}
          {tab === "routes" && <RoutesTab routes={routes} setRoutes={setRoutes} usingMock={usingMock} />}
          {tab === "admins" && <AdminsTab admins={admins} setAdmins={setAdmins} buses={buses} usingMock={usingMock} />}
          {tab === "passengers" && <PassengersTab passengers={passengers} />}
          {tab === "reports" && <ReportsTab buses={buses} />}
          {tab === "preview" && <PreviewTab admins={admins} onPreviewPassenger={onPreviewPassenger} onPreviewKiosk={onPreviewKiosk} />}
        </div>
      </div>
    </div>
  );
}

/* ================================================================================
   ROLE SELECT / LOGIN
   ================================================================================ */

function RoleCard({ icon, title, desc, onClick }) {
  return (
    <button onClick={onClick} style={{ background: C.panel, border: `1px solid ${C.panel2}`, borderRadius: 20,
      padding: 22, textAlign: "left", cursor: "pointer", display: "flex", flexDirection: "column", gap: 12,
      width: "100%" }}>
      <IconBadge icon={icon} bg={C.orangeSoft} color={C.orangeDeep} size={22} />
      <div>
        <div style={{ color: "#fff", fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16 }}>{title}</div>
        <div style={{ color: C.subDark, fontSize: 12.5, marginTop: 4 }}>{desc}</div>
      </div>
      <div style={{ color: C.orange, fontSize: 12.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}>
        Continue <ChevronRight size={14} />
      </div>
    </button>
  );
}

function AuthInput({ label, ...props }) {
  return (
    <div>
      <div style={{ color: C.sub, fontSize: 11.5, marginBottom: 5, fontWeight: 600 }}>{label}</div>
      <input {...props} style={{ width: "100%", background: C.cream, border: `1px solid ${C.line}`,
        borderRadius: 10, padding: "10px 12px", fontSize: 13.5, color: C.text, fontFamily: FONT_BODY }} />
    </div>
  );
}

function PassengerAuthScreen({ onLogin, onRegister, onForgotPassword }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); setError(""); setNotice(""); }

  async function submitLogin() {
    if (!form.email || !form.password) { setError("Please enter your email and password."); return; }
    setBusy(true);
    const result = await onLogin(form.email, form.password);
    setBusy(false);
    if (result?.error) setError(result.error);
  }

  async function submitRegister() {
    if (!form.name || !form.email || !form.password) { setError("Please fill in all fields."); return; }
    if (form.password !== form.confirm) { setError("Passwords don't match."); return; }
    setBusy(true);
    const result = await onRegister({ name: form.name, email: form.email, password: form.password });
    setBusy(false);
    if (result?.error) setError(result.error);
    else { setNotice("Account created. Check your inbox and confirm your email before signing in."); setMode("login"); }
  }

  async function submitForgotPassword() {
    if (!form.email) { setError("Enter your email address first."); return; }
    setBusy(true);
    const result = await onForgotPassword(form.email);
    setBusy(false);
    if (result?.error) setError(result.error);
    else setNotice(result?.message || "If an account exists, a reset link has been sent.");
  }

  return (
    <div style={{ minHeight: "100vh", background: `linear-gradient(180deg, ${C.ink}, #0D0E1E)`, fontFamily: FONT_BODY,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 360 }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 22 }}><Logo scale={1.1} /></div>
        <div style={{ background: "#fff", borderRadius: 24, padding: 26 }}>
          {mode !== "forgot" && <div style={{ display: "flex", background: C.cream, borderRadius: 12, padding: 3, marginBottom: 20 }}>
            <button onClick={() => { setMode("login"); setError(""); }} style={{ flex: 1, padding: "9px 0", borderRadius: 9,
              border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700,
              background: mode === "login" ? C.orange : "transparent", color: mode === "login" ? "#fff" : C.sub }}>
              Log in
            </button>
            <button onClick={() => { setMode("register"); setError(""); }} style={{ flex: 1, padding: "9px 0", borderRadius: 9,
              border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700,
              background: mode === "register" ? C.orange : "transparent", color: mode === "register" ? "#fff" : C.sub }}>
              Register
            </button>
          </div>}

          {mode === "forgot" && <div style={{ fontWeight: 700, color: C.text, marginBottom: 14 }}>Reset your password</div>}

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {mode === "register" && (
              <AuthInput label="Full name" placeholder="Juan Dela Cruz" onChange={(e) => set("name", e.target.value)} />
            )}
            <AuthInput label="Email" type="email" placeholder="you@example.com" onChange={(e) => set("email", e.target.value)} />
            {mode !== "forgot" && <AuthInput label="Password" type="password" placeholder="At least 8 characters" onChange={(e) => set("password", e.target.value)} />}
            {mode === "register" && (
              <AuthInput label="Confirm password" type="password" placeholder="••••••••" onChange={(e) => set("confirm", e.target.value)} />
            )}
          </div>

          {error && <div style={{ marginTop: 10, fontSize: 12, color: C.booked }}>{error}</div>}
          {notice && <div role="status" style={{ marginTop: 10, fontSize: 12, color: C.success }}>{notice}</div>}

          <button onClick={mode === "login" ? submitLogin : mode === "register" ? submitRegister : submitForgotPassword} disabled={busy} style={{ width: "100%", marginTop: 18,
            background: C.orange, border: "none", color: "#fff", borderRadius: 12, padding: "13px 0",
            fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 14.5, cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.7 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            {mode === "login" ? <LogIn size={16} /> : mode === "register" ? <UserPlus size={16} /> : <Mail size={16} />}
            {busy ? "Please wait…" : mode === "login" ? "Log in" : mode === "register" ? "Create account" : "Send reset link"}
          </button>

          {mode === "login" && <button onClick={() => { setMode("forgot"); setError(""); setNotice(""); }} style={{ width: "100%", marginTop: 10,
            border: 0, background: "transparent", color: C.orangeDeep, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Forgot password?</button>}
          {mode === "forgot" && <button onClick={() => { setMode("login"); setError(""); setNotice(""); }} style={{ width: "100%", marginTop: 10,
            border: 0, background: "transparent", color: C.orangeDeep, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Back to sign in</button>}

          {mode === "login" && (
            <div style={{ marginTop: 12, fontSize: 11.5, color: C.sub, textAlign: "center" }}>
              Demo account: ana@example.com / demo1234
            </div>
          )}
        </div>


      </div>
    </div>
  );
}

function PassengerEmailAction({ type, onComplete }) {
  const params = new URLSearchParams(window.location.search);
  const token = params.get(type === "verify" ? "verify" : "reset") || "";
  const [busy, setBusy] = useState(type === "verify");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  useEffect(() => {
    if (type !== "verify") return;
    if (!token) { setError("This email confirmation link is missing its token."); setBusy(false); return; }
    api.passengerVerifyEmail(token).then((result) => setMessage(result.message))
      .catch((err) => setError(err.message)).finally(() => setBusy(false));
  }, [type, token]);

  async function submitReset() {
    setError("");
    if (password.length < 8) { setError("Choose a password with at least 8 characters."); return; }
    if (password !== confirm) { setError("The passwords do not match."); return; }
    setBusy(true);
    try { const result = await api.passengerResetPassword(token, password); setMessage(result.message); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ minHeight: "100vh", background: `linear-gradient(180deg, ${C.ink}, #0D0E1E)`, fontFamily: FONT_BODY,
      display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 380, background: "#fff", borderRadius: 24, padding: 26 }}>
        <div style={{ textAlign: "center", marginBottom: 18 }}><Logo scale={0.9} /></div>
        <h2 style={{ color: C.text, fontSize: 19, textAlign: "center" }}>{type === "verify" ? "Confirm your email" : "Choose a new password"}</h2>
        {type === "reset" && !message && <div style={{ display: "grid", gap: 12 }}>
          <AuthInput label="New password" type="password" placeholder="At least 8 characters" value={password} onChange={(e) => setPassword(e.target.value)} />
          <AuthInput label="Confirm new password" type="password" placeholder="Enter it again" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          <button disabled={busy} onClick={submitReset} style={{ background: C.orange, border: 0, color: "white", borderRadius: 12, padding: 13, fontWeight: 700 }}>
            {busy ? "Saving…" : "Save new password"}
          </button>
        </div>}
        {busy && type === "verify" && <p style={{ textAlign: "center", color: C.sub }}>Confirming your email…</p>}
        {message && <p role="status" style={{ textAlign: "center", color: C.success }}>{message}</p>}
        {error && <p role="alert" style={{ textAlign: "center", color: C.booked }}>{error}</p>}
        <button onClick={onComplete} style={{ width: "100%", marginTop: 14, background: C.cream, border: 0, color: C.text, borderRadius: 12, padding: 12, fontWeight: 700 }}>
          Back to sign in
        </button>
      </div>
    </div>
  );
}

function StaffLoginScreen({ admins, onKioskLogin, onSuperLogin, onBack }) {
  const [mode, setMode] = useState("kiosk");
  const [kioskId, setKioskId] = useState("");
  const [creds, setCreds] = useState({});

  return (
    <div style={{ minHeight: "100vh", background: C.ink, display: "flex", alignItems: "center",
      justifyContent: "center", fontFamily: FONT_BODY, padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 340, background: C.panel, borderRadius: 22, padding: 26 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", color: C.subDark, display: "flex",
          alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12.5, marginBottom: 16, padding: 0 }}>
          <ArrowLeft size={15} /> Back to passenger sign-in
        </button>
        <div style={{ marginBottom: 18 }}><Logo scale={0.55} /></div>

        <div style={{ display: "flex", background: C.ink, borderRadius: 10, padding: 3, marginBottom: 18 }}>
          <button onClick={() => setMode("kiosk")} style={{ flex: 1, padding: "8px 0", borderRadius: 8, border: "none",
            cursor: "pointer", fontSize: 12.5, fontWeight: 700,
            background: mode === "kiosk" ? C.orange : "transparent", color: "#fff" }}>
            Kiosk admin
          </button>
          <button onClick={() => setMode("super")} style={{ flex: 1, padding: "8px 0", borderRadius: 8, border: "none",
            cursor: "pointer", fontSize: 12.5, fontWeight: 700,
            background: mode === "super" ? C.orange : "transparent", color: "#fff" }}>
            Super admin
          </button>
        </div>

        {mode === "kiosk" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <div style={{ color: C.subDark, fontSize: 11.5, marginBottom: 5 }}>Kiosk account</div>
              <SelectSm onChange={(e) => setKioskId(e.target.value)}>
                <option value="">Select…</option>
                {admins.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.kioskId})</option>)}
              </SelectSm>
            </div>
            <button onClick={() => kioskId && onKioskLogin(kioskId)} disabled={!kioskId} style={{ marginTop: 6, width: "100%",
              background: kioskId ? C.orange : C.panel2, border: "none", color: "#fff", borderRadius: 12, padding: "12px 0",
              fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 14.5, cursor: kioskId ? "pointer" : "not-allowed" }}>
              Enter kiosk
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <div style={{ color: C.subDark, fontSize: 11.5, marginBottom: 5 }}>Email</div>
              <InputSm placeholder="admin@teleport-app.online" onChange={(e) => setCreds((c) => ({ ...c, email: e.target.value }))} />
            </div>
            <div>
              <div style={{ color: C.subDark, fontSize: 11.5, marginBottom: 5 }}>Password</div>
              <InputSm type="password" placeholder="••••••••" onChange={(e) => setCreds((c) => ({ ...c, password: e.target.value }))} />
            </div>
            <button onClick={onSuperLogin} style={{ marginTop: 6, width: "100%", background: C.orange, border: "none",
              color: "#fff", borderRadius: 12, padding: "12px 0", fontFamily: FONT_DISPLAY, fontWeight: 700,
              fontSize: 14.5, cursor: "pointer" }}>
              Enter dashboard
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ================================================================================
   APP ROOT
   ================================================================================ */

export default function App() {
  function showPassengerAuth() {
    setAuthScreen("passenger");
    const url = new URL(window.location.href);
    url.searchParams.delete("access");
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  }
  const hasTicketLink = new URLSearchParams(window.location.search).has("ticket");
  const [role, setRole] = useState(() => hasTicketLink ? "passenger" : null); // null | 'passenger' | 'admin' | 'super'
  const [authScreen, setAuthScreen] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("verify")) return "verify";
    if (params.has("reset")) return "reset";
    const access = params.get("access");
    return access === "staff" ? "staff" : access === "kiosk" ? "kiosk" : "passenger";
  });
  const [previewMode, setPreviewMode] = useState(false); // true when super admin opened a view from "App access"
  const [passengerName, setPassengerName] = useState(() => hasTicketLink ? "Passenger" : "");
  // Local-only fallback accounts, used only when the backend is unreachable
  // (usingMock === true) so login/register still work for a demo.
  const [passengerAccounts, setPassengerAccounts] = useState([
    { name: "Ana Reyes", email: "ana@example.com", password: "demo1234" },
  ]);

  const [buses, setBuses] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [admins, setAdmins] = useState([]);
  const [passengers, setPassengers] = useState([]);
  const [activity] = useState([
    { id: 1, busName: "Bus 1", seatId: 14, time: "Yesterday, 6:40 PM" },
    { id: 2, busName: "Bus 1", seatId: 9, time: "Mon, 8:05 AM" },
  ]);
  const [notifications, setNotifications] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [myTicket, setMyTicket] = useState(null);
  const [activeKioskAdmin, setActiveKioskAdmin] = useState(null);
  const [loading, setLoading] = useState(true);
  // true once we've confirmed the backend is unreachable and fallen back to
  // local, in-memory demo data instead (buses/tickets won't be saved).
  const [usingMock, setUsingMock] = useState(false);

  // ---- initial data load from the backend, with a mock-data fallback ----
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [busesRes, routesRes, adminsRes, passengersRes, notifsRes] = await Promise.all([
          api.getBuses(), api.getRoutes(), api.getAdmins(), api.getPassengers(), api.getNotifications(),
        ]);
        if (cancelled) return;
        setBuses(withIds(busesRes).map(normalizeBusLayout));
        setRoutes(withIds(routesRes));
        setAdmins(withIds(adminsRes).map((a) => ({ ...a, busId: a.busId ? String(a.busId) : null })));
        setPassengers(withIds(passengersRes));
        setNotifications(withIds(notifsRes).map((n) => ({ ...n, time: n.time || "recently" })));
        setUsingMock(false);
      } catch (err) {
        console.warn("[api] backend unreachable, falling back to local demo data:", err.message);
        if (cancelled) return;
        setBuses(seedBuses);
        setRoutes(seedRoutes);
        setAdmins(seedAdmins);
        setPassengers(seedPassengers);
        setNotifications(seedNotifications);
        setUsingMock(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // Keep hardware seat updates visible without reloading the dashboard.
  useEffect(() => {
    if (usingMock) return;
    let cancelled = false;
    const refreshBuses = async () => {
      try {
        const busesRes = await api.getBuses();
        if (!cancelled) setBuses(withIds(busesRes).map(normalizeBusLayout));
      } catch (err) {
        console.warn("[api] bus refresh failed:", err.message);
      }
    };
    const timer = setInterval(refreshBuses, 2000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [usingMock]);
  // Simulated seat-sensor feed — only runs when there's no real backend
  // connected. With a real backend, seat updates come from actual
  // Arduino/ESP32 sensors (or manual kiosk actions) via the API instead.
  useEffect(() => {
    if (!usingMock) return;
    const t = setInterval(() => {
      setBuses((prev) => prev.map((b) => {
        if (b.status !== "active") return b;
        const reporting = b.seats.filter((s) => s.sensor === "ok");
        if (reporting.length === 0) return b;
        const pick = reporting[Math.floor(Math.random() * reporting.length)];
        return {
          ...b,
          seats: b.seats.map((s) => s.id !== pick.id ? s : {
            ...s, status: s.status === "booked" ? "available" : "booked", updatedAt: Date.now(),
          }),
        };
      }));
    }, 2800);
    return () => clearInterval(t);
  }, [usingMock]);

  // Watch the passenger's scanned ticket and fire a notification once the
  // bus gets close to their drop-off stop.
  useEffect(() => {
    if (!myTicket || myTicket.notified) return;
    const bus = buses.find((b) => b.id === myTicket.busId);
    if (!bus) return;
    const target = (myTicket.dropoffIndex + 1) / myTicket.totalStops;
    if (bus.progress >= target - 0.18) {
      setNotifications((prev) => [{ id: Date.now(), title: `Approaching ${myTicket.dropoff}`,
        body: `${bus.name} is getting close to your drop-off stop. Get ready!`, time: "Just now" }, ...prev]);
      setMyTicket((prev) => prev && { ...prev, notified: true });
    }
  }, [buses, myTicket]);

  const shared = { buses, setBuses, routes, setRoutes, admins, setAdmins, passengers, setPassengers, activity,
    notifications, setNotifications, tickets, setTickets, myTicket, setMyTicket, usingMock };

  // ---- passenger login / register (public entry point) ----
  async function handlePassengerLogin(email, password) {
    if (!usingMock) {
      try {
        const account = withId(await api.passengerLogin(email, password));
        setPassengerName(account.name);
        setPreviewMode(false);
        setRole("passenger");
        return { ok: true };
      } catch (err) {
        return { error: err.message };
      }
    }

    const found = passengerAccounts.find((a) => a.email.toLowerCase() === email.toLowerCase() && a.password === password);
    if (!found) return { error: "No account matches that email and password. Try registering instead." };
    setPassengerName(found.name);
    setPreviewMode(false);
    setRole("passenger");
    return { ok: true };
  }

  async function handlePassengerRegister({ name, email, password }) {
    if (!usingMock) {
      try {
        const account = withId(await api.passengerSignup({ name, email, password }));
        setPassengers((prev) => [...prev, account]); // so it shows up in Super Admin > Passengers immediately
        return { ok: true };
      } catch (err) {
        return { error: err.message };
      }
    }

    return { error: "Email confirmation needs the backend and email service to be configured. Please try again when the server is online." };
  }
  async function handlePassengerForgotPassword(email) {
    if (usingMock) return { error: "Password reset needs the backend and email service to be configured." };
    try { return await api.passengerForgotPassword(email); }
    catch (err) { return { error: err.message }; }
  }
  function finishPassengerEmailAction() {
    setAuthScreen("passenger");
    const url = new URL(window.location.href);
    ["verify", "reset", "email"].forEach((key) => url.searchParams.delete(key));
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  }
  function handlePassengerLogout() {
    setRole(null);
    setAuthScreen("passenger");
  }

  // ---- staff sign-in (kiosk operators + super admin), never shown to passengers ----
  function handleKioskLogin(kioskIdValue) {
    const found = admins.find((a) => String(a.id) === String(kioskIdValue));
    if (!found) return;
    setActiveKioskAdmin(found);
    setPreviewMode(false);
    setRole("admin");
  }
  function handleSuperLogin() {
    setPreviewMode(false);
    setRole("super");
  }
  function handleKioskLogout() {
    setActiveKioskAdmin(null);
    if (previewMode) { setPreviewMode(false); setRole("super"); }
    else { setRole(null); showPassengerAuth(); }
  }
  function handleSuperLogout() {
    setRole(null);
    setAuthScreen("staff");
  }

  // ---- super admin "App access" preview — the only place the role choices live ----
  function handlePreviewPassenger() {
    setPreviewMode(true);
    setRole("passenger");
  }
  function handlePreviewKiosk(adminId) {
    const found = admins.find((a) => String(a.id) === String(adminId));
    if (!found) return;
    setActiveKioskAdmin(found);
    setPreviewMode(true);
    setRole("admin");
  }
  function handlePassengerExitPreview() {
    setPreviewMode(false);
    setRole("super");
  }

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: C.ink, display: "flex", alignItems: "center",
        justifyContent: "center", fontFamily: FONT_BODY, color: "#fff", flexDirection: "column", gap: 14 }}>
        <Logo scale={0.9} />
        <div style={{ color: C.subDark, fontSize: 13 }}>Loading…</div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh" }}>
      <GlobalStyle />

      {usingMock && (
        <div style={{ background: "#3A2A1E", color: "#FFB86B", fontSize: 11.5, fontWeight: 700,
          textAlign: "center", padding: "6px 10px" }}>
          ⚠ Backend not reachable — running on local demo data only (nothing will be saved).
        </div>
      )}

      {role === null && authScreen === "passenger" && (
        <PassengerAuthScreen onLogin={handlePassengerLogin} onRegister={handlePassengerRegister}
          onForgotPassword={handlePassengerForgotPassword} />
      )}
      {role === null && (authScreen === "verify" || authScreen === "reset") && (
        <PassengerEmailAction type={authScreen} onComplete={finishPassengerEmailAction} />
      )}

      {role === null && authScreen === "kiosk" && admins[0] && (
        <KioskAdminApp shared={shared} kioskAdmin={admins[0]} publicKiosk onLogout={showPassengerAuth} previewMode={false} />
      )}
      {role === null && authScreen === "staff" && (
        <StaffLoginScreen admins={admins} onBack={showPassengerAuth}
          onKioskLogin={handleKioskLogin} onSuperLogin={handleSuperLogin} />
      )}

      {role === "passenger" && (
        <PassengerApp shared={shared} passengerName={passengerName} previewMode={previewMode}
          onLogout={previewMode ? handlePassengerExitPreview : handlePassengerLogout} />
      )}

      {role === "admin" && activeKioskAdmin && (
        <KioskAdminApp shared={shared} kioskAdmin={activeKioskAdmin} previewMode={previewMode} onLogout={handleKioskLogout} />
      )}

      {role === "super" && (
        <SuperAdminApp shared={shared} onLogout={handleSuperLogout}
          onPreviewPassenger={handlePreviewPassenger} onPreviewKiosk={handlePreviewKiosk} />
      )}
    </div>
  );
}
