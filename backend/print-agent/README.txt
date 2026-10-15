TELE-PORT WINDOWS KIOSK PRINT AGENT

Run this on the actual kiosk PC, not the development computer.
Requires Windows and Node.js 22.12 or later. The portable ZIP includes the
JavaScript dependencies; you do not need to run npm install.

1. Extract the entire ZIP to a permanent folder (for example C:\TELE-PORT).
   Do not run it from inside the ZIP or move the folder after installing startup.
2. Connect and power on the thermal printer. Install its manufacturer's Windows
   driver. Confirm its exact name appears in Windows Printers & scanners, and
   print a Windows test page. A USB cable alone does not install every driver.
3. Double-click CONFIGURE-PRINT-AGENT.bat inside backend\print-agent.
   Enter the exact printer name. Accept the default backend address unless your
   backend differs. Enter AGENT_SECRET from the deployed backend's environment.
   The backend and kiosk must use exactly the same secret. Do not send it in chat.
   If the backend has no AGENT_SECRET, configure one there first and redeploy.
4. Double-click TEST-PRINTER.bat. This prints one clearly labelled TEST receipt,
   without creating a reservation. Check the text and QR on the paper.
5. Right-click INSTALL-AUTOSTART.bat and choose Run as administrator.
   Accept the Windows administrator prompt. The agent starts now and at every
   Windows boot, including before sign-in. It reconnects after internet outages
   and restarts after errors. Do not also run the manual start file.
6. Open the kiosk website and confirm the printer shows connected. Generate a
   real ticket only when ready to reserve a seat.

Logs: backend\print-agent\logs\agent.log
Task Scheduler name: TELE-PORT Print Agent
Backend address: wss://teleport-3qfa.onrender.com/api/printer/agent
Configuration: backend\print-agent\.env (contains a private secret)
After editing configuration, restart the task in Windows Task Scheduler.

Troubleshooting:
- Not installed: check PRINTER_NAME matches the Windows printer name exactly.
- Offline/paused/paper out: check printer power, USB cable, paper and print queue.
- HTTP 401: the agent secret does not match the deployed backend.
- Connected but QR absent: the printer must support ESC/POS native QR commands.
- Another agent replaces this one: close the other agent; one kiosk is supported.
- Windows accepting a job does not prove paper came out. Inspect the printer
  before retrying an uncertain job to avoid a duplicate ticket.

Remove startup: run REMOVE-AUTOSTART.ps1 in Administrator PowerShell.
