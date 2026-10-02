// Paytm Ticket Booking — High Concurrency Arena & Observability Dashboard

class UnifiedDashboard {
  constructor() {
    this.apiUrlInput = document.getElementById('apiUrlInput');
    this.refreshBtn = document.getElementById('refreshBtn');
    this.autoRefreshCheckbox = document.getElementById('autoRefreshCheckbox');
    
    // Tabs
    this.tabBookingBtn = document.getElementById('tabBookingBtn');
    this.tabObservabilityBtn = document.getElementById('tabObservabilityBtn');
    this.bookingTabContent = document.getElementById('bookingTabContent');
    this.observabilityTabContent = document.getElementById('observabilityTabContent');

    // Booking Arena Elements
    this.showSelect = document.getElementById('showSelect');
    this.newShowBtn = document.getElementById('newShowBtn');
    this.userTokenInput = document.getElementById('userTokenInput');
    this.randomUserBtn = document.getElementById('randomUserBtn');
    this.userQuotaPill = document.getElementById('userQuotaPill');
    this.reconcileBadge = document.getElementById('reconcileBadge');
    this.showMetaInfo = document.getElementById('showMetaInfo');
    this.seatGridContainer = document.getElementById('seatGridContainer');
    this.selectedSeatsList = document.getElementById('selectedSeatsList');
    this.totalPriceDisplay = document.getElementById('totalPriceDisplay');
    this.bookSeatsBtn = document.getElementById('bookSeatsBtn');
    this.stormSeatBtn = document.getElementById('stormSeatBtn');
    this.bookingAlertBox = document.getElementById('bookingAlertBox');
    this.userBookingsTableBody = document.getElementById('userBookingsTableBody');
    this.userReservationsCount = document.getElementById('userReservationsCount');

    // Observability Elements
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

    // State
    this.currentShow = null;
    this.currentSeats = [];
    this.selectedSeats = new Set();
    this.userReservations = [];
    this.auditLogs = [];
    this.probeTimer = null;

    this.init();
  }

  init() {
    const isDirectBackend = window.location.port === '4000';
    const isNginxContainer = window.location.port === '8085' || window.location.port === '80' || window.location.port === '';
    const defaultUrl = isDirectBackend ? '' : (isNginxContainer ? '/api' : 'http://localhost:4000');
    this.apiUrlInput.value = defaultUrl;

    this.setupEventListeners();
    this.startClock();
    this.runProbes();
    this.loadShows();
  }

  setupEventListeners() {
    this.tabBookingBtn.addEventListener('click', () => this.switchTab('booking'));
    this.tabObservabilityBtn.addEventListener('click', () => this.switchTab('observability'));

    this.refreshBtn.addEventListener('click', () => {
      this.runProbes();
      if (this.currentShow) this.fetchShowState(this.currentShow.id);
    });

    this.autoRefreshCheckbox.addEventListener('change', () => this.handleAutoRefresh());
    this.newShowBtn.addEventListener('click', () => this.promptNewShow());
    this.showSelect.addEventListener('change', (e) => this.fetchShowState(e.target.value));
    this.randomUserBtn.addEventListener('click', () => {
      this.userTokenInput.value = `usr_buyer_${Math.random().toString(36).substring(2, 7)}`;
      this.selectedSeats.clear();
      this.renderSelectedSummary();
      this.renderSeats();
    });

    this.bookSeatsBtn.addEventListener('click', () => this.reserveSelectedSeats());
    this.stormSeatBtn.addEventListener('click', () => this.stormHotSeat());
  }

  switchTab(tab) {
    if (tab === 'booking') {
      this.tabBookingBtn.classList.add('active');
      this.tabObservabilityBtn.classList.remove('active');
      this.bookingTabContent.classList.add('active');
      this.observabilityTabContent.classList.remove('active');
    } else {
      this.tabObservabilityBtn.classList.add('active');
      this.tabBookingBtn.classList.remove('active');
      this.observabilityTabContent.classList.add('active');
      this.bookingTabContent.classList.remove('active');
    }
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
    if (this.autoRefreshCheckbox.checked) {
      if (!this.probeTimer) {
        this.probeTimer = setInterval(() => {
          this.runProbes();
          if (this.currentShow) this.fetchShowState(this.currentShow.id, true);
        }, 3000);
      }
    } else {
      if (this.probeTimer) {
        clearInterval(this.probeTimer);
        this.probeTimer = null;
      }
    }
  }

  showAlert(message, type = 'info', autoDismiss = 5000) {
    this.bookingAlertBox.className = `alert-box ${type}`;
    this.bookingAlertBox.innerHTML = `<span>${message}</span>`;
    if (autoDismiss) {
      setTimeout(() => {
        this.bookingAlertBox.className = 'alert-box hidden';
      }, autoDismiss);
    }
  }

