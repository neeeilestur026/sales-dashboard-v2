/* Load Code.gs into Node with just enough Apps Script stubbed to run the real functions.
 *
 * The sibling of gasload.js, which does this for FlowAPI.gs. It could not simply be reused: FlowAPI
 * declares a global SCHEMA that maps sheet name -> headers, and its stub reads that to lay rows out
 * positionally. Code.gs has no SCHEMA at all — every sheet is declared inline at its
 * `_getOrCreateSheet(ss, name, [headers])` call site. So here the sheet IS a 2-D array with the
 * header as row 0, exactly like the real thing, and the headers arrive by being appended when the
 * sheet is created.
 *
 * That difference matters rather than being cosmetic: the salary-deduction column is appended at
 * position 16 of a 15-wide sheet, and the whole risk being tested is positional. A stub that keyed
 * on names would quietly paper over the one failure mode worth catching.
 *
 * Deliberately the smallest stub that lets the real file run. If a behaviour depends on something
 * not stubbed here it should fail loudly rather than pass against a fiction.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const GS = path.join(__dirname, '..', '..', 'apps-script', 'Code.gs');

function makeSheet(name, grid) {
  const s = {
    _name: name,
    _grid: grid,                                   // [ [header...], [row...], ... ]
    getName: () => name,
    getLastRow: () => grid.length,
    getLastColumn: () => grid.reduce((m, r) => Math.max(m, r.length), 0),
    setFrozenRows: () => s,
    appendRow: (arr) => { grid.push(arr.slice()); return s; },
    deleteRow: (rowIndex) => { grid.splice(rowIndex - 1, 1); return s; },
    getDataRange: () => ({
      getValues: () => {
        const w = s.getLastColumn();
        return grid.map(r => { const o = r.slice(); while (o.length < w) o.push(''); return o; });
      }
    }),
    getRange: (row, col, nRows, nCols) => {
      nRows = nRows || 1; nCols = nCols || 1;
      const rng = {
        getValues: () => {
          const out = [];
          for (let r = 0; r < nRows; r++) {
            const src = grid[row - 1 + r] || [];
            const line = [];
            for (let c = 0; c < nCols; c++) line.push(src[col - 1 + c] === undefined ? '' : src[col - 1 + c]);
            out.push(line);
          }
          return out;
        },
        getValue: () => {
          const src = grid[row - 1] || [];
          return src[col - 1] === undefined ? '' : src[col - 1];
        },
        setValues: (vals) => {
          for (let r = 0; r < vals.length; r++) {
            while (grid.length < row + r) grid.push([]);
            const dst = grid[row - 1 + r];
            for (let c = 0; c < vals[r].length; c++) dst[col - 1 + c] = vals[r][c];
          }
          return rng;
        },
        setValue: (v) => {
          while (grid.length < row) grid.push([]);
          grid[row - 1][col - 1] = v;
          return rng;
        },
        setFontWeight: () => rng,
        setNumberFormat: () => rng,
        setBackground: () => rng
      };
      return rng;
    }
  };
  return s;
}

function makeCtx(store) {
  store = store || {};                               // { sheetName: [ [header...], [row...] ] }
  const sheets = {};
  Object.keys(store).forEach(n => { sheets[n] = makeSheet(n, store[n]); });

  const ss = {
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => { store[n] = []; sheets[n] = makeSheet(n, store[n]); return sheets[n]; },
    getSheets: () => Object.keys(sheets).map(n => sheets[n])
  };

  const cache = {};
  const ctx = {
    console, JSON, Math, Date, String, Number, Object, Array, parseInt, parseFloat, isNaN, RegExp, Error,
    SpreadsheetApp: { openById: () => ss, getActiveSpreadsheet: () => ss },
    Session: { getScriptTimeZone: () => 'Asia/Manila', getActiveUser: () => ({ getEmail: () => '' }) },
    Utilities: {
      formatDate: (d, tz, fmt) => {
        const p = (n, w) => String(n).padStart(w || 2, '0');
        return fmt
          .replace('yyyy', d.getFullYear())
          .replace('MM', p(d.getMonth() + 1))
          .replace('dd', p(d.getDate()))
          .replace('HH', p(d.getHours()))
          .replace('mm', p(d.getMinutes()))
          .replace('ss', p(d.getSeconds()));
      },
      base64Decode: (s) => Buffer.from(s, 'base64'),
      base64Encode: (b) => Buffer.from(b).toString('base64'),
      newBlob: () => ({ getBytes: () => [], setName: function () { return this; } }),
      getUuid: () => 'uuid-' + Math.random().toString(36).slice(2)
    },
    /* A real lock, not a no-op: _sdPostForPeriod's idempotency depends on it being taken and
       released, and a stub that silently succeeded twice would hide a double-post. */
    LockService: {
      getScriptLock: () => {
        let held = false;
        return {
          waitLock: () => { if (held) throw new Error('lock busy'); held = true; },
          tryLock: () => { if (held) return false; held = true; return true; },
          releaseLock: () => { held = false; }
        };
      }
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (cache[k] === undefined ? null : cache[k]),
        put: (k, v) => { cache[k] = v; },
        remove: (k) => { delete cache[k]; }
      })
    },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} })
    },
    Logger: { log: () => {} },
    DriveApp: { getFolderById: () => { throw new Error('DriveApp not stubbed'); } },
    MailApp: { sendEmail: () => {} },
    UrlFetchApp: { fetch: () => ({ getContentText: () => '{}', getResponseCode: () => 200 }) },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (t) => ({ setMimeType: () => ({ getContent: () => t }) })
    },
    HtmlService: { createHtmlOutput: (h) => ({ getContent: () => h }) }
  };
  ctx.global = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(GS, 'utf8'), ctx, { filename: 'Code.gs' });
  ctx.__store = store;
  ctx.__ss = ss;
  return ctx;
}

/** Seed a signed-in user so the handlers' own validateSession finds them. */
function seedSession(store, token, username, fullName, role) {
  const far = new Date(Date.now() + 8 * 3600 * 1000).toISOString();
  store.Sessions = store.Sessions || [['Token', 'Username', 'Full Name', 'Role', 'Created At', 'Expires At']];
  store.Sessions.push([token, username, fullName, role, new Date().toISOString(), far]);
  return token;
}

module.exports = { makeCtx, seedSession, makeSheet };
