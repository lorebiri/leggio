// Impostazioni persistenti (localStorage).
const KEY = 'leggio.settings.v1';
export class Settings {
  constructor(bus) { this.bus = bus; try { this.data = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { this.data = {}; } }
  get(k, def) { return k in this.data ? this.data[k] : def; }
  set(k, v) { this.data[k] = v; localStorage.setItem(KEY, JSON.stringify(this.data)); this.bus.emit('settings:changed', { key: k, value: v }); }
}
