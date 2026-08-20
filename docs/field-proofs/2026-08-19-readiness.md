# Field-proof readiness: 2026-08-19

## Result

**Status: pending external hardware or a real telemetry source.**

The current development machine can run the complete automated capture-to-evidence regression, but it cannot honestly produce the independent field proof defined in the roadmap.

## Environment audit

- Host: macOS 26.6, build 25G70.
- Serial devices visible during the audit: `cu.Bluetooth-Incoming-Port`, `cu.debug-console`, and `cu.wlan-debug`, with matching `tty` entries.
- No USB serial radio, telemetry adapter, or identifiable physical serial source was connected.
- Active UDP sockets belonged to ordinary local applications and services; no source was identified as a real telemetry producer available for a controlled capture.
- macOS reports the host UDP drop counter as explicitly unsupported. This is expected behavior under the current platform adapter contract, not a zero-drop observation.

## Evidence completed here

- Unit and integration fixtures exercise measured Linux counters, unavailable platform states, counter reconciliation, byte accounting, tamper rejection, and bundle-version compatibility.
- Real loopback UDP and simulated Web Serial remain regression gates for the application pipeline.
- Loopback and simulation are not recorded as a physical or independent field handoff.

## Required next setup

Use one of these sources:

1. A USB serial radio or USB telemetry adapter carrying real NSL-01, NMEA 0183, or another supported decoder-pack stream.
2. A radio or base station that terminates the over-air link and forwards real telemetry to a dedicated UDP port on the laptop.
3. Ground-control software or a network multicast publisher that sends a documented copy of real device telemetry to NarrowsLink.

Then follow [the independent field-proof procedure](README.md), transfer the resulting `.nlb` to a second installation and recipient, and append a new dated proof record. Do not replace this pending record with a loopback result.
