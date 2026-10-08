import { fareDirectionForRoute, farePointForRoute } from "../shared/fareMatrix.js";

// Maps a ticket's drop-off label to the DFPlayer clip number in /mp3 on the
// bus's microSD card (firmware/sd_card/mp3). Labels come from the frontend's
// fare points come from the Jasper Jean landmark matrix.
//   0001       generic "approaching your drop-off point" (fallback)
//   0002/0003  terminal stops: PITX / SM Pala-Pala
//   01xx/02xx  every 5 km from PITX / from SM Pala-Pala (xx = km / 5)
const STOP_CLIPS = { "pitx": 2, "sm pala-pala": 3 };
const KM_CLIP_BASE = { "pitx": 100, "sm pala-pala": 200 };
const MAX_KM = 30;

export function voiceClipFor(label, from = "", routeTo = "") {
  const text = String(label || "").trim().toLowerCase();
  const direction = fareDirectionForRoute(from, routeTo);
  const farePoint = farePointForRoute(from, routeTo, label);
  if (direction && farePoint) {
    if (direction === "northbound" && farePoint.landmark === "PITX") return 2;
    if (direction === "southbound" && farePoint.landmark === "Pala-Pala") return 3;
    if (farePoint.distanceKm % 5 === 0) {
      return (direction === "southbound" ? 100 : 200) + farePoint.distanceKm / 5;
    }
    return 1;
  }
  const km = text.match(/^(\d+) km from (.+)$/);
  if (km) {
    const distance = Number(km[1]);
    const base = KM_CLIP_BASE[km[2].trim()];
    if (base && distance % 5 === 0 && distance >= 5 && distance <= MAX_KM) return base + distance / 5;
    return 1;
  }
  return STOP_CLIPS[text.split("·")[0].trim()] || 1;
}
