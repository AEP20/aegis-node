# Control Plane Operations Settings Plan

## Goal

Evolve the dashboard from a monitoring-only control plane into a small operator console for safe, explicit node maintenance.

The settings surface should help an operator answer and act on questions such as:

- Will the VPN survive the next reboot?
- Is DNS privacy configured the way I expect?
- Are stale peers accumulating?
- Are updates, logs, fail2ban, and provisioning defaults in a healthy state?
- Can I perform routine maintenance without SSHing into the VPS?

This plan intentionally avoids implementing every setting at once. It defines a split roadmap so each group can be designed, shipped, and validated independently.

## Product Shape

### Recommended Direction

Rename the current `Performance` tab to `Operations`.

The existing performance metrics remain as the top section, but the page gains small operational sections below it:

- Performance
- Privacy
- Maintenance
- Access
- Peer Policy

This keeps the sidebar compact while avoiding a misleading situation where broad node settings live under a narrow `Performance` label.

### Alternative

Add a separate `Settings` sidebar item.

This is cleaner once settings become large, but it increases navigation surface. Defer this until the Operations page becomes too dense or until settings need multiple subpages.

## Design Principles

- Prefer status plus one safe action over many knobs.
- Make dangerous actions explicit and confirm them.
- Do not expose raw browsing domains, private keys, or sensitive logs in the UI.
- Keep root privileges behind narrow helper commands, not broad shell access.
- Settings must be idempotent: toggling on/off should converge system files and services to a known state.
- Every setting should show current state, not only desired state.
- Avoid writing settings that require a full playbook rerun unless the UI clearly says so.
- Prefer policy presets over open-ended free-form values for the first version.

## Security Model

The control plane runs as the `aegis` user and should not gain general-purpose root access.

Privileged actions should use small root-owned helpers installed by Ansible, exposed through narrow `sudoers` entries, for example:

```text
aegis ALL=(ALL) NOPASSWD: /usr/local/sbin/aegis-dns-privacy status
aegis ALL=(ALL) NOPASSWD: /usr/local/sbin/aegis-dns-privacy enable
```

Each helper should:

- accept a small enum of actions
- emit JSON
- validate configs before restarting services
- roll back config writes if validation or restart fails
- avoid printing sensitive values

## Split 0: Page Information Architecture

### Objective

Rename/reframe the existing Performance page so future settings have a natural home.

### Planned Work

- Rename sidebar item from `performance` to `operations` or keep route/tab id as `performance` while displaying `Operations`.
- Keep existing performance cards and live bandwidth section.
- Add section headers:
  - Performance
  - Privacy
  - Maintenance
- Ensure the page still works on mobile without creating an overloaded settings wall.

### Acceptance Criteria

- Existing performance metrics still work unchanged.
- The page title and sidebar label no longer imply that maintenance settings are performance-only.
- No new privileged action is introduced in this split.

## Split 1: DNS Privacy Controls

### Objective

Reduce resolver-level recent domain residue without claiming to erase complete browsing history.

### Current Context

Observed current behavior:

- Unbound query logging is off.
- Disk DNS query logs were not found.
- iptables traffic logging was not found.
- packet capture / flow collector processes were not found.
- Unbound cache can still expose recent resolver-level domain residue.

### Planned Work

- Add a small DNS Privacy card under Operations.
- Provide:
  - `privacy mode` toggle
  - `flush now` action
  - status line with cache count, TTL, query logging state, and auto-flush state
- Privacy mode policy:
  - `cache-max-ttl: 900`
  - `cache-min-ttl: 0`
  - `prefetch: no`
  - query/reply logging disabled
  - auto flush every 15 minutes
- Do not show cached domain names in the UI.

### Acceptance Criteria

- Manual flush clears Unbound cache without exposing domains.
- Privacy mode converges Unbound config and timer state.
- Disabling privacy mode returns to Aegis standard DNS cache policy.
- Unbound config is validated before restart.
- A failed update rolls back to the previous config.

## Split 2: Update And Reboot Policy

### Objective

Prevent kernel update/reboot surprises from silently breaking the VPN.

### Planned Work

- Show update/reboot status:
  - reboot required
  - running kernel
  - newest installed kernel
  - pending kernel mismatch
  - unattended-upgrades state
- Add a `next boot check` status:
  - current VPN transport service enabled
  - active interface type available
  - DKMS module installed for current kernel
  - headers installed for current kernel
  - if a newer kernel is installed, headers/module readiness for that kernel
