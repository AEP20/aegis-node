// aegis-node/control-plane/app/static/app.js

const API = {
  token: null,

  headers() {
    return {
      "Content-Type": "application/json",
      "X-Aegis-Token": this.token || "",
    };
  },

  async get(path) {
    const res = await fetch(path, { headers: this.headers() });
    if (res.status === 401 || res.status === 403) { logout(); throw new Error("unauthorized"); }
    if (!res.ok) throw await apiError(res);
    return res.json();
  },

  async post(path, body) {
    const res = await fetch(path, { method: "POST", headers: this.headers(), body: JSON.stringify(body) });
    if (res.status === 401 || res.status === 403) { logout(); throw new Error("unauthorized"); }
    if (!res.ok) throw await apiError(res);
    return res.json();
  },

  async request(method, path, body) {
    const opts = { method, headers: this.headers() };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(path, opts);
    if (res.status === 401 || res.status === 403) { logout(); throw new Error("unauthorized"); }
    if (!res.ok) throw await apiError(res);
    return res.json();
  },
};

async function apiError(res) {
  try {
    const body = await res.json();
    return new Error(body.detail || body.message || res.statusText);
  } catch {
    return new Error(res.statusText || `HTTP ${res.status}`);
  }
}

let activeTransport = {
  transport: "wireguard",
  transport_label: "WireGuard",
  interface: "wg0",
  endpoint: "",
  server_ip: "10.66.66.1",
};

// ── Auth ─────────────────────────────────────────────────

const loginScreen = document.getElementById("login-screen");
const appEl       = document.getElementById("app");
const loginForm   = document.getElementById("login-form");
const tokenInput  = document.getElementById("token-input");
const loginError  = document.getElementById("login-error");

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const token = tokenInput.value.trim();
  if (!token) return;

  API.token = token;
  loginError.classList.add("hidden");

  try {
    await API.get("/api/health");
    // success
    sessionStorage.setItem("aegis_token", token);
    showApp();
  } catch {
    loginError.classList.remove("hidden");
    API.token = null;
  }
});

document.getElementById("logout-btn").addEventListener("click", logout);

function logout() {
  sessionStorage.removeItem("aegis_token");
  API.token = null;
  appEl.classList.add("hidden");
  loginScreen.classList.remove("hidden");
  tokenInput.value = "";
}

function showApp() {
  loginScreen.classList.add("hidden");
  appEl.classList.remove("hidden");
  loadOverview();
  loadPeers();
}

// Auto-login from session
const saved = sessionStorage.getItem("aegis_token");
if (saved) {
  API.token = saved;
  API.get("/api/health")
    .then(() => showApp())
    .catch(() => {
      sessionStorage.removeItem("aegis_token");
      API.token = null;
    });
}

// ── Navigation ───────────────────────────────────────────

const navItems = document.querySelectorAll(".nav-item");
const tabs     = document.querySelectorAll(".tab");

navItems.forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.tab;

    navItems.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    tabs.forEach((tab) => {
      tab.classList.toggle("hidden", tab.id !== `tab-${target}`);
    });

    if (target === "peers")   loadPeers();
    if (target === "monitor") loadMonitor();
    if (target === "performance") loadPerformance();
  });
});

// ── Overview ─────────────────────────────────────────────

async function loadOverview() {
  try {
    const data = await API.get("/api/health");
    renderHealth(data);
  } catch (e) {
    if (e.message !== "unauthorized") console.error(e);
  }
}

function renderHealth(d) {
  activeTransport = { ...activeTransport, ...d };

  const vpnDot   = document.getElementById("vpn-dot");
  const vpnLabel = document.getElementById("vpn-label");

  if (d.vpn_up) {
    vpnDot.className = "status-dot dot-up";
    vpnLabel.textContent = "vpn up";
    document.getElementById("stat-vpn").textContent = "up";
    document.getElementById("stat-vpn").style.color = "var(--green)";
  } else {
    vpnDot.className = "status-dot dot-down";
    vpnLabel.textContent = "vpn down";
    document.getElementById("stat-vpn").textContent = "down";
    document.getElementById("stat-vpn").style.color = "var(--red)";
  }

  document.getElementById("stat-total").textContent  = d.peers_total ?? "—";
  document.getElementById("stat-active").textContent = d.peers_active ?? "—";

  const ts = d.timestamp ? new Date(d.timestamp * 1000) : null;
  document.getElementById("stat-time").textContent = ts
    ? ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "—";

  // static info from service env (best-effort)
  const endpointEl = document.getElementById("info-endpoint");
  const subnetEl   = document.getElementById("info-subnet");
  const interfaceEl = document.getElementById("info-interface");
  const transportEl = document.getElementById("info-transport");
  if (endpointEl) endpointEl.textContent = d.endpoint || "configured via env";
  if (subnetEl) subnetEl.textContent = d.server_ip ? d.server_ip.replace(/\.\d+$/, ".0/24") : "10.66.66.0/24";
  if (interfaceEl) interfaceEl.textContent = d.interface || "—";
  if (transportEl) transportEl.textContent = d.transport_label || d.transport || "—";
  renderTransportBadge(d);
  updateProvisionCopy();
}

document.getElementById("refresh-btn").addEventListener("click", loadOverview);

function renderTransportBadge(d) {
  const transport = (d.transport || activeTransport.transport || "unknown").toLowerCase();
  const label = d.transport_label || activeTransport.transport_label || transport || "—";
  const mark = transport === "amneziawg" ? "AWG" : transport === "wireguard" ? "WG" : "?";

  const badge = document.getElementById("transport-badge");
  const badgeMark = document.getElementById("transport-badge-mark");
  const badgeName = document.getElementById("transport-badge-name");
  const sidebar = document.getElementById("sidebar-transport");
  const sidebarMark = sidebar?.querySelector(".transport-mark");
  const sidebarName = document.getElementById("sidebar-transport-name");

  if (badge) badge.className = `transport-badge transport-${transport}`;
  if (badgeMark) badgeMark.textContent = mark;
  if (badgeName) badgeName.textContent = label;

  if (sidebar) sidebar.title = `Active transport: ${label}`;
  if (sidebarMark) {
    sidebarMark.className = `transport-mark transport-mark-${transport}`;
    sidebarMark.textContent = mark;
  }
  if (sidebarName) sidebarName.textContent = label;
}

// ── Peers ─────────────────────────────────────────────────

async function loadPeers() {
  const list = document.getElementById("peers-list");
  list.innerHTML = `<p class="empty-state">loading…</p>`;

  try {
    const data = await API.get("/api/peers");
    renderPeers(data.peers ?? []);
  } catch (e) {
    if (e.message !== "unauthorized") {
      list.innerHTML = `<p class="empty-state" style="color:var(--red)">failed to load peers</p>`;
    }
  }
}

