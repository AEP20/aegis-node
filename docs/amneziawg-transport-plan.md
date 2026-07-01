# AmneziaWG / WireGuard Transport Selection Plan

## Goal

Add a deploy-time transport selection layer so `aegis-node` can provision either:

- `wireguard`: the current default WireGuard deployment
- `amneziawg`: an AmneziaWG-backed deployment for mobile/DPI-hostile networks

The selected transport must not become an irreversible server state. If a host was previously deployed with AmneziaWG, rerunning the playbook with `wireguard` must converge the host back to standard WireGuard. The reverse must also be true.

## Design Principles

- Keep one public product shape: VPN gateway, DNS resolver, firewall, private control plane.
- Treat WireGuard and AmneziaWG as interchangeable transport backends behind the same Aegis peer-management intent.
- Make the active backend explicit in Ansible variables, systemd services, config paths, firewall rules, and generated client profiles.
- Prefer idempotent convergence over manual migration instructions.
- Do not preserve stale backend state that could leave both transports active unintentionally.
- Keep standard WireGuard as the default unless the operator opts into AmneziaWG.

## Agreed Decisions

- Use a native host installation model for AmneziaWG, not Docker/container deployment.
- Use backend-specific interface names:
  - `wireguard` -> `wg0`
  - `amneziawg` -> `awg0`
- Keep the same VPN subnet and server address across backend switches:
  - subnet: `10.66.66.0/24`
  - server IP: `10.66.66.1`
- Treat backend switches as client-profile invalidating events. Clients should be reprovisioned/re-imported after switching between WireGuard and AmneziaWG.
- Use UDP `4500` as the default public VPN port for both transports.
- Disable the inactive backend and move its config to a backup/quarantine path instead of leaving it active or deleting it outright.
- Keep existing `/api/wg/*` routes for compatibility, and add transport-neutral `/api/vpn/*` aliases over time.
- Add a small backend adapter layer in the control plane instead of scattering `wg`/`awg` command differences through the API code.
- Assume QR provisioning is part of the intended AmneziaWG user experience. If implementation proves otherwise, fall back to `.conf` download/copy as a temporary limitation.
- Do not introduce separate `standard` and `mobile` profile modes in the first implementation. The selected backend is the profile type for now.
- When `vpn_transport: amneziawg` is selected, collect only a small set of important AmneziaWG obfuscation choices before deployment through a user-friendly terminal flow. Avoid exposing every low-level parameter unless an advanced override is explicitly configured.
- Use a conservative rollback order: prepare and validate the new backend before disabling the currently active backend.

## Split 1: Transport Abstraction And Inventory Contract

### Objective

Introduce a clear configuration contract for selecting and describing the active VPN transport without changing runtime behavior yet.

### Planned Work

- Add a top-level variable such as:

```yaml
vpn_transport: "wireguard" # wireguard | amneziawg
```

- Define backend-specific defaults:

```yaml
wireguard:
  interface: "wg0"
  port: 4500
  config_path: "/etc/wireguard/wg0.conf"

amneziawg:
  interface: "awg0"
  port: 4500
  config_path: "/etc/amnezia/amneziawg/awg0.conf"
```

- Use backend-specific interface names (`wg0`, `awg0`) while preserving a transport-neutral variable layer for shared tasks.
- Update Ansible variable naming so existing values like `wg_port`, `wg_interface`, and `wg_config_path` either:
  - remain compatibility aliases, or
  - move under a normalized `vpn_*` naming layer.
- Document the selected backend in provisioning output.
- Add validation tasks that fail early for unsupported `vpn_transport` values.

### Acceptance Criteria

- `vpn_transport: wireguard` behaves exactly like the current deployment.
- Invalid transport names fail before package/config changes are attempted.
- The chosen transport is visible in the final Ansible summary.
- No AmneziaWG package or service work is introduced in this split.

## Split 2: Backend Convergence And Service Switching

### Objective

Make the server converge to the selected backend, including package installation, service state, config files, firewall rules, and cleanup of the inactive backend.

### Implementation Notes

- AmneziaWG uses native host installation through the Amnezia PPA and the `amneziawg` package.
- The AmneziaWG backend uses `awg0`, `awg`, and `awg-quick@awg0`.
- The playbook prompts for the VPN transport at startup, defaulting to `wireguard`. Extra vars such as `-e vpn_transport=amneziawg` can still override this for automation.
- The playbook prompts for a simplified obfuscation preset when `vpn_transport: amneziawg` is selected, unless `amneziawg_obfuscation_preset` is provided as an extra var or inventory var.
- Inactive backend services are stopped before the selected backend starts, but inactive configs are quarantined only after the selected backend starts successfully.
- WireGuard admin bootstrap remains limited to `vpn_transport: wireguard`; AmneziaWG client provisioning belongs to Split 3.

### Planned Work

- Split the current `wireguard` role responsibilities into transport-neutral and backend-specific sections:
  - forwarding/sysctl
  - NAT/firewall
  - backend install
  - backend key generation
  - backend config rendering
  - backend service enable/start
- Add AmneziaWG install support for the target Ubuntu versions.
- Render AmneziaWG server config from Ansible variables.
- Ensure only the selected backend service is enabled and running.
- Stop and disable the inactive backend service.
- Remove or quarantine inactive backend config files where safe.
- Ensure firewall rules open only the selected public UDP port.
- Ensure NAT/FORWARD rules target the selected interface.
- Ensure DNS and dashboard bind to the selected VPN server IP/interface model.
- Make repeated runs idempotent across both directions:
  - `wireguard -> amneziawg`
  - `amneziawg -> wireguard`

