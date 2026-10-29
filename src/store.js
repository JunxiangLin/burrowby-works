// Non-secret app settings in config.json. Factory data (workers, jobs,
// projects, tasks, context, chat) lives in works.json, owned by the engine.
const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = {
  model: 'claude-sonnet-5-5', // "balanced" tier
  quickModel: 'claude-haiku-5-5',
  deepModel: 'claude-opus-5-5',
  roam: true,
  claudePath: '', // empty = find claude.exe on PATH / ~/.local/bin
};

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

class Store {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.configFile = path.join(dir, 'config.json');
  }

  getConfig() {
    return { ...DEFAULT_CONFIG, ...readJson(this.configFile, {}) };
  }

  saveConfig(patch) {
    const next = { ...this.getConfig(), ...patch };
    const tmp = `${this.configFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
    fs.renameSync(tmp, this.configFile);
    return next;
  }
}

module.exports = { Store, DEFAULT_CONFIG };
