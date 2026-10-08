export const FARE_MATRIX = {
  northbound: [
    { landmark: "Ma Verde", distanceKm: 1, regular: 18, discounted: 14 },
    { landmark: "Dasma Bayan", distanceKm: 3, regular: 18, discounted: 14 },
    { landmark: "Arcontica", distanceKm: 5, regular: 35, discounted: 28 },
    { landmark: "Salitran", distanceKm: 6, regular: 35, discounted: 28 },
    { landmark: "Golden City", distanceKm: 7, regular: 35, discounted: 28 },
    { landmark: "District", distanceKm: 8, regular: 35, discounted: 28 },
    { landmark: "Anabu Coastal", distanceKm: 9, regular: 35, discounted: 28 },
    { landmark: "Doyets", distanceKm: 10, regular: 35, discounted: 28 },
    { landmark: "Sillas", distanceKm: 11, regular: 35, discounted: 28 },
    { landmark: "Patindig Araw", distanceKm: 12, regular: 40, discounted: 32 },
    { landmark: "Imus / Robinsons / MCI", distanceKm: 15, regular: 40, discounted: 32 },
    { landmark: "Bacoor", distanceKm: 17, regular: 45, discounted: 36 },
    { landmark: "Panapaan", distanceKm: 18, regular: 45, discounted: 36 },
    { landmark: "Niog", distanceKm: 19, regular: 50, discounted: 40 },
    { landmark: "Talaba", distanceKm: 20, regular: 50, discounted: 40 },
    { landmark: "Longos", distanceKm: 21, regular: 50, discounted: 40 },
    { landmark: "PITX", distanceKm: 27, regular: 68, discounted: 54 },
  ],
  southbound: [
    { landmark: "Longos", distanceKm: 8, regular: 35, discounted: 28 },
    { landmark: "Talaba", distanceKm: 8, regular: 35, discounted: 28 },
    { landmark: "Niog", distanceKm: 9, regular: 35, discounted: 28 },
    { landmark: "Panapaan", distanceKm: 10, regular: 35, discounted: 28 },
    { landmark: "SM Bacoor", distanceKm: 11, regular: 35, discounted: 28 },
    { landmark: "Camella", distanceKm: 12, regular: 35, discounted: 28 },
    { landmark: "MCI", distanceKm: 13, regular: 40, discounted: 32 },
    { landmark: "Imus", distanceKm: 14, regular: 40, discounted: 32 },
    { landmark: "Robinsons Imus", distanceKm: 15, regular: 40, discounted: 32 },
    { landmark: "Patindig-Araw", distanceKm: 16, regular: 45, discounted: 36 },
    { landmark: "Sillas", distanceKm: 17, regular: 45, discounted: 36 },
    { landmark: "Doyets", distanceKm: 18, regular: 48, discounted: 38 },
    { landmark: "Anabu Coastal", distanceKm: 19, regular: 50, discounted: 40 },
    { landmark: "District", distanceKm: 20, regular: 50, discounted: 40 },
    { landmark: "Golden City", distanceKm: 21, regular: 55, discounted: 44 },
    { landmark: "Salitran", distanceKm: 22, regular: 55, discounted: 44 },
    { landmark: "Arcontica", distanceKm: 23, regular: 58, discounted: 46 },
    { landmark: "Dasma Bayan", distanceKm: 24, regular: 60, discounted: 48 },
    { landmark: "Ma Verde", distanceKm: 25, regular: 65, discounted: 52 },
    { landmark: "Pala-Pala", distanceKm: 27, regular: 68, discounted: 54 },
  ],
};

const normalize = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");

export function fareDirectionForRoute(from, to) {
  const origin = normalize(from);
  const destination = normalize(to);
  if (origin.includes("pitx") && (destination.includes("palapala") || destination.includes("dasma"))) return "southbound";
  if ((origin.includes("palapala") || origin.includes("dasma")) && destination.includes("pitx")) return "northbound";
  return null;
}

export function farePointForRoute(from, to, landmark) {
  const direction = fareDirectionForRoute(from, to);
  if (!direction) return null;
  const key = normalize(landmark);
  return FARE_MATRIX[direction].find((point) => normalize(point.landmark) === key) || null;
}

export function fareForRoute(from, to, landmark, passengerType = "regular") {
  const point = farePointForRoute(from, to, landmark);
  if (!point) return null;
  return passengerType === "regular" ? point.regular : point.discounted;
}
