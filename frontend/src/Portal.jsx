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
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { api, request } from "./api.js";
import { FARE_MATRIX, fareDirectionForRoute } from "../../shared/fareMatrix.js";
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
            "View your trip details",
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
    [trip, setTrip] = useState(null),
    [refresh, setRefresh] = useState(0);
  const bootstrapped = useRef(false);
  const [theme, setTheme] = useState(
      () => localStorage.getItem(kiosk ? "kiosk-theme" : "theme") || "light",
    ),
    [install, setInstall] = useState(null),
    [notifications, setNotifications] = useState([]),
    [online, setOnline] = useState(navigator.onLine);
  const staff = ["staff", "admin"].includes(session?.role),
    admin = session?.role === "admin";
  const passengerUI = !kiosk && !staffPage;
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
        setTrip(null);
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
        setPage(staffPage ? "Management" : "Dashboard");
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
        const t = await call("/verify", { reference, source: "qr" });
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
    };
    const update = () => setOnline(navigator.onLine);
    addEventListener("beforeinstallprompt", handler);
    addEventListener("online", update);
    addEventListener("offline", update);
    return () => {
      removeEventListener("beforeinstallprompt", handler);
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
            setTrip(null);
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
    setTrip(null);
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
  const nav = [
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
              aria-label="Back to home"
              onClick={() => navigate("Dashboard")}
            >
              <ArrowLeft size={18} />
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
        {!online && (
          <div className="alert" role="status">
            You are offline. Booking, ticket verification, schedules and
            tracking require a connection.
          </div>
        )}
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="alert success" role="status">
            {notice}
          </div>
        )}
        {busy && (
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
            ) : trip ? (
              <Booking
                trip={trip}
                session={session}
                run={run}
                close={() => setTrip(null)}
                confirmed={(t) => {
                  setTrip(null);
                  setTicket(t);
                  changed();
                }}
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
                  (page === "Dashboard" && !passengerUI)) && (
                  <Schedules
                    session={session}
                    refresh={refresh}
                    run={run}
                    choose={(t) =>
                      session?.role === "passenger"
                        ? setTrip(t)
                        : navigate("Sign in")
                    }
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
                  <Bookings
                    session={session}
                    refresh={refresh}
                    run={run}
                    open={setTicket}
                  />
                )}
                {page === "Kiosk" && (
                  <Kiosk
                    staff={staff}
                    run={run}
                    open={setTicket}
                    navigate={navigate}
                  />
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
                      navigate(
                        s.role === "passenger" ? "Dashboard" : "Management",
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
                        installed={() => setInstall(null)}
                      />
                    )}
                    <details
                      className={passengerUI ? "profile-edit" : "staff-account"}
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
                  />
                )}
                {page === "Seat Availability" && <PassengerSeats run={run} />}
                {page === "Notifications" && (
                  <PassengerNotifications notifications={notifications} />
                )}
                {page === "Management" && staff && (
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
                    <Field label="Color theme">
                      <select
                        value={theme}
                        onChange={(e) => setTheme(e.target.value)}
                      >
                        <option value="light">Light Mode</option>
                        <option value="dark">Dark Mode</option>
                      </select>
                    </Field>
                    {install ? (
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
                    )}
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
      <footer>
        SM Pala-Pala · One account, one shared reservation record · Times shown
        in Philippine time
      </footer>
    </div>
  );
}