function renderPeers(peers) {
  const list = document.getElementById("peers-list");

  if (!peers.length) {
    list.innerHTML = `<p class="empty-state">no peers configured</p>`;
    return;
  }

  list.innerHTML = peers.map((p) => {
    const shortKey = p.public_key.slice(0, 20) + "…";
    const age      = p.handshake_age_human ?? "never";
    const badge    = p.is_active
      ? `<span class="badge badge-active">● active</span>`
      : `<span class="badge badge-idle">○ idle</span>`;
    const label    = p.label || "";
    const isAdmin   = p.is_admin || false;
    const ageSec    = p.handshake_age_seconds;
    // 7 days = 604800s. Consider stale if no handshake occurred (null).
    const isStale   = ageSec === null || ageSec === undefined || ageSec > 604800;
    const createdAt = p.created_at
      ? new Date(p.created_at * 1000).toLocaleString([], {
          month: "short", day: "numeric",
          hour: "2-digit", minute: "2-digit",
        })
      : null;

    const adminBadge = isAdmin
      ? '<span class="peer-admin-badge">admin</span>'
      : '';
    const staleBadge = isStale && !p.is_active
      ? '<span class="badge badge-stale" title="No handshake in 7+ days">⚠ stale</span>'
      : '';
    const labelHtml   = label
      ? '<span class="peer-label-display">' + label + '</span>'
      : '';
    const createdHtml = createdAt
      ? '<span class="peer-created">created ' + createdAt + '</span>'
      : '';

    return `
      <div class="peer-row${isAdmin ? ' admin-row' : ''}">
        <div class="peer-key-wrap">
          <div class="peer-key-line">
            <span class="peer-key" title="${p.public_key}">${shortKey}</span>
            ${adminBadge}
          </div>
          ${labelHtml}${createdHtml}
        </div>
        <span class="peer-ip mono">${p.allowed_ips}</span>
        <span class="peer-age">${age} ago</span>
        ${badge} ${staleBadge}
        <div class="peer-actions">
          <button class="btn btn-ghost btn-small label-edit-btn" data-key="${p.public_key}" data-label="${label}" title="edit label">✎</button>
          <button class="btn btn-danger remove-btn" data-key="${p.public_key}">remove</button>
        </div>
      </div>`;
  }).join("");

  list.querySelectorAll(".remove-btn").forEach((btn) => {
    btn.addEventListener("click", () => removePeer(btn.dataset.key));
  });
  list.querySelectorAll(".label-edit-btn").forEach((btn) => {
    btn.addEventListener("click", () => openLabelEdit(btn));
  });
}

function openLabelEdit(btn) {
  const key  = btn.dataset.key;
  const row  = btn.closest(".peer-row");
  const wrap = row.querySelector(".peer-key-wrap");

  // close if already open
  if (wrap.querySelector(".label-edit-wrap")) {
    wrap.querySelector(".label-edit-wrap").remove();
    return;
  }

  // create label span if not exists (empty label)
  let labelSpan = wrap.querySelector(".peer-label-display");
  if (!labelSpan) {
    labelSpan = document.createElement("span");
    labelSpan.className = "peer-label-display";
    labelSpan.textContent = "";
    // append after key-line
    const keyLine = wrap.querySelector(".peer-key-line") || wrap.querySelector(".peer-key");
    keyLine.insertAdjacentElement("afterend", labelSpan);
  }

  const editWrap = document.createElement("div");
  editWrap.className = "label-edit-wrap";
  editWrap.innerHTML =
    '<input class="label-input" type="text"' +
    ' value="' + (labelSpan.textContent || "") + '"' +
    ' placeholder="e.g. MacBook Pro" maxlength="40" />' +
    '<button class="btn btn-primary btn-small" style="padding:3px 10px">save</button>' +
    '<button class="btn btn-ghost btn-small" style="padding:3px 8px">✕</button>';

  wrap.appendChild(editWrap);
  editWrap.querySelector(".label-input").focus();

  const saveLabel = async () => {
    const val = editWrap.querySelector(".label-input").value.trim();
    try {
      await API.post("/api/peers/label", { public_key: key, label: val });
      labelSpan.textContent = val;
      editWrap.remove();
    } catch { /* ignore */ }
  };

  editWrap.querySelectorAll("button")[0].addEventListener("click", saveLabel);
  editWrap.querySelectorAll("button")[1].addEventListener("click", () => editWrap.remove());
  editWrap.querySelector(".label-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter")  saveLabel();
    if (e.key === "Escape") editWrap.remove();
  });
}


async function removePeer(pubkey) {
  if (!confirm("Remove peer?")) return;
  try {
    await API.post("/api/vpn/remove", { public_key: pubkey });
    loadPeers();
    loadOverview();
  } catch (e) {
    if (e.message !== "unauthorized") alert("Failed to remove peer");
  }
}

document.getElementById("peers-refresh-btn").addEventListener("click", loadPeers);

// Add peer form
const addPeerForm = document.getElementById("add-peer-form");
const addPeerMsg  = document.getElementById("add-peer-msg");

addPeerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const pk = document.getElementById("peer-pubkey").value.trim();
  const ip = document.getElementById("peer-ip").value.trim();

  addPeerMsg.className = "form-msg hidden";

  if (!pk || !ip) {
    showMsg(addPeerMsg, "public key and allowed ip required", false);
    return;
  }

  try {
    const res = await API.post("/api/vpn/add", { public_key: pk, allowed_ip: ip });
    if (res.status === "ok") {
      showMsg(addPeerMsg, "peer added", true);
      addPeerForm.reset();
      loadPeers();
      loadOverview();
    } else {
      showMsg(addPeerMsg, res.message || "error adding peer", false);
    }
  } catch (e) {
    if (e.message !== "unauthorized") showMsg(addPeerMsg, "request failed", false);
  }
});

function showMsg(el, text, ok) {
  el.textContent = text;
  el.className   = `form-msg ${ok ? "ok" : "err"}`;
}

// ── Provision ─────────────────────────────────────────────

const provisionBtn    = document.getElementById("provision-btn");
const provisionResult = document.getElementById("provision-result");

function updateProvisionCopy() {
  const desc = document.getElementById("provision-desc");
  const label = activeTransport.transport_label || "VPN";
  if (desc) {
    desc.textContent =
      `Generates a fresh ${label} keypair, allocates the next available IP, ` +
      "adds the peer to the live interface and config, then returns a client config and scan-ready QR code.";
  }
}

updateProvisionCopy();

provisionBtn.addEventListener("click", async () => {
  provisionBtn.textContent = "generating…";
  provisionBtn.disabled = true;
  provisionResult.classList.add("hidden");
  provisionResult.classList.remove("visible");

  try {
    const data = await API.post("/api/vpn/provision", {});

    document.getElementById("qr-img").src       = `data:image/png;base64,${data.qr}`;
    document.getElementById("config-pre").textContent = data.config;
    document.getElementById("peer-ip-label").textContent = data.allowed_ip;
    document.getElementById("provision-pk").textContent  = data.public_key;

    document.getElementById("script-pre").textContent = data.install_command || "";

    const qrTip = document.getElementById("qr-tooltip");
    const configTip = document.getElementById("config-tooltip");
    if (qrTip && data.client_app) {
      qrTip.dataset.tooltip = `Scan with ${data.client_app} to instantly add this peer`;
    }
    if (configTip && data.client_app) {
      configTip.dataset.tooltip = `Download and import into ${data.client_app}`;
    }

    provisionResult.classList.remove("hidden");
    provisionResult.classList.add("visible");

    loadPeers();
    loadOverview();
  } catch (e) {
    if (e.message !== "unauthorized") alert("Provisioning failed. Check API logs.");
  } finally {
    provisionBtn.textContent = "generate & provision";
    provisionBtn.disabled = false;
  }
});

document.getElementById("copy-btn").addEventListener("click", () => {
  const text = document.getElementById("config-pre").textContent;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById("copy-btn");
    btn.textContent = "copied!";
    setTimeout(() => (btn.textContent = "copy config"), 1500);
  });
});

document.getElementById("copy-script-btn").addEventListener("click", () => {
  const text = document.getElementById("script-pre").textContent;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById("copy-script-btn");
    btn.textContent = "copied!";
    setTimeout(() => (btn.textContent = "copy command"), 1500);
  });
});

