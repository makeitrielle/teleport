import { useEffect, useRef, useState, useCallback } from "react";
import { request } from "./api.js";
import {
  arrivalState,
  arrivalTrigger,
  seatAvailability,
} from "../../shared/nearbyAlerts.js";

export function useNearbyBusAlerts(enabled, userId) {
  const [items, setItems] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [position, setPosition] = useState(null);
  const [locate, setLocate] = useState(false);
  const [locationMessage, setLocationMessage] = useState("");
  const [alerts, setAlerts] = useState([]);
  const [browserPermission, setBrowserPermission] = useState(
    typeof Notification === "undefined"
      ? "unsupported"
      : Notification.permission,
  );
  const history = useRef(new Map());
  useEffect(() => {
    setAlerts([]);
    setPosition(null);
    setLocate(false);
    history.current.clear();
    setTickets([]);
    if (!enabled) {
      setItems(null);
      return;
    }
    let active = true,
      pending = false;
    const poll = async () => {
      if (pending) return;
      pending = true;
      try {
        const results = await Promise.allSettled([
          request("/tracking"),
          request("/tickets"),
        ]);
        if (active) {
          setItems(results[0].status === "fulfilled" ? results[0].value : []);
          if (results[1].status === "fulfilled") setTickets(results[1].value);
        }
      } catch {
        if (active) setItems([]);
      } finally {
        pending = false;
      }
    };
    poll();
    const timer = setInterval(poll, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [enabled, userId]);
  useEffect(() => {
    if (!enabled || !locate) return;
    if (!navigator.geolocation) {
      setLocationMessage("Location is unavailable on this device.");
      setLocate(false);
      return;
    }
    setLocationMessage("Finding your location…");
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setPosition({
          lat: p.coords.latitude,
          lon: p.coords.longitude,
          accuracy: p.coords.accuracy,
          timestamp: p.timestamp,
        });
        setLocationMessage(
          p.coords.accuracy > 50
            ? "Location accuracy is too low for arrival alerts. Waiting for a better fix…"
            : "",
        );
      },
      () => {
        setPosition(null);
        setLocate(false);
        setLocationMessage(
          "Allow location access to receive nearby bus alerts.",
        );
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled, locate]);
  useEffect(() => {
    if (!enabled || !locate || !position) return;
    const now = Date.now();
    const messages = [];
    for (const bus of items || []) {
      const previous = history.current.get(bus.id);
      const state = arrivalState(bus, position, previous?.fix, now);
      if (!state) continue;
      const { kind, flags } = arrivalTrigger(state, previous);
      if (kind) {
        const seats = seatAvailability(bus, now);
        const title =
          kind === "soon"
            ? `${bus.busId} is about ${Math.max(1, Math.ceil(state.etaSeconds))} seconds away`
            : `${bus.busId} is within 100 meters`;
        const body = `${bus.route} · ${seats.available} available seats${seats.unknown ? ` · ${seats.unknown} seats have no current sensor reading` : ""}.`;
        messages.push({
          _id: `nearby-${bus.id}-${kind}-${now}`,
          title,
          body,
          createdAt: new Date(now).toISOString(),
        });
        if (
          typeof Notification !== "undefined" &&
          Notification.permission === "granted"
        ) {
          const options = {
            body,
            tag: `teleport-${bus.id}-${kind}`,
            icon: "/icons/icon-192.png",
          };
          if (navigator.serviceWorker)
            navigator.serviceWorker
              .getRegistration()
              .then((registration) => {
                if (registration)
                  return registration.showNotification(title, options);
                new Notification(title, options);
              })
              .catch(() => {});
          else {
            try {
              new Notification(title, options);
            } catch {}
          }
        }
      }
      // Keep the previous distinct fix until a new telemetry sample arrives.
      if (
        !previous ||
        String(previous.fix.updatedAt) !== String(bus.location.updatedAt)
      )
        history.current.set(bus.id, {
          fix: bus.location,
          flags,
          distance: state.distance,
        });
      else {
        previous.flags = flags;
        previous.distance = state.distance;
      }
    }
    if (messages.length) setAlerts((old) => [...messages, ...old].slice(0, 30));
  }, [items, position, enabled, locate]);
  const toggleLocation = () => {
    setPosition(null);
    setLocate((old) => !old);
  };
  const enableBrowserNotifications = async () => {
    if (typeof Notification !== "undefined")
      setBrowserPermission(await Notification.requestPermission());
  };
  const addAlert = useCallback((alert) => {
    setAlerts((old) => [alert, ...old].slice(0, 30));
    if (
      typeof Notification !== "undefined" &&
      Notification.permission === "granted"
    ) {
      const options = {
        body: alert.body,
        tag: alert._id,
        icon: "/icons/icon-192.png",
      };
      navigator.serviceWorker
        ?.getRegistration()
        .then((registration) => {
          if (registration)
            return registration.showNotification(alert.title, options);
          new Notification(alert.title, options);
        })
        .catch(() => {});
    }
  }, []);
  return {
    items,
    tickets,
    addAlert,
    position,
    locate,
    locationMessage,
    alerts,
    toggleLocation,
    browserPermission,
    enableBrowserNotifications,
  };
}