  async loadShows() {
    const base = this.getBaseUrl();
    try {
      // First check if an existing show can be created or loaded
      const res = await fetch(`${base}/shows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Paytm Live Concert 2026',
          total_seats: 40,
          price_paise: 250000,
          per_user_limit: 4,
        }),
      });

      if (res.ok) {
        const createdShow = await res.json();
        this.showSelect.innerHTML = `<option value="${createdShow.id}">${createdShow.name} (40 Seats - ₹2,500)</option>`;
        await this.fetchShowState(createdShow.id);
      }
    } catch (err) {
      console.error('Failed to load initial show', err);
    }
  }

  async promptNewShow() {
    const name = prompt('Enter Show Name:', 'Standup Special 2026');
    if (!name) return;
    const seatsStr = prompt('Enter Total Seats (max 100):', '30');
    const totalSeats = parseInt(seatsStr || '30', 10);
    const pricePaise = 200000;

    const base = this.getBaseUrl();
    try {
      const res = await fetch(`${base}/shows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          total_seats: totalSeats,
          price_paise: pricePaise,
          per_user_limit: 4,
        }),
      });

      if (!res.ok) throw new Error('Failed to create show');
      const show = await res.json();
      const opt = document.createElement('option');
      opt.value = show.id;
      opt.textContent = `${show.name} (${show.total_seats} Seats - ₹${pricePaise / 100})`;
      this.showSelect.appendChild(opt);
      this.showSelect.value = show.id;
      this.fetchShowState(show.id);
      this.showAlert(`Show "${show.name}" created successfully!`, 'success');
    } catch (err) {
      this.showAlert(`Error creating show: ${err.message}`, 'error');
    }
  }

  async fetchShowState(showId, silent = false) {
    if (!showId) return;
    const base = this.getBaseUrl();
    try {
      const res = await fetch(`${base}/shows/${showId}`);
      if (!res.ok) throw new Error('Show not found');
      const data = await res.json();
      this.currentShow = data.show;
      this.currentSeats = data.seats;

      this.renderShowMeta(data.summary);
      this.renderSeats();
      if (!silent) this.renderSelectedSummary();
    } catch (err) {
      if (!silent) this.showAlert(`Failed to fetch show state: ${err.message}`, 'error');
    }
  }

  renderShowMeta(summary) {
    const isReconciled = summary.available + summary.held + summary.confirmed === summary.total;
    this.reconcileBadge.textContent = isReconciled ? 'Reconciled: 100%' : 'Reconcile: MISMATCH';
    this.reconcileBadge.className = isReconciled ? 'reconcile-pill' : 'quota-pill';

    this.showMetaInfo.textContent = `${summary.total} Total · ${summary.available} Available · ${summary.confirmed} Sold`;
    this.userQuotaPill.textContent = `Max ${this.currentShow.per_user_limit || 4} seats/user`;
  }

  renderSeats() {
    this.seatGridContainer.innerHTML = '';
    this.currentSeats.forEach((seat) => {
      const el = document.createElement('div');
      const isSelected = this.selectedSeats.has(seat.seat_number);

      let statusClass = seat.status;
      if (isSelected) statusClass = 'selected';

      el.className = `seat-item ${statusClass}`;
      el.textContent = seat.seat_number;
      el.title = `Seat ${seat.seat_number} - Status: ${seat.status.toUpperCase()}`;

      if (seat.status === 'available') {
        el.addEventListener('click', () => this.toggleSeatSelection(seat.seat_number));
      }

      this.seatGridContainer.appendChild(el);
    });
  }

  toggleSeatSelection(seatNumber) {
    const limit = this.currentShow ? (this.currentShow.per_user_limit || 4) : 4;
    if (this.selectedSeats.has(seatNumber)) {
      this.selectedSeats.delete(seatNumber);
    } else {
      if (this.selectedSeats.size >= limit) {
        this.showAlert(`Per-user limit reached: You can only select up to ${limit} seats!`, 'error');
        return;
      }
      this.selectedSeats.add(seatNumber);
    }
    this.renderSeats();
    this.renderSelectedSummary();
  }

  renderSelectedSummary() {
    const count = this.selectedSeats.size;
    if (count === 0) {
      this.selectedSeatsList.textContent = 'None';
      this.totalPriceDisplay.textContent = '₹0';
      this.bookSeatsBtn.disabled = true;
      this.stormSeatBtn.disabled = true;
    } else {
      const list = Array.from(this.selectedSeats).sort().join(', ');
      const pricePerSeat = this.currentShow ? (this.currentShow.price_paise / 100) : 2500;
      this.selectedSeatsList.textContent = list;
      this.totalPriceDisplay.textContent = `₹${(count * pricePerSeat).toLocaleString('en-IN')}`;
      this.bookSeatsBtn.disabled = false;
      this.stormSeatBtn.disabled = false;
    }
  }

  async reserveSelectedSeats() {
    if (this.selectedSeats.size === 0 || !this.currentShow) return;

    const base = this.getBaseUrl();
    const seats = Array.from(this.selectedSeats).sort();
    const userId = this.userTokenInput.value.trim() || 'usr_buyer_alice';
    const idempKey = `idemp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    this.bookSeatsBtn.disabled = true;
    this.bookSeatsBtn.textContent = 'Reserving...';

    try {
      const res = await fetch(`${base}/shows/${this.currentShow.id}/reserve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userId}`,
          'Idempotency-Key': idempKey,
        },
        body: JSON.stringify({ seats }),
      });

      const data = await res.json();
      if (res.status === 201) {
        this.showAlert(`🎉 Successfully reserved seat(s) ${seats.join(', ')}! (Reservation: ${data.reservation_id.substring(0, 8)}...)`, 'success');
        this.selectedSeats.clear();
        this.userReservations.unshift({
          id: data.reservation_id,
          seats: data.seats,
          amount: data.amount_paise,
          userId,
        });
        this.renderUserReservations();
        await this.fetchShowState(this.currentShow.id);
      } else {
        this.showAlert(`❌ Booking Declined (${res.status}): ${data.message || data.error}`, 'error');
        await this.fetchShowState(this.currentShow.id);
      }
    } catch (err) {
      this.showAlert(`Network error: ${err.message}`, 'error');
    } finally {
      this.bookSeatsBtn.textContent = '⚡ Reserve Selected Seats';
      this.renderSelectedSummary();
    }
  }

  async stormHotSeat() {
    if (this.selectedSeats.size === 0 || !this.currentShow) {
      this.showAlert('Please select at least 1 seat to test concurrency contention.', 'error');
      return;
    }

    const hotSeat = [Array.from(this.selectedSeats)[0]];
    const base = this.getBaseUrl();
    const count = 50;

    this.showAlert(`🔥 Launching 50 concurrent requests for seat ${hotSeat[0]}...`, 'info', null);
    this.stormSeatBtn.disabled = true;

    const promises = Array.from({ length: count }, (_, i) => {
      const stormUserId = `usr_storm_${i}_${Math.random().toString(36).substring(2, 6)}`;
      const stormKey = `idemp_storm_${i}_${Date.now()}`;
      return fetch(`${base}/shows/${this.currentShow.id}/reserve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${stormUserId}`,
          'Idempotency-Key': stormKey,
        },
        body: JSON.stringify({ seats: hotSeat }),
      }).then((r) => r.status).catch(() => 0);
    });

    const results = await Promise.all(promises);
    const winners = results.filter((s) => s === 201).length;
    const declines = results.filter((s) => s === 409).length;
    const errors = results.filter((s) => s >= 500).length;

    this.selectedSeats.clear();
    await this.fetchShowState(this.currentShow.id);
    this.stormSeatBtn.disabled = false;

    if (winners === 1 && declines === count - 1 && errors === 0) {
      this.showAlert(`⚡ ZERO DOUBLE-SELL PROVEN! Exactly 1 winner (201), ${declines} clean declines (409), 0 server errors!`, 'success', 8000);
    } else {
      this.showAlert(`Results: ${winners} Confirmed (201), ${declines} Declined (409), ${errors} Errors (500)`, winners === 1 ? 'info' : 'error', 8000);
    }
  }

  async cancelReservation(resId, userId) {
    const base = this.getBaseUrl();
    try {
      const res = await fetch(`${base}/reservations/${resId}/cancel`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${userId}`,
        },
      });

      if (res.ok) {
        this.showAlert(`Reservation ${resId.substring(0, 8)}... cancelled and seats released!`, 'success');
        this.userReservations = this.userReservations.filter((r) => r.id !== resId);
        this.renderUserReservations();
        await this.fetchShowState(this.currentShow.id);
      } else {
        const data = await res.json();
        this.showAlert(`Cancellation failed: ${data.message || data.error}`, 'error');
      }
    } catch (err) {
      this.showAlert(`Cancellation error: ${err.message}`, 'error');
    }
  }

  renderUserReservations() {
    this.userReservationsCount.textContent = `${this.userReservations.length} bookings`;
    if (this.userReservations.length === 0) {
      this.userBookingsTableBody.innerHTML = `<tr><td colspan="5" class="empty-state">No active reservations for this user session.</td></tr>`;
      return;
    }

    this.userBookingsTableBody.innerHTML = '';
    this.userReservations.forEach((r) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><code class="code-pill">${r.id.substring(0, 8)}...</code></td>
        <td><strong>${r.seats.join(', ')}</strong></td>
        <td>₹${(r.amount / 100).toLocaleString('en-IN')}</td>
        <td><span class="tag-success">CONFIRMED</span></td>
        <td>
          <button class="cancel-res-btn" data-id="${r.id}" data-user="${r.userId}">
            Release Seats
          </button>
        </td>
      `;
      tr.querySelector('.cancel-res-btn').addEventListener('click', (e) => {
        this.cancelReservation(e.target.dataset.id, e.target.dataset.user);
      });
      this.userBookingsTableBody.appendChild(tr);
    });
  }

  // --- Observability & Probes Engine ---
  async runProbes() {
    const base = this.getBaseUrl();
    await Promise.all([
      this.checkLiveness(base),
      this.checkReadiness(base),
    ]);
  }

  async checkLiveness(base) {
    const start = performance.now();
    try {
      const res = await fetch(`${base}/livez`);
      const latency = Math.round(performance.now() - start);
      if (res.ok) {
        this.livenessBadge.textContent = 'HEALTHY';
        this.livenessBadge.className = 'badge badge-success';
        this.livenessStatus.textContent = 'ALIVE (200 OK)';
        this.livenessStatus.style.color = 'var(--success)';
        this.livenessLatency.textContent = `${latency} ms`;
        this.livenessTime.textContent = new Date().toLocaleTimeString();
        this.addAuditLog('/livez', res.status, latency, 'OK', true);
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err) {
      const latency = Math.round(performance.now() - start);
      this.livenessBadge.textContent = 'UNHEALTHY';
      this.livenessBadge.className = 'badge badge-danger';
      this.livenessStatus.textContent = 'FAIL';
      this.livenessStatus.style.color = 'var(--danger)';
      this.livenessLatency.textContent = `${latency} ms`;
      this.addAuditLog('/livez', 503, latency, err.message, false);
    }
  }

  async checkReadiness(base) {
    const start = performance.now();
    try {
      const res = await fetch(`${base}/readyz`);
      const latency = Math.round(performance.now() - start);
      if (res.ok) {
        const body = await res.json();
        this.readinessBadge.textContent = 'CONNECTED';
        this.readinessBadge.className = 'badge badge-success';
        this.readinessStatus.textContent = 'READY (200 OK)';
        this.readinessStatus.style.color = 'var(--success)';
        this.readinessLatency.textContent = `${body.latency_ms || latency} ms`;
        this.readinessTime.textContent = new Date().toLocaleTimeString();
        this.dbStatus.textContent = 'CONNECTED (HEALTHY)';
        this.dbStatus.style.color = 'var(--success)';
        this.overallBadge.className = 'status-indicator status-live';
        this.overallText.textContent = 'SYSTEM OPERATIONAL';
        this.addAuditLog('/readyz', res.status, latency, 'DB CONNECTED', true);
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err) {
      const latency = Math.round(performance.now() - start);
      this.readinessBadge.textContent = 'DISCONNECTED';
      this.readinessBadge.className = 'badge badge-danger';
      this.readinessStatus.textContent = 'UNAVAILABLE';
      this.readinessStatus.style.color = 'var(--danger)';
      this.readinessLatency.textContent = `${latency} ms`;
      this.dbStatus.textContent = 'UNREACHABLE';
      this.dbStatus.style.color = 'var(--danger)';
      this.overallBadge.className = 'status-indicator status-down';
      this.overallText.textContent = 'SYSTEM DEGRADED';
      this.addAuditLog('/readyz', 503, latency, err.message, false);
    }
  }

  addAuditLog(endpoint, status, latency, dbStatus, isSuccess) {
    this.auditLogs.unshift({
      time: new Date().toLocaleTimeString(),
      endpoint,
      status,
      latency,
      dbStatus,
      isSuccess,
    });
    if (this.auditLogs.length > 30) this.auditLogs.pop();
    this.renderAuditTable();
  }

  renderAuditTable() {
    this.auditCount.textContent = `${this.auditLogs.length} events logged`;
    this.auditTableBody.innerHTML = '';
    this.auditLogs.forEach((log) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${log.time}</td>
        <td><code class="code-pill">${log.endpoint}</code></td>
        <td><span class="${log.isSuccess ? 'tag-success' : 'tag-fail'}">${log.status}</span></td>
        <td>${log.latency} ms</td>
        <td>${log.dbStatus}</td>
        <td><span class="${log.isSuccess ? 'badge badge-success' : 'badge badge-danger'}">${log.isSuccess ? 'PASS' : 'FAIL'}</span></td>
      `;
      this.auditTableBody.appendChild(tr);
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new UnifiedDashboard();
});
