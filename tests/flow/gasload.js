/* Load FlowAPI.gs into Node with just enough Apps Script stubbed to exercise the real functions.
 *
 * Sheets are backed by an in-memory store, so _rows / _append / _setCellByKey / _writeItems really
 * work and the WIDTH TRAP is genuinely under test: appendRow maps the array onto SCHEMA positionally,
 * exactly as Sheets does, so a value list one short shifts every column after it here too.
 *
 * WHY THIS LIVES IN THE REPO. It used to live in /tmp with 22 suites beside it, and /tmp was cleared
 * between sessions — every regression test for the commission money, the SOA ladder and the A211
 * access controls went with it. Anything worth running twice belongs somewhere that survives.
 *
 * Deliberately NOT a mock of Apps Script. It is the smallest stub that lets the real file run: if a
 * behaviour depends on something not stubbed here, the test should fail loudly rather than pass
 * against a fiction.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const GS = path.join(__dirname, '..', '..', 'apps-script', 'FlowAPI.gs');

function makeCtx(store) {
  store = store || {};                                   // { sheetName: [ {header: value}, ... ] }
  const props = {};

  function sheetStub(name) {
    return {
      _name: name,
      getName: () => name,
      getLastRow: () => (store[name] || []).length + 1,
      getLastColumn: () => (ctx.SCHEMA && ctx.SCHEMA[name] ? ctx.SCHEMA[name].length : 0),
      /* Positional, like the real appendRow. A short array leaves the tail undefined→'' rather than
         throwing, which is precisely how the width trap hides. */
      appendRow: (arr) => {
        const headers = ctx.SCHEMA[name];
        const obj = {};
        headers.forEach((h, i) => { obj[h] = arr[i] === undefined ? '' : arr[i]; });
        obj.__arity = arr.length;                        // so a suite can assert arity === width
        (store[name] = store[name] || []).push(obj);
      },
      deleteRow: (rowIndex) => { (store[name] || []).splice(rowIndex - 2, 1); },
      setFrozenRows: () => {},
      getRange: function (row, col, nRows, nCols) {
        const rng = {
          setValues: function (vals) {
            if (row === 1) return rng;                   // header write — ignore
            const headers = ctx.SCHEMA[name];
            const rec = (store[name] || [])[row - 2];
            if (!rec) return rng;
            for (let c = 0; c < (nCols || vals[0].length); c++) rec[headers[col - 1 + c]] = vals[0][c];
            return rng;
          },
          setFontWeight: function () { return rng; },    // must CHAIN — .setValues(...).setFontWeight()
          getValues: () => {
            const headers = ctx.SCHEMA[name];
            const rows = store[name] || [];
            const out = [];
            for (let r = 0; r < nRows; r++) {
              const rec = rows[row - 2 + r] || {};
              const line = [];
              for (let c = 0; c < nCols; c++) {
                const v = rec[headers[col - 1 + c]];
                line.push(v === undefined ? '' : v);
              }
              out.push(line);
            }
            return out;
          },
          clearContent: function () { return rng; },
          setNumberFormat: function () { return rng; },
          setBackground: function () { return rng; }
        };
        return rng;
      }
    };
  }

  const ss = {
    getSheetByName: (n) => (store[n] !== undefined ? sheetStub(n) : null),
    insertSheet: (n) => { store[n] = []; return sheetStub(n); },
    getSheets: () => Object.keys(store).map(sheetStub),
    deleteSheet: () => {}
  };

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
                       'August', 'September', 'October', 'November', 'December'];

  const ctx = {
    console,
    SHEET_ID: 'test-sheet',
    SpreadsheetApp: {
      openById: () => ss,
      getActiveSpreadsheet: () => ss,
      flush: () => {}
    },
    /* Timezone is ignored: the tests build dates in local time and read them back the same way, so a
       real tz conversion here would make assertions depend on the machine. Anything that genuinely
       cares about Manila must be asserted through the code's own Utilities.formatDate call. */
    Utilities: {
      formatDate: (d, tz, fmt) => {
        const p = (n, w) => String(n).padStart(w || 2, '0');
        return String(fmt)
          .replace(/yyyy/g, d.getFullYear())
          .replace(/MMMM/g, MONTHS_LONG[d.getMonth()])
          .replace(/MMM/g, MONTHS[d.getMonth()])
          .replace(/MM/g, p(d.getMonth() + 1))
          .replace(/dd/g, p(d.getDate()))
          .replace(/HH/g, p(d.getHours()))
          .replace(/mm/g, p(d.getMinutes()))
          .replace(/ss/g, p(d.getSeconds()));
      },
      base64Decode: (s) => Buffer.from(String(s), 'base64'),
      base64Encode: (b) => Buffer.from(b).toString('base64'),
      newBlob: (bytes, mime, name) => ({ bytes, mime, name, getBytes: () => bytes })
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props[k] === undefined ? null : props[k]),
        setProperty: (k, v) => { props[k] = String(v); },
        deleteProperty: (k) => { delete props[k]; }
      })
    },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (t) => ({ _text: t, setMimeType: function () { return this; },
                                  getContent: function () { return this._text; } })
    },
    Session: { getScriptTimeZone: () => 'Asia/Manila', getActiveUser: () => ({ getEmail: () => '' }) },
    /* Drive is a black hole on purpose. A suite that needs to assert a FOLDER PATH should call
       _docFolderPath (pure, returns segments) rather than driving this. */
    DriveApp: {
      Access: { ANYONE_WITH_LINK: 'anyone' },
      Permission: { VIEW: 'view' },
      getRootFolder: () => folderStub('root'),
      getFolderById: () => folderStub('byid'),
      getFoldersByName: () => ({ hasNext: () => false, next: () => folderStub('x') })
    },
    Logger: { log: () => {} },
    MailApp: { sendEmail: () => {} }
  };

  function folderStub(name) {
    const f = {
      getName: () => name,
      getId: () => 'folder-' + name,
      getUrl: () => 'https://drive.test/' + name,
      createFolder: (n) => folderStub(n),
      getFoldersByName: () => ({ hasNext: () => false, next: () => folderStub('x') }),
      getFilesByName: () => ({ hasNext: () => false, next: () => null }),
      createFile: () => ({ getUrl: () => 'https://drive.test/file', getId: () => 'file-1',
                           setSharing: () => {}, setName: () => {}, moveTo: () => {} }),
      getFiles: () => ({ hasNext: () => false })
    };
    return f;
  }

  ctx.__store = store;
  ctx.__props = props;
  return ctx;
}

/** Evaluate FlowAPI.gs in a fresh context. Returns the context: every top-level `function` and `var`
 *  is a property on it, so a suite calls handlers directly (c.getCommissionRequests({...})) or goes
 *  through the dispatcher (c._dispatch({action:...})) to exercise the secured/feature gates too.
 *  NOTE: `let`/`const` at the top level of a vm script live in lexical scope, NOT on the context —
 *  read or write those with vm.runInContext('NAME', ctx). FlowAPI.gs is ES5, so this rarely bites. */
function load(gsPath, store) {
  const ctx = makeCtx(store);
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(gsPath || GS, 'utf8'), ctx, { filename: 'FlowAPI.gs' });
  return ctx;
}

/** Call through the dispatcher and parse the JSON back out, the way the browser sees it. */
function call(ctx, action, params) {
  const out = ctx._dispatch(Object.assign({ action: action }, params || {}));
  return JSON.parse(out._text !== undefined ? out._text : out.getContent());
}

module.exports = { load, call, GS };
