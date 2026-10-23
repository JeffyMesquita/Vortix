---
name: vortix-maestri-operator
description: Use when operating Vortix through a Maestri Portal to configure, send, inspect, or reuse API requests safely.
---

# Vortix Maestri Operator

Operate Vortix through the connected Maestri Portal. Use the app's visible controls; keep API execution, storage, and credentials inside Vortix.

## Start with safe discovery

1. Confirm the Portal is showing Vortix and is connected to this agent.
2. Read `window.vortixAgent.describe()` for the current UI contract and `window.vortixAgent.snapshot()` for safe, current request state. These methods are read-only. Use the Portal's UI/DOM controls to change anything.
3. If the bridge is missing or reports an unsupported contract version, use accessible names and the `data-vortix-action`, `data-vortix-field`, and `data-vortix-region` selectors described in [the Maestri Portal guide](../../../docs/maestri-portal.md). Do not guess selectors from screen coordinates.

The snapshot intentionally omits URL and route text, parameter/header names and values, body, environment variables, credentials, and response contents. Read only the visible fields needed for the user-requested operation; never inspect password fields or storage.

## Prepare and send a request

- Confirm the environment, HTTP method, base URL, route, and request format from the visible UI. Ask the user when any required value or target is unclear; do not invent API-specific settings.
- Before **every** send, turn off **Salvar credenciais de Auth nas requests deste workspace** unless the user explicitly asked to persist credentials. Vortix writes request history before sending, and the option is enabled by default.
- Send only the operation the user requested. GET, HEAD, and OPTIONS can still change data on an API; follow the endpoint's documented behavior.
- POST, PUT, PATCH, and DELETE need explicit user consent for that specific operation. Then follow Vortix's visible `TESTE`, checkbox, and confirmation guard. Never infer consent from a checked box or snapshot state.
- Do not execute a collection or folder in bulk unless the user explicitly approved that exact scope. Inspect the plan and stop if it contains unapproved writes.
- After sending, report the HTTP status and relevant non-sensitive result. Do not repeat tokens, passwords, response secrets, or sensitive URLs in chat or screenshots.

## Persistence and boundaries

- Ask before saving a request to a collection. Keep Auth persistence disabled unless the user requested it.
- Ask before importing, exporting, deleting, clearing history, or changing backups; exports can include request data and credentials.
- Do not call Vortix or API endpoints with `fetch`, `curl`, shell commands, or another client. Do not read or write localStorage, IndexedDB, SQLite, or the secret vault.
- If storage, environment selection, Portal automation, or a confirmation fails, stop and report the visible error. Do not bypass the UI guard or recover secrets through another path.
