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
    return res.json();
  },

  async post(path, body) {
    const res = await fetch(path, { method: "POST", headers: this.headers(), body: JSON.stringify(body) });
    if (res.status === 401 || res.status === 403) { logout(); throw new Error("unauthorized"); }
    return res.json();
  },

  async request(method, path, body) {
    const opts = { method, headers: this.headers() };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(path, opts);
    if (res.status === 401 || res.status === 403) { logout(); throw new Error("unauthorized"); }
    return res.json();
  },
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
  if (endpointEl && endpointEl.textContent === "—") {
    // these are injected via the systemd env; we just show placeholders
    endpointEl.textContent = window.__AEGIS_ENDPOINT__ || "configured via env";
    subnetEl.textContent   = window.__AEGIS_SUBNET__   || "10.66.66.0/24";
  }
}

document.getElementById("refresh-btn").addEventListener("click", loadOverview);

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
    await API.post("/api/wg/remove", { public_key: pubkey });
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
    const res = await API.post("/api/wg/add", { public_key: pk, allowed_ip: ip });
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

provisionBtn.addEventListener("click", async () => {
  provisionBtn.textContent = "generating…";
  provisionBtn.disabled = true;
  provisionResult.classList.add("hidden");
  provisionResult.classList.remove("visible");

  try {
    const data = await API.post("/api/wg/provision", {});

    document.getElementById("qr-img").src       = `data:image/png;base64,${data.qr}`;
    document.getElementById("config-pre").textContent = data.config;
    document.getElementById("peer-ip-label").textContent = data.allowed_ip;
    document.getElementById("provision-pk").textContent  = data.public_key;

    // Generate bash magic script (extract server IP from browser url)
    const serverHost = window.location.hostname;
    const magicScript = 
`sudo apt update && sudo apt install -y wireguard resolvconf && \\
sudo sh -c "cat > /etc/wireguard/wg0.conf <<'EOF'
${data.config}
EOF" && \\
sudo systemctl enable --now wg-quick@wg0`;

    document.getElementById("script-pre").textContent = magicScript;

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
    const [sys, svc, traffic, ssh, timeline] = await Promise.all([
      API.get("/api/monitor/system"),
      API.get("/api/monitor/services"),
      API.get("/api/monitor/traffic"),
      API.get("/api/monitor/ssh"),
      API.get("/api/monitor/ssh/timeline?tz_offset=" + (-new Date().getTimezoneOffset())),

    ]);
    renderSystem(sys);
    renderServices(svc.services ?? []);
    renderTraffic(traffic.peers ?? []);
    renderTimeline(timeline.timeline ?? []);
    renderSSH(ssh.events ?? []);
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
    
  } catch (e) {
    if (e.message !== "unauthorized") console.error("Perf poll err:", e);
  }
}

document.getElementById("perf-refresh-btn").addEventListener("click", () => {
  _perfTimestamp = 0; // reset to force instant new calculation reading
  document.getElementById("perf-rx-speed").textContent = "—";
  document.getElementById("perf-tx-speed").textContent = "—";
  loadPerformance();
});

function startPerformanceAutoRefresh() {
  clearInterval(_performanceInterval);
  // fast 2s polling for live bandwith feeling
  _performanceInterval = setInterval(() => {
    const t = document.getElementById("tab-performance");
    if (!t.classList.contains("hidden")) loadPerformance();
    else { clearInterval(_performanceInterval); _performanceInterval = null; }
  }, 2000);
}
