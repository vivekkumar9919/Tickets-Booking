// Paytm Ticket Booking — Health & Observability Client

class HealthDashboard {
  constructor() {
    this.apiUrlInput = document.getElementById('apiUrlInput');
    this.refreshBtn = document.getElementById('refreshBtn');
    this.autoRefreshCheckbox = document.getElementById('autoRefreshCheckbox');
    
    // Status elements
    this.overallBadge = document.getElementById('overallStatusBadge');
    this.overallText = document.getElementById('overallStatusText');
    
    this.livenessBadge = document.getElementById('livenessBadge');
    this.livenessStatus = document.getElementById('livenessStatus');
    this.livenessLatency = document.getElementById('livenessLatency');
    this.livenessTime = document.getElementById('livenessTime');
    
    this.readinessBadge = document.getElementById('readinessBadge');
    this.readinessStatus = document.getElementById('readinessStatus');
    this.readinessLatency = document.getElementById('readinessLatency');
    this.readinessTime = document.getElementById('readinessTime');
    
    this.dbStatus = document.getElementById('dbConnectionStatus');
    this.auditTableBody = document.getElementById('auditTableBody');
    this.auditCount = document.getElementById('auditCount');
    this.clockDisplay = document.getElementById('clockDisplay');
    
    this.auditLogs = [];
    this.timer = null;
    
    this.init();
  }

  init() {
    // Autodetect default base URL
    const isDirectBackend = window.location.port === '4000';
    const isNginxContainer = window.location.port === '8085' || window.location.port === '80' || window.location.port === '';
    const defaultUrl = isDirectBackend ? '' : (isNginxContainer ? '/api' : 'http://localhost:4000');
    this.apiUrlInput.value = defaultUrl;

    this.refreshBtn.addEventListener('click', () => this.runProbes());
    this.autoRefreshCheckbox.addEventListener('change', () => this.handleAutoRefresh());

    this.startClock();
    this.runProbes();
    this.handleAutoRefresh();
  }

  getBaseUrl() {
    const customUrl = this.apiUrlInput.value.trim();
    if (customUrl === '' || customUrl === '/') return '';
    return customUrl.replace(/\/$/, '');
  }

  startClock() {
    const updateTime = () => {
      this.clockDisplay.textContent = new Date().toLocaleTimeString();
    };
    updateTime();
    setInterval(updateTime, 1000);
  }

  handleAutoRefresh() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.autoRefreshCheckbox.checked) {
      this.timer = setInterval(() => this.runProbes(), 3000);
    }
  }

  async runProbes() {
    const baseUrl = this.getBaseUrl();
    const livenessUrl = `${baseUrl}/livez`;
    const readinessUrl = `${baseUrl}/readyz`;

    // 1. Check Liveness
    const liveStart = performance.now();
    let liveResult = null;
    try {
      const res = await fetch(livenessUrl, { cache: 'no-store' });
      const latency = Math.round(performance.now() - liveStart);
      const data = await res.json();
      liveResult = { ok: res.ok, status: res.status, latency, data };
    } catch (err) {
      const latency = Math.round(performance.now() - liveStart);
      liveResult = { ok: false, status: 0, latency, error: err.message };
    }

    // 2. Check Readiness (PostgreSQL dependency check)
    const readyStart = performance.now();
    let readyResult = null;
    try {
      const res = await fetch(readinessUrl, { cache: 'no-store' });
      const latency = Math.round(performance.now() - readyStart);
      const data = await res.json();
      readyResult = { ok: res.ok, status: res.status, latency, data };
    } catch (err) {
      const latency = Math.round(performance.now() - readyStart);
      readyResult = { ok: false, status: 0, latency, error: err.message };
    }

    this.updateUI(liveResult, readyResult);
    this.addAuditEntry(liveResult, readyResult);
  }

  updateUI(live, ready) {
    const nowStr = new Date().toLocaleTimeString();

    // Liveness UI
    if (live.ok) {
      this.livenessBadge.className = 'badge badge-success';
      this.livenessBadge.textContent = 'ALIVE (200)';
      this.livenessStatus.textContent = 'HTTP Server Active';
      this.livenessLatency.textContent = `${live.latency} ms`;
      this.livenessTime.textContent = nowStr;
    } else {
      this.livenessBadge.className = 'badge badge-danger';
      this.livenessBadge.textContent = `DOWN (${live.status || 'ERR'})`;
      this.livenessStatus.textContent = 'Service Unreachable';
      this.livenessLatency.textContent = `${live.latency} ms`;
      this.livenessTime.textContent = nowStr;
    }

    // Readiness UI
    if (ready.ok && ready.data?.database === 'connected') {
      this.readinessBadge.className = 'badge badge-success';
      this.readinessBadge.textContent = 'READY (200)';
      this.readinessStatus.textContent = 'Dependencies Ready';
      this.readinessLatency.textContent = `${ready.data.latency_ms || ready.latency} ms`;
      this.readinessTime.textContent = nowStr;
      this.dbStatus.textContent = 'Connected (Healthy)';
    } else {
      this.readinessBadge.className = 'badge badge-danger';
      this.readinessBadge.textContent = `NOT READY (${ready.status || '503'})`;
      this.readinessStatus.textContent = ready.data?.error || 'Database Down';
      this.readinessLatency.textContent = `${ready.latency} ms`;
      this.readinessTime.textContent = nowStr;
      this.dbStatus.textContent = 'Disconnected (Failed Closed)';
    }

    // Overall Status Indicator
    const isOverallHealthy = live.ok && ready.ok;
    const dot = this.overallBadge.querySelector('.status-dot');
    dot.className = `status-dot pulse ${isOverallHealthy ? 'healthy' : 'unhealthy'}`;
    this.overallText.textContent = isOverallHealthy ? 'SYSTEM OPERATIONAL' : 'SYSTEM DEGRADED';
  }

  addAuditEntry(live, ready) {
    const timeStr = new Date().toLocaleTimeString();
    const entry = {
      timestamp: timeStr,
      liveStatus: live.status,
      liveLatency: live.latency,
      readyStatus: ready.status,
      readyLatency: ready.data?.latency_ms || ready.latency,
      dbStatus: ready.data?.database || 'down',
      isHealthy: live.ok && ready.ok,
    };

    this.auditLogs.unshift(entry);
    if (this.auditLogs.length > 15) this.auditLogs.pop();

    this.renderAuditTable();
  }

  renderAuditTable() {
    this.auditCount.textContent = `${this.auditLogs.length} recent checks`;
    this.auditTableBody.innerHTML = this.auditLogs.map(log => `
      <tr>
        <td style="font-family: var(--mono-font); font-size: 12px;">${log.timestamp}</td>
        <td><code>/livez</code> & <code>/readyz</code></td>
        <td>
          <span class="${log.liveStatus === 200 ? 'tag-success' : 'tag-fail'}">LIVE: ${log.liveStatus}</span>
          <span class="${log.readyStatus === 200 ? 'tag-success' : 'tag-fail'}">READY: ${log.readyStatus}</span>
        </td>
        <td style="font-family: var(--mono-font);">${log.liveLatency}ms / ${log.readyLatency}ms</td>
        <td>
          <span class="${log.dbStatus === 'connected' ? 'tag-success' : 'tag-fail'}">${log.dbStatus.toUpperCase()}</span>
        </td>
        <td>
          <strong style="color: ${log.isHealthy ? 'var(--success)' : 'var(--danger)'}">
            ${log.isHealthy ? 'PASSED' : 'FAILED'}
          </strong>
        </td>
      </tr>
    `).join('');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.dashboard = new HealthDashboard();
});
