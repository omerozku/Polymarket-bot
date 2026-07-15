// Log level filter: set LOG_LEVEL=warn or LOG_LEVEL=error to reduce output
const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const threshold = LEVELS[LOG_LEVEL] ?? 2;

const origLog = console.log;
const origWarn = console.warn;
const origError = console.error;
const origInfo = console.info;

console.log = (...args) => { if (threshold >= 2) origLog(...args); };
console.info = (...args) => { if (threshold >= 2) origInfo(...args); };
console.warn = (...args) => { if (threshold >= 1) origWarn(...args); };
console.error = (...args) => { if (threshold >= 0) origError(...args); };

require('tsx/cjs');
require('./bot-with-dashboard.ts');
