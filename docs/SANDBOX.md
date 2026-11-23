# Render sandbox

Imported HTML/CSS/JS is untrusted code. `src/render/sandbox.ts` runs it with these protections:

| Protection | How |
|---|---|
| Fresh browser per render | `chromium.launch()` per call; the process is closed afterwards |
| Offline | Every request is intercepted. URL imports are recorded once into a HAR file and replayed; anything not in the recording is blocked. Only files inside the fixture/import directory are served from the virtual origin `http://fixture.local`. Everything else (any host, WebSockets) is blocked and recorded in `blockedRequests`. |
| No path traversal | Resolved paths must stay inside the import directory (`resolveFixturePath`) |
| Hard time limit | Default 30 s for the whole render. On timeout the browser is closed, which also kills a renderer stuck in an infinite loop. |
| No persistence | Service workers blocked, downloads off, no permissions granted, new context each time |
| Determinism | Fixed clock (`2026-01-01T00:00:00Z`), seeded `Math.random`, UTC timezone, `en-GB` locale, light colour scheme, sRGB colour profile, device scale factor 1 |

## URL import is the exception

`importUrl` (`src/import/index.ts`) records a live page once, so it **does** use the
network and runs the site's JavaScript against the live site. It uses its own browser,
with no permissions, downloads or service workers. After recording, every render of
that import is offline. In production, run recording on a separate worker from rendering.

## Still required for production

The in-process protections above are not a full security boundary. When the render
service is deployed, also run each render:

- in a container with **no outbound network** at the network layer (not just request interception),
- with CPU and memory limits (cgroups) and a process-count limit,
- as an unprivileged user with a read-only filesystem except a temp directory,
- on a separate host or pool from anything holding user data or credentials.
