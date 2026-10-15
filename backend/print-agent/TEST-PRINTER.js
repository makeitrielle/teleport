import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { printTicket } from "./printer.js";

dotenv.config({ path: fileURLToPath(new URL("./.env", import.meta.url)) });
try {
  await printTicket({
    bookingReference: "TEST - NOT VALID FOR TRAVEL",
    reservationStatus: "PRINTER TEST ONLY",
    route: "TEST ROUTE",
    busNumber: "TEST BUS",
    passengerType: "regular",
    ride: "TEST SEAT",
    from: "TEST ORIGIN",
    to: "TEST DESTINATION",
    fare: 0,
    ticketNumber: "TEST-NOT-A-REAL-TICKET",
    scanUrl: "https://www.teleport-app.online/kiosk/",
  });
  console.log(
    "Windows accepted the test receipt. Check that text and QR printed on paper.",
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