document.getElementById("download-btn").addEventListener("click", () => {
  const text = document.getElementById("config-pre").textContent;
  const ip = document.getElementById("peer-ip-label").textContent.split("/")[0];
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement("a");
  a.href = url;
  a.download = `aegis-${ip || 'peer'}.conf`;
  document.body.appendChild(a);
  a.click();
  
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

// ── Monitor ───────────────────────────────────────────────

let _monitorInterval = null;

async function loadMonitor() {
  try {
    const [sys, svc, traffic, ssh, timeline, f2b] = await Promise.all([
      API.get("/api/monitor/system"),
      API.get("/api/monitor/services"),
      API.get("/api/monitor/traffic"),
      API.get("/api/monitor/ssh"),
      API.get("/api/monitor/ssh/timeline?tz_offset=" + (-new Date().getTimezoneOffset())),
      API.get("/api/monitor/fail2ban"),
    ]);
    renderSystem(sys);
    renderServices(svc.services ?? []);
    renderTraffic(traffic.peers ?? []);
    renderTimeline(timeline.timeline ?? []);
    renderSSH(ssh.events ?? []);
    renderFail2ban(f2b);
  } catch (e) {
    if (e.message !== "unauthorized") console.error("monitor error", e);
  }
}

function renderSystem(d) {
  const cpu  = d.cpu_percent ?? 0;
  const mem  = d.memory?.percent ?? 0;
  const disk = d.disk?.percent ?? 0;

  document.getElementById("mon-cpu-val").textContent  = `${cpu}%`;
  document.getElementById("mon-mem-val").textContent  =
    `${d.memory?.used_mb ?? 0} MB`;
  document.getElementById("mon-disk-val").textContent =
    `${d.disk?.used_gb ?? 0} GB`;
  document.getElementById("mon-uptime").textContent   = d.uptime ?? "—";

  // Color warning
  document.getElementById("mon-cpu-val").style.color =
    cpu > 80 ? "var(--red)" : cpu > 60 ? "var(--yellow)" : "var(--text)";
  document.getElementById("mon-disk-val").style.color =
    disk > 85 ? "var(--red)" : disk > 70 ? "var(--yellow)" : "var(--text)";

  // Animated gauge
  requestAnimationFrame(() => {
    document.getElementById("mon-cpu-bar").style.width  = `${cpu}%`;
    document.getElementById("mon-mem-bar").style.width  = `${mem}%`;
    document.getElementById("mon-disk-bar").style.width = `${disk}%`;
  });

  // Reboot required banner + buttons
  const banner      = document.getElementById("reboot-banner");
  const scheduleBtn = document.getElementById("reboot-schedule-btn");
  const cancelBtn   = document.getElementById("reboot-cancel-btn");

  if (banner) {
    banner.classList.toggle("hidden", !d.reboot_required);

    if (scheduleBtn && !scheduleBtn._bound) {
      scheduleBtn._bound = true;
      scheduleBtn.addEventListener("click", async () => {
        if (!confirm("The server will restart in 5 minutes. Do you confirm?")) return;
        try {
          await API.post("/api/system/reboot", {});
          scheduleBtn.textContent = "⏳ rebooting in ~5 min…";
          scheduleBtn.disabled = true;
          cancelBtn.classList.remove("hidden");
        } catch (e) {
          alert("Reboot failed: " + e.message);
        }
      });
    }

    if (cancelBtn && !cancelBtn._bound) {
      cancelBtn._bound = true;
      cancelBtn.addEventListener("click", async () => {
        try {
          await API.request("DELETE", "/api/system/reboot");
          scheduleBtn.textContent = "⏻ reboot in 5 min";
          scheduleBtn.disabled = false;
          cancelBtn.classList.add("hidden");
        } catch (e) {
          alert("Cancellation failed: " + e.message);
        }
      });
    }
  }
}

function renderServices(services) {
  const el = document.getElementById("mon-services");
  if (!services.length) {
    el.innerHTML = `<p class="empty-state">no data</p>`;
    return;
  }
  el.innerHTML = services.map((s) => {
    const dotCls   = `svc-dot svc-${s.status}`;
    const badgeCls = `svc-badge svc-badge-${s.status}`;
    return `
      <div class="service-row">
        <span class="${dotCls}"></span>
        <span class="svc-label">${s.label}</span>
        <span class="${badgeCls}">${s.status}</span>
      </div>`;
  }).join("");
}

function renderTraffic(peers) {
  const el = document.getElementById("mon-traffic");
  if (!peers.length) {
    el.innerHTML = `<p class="empty-state">no traffic data</p>`;
    return;
  }
  el.innerHTML = `
    <table class="traffic-table">
      <thead>
        <tr>
          <th>peer</th>
          <th>↓ rx</th>
          <th>↑ tx</th>
        </tr>
      </thead>
      <tbody>
        ${peers.map((p) => `
          <tr>
            <td title="${p.public_key}">${p.label || p.public_key_short}</td>
            <td class="rx">${p.rx_human}</td>
            <td class="tx">${p.tx_human}</td>
          </tr>`).join("")}
      </tbody>
    </table>`;
}

function renderTimeline(data) {
  const wrap = document.getElementById("mon-timeline").parentElement;

  let detailEl = document.getElementById("mon-timeline-detail");
  if (!detailEl) {
    detailEl = document.createElement("div");
    detailEl.id = "mon-timeline-detail";
    detailEl.className = "timeline-detail hidden";
    wrap.appendChild(detailEl);
  }

  const el = document.getElementById("mon-timeline");
  if (!data.length) { el.innerHTML = '<p class="empty-state">no data</p>'; return; }

  const maxCount = Math.max(...data.map((d) => d.count), 1);
  const todayStr = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });

  el.innerHTML = data.map((d, idx) => {
    const isEmpty   = d.count === 0;
    const todayCls  = d.date === todayStr ? "today" : "";
    const trackCls  = "timeline-track" + (isEmpty ? " empty" : "");
    const countStr  = d.count > 0 ? String(d.count) : "";

    // Calculate dots (00:00 = 0% left, 23:59 = 100% right)
    const clusters  = _clusterLogins(d.logins || []);
    const dotsHtml  = clusters.map((c) => {
      const isCl   = c.logins.length > 1;
      const tipStr = c.logins.map((l) => l.time + "  " + l.user + " @ " + l.ip).join("\n");
      return '<div class="login-dot' + (isCl ? " cluster" : "") + '"' +
             ' style="left:' + c.avgPct.toFixed(1) + '%" title="' + tipStr + '">' +
             (isCl ? c.logins.length : "") +
             '</div>';
    }).join("");

    return [
      '<div class="timeline-col" data-idx="' + idx + '">',
        '<span class="timeline-count">' + countStr + '</span>',
        '<div class="timeline-track-wrap">',
          '<div class="' + trackCls + '">',
            dotsHtml,
          '</div>',
        '</div>',
        '<span class="timeline-date ' + todayCls + '">' + d.date + '</span>',
      '</div>',
    ].join("");
  }).join("");

  // Click -> detail panel
  el.querySelectorAll(".timeline-col").forEach((col) => {
    col.style.cursor = "pointer";
    col.addEventListener("click", (e) => {
      // stop dot clicks - they have their own tooltips
      if (e.target.classList.contains("login-dot")) return;

      const d = data[parseInt(col.dataset.idx)];

      if (col.classList.contains("selected")) {
        col.classList.remove("selected");
        detailEl.classList.add("hidden");
        detailEl.innerHTML = "";
        return;
      }
      el.querySelectorAll(".timeline-col").forEach((c) => c.classList.remove("selected"));
      col.classList.add("selected");

      if (!d.logins || d.logins.length === 0) {
        detailEl.innerHTML = '<p class="empty-state">' + d.date + " \u2014 no successful logins</p>";
      } else {
        detailEl.innerHTML =
          '<p class="timeline-detail-title">' + d.date + " \u2014 " + d.count + " successful login(s)</p>" +
          '<div class="ssh-log">' +
          d.logins.map((l) =>
            '<div class="ssh-event success">' +
              '<span class="ssh-ts">'   + l.time + "</span>" +
              '<span class="ssh-label">login</span>' +
              '<span class="ssh-user">' + l.user + "</span>" +
              '<span class="ssh-ip">'   + l.ip   + "</span>" +
              (l.geo ? '<span class="ssh-geo" title="' + l.geo + '">' + l.geo.split(' ')[0] + '</span>' : '') +
              '<span class="ssh-port"></span>' +
            "</div>"
          ).join("") +
          "</div>";
      }
      detailEl.classList.remove("hidden");
    });
  });
}

