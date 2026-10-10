import React, { useState, useEffect, useRef } from "react";
import QRCode from "qrcode";
import {
  Home,
  ClipboardList,
  Ticket as TicketIcon,
  MapPin,
  User,
  Monitor,
  LayoutDashboard,
  Settings,
  BookOpen,
  Route,
  Bell,
  Armchair,
  ChevronRight,
  ArrowLeft,
  LogIn,
  UserPlus,
  Mail,
  LogOut,
  Smartphone,
  Shield,
  CheckCircle2,
  Bus,
} from "lucide-react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { api, request } from "./api.js";
import { FARE_MATRIX, fareDirectionForRoute } from "../../shared/fareMatrix.js";
import { gpsOnline, haversineMeters } from "../../shared/proximity.js";
import { seatAvailability } from "../../shared/nearbyAlerts.js";
import { useNearbyBusAlerts } from "./useNearbyBusAlerts.js";
import { destinationProgress } from "../../shared/destinationProgress.js";
import {
  canUseSeat,
  isPrioritySeat,
  kioskSeatLayout,
  isSeatMonitored,
} from "../../shared/seatPolicy.js";
import "./portal.css";

const call = (path, data, method = "POST") =>
  request(path, { method, body: JSON.stringify(data) });
const date = (value) =>
  value
    ? new Date(value).toLocaleString("en-PH", {
        timeZone: "Asia/Manila",
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Not provided";
const day = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(
    new Date(),
  );
function installedApp() {
  return (
    matchMedia("(display-mode: standalone)").matches ||
    matchMedia("(display-mode: fullscreen)").matches ||
    navigator.standalone === true
  );
}

async function prepareProfilePhoto(file) {
  if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error("Choose a JPG, PNG, or WebP photo.");
  if (file.size > 10 * 1024 * 1024)
    throw new Error("Choose a photo smaller than 10 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 160;
    const context = canvas.getContext("2d");
    context.fillStyle = "#f7f2e9";
    context.fillRect(0, 0, 160, 160);
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    context.drawImage(
      image,
      (image.naturalWidth - side) / 2,
      (image.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      160,
      160,
    );
    const photo = canvas.toDataURL("image/jpeg", 0.7);
    if (photo.length > 24000)
      throw new Error("This photo is too detailed. Choose a simpler image.");
    return photo;
  } finally {
    URL.revokeObjectURL(url);
  }
}
const categories = {
  regular: "Regular Passenger",
  student: "Student",
  pwd: "PWD",
  senior: "Senior Citizen",
};
const markerIcon = L.divIcon({
  className: "bus-marker",
  html: "●",
  iconSize: [22, 22],
});
function MessagePopup({ message, error, dismiss }) {
  const dialog = useRef(null);
  const titleId = React.useId();
  const messageId = React.useId();
  useEffect(() => {
    dialog.current.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="message-popup"
      aria-labelledby={titleId}
      aria-describedby={messageId}
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
    >
      <h2 id={titleId}>{error ? "Please try again" : "Notification"}</h2>
      <p id={messageId}>{message}</p>
      <button type="button" autoFocus onClick={dismiss}>
        OK
      </button>
    </dialog>
  );
}
function Field({ label, children, ...props }) {
  const id = React.useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children ? (
        React.cloneElement(children, { id })
      ) : (
        <input id={id} {...props} />
      )}
    </div>
  );
}
function Empty({ children }) {
  return <p className="empty">{children}</p>;
}
function Pill({ children }) {
  return <span className="pill">{children}</span>;
}
function Logo() {
  return (
    <span className="original-logo">
      <img src="/jasper-jean-bus.png" alt="Jasper Jean bus" />
      <strong>TELE-PORT</strong>
    </span>
  );
}
function KioskLanding({ begin }) {
  return (
    <main className="kiosk-landing" aria-label="TELE-PORT kiosk welcome">
      <div className="kiosk-landing-copy">
        <h1>TELE-PORT</h1>
        <span className="kiosk-landing-underline" aria-hidden="true" />
        <p>BUS SERVICES</p>
        <button className="kiosk-begin" onClick={begin}>
          <TicketIcon aria-hidden="true" />
          <span>TOUCH SCREEN TO BEGIN</span>
        </button>
      </div>
    </main>
  );
}
function NavigationIcon({ page }) {
  const Icon =
    {
      Dashboard: Home,
      "Trip Schedule": Route,
      "My Bookings": ClipboardList,
      Tickets: TicketIcon,
      "Bus Tracking": MapPin,
      "Activity History": ClipboardList,
      Account: User,
      Notifications: Bell,
      Kiosk: Monitor,
      Management: LayoutDashboard,
      Settings,
      "User Guide": BookOpen,
    }[page] || Home;
  return <Icon size={19} aria-hidden="true" />;
}
function TravelWelcome({ name, navigate }) {
  return (
    <>
      <section className="passengerHero">
        <div className="passengerHeroCopy">
          <div>Good day,</div>
          <div className="passengerHeroTitle">{name || "Passenger"}!</div>
          <p>Here’s what’s happening with your bus and travel today.</p>
        </div>
        <img src="/jasper-jean-bus.png" alt="Jasper Jean bus" />
      </section>
      <div className="homeCardGrid">
        {[
          [MapPin, "MAPS", "View the live route", "Bus Tracking", "maps"],
          [
            Bus,
            "SEAT AVAILABILITY",
            "Live count straight from seat sensors",
            "Seat Availability",
            "seats",
          ],
          [
            TicketIcon,
            "MY TICKET",
            "Scan the QR code from your kiosk ticket",
            "Tickets",
            "tickets",
          ],
          [
            Route,
            "TRIP SCHEDULE",
            "View routes and stop times",
            "Trip Schedule",
            "schedule",
          ],
        ].map(([Icon, title, subtitle, target, tone]) => (
          <button
            className="homeCard"
            key={title}
            onClick={() => navigate(target)}
          >
            <span className={`homeCardIcon ${tone}`}>
              <Icon size={22} />
            </span>
            <span className="homeCardCopy">
              <strong>{title}</strong>
              <small>{subtitle}</small>
            </span>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        ))}
      </div>
      <button
        className="stay-updated"
        onClick={() => navigate("Notifications")}
      >
        <span className="homeCardIcon">
          <Bell size={21} />
        </span>
        <span className="homeCardCopy">
          <strong>Stay updated</strong>
          <small>See bus arrival and route notifications.</small>
        </span>
        <span>View ›</span>
      </button>
    </>
  );
}
function MapClick({ setPoint }) {
  useMapEvents({
    click: (e) => setPoint({ lat: e.latlng.lat, lon: e.latlng.lng }),
  });
  return null;
}
const kioskRouteCache = new Map();
function FitKioskRoute({ points }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 1) map.fitBounds(points, { padding: [24, 24] });
  }, [map, points]);
  return null;
}
function useRoadRoute(from, to) {
  const [route, setRoute] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!from || !to) {
      setRoute(null);
      setError("");
      return;
    }
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    setRoute(null);
    setError("");
    const load = async () => {
      const key = `${from}|${to}`;
      if (kioskRouteCache.has(key)) return kioskRouteCache.get(key);
      const stops = [];
      for (const name of [from, to]) {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=ph&q=${encodeURIComponent(name + ", Philippines")}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error("Route unavailable");
        const results = await response.json();
        if (!results.length) throw new Error("Route unavailable");
        stops.push([Number(results[0].lat), Number(results[0].lon)]);
      }
      const response = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${stops.map(([lat, lon]) => `${lon},${lat}`).join(";")}?overview=full&geometries=geojson`,
        { signal: controller.signal },
      );
      if (!response.ok) throw new Error("Route unavailable");
      const data = await response.json();
      const coordinates = data.routes?.[0]?.geometry?.coordinates;
      if (!coordinates?.length) throw new Error("Route unavailable");
      const result = {
        stops,
        points: coordinates.map(([lon, lat]) => [lat, lon]),
      };
      kioskRouteCache.set(key, result);
      return result;
    };
    load()
      .then((result) => active && setRoute(result))
      .catch(() => {
        if (active)
          setError(
            "Route preview unavailable. You can still choose a fare point.",
          );
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timeout);
    };
  }, [from, to]);
  return { route, error };
}
function KioskRouteMap({ from, to }) {
  const { route, error } = useRoadRoute(from, to);
  return (
    <div aria-label="Bus route preview">
      <p className="kiosk-map-hint">
        {from} → {to} · Route preview
      </p>
      <MapContainer center={[14.4, 120.97]} zoom={11} className="tracking-map">
        <TileLayer
          attribution="© OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {route && (
          <>
            <FitKioskRoute points={route.points} />
            <Polyline
              positions={route.points}
              pathOptions={{ color: "#c96a2b", weight: 5 }}
            />
            {route.stops.map((position, index) => (
              <Marker key={index} position={position} icon={markerIcon}>
                <Popup>{index ? to : from}</Popup>
              </Marker>
            ))}
          </>
        )}
      </MapContainer>
      {!route && <p role="status">{error || "Loading route preview…"}</p>}
    </div>
  );
}
function Dropoff({ point, setPoint, compact = false }) {
  const CoordinateFields = compact ? "details" : "div";
  const validPoint =
    Number.isFinite(point?.lat) &&
    Number.isFinite(point?.lon) &&
    Math.abs(point.lat) <= 90 &&
    Math.abs(point.lon) <= 180;
  return (
    <div>
      <p className={compact ? "kiosk-map-hint" : undefined}>
        {compact
          ? "Tap the map to set your exact drop-off location."
          : "Choose your actual drop-off pin for the onboard destination alert. This pin is separate from the bus GPS location."}
      </p>
      <MapContainer
        center={validPoint ? [point.lat, point.lon] : [14.3, 120.95]}
        zoom={12}
        className="tracking-map"
      >
        <TileLayer
          attribution="© OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapClick setPoint={setPoint} />
        {validPoint && (
          <Marker position={[point.lat, point.lon]} icon={markerIcon} />
        )}
      </MapContainer>
      <CoordinateFields
        className={compact ? "kiosk-coordinate-entry" : "filters"}
      >
        {compact && <summary>Enter coordinates</summary>}
        <Field
          label="Drop-off latitude"
          type="number"
          step="any"
          min="-90"
          max="90"
          value={point?.lat ?? ""}
          onChange={(e) =>
            setPoint({
              ...point,
              lat: e.target.value === "" ? null : Number(e.target.value),
            })
          }
        />
        <Field
          label="Drop-off longitude"
          type="number"
          step="any"
          min="-180"
          max="180"
          value={point?.lon ?? ""}
          onChange={(e) =>
            setPoint({
              ...point,
              lon: e.target.value === "" ? null : Number(e.target.value),
            })
          }
        />
      </CoordinateFields>
    </div>
  );
}
function QR({ value }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true;
    QRCode.toDataURL(value, {
      width: 240,
      margin: 2,
      errorCorrectionLevel: "M",
    }).then((u) => active && setUrl(u));
    return () => {
      active = false;
    };
  }, [value]);
  return url ? (
    <img className="qr" src={url} alt="Ticket verification QR code" />
  ) : (
    <p>Preparing QR code…</p>
  );
}

export default function Portal() {
  const staffPage = /^\/staff(?:\/|$)/.test(location.pathname);
  const kiosk =
    /^\/kiosk(?:\/|$)/.test(location.pathname) ||
    new URLSearchParams(location.search).get("mode") === "kiosk";
  const entryPath = kiosk ? "/kiosk/" : staffPage ? "/staff/" : "/";
  const [kioskStarted, setKioskStarted] = useState(false);
  const [session, setSession] = useState(null),
    [ready, setReady] = useState(false),
    [page, setPage] = useState(kiosk ? "Kiosk" : "Sign in");
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [ticket, setTicket] = useState(null),
    [refresh, setRefresh] = useState(0);
  const bootstrapped = useRef(false);
  const [theme, setTheme] = useState(
      () => localStorage.getItem(kiosk ? "kiosk-theme" : "theme") || "light",
    ),
    [install, setInstall] = useState(null),
    [appInstalled, setAppInstalled] = useState(
      () =>
        installedApp() ||
        localStorage.getItem("tele-port-installed") === "true",
    ),
    [notifications, setNotifications] = useState([]),
    [online, setOnline] = useState(navigator.onLine);
  const staff = ["staff", "admin"].includes(session?.role),
    admin = session?.role === "admin";
  const passengerUI = !kiosk && !staffPage;
  const nearbyAlerts = useNearbyBusAlerts(
    passengerUI && session?.role === "passenger",
    session?.user?._id || session?.user?.id,
  );
  useEffect(() => {
    document.title = kiosk
      ? "TELE-PORT · Kiosk"
      : staffPage
        ? "TELE-PORT · Staff"
        : "TELE-PORT";
  }, [kiosk, staffPage]);
  const run = async (fn) => {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      return await fn();
    } catch (e) {
      if (e.status === 401 && session) {
        setSession(null);
        setTicket(null);
        setPage(kiosk ? "Kiosk" : "Sign in");
      }
      setError(
        e.name === "TimeoutError"
          ? "The server took too long. Check your connection and try again."
          : e.message,
      );
      return null;
    } finally {
      setBusy(false);
    }
  };
  const changed = () => setRefresh((v) => v + 1);
  const loadSession = async () => {
    const s = await request("/session");
    const matchesPage =
      s.user &&
      (kiosk ||
        (staffPage
          ? ["staff", "admin"].includes(s.role)
          : s.role === "passenger"));
    setSession(matchesPage ? s : null);
    return s;
  };
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    run(async () => {
      const current = await loadSession();
      if (
        !kiosk &&
        current.user &&
        (staffPage
          ? ["staff", "admin"].includes(current.role)
          : current.role === "passenger")
      )
        setPage(staffPage ? "Trip Schedule" : "Dashboard");
      const params = new URLSearchParams(location.search);
      const token = params.get("verify");
      if (token) {
        await api.passengerVerifyEmail(token);
        setNotice("Email verified. You can sign in.");
        history.replaceState(null, "", "/");
      }
      if (params.get("reset")) setPage("Reset password");
      const reference = params.get("ticket");
      if (reference && !kiosk) {
        if (current.role !== "passenger" || !current.user) {
          setNotice(
            "Sign in, then scan your kiosk ticket to connect it to your account.",
          );
          return;
        }
        const t = await call("/connect-ticket", { reference });
        setTicket(t);
        history.replaceState(null, "", entryPath);
      }
    }).finally(() => setReady(true));
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(kiosk ? "kiosk-theme" : "theme", theme);
  }, [theme]);
  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setInstall(e);
      setAppInstalled(false);
      localStorage.removeItem("tele-port-installed");
    };
    const markInstalled = () => {
      setInstall(null);
      setAppInstalled(true);
      localStorage.setItem("tele-port-installed", "true");
    };
    const displayMode = matchMedia("(display-mode: standalone)");
    const checkDisplayMode = () => {
      if (installedApp()) markInstalled();
    };
    checkDisplayMode();
    addEventListener("appinstalled", markInstalled);
    displayMode.addEventListener("change", checkDisplayMode);
    const update = () => setOnline(navigator.onLine);
    addEventListener("beforeinstallprompt", handler);
    addEventListener("online", update);
    addEventListener("offline", update);
    return () => {
      removeEventListener("beforeinstallprompt", handler);
      removeEventListener("appinstalled", markInstalled);
      displayMode.removeEventListener("change", checkDisplayMode);
      removeEventListener("online", update);
      removeEventListener("offline", update);
    };
  }, []);
  useEffect(() => {
    if (!session) {
      setNotifications([]);
      return;
    }
    let live = true;
    const poll = () =>
      api
        .getNotifications()
        .then((n) => live && setNotifications(n))
        .catch((e) => {
          if (live && e.status === 401) {
            setSession(null);
            setTicket(null);
            setPage(kiosk ? "Kiosk" : "Sign in");
            setError(
              "Your session has expired or was not saved. Please sign in again.",
            );
          }
        });
    poll();
    const timer = setInterval(poll, 15000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [session, refresh]);
  const navigate = (p) => {
    if (staffPage && p === "Kiosk") {
      location.assign("/kiosk/");
      return;
    }
    setPage(p);
    setTicket(null);
    setError("");
    setNotice("");
    if (kiosk && p === "Kiosk") setKioskStarted(false);
  };
  const logout = () =>
    run(async () => {
      await call("/logout", {});
      setSession(null);
      navigate(kiosk ? "Kiosk" : "Sign in");
    });
  const passengerNav = [
    ["Dashboard", "Home"],
    ["Activity History", "Activity"],
    ["Notifications", "Notification"],
    ["Account", "Profile"],
  ];
  const activePassengerPage = [
    "Activity History",
    "Notifications",
    "Account",
  ].includes(page)
    ? page
    : ["Settings", "User Guide", "My Bookings"].includes(page)
      ? "Account"
      : "Dashboard";
  useEffect(() => {
    if (!ticket || !(kiosk || page === "Kiosk")) return;
    const timer = setTimeout(() => {
      setTicket(null);
      setPage("Kiosk");
      setKioskStarted(false);
      setNotice("Kiosk returned home after inactivity.");
    }, 90000);
    return () => clearTimeout(timer);
  }, [ticket, kiosk, page]);
  const nav = staffPage
    ? [
        "Trip Schedule",
        "Tickets",
        "Bus Tracking",
        "Activity History",
        ...(admin ? ["Management"] : []),
      ]
    : [
        "Dashboard",
        "Trip Schedule",
        ...(session
          ? [
              "My Bookings",
              "Tickets",
              "Bus Tracking",
              "Activity History",
              "Account",
            ]
          : []),
        ...(staff ? ["Kiosk", "Management"] : []),
        "Settings",
        "User Guide",
      ];
  if (kiosk && !kioskStarted) {
    return (
      <KioskLanding
        begin={() => {
          setKioskStarted(true);
          setPage("Kiosk");
          if (
            !document.fullscreenElement &&
            document.documentElement.requestFullscreen
          ) {
            document.documentElement.requestFullscreen().catch(() => {});
          }
        }}
      />
    );
  }
  return (
    <div
      className={`${kiosk ? "portal kiosk" : "portal"}${staffPage ? " staff-portal" : ""}${passengerUI ? " passenger-app" : ""}${page === "Sign in" || page === "Reset password" ? " auth-page" : ""}`}
    >
      <header>
        {passengerUI &&
        [
          "Bus Tracking",
          "Seat Availability",
          "Trip Schedule",
          "Tickets",
          "My Bookings",
          "Settings",
          "User Guide",
        ].includes(page) ? (
          <div className="passenger-page-heading">
            <button
              type="button"
              aria-label="Back to home"
              onClick={() => navigate("Dashboard")}
            >
              <ArrowLeft size={24} aria-hidden="true" />
              <span className="passenger-back-label">Back</span>
            </button>
            <strong>{page === "Bus Tracking" ? "Live map" : page}</strong>
          </div>
        ) : (
          <a className="brand" href={entryPath}>
            <Logo />
          </a>
        )}
        <div
          className={`header-actions${passengerUI ? " passenger-header-actions" : ""}`}
        >
          <button
            onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            aria-label="Change color theme"
          >
            {theme === "light" ? "Dark Mode" : "Light Mode"}
          </button>
          {session ? (
            <button disabled={busy} onClick={logout}>
              Sign out
            </button>
          ) : kiosk ? (
            <a href="/staff/">Staff console</a>
          ) : (
            <button onClick={() => navigate("Sign in")}>Sign in</button>
          )}
          {kiosk && session && <a href="/staff/">Staff console</a>}
        </div>
      </header>
      <nav aria-label="Main navigation">
        <a className="sidebar-brand" href={entryPath}>
          <Logo />
        </a>
        {passengerUI
          ? passengerNav.map(([target, label]) => (
              <button
                key={target}
                aria-current={
                  activePassengerPage === target ? "page" : undefined
                }
                onClick={() => navigate(target)}
              >
                <NavigationIcon page={target} />
                <span>{label}</span>
              </button>
            ))
          : (kiosk
              ? ["Kiosk", "Trip Schedule", "Settings", "User Guide"]
              : nav
            ).map((p) => (
              <button
                key={p}
                aria-current={page === p ? "page" : undefined}
                onClick={() => navigate(p)}
              >
                <NavigationIcon page={p} />
                <span>{p}</span>
              </button>
            ))}
      </nav>
      <main>
        {passengerUI && session?.role === "passenger" && (
          <DestinationJourney
            feed={nearbyAlerts}
            visible={["Dashboard", "Bus Tracking", "Notifications"].includes(
              page,
            )}
            openTickets={() => navigate("Tickets")}
          />
        )}
        {passengerUI && nearbyAlerts.alerts[0] && page !== "Notifications" && (
          <div
            className="alert nearby-arrival-alert"
            role="status"
            aria-live="polite"
          >
            <Bell size={20} />
            <div>
              <strong>{nearbyAlerts.alerts[0].title}</strong>
              <p>{nearbyAlerts.alerts[0].body}</p>
            </div>
            <button onClick={() => navigate("Notifications")}>
              View alerts
            </button>
          </div>
        )}
        {!online && (
          <div className="alert" role="status">
            You are offline. Booking, ticket verification, schedules and
            tracking require a connection.
          </div>
        )}
        {(error || notice) && (
          <MessagePopup
            message={error || notice}
            error={Boolean(error)}
            dismiss={() => (error ? setError("") : setNotice(""))}
          />
        )}
        {busy && !["Sign in", "Reset password"].includes(page) && (
          <div className="loading" role="status">
            Working…
          </div>
        )}
        {!ready ? (
          <Empty>Connecting to the reservation server…</Empty>
        ) : (
          <>
            {ticket ? (
              <Ticket
                ticket={ticket}
                staff={staff}
                kiosk={kiosk || page === "Kiosk"}
                run={run}
                notify={setNotice}
                close={() => {
                  setTicket(null);
                  setError("");
                  setNotice("");
                  changed();
                  if (kiosk) {
                    setPage("Kiosk");
                    setKioskStarted(false);
                  }
                }}
                changed={changed}
              />
            ) : (
              <>
                {page === "Dashboard" && (
                  <TravelWelcome
                    name={session?.user?.name}
                    navigate={navigate}
                  />
                )}
                {(page === "Trip Schedule" ||
                  (page === "Dashboard" && !passengerUI)) &&
                  !staffPage && (
                    <Schedules session={session} refresh={refresh} run={run} />
                  )}
                {page === "Trip Schedule" && staffPage && staff && (
                  <Management
                    admin={false}
                    schedulesOnly
                    run={run}
                    notify={setNotice}
                    refresh={refresh}
                    changed={changed}
                  />
                )}
                {page === "Dashboard" && !passengerUI && (
                  <>
                    <h2>Your travel overview</h2>
                    {session ? (
                      <Bookings
                        summary
                        session={session}
                        refresh={refresh}
                        run={run}
                        open={setTicket}
                      />
                    ) : (
                      <Empty>
                        Sign in with your passenger account to view your
                        reservations.
                      </Empty>
                    )}
                    {notifications.length > 0 && (
                      <section>
                        <h2>Notifications</h2>
                        {notifications.slice(0, 8).map((n) => (
                          <article key={n._id}>
                            <p>{n.body || n.message}</p>
                            <small>{date(n.createdAt)}</small>
                          </article>
                        ))}
                      </section>
                    )}
                  </>
                )}
                {(page === "My Bookings" || page === "Tickets") && (
                  <>
                    {passengerUI && (
                      <TicketScanner
                        session={session}
                        run={run}
                        connected={(t) => {
                          setTicket(t);
                          changed();
                        }}
                      />
                    )}
                    <Bookings
                      session={session}
                      refresh={refresh}
                      run={run}
                      open={setTicket}
                    />
                  </>
                )}
                {page === "Kiosk" && (
                  <Kiosk run={run} open={setTicket} navigate={navigate} />
                )}
                {(page === "Sign in" || page === "Reset password") && (
                  <Auth
                    staffOnly={staffPage}
                    reset={page === "Reset password"}
                    run={run}
                    notify={setNotice}
                    loggedIn={async () => {
                      const s = await loadSession();
                      if (!s.user) {
                        throw new Error(
                          "Your browser did not save the sign-in session. The website must use its /api proxy; please try again after redeployment.",
                        );
                      }
                      const reference = new URLSearchParams(
                        location.search,
                      ).get("ticket");
                      if (s.role === "passenger" && reference) {
                        const connected = await call("/connect-ticket", {
                          reference,
                        });
                        setTicket(connected);
                        changed();
                        history.replaceState(null, "", entryPath);
                      }
                      navigate(
                        s.role === "passenger" ? "Dashboard" : "Trip Schedule",
                      );
                    }}
                  />
                )}
                {page === "Account" && (
                  <>
                    {passengerUI && (
                      <PassengerProfile
                        session={session}
                        navigate={navigate}
                        logout={logout}
                        busy={busy}
                        install={install}
                        appInstalled={appInstalled}
                        installed={() => setInstall(null)}
                      />
                    )}
                    {!passengerUI && (
                      <details
                        className={
                          passengerUI ? "profile-edit" : "staff-account"
                        }
                        open={!passengerUI}
                      >
                        <summary>Edit account details</summary>
                        <Account
                          session={session}
                          run={run}
                          saved={async () => {
                            await loadSession();
                            setNotice(
                              "Account updated. Discount categories require staff verification.",
                            );
                          }}
                        />
                      </details>
                    )}
                  </>
                )}
                {page === "Activity History" && (
                  <Activity
                    run={run}
                    refresh={refresh}
                    passenger={passengerUI}
                  />
                )}
                {page === "Bus Tracking" && (
                  <Tracking
                    run={run}
                    refresh={refresh}
                    passenger={passengerUI}
                    nearby={nearbyAlerts}
                  />
                )}
                {page === "Seat Availability" && <PassengerSeats run={run} />}
                {page === "Notifications" && (
                  <PassengerNotifications
                    notifications={[...nearbyAlerts.alerts, ...notifications]}
                  />
                )}
                {page === "Management" && admin && (
                  <Management
                    admin={admin}
                    run={run}
                    notify={setNotice}
                    refresh={refresh}
                    changed={changed}
                  />
                )}
                {page === "Settings" && (
                  <section>
                    <h1>Settings</h1>
                    {passengerUI && session?.role === "passenger" && (
                      <>
                        <ProfilePhotoSettings
                          user={session.user}
                          busy={busy}
                          savePhoto={(photo) =>
                            run(async () => {
                              await call(
                                `/passengers/${session.user._id}`,
                                { profilePhoto: photo },
                                "PATCH",
                              );
                              await loadSession();
                              setNotice("Profile photo updated.");
                            })
                          }
                          photoError={setError}
                        />
                        <details className="profile-edit" open>
                          <summary>Edit account details</summary>
                          <Account
                            session={session}
                            run={run}
                            saved={async () => {
                              await loadSession();
                              setNotice(
                                "Account updated. Discount categories require staff verification.",
                              );
                            }}
                          />
                        </details>
                      </>
                    )}
                    <Field label="Color theme">
                      <select
                        value={theme}
                        onChange={(e) => setTheme(e.target.value)}
                      >
                        <option value="light">Light Mode</option>
                        <option value="dark">Dark Mode</option>
                      </select>
                    </Field>
                    {!appInstalled &&
                      (install ? (
                        <button
                          onClick={async () => {
                            await install.prompt();
                            setInstall(null);
                          }}
                        >
                          Install passenger app
                        </button>
                      ) : (
                        <p>
                          To install on a supported mobile browser, select
                          “Install app” or “Add to Home Screen” from its menu.
                          Installation requires HTTPS. Reservations and tracking
                          need an internet connection.
                        </p>
                      ))}
                    {kiosk && (
                      <button
                        onClick={() =>
                          run(async () => {
                            if (!document.fullscreenElement)
                              await document.documentElement.requestFullscreen();
                            else await document.exitFullscreen();
                          })
                        }
                      >
                        Toggle full screen
                      </button>
                    )}
                    {!passengerUI && (
                      <div className="actions">
                        <a href="/">Open passenger application</a>
                        <a href="/kiosk/">Open kiosk application</a>
                        {kiosk && <a href="/staff/">Open staff console</a>}
                      </div>
                    )}
                  </section>
                )}
                {page === "User Guide" && <Guide />}
              </>
            )}
          </>
        )}
      </main>
      {!staffPage && (
        <footer>
          SM Pala-Pala · One account, one shared reservation record · Times
          shown in Philippine time
        </footer>
      )}
    </div>
  );
}

function Schedules({ refresh, run }) {
  const [selectedDate, setDate] = useState(day),
    [items, setItems] = useState(null),
    [search, setSearch] = useState("");
  useEffect(() => {
    let active = true;
    const load = () =>
      run(async () => {
        const v = await request(`/trips?date=${selectedDate}`);
        if (active) setItems(v);
      });
    setItems(null);
    load();
    const timer = setInterval(load, 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [selectedDate, refresh]);
  const visible = (items || []).filter((t) =>
    `${t.from} ${t.to} ${t.busId?.busId}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <section>
      <div className="section-title">
        <div>
          <p className="eyebrow">Plan your journey</p>
          <h1>Trip schedule</h1>
          <p>
            View routes and departure times. Reserve your seat at the kiosk.
          </p>
        </div>
        <Field
          label="Trip date"
          type="date"
          value={selectedDate}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>
      <Field
        label="Search route or bus"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Route, destination or bus ID"
      />
      {items === null ? (
        <Empty>Loading published schedules…</Empty>
      ) : !visible.length ? (
        <Empty>
          No published trips match this date and search. Staff must configure
          schedules before trips appear here.
        </Empty>
      ) : (
        <div className="grid">
          {visible.map((t) => {
            const group = items.filter(
              (x) =>
                x.from === t.from && x.to === t.to && x.status !== "cancelled",
            );
            return (
              <article key={t._id}>
                <div className="row">
                  <strong>{t.busId?.busId || "Unassigned bus"}</strong>
                  <Pill>{t.status}</Pill>
                </div>
                <h2>
                  {t.from} → {t.to}
                </h2>
                <dl>
                  <dt>Departure</dt>
                  <dd>{date(t.departureAt)}</dd>
                  <dt>Expected arrival</dt>
                  <dd>{date(t.arrivalAt)}</dd>
                  <dt>Duration</dt>
                  <dd>
                    {t.durationMinutes
                      ? `${t.durationMinutes} minutes`
                      : t.arrivalAt
                        ? `${Math.round((new Date(t.arrivalAt) - new Date(t.departureAt)) / 60000)} minutes`
                        : "Not provided"}
                  </dd>
                  <dt>First / last departure</dt>
                  <dd>
                    {date(group[0]?.departureAt)} /{" "}
                    {date(group.at(-1)?.departureAt)}
                  </dd>
                  <dt>Available seats</dt>
                  <dd>
                    {t.availableSeatIds.length} of {t.seatIds.length} configured
                    seats
                  </dd>
                </dl>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
function TicketScanner({ session, run, connected }) {
  const [cameraOn, setCameraOn] = useState(false);
  const [reference, setReference] = useState("");
  const [cameraError, setCameraError] = useState("");
  const [pending, setPending] = useState(false);
  const video = useRef(null);
  const connectRef = useRef(null);
  const connect = async (value) => {
    setCameraOn(false);
    setPending(true);
    await run(async () => {
      let code = value.trim();
      try {
        code = new URL(code).searchParams.get("ticket") || code;
      } catch {
        /* Raw QR token. */
      }
      const ticket = await call("/connect-ticket", { reference: code });
      connected(ticket);
    });
    setPending(false);
  };
  connectRef.current = connect;
  useEffect(() => {
    if (!cameraOn) return;
    let stopped = false,
      controls;
    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia)
          throw new Error("Open the app over HTTPS and allow camera access.");
        const { BrowserQRCodeReader } = await import("@zxing/browser");
        if (stopped) return;
        controls = await new BrowserQRCodeReader().decodeFromConstraints(
          { audio: false, video: { facingMode: { ideal: "environment" } } },
          video.current,
          (result) => {
            if (!result || stopped) return;
            stopped = true;
            controls?.stop();
            connectRef.current(result.getText());
          },
        );
        if (stopped) controls.stop();
      } catch (error) {
        if (!stopped) {
          setCameraError(
            error.name === "NotAllowedError"
              ? "Allow camera access in your browser settings, then try again."
              : error.message,
          );
          setCameraOn(false);
        }
      }
    };
    start();
    return () => {
      stopped = true;
      controls?.stop();
    };
  }, [cameraOn]);
  if (session?.role !== "passenger")
    return <Empty>Sign in to connect your kiosk ticket.</Empty>;
  return (
    <section className="ticket-scanner">
      <h1>Connect your kiosk ticket</h1>
      <p>
        Scan the printed QR code to save your ticket and follow your trip. Seats
        are reserved at the kiosk.
      </p>
      {cameraError && <p role="alert">{cameraError}</p>}
      {cameraOn && (
        <video
          ref={video}
          autoPlay
          muted
          playsInline
          style={{ width: "100%", maxWidth: 420, borderRadius: 16 }}
        />
      )}
      <button
        type="button"
        className="primary"
        disabled={pending}
        onClick={() => {
          setCameraError("");
          setCameraOn(!cameraOn);
        }}
      >
        {cameraOn ? "Stop scanner" : "Scan ticket QR code"}
      </button>
      <details>
        <summary>Enter ticket number instead</summary>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            connect(reference);
          }}
        >
          <Field
            label="Complete ticket number"
            required
            value={reference}
            onChange={(event) => setReference(event.target.value)}
          />
          <button disabled={pending}>
            {pending ? "Connecting…" : "Connect ticket"}
          </button>
        </form>
      </details>
    </section>
  );
}
function Bookings({ session, refresh, run, open, summary = false }) {
  const [items, setItems] = useState(null),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState(""),
    [sort, setSort] = useState("newest");
  useEffect(() => {
    if (session) run(async () => setItems(await request("/reservations")));
  }, [session, refresh]);
  if (!session) return <Empty>Sign in to see your tickets.</Empty>;
  let rows = (items || []).filter(
    (t) =>
      (!status || t.status === status) &&
      `${t.bookingReference} ${t.busId} ${t.from} ${t.to}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  if (summary) rows = rows.filter((t) => t.status === "confirmed").slice(0, 4);
  if (sort === "departure")
    rows = [...rows].sort(
      (a, b) => new Date(a.departureAt) - new Date(b.departureAt),
    );
  return (
    <section>
      <h1>{summary ? "Upcoming reservations" : "Connected tickets"}</h1>
      {!summary && (
        <div className="filters">
          <Field
            label="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Reference, route or bus"
          />
          <Field label="Status">
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {["confirmed", "completed", "cancelled", "expired"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Sort">
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="newest">Newest tickets</option>
              <option value="departure">Departure time</option>
            </select>
          </Field>
        </div>
      )}
      {items === null ? (
        <Empty>Loading tickets…</Empty>
      ) : !rows.length ? (
        <Empty>No connected tickets match.</Empty>
      ) : (
        <div className="grid">
          {rows.map((t) => (
            <article key={t.id}>
              <div className="row">
                <strong>{t.bookingReference}</strong>
                <Pill>{t.status}</Pill>
              </div>
              <h2>
                {t.from} → {t.to}
              </h2>
              <p>
                {t.busId} · Seat {t.seatId}
              </p>
              <p>{date(t.departureAt)}</p>
              <button onClick={() => open(t)}>
                Open ticket & confirmation
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
function Ticket({ ticket, staff, kiosk, run, notify, close, changed }) {
  const [pending, setPending] = useState(false),
    [receiptSent, setReceiptSent] = useState(false),
    [printer, setPrinter] = useState(null),
    [status, setStatus] = useState(ticket.status);
  useEffect(() => {
    if (kiosk)
      api
        .getPrinterStatus()
        .then(setPrinter)
        .catch(() => setPrinter({ agentConnected: false }));
  }, [kiosk]);
  const action = (fn) => {
    setPending(true);
    run(fn).finally(() => setPending(false));
  };
  if (kiosk) {
    return (
      <section className="video-kiosk-flow kiosk-receipt-flow">
        <KioskSteps active={3} />
        <h1>Ticket ready</h1>
        <p className="kiosk-trip-label">
          Scan the QR code with the passenger app.
        </p>
        <div className="kiosk-receipt-paper">
          <h2>TELE-PORT</h2>
          <div className="receipt-subtitle">
            BUS SERVICES · PASSENGER TICKET
          </div>
          <div className="receipt-rule">***************************</div>
          <dl>
            <dt>Route:</dt>
            <dd>
              {ticket.from} - {ticket.routeTo || ticket.to}
            </dd>
            <dt>Bus number:</dt>
            <dd>{ticket.busId}</dd>
            <dt>Date:</dt>
            <dd>{date(ticket.createdAt || ticket.confirmedAt)}</dd>
            <dt>Passenger type:</dt>
            <dd>{categories[ticket.passengerType] || categories.regular}</dd>
            <dt>Ride:</dt>
            <dd>SEAT {ticket.seatId}</dd>
            <dt>From:</dt>
            <dd>{ticket.from}</dd>
            <dt>To:</dt>
            <dd>{ticket.to}</dd>
            <dt>Ticket no.:</dt>
            <dd>{ticket.bookingReference}</dd>
          </dl>
          <div className="receipt-rule">***************************</div>
          <strong className="receipt-fare">
            Php {Number(ticket.fare).toFixed(2)}
          </strong>
          <QR value={ticket.qrCode} />
          <small>
            SCAN QR FOR YOUR TRIP DETAILS
            <br />
            POWERED BY TELE-PORT
          </small>
        </div>
        {status !== "confirmed" && (
          <p className="error">
            This ticket is {status} and cannot be printed.
          </p>
        )}
        <button
          className="primary kiosk-print-button"
          disabled={
            pending ||
            receiptSent ||
            ticket.printState === "printed" ||
            status !== "confirmed" ||
            ticket.printState === "uncertain"
          }
          onClick={() =>
            action(async () => {
              const auth = await call("/receipt-authorization", {
                reference: ticket.qrCode,
              });
              await api.printTicket(auth.ticketId, auth.printToken);
              setReceiptSent(true);
              notify("Ticket sent to printer.");
              changed();
            })
          }
        >
          {pending
            ? "Sending to printer…"
            : receiptSent || ticket.printState === "printed"
              ? "Ticket sent to printer"
              : "Print ticket"}
        </button>
        {printer && !printer.agentConnected && (
          <p className="kiosk-printer-note">
            Printer is unavailable. Please ask staff for help.
          </p>
        )}
        {staff && ticket.printState === "uncertain" && (
          <div className="kiosk-print-recovery">
            <p>Please check the printer before retrying.</p>
            <button
              disabled={pending}
              onClick={() =>
                action(async () => {
                  await call(`/reservations/${ticket.id}/resolve-print`, {
                    outcome: "printed",
                  });
                  close();
                })
              }
            >
              Receipt physically printed
            </button>
            <button
              disabled={pending}
              onClick={() => {
                if (
                  confirm(
                    "Confirm no receipt was printed before enabling a retry.",
                  )
                )
                  action(async () => {
                    await call(`/reservations/${ticket.id}/resolve-print`, {
                      outcome: "failed",
                    });
                    close();
                  });
              }}
            >
              No receipt printed: enable retry
            </button>
          </div>
        )}
        <button
          className="kiosk-finish-button"
          disabled={pending}
          onClick={close}
        >
          Finish
        </button>
      </section>
    );
  }
  return (
    <section className="confirmation">
      <button onClick={close}>
        ← {kiosk ? "Scan another ticket / home" : "Back"}
      </button>
      <div
        className={`category ${["pwd", "senior"].includes(ticket.passengerType) ? "priority" : ""}`}
      >
        {categories[ticket.passengerType] || categories.regular}
        {ticket.categoryVerified && ticket.passengerType !== "regular" && (
          <small>Verified category</small>
        )}
      </div>
      <p className="eyebrow">SM Pala-Pala</p>
      <h1>Reservation confirmation</h1>
      <Pill>{status}</Pill>
      <div className="confirmation-grid">
        <div>
          <dl>
            <dt>Booking reference</dt>
            <dd className="reference">{ticket.bookingReference}</dd>
            <dt>Passenger</dt>
            <dd>{ticket.passengerIdentifier}</dd>
            <dt>Bus / seat</dt>
            <dd>
              {ticket.busId} / {ticket.seatId ?? "Not assigned"}
            </dd>
            <dt>Route / destination</dt>
            <dd>
              {ticket.from} → {ticket.routeTo || ticket.to} / {ticket.to}
            </dd>
            <dt>Departure</dt>
            <dd>{date(ticket.departureAt)}</dd>
            <dt>Created / confirmed</dt>
            <dd>
              {date(ticket.createdAt)} / {date(ticket.confirmedAt)}
            </dd>
            <dt>Fare</dt>
            <dd>₱{Number(ticket.fare).toFixed(2)}</dd>
            <dt>Ticket number</dt>
            <dd className="token">{ticket.ticketNumber}</dd>
          </dl>
        </div>
        <div>
          <QR value={ticket.qrCode} />
          <p>
            Present this code or enter the complete ticket number at the kiosk.
          </p>
        </div>
      </div>
      <div className="actions">
        {staff && ticket.printState === "uncertain" && (
          <>
            <button
              disabled={pending}
              onClick={() =>
                action(async () => {
                  await call(`/reservations/${ticket.id}/resolve-print`, {
                    outcome: "printed",
                  });
                  notify("Print confirmed after staff checked the printer.");
                  close();
                })
              }
            >
              Receipt physically printed
            </button>
            <button
              disabled={pending}
              onClick={() => {
                if (
                  confirm(
                    "Confirm that no receipt was printed before allowing a retry.",
                  )
                )
                  action(async () => {
                    await call(`/reservations/${ticket.id}/resolve-print`, {
                      outcome: "failed",
                    });
                    notify("Print retry enabled after physical inspection.");
                    close();
                  });
              }}
            >
              No receipt printed: enable retry
            </button>
          </>
        )}
        {kiosk && status === "confirmed" && (
          <button
            className="primary"
            disabled={pending}
            onClick={() =>
              action(async () => {
                const auth = await call("/receipt-authorization", {
                  reference: ticket.qrCode,
                });
                await api.printTicket(auth.ticketId, auth.printToken);
                notify(
                  "Receipt accepted by the kiosk print agent. Check the printer for your receipt.",
                );
                changed();
              })
            }
          >
            {pending ? "Sending receipt…" : "Print Receipt"}
          </button>
        )}
        {status === "confirmed" && !kiosk && (
          <button
            disabled={pending}
            onClick={() => {
              if (confirm("Cancel this reservation?"))
                action(async () => {
                  await call(`/reservations/${ticket.id}/cancel`, {});
                  setStatus("cancelled");
                  changed();
                  notify("Reservation cancelled.");
                });
            }}
          >
            Cancel reservation
          </button>
        )}
        {staff && status === "confirmed" && (
          <button
            disabled={pending}
            onClick={() => {
              if (
                confirm(
                  "Mark this ticket as boarded and completed? This prevents reuse.",
                )
              )
                action(async () => {
                  await call(`/reservations/${ticket.id}/complete`, {});
                  setStatus("completed");
                  changed();
                  notify("Ticket marked completed.");
                });
            }}
          >
            Mark boarded / complete
          </button>
        )}
      </div>
      {kiosk && (
        <p>
          Printer:{" "}
          {printer?.agentConnected
            ? "Agent connected"
            : "Unavailable or checking"}{" "}
          · Print state: {ticket.printState}. A printing error does not cancel
          your reservation.
        </p>
      )}
    </section>
  );
}
function Kiosk({ run, open, navigate }) {
  return <Walkup run={run} open={open} close={() => navigate("Kiosk")} />;
}
function KioskSteps({ active }) {
  return (
    <div className="kiosk-steps" aria-label={`Step ${active + 1} of 4`}>
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className={i <= active ? "done" : ""}
          aria-current={i === active ? "step" : undefined}
        />
      ))}
    </div>
  );
}
function Walkup({ run, open, close }) {
  const [buses, setBuses] = useState([]),
    [busId, setBusId] = useState(""),
    [seat, setSeat] = useState(""),
    [destination, setDestination] = useState(""),
    [category, setCategory] = useState("regular"),
    [pending, setPending] = useState(false),
    [step, setStep] = useState(0);
  useEffect(() => {
    let live = true;
    const poll = () =>
      api
        .getKioskBuses()
        .then((b) => {
          if (live) {
            setBuses(b);
            setBusId((id) => id || b[0]?._id || "");
          }
        })
        .catch(
          (e) =>
            live &&
            run(async () => {
              throw e;
            }),
        );
    poll();
    const timer = setInterval(poll, 10000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  const bus = buses.find((b) => b._id === busId),
    fares = bus
      ? FARE_MATRIX[fareDirectionForRoute(bus.from, bus.to)] || []
      : [],
    fare = fares.find((p) => p.landmark === destination),
    available = (bus?.seats || []).filter(
      (s) =>
        canUseSeat(bus, s.id, category) &&
        isSeatMonitored(bus, s.id) &&
        liveSeat(s) &&
        s.status === "available" &&
        s.occupancy === "available",
    ),
    seatValid = available.some((s) => s.id === Number(seat));
  return (
    <section className="video-kiosk-flow">
      <KioskSteps active={step} />
      <h1>
        {
          ["Passenger type", "Tap your seat", "Where are you getting off?"][
            step
          ]
        }
      </h1>
      <p className="kiosk-trip-label">
        {bus
          ? `${bus.name || bus.busId} · ${bus.from} → ${bus.to}`
          : "Loading bus…"}
        {step > 0 && seat ? ` · Seat ${seat}` : ""}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (step < 2) {
            setStep(step + 1);
            return;
          }
          if (!seatValid || !fare) return;
          setPending(true);
          run(async () => {
            const t = await api.createKioskTicket({
              busId,
              seatId: Number(seat),
              from: bus.from,
              routeTo: bus.to,
              to: destination,
              distanceKm: fare.distanceKm,
              passengerType: category,
              eligibilityDeclared: category !== "regular",
            });
            open(
              await call("/verify", { reference: t.qrCode, source: "manual" }),
            );
          }).finally(() => setPending(false));
        }}
      >
        {step === 1 && (
          <>
            {buses.length > 1 && (
              <Field label="Bus">
                <select
                  value={busId}
                  required
                  onChange={(e) => {
                    setBusId(e.target.value);
                    setSeat("");
                    setDestination("");
                  }}
                >
                  {buses.map((b) => (
                    <option value={b._id} key={b._id}>
                      {b.name || b.busId} · {b.from} → {b.to}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <p className="kiosk-priority-note">
              First row: PWD and senior passengers only.
            </p>
            <div className="kiosk-seat-legend">
              <span>Available</span>
              <span>Occupied / reserved</span>
              <span>Sensor unavailable</span>
            </div>
            <div className="kiosk-bus-layout">
              <div className="kiosk-driver">
                <Bus size={18} /> FRONT
              </div>
              <div className="kiosk-seat-layout">
                {kioskSeatLayout(bus).map((s, i) => {
                  const ok = available.some((a) => a.id === s.id);
                  const priorityOnly = !canUseSeat(bus, s.id, category);
                  return (
                    <button
                      type="button"
                      key={s.id}
                      style={{
                        gridRow: i < 55 ? Math.floor(i / 5) + 1 : 12,
                        gridColumn:
                          i < 55
                            ? i % 5 < 3
                              ? (i % 5) + 1
                              : (i % 5) + 2
                            : i - 54,
                      }}
                      className={`kiosk-seat-button ${priorityOnly ? "priority" : !liveSeat(s) || !isSeatMonitored(bus, s.id) ? "offline" : !ok ? "occupied" : "available"} ${Number(seat) === s.id ? "selected" : ""}`}
                      disabled={!ok || pending}
                      aria-pressed={Number(seat) === s.id}
                      aria-label={`Seat ${s.id}${!ok ? (priorityOnly ? ", PWD and senior only" : !liveSeat(s) ? ", sensor unavailable" : ", unavailable") : ""}`}
                      onClick={() => setSeat(String(s.id))}
                    >
                      <Armchair size={20} />
                      <span>{s.id}</span>
                      {isPrioritySeat(bus, s.id) && <small>Priority</small>}
                    </button>
                  );
                })}
              </div>
            </div>
            {bus && !available.length && (
              <p className="kiosk-no-seats">
                No eligible seats with a fresh available sensor reading. Please
                ask staff for help.
              </p>
            )}
          </>
        )}
        {step === 0 && (
          <>
            <div className="kiosk-category-grid">
              {Object.entries(categories).map(([key, label]) => (
                <button
                  type="button"
                  key={key}
                  aria-pressed={category === key}
                  className={category === key ? "selected" : ""}
                  onClick={() => {
                    setCategory(key);
                    setSeat("");
                  }}
                >
                  <User size={22} />
                  {label}
                </button>
              ))}
            </div>
            {category !== "regular" && (
              <p className="kiosk-eligibility">
                The conductor will verify your eligibility. Please present your
                valid ID when boarding.
              </p>
            )}
          </>
        )}
        {step === 2 && (
          <>
            <Field
              label={`Choose your drop-off point along ${bus?.from || ""} → ${bus?.to || ""}`}
            >
              <select
                value={destination}
                required
                onChange={(e) => setDestination(e.target.value)}
              >
                <option value="">Select a fare point…</option>
                {fares.map((f) => (
                  <option key={f.landmark} value={f.landmark}>
                    {f.landmark}
                  </option>
                ))}
              </select>
            </Field>
            {bus && <KioskRouteMap from={bus.from} to={bus.to} />}
            {fare && (
              <div className="kiosk-fare-summary">
                <strong>{destination}</strong>
                <small>
                  {fare.distanceKm} km · {categories[category]} · Fare: ₱
                  {Number(
                    category === "regular" ? fare.regular : fare.discounted,
                  ).toFixed(2)}
                </small>
              </div>
            )}
            {!seatValid && (
              <p className="error">
                This seat is no longer available. Go back and select an
                available seat.
              </p>
            )}
          </>
        )}
        <div className="kiosk-step-actions">
          <button
            type="button"
            disabled={pending}
            onClick={() => (step ? setStep(step - 1) : close())}
          >
            {step ? "Back" : "Home"}
          </button>
          <button
            className="primary"
            disabled={
              pending || (step > 0 && !seatValid) || (step === 2 && !fare)
            }
          >
            {pending
              ? "Creating ticket…"
              : step === 2
                ? "Create ticket"
                : "Continue"}
          </button>
        </div>
      </form>
    </section>
  );
}
function Auth({ run, notify, loggedIn, reset, staffOnly = false }) {
  const [mode, setMode] = useState(
      staffOnly ? "staff" : reset ? "reset" : "login",
    ),
    [pending, setPending] = useState(false);
  return (
    <div className="authLayout">
      {pending && (
        <div className="auth-loading-overlay" role="status" aria-live="polite">
          <div className="auth-loading-card">
            <span className="auth-loading-spinner" aria-hidden="true" />
            <strong>
              {["login", "staff"].includes(mode)
                ? "Signing in…"
                : "Please wait…"}
            </strong>
          </div>
        </div>
      )}
      <section className="authIntro">
        <div className="authBrand">TELE-PORT</div>
        <h1>
          {staffOnly ? (
            <>
              Staff <span>console</span>
            </>
          ) : mode === "signup" ? (
            <>
              Create your <span>account</span>
            </>
          ) : mode === "forgot" || mode === "reset" ? (
            <>
              Reset your <span>password</span>
            </>
          ) : (
            <>
              Welcome <span>back!</span>
            </>
          )}
        </h1>
        <p>
          {staffOnly
            ? "Sign in with your staff account to manage buses, schedules, and passenger tickets."
            : mode === "signup"
              ? "Create an account to follow your bus, check seats, and keep your trip details together."
              : mode === "forgot" || mode === "reset"
                ? "Reset your password and get back to your trip."
                : "Sign in to your account and make your Jasper Jean trip easier."}
        </p>
        <img
          className="authBusArt"
          src="/jasper-jean-bus.png"
          alt="Jasper Jean bus"
        />
      </section>
      <section className="auth">
        {["login", "signup"].includes(mode) ? (
          <div
            className="auth-tabs"
            role="group"
            aria-label="Passenger account"
          >
            <button
              type="button"
              aria-pressed={mode === "login"}
              onClick={() => setMode("login")}
            >
              Log in
            </button>
            <button
              type="button"
              aria-pressed={mode === "signup"}
              onClick={() => setMode("signup")}
            >
              Register
            </button>
          </div>
        ) : (
          <h1>
            {
              {
                login: "Passenger sign in",
                signup: "Create passenger account",
                staff: "Staff sign in",
                forgot: "Reset your password",
                reset: "Set a new password",
              }[mode]
            }
          </h1>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = Object.fromEntries(new FormData(e.currentTarget));
            if (mode === "signup" && f.password !== f.confirmPassword) {
              e.currentTarget.elements.confirmPassword.setCustomValidity(
                "Passwords must match.",
              );
              e.currentTarget.elements.confirmPassword.reportValidity();
              return;
            }
            delete f.confirmPassword;
            setPending(true);
            run(async () => {
              if (mode === "signup") {
                await api.passengerSignup(f);
                notify(
                  "Account created. Check your email for the verification link.",
                );
              } else if (mode === "forgot") {
                await api.passengerForgotPassword(f.email);
                notify("If this account exists, a reset link has been sent.");
              } else if (mode === "reset") {
                await api.passengerResetPassword(
                  new URLSearchParams(location.search).get("reset"),
                  f.password,
                );
                history.replaceState(null, "", "/");
                setMode("login");
                notify("Password updated. Sign in again.");
              } else {
                if (mode === "staff")
                  await api.adminLogin(f.kioskId, f.password);
                else await api.passengerLogin(f.email, f.password);
                await loggedIn();
              }
            }).finally(() => setPending(false));
          }}
        >
          {mode === "signup" && (
            <Field
              label="Full name"
              name="name"
              placeholder="Juan Dela Cruz"
              required
              maxLength={120}
            />
          )}{" "}
          {mode === "staff" ? (
            <Field
              label="Staff ID"
              name="kioskId"
              required
              autoComplete="username"
            />
          ) : (
            mode !== "reset" && (
              <Field
                label="Email"
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
              />
            )
          )}
          {mode !== "forgot" && (
            <Field
              label="Password"
              name="password"
              type="password"
              minLength={mode === "signup" || mode === "reset" ? 8 : undefined}
              maxLength={256}
              required
              placeholder="At least 8 characters"
              autoComplete={
                mode === "signup" || mode === "reset"
                  ? "new-password"
                  : "current-password"
              }
            />
          )}
          {mode === "signup" && (
            <Field
              label="Confirm password"
              name="confirmPassword"
              type="password"
              required
              autoComplete="new-password"
              placeholder="••••••••"
              onChange={(e) => e.target.setCustomValidity("")}
            />
          )}
          <button className="primary" disabled={pending}>
            {mode === "signup" ? (
              <UserPlus size={16} />
            ) : mode === "forgot" ? (
              <Mail size={16} />
            ) : (
              <LogIn size={16} />
            )}
            {pending
              ? "Please wait…"
              : mode === "signup"
                ? "Create account"
                : mode === "forgot"
                  ? "Send reset link"
                  : mode === "reset"
                    ? "Save password"
                    : "Log in"}
          </button>
        </form>
        <div className="actions">
          {(staffOnly ? [] : ["login", "signup", "forgot"])
            .filter(
              (m) =>
                m !== mode &&
                (!["login", "signup"].includes(mode) ||
                  !["login", "signup"].includes(m)),
            )
            .map((m) => (
              <button
                className={
                  m === "staff" ? "staff-login-link" : "auth-text-link"
                }
                key={m}
                onClick={() => setMode(m)}
              >
                {
                  {
                    login: "Passenger sign in",
                    signup: "Create account",
                    forgot: "Forgot password",
                    staff: "Staff sign in",
                  }[m]
                }
              </button>
            ))}
        </div>
        {staffOnly && (
          <div className="actions">
            <a href="/kiosk/">Open passenger kiosk</a>
            <a href="/">Open passenger app</a>
          </div>
        )}
      </section>
      <aside className="authFeatures" aria-label="Tele-port features">
        {[
          [MapPin, "Real-time location", "Follow your bus along the route."],
          [Armchair, "Seat availability", "Check current seat information."],
          [Bell, "Trip notifications", "See updates about your trip."],
        ].map(([Icon, title, detail]) => (
          <div className="authFeature" key={title}>
            <span className="authFeatureIcon">
              <Icon size={20} />
            </span>
            <div>
              <strong>{title}</strong>
              <br />
              <small>{detail}</small>
            </div>
          </div>
        ))}
      </aside>
    </div>
  );
}
function ProfilePhotoSettings({ user, busy, savePhoto, photoError }) {
  const photoInput = useRef(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  return (
    <section className="profile-photo-settings">
      <h2>Profile photo</h2>
      <span className="profile-avatar">
        {user?.profilePhoto ? (
          <img src={user.profilePhoto} alt="Your profile photo" />
        ) : (
          <User size={24} />
        )}
      </span>
      <div className="profile-photo-actions">
        <input
          ref={photoInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            setPhotoBusy(true);
            try {
              await savePhoto(await prepareProfilePhoto(file));
            } catch (error) {
              photoError(error.message);
            } finally {
              setPhotoBusy(false);
            }
          }}
        />
        <button
          type="button"
          disabled={busy || photoBusy}
          onClick={() => photoInput.current.click()}
        >
          {photoBusy
            ? "Saving photo…"
            : user?.profilePhoto
              ? "Change photo"
              : "Add profile photo"}
        </button>
        {user?.profilePhoto && (
          <button
            type="button"
            disabled={busy || photoBusy}
            onClick={() => savePhoto("")}
          >
            Remove photo
          </button>
        )}
      </div>
    </section>
  );
}
function PassengerProfile({
  session,
  navigate,
  logout,
  busy,
  install,
  appInstalled,
  installed,
}) {
  const user = session?.user;
  return (
    <section className="passenger-profile">
      <div className="profile-identity">
        <span className="profile-avatar">
          {user?.profilePhoto ? (
            <img
              src={user.profilePhoto}
              alt={`${user.name || "Passenger"} profile`}
            />
          ) : (
            (user?.name || "Passenger")
              .split(/\s+/)
              .map((p) => p[0])
              .slice(0, 2)
              .join("")
              .toUpperCase()
          )}
        </span>
        <div>
          <strong>{user?.name || "Passenger"}</strong>
          <p>Passenger account</p>
        </div>
      </div>

      {[
        [
          Smartphone,
          "Install TELE-PORT app",
          async () => {
            if (install) {
              await install.prompt();
              installed();
            } else navigate("Settings");
          },
        ],
        [Settings, "Settings", () => navigate("Settings")],
      ]
        .filter(
          ([, label]) => !appInstalled || label !== "Install TELE-PORT app",
        )
        .map(([Icon, label, action]) => (
          <button className="profile-row" key={label} onClick={action}>
            <Icon size={20} />
            <strong>{label}</strong>
            <ChevronRight size={18} />
          </button>
        ))}
      <button
        className="profile-row profile-logout"
        onClick={logout}
        disabled={busy}
      >
        <LogOut size={20} />
        <strong>Log out</strong>
      </button>
    </section>
  );
}
function PassengerNotifications({ notifications }) {
  return (
    <section className="passenger-notifications">
      <h1>Notifications</h1>
      <article className="passenger-list-card">
        <span className="homeCardIcon">
          <MapPin size={22} />
        </span>
        <div>
          <strong>Bus proximity alerts</strong>
          <small>Nearby alerts include the current available seat count.</small>
          <p className="notification-note">
            Enable your location in Maps. Alerts appear when an online bus is
            within 100 meters or estimated to reach you within 10 seconds. Keep
            the app open. Arrival times depend on GPS updates.
          </p>
        </div>
      </article>
      {!notifications.length ? (
        <Empty>No trip notifications yet.</Empty>
      ) : (
        notifications.map((n) => (
          <article className="passenger-list-card" key={n._id}>
            <span className="homeCardIcon">
              <Bell size={22} />
            </span>
            <div>
              <strong>{n.title || "Trip update"}</strong>
              <small>{n.body || n.message}</small>
              <small>{date(n.createdAt)}</small>
            </div>
          </article>
        ))
      )}
    </section>
  );
}
const liveSeat = (seat) =>
  seat.sensor === "ok" &&
  seat.sensorUpdatedAt &&
  Date.now() - Number(seat.sensorUpdatedAt) >= 0 &&
  Date.now() - Number(seat.sensorUpdatedAt) <= 90000 &&
  ["available", "occupied"].includes(seat.occupancy);
function PassengerSeats({ run }) {
  const [buses, setBuses] = useState(null);
  useEffect(() => {
    let active = true;
    const poll = () =>
      api
        .getKioskBuses()
        .then((data) => active && setBuses(data))
        .catch(
          (e) =>
            active &&
            run(async () => {
              throw e;
            }),
        );
    poll();
    const timer = setInterval(poll, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  return (
    <section className="passenger-seats">
      <h1>Seat availability</h1>
      {!buses?.length ? (
        <Empty>
          {buses === null
            ? "Loading seat sensors…"
            : "No buses are configured yet."}
        </Empty>
      ) : (
        buses.map((bus) => (
          <article key={bus._id}>
            <h2>
              <Bus size={20} /> {bus.busId}
            </h2>
            <p>
              {bus.from} → {bus.to}
            </p>
            <div className="seat-grid">
              {(bus.seats || []).map((s) => (
                <div
                  className={`seat ${s.status === "booked" ? "seat-occupied" : liveSeat(s) ? (s.occupancy === "available" ? "seat-available" : "seat-occupied") : "seat-offline"}`}
                  key={s.id}
                >
                  <Armchair size={22} />
                  <strong>Seat {s.id}</strong>
                  <span>
                    {s.status === "booked"
                      ? "Reserved"
                      : !liveSeat(s)
                        ? "Sensor unavailable"
                        : s.occupancy === "occupied"
                          ? "Occupied"
                          : "Available"}
                  </span>
                </div>
              ))}
            </div>
            <p>
              Reserved seats are unavailable to other passengers, even when
              empty. Seat information refreshes every 10 seconds.
            </p>
          </article>
        ))
      )}
    </section>
  );
}
function Account({ session, run, saved }) {
  if (!session) return <Empty>Sign in to manage your account.</Empty>;
  const u = session.user;
  return (
    <section>
      <h1>Your account</h1>
      <p>
        {u.email || u.kioskId} · {session.role}
      </p>
      {session.role === "passenger" ? (
        <>
          <p>
            Verified category:{" "}
            {categories[u.categoryVerified ? u.category : "regular"]}. Staff
            must review eligibility before discounts apply.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = Object.fromEntries(new FormData(e.currentTarget));
              run(async () => {
                await call(`/passengers/${u._id}`, f, "PATCH");
                await saved();
              });
            }}
          >
            <Field label="Name" name="name" required defaultValue={u.name} />
            <Field label="Phone" name="phone" defaultValue={u.phone} />
            <Field label="Request category verification">
              <select
                name="requestedCategory"
                defaultValue={u.requestedCategory || "regular"}
              >
                {Object.entries(categories).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <button className="primary">Save account</button>
          </form>
        </>
      ) : (
        <p>{u.name}. Contact an administrator to update your staff account.</p>
      )}
    </section>
  );
}
function Activity({ run, refresh, passenger = false }) {
  const [items, setItems] = useState(null),
    [filters, setFilters] = useState({});
  const load = () =>
    run(async () =>
      setItems(
        await request(
          `/activity?${new URLSearchParams(Object.entries(filters).filter(([, v]) => v))}`,
        ),
      ),
    );
  useEffect(() => {
    load();
  }, [refresh]);
  return (
    <section className={passenger ? "passenger-activity" : undefined}>
      <h1>{passenger ? "Activity" : "Activity History"}</h1>
      <details open={!passenger} className="activity-filters">
        <summary>Filter activity</summary>
        <form
          className="filters"
          onSubmit={(e) => {
            e.preventDefault();
            load();
          }}
        >
          {[
            ["start", "From", "datetime-local"],
            ["end", "Until", "datetime-local"],
            ["event", "Activity type", "text"],
            ["reference", "Booking reference", "text"],
            ["ticketNumber", "Ticket number", "text"],
            ["busId", "Bus ID", "text"],
          ].map(([k, label, type]) => (
            <Field
              key={k}
              label={label}
              type={type}
              value={filters[k] || ""}
              onChange={(e) => setFilters({ ...filters, [k]: e.target.value })}
            />
          ))}
          <Field label="Outcome">
            <select
              value={filters.outcome || ""}
              onChange={(e) =>
                setFilters({ ...filters, outcome: e.target.value })
              }
            >
              <option value="">All</option>
              <option>success</option>
              <option>failure</option>
            </select>
          </Field>
          <button>Apply filters</button>
        </form>
      </details>
      {!items?.length ? (
        <Empty>
          {items === null ? "Loading history…" : "No matching activity."}
        </Empty>
      ) : passenger ? (
        <div className="passenger-list">
          {items.map((a) => (
            <article className="passenger-list-card" key={a._id}>
              <span
                className={`homeCardIcon ${a.outcome === "success" ? "schedule" : "maps"}`}
              >
                <CheckCircle2 size={22} />
              </span>
              <div>
                <strong>
                  {a.event}
                  {a.busId?.busId ? ` · ${a.busId.busId}` : ""}
                </strong>
                <small>{date(a.createdAt)}</small>
                <details>
                  <summary>Details</summary>
                  <p>
                    {a.reference || ""} · {a.outcome}
                    {a.detail ? ` · ${a.detail}` : ""}
                  </p>
                </details>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Event</th>
                <th>Reference</th>
                <th>Bus</th>
                <th>Outcome / details</th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a._id}>
                  <td>{date(a.createdAt)}</td>
                  <td>{a.event}</td>
                  <td>{a.reference || "—"}</td>
                  <td>{a.busId?.busId || "—"}</td>
                  <td>
                    <Pill>{a.outcome}</Pill>
                    {a.detail && (
                      <details>
                        <summary>Details</summary>
                        {a.detail}
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p>
        Security and reservation history is retained. No deletion policy has
        been configured.
      </p>
    </section>
  );
}
const nearbyBusIcon = L.divIcon({
  className: "nearby-bus-marker",
  html: '<span aria-hidden="true">🚌</span>',
  iconSize: [38, 38],
  iconAnchor: [19, 19],
});
const passengerLocationIcon = L.divIcon({
  className: "passenger-location-marker",
  html: "<span></span>",
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});
function NearbyMapBounds({ points, viewKey }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 1)
      map.fitBounds(points, { padding: [35, 35], maxZoom: 15 });
    else if (points.length) map.setView(points[0], 14);
  }, [map, viewKey]);
  return null;
}
function DestinationJourney({ feed, visible, openTickets }) {
  const [selectedId, setSelectedId] = useState("");
  const [startedId, setStartedId] = useState(null);
  const [now, setNow] = useState(Date.now());
  const sent = useRef(new Map());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);
  const tickets = (feed.tickets || []).filter(
    (t) =>
      t.status === "active" &&
      (!t.expiresAt || new Date(t.expiresAt).getTime() > now),
  );
  const ticket = tickets.find((t) => t._id === selectedId) || tickets[0];
  const bus = (feed.items || []).find((b) => b.id === String(ticket?.busId));
  const { route } = useRoadRoute(bus?.from, bus?.to);
  const state = destinationProgress(ticket, bus, route?.points, now);
  const started = ticket && startedId === ticket._id;
  useEffect(() => {
    if (!started || !state || state.passed) return;
    const flags = sent.current.get(ticket._id) || {};
    const kind =
      state.close && !flags.close
        ? "close"
        : state.approaching && !flags.approaching
          ? "approaching"
          : null;
    if (!kind) return;
    flags[kind] = true;
    if (kind === "close") flags.approaching = true;
    sent.current.set(ticket._id, flags);
    const eta =
      state.etaSeconds === null
        ? ""
        : ` Estimated arrival in ${Math.max(1, Math.ceil(state.etaSeconds / 60))} min.`;
    feed.addAlert({
      _id: `destination-${ticket._id}-${kind}`,
      title:
        kind === "close"
          ? `Your drop-off at ${ticket.to} is close`
          : `Approaching ${ticket.to}`,
      body: `${bus.busId} · Seat ${ticket.seatId}. Prepare to get off.${eta}${state.estimatedStop ? " Fare-point location is estimated along the route." : ""}`,
      createdAt: new Date(now).toISOString(),
    });
  }, [
    started,
    ticket,
    bus,
    state?.close,
    state?.approaching,
    state?.passed,
    feed.addAlert,
  ]);
  if (!visible) return null;
  if (!ticket)
    return (
      <div className="destination-connect-note">
        <MapPin size={18} />
        <span>
          Connect your ticket to see your drop-off ETA and destination alerts.
        </span>
        <button onClick={openTickets}>My ticket</button>
      </div>
    );
  const arrivalTime =
    state?.etaSeconds != null
      ? new Date(now + state.etaSeconds * 1000).toLocaleTimeString("en-PH", {
          timeZone: "Asia/Manila",
          hour: "numeric",
          minute: "2-digit",
        })
      : null;
  return (
    <section
      className="destination-journey-card"
      aria-label="Your destination arrival"
    >
      <div className="row">
        <strong className="destination-arrival-title">
          {state?.passed
            ? "Drop-off point passed"
            : state?.close
              ? "Your drop-off is close"
              : arrivalTime
                ? `Arriving around ${arrivalTime}`
                : "Your destination"}
        </strong>
        <span className="destination-bus-badge">
          {bus?.busId || "Waiting for bus GPS"}
        </span>
      </div>
      <p>
        <MapPin size={16} /> {ticket.to} · Seat {ticket.seatId}
      </p>
      <small>
        {state
          ? state.passed
            ? "Check with the conductor about your stop."
            : `${(state.remainingMeters / 1000).toFixed(1)} km remaining${state.etaSeconds != null ? ` · About ${Math.max(1, Math.ceil(state.etaSeconds / 60))} min` : " · ETA unavailable while stopped"}`
          : "Waiting for a fresh bus GPS location and road route."}
      </small>
      <div
        className="destination-progress-track"
        role="progressbar"
        aria-label="Progress to your drop-off"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round((state?.progress || 0) * 100)}
      >
        <div
          className="destination-progress-fill"
          style={{ width: `${(state?.progress || 0) * 100}%` }}
        />
        <span className="destination-progress-start">●</span>
        <span
          className="destination-progress-bus"
          style={{ left: `${Math.min(96, (state?.progress || 0) * 100)}%` }}
        >
          <Bus size={22} />
        </span>
        <MapPin className="destination-progress-end" size={23} />
      </div>
      <div className="destination-progress-labels">
        <small>{ticket.from}</small>
        <small>{ticket.to}</small>
      </div>
      {tickets.length > 1 && (
        <Field label="Trip to monitor">
          <select
            value={ticket._id}
            onChange={(e) => {
              setSelectedId(e.target.value);
              setStartedId(null);
            }}
          >
            {tickets.map((t) => (
              <option key={t._id} value={t._id}>
                {t.to} · Seat {t.seatId}
              </option>
            ))}
          </select>
        </Field>
      )}
      <div className="destination-card-actions">
        <button
          className="primary"
          onClick={() => setStartedId(started ? null : ticket._id)}
        >
          {started ? "Stop destination alerts" : "Start destination alerts"}
        </button>
        <small>
          {started
            ? "Alerts on while this app is open."
            : "Start after boarding your bus."}
        </small>
      </div>
      <p className="destination-estimate-note">
        {state?.estimatedStop
          ? "Fare-point position and arrival time are route estimates."
          : "Arrival time is estimated from bus GPS and current speed."}{" "}
        Traffic and GPS updates can change the estimate.
      </p>
    </section>
  );
}
const busSeatCounts = seatAvailability;
function NearbyPassengerMap({ items, nearbyAlerts }) {
  const {
    position,
    locate,
    locationMessage,
    toggleLocation,
    browserPermission,
    enableBrowserNotifications,
  } = nearbyAlerts;
  const [radius, setRadius] = useState(5);
  const [selectedId, setSelectedId] = useState("");
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const user = position && now - position.timestamp <= 120000 ? position : null;
  const online = (items || []).filter((b) => gpsOnline(b, now));
  const nearby = online
    .map((b) => ({
      ...b,
      nearbyDistance: user
        ? haversineMeters(user.lat, user.lon, b.location.lat, b.location.lon)
        : null,
    }))
    .filter((b) => !user || b.nearbyDistance <= radius * 1000)
    .sort((a, b) =>
      user
        ? a.nearbyDistance - b.nearbyDistance
        : a.busId.localeCompare(b.busId),
    );
  const selected = nearby.find((b) => b.id === selectedId) || nearby[0];
  const { route, error } = useRoadRoute(selected?.from, selected?.to);
  const bounds = [
    ...nearby.map((b) => [b.location.lat, b.location.lon]),
    ...(user ? [[user.lat, user.lon]] : []),
    ...(route?.points || []),
  ];
  const selectedCounts = selected && busSeatCounts(selected);
  return (
    <section className="nearby-passenger-map">
      <div className="nearby-map-toolbar">
        <div>
          <h1>{user ? "Buses near you" : "Online buses"}</h1>
          <p>
            {user
              ? `${nearby.length} buses within ${radius} km · Location accuracy about ${Math.round(user.accuracy)} m`
              : "Enable your location to see which buses are nearby."}
          </p>
        </div>
        <button className="primary" onClick={toggleLocation}>
          <MapPin size={17} />
          {locate ? "Stop using my location" : "Use my location"}
        </button>
        {browserPermission !== "unsupported" &&
          browserPermission !== "granted" && (
            <button onClick={enableBrowserNotifications}>
              Enable browser alerts
            </button>
          )}
        <Field label="Nearby range">
          <select
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
          >
            {[1, 5, 10, 25].map((n) => (
              <option key={n} value={n}>
                {n} km
              </option>
            ))}
          </select>
        </Field>
      </div>
      {locationMessage && <p role="status">{locationMessage}</p>}
      <p className="nearby-route-note">
        With location enabled, alerts include available seats when a bus is
        within 100 m or estimated to reach you within 10 seconds. Keep the app
        open; timing depends on fresh GPS and location accuracy.
      </p>
      <div className="nearby-map-layout">
        <div className="nearby-map-panel">
          <MapContainer
            center={[14.4, 120.97]}
            zoom={11}
            className="nearby-live-map"
          >
            <TileLayer
              attribution="© OpenStreetMap contributors"
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <NearbyMapBounds
              points={bounds}
              viewKey={`${nearby.map((b) => b.id).join(",")}|${selected?.id}|${Boolean(user)}|${route?.points.length}`}
            />
            {route && (
              <Polyline
                positions={route.points}
                pathOptions={{ color: "#168451", weight: 5, opacity: 0.85 }}
              />
            )}
            {user && (
              <Marker
                position={[user.lat, user.lon]}
                icon={passengerLocationIcon}
              >
                <Popup>You are here</Popup>
              </Marker>
            )}
            {nearby.map((b) => (
              <Marker
                key={b.id}
                position={[b.location.lat, b.location.lon]}
                icon={nearbyBusIcon}
                eventHandlers={{ click: () => setSelectedId(b.id) }}
              >
                <Popup>
                  <strong>{b.busId}</strong>
                  <br />
                  {b.route}
                  <br />
                  {busSeatCounts(b).available} available seats
                </Popup>
              </Marker>
            ))}
          </MapContainer>
          {selected && (
            <article className="nearby-selected-card">
              <span className="homeCardIcon seats">
                <Bus size={23} />
              </span>
              <div>
                <strong>
                  {selected.busId} · {selected.name}
                </strong>
                <p>{selected.route}</p>
                <small>Live GPS · Updated {date(selected.lastUpdated)}</small>
              </div>
              <strong className="nearby-seat-total">
                {selectedCounts.available}
                <small>available seats</small>
              </strong>
            </article>
          )}
          {selected && (
            <p className="nearby-route-note">
              {error
                ? "Road route preview unavailable. Live bus locations are still shown."
                : route
                  ? "Green line: selected bus route preview. Blue dot: your location."
                  : "Loading selected bus route…"}
            </p>
          )}
        </div>
        <aside className="nearby-bus-list" aria-label="Online bus list">
          {items === null ? (
            <Empty>Loading online buses…</Empty>
          ) : !nearby.length ? (
            <Empty>
              {user
                ? `No online buses within ${radius} km. Try a wider range.`
                : "No buses are sending a fresh GPS location right now."}
            </Empty>
          ) : (
            nearby.map((b) => {
              const counts = busSeatCounts(b);
              return (
                <button
                  key={b.id}
                  className={`nearby-bus-card${selected?.id === b.id ? " selected" : ""}`}
                  aria-pressed={selected?.id === b.id}
                  onClick={() => setSelectedId(b.id)}
                >
                  <div className="row">
                    <strong>
                      <Bus size={18} /> {b.busId}
                    </strong>
                    <span className="nearby-online-badge">ONLINE</span>
                  </div>
                  <p>{b.route}</p>
                  <small>
                    {user
                      ? `${(b.nearbyDistance / 1000).toFixed(1)} km away`
                      : "Distance needs your location"}
                  </small>
                  <div className="nearby-seat-counts">
                    <span>
                      <strong>{counts.available}</strong> available
                    </span>
                    <span>
                      <strong>{counts.unavailable}</strong> occupied / reserved
                    </span>
                    <span>
                      <strong>{counts.unknown}</strong> unknown
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </aside>
      </div>
      <p className="nearby-route-note">
        Updates every 5 seconds. Buses disappear when their GPS is stale. Seat
        availability uses sensor readings and reservations.
      </p>
    </section>
  );
}
function Tracking({ run, refresh, passenger = false, nearby }) {
  const [items, setItems] = useState(null),
    [paused, setPaused] = useState(false);
  useEffect(() => {
    if (passenger) return;
    let active = true;
    const poll = () =>
      request("/tracking")
        .then((v) => active && setItems(v))
        .catch(
          (e) =>
            active &&
            run(async () => {
              throw e;
            }),
        );
    poll();
    if (paused)
      return () => {
        active = false;
      };
    const timer = setInterval(poll, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [refresh, paused, passenger]);
  if (passenger)
    return <NearbyPassengerMap items={nearby.items} nearbyAlerts={nearby} />;
  return (
    <section className={passenger ? "passenger-tracking" : undefined}>
      {!passenger && (
        <>
          <h1>Bus Tracking</h1>
          <p>
            Proximity uses authenticated GPS fixes and a 100-meter target
            boundary. Location data older than two minutes is marked stale.
          </p>
        </>
      )}
      {!items?.length ? (
        <Empty>
          {items === null
            ? "Loading tracking…"
            : "No buses are assigned to your active reservations."}
        </Empty>
      ) : (
        <div className="grid">
          {items.map((b) => (
            <article
              className={passenger ? "passenger-tracking-card" : undefined}
              key={b.id}
            >
              <div className="tracking-status">
                <div className="row">
                  <h2>{b.busId}</h2>
                  <Pill>
                    {passenger
                      ? b.tripStatus === "active"
                        ? "ON TRIP"
                        : (b.tripStatus || "idle").toUpperCase()
                      : b.status}
                  </Pill>
                </div>
                <p>{b.route}</p>
                {passenger && (
                  <div className="tracking-stats">
                    <div>
                      <small>Available seats</small>
                      <strong>
                        {
                          (b.seats || []).filter(
                            (s) =>
                              liveSeat(s) &&
                              s.occupancy === "available" &&
                              s.status !== "booked",
                          ).length
                        }
                      </strong>
                    </div>
                    <div>
                      <small>Not available</small>
                      <strong>
                        {
                          (b.seats || []).filter(
                            (s) =>
                              s.status === "booked" ||
                              (liveSeat(s) && s.occupancy === "occupied"),
                          ).length
                        }
                      </strong>
                    </div>
                    <div>
                      <small>ETA</small>
                      <strong>
                        {["Within 100 m", "Outside 100 m"].includes(b.status) &&
                        b.etaMin > 0
                          ? `${b.etaMin}m`
                          : "Unavailable"}
                      </strong>
                    </div>
                  </div>
                )}
                <details open={!passenger}>
                  <summary>GPS details</summary>
                  {passenger && (
                    <p>
                      {b.status} ·{" "}
                      {(b.seats || []).filter((s) => !liveSeat(s)).length} seat
                      sensors unavailable
                    </p>
                  )}
                  <dl>
                    <dt>Target</dt>
                    <dd>{b.target || "Not configured"}</dd>
                    <dt>Distance</dt>
                    <dd>
                      {b.distanceMeters === null
                        ? "Cannot determine"
                        : `${Math.round(b.distanceMeters)} m`}
                    </dd>
                    <dt>GPS update</dt>
                    <dd>{date(b.lastUpdated)}</dd>
                  </dl>
                  {b.reason && <p>{b.reason}</p>}
                </details>
                {passenger && (
                  <button
                    className="pause-tracking"
                    onClick={() => setPaused(!paused)}
                  >
                    {paused ? "Resume tracking" : "Pause tracking"}
                  </button>
                )}
              </div>
              {["Within 100 m", "Outside 100 m"].includes(b.status) && (
                <MapContainer
                  center={[b.location.lat, b.location.lon]}
                  zoom={16}
                  scrollWheelZoom={false}
                  className="tracking-map"
                >
                  <TileLayer
                    attribution="© OpenStreetMap contributors"
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  <Marker
                    position={[b.location.lat, b.location.lon]}
                    icon={markerIcon}
                  >
                    <Popup>{b.busId}</Popup>
                  </Marker>
                  <Marker
                    position={[
                      b.targetCoordinates.lat,
                      b.targetCoordinates.lon,
                    ]}
                    icon={markerIcon}
                  >
                    <Popup>{b.target}</Popup>
                  </Marker>
                </MapContainer>
              )}
              {passenger &&
                !["Within 100 m", "Outside 100 m"].includes(b.status) && (
                  <Empty>
                    {b.reason || "Waiting for a fresh GPS location."}
                  </Empty>
                )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
function Management({
  admin,
  schedulesOnly = false,
  run,
  notify,
  refresh,
  changed,
}) {
  const [buses, setBuses] = useState([]),
    [trips, setTrips] = useState([]),
    [users, setUsers] = useState([]),
    [staff, setStaff] = useState([]),
    [routes, setRoutes] = useState([]),
    [tab, setTab] = useState("Schedules"),
    [key, setKey] = useState(null);
  useEffect(() => {
    run(async () => {
      const [b, t] = await Promise.all([api.getBuses(), request("/trips")]);
      setBuses(b);
      setTrips(t);
      setRoutes(await api.getRoutes());
      if (admin) {
        const [u, a] = await Promise.all([
          api.getPassengers(),
          api.getAdmins(),
        ]);
        setUsers(u);
        setStaff(a);
      }
    });
  }, [refresh, admin]);
  useEffect(() => {
    let active = true;
    const timer = setInterval(
      () =>
        api
          .getBuses()
          .then((b) => active && setBuses(b))
          .catch(() => {}),
      10000,
    );
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const submit = (fn) => (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    run(async () => {
      await fn(f);
      changed();
      notify("Changes saved.");
    });
  };
  return (
    <section>
      <h1>{schedulesOnly ? "Trip schedules" : "Management"}</h1>
      <div className="actions">
        {(schedulesOnly
          ? []
          : [
              "Schedules",
              "Buses",
              "Routes",
              ...(admin
                ? ["Tracking setup", "Passenger categories", "Staff accounts"]
                : []),
            ]
        ).map((t) => (
          <button
            key={t}
            aria-current={tab === t ? "page" : undefined}
            onClick={() => {
              setTab(t);
              setKey(null);
            }}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "Routes" && (
        <>
          <h2>Manage routes</h2>
          <form
            onSubmit={submit((f) =>
              api.createRoute({
                name: f.name,
                stops: f.stops
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              }),
            )}
          >
            <Field label="Route name" name="name" required />
            <Field label="Stops separated by commas" name="stops" />
            <button className="primary">Add route</button>
          </form>
          {routes.map((r) => (
            <article key={r._id}>
              <form
                onSubmit={submit((f) =>
                  api.updateRoute(r._id, {
                    name: f.name,
                    stops: f.stops
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  }),
                )}
              >
                <Field
                  label="Route name"
                  name="name"
                  defaultValue={r.name}
                  required
                />
                <Field
                  label="Stops"
                  name="stops"
                  defaultValue={r.stops.join(", ")}
                />
                <button>Save route</button>
              </form>
            </article>
          ))}
        </>
      )}
      {tab === "Schedules" && (
        <>
          <h2>Publish a trip</h2>
          <form
            onSubmit={submit((f) =>
              call("/trips", {
                ...f,
                departureAt: `${f.departureAt}:00+08:00`,
                arrivalAt: f.arrivalAt ? `${f.arrivalAt}:00+08:00` : null,
                durationMinutes: f.durationMinutes
                  ? Number(f.durationMinutes)
                  : null,
                seatIds: f.seatIds.split(",").map((v) => Number(v.trim())),
              }),
            )}
          >
            <Field label="Assigned bus">
              <select name="busId" required>
                <option value="">Choose a bus</option>
                {buses.map((b) => (
                  <option key={b._id} value={b._id}>
                    {b.busId}
                  </option>
                ))}
              </select>
            </Field>
            <div className="filters">
              <Field
                label="Origin"
                name="from"
                required
                placeholder="SM Pala-Pala"
              />
              <Field
                label="Route destination"
                name="to"
                required
                placeholder="PITX"
              />
              <Field
                label="Departure (Philippine time)"
                name="departureAt"
                type="datetime-local"
                required
              />
              <Field
                label="Expected arrival (optional)"
                name="arrivalAt"
                type="datetime-local"
              />
              <Field
                label="Duration minutes (optional)"
                name="durationMinutes"
                type="number"
                min="1"
              />
              <Field
                label="Verified reservable seat IDs"
                name="seatIds"
                required
                placeholder="1,2,3,4,5"
              />
            </div>
            <button className="primary">Publish schedule</button>
          </form>
          <h2>Published trips</h2>
          {trips.map((t) => (
            <article key={t._id}>
              <strong>
                {t.busId?.busId} · {t.from} → {t.to}
              </strong>
              <p>
                {date(t.departureAt)} · {t.status}
              </p>
              <form
                onSubmit={submit((f) =>
                  call(
                    `/trips/${t._id}`,
                    {
                      status: f.status,
                      ...(f.departureAt
                        ? { departureAt: `${f.departureAt}:00+08:00` }
                        : {}),
                    },
                    "PATCH",
                  ),
                )}
              >
                <div className="filters">
                  <Field label="Status">
                    <select name="status" defaultValue={t.status}>
                      {[
                        "scheduled",
                        "boarding",
                        "departed",
                        "completed",
                        "cancelled",
                      ].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </Field>
                  <Field
                    label="Change departure (optional)"
                    name="departureAt"
                    type="datetime-local"
                  />
                  <button>Update trip</button>
                </div>
              </form>
            </article>
          ))}
        </>
      )}
      {tab === "Buses" && (
        <>
          {admin && (
            <>
              <h2>Add a configured bus</h2>
              <form
                onSubmit={submit((f) =>
                  api.createBus({
                    ...f,
                    totalSeats: Number(f.totalSeats),
                    monitoredSeatIds: f.monitoredSeatIds
                      .split(",")
                      .filter(Boolean)
                      .map(Number),
                  }),
                )}
              >
                <div className="filters">
                  {[
                    ["busId", "Unique bus ID"],
                    ["name", "Bus name"],
                    ["driver", "Driver"],
                    ["from", "Origin"],
                    ["to", "Destination"],
                  ].map(([name, label]) => (
                    <Field
                      key={name}
                      name={name}
                      label={label}
                      required={name !== "driver"}
                    />
                  ))}
                  <Field
                    name="totalSeats"
                    label="Physical seat count"
                    type="number"
                    min="1"
                    max="100"
                    required
                  />
                  <Field
                    name="monitoredSeatIds"
                    label="Seats with physical sensors"
                    placeholder="1,2,3,4,5"
                  />
                </div>
                <button className="primary">Add bus</button>
              </form>
            </>
          )}
          {buses.map((b) => (
            <article key={b._id}>
              <h2>
                {b.busId} · {b.name}
              </h2>
              <p>
                {b.from} → {b.to} · {b.driver} · {b.status}
              </p>
              <div className="seat-grid">
                {b.seats.map((s) => {
                  const fresh =
                    s.sensor === "ok" &&
                    s.sensorUpdatedAt &&
                    Date.now() - new Date(s.sensorUpdatedAt) < 90000;
                  return (
                    <div key={s.id} className="seat">
                      <strong>{s.id}</strong>
                      <span>{fresh ? s.occupancy : "Sensor unavailable"}</span>
                      <small>Walk-up reservation: {s.status}</small>
                    </div>
                  );
                })}
              </div>
              {admin && (
                <form onSubmit={submit((f) => api.updateBus(b._id, f))}>
                  <div className="filters">
                    <Field name="name" label="Name" defaultValue={b.name} />
                    <Field
                      name="from"
                      label="Origin"
                      defaultValue={b.from}
                      required
                    />
                    <Field
                      name="to"
                      label="Route destination"
                      defaultValue={b.to}
                      required
                    />
                    <Field
                      name="driver"
                      label="Driver"
                      defaultValue={b.driver}
                    />
                    <Field label="Status">
                      <select name="status" defaultValue={b.status}>
                        {["active", "boarding", "idle"].map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </Field>
                    <button>Update bus</button>
                  </div>
                </form>
              )}
            </article>
          ))}
        </>
      )}
      {tab === "Tracking setup" && (
        <>
          <p>
            Configure a target per bus. Rotate the device key, then set it on
            that bus's tracker. The key is shown once; do not share it with
            passengers.
          </p>
          {key && (
            <div className="alert">
              <strong>{key.busId} device key</strong>
              <p className="token">{key.deviceKey}</p>
              <button onClick={() => setKey(null)}>Hide key</button>
            </div>
          )}
          {buses.map((b) => (
            <article key={b._id}>
              <h2>{b.busId}</h2>
              <form
                onSubmit={submit((f) =>
                  call(
                    `/tracking/${b._id}`,
                    {
                      label: f.label,
                      lat: Number(f.lat),
                      lon: Number(f.lon),
                      trackingEnabled: f.trackingEnabled === "true",
                    },
                    "PATCH",
                  ),
                )}
              >
                <div className="filters">
                  <Field
                    name="label"
                    label="Target name"
                    required
                    defaultValue={b.proximityTarget?.label}
                  />
                  <Field
                    name="lat"
                    label="Latitude"
                    type="number"
                    step="any"
                    min="-90"
                    max="90"
                    required
                    defaultValue={b.proximityTarget?.lat}
                  />
                  <Field
                    name="lon"
                    label="Longitude"
                    type="number"
                    step="any"
                    min="-180"
                    max="180"
                    required
                    defaultValue={b.proximityTarget?.lon}
                  />
                  <Field label="Tracking">
                    <select
                      name="trackingEnabled"
                      defaultValue={String(b.trackingEnabled !== false)}
                    >
                      <option value="true">Enabled</option>
                      <option value="false">Inactive</option>
                    </select>
                  </Field>
                  <button>Save 100 m target</button>
                </div>
              </form>
              <button
                onClick={() => {
                  if (
                    confirm(
                      "Rotate the device key? The current tracker must be updated.",
                    )
                  )
                    run(async () =>
                      setKey(await call(`/tracking/${b._id}/device-key`, {})),
                    );
                }}
              >
                Generate / rotate device key
              </button>
            </article>
          ))}
        </>
      )}
      {tab === "Passenger categories" && (
        <>
          <p>
            Review passenger eligibility documents in person before approving a
            discount category. No category is inferred automatically.
          </p>
          {users.map((u) => (
            <article key={u._id}>
              <h2>{u.name}</h2>
              <p>
                {u.email} · Requested: {categories[u.requestedCategory]} ·
                Verified:{" "}
                {u.categoryVerified ? categories[u.category] : "Regular fare"}
              </p>
              <form
                onSubmit={submit((f) =>
                  call(
                    `/passengers/${u._id}`,
                    {
                      category: f.category,
                      categoryVerified: f.verified === "true",
                    },
                    "PATCH",
                  ),
                )}
              >
                <div className="filters">
                  <Field label="Approved category">
                    <select
                      name="category"
                      defaultValue={u.category || "regular"}
                    >
                      {Object.entries(categories).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Eligibility review">
                    <select
                      name="verified"
                      defaultValue={String(Boolean(u.categoryVerified))}
                    >
                      <option value="false">Not verified</option>
                      <option value="true">
                        Eligibility verified by staff
                      </option>
                    </select>
                  </Field>
                  <button>Save review</button>
                </div>
              </form>
            </article>
          ))}
        </>
      )}
      {tab === "Staff accounts" && (
        <>
          <h2>Create staff account</h2>
          <form onSubmit={submit((f) => api.createAdmin(f))}>
            <div className="filters">
              <Field label="Name" name="name" required />
              <Field label="Staff ID" name="kioskId" required />
              <Field
                label="Password"
                name="password"
                type="password"
                minLength="8"
                required
              />
              <Field label="Role">
                <select name="role">
                  <option value="staff">Staff</option>
                  <option value="admin">Administrator</option>
                </select>
              </Field>
            </div>
            <button>Create account</button>
          </form>
          {staff.map((u) => (
            <article key={u._id}>
              <h2>
                {u.name} · {u.kioskId}
              </h2>
              <form
                onSubmit={submit((f) =>
                  api.updateAdmin(u._id, {
                    role: f.role,
                    ...(f.password ? { password: f.password } : {}),
                  }),
                )}
              >
                <div className="filters">
                  <Field label="Role">
                    <select name="role" defaultValue={u.role || "staff"}>
                      <option value="staff">Staff</option>
                      <option value="admin">Administrator</option>
                    </select>
                  </Field>
                  <Field
                    label="New password (optional)"
                    name="password"
                    type="password"
                    minLength="8"
                  />
                  <button>Update account</button>
                </div>
              </form>
              <button
                onClick={() => {
                  if (confirm(`Delete staff account ${u.kioskId}?`))
                    run(async () => {
                      await api.deleteAdmin(u._id);
                      changed();
                    });
                }}
              >
                Delete account
              </button>
            </article>
          ))}
        </>
      )}
    </section>
  );
}
function Guide() {
  return (
    <section>
      <h1>User Guide</h1>
      <ol className="guide">
        <li>
          <strong>Check schedules.</strong> Open Trip Schedule, choose a date
          and review the assigned bus and departure. Unpublished times are shown
          as unavailable.
        </li>
        <li>
          <strong>Reserve at the kiosk.</strong> Choose passenger type, seat and
          destination at the kiosk, then generate and print your ticket. The
          passenger app cannot book seats.
        </li>
        <li>
          <strong>Connect your ticket.</strong> Sign in to the passenger app,
          open My Ticket and scan the printed kiosk QR code. Your connected
          ticket is saved to your account.
        </li>
        <li>
          <strong>Create a kiosk ticket.</strong> Tap Touch Screen to Begin,
          then choose passenger type, an available seat and destination. The
          first row is reserved for PWD and senior passengers.
        </li>
        <li>
          <strong>Review your category.</strong> Regular, Student, PWD or Senior
          Citizen appears at the top. At the kiosk, confirm your eligibility and
          bring the supporting ID when boarding.
        </li>
        <li>
          <strong>Review confirmation.</strong> Check bus, seat, destination,
          fare and current status before printing your generated ticket.
        </li>
        <li>
          <strong>Print Receipt.</strong> Press the kiosk button once. Keep the
          digital confirmation if the printer is offline. Ask staff if the print
          outcome is uncertain or you need a reprint.
        </li>
        <li>
          <strong>Create another ticket.</strong> Press Finish to return to the
          welcome screen, then begin a new ticket. The previous selections are
          cleared.
        </li>
        <li>
          <strong>Return home.</strong> Press Home during seat selection or
          Finish after ticket creation. Staff should sign out from the staff
          page after completing their work.
        </li>
        <li>
          <strong>Resolve errors.</strong> Check the internet connection and
          available sensor readings. Cancelled, completed and expired tickets
          cannot be printed. Stale GPS does not indicate the bus is outside the
          boundary.
        </li>
      </ol>
    </section>
  );
}
