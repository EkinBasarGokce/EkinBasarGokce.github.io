---
org: Beespenser Technology Inc.
location: İstanbul
kind: industry
roles:
  - title: Lead Developer
    end: 2026-10
  - title: Full Stack Engineer
    start: "2025"
tags: [Tauri, React, FastAPI, Node.js, Rust, SQLite]
order: 10
---
- Built the Beespenser desktop app end to end: a Tauri app with a React and Vite frontend, a FastAPI backend and a Node.js sidecar, run by a Rust host process that manages the sidecars and the serial connection.
- The backend streams G-code to Marlin firmware in real time with WebSocket telemetry, and includes a geometry engine with alignment and surface following.
- Kept the architecture documented with decision records and a glossary, on a versioned SQLite store.