// ── Helpers ─────────────────────────────────────────────────

function _timeToPercent(timeStr) {
  // "HH:MM:SS" → 0% (00:00) … 100% (23:59) top→bottom
  const parts = (timeStr || "00:00:00").split(":").map(Number);
  const mins  = (parts[0] || 0) * 60 + (parts[1] || 0);
  return (mins / (24 * 60)) * 100;
}

function _clusterLogins(logins, thresholdMins = 45) {
  if (!logins.length) return [];

  const withPct = logins
    .map((l) => ({ ...l, pct: _timeToPercent(l.time) }))
    .sort((a, b) => a.pct - b.pct);

  const threshold = (thresholdMins / 60 / 24) * 100;
  const clusters  = [];

  for (const login of withPct) {
    const last = clusters[clusters.length - 1];
    // Calculate distance based on the FIRST login of the cluster instead of a moving average.
    // This prevents the cluster boundary from expanding while sliding.
    const anchorPct = last ? last.logins[0].pct : null;
    if (anchorPct !== null && (login.pct - anchorPct) < threshold) {
      last.logins.push(login);
      last.avgPct = last.logins.reduce((s, l) => s + l.pct, 0) / last.logins.length;
    } else {
      clusters.push({ avgPct: login.pct, logins: [login] });
    }
  }
  return clusters;
}


function renderSSH(events) {
  const el = document.getElementById("mon-ssh");
  if (!events.length) {
    el.innerHTML = `<p class="empty-state">no ssh events found</p>`;
    return;
  }
  el.innerHTML = events.map((e) => `
    <div class="ssh-event ${e.level}">
      <span class="ssh-ts">${e.timestamp}</span>
      <span class="ssh-label">${e.label}</span>
      <span class="ssh-user">${e.user}</span>
      <span class="ssh-ip">${e.ip}</span>
      ${e.geo ? `<span class="ssh-geo" title="${e.geo}">${e.geo.split(' ')[0]}</span>` : ''}
      <span class="ssh-port">:${e.port}</span>
    </div>`).join("");
}

function renderFail2ban(data) {
  const current = document.getElementById("f2b-current");
  const total   = document.getElementById("f2b-total");
  const failed  = document.getElementById("f2b-failed");
  const bansEl  = document.getElementById("mon-f2b-bans");

  if (!data || !data.available) {
    if (current) current.textContent = "—";
    if (total)   total.textContent   = "—";
    if (failed)  failed.textContent  = "—";
    if (bansEl)  bansEl.innerHTML    = `<p class="empty-state">fail2ban not available</p>`;
    return;
  }

  if (current) {
    current.textContent = data.currently_banned ?? 0;
    current.classList.toggle("has-bans", (data.currently_banned ?? 0) > 0);
  }
  if (total)  total.textContent  = data.total_banned  ?? 0;
  if (failed) failed.textContent = data.total_failed  ?? 0;

  const bans = data.recent_bans ?? [];
  if (!bans.length) {
    bansEl.innerHTML = `<p class="empty-state">no bans recorded</p>`;
    return;
  }
  bansEl.innerHTML = bans.map(b => `
    <div class="f2b-ban">
      <span class="f2b-ban-ts">${b.timestamp}</span>
      <span class="f2b-ban-jail">${b.jail}</span>
      <span class="f2b-ban-ip">${b.ip}</span>
      <span class="f2b-ban-geo">${b.geo ?? ""}</span>
    </div>`).join("");
}

document.getElementById("monitor-refresh-btn").addEventListener("click", loadMonitor);

// 30s auto-refresh - only when monitor tab is open
function startMonitorAutoRefresh() {
  clearInterval(_monitorInterval);
  _monitorInterval = setInterval(() => {
    const monTab = document.getElementById("tab-monitor");
    if (!monTab.classList.contains("hidden")) {
      loadMonitor();
    } else {
      clearInterval(_monitorInterval);
      _monitorInterval = null;
    }
  }, 30_000);
}

// start auto-refresh on nav click
document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    // clear intervals
    clearInterval(_monitorInterval);
    _monitorInterval = null;
    clearInterval(_performanceInterval);
    _performanceInterval = null;

    if (btn.dataset.tab === "monitor") {
      startMonitorAutoRefresh();
    } else if (btn.dataset.tab === "performance") {
      startPerformanceAutoRefresh();
    }
  });
});

// ── Performance Live View ────────────────────────────────────

let _perfRxBytes = 0;
let _perfTxBytes = 0;
let _perfTimestamp = 0;
let _performanceInterval = null;
let _dnsPrivacyLastLoad = 0;
let _dnsPrivacyBusy = false;
let _operationsLastLoad = 0;
let _operationsBusy = false;
let _dnsModeLastLoad = 0;
let _provisionDefaultsLastLoad = 0;
let _accessControlLastLoad = 0;
let _lastProvisioningDefaults = null;

function confirmRisk(title, details = []) {
  const lines = [title, ...details.filter(Boolean)];
  return confirm(lines.join("\n\n"));
}

function setPerfIndicator(id, txt, cls) {
  const el = document.getElementById(id);
  el.innerHTML = `<span class="perf-indicator ${cls}"></span>${txt}`;
}

async function loadPerformance() {
  try {
    const d = await API.get("/api/monitor/performance");
    
    // Active users: Green if > 0, else Neutral
    const uCls = d.active_peers > 0 ? "perf-good" : "perf-neutral";
    setPerfIndicator("perf-users-val", `${d.active_peers} / ${d.total_peers}`, uCls);
    
    // Load average (1m): compared to cores
    let lCls = "perf-good";
    if (d.load_1m >= d.cpu_cores) lCls = "perf-fail";
    else if (d.load_1m >= d.cpu_cores * 0.7) lCls = "perf-warn";
    setPerfIndicator("perf-load-val", `${d.load_1m} / ${d.load_5m} / ${d.load_15m}`, lCls);
    
    // Ping: < 50ms=Good, < 150ms=Warn, > 150ms=Fail
    let pCls = "perf-neutral";
    let pTxt = "—";
    if (d.ping_ms) {
      if (d.ping_ms < 50) pCls = "perf-good";
      else if (d.ping_ms < 150) pCls = "perf-warn";
      else pCls = "perf-fail";
      pTxt = `${d.ping_ms} ms`;
    }
    setPerfIndicator("perf-ping-val", pTxt, pCls);
    
    // Drops: 0=Good, > 0=Fail
    const dDrop = d.wg_rx_dropped + d.wg_tx_dropped;
    const dCls = dDrop === 0 ? "perf-good" : "perf-warn";
    setPerfIndicator("perf-drops-val", `${d.wg_rx_dropped} / ${d.wg_tx_dropped}`, dCls);

    
    // Bandwidth Mbps Calculation
    if (_perfTimestamp > 0) {
      const timeDiff = d.timestamp - _perfTimestamp;
      if (timeDiff > 0) {
        const rxDiff = Math.max(0, d.wg_rx_bytes - _perfRxBytes);
        const txDiff = Math.max(0, d.wg_tx_bytes - _perfTxBytes);
        
        // (bytes * 8) / 1000000 = Mbps
        const rxMbps = ((rxDiff * 8) / 1_000_000 / timeDiff).toFixed(2);
        const txMbps = ((txDiff * 8) / 1_000_000 / timeDiff).toFixed(2);
        
        document.getElementById("perf-rx-speed").textContent = `${rxMbps} Mbps`;
        document.getElementById("perf-tx-speed").textContent = `${txMbps} Mbps`;
      }
    }
    
    _perfRxBytes = d.wg_rx_bytes;
    _perfTxBytes = d.wg_tx_bytes;
    _perfTimestamp = d.timestamp;

    const now = Date.now();
    if (now - _dnsPrivacyLastLoad > 10_000) {
      _dnsPrivacyLastLoad = now;
      loadDnsPrivacyStatus();
    }
    if (now - _operationsLastLoad > 10_000) {
      _operationsLastLoad = now;
      loadOperationsStatus();
    }
    if (now - _dnsModeLastLoad > 15_000) {
      _dnsModeLastLoad = now;
      loadDnsModeStatus();
    }
    if (now - _provisionDefaultsLastLoad > 15_000) {
      _provisionDefaultsLastLoad = now;
      loadProvisioningDefaults();
    }
    if (now - _accessControlLastLoad > 15_000) {
      _accessControlLastLoad = now;
      loadAccessControlStatus();
    }
    
  } catch (e) {
    if (e.message !== "unauthorized") console.error("Perf poll err:", e);
  }
}