- Keep existing reboot schedule/cancel controls.
- Add a preflight check before scheduling reboot.

### Acceptance Criteria

- If AmneziaWG module is missing for the boot target kernel, the UI warns before reboot.
- Reboot action is still possible, but requires confirmation when preflight fails.
- The check is read-only unless the operator chooses a repair action in a later split.

## Split 3: VPN Service Guard

### Objective

Expose the health of the active VPN backend and provide minimal recovery actions.

### Planned Work

- Show:
  - active transport
  - systemd service state
  - interface up/down
  - public UDP listen port
  - peer count
  - latest handshake freshness
- Add advanced actions:
  - restart VPN service
  - restart control-plane API
  - restart DNS resolver
- Gate restart actions behind confirmation.

### Acceptance Criteria

- Status works for both WireGuard and AmneziaWG.
- Restart actions only target known services from the active transport metadata.
- UI clearly warns that restarting VPN may disconnect active clients.

## Split 4: DNS Mode

### Objective

Let the operator choose how Unbound talks to upstream DNS resolvers.

### Initial Implementation

The first implementation uses safe presets only:

- Cloudflare
- Quad9
- Google

Each preset can be applied with DNS-over-TLS enabled or disabled. Custom resolver input is deferred so the initial UI can stay compact and avoid writing arbitrary resolver values through the control plane.

### Planned Work

- Add a DNS mode card:
  - DoT enabled/disabled
  - upstream preset:
    - Cloudflare
    - Quad9
    - Google
- For DoT mode, store both IP address and TLS name in the helper preset map.
- Validate generated Unbound config with `unbound-checkconf`.
- Restart Unbound only after validation succeeds.

### Acceptance Criteria

- Switching resolver updates Unbound forward-zone config.
- DoT on uses `@853#tls.name`.
- DoT off uses plain forward addresses.
- Unsupported presets are rejected before helper execution.

### Open Questions

- Should Quad9 security blocking be the recommended privacy/security preset?
- Should custom resolver support IPv6 addresses in the first version?
- Should the UI include a DNS test query after switching?

## Split 5: Peer Inactivity Cleanup

### Objective

Make stale peer management easy without accidentally deleting valid devices.

### Initial Implementation

The first implementation is review-first:

- operator chooses an inactivity window
- stale peers are listed
- operator selects peers to remove
- admin/bootstrap peer is excluded from stale cleanup

No automatic peer deletion is included.

### Planned Work

- Show stale peer policy:
  - inactive for 30/60/90 days
  - never auto-delete by default
- Add a stale peer review view:
  - peer label
  - allowed IP
  - last handshake age
  - created_at
- Add batch remove for selected stale peers.

### Acceptance Criteria

- No automatic peer deletion ships in the first split.
- Admin/bootstrap peer is protected from batch removal.
- Deleting peers uses existing peer removal path and updates metadata consistently.

## Split 6: Provisioning Defaults

### Objective

Move repeated provisioning choices into operator-configurable defaults.

### Initial Implementation

Provisioning defaults are stored in a small JSON file owned by the control-plane user. They apply only to newly provisioned peers.

Initial defaults:

- label prefix
- include DNS in generated client config
- persistent keepalive
- client MTU

### Planned Work

- Add defaults for:
  - peer label prefix
  - persistent keepalive
  - client MTU
  - DNS enforcement
- Keep generated configs transport-aware.
- Include current defaults in provisioning UI.

### Acceptance Criteria

- New peers inherit configured defaults.
- Existing peers are not silently rewritten.
- Defaults are visible before generating a new profile.

## Split 7: Access Control

### Objective

Improve dashboard access safety without introducing user management complexity.

### Initial Implementation

Keep auth behavior unchanged on deploy, but make token posture visible and rotatable:

- show whether token auth is enabled
- show bind host/port and warn on public/all-interface binds
- initialize a file-backed dashboard token from the existing Ansible token without overwriting later rotations
- rotate the token from the UI and show the new token once
- make token validation read the token file dynamically, so rotation invalidates old sessions without restarting the API

### Planned Work

- Optional session timeout.
- Recovery workflow if a token is rotated and lost.

### Acceptance Criteria

- Token rotation does not print old tokens.
- Rotating token takes effect safely without API restart.
- The open browser tab can continue with the new token, but stored session auth is cleared after rotation.

## Split 8: Logging Profile

### Objective

Offer clear operational log retention presets without pretending to erase provider-side metadata.

### Initial Implementation

Add reversible local logging profiles that are inert until an operator selects one:

- `Standard`: mirrors the existing auth log retention posture and leaves journald at system default
- `Minimal`: caps journald and shortens local `auth.log` / `fail2ban.log` retention
- display DNS query logging status and iptables traffic logging rule count as guard signals
- keep this separate from DNS Privacy, which controls resolver cache residue

### Planned Work

- Add richer explanations for exactly which local files are affected.
- Consider a dry-run view before applying profile changes.

### Acceptance Criteria

- UI distinguishes local operational logs from traffic/domain history.
- Enabling Minimal does not break fail2ban's ability to protect SSH.
- The profile is reversible.

## Split 9: Fail2ban Controls

### Objective

Expose enough fail2ban control for emergency operations.

### Initial Implementation

Expose emergency controls without changing jail policy by default:

- show `sshd` and `recidive` jail availability/counts
- show total currently banned count
- unban an explicit validated IP from available jails
- restart fail2ban manually
- expose the high-impact live policy values:
  - SSH max retry
  - SSH findtime
  - SSH ban time
  - recidive ban time
- write UI changes to `/etc/fail2ban/jail.d/aegis-control-plane.local`
- leave the Ansible-rendered default jail config unchanged until an operator saves policy changes

### Planned Work

- Add advanced jail restart affordance if the Operations surface becomes crowded.
- Add a reset-to-provisioned-defaults action if operators need quick rollback.

### Acceptance Criteria

- Unban requires an explicit IP address.
- Recent bans remain read-only unless Logging Profile later changes retention.
- Fail2ban unavailable state is handled gracefully.

## Split 10: Network Performance Tuning

### Objective

Expose a small number of high-impact network tuning controls.

### Initial Implementation

Keep live network state read-only and make tuning presets apply only to future peer configs:

- show current interface MTU
- show interface drop counters
- show active backend listen port
- keep latency in the existing performance cards
- add provisioning presets:
  - `default`: automatic MTU, keepalive 25
  - `mobile`: MTU 1280, keepalive 25
  - `conservative`: MTU 1360, keepalive 25
- do not rewrite existing peer configs
- do not change the live interface automatically

### Planned Work

- Consider explicit live MTU changes only after a separate confirmation and rollback story exists.

### Acceptance Criteria

- The UI warns when a setting only affects newly provisioned peers.
- Live interface changes are clearly separated from provisioning defaults.
- No automatic tuning runs without operator confirmation.

## Split 11: Maintenance Actions

### Objective

Collect safe one-off maintenance actions in an advanced section.

### Initial Implementation

Add an Advanced Maintenance card with compact result messages:

- flush DNS cache
- restart Unbound
- restart VPN service
- restart API
- save iptables rules
- run DKMS health check
- reuse narrow helper subcommands instead of broad command execution
- keep raw logs out of the dashboard response by default

### Planned Work

- Add optional detail disclosure if operators need command output later.

### Acceptance Criteria

- Every action has a specific helper or whitelisted command.
- Dangerous actions require confirmation.
- Results include success/failure and a short operator-friendly message.

## Suggested Implementation Order

Implemented order:

1. Split 0: Rename/reframe Performance to Operations.
2. Split 1: DNS Privacy Controls.
3. Split 2: Update And Reboot Policy.
4. Split 3: VPN Service Guard.
5. Split 4: DNS Mode.
6. Split 5: Peer Inactivity Cleanup.
7. Split 6: Provisioning Defaults.
8. Split 7: Access Control.
9. Split 8: Logging Profile.
10. Split 9: Fail2ban Controls.
11. Split 10: Network Performance Tuning.
12. Split 11: Maintenance Actions.

## Open Questions

Resolved product decisions:

- Page name: use `Operations`.
- Settings source of truth: helpers should read and converge real system config first. Avoid a separate JSON settings store until multiple settings need shared state.
- Advanced actions: show basic status by default; put disruptive actions behind confirmation, and later behind an `advanced` disclosure if the page gets dense.
- Public API: settings endpoints should remain authenticated and VPN-only. Do not create unauthenticated settings endpoints.
- DNS Privacy: keep it a simple toggle for now. Expose TTL/interval only if operators ask for more control.
- Cached DNS domains: never show cached domain names in the dashboard. Show counts and policy state only.
- Audit log: do not add a dedicated settings audit log for now. This avoids creating a new metadata surface while privacy/logging policy is still being shaped.

Remaining open questions:

- Should custom DNS resolver mode support IPv6 addresses in the first version?
- Should custom DNS resolver mode be added at all, or are safe presets enough for this project?
