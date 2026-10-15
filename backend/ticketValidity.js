// Kiosk tickets have always been issued for 24 hours. Older records omitted
// expiresAt; a missing deadline must not turn those tickets into permanent holds.
export const WALKUP_TICKET_TTL_MS = 24 * 60 * 60 * 1000;

export function activeTicketFilter(now = Date.now()) {
  return {
    status: "active",
    $or: [
      { expiresAt: { $gt: new Date(now) } },
      { expiresAt: null, tripId: { $ne: null } },
      {
        expiresAt: null,
        tripId: null,
        createdAt: { $gt: new Date(now - WALKUP_TICKET_TTL_MS) },
      },
    ],
  };
}

export function ticketIsEligible(ticket, now = Date.now()) {
  if (ticket.status !== "active") return false;
  if (ticket.expiresAt) return new Date(ticket.expiresAt).getTime() > now;
  if (ticket.tripId) return true;
  return new Date(ticket.createdAt).getTime() + WALKUP_TICKET_TTL_MS > now;
}