async function loadOperationsStatus() {
  try {
    const d = await API.get("/api/system/operations");
    renderOperations(d);
  } catch (e) {
    if (e.message !== "unauthorized") {
      const reboot = document.getElementById("ops-reboot-status");
      const vpn = document.getElementById("ops-vpn-status");
      if (reboot) reboot.textContent = "status unavailable";
      if (vpn) vpn.textContent = "status unavailable";
    }
  }
}

function renderOperations(d) {
  const update = d.update_reboot || {};
  const next = update.next_boot || {};
  const guard = d.vpn_guard || {};
  const runtime = guard.runtime || {};

  const rebootStatus = document.getElementById("ops-reboot-status");
  const runningKernel = document.getElementById("ops-running-kernel");
  const nextBoot = document.getElementById("ops-next-boot");
  const preflight = document.getElementById("ops-preflight");

  if (rebootStatus) {
    const parts = [];
    parts.push(update.reboot_required ? "reboot required" : "no reboot required");
    if (update.pending_kernel_mismatch) parts.push("new kernel pending");
    parts.push(update.unattended_upgrades?.active === "active" ? "auto updates active" : "auto updates inactive");
    rebootStatus.textContent = parts.join(" · ");
  }
  if (runningKernel) runningKernel.textContent = update.running_kernel || "—";
  if (nextBoot) nextBoot.textContent = update.boot_target_kernel || "—";
  if (preflight) {
    preflight.textContent = next.pass ? "ready" : "attention";
    preflight.className = next.pass ? "ops-good" : "ops-warn";
  }

  const vpnBadge = document.getElementById("ops-vpn-badge");
  const vpnStatus = document.getElementById("ops-vpn-status");
  const service = guard.services?.find((s) => s.name === guard.service);
  const serviceUp = service?.active === "active";
  const interfaceUp = !!runtime.interface_up;

  if (vpnBadge) {
    vpnBadge.className = serviceUp && interfaceUp ? "badge badge-active" : "badge badge-stale";
    vpnBadge.textContent = serviceUp && interfaceUp ? "healthy" : "attention";
  }
  if (vpnStatus) {
    const peerCount = runtime.peer_count ?? "—";
    const port = runtime.listen_port ? `udp/${runtime.listen_port}` : "port —";
    const address = runtime.address || "no address";
    vpnStatus.textContent = `${guard.label || "VPN"} · ${guard.interface || "—"} · ${address} · ${port} · peers ${peerCount}`;
  }

  renderLoggingProfile(d.logging_profile || {});
  renderFail2banControls(d.fail2ban_control || {});
  renderNetworkTuning(d.network_tuning || {});
}

async function runOperationsAction(action) {
  const labels = {
    "restart-vpn": "Restart VPN service? Active clients may reconnect.",
    "restart-dns": "Restart DNS resolver?",
    "restart-api": "Restart control-plane API?",
  };
  if (!confirmRisk(labels[action] || "Run action?", [
    "This action is applied immediately on the server.",
  ])) return;

  _operationsBusy = true;
  setOpsButtonsDisabled(true);
  try {
    const d = await API.post("/api/system/operations/action", { action });
    if (d.update_reboot || d.vpn_guard) renderOperations(d);
  } catch (e) {
    if (e.message !== "unauthorized" && action !== "restart-api") alert("Action failed: " + e.message);
  } finally {
    _operationsBusy = false;
    setOpsButtonsDisabled(false);
    _operationsLastLoad = 0;
    setTimeout(loadOperationsStatus, 800);
  }
}

function renderNetworkTuning(d) {
  const badge = document.getElementById("net-tuning-badge");
  const status = document.getElementById("net-tuning-status");
  const mtu = document.getElementById("net-current-mtu");
  const port = document.getElementById("net-listen-port");
  const drops = document.getElementById("net-drops");
  const rx = d.drops?.rx;
  const tx = d.drops?.tx;
  const dropCount = (rx ?? 0) + (tx ?? 0);

  if (badge) {
    badge.className = dropCount > 0 ? "badge badge-stale" : "badge badge-active";
    badge.textContent = dropCount > 0 ? "drops seen" : "clean";
  }
  if (status) status.textContent = `${d.interface || "—"} runtime status`;
  if (mtu) mtu.textContent = d.mtu ?? "—";
  if (port) port.textContent = d.listen_port ? `udp/${d.listen_port}` : "—";
  if (drops) drops.textContent = `rx ${rx ?? "—"} · tx ${tx ?? "—"}`;
}

function provisioningDefaultsSummary(d = {}) {
  const prefix = d.label_prefix ? `prefix ${d.label_prefix}` : "no prefix";
  const keepalive = d.persistent_keepalive == null ? "keepalive off" : `keepalive ${d.persistent_keepalive}`;
  const mtu = d.mtu == null ? "mtu auto" : `mtu ${d.mtu}`;
  const dns = d.dns_enabled === false ? "dns off" : "dns on";
  return `${prefix}, ${keepalive}, ${mtu}, ${dns}`;
}

function inferProvisioningPreset(d = {}) {
  const keepalive = d.persistent_keepalive == null ? null : Number(d.persistent_keepalive);
  const mtu = d.mtu == null ? null : Number(d.mtu);
  if (mtu === null && keepalive === 25) return "default";
  if (mtu === 1280 && keepalive === 25) return "mobile";
  if (mtu === 1360 && keepalive === 25) return "conservative";
  return "custom";
}

function updateNetworkPresetState(d = {}) {
  const preset = inferProvisioningPreset(d);
  const badge = document.getElementById("net-preset-badge");
  const status = document.getElementById("net-preset-status");
  ["default", "mobile", "conservative"].forEach((name) => {
    const btn = document.getElementById(`net-preset-${name}`);
    if (btn) btn.classList.toggle("btn-option-active", preset === name);
  });
  if (badge) {
    badge.className = preset === "custom" ? "badge badge-idle" : "badge badge-active";
    badge.textContent = preset;
  }
  if (status) status.textContent = `current: ${provisioningDefaultsSummary(d)}`;
}

async function applyNetworkPreset(name) {
  const presets = {
    default: { mtu: null, persistent_keepalive: 25 },
    mobile: { mtu: 1280, persistent_keepalive: 25 },
    conservative: { mtu: 1360, persistent_keepalive: 25 },
  };
  const preset = presets[name];
  const status = document.getElementById("net-preset-status");
  if (!preset) return;
  if (!confirmRisk(`Apply ${name} provisioning preset?`, [
    "This changes defaults for newly provisioned peers only.",
    "Existing peers and live interface settings will not be rewritten.",
  ])) return;
  if (status) status.textContent = "saving provisioning preset…";
  try {
    const current = await API.get("/api/system/provisioning-defaults");
    const defaults = current.defaults || {};
    const payload = {
      label_prefix: defaults.label_prefix || "",
      dns_enabled: defaults.dns_enabled !== false,
      persistent_keepalive: preset.persistent_keepalive,
      mtu: preset.mtu,
    };
    const d = await API.post("/api/system/provisioning-defaults", payload);
    renderProvisioningDefaults(d.defaults || {});
    if (status) status.textContent = `${name} preset saved for newly provisioned peers`;
  } catch (e) {
    if (e.message !== "unauthorized" && status) status.textContent = "preset save failed";
  } finally {
    _provisionDefaultsLastLoad = 0;
  }
}

