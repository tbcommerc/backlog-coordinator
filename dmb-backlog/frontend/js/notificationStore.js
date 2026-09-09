import { recordNotificationUxEvent } from './notificationUtils.js?v=3';

export class NotificationStore {
  constructor(app) {
    this.app = app;
    this.snapshot = null;
    this.error = null;
    this.listeners = new Set();
    this.inFlight = null;
    this.refreshQueued = false;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    if (this.snapshot || this.error) listener({ snapshot: this.snapshot, error: this.error });
    return () => this.listeners.delete(listener);
  }

  emit() {
    const state = { snapshot: this.snapshot, error: this.error };
    this.listeners.forEach(listener => {
      try { listener(state); } catch (error) { console.warn('Notification subscriber failed', error); }
    });
  }

  async refresh({ source = 'poll' } = {}) {
    if (this.inFlight) return this.inFlight;
    const startedAt = Date.now();
    this.inFlight = this.app.api.get('/notifications/snapshot')
      .then(snapshot => {
        if (!this.snapshot || Number(snapshot.revision || 0) >= Number(this.snapshot.revision || 0)) {
          this.snapshot = snapshot;
        }
        this.error = null;
        this.emit();
        return this.snapshot;
      })
      .catch(error => {
        this.error = error;
        this.emit();
        const surface = ['center', 'bell', 'dashboard', 'toast'].includes(source) ? source : 'bell';
        recordNotificationUxEvent(this.app, 'notification_fetch_failed', { surface });
        throw error;
      })
      .finally(() => {
        this.inFlight = null;
        if (this.refreshQueued) {
          this.refreshQueued = false;
          this.refresh({ source: 'realtime' }).catch(() => {});
        }
        const lag = Date.now() - startedAt;
        if (source === 'realtime' && lag > 5000) {
          recordNotificationUxEvent(this.app, 'notification_realtime_lag_detected', {
            surface: 'center', duration_ms: lag,
          });
        }
      });
    return this.inFlight;
  }

  invalidate() {
    if (this.inFlight) {
      this.refreshQueued = true;
      return this.inFlight;
    }
    return this.refresh({ source: 'realtime' });
  }
}

export function createNotificationStore(app) {
  return new NotificationStore(app);
}
