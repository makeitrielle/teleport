# ESP32-WROVER-E to A7670: verified wiring reference

Source: LilyGO T-A7670X-V1.4.pdf, published in the manufacturer's repository. Schematic sheets are dated 2024-05-23. This is an exact transcription of the relevant circuits in that revision, not a confirmation that every R2-labelled retail board uses this PCB revision. Check the PCB revision printed on your actual board before copying the complete design.

The source modem symbol is named A7670C_R2. Use the exact A7670E/GNSS package and variant documentation when selecting a physical modem or PCB footprint. The symbol in the user's screenshot has different pin numbers and must not be used unchanged.

These are internal PCB connections. They are already present on an assembled LilyGO board. External Mega wiring remains D18/TX1 -> 1 kohm -> GPIO21 node -> 2 kohm -> GND; GPIO22 -> Mega D19/RX1; common GND. Power the assembled LilyGO using its supported power input.

## Main UART and DTR/RI connections

ESP32 module pad numbers are shown separately from GPIO numbers. U3 below refers to the official schematic's RS0108YQ20 translator.

| ESP32-WROVER module connection | Translator connection | Modem connection |
|---|---|---|
| GPIO26, module pad 11 (ESP TX) | U3 B7 pad 13 <-> A7 pad 8 | A7 -> RV9 100 ohm -> RXD pad 10 |
| GPIO27, module pad 12 (ESP RX) | U3 B8 pad 12 <-> A8 pad 9 | TXD pad 9 -> RV10 100 ohm -> A8 |
| GPIO25, module pad 10 | U3 B3 pad 17 <-> A3 pad 4 | A3 -> DTR pad 3 |
| GPIO33, module pad 9 | U3 B2 pad 18 <-> A2 pad 3 | RI pad 4 -> A2; optional to the current tracker software |

Translator supply and enable:

- U3 VCCA pad 2 -> modem VDD_1V8 output pad 15.
- U3 VCCB pad 19 -> ESP32 3.3V rail (V3V).
- U3 GND pad 11 -> common GND.
- U3 OE pad 10 -> RV31 10 kohm -> VDD_1V8.
- C26 100 nF: VCCA to GND; C27 100 nF: VCCB to GND.
- U3 A1 pad 1 -> RV29 47 kohm -> GND.
- U3 B1 pad 20 -> RV30 47 kohm -> GND.
- Channels A4-A6/B4-B6 are unconnected in this sheet.
- C15 1 uF / 6.3V decouples the modem VDD_1V8 rail to GND.

The UART logic conversion is required for bare modules. It is not replaced by simply crossing two wires between unprotected 3.3V and modem-domain I/O.

## Power-key driver

- ESP32 GPIO4, module pad 26 -> RV6 4.7 kohm -> Q2 base.
- Q2 = PMBT3904 NPN transistor.
- Q2 emitter -> GND.
- Q2 collector -> modem PWRKEY pad 1.
- RV8 47 kohm between Q2 base and GND.

## Reset driver

- ESP32 GPIO5, module pad 29 -> RV1 4.7 kohm -> Q1 base.
- Q1 = PMBT3904 NPN transistor.
- Q1 emitter -> GND.
- Q1 collector -> modem NRESET pad 16.
- RV2 47 kohm between Q1 base and GND.

Use B/C/E labels from the actual PMBT3904 datasheet and PCB footprint; physical lead positions differ between transistor packages. A high ESP GPIO turns the transistor on and pulls the modem control low.

## Modem and ESP32 supply connections

- Modem VBAT pads 55, 56 and 57 all connect to the BAT rail in the official drawing.
- All modem GND pads and ESP32 GND pads connect to the common ground plane.
- Modem supply bypass components on sheet 1: C3 100 uF/16V, C4 47 uF/16V, C5 22 uF/16V, C6 100 nF, C7 33 pF, C8 10 pF.
- ESP32 VDD33 module pad 2 connects to the regulated VDD3V3 rail; ESP32 ground pads 1, 15, 38 and exposed pad 39 are grounded in the source.
- GPIO12, module pad 14, connects to the board's power-enable network on sheet 4, including D21. It is not a modem supply pin and cannot power the modem directly.
- Sheet 4 shows MT1471 (U9) USB buck circuitry, LN2220 (U10) battery boost circuitry, AP2112K-3.3V / RT9080 (U14) ESP regulator, CN3065 (U7) charging and DW06D (U8) battery protection. Copy their complete circuits from the official PDF if reproducing the entire board.
- Do not feed a bare modem's VBAT from ESP32 3V3 or connect it directly to a 5V rail. Modem power, RF layout, current capability and decoupling must follow its variant-specific hardware design.