async function runMaintenanceAction(action) {
  const labels = {
    "flush-dns": "Flush DNS resolver cache?",
    "save-iptables": "Save current iptables rules for persistence?",
    "dkms-check": "Run DKMS health check?",
    "restart-vpn": "Restart VPN service? Active clients may reconnect.",
    "restart-dns": "Restart DNS resolver?",
    "restart-api": "Restart control-plane API?",
  };
  const disruptive = ["save-iptables", "restart-vpn", "restart-dns", "restart-api"];
  const details = disruptive.includes(action)
    ? ["This is a live system action.", "Active clients may briefly reconnect or service state may change."]
    : [];
  if (!confirmRisk(labels[action] || "Run maintenance action?", details)) return;

  const status = document.getElementById("maintenance-status");
  const badge = document.getElementById("maintenance-badge");
  if (badge) {
    badge.className = "badge badge-idle";
    badge.textContent = "running";
  }
  if (status) status.textContent = "running action…";

  try {
    let d;
    if (action === "flush-dns") {
      d = await API.post("/api/system/dns-privacy/flush", {});
      if (status) status.textContent = "DNS cache flushed";
    } else {
      d = await API.post("/api/system/operations/action", { action });
      if (status) {
        if (action === "dkms-check") {
          status.textContent = `${d.message || "DKMS checked"} · ${d.kernel || "kernel —"}`;
        } else {
          status.textContent = d.message || d.restarting || "action completed";
        }
      }
    }
    if (badge) {
      const ok = d.pass !== false && d.status !== "error";
      badge.className = ok ? "badge badge-active" : "badge badge-stale";
      badge.textContent = ok ? "ok" : "attention";
    }
  } catch (e) {
    if (e.message !== "unauthorized") {
      if (action === "restart-api") {
        if (status) status.textContent = "API restart requested";
        if (badge) {
          badge.className = "badge badge-active";
          badge.textContent = "sent";
        }
      } else {
        if (status) status.textContent = "maintenance action failed";
        if (badge) {
          badge.className = "badge badge-stale";
          badge.textContent = "failed";
        }
      }
    }
  } finally {
    _operationsLastLoad = 0;
    if (action !== "restart-api") setTimeout(loadOperationsStatus, 800);
  }
}

function setOpsButtonsDisabled(disabled) {
  ["ops-restart-vpn", "ops-restart-dns", "ops-restart-api"].forEach((id) => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = disabled || _operationsBusy;
  });
}

async function loadAccessControlStatus() {
  try {
    const d = await API.get("/api/system/access-control");
    renderAccessControl(d);
  } catch (e) {
    if (e.message !== "unauthorized") {
      const status = document.getElementById("access-status");
      if (status) status.textContent = "access status unavailable";
    }
  }
}

function renderAccessControl(d) {
  const badge = document.getElementById("access-auth-badge");
  const status = document.getElementById("access-status");
  const bind = document.getElementById("access-bind");
  const age = document.getElementById("access-token-age");
  const warning = document.getElementById("access-warning");

  if (badge) {
    badge.className = d.auth_enabled ? "badge badge-active" : "badge badge-stale";
    badge.textContent = d.auth_enabled ? "auth on" : "auth off";
  }
  if (status) {
    const tokenState = d.token_configured ? "token configured" : "token missing";
    status.textContent = `${tokenState} · ${d.token_file_exists ? "file-backed" : "env-backed"}`;
  }
  if (bind) bind.textContent = `${d.bind_host || "—"}${d.bind_port ? `:${d.bind_port}` : ""}`;
  if (age) age.textContent = d.token_age_seconds == null ? "—" : _formatAgeBrief(d.token_age_seconds);
  if (warning) {
    warning.textContent = d.bind_warning || "none";
    warning.className = d.bind_warning ? "ops-warn" : "ops-good";
  }
}

async function rotateAccessToken() {
  const btn = document.getElementById("access-rotate-token");
  const output = document.getElementById("access-token-output");
  if (!confirmRisk("Rotate dashboard token?", [
    "The old token stops working immediately.",
    "The new token is shown once in this browser tab.",
  ])) return;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "rotating…";
  }
  if (output) output.textContent = "rotating token…";
  try {
    const d = await API.post("/api/system/access-control/rotate-token", {});
    if (output) output.textContent = `new token: ${d.new_token}`;
    API.token = d.new_token;
    sessionStorage.removeItem("aegis_token");
    renderAccessControl(d);
  } catch (e) {
    if (e.message !== "unauthorized" && output) output.textContent = "token rotation failed";
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "rotate token";
    }
  }
}

function renderLoggingProfile(d) {
  const select = document.getElementById("logging-profile");
  const badge = document.getElementById("logging-profile-badge");
  const status = document.getElementById("logging-profile-status");
  if (select && ["standard", "minimal"].includes(d.profile)) select.value = d.profile;
  if (badge) {
    badge.className = d.profile === "minimal" ? "badge badge-active" : "badge badge-idle";
    badge.textContent = d.profile || "standard";
  }
  if (status) {
    const dns = d.dns_query_logging ? "dns query logs on" : "dns query logs off";
    const traffic = d.traffic_logging_rules == null ? "traffic log rules unknown" : `${d.traffic_logging_rules} traffic log rules`;
    status.textContent = `${dns} · ${traffic} · journald ${d.journald_configured ? "capped" : "system default"}`;
  }
}

async function saveLoggingProfile() {
  const profile = document.getElementById("logging-profile").value;
  const btn = document.getElementById("logging-profile-save");
  const status = document.getElementById("logging-profile-status");
  if (!confirmRisk(`Apply ${profile} local logging profile?`, [
    "This changes local journald/logrotate retention policy.",
    "It does not affect provider-side metadata.",
  ])) return;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "saving…";
  }
  if (status) status.textContent = "updating local log policy…";
  try {
    const d = await API.post("/api/system/logging-profile", { profile });
    renderLoggingProfile(d);
  } catch (e) {
    if (e.message !== "unauthorized" && status) status.textContent = "logging profile update failed";
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "save profile";
    }
    _operationsLastLoad = 0;
  }
}

function renderFail2banControls(d) {
  const badge = document.getElementById("f2b-ops-badge");
  const status = document.getElementById("f2b-ops-status");
  const list = document.getElementById("f2b-ops-jails");
  const serviceActive = d.service?.active === "active";
  if (badge) {
    badge.className = serviceActive && d.available ? "badge badge-active" : "badge badge-stale";
    badge.textContent = serviceActive && d.available ? "active" : "attention";
  }
  if (status) status.textContent = d.available ? `${d.currently_banned || 0} currently banned` : "fail2ban unavailable";
  renderFail2banPolicy(d.policy || {});
  if (!list) return;
  const jails = d.jails || [];
  if (!jails.length) {
    list.innerHTML = '<p class="empty-state">no jail status</p>';
    return;
  }
  list.innerHTML = jails.map((j) => `
    <div class="ops-jail-row">
      <strong>${j.jail}</strong>
      <span>${j.available ? "available" : "missing"}</span>
      <em>${j.currently_banned || 0} banned</em>
    </div>`).join("");
}

function renderFail2banPolicy(policy) {
  const fields = {
    "f2b-policy-maxretry": policy.sshd_maxretry,
    "f2b-policy-findtime": policy.sshd_findtime,
    "f2b-policy-bantime": policy.sshd_bantime,
    "f2b-policy-recidive": policy.recidive_bantime,
  };
  Object.entries(fields).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el && value != null && document.activeElement !== el) el.value = value;
  });
  const status = document.getElementById("f2b-policy-status");
  if (status) {
    const source = policy.override_active ? "control-plane override active" : "live provisioned defaults";
    status.textContent = source;
  }
}

