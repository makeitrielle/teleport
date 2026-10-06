import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const WIDTH = 32; // XP-58 font A supports 32 columns on its 48 mm print area.

function printable(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "?");
}

function wrap(text, width = WIDTH) {
  const words = printable(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (word.length > width) {
      if (line) lines.push(line), line = "";
      for (let i = 0; i < word.length; i += width) lines.push(word.slice(i, i + width));
      continue;
    }
    if (line && `${line} ${word}`.length > width) lines.push(line), line = word;
    else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

function textLine(value) {
  return Buffer.from(`${printable(value)}\n`, "ascii");
}

function qrCommands(value) {
  const data = Buffer.from(value, "ascii");
  if (data.length > 700) throw new Error("Ticket QR link is too long for the XP-58 printer.");
  const p = data.length + 3;
  return Buffer.concat([
    Buffer.from([0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]), // QR model 2
    Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x05]), // module size
    Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31]), // error correction L
    Buffer.from([0x1d, 0x28, 0x6b, p & 0xff, (p >> 8) & 0xff, 0x31, 0x50, 0x30]),
    data,
    Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]), // print QR
  ]);
}

function makeReceipt(ticket, cutAfterPrint) {
  const chunks = [
    Buffer.from([0x1b, 0x40, 0x1b, 0x74, 0x00]), // initialize, CP437
    Buffer.from([0x1b, 0x61, 0x01, 0x1b, 0x45, 0x01, 0x1d, 0x21, 0x01]),
    textLine("JASPER JEAN"),
    Buffer.from([0x1d, 0x21, 0x00, 0x1b, 0x45, 0x00]),
    textLine("BUS LINER - PASSENGER TICKET"),
    textLine("*******************************"),
    Buffer.from([0x1b, 0x61, 0x00]),
  ];

  const rows = [
    ["ROUTE:", ticket.route],
    ["BUS NUMBER:", ticket.busNumber],
    ["DATE:", new Date(ticket.issuedAt || Date.now()).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })],
    ticket.driver ? ["DRIVER:", ticket.driver] : null,
    ["PASSENGER:", String(ticket.passengerType || "regular").toUpperCase()],
    ["RIDE:", ticket.ride],
    ["FROM:", ticket.from],
    ["TO:", ticket.to],
  ].filter(Boolean);

  for (const [label, value] of rows) {
    const allLines = wrap(`${label} ${value || "—"}`);
    for (const line of allLines) chunks.push(textLine(line));
  }

  chunks.push(
    textLine("*******************************"),
    Buffer.from([0x1b, 0x61, 0x01, 0x1b, 0x45, 0x01]),
    textLine("TICKET NO."),
    ...wrap(ticket.ticketNumber).map(textLine),
    Buffer.from([0x1d, 0x21, 0x01]),
    textLine(`Php ${Number(ticket.fare || 0).toFixed(2)}`),
    Buffer.from([0x1d, 0x21, 0x00, 0x1b, 0x45, 0x00]),
    textLine("*******************************"),
    Buffer.from([0x1b, 0x61, 0x01]),
    qrCommands(ticket.scanUrl),
    Buffer.from([0x1b, 0x64, 0x02]),
    textLine("SCAN QR FOR BUS ETA"),
    textLine("POWERED BY TELE-PORT"),
    Buffer.from([0x1b, 0x64, 0x03]),
  );
  if (cutAfterPrint) chunks.push(Buffer.from([0x1d, 0x56, 0x42, 0x00]));
  return Buffer.concat(chunks);
}

const RAW_PRINT_CSHARP = String.raw`
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class TeleportRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.drv", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool ClosePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true, CharSet = CharSet.Unicode)] static extern int StartDocPrinter(IntPtr handle, int level, DOCINFO info);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndDocPrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool StartPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool WritePrinter(IntPtr handle, byte[] buffer, int count, out int written);
  static void Check(bool ok) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }
  public static void Send(string printerName, byte[] data) {
    IntPtr handle;
    Check(OpenPrinter(printerName, out handle, IntPtr.Zero));
    try {
      var info = new DOCINFO { pDocName = "TELE-PORT passenger ticket", pDataType = "RAW", pOutputFile = null };
      if (StartDocPrinter(handle, 1, info) == 0) throw new Win32Exception(Marshal.GetLastWin32Error());
      try {
        Check(StartPagePrinter(handle));
        try { int written; Check(WritePrinter(handle, data, data.Length, out written)); if (written != data.Length) throw new Exception("Windows accepted only part of the receipt data."); }
        finally { EndPagePrinter(handle); }
      } finally { EndDocPrinter(handle); }
    } finally { ClosePrinter(handle); }
  }
}`;

export async function printTicket(ticket) {
  if (process.platform !== "win32") throw new Error("The Tele-port print agent must run on the Windows kiosk computer.");
  const printerName = process.env.PRINTER_NAME || "XP-58C";
  const cutAfterPrint = process.env.CUT_AFTER_PRINT === "true";
  const bytes = makeReceipt(ticket, cutAfterPrint).toString("base64");
  const encodedName = Buffer.from(printerName, "utf8").toString("base64");
  const script = `$ErrorActionPreference='Stop'; Add-Type -TypeDefinition @'\n${RAW_PRINT_CSHARP}\n'@; $n=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedName}')); $b=[Convert]::FromBase64String('${bytes}'); [TeleportRawPrinter]::Send($n,$b); Write-Output 'PRINT_ACCEPTED'`;
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], { windowsHide: true, timeout: 20_000, maxBuffer: 1_000_000 });
    if (!stdout.includes("PRINT_ACCEPTED")) throw new Error("Windows did not confirm the raw print job.");
  } catch (error) {
    throw new Error(error.stderr?.trim() || error.message || "Windows could not send the ticket to the printer.");
  }
}