## SIM card connections

Using U2 socket numbering from the official schematic (not arbitrary connector numbering):

| Modem | Parts / net | Official nano-SIM socket |
|---|---|---|
| USIM_VDD pad 30 | AX_SIM_VDD | U2 VCC pad 1 |
| USIM_RST pad 33 | AX_SIM_RST | U2 RST pad 2 |
| USIM_CLK pad 32 | RV18 100 ohm / AX_SIM_CLK | U2 CLK pad 3 |
| USIM_DATA pad 31 | RV17 100 ohm / AX_SIM_DATA | U2 IO pad 7 |
| Common GND | GND | U2 pads 4, 5, 8, 9, 10 |

C16 = 100 nF from AX_SIM_VDD to GND. D10, D12 and D13 are ESD3.3V88D-LA protections for the SIM signals. Confirm the pinout of the particular socket footprint; pad 6/VPP is unconnected in the source.

## Antennas in the official GPS-equipped symbol

- LTE: modem RF_ANT pad 60 -> RV5 0-ohm link -> XX1 center terminal. XX1 shield -> GND. C1 and C2 are marked NC (not fitted) in the RF matching network.
- GNSS: modem GPS_ANT pad 90 -> C28, explicitly marked 0R in the source -> XX2 center terminal. XX2 shield -> GND.
- The XX2 antenna bias branch contains L5 47 nH and RV32 10 ohm and connects to the GNSS_PWRCTL net shown in the source. C34 is marked NC. Do not substitute a GPIO or USB supply for this net.
- The schematic contains extended GNSS pads that are variant-dependent. A modem without that GNSS hardware cannot be given GPS capability by adding an antenna alone.

## Component list for the inspected modem interface

| Component | Quantity | Official references |
|---|---:|---|
| ESP32-WROVER family module, matching actual board | 1 | U6 |
| Exact A7670 modem/GNSS variant and package | 1 | U1 |
| RS0108YQ20 translator | 1 | U3 |
| PMBT3904 NPN transistor | 2 | Q1, Q2 |
| 4.7 kohm resistors | 2 | RV1, RV6 |
| 47 kohm resistors | 4 | RV2, RV8, RV29, RV30 |
| 10 kohm resistor | 1 | RV31 |
| 100 ohm UART resistors | 2 | RV9, RV10 |
| 100 nF translator capacitors | 2 | C26, C27 |
| 1 uF / 6.3V capacitor | 1 | C15 |
| Supply bypass capacitors | 6 | C3-C8, values listed above |
| Nano-SIM socket | 1 | U2 |
| 100 ohm SIM resistors | 2 | RV17, RV18 |
| 100 nF SIM capacitor | 1 | C16 |
| ESD3.3V88D-LA SIM protection | 3 | D10, D12, D13 |
| LTE RF connector | 1 | XX1 |
| GPS RF connector, GPS version | 1 | XX2 |
| 0-ohm LTE RF link | 1 | RV5 |
| 0-ohm GPS RF link | 1 | C28, unusual reference retained from source |
| 47 nH GPS bias inductor | 1 | L5 |
| 10-ohm GPS bias resistor | 1 | RV32 |

This is the component list for the inspected interface sections. It is not the complete board BOM. USB programming, regulators, battery protection, charging, LEDs and RF/USB ESD circuitry remain specified by the attached five-page manufacturer schematic. NC means not populated.

Source URL: https://github.com/Xinyuan-LilyGO/LilyGo-Modem-Series/blob/main/schematic/esp32/T-A7670X-V1.4.pdf