function _numField(id) {
  const raw = document.getElementById(id).value.trim();
  return raw === "" ? NaN : Number(raw);
}

async function saveFail2banPolicy() {
  const payload = {
    sshd_maxretry: _numField("f2b-policy-maxretry"),
    sshd_findtime: _numField("f2b-policy-findtime"),
    sshd_bantime: _numField("f2b-policy-bantime"),
    recidive_bantime: _numField("f2b-policy-recidive"),
  };
  const status = document.getElementById("f2b-policy-status");
  if (Object.values(payload).some((v) => !Number.isFinite(v))) {
    if (status) status.textContent = "fill every policy field";
    return;
  }
  if (!confirmRisk("Save fail2ban policy?", [
    `SSH: ${payload.sshd_maxretry} failures within ${payload.sshd_findtime}s -> ${payload.sshd_bantime}s ban.`,
    `Repeat offenders -> ${payload.recidive_bantime}s ban.`,
    "Fail2ban will restart after writing the override.",
  ])) return;
  if (status) status.textContent = "saving fail2ban policy…";
  try {
    const d = await API.post("/api/system/fail2ban/policy", payload);
    renderFail2banControls(d);
  } catch (e) {
    if (e.message !== "unauthorized" && status) status.textContent = "policy save failed";
  } finally {
    _operationsLastLoad = 0;
    setTimeout(loadOperationsStatus, 800);
  }
}

async function unbanFail2banIp() {
  const input = document.getElementById("f2b-unban-ip");
  const status = document.getElementById("f2b-ops-status");
  const ip = input.value.trim();
  if (!ip) return;
  if (!confirmRisk(`Unban ${ip} from fail2ban?`, [
    "This removes the IP from available fail2ban jails.",
  ])) return;
  if (status) status.textContent = "unbanning ip…";
  try {
    const d = await API.post("/api/system/fail2ban/unban", { ip });
    renderFail2banControls(d);
    input.value = "";
  } catch (e) {
    if (e.message !== "unauthorized" && status) status.textContent = "unban failed";
  }
}

async function restartFail2ban() {
  const status = document.getElementById("f2b-ops-status");
  if (!confirmRisk("Restart fail2ban service?", [
    "SSH protection may briefly reload.",
  ])) return;
  if (status) status.textContent = "restarting fail2ban…";
  try {
    const d = await API.post("/api/system/fail2ban/restart", {});
    renderFail2banControls(d.fail2ban_control || d);
  } catch (e) {
    if (e.message !== "unauthorized" && status) status.textContent = "restart failed";
  } finally {
    _operationsLastLoad = 0;
    setTimeout(loadOperationsStatus, 800);
  }
}

async function loadDnsModeStatus() {
  try {
    const d = await API.get("/api/system/dns-mode");
    renderDnsMode(d);
  } catch (e) {
    if (e.message !== "unauthorized") {
      const status = document.getElementById("dns-mode-status");
      if (status) status.textContent = "status unavailable";
    }
  }
}

function renderDnsMode(d) {
  const preset = document.getElementById("dns-mode-preset");
  const dot = document.getElementById("dns-mode-dot");
  const status = document.getElementById("dns-mode-status");
  if (preset && ["cloudflare", "quad9", "google"].includes(d.preset)) preset.value = d.preset;
  if (dot) dot.checked = !!d.dot_enabled;
  if (status) {
    const mode = d.dot_enabled ? "DoT on" : "plain DNS";
    status.textContent = `${d.preset_label || d.preset || "Custom"} · ${mode}`;
  }
}

async function saveDnsMode() {
  const btn = document.getElementById("dns-mode-save");
  const status = document.getElementById("dns-mode-status");
  const preset = document.getElementById("dns-mode-preset").value;
  const dot = document.getElementById("dns-mode-dot").checked;
  if (!confirmRisk("Save DNS mode?", [
    "This rewrites Unbound upstream resolver config.",
    "Unbound will restart after config validation.",
  ])) return;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "saving…";
  }
  if (status) status.textContent = "updating resolver…";
  try {
    const d = await API.post("/api/system/dns-mode", { preset, dot_enabled: dot });
    renderDnsMode(d);
  } catch (e) {
    if (e.message !== "unauthorized" && status) status.textContent = "update failed";
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "save dns mode";
    }
    _dnsModeLastLoad = 0;
    setTimeout(loadDnsModeStatus, 800);
  }
}

async function loadStalePeers() {
  const days = document.getElementById("stale-days").value;
  const status = document.getElementById("stale-status");
  const list = document.getElementById("stale-list");
  if (status) status.textContent = "checking stale peers…";
  if (list) list.innerHTML = "";
  try {
    const d = await API.get(`/api/peers/stale?days=${encodeURIComponent(days)}`);
    renderStalePeers(d);
  } catch (e) {
    if (e.message !== "unauthorized" && status) status.textContent = "review failed";
  }
}

function renderStalePeers(d) {
  const status = document.getElementById("stale-status");
  const list = document.getElementById("stale-list");
  const peers = d.peers || [];
  if (status) status.textContent = `${peers.length} peer(s) inactive for ${d.days} days`;
  if (!list) return;
  if (!peers.length) {
    list.innerHTML = '<p class="empty-state">no stale peers</p>';
    return;
  }
  list.innerHTML = peers.map((p) => {
    const label = p.label || p.public_key_short || p.public_key.slice(0, 16) + "…";
    const ip = p.allowed_ips || "—";
    const age = _formatAgeBrief(p.stale_age_seconds || 0);
    return `
      <label class="stale-peer-row">
        <input type="checkbox" value="${p.public_key}" />
        <span>${label}</span>
        <strong>${ip}</strong>
        <em>${age}</em>
      </label>`;
  }).join("");
}

async function removeSelectedStalePeers() {
  const keys = [...document.querySelectorAll("#stale-list input[type='checkbox']:checked")].map((el) => el.value);
  const days = Number(document.getElementById("stale-days").value);
  const status = document.getElementById("stale-status");
  if (!keys.length) {
    if (status) status.textContent = "select stale peers to remove";
    return;
  }
  if (!confirmRisk(`Remove ${keys.length} stale peer(s)?`, [
    "Selected peers will be removed from the live VPN interface and persisted config.",
    "This does not remove the admin/bootstrap peer.",
  ])) return;
  if (status) status.textContent = "removing selected peers…";
  try {
    await API.post("/api/peers/stale/remove", { public_keys: keys, days });
    loadStalePeers();
    loadPeers();
    loadOverview();
  } catch (e) {
    if (e.message !== "unauthorized" && status) status.textContent = "remove failed";
  }
}

async function loadProvisioningDefaults() {
  try {
    const d = await API.get("/api/system/provisioning-defaults");
    renderProvisioningDefaults(d.defaults || {});
  } catch (e) {
    if (e.message !== "unauthorized") {
      const status = document.getElementById("prov-defaults-status");
      if (status) status.textContent = "defaults unavailable";
    }
  }
}

function renderProvisioningDefaults(d) {
  _lastProvisioningDefaults = { ...d };
  document.getElementById("prov-label-prefix").value = d.label_prefix || "";
  document.getElementById("prov-keepalive").value = d.persistent_keepalive ?? "";
  document.getElementById("prov-mtu").value = d.mtu ?? "";
  document.getElementById("prov-dns-enabled").checked = d.dns_enabled !== false;
  const summary = provisioningDefaultsSummary(d);
  document.getElementById("prov-defaults-status").textContent = "applies to newly provisioned peers";
  const summaryEl = document.getElementById("prov-defaults-summary");
  if (summaryEl) summaryEl.textContent = `current: ${summary}`;
  updateNetworkPresetState(d);
}

