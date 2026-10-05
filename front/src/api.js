// Thin fetch wrapper around the TELE-PORT backend REST API.
// Base URL can be overridden with VITE_API_URL in a .env file (see .env.example).
const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    // no JSON body (e.g. 204 No Content)
  }
  if (!res.ok) {
    const message = (body && body.error) || `Request failed: ${res.status}`;
    throw new Error(message);
  }
  return body;
}

export const api = {
  // ---- health ----
  health: () => request("/health"),

  // ---- buses (generic collection - used by the super admin dashboard) ----
  getBuses: () => request("/buses"),
  createBus: (data) => request("/buses", { method: "POST", body: JSON.stringify(data) }),
  updateBus: (id, data) => request(`/buses/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  updateSeat: (busId, seatId, data) =>
    request(`/buses/${busId}/seats/${seatId}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteBus: (id) => request(`/buses/${id}`, { method: "DELETE" }),

  // ---- the one bus (BUS-001) - what the ESP32 firmware talks to ----
  getCurrentBus: () => request("/bus/current"),
  sendBusLocation: (data) => request("/bus/location", { method: "POST", body: JSON.stringify(data) }),
  getBusSeats: () => request("/bus/seats"),
  sendBusSeatUpdate: (data) => request("/bus/seats", { method: "POST", body: JSON.stringify(data) }),

  // ---- routes ----
  getRoutes: () => request("/routes"),
  createRoute: (data) => request("/routes", { method: "POST", body: JSON.stringify(data) }),
  updateRoute: (id, data) => request(`/routes/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteRoute: (id) => request(`/routes/${id}`, { method: "DELETE" }),

  // ---- admins ----
  getAdmins: () => request("/admins"),
  createAdmin: (data) => request("/admins", { method: "POST", body: JSON.stringify(data) }),
  updateAdmin: (id, data) => request(`/admins/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteAdmin: (id) => request(`/admins/${id}`, { method: "DELETE" }),
  adminLogin: (kioskId, password) =>
    request("/admins/login", { method: "POST", body: JSON.stringify({ kioskId, password }) }),

  // ---- passengers ----
  getPassengers: () => request("/passengers"),
  passengerSignup: (data) => request("/passengers/signup", { method: "POST", body: JSON.stringify(data) }),
  passengerLogin: (email, password) =>
    request("/passengers/login", { method: "POST", body: JSON.stringify({ email, password }) }),

  // ---- tickets ----
  getTickets: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/tickets${qs ? `?${qs}` : ""}`);
  },
  createTicket: (data) => request("/tickets", { method: "POST", body: JSON.stringify(data) }),
  updateTicket: (id, data) => request(`/tickets/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  // ---- notifications ----
  getNotifications: () => request("/notifications"),
  createNotification: (data) => request("/notifications", { method: "POST", body: JSON.stringify(data) }),
};

// Converts a Mongo document ({_id, ...}) into the shape the frontend expects ({id, ...}).
export function withId(doc) {
  if (!doc) return doc;
  const { _id, __v, ...rest } = doc;
  return { id: _id, ...rest };
}

export function withIds(docs) {
  return (docs || []).map(withId);
}