function Schedules({ session, refresh, run, choose }) {
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
          <h1>Trip schedule & booking</h1>
          <p>Choose a published trip to reserve a seat.</p>
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
          schedules before seats can be reserved.
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
                <button
                  className="primary"
                  disabled={
                    !t.reservationOpen ||
                    !t.availableSeatIds.length ||
                    (session && session.role !== "passenger")
                  }
                  onClick={() => choose(t)}
                >
                  {session?.role === "passenger"
                    ? "Book this trip"
                    : "Passenger sign-in to book"}
                </button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
function Booking({ trip, session, run, close, confirmed }) {
  const options = FARE_MATRIX[fareDirectionForRoute(trip.from, trip.to)] || [];
  const [seat, setSeat] = useState(""),
    [destination, setDestination] = useState(""),
    [pending, setPending] = useState(false);
  const [pointLocation, setPointLocation] = useState(null);
  const point = options.find((p) => p.landmark === destination);
  const discounted =
    session.user.categoryVerified && session.user.category !== "regular";
  return (
    <section>
      <button onClick={close}>← Back to schedules</button>
      <h1>Reserve your seat</h1>
      <p>
        {trip.busId?.busId} · {trip.from} → {trip.to} · {date(trip.departureAt)}
      </p>
      <p>
        Passenger: {session.user.name} ·{" "}
        {categories[discounted ? session.user.category : "regular"]}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setPending(true);
          run(async () =>
            confirmed(
              await call("/reservations", {
                tripId: trip._id,
                seatId: Number(seat),
                to: destination,
                dropoffLocation: pointLocation,
              }),
            ),
          ).finally(() => setPending(false));
        }}
      >
        <Field label="Destination">
          <select
            required
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
          >
            <option value="">Choose a destination</option>
            {options.map((p) => (
              <option key={p.landmark}>{p.landmark}</option>
            ))}
          </select>
        </Field>
        <Field label="Seat">
          <select
            required
            value={seat}
            onChange={(e) => setSeat(e.target.value)}
          >
            <option value="">Choose an available seat</option>
            {trip.availableSeatIds.map((id) => (
              <option key={id} value={id}>
                Seat {id}
              </option>
            ))}
          </select>
        </Field>
        <Dropoff point={pointLocation} setPoint={setPointLocation} />
        {point && (
          <p className="fare">
            Fare: ₱{discounted ? point.discounted : point.regular}
          </p>
        )}
        <button className="primary" disabled={pending || !point}>
          {pending ? "Saving reservation…" : "Confirm reservation"}
        </button>
      </form>
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
  if (!session) return <Empty>Sign in to see your bookings.</Empty>;
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
      <h1>{summary ? "Upcoming reservations" : "Reservations & tickets"}</h1>
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
              <option value="newest">Newest bookings</option>
              <option value="departure">Departure time</option>
            </select>
          </Field>
        </div>
      )}
      {items === null ? (
        <Empty>Loading bookings…</Empty>
      ) : !rows.length ? (
        <Empty>No reservations match.</Empty>
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
function Kiosk({ staff, run, open, navigate }) {
  if (!staff)
    return (
      <section className="video-kiosk-flow">
        <h1>Ticket kiosk</h1>
        <p>This kiosk needs to be activated by staff before issuing tickets.</p>
        <a className="primary" href="/staff/">
          Open staff page
        </a>
        <button type="button" onClick={() => navigate("Kiosk")}>
          Home
        </button>
      </section>
    );
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
    [verified, setVerified] = useState(false),
    [point, setPoint] = useState(null),
    [pending, setPending] = useState(false),
    [step, setStep] = useState(0);
  useEffect(() => {
    let live = true;
    const poll = () =>
      api
        .getBuses()
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
        bus.monitoredSeatIds.includes(s.id) &&
        liveSeat(s) &&
        s.status === "available" &&
        s.occupancy === "available",
    ),
    seatValid = available.some((s) => s.id === Number(seat)),
    pointValid =
      Number.isFinite(point?.lat) &&
      Number.isFinite(point?.lon) &&
      Math.abs(point.lat) <= 90 &&
      Math.abs(point.lon) <= 180;
  return (
    <section className="video-kiosk-flow">
      <KioskSteps active={step} />
      <h1>
        {
          ["Tap your seat", "Passenger type", "Where are you getting off?"][
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
          if (!seatValid || !fare || !pointValid) return;
          setPending(true);
          run(async () => {
            const t = await api.createTicket({
              busId,
              seatId: Number(seat),
              from: bus.from,
              routeTo: bus.to,
              to: destination,
              distanceKm: fare.distanceKm,
              dropoffLocation: point,
              passengerType: category,
              categoryVerified: category === "regular" || verified,
            });
            open(
              await call("/verify", { reference: t.qrCode, source: "manual" }),
            );
          }).finally(() => setPending(false));
        }}
      >
        {step === 0 && (
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
                    setPoint(null);
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
                {(bus?.seats || []).map((s, i) => {
                  const ok = available.some((a) => a.id === s.id);
                  return (
                    <button
                      type="button"
                      key={s.id}
                      style={{ gridColumn: (i % 4) + (i % 4 >= 2 ? 2 : 1) }}
                      className={`kiosk-seat-button ${!liveSeat(s) ? "offline" : !ok ? "occupied" : "available"} ${Number(seat) === s.id ? "selected" : ""}`}
                      disabled={!ok || pending}
                      aria-pressed={Number(seat) === s.id}
                      aria-label={`Seat ${s.id}${!ok ? (!liveSeat(s) ? ", sensor unavailable" : ", unavailable") : ""}`}
                      onClick={() => setSeat(String(s.id))}
                    >
                      <Armchair size={20} />
                      <span>{s.id}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            {bus && !available.length && (
              <p className="kiosk-no-seats">
                No seats with a fresh available sensor reading. Please ask staff
                for help.
              </p>
            )}
          </>
        )}
        {step === 1 && (
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
                    setVerified(false);
                  }}
                >
                  <User size={22} />
                  {label}
                </button>
              ))}
            </div>
            {category !== "regular" && (
              <label className="kiosk-eligibility">
                <input
                  type="checkbox"
                  checked={verified}
                  onChange={(e) => setVerified(e.target.checked)}
                />
                Staff has checked the passenger's eligibility document.
              </label>
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
            <Dropoff point={point} setPoint={setPoint} compact />
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
              pending ||
              !seatValid ||
              (step > 0 && category !== "regular" && !verified) ||
              (step === 2 && (!fare || !pointValid))
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
function PassengerProfile({
  session,
  navigate,
  logout,
  busy,
  install,
  installed,
}) {
  const user = session?.user;
  return (
    <section className="passenger-profile">
      <div className="profile-identity">
        <span className="profile-avatar">
          {(user?.name || "Passenger")
            .split(/\s+/)
            .map((p) => p[0])
            .slice(0, 2)
            .join("")
            .toUpperCase()}
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
        [ClipboardList, "My bookings", () => navigate("My Bookings")],
        [TicketIcon, "My tickets", () => navigate("Tickets")],
        [Shield, "Help center", () => navigate("User Guide")],
        [Settings, "Settings", () => navigate("Settings")],
      ].map(([Icon, label, action]) => (
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
          <small>
            Updates use the bus GPS location and your active reservation.
          </small>
          <p className="notification-note">
            Open Maps to see the latest GPS status. Alerts appear here when your
            bus approaches its configured stop.
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
      request("/tracking")
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
            : "No buses are assigned to your active reservations."}
        </Empty>
      ) : (
        buses.map((bus) => (
          <article key={bus.id}>
            <h2>
              <Bus size={20} /> {bus.busId}
            </h2>
            <p>{bus.route}</p>
            <div className="seat-grid">
              {(bus.seats || []).map((s) => (
                <div
                  className={`seat ${liveSeat(s) ? (s.occupancy === "available" && s.status !== "booked" ? "seat-available" : "seat-occupied") : "seat-offline"}`}
                  key={s.id}
                >
                  <Armchair size={22} />
                  <strong>Seat {s.id}</strong>
                  <span>
                    {!liveSeat(s)
                      ? "Sensor unavailable"
                      : s.occupancy === "occupied"
                        ? "Occupied"
                        : s.status === "booked"
                          ? "Reserved"
                          : "Available"}
                  </span>
                </div>
              ))}
            </div>
            <p>
              Only fresh sensor readings show occupancy. Reservations remain
              separate from the physical seat sensors.
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
function Tracking({ run, refresh, passenger = false }) {
  const [items, setItems] = useState(null),
    [paused, setPaused] = useState(false);
  useEffect(() => {
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
  }, [refresh, paused]);
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
                              liveSeat(s) &&
                              (s.occupancy === "occupied" ||
                                s.status === "booked"),
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
function Management({ admin, run, notify, refresh, changed }) {
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
      <h1>Staff dashboard</h1>
      <div className="actions">
        {[
          "Schedules",
          "Buses",
          "Routes",
          ...(admin
            ? ["Tracking setup", "Passenger categories", "Staff accounts"]
            : []),
        ].map((t) => (
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
          <strong>Reserve a seat.</strong> Sign in to your verified passenger
          account, choose a trip, destination and seat, then confirm. Wait for
          the saved confirmation.
        </li>
        <li>
          <strong>Open your ticket.</strong> Select My Bookings or Tickets. Your
          booking reference, full ticket number and QR code are saved in your
          account.
        </li>
        <li>
          <strong>Create a kiosk ticket.</strong> Staff activates the kiosk from
          the staff page. Tap Touch Screen to Begin, then choose an available
          seat, passenger type and destination.
        </li>
        <li>
          <strong>Review your category.</strong> Regular, Student, PWD or Senior
          Citizen appears at the top. Discount categories require staff
          eligibility review.
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