async function saveProvisioningDefaults() {
  const status = document.getElementById("prov-defaults-status");
  const btn = document.getElementById("prov-defaults-save");
  const keepaliveRaw = document.getElementById("prov-keepalive").value.trim();
  const mtuRaw = document.getElementById("prov-mtu").value.trim();
  const payload = {
    label_prefix: document.getElementById("prov-label-prefix").value.trim(),
    dns_enabled: document.getElementById("prov-dns-enabled").checked,
    persistent_keepalive: keepaliveRaw === "" ? null : Number(keepaliveRaw),
    mtu: mtuRaw === "" ? null : Number(mtuRaw),
  };
  if (!confirmRisk("Save provisioning defaults?", [
    provisioningDefaultsSummary(payload),
    "Only newly provisioned peers will use these values.",
  ])) return;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "saving…";
  }
  if (status) status.textContent = "saving defaults…";
  try {
    const d = await API.post("/api/system/provisioning-defaults", payload);
    renderProvisioningDefaults(d.defaults || {});
    if (status) status.textContent = "defaults saved";
  } catch (e) {
    if (e.message !== "unauthorized" && status) status.textContent = "save failed";
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "save defaults";
    }
    _provisionDefaultsLastLoad = 0;
  }
}

async function loadDnsPrivacyStatus() {
  try {
    const d = await API.get("/api/system/dns-privacy");
    renderDnsPrivacy(d);
  } catch (e) {
    if (e.message !== "unauthorized") {
      const status = document.getElementById("dns-privacy-status");
      if (status) status.textContent = "status unavailable";
    }
  }
}

function renderDnsPrivacy(d) {
  const toggle = document.getElementById("dns-privacy-toggle");
  const status = document.getElementById("dns-privacy-status");
  const msg = document.getElementById("dns-privacy-msg");
  if (!toggle || !status) return;

  toggle.checked = !!d.enabled;
  toggle.disabled = _dnsPrivacyBusy;

  const cacheEntries = d.cache_entries ?? "—";
  const ttl = d.cache_max_ttl ? _formatTTL(d.cache_max_ttl) : "—";
  const logging = d.query_logging ? "query logs on" : "query logs off";
  const autoFlush = d.auto_flush ? "auto flush on" : "auto flush off";
  status.textContent = `${logging} · cache ${cacheEntries} · ttl ${ttl} · ${autoFlush}`;

  if (msg && !_dnsPrivacyBusy) {
    msg.textContent = d.enabled
      ? "short TTL, no prefetch, flushes every 15m"
      : "standard resolver cache policy";
  }
}

function _formatTTL(seconds) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

function _formatAgeBrief(seconds) {
  if (!seconds) return "—";
  if (seconds < 86400) return _formatTTL(seconds);
  const days = Math.floor(seconds / 86400);
  if (days < 365) return `${days}d`;
  return `${Math.floor(days / 365)}y`;
}

async function setDnsPrivacy(enabled) {
  const toggle = document.getElementById("dns-privacy-toggle");
  const msg = document.getElementById("dns-privacy-msg");
  if (!confirmRisk(`${enabled ? "Enable" : "Disable"} DNS privacy mode?`, [
    enabled
      ? "This lowers resolver cache retention and enables scheduled cache flushes."
      : "This restores the standard resolver cache policy.",
    "Unbound settings will be validated and restarted if needed.",
  ])) {
    if (toggle) toggle.checked = !enabled;
    return;
  }
  _dnsPrivacyBusy = true;
  if (toggle) toggle.disabled = true;
  if (msg) msg.textContent = enabled ? "enabling privacy mode…" : "disabling privacy mode…";

  try {
    const d = await API.post("/api/system/dns-privacy", { enabled });
    renderDnsPrivacy(d);
  } catch (e) {
    if (e.message !== "unauthorized") {
      if (msg) msg.textContent = "update failed";
      if (toggle) toggle.checked = !enabled;
    }
  } finally {
    _dnsPrivacyBusy = false;
    if (toggle) toggle.disabled = false;
    _dnsPrivacyLastLoad = 0;
    loadDnsPrivacyStatus();
  }
}

async function flushDnsPrivacyNow() {
  const btn = document.getElementById("dns-privacy-flush-btn");
  const msg = document.getElementById("dns-privacy-msg");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "flushing…";
  }
  if (msg) msg.textContent = "clearing resolver cache…";

  try {
    const d = await API.post("/api/system/dns-privacy/flush", {});
    renderDnsPrivacy(d);
    if (msg) msg.textContent = "cache flushed";
  } catch (e) {
    if (e.message !== "unauthorized" && msg) msg.textContent = "flush failed";
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "flush now";
    }
    _dnsPrivacyLastLoad = 0;
    setTimeout(loadDnsPrivacyStatus, 800);
  }
}

document.getElementById("perf-refresh-btn").addEventListener("click", () => {
  _perfTimestamp = 0; // reset to force instant new calculation reading
  _dnsPrivacyLastLoad = 0;
  _operationsLastLoad = 0;
  _dnsModeLastLoad = 0;
  _provisionDefaultsLastLoad = 0;
  _accessControlLastLoad = 0;
  document.getElementById("perf-rx-speed").textContent = "—";
  document.getElementById("perf-tx-speed").textContent = "—";
  loadPerformance();
});

document.getElementById("dns-privacy-toggle").addEventListener("change", (e) => {
  setDnsPrivacy(e.target.checked);
});

document.getElementById("dns-privacy-flush-btn").addEventListener("click", flushDnsPrivacyNow);

document.getElementById("ops-restart-vpn").addEventListener("click", () => runOperationsAction("restart-vpn"));
document.getElementById("ops-restart-dns").addEventListener("click", () => runOperationsAction("restart-dns"));
document.getElementById("ops-restart-api").addEventListener("click", () => runOperationsAction("restart-api"));
document.getElementById("dns-mode-save").addEventListener("click", saveDnsMode);
document.getElementById("stale-refresh").addEventListener("click", loadStalePeers);
document.getElementById("stale-remove").addEventListener("click", removeSelectedStalePeers);
document.getElementById("stale-days").addEventListener("change", loadStalePeers);
document.getElementById("prov-defaults-save").addEventListener("click", saveProvisioningDefaults);
document.getElementById("access-rotate-token").addEventListener("click", rotateAccessToken);
document.getElementById("logging-profile-save").addEventListener("click", saveLoggingProfile);
document.getElementById("f2b-unban-btn").addEventListener("click", unbanFail2banIp);
document.getElementById("f2b-restart-btn").addEventListener("click", restartFail2ban);
document.getElementById("f2b-policy-save").addEventListener("click", saveFail2banPolicy);
document.getElementById("net-preset-default").addEventListener("click", () => applyNetworkPreset("default"));
document.getElementById("net-preset-mobile").addEventListener("click", () => applyNetworkPreset("mobile"));
document.getElementById("net-preset-conservative").addEventListener("click", () => applyNetworkPreset("conservative"));
document.getElementById("maint-flush-dns").addEventListener("click", () => runMaintenanceAction("flush-dns"));
document.getElementById("maint-save-iptables").addEventListener("click", () => runMaintenanceAction("save-iptables"));
document.getElementById("maint-dkms-check").addEventListener("click", () => runMaintenanceAction("dkms-check"));
document.getElementById("maint-restart-vpn").addEventListener("click", () => runMaintenanceAction("restart-vpn"));
document.getElementById("maint-restart-dns").addEventListener("click", () => runMaintenanceAction("restart-dns"));
document.getElementById("maint-restart-api").addEventListener("click", () => runMaintenanceAction("restart-api"));

function startPerformanceAutoRefresh() {
  clearInterval(_performanceInterval);
  // fast 2s polling for live bandwith feeling
  _performanceInterval = setInterval(() => {
    const t = document.getElementById("tab-performance");
    if (!t.classList.contains("hidden")) loadPerformance();
    else { clearInterval(_performanceInterval); _performanceInterval = null; }
  }, 2000);
}