### Acceptance Criteria

- A host deployed with `wireguard` can be changed to `amneziawg` by changing one variable and rerunning the playbook.
- A host deployed with `amneziawg` can be changed back to `wireguard` by changing one variable and rerunning the playbook.
- After convergence, only the selected backend listens on the public VPN port.
- The inactive backend is not left enabled or accidentally reachable.
- Existing peer intent can be represented in the selected backend's config.

## Split 3: Control Plane, Peer Provisioning, And Client Profiles

### Objective

Teach the control plane and generated client profiles about the active transport so dashboard provisioning produces usable configs for either backend.

### Planned Work

- Pass active transport metadata into `aegis-api.service`:

```ini
Environment="VPN_TRANSPORT=wireguard"
Environment="VPN_INTERFACE=wg0"
Environment="VPN_ENDPOINT=host:4500"
```

- Refactor control-plane service names and environment variables away from WireGuard-only assumptions where needed.
- Keep compatibility for existing API paths such as `/api/wg/provision` initially, or introduce transport-neutral aliases such as `/api/vpn/provision`.
- Generate standard WireGuard client configs when `vpn_transport=wireguard`.
- Generate AmneziaWG client configs when `vpn_transport=amneziawg`, including the selected/generated AmneziaWG-specific parameters.
- Update QR generation so mobile clients receive the correct backend profile format.
- Update monitoring/health checks so they call the correct backend CLI/service.
- Display active transport in the dashboard.
- Update README with operator-facing usage:
  - choosing a backend
  - switching backends
  - client re-import requirements
  - expected mobile tradeoffs

### Implementation Notes

- `aegis-api.service` now receives transport-neutral environment variables:
  - `VPN_TRANSPORT`
  - `VPN_TRANSPORT_LABEL`
  - `VPN_CLI`
  - `VPN_INTERFACE`
  - `VPN_ENDPOINT`
  - `VPN_CONFIG_PATH`
  - `VPN_SERVER_PUBLIC_KEY_PATH`
  - `VPN_SERVICE_NAME`
- The control-plane keeps the existing `app.services.wg` import path for compatibility, but internally treats it as the active VPN backend adapter.
- Existing `/api/wg/*` routes remain available. Transport-neutral `/api/vpn/add`, `/api/vpn/remove`, and `/api/vpn/provision` aliases are now available.
- Dashboard-generated configs and QR codes now match the selected backend:
  - `wireguard` emits standard WireGuard config.
  - `amneziawg` emits AmneziaWG config with `Jc`, `Jmin`, `Jmax`, `S1`, `S2`, and `H1-H4` values copied from the deployed server configuration.
- Health and monitor paths now use the active backend CLI (`wg` or `awg`) and service name.
- The dashboard displays active transport, endpoint, and interface from `/api/health`.
- Admin bootstrap is transport-aware:
  - `wireguard` writes a standard `peers/admin.conf`.
  - `amneziawg` writes `peers/admin.conf` with matching AmneziaWG parameters.
- AmneziaWG presets now keep `Jmin/Jmax` inside the documented `64..1024` range.

### Acceptance Criteria

- Dashboard-generated peer configs match the active backend.
- QR provisioning works for the selected backend.
- Health and peer activity reporting work for both backends or clearly degrade with a documented limitation.
- Switching backend makes old client profiles invalid or stale in a documented way.
- README explains how to choose and switch transports.

### Remaining Risks / Follow-Up

- AmneziaWG profile QR import depends on the target mobile app supporting AmneziaWG config parameters. Standard WireGuard clients are not expected to import AmneziaWG profiles.
- The control-plane adapter assumes `awg show ... dump`, `awg show ... transfer`, `awg set`, `awg genkey`, and `awg pubkey` are CLI-compatible with WireGuard tools. This should be validated on the live host after installing the package.
- Backend switching intentionally makes old client profiles stale. A future UX improvement could tag existing peer metadata with the transport used at creation time.

## Open Implementation Questions

- Which native AmneziaWG installation path is most reliable on Ubuntu 22.04/24.04: package repository, DKMS/module build, or userspace binary? Current implementation uses the Amnezia PPA package path.
- Does AmneziaWG expose enough `awg` CLI compatibility for peer add/remove/dump, or does the backend adapter need separate parsing and command paths? Current implementation assumes CLI compatibility; live deploy validation remains required.
- Which AmneziaWG obfuscation settings should be exposed in the simplified terminal selection flow, and which should remain auto-generated or advanced-only? Current implementation exposes `balanced`, `carrier`, and `quiet` presets, with optional advanced overrides.
- What exact backup/quarantine path should inactive backend configs use? Current implementation uses `<config>{{ vpn_inactive_config_suffix }}`.
- How should the dashboard label existing peers after a backend switch if the old runtime no longer reports them? Still open; old profiles should be treated as stale and reprovisioned.
- Should `/api/vpn/*` aliases ship in the first control-plane split, or should they wait until AmneziaWG provisioning is working? Implemented in Split 3 alongside backend-aware provisioning.
- What exact health checks should gate backend switchover before the currently active backend is disabled?
