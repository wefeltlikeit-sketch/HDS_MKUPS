/*
 * CQL Clarity — deterministic analysis engine
 * -------------------------------------------------
 * Pure functions that turn pasted CQL text into a structured analysis object.
 * No DOM, no rendering, no framework. This module is intentionally free of
 * any HTML-building so it can be unit-tested in Node and reused by the UI.
 *
 * Design principles (see CQL_Clarity_Enhancement_Guide):
 *   - Separate DETECTED facts from INFERRED intent and NOT-DETERMINED items.
 *   - Never claim the code is valid; we do structural analysis only.
 *   - Track source line numbers so every finding can link back to evidence.
 *
 * Works in the browser (window.CQLAnalyzer) and in Node (module.exports).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.CQLAnalyzer = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Small utilities
  // ---------------------------------------------------------------------------

  /** Escape a value for safe insertion into HTML text/attribute context. */
  function escapeHTML(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /** Replace every non-newline character with a space (keeps indices & lines). */
  function blank(str) {
    return str.replace(/[^\n]/g, ' ');
  }

  /**
   * Produce a scan-safe copy of the source: block comments, line comments and
   * single-quoted string literals are blanked to spaces (same length, newlines
   * preserved). Double-quoted identifiers are KEPT because in CQL they denote
   * references to definitions / value sets, which we want to detect.
   */
  function stripForScan(code) {
    let out = code;
    out = out.replace(/\/\*[\s\S]*?\*\//g, blank);
    out = out.replace(/\/\/[^\n]*/g, blank);
    out = out.replace(/'(?:[^'\\]|\\.)*'/g, blank);
    return out;
  }

  /** 1-based line number of a character index within `code`. */
  function lineAt(code, index) {
    let line = 1;
    const stop = Math.min(index, code.length);
    for (let i = 0; i < stop; i++) {
      if (code.charCodeAt(i) === 10) line++;
    }
    return line;
  }

  // ---------------------------------------------------------------------------
  // Header / declaration extraction
  // ---------------------------------------------------------------------------

  function extractLibrary(code) {
    const lib = { name: '', version: '', model: '', modelVersion: '', context: '' };
    const m = code.match(/\blibrary\s+([A-Za-z0-9_.]+)(?:\s+version\s+'([^']*)')?/i);
    if (m) {
      lib.name = m[1];
      lib.version = m[2] || '';
    }
    const using = code.match(/\busing\s+([A-Za-z0-9_]+)(?:\s+version\s+'([^']*)')?/i);
    if (using) {
      lib.model = using[1];
      lib.modelVersion = using[2] || '';
    }
    const ctx = code.match(/\bcontext\s+([A-Za-z]+)/i);
    if (ctx) lib.context = ctx[1];
    return lib;
  }

  function extractIncludes(code) {
    const out = [];
    const re = /\binclude\s+([A-Za-z0-9_.]+)(?:\s+version\s+'([^']*)')?(?:\s+called\s+([A-Za-z0-9_]+))?/gi;
    let m;
    while ((m = re.exec(code)) !== null) {
      out.push({ name: m[1], version: m[2] || '', alias: m[3] || '' });
    }
    return out;
  }

  function extractParameters(code) {
    const out = [];
    const re = /\bparameter\s+(?:"([^"]+)"|([A-Za-z0-9_]+))\s*([^\n]*)/gi;
    let m;
    while ((m = re.exec(code)) !== null) {
      const name = (m[1] || m[2] || '').trim();
      out.push({ name: name, definition: (m[3] || '').trim() });
    }
    return out;
  }

  function extractTerminology(code) {
    const term = { codeSystems: [], valueSets: [], codes: [], concepts: [] };
    const grab = (re, into) => {
      let m;
      while ((m = re.exec(code)) !== null) {
        into.push({ name: m[1], id: m[2] || '' });
      }
    };
    grab(/\bvalueset\s+"([^"]+)"\s*:\s*'([^']*)'/gi, term.valueSets);
    grab(/\bcodesystem\s+"([^"]+)"\s*:\s*'([^']*)'/gi, term.codeSystems);
    grab(/\bcode\s+"([^"]+)"\s*:\s*'([^']*)'/gi, term.codes);
    grab(/\bconcept\s+"([^"]+)"\s*:/gi, term.concepts);
    return term;
  }

  // ---------------------------------------------------------------------------
  // Definition extraction (replaces the broken `\Z` regex with a scanner)
  // ---------------------------------------------------------------------------

  /**
   * Find declaration start positions for `define`, `define function`, `function`.
   * Scans the comment/string-stripped copy so commented-out or quoted keywords
   * are ignored. Returns [{ name, kind, matchStart }].
   */
  function findDeclarations(scanCode) {
    const decls = [];
    const re = /^[ \t]*(?:private\s+)?(define\s+function|function|define)\s+"([^"]+)"/gim;
    let m;
    while ((m = re.exec(scanCode)) !== null) {
      const kw = m[1].toLowerCase();
      decls.push({
        name: m[2],
        kind: kw.indexOf('function') !== -1 ? 'function' : 'define',
        matchStart: m.index,
      });
    }
    return decls;
  }

  /** Index of the first top-level `:` in a block (skips quotes/brackets). */
  function firstTopLevelColon(block) {
    let depth = 0;
    let inS = false;
    let inD = false;
    for (let i = 0; i < block.length; i++) {
      const c = block[i];
      if (inS) { if (c === "'") inS = false; continue; }
      if (inD) { if (c === '"') inD = false; continue; }
      if (c === "'") { inS = true; continue; }
      if (c === '"') { inD = true; continue; }
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') depth--;
      else if (c === ':' && depth === 0) return i;
    }
    return -1;
  }

  function extractDefinitions(code, scanCode) {
    const decls = findDeclarations(scanCode);
    const defs = [];
    for (let i = 0; i < decls.length; i++) {
      const start = decls[i].matchStart;
      const end = i + 1 < decls.length ? decls[i + 1].matchStart : code.length;
      const rawBlock = code.slice(start, end);
      const scanBlock = scanCode.slice(start, end);

      const colon = firstTopLevelColon(scanBlock);
      let expression = '';
      let exprOffset = 0;
      if (colon !== -1) {
        exprOffset = colon + 1;
        expression = rawBlock.slice(exprOffset);
      }
      // Trim trailing blank space but remember trimmed length for end-line calc.
      const trimmedExpr = expression.replace(/\s+$/, '');
      const startLine = lineAt(code, start);
      const endLine = lineAt(code, start + exprOffset + trimmedExpr.length);

      defs.push({
        name: decls[i].name,
        kind: decls[i].kind,
        startLine: startLine,
        endLine: endLine,
        expression: trimmedExpr.replace(/^\s+/, ''),
        scanExpression: scanBlock.slice(exprOffset).replace(/\s+$/, '').replace(/^\s+/, ''),
      });
    }
    return defs;
  }

  // ---------------------------------------------------------------------------
  // Reference detection & dependency graph
  // ---------------------------------------------------------------------------

  /**
   * Collect double-quoted tokens in a scan-expression, tagged with whether they
   * sit inside a retrieve bracket `[...]` and the significant char before them.
   */
  function collectQuotedTokens(scanExpr) {
    const tokens = [];
    let depthBracket = 0;
    let prevSig = '';
    for (let i = 0; i < scanExpr.length; i++) {
      const c = scanExpr[i];
      if (c === '[') { depthBracket++; prevSig = c; continue; }
      if (c === ']') { depthBracket = Math.max(0, depthBracket - 1); prevSig = c; continue; }
      if (c === '"') {
        let j = i + 1;
        while (j < scanExpr.length && scanExpr[j] !== '"') j++;
        tokens.push({
          text: scanExpr.slice(i + 1, j),
          inBracket: depthBracket > 0,
          prev: prevSig,
        });
        i = j;
        continue;
      }
      if (!/\s/.test(c)) prevSig = c;
    }
    return tokens;
  }

  function analyzeReferences(def, symbolTable) {
    const references = [];
    const unresolved = [];
    const seen = new Set();
    const tokens = collectQuotedTokens(def.scanExpression);
    for (const tok of tokens) {
      if (tok.inBracket) continue;              // value set inside a retrieve
      if (tok.text === def.name) continue;       // self reference
      if (seen.has(tok.text)) continue;
      // A comparison like `~ "active"` targets a code, not a definition.
      if (tok.prev && '~=<>!'.indexOf(tok.prev) !== -1) continue;
      seen.add(tok.text);
      if (symbolTable.has(tok.text)) {
        references.push(tok.text);
      } else {
        unresolved.push(tok.text);
      }
    }
    return { references, unresolved };
  }

  function detectCycles(graph) {
    const cycles = [];
    const state = {}; // 0=unseen,1=visiting,2=done
    const stack = [];
    function dfs(node) {
      state[node] = 1;
      stack.push(node);
      for (const next of graph[node] || []) {
        if (!(next in graph)) continue;
        if (state[next] === 1) {
          const idx = stack.indexOf(next);
          cycles.push(stack.slice(idx).concat(next));
        } else if (!state[next]) {
          dfs(next);
        }
      }
      stack.pop();
      state[node] = 2;
    }
    for (const node of Object.keys(graph)) {
      if (!state[node]) dfs(node);
    }
    return cycles;
  }

  // ---------------------------------------------------------------------------
  // Retrieves, operators, timing
  // ---------------------------------------------------------------------------

  function extractRetrieves(scanExpr) {
    const out = [];
    const re = /\[\s*([A-Za-z]+)\s*(?::\s*"([^"]+)")?\s*\]/g;
    let m;
    while ((m = re.exec(scanExpr)) !== null) {
      out.push({ resourceType: m[1], valueSet: m[2] || '' });
    }
    return out;
  }

  const OPERATOR_WORDS = [
    'and', 'or', 'not', 'xor', 'implies', 'exists', 'union', 'intersect',
    'except', 'in', 'contains', 'during', 'overlaps', 'before', 'after',
    'within', 'meets', 'starts', 'ends', 'includes', 'properly', 'same',
  ];

  function extractOperators(scanExpr) {
    const lower = scanExpr.toLowerCase();
    const found = [];
    for (const w of OPERATOR_WORDS) {
      if (new RegExp('\\b' + w + '\\b').test(lower)) found.push(w);
    }
    return found;
  }

  // Curated FHIR-ish attributes we surface in the data-requirements matrix.
  const KNOWN_ATTRIBUTES = [
    'onset', 'abatement', 'clinicalStatus', 'verificationStatus', 'effective',
    'effectiveDateTime', 'effectivePeriod', 'value', 'authoredOn', 'performed',
    'performedPeriod', 'period', 'status', 'code', 'component', 'gender',
    'birthDate', 'recordedDate', 'issued', 'category', 'severity', 'dosage',
    'medication', 'reasonCode', 'intent',
  ];

  /** Distinct known FHIR attributes accessed via `.attribute` in the expression. */
  function extractAttributes(scanExpr) {
    const found = [];
    for (const attr of KNOWN_ATTRIBUTES) {
      if (new RegExp('\\.' + attr + '\\b').test(scanExpr) && found.indexOf(attr) === -1) {
        found.push(attr);
      }
    }
    return found;
  }

  const TIMING_PHRASES = [
    'during', 'overlaps', 'starts before start', 'ends after end',
    'starts during', 'ends during', 'same day as', 'same year as',
    'on or after', 'on or before', 'properly includes', 'includes',
    'before', 'after', 'within', 'meets',
  ];

  function extractTiming(scanExpr) {
    const lower = scanExpr.toLowerCase();
    const phrases = [];
    for (const p of TIMING_PHRASES) {
      if (lower.indexOf(p) !== -1 && phrases.indexOf(p) === -1) {
        // Avoid double-counting the short word when a longer phrase matched.
        phrases.push(p);
      }
    }
    // Collapse: if "starts during" present, drop bare "during"? Keep simple —
    // report the most specific by removing generic substrings.
    const specific = phrases.filter(p => p.indexOf(' ') !== -1);
    const result = phrases.filter(p => {
      if (p.indexOf(' ') !== -1) return true;
      return !specific.some(s => s.indexOf(p) !== -1);
    });
    const offsets = [];
    const offRe = /([+-])\s*(\d+)\s+(year|month|week|day|hour|minute)s?/gi;
    let m;
    while ((m = offRe.exec(scanExpr)) !== null) {
      offsets.push((m[1] === '-' ? 'minus ' : 'plus ') + m[2] + ' ' + m[3] + (m[2] === '1' ? '' : 's'));
    }
    return { phrases: result, offsets: offsets };
  }

  /**
   * Best-effort structured temporal window for patterns like
   * `... during Interval[start of X, start of X + 6 months]`.
   */
  function extractTemporalWindows(def) {
    const windows = [];
    const re = /\bduring\s+Interval\s*\[\s*([^,]+?)\s*,\s*([^\]]+?)\s*\]/gi;
    let m;
    while ((m = re.exec(def.scanExpression)) !== null) {
      windows.push({
        definition: def.name,
        windowBegins: m[1].trim(),
        windowEnds: m[2].trim(),
        requirement: 'Event must occur within the interval',
        boundaryType: 'Interval brackets determine inclusivity',
        line: def.startLine,
      });
    }
    return windows;
  }

  // ---------------------------------------------------------------------------
  // Boolean structure parsing (ALL of / AT LEAST ONE of / NONE of)
  // ---------------------------------------------------------------------------

  function splitTop(expr, word) {
    const parts = [];
    let last = 0;
    let depth = 0;
    let inS = false;
    let inD = false;
    for (let i = 0; i < expr.length; i++) {
      const c = expr[i];
      if (inS) { if (c === "'") inS = false; continue; }
      if (inD) { if (c === '"') inD = false; continue; }
      if (c === "'") { inS = true; continue; }
      if (c === '"') { inD = true; continue; }
      if (c === '(' || c === '[' || c === '{') { depth++; continue; }
      if (c === ')' || c === ']' || c === '}') { depth--; continue; }
      if (depth !== 0) continue;
      if (expr.substr(i, word.length).toLowerCase() === word) {
        const prev = i === 0 ? ' ' : expr[i - 1];
        const next = expr[i + word.length];
        if (/\s/.test(prev) && (next === undefined || /\s/.test(next))) {
          parts.push(expr.slice(last, i));
          i += word.length - 1;
          last = i + 1;
        }
      }
    }
    parts.push(expr.slice(last));
    return parts.map(p => p.trim()).filter(p => p.length);
  }

  function wrapsWhole(expr) {
    if (expr[0] !== '(' || expr[expr.length - 1] !== ')') return false;
    let depth = 0;
    for (let i = 0; i < expr.length; i++) {
      if (expr[i] === '(') depth++;
      else if (expr[i] === ')') {
        depth--;
        if (depth === 0) return i === expr.length - 1;
      }
    }
    return false;
  }

  function parseBoolean(expr) {
    const e = (expr || '').trim();
    if (!e) return { type: 'atom', text: '' };
    return parseOr(e);
  }
  function parseOr(e) {
    const parts = splitTop(e, 'or');
    if (parts.length > 1) return { type: 'or', children: parts.map(parseAnd) };
    return parseAnd(e);
  }
  function parseAnd(e) {
    const parts = splitTop(e, 'and');
    if (parts.length > 1) return { type: 'and', children: parts.map(parseUnary) };
    return parseUnary(e);
  }
  function parseUnary(e) {
    const t = e.trim();
    if (/^not\s+exists\b/i.test(t)) {
      return { type: 'none', child: { type: 'atom', text: t.replace(/^not\s+exists\s*/i, '') } };
    }
    if (/^not\b/i.test(t)) {
      return { type: 'not', child: parsePrimary(t.replace(/^not\s+/i, '')) };
    }
    return parsePrimary(t);
  }
  function parsePrimary(e) {
    const t = e.trim();
    if (wrapsWhole(t)) return parseOr(t.slice(1, -1).trim());
    return { type: 'atom', text: t };
  }

  /** Human-friendly rewrite of a leaf expression. Always plain text (no HTML). */
  function humanizeAtom(text) {
    let t = (text || '').trim();
    if (!t) return '(empty)';

    // Bare reference to another definition: "Some Concept"
    const refOnly = t.match(/^"([^"]+)"$/);
    if (refOnly) return refOnly[1];

    // Age range
    const age = t.match(/AgeInYearsAt\s*\([^)]*\)\s*in\s*Interval\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]/i);
    if (age) return 'Patient age is between ' + age[1] + ' and ' + age[2] + ' years';
    const ageCmp = t.match(/AgeInYearsAt\s*\([^)]*\)\s*(>=|<=|>|<|=)\s*(\d+)/i);
    if (ageCmp) return 'Patient age is ' + ageCmp[1] + ' ' + ageCmp[2] + ' years';

    // Gender
    const gender = t.match(/\.gender\s*=\s*'?([A-Za-z]+)'?/i);
    if (gender) return 'Patient is ' + gender[1].toLowerCase();

    // exists ( [Type: "VS"] ... )
    const ex = t.match(/^exists\s*\(?\s*\[\s*([A-Za-z]+)\s*(?::\s*"([^"]+)")?/i);
    if (ex) {
      const vs = ex[2] ? '"' + ex[2] + '"' : '';
      let phrase = 'At least one ' + (vs ? vs + ' ' : '') + ex[1] + ' record exists';
      const timing = extractTiming(t);
      if (timing.phrases.length) phrase += ' (' + timing.phrases.join(', ') + ')';
      return phrase;
    }

    // Simple value comparison, e.g. "Most Recent HbA1c".value > 9 '%'
    const cmp = t.match(/^"?([^".]+)"?\.?([A-Za-z.]*)\s*(>=|<=|>|<|=)\s*(.+)$/);
    if (cmp && /[<>=]/.test(t) && t.length < 90) {
      return t.replace(/\s+/g, ' ');
    }

    // Fallback: the raw expression, whitespace-collapsed & length-capped.
    const collapsed = t.replace(/\s+/g, ' ');
    return collapsed.length > 140 ? collapsed.slice(0, 137) + '…' : collapsed;
  }

  /** Flatten a boolean tree into indented plain-text lines. */
  function booleanToLines(node, indent) {
    indent = indent || 0;
    const pad = '  '.repeat(indent);
    const lines = [];
    if (!node) return lines;
    if (node.type === 'and') {
      lines.push(pad + 'ALL of the following are true:');
      node.children.forEach(c => lines.push.apply(lines, booleanToLines(c, indent + 1)));
    } else if (node.type === 'or') {
      lines.push(pad + 'AT LEAST ONE of the following is true:');
      node.children.forEach(c => lines.push.apply(lines, booleanToLines(c, indent + 1)));
    } else if (node.type === 'none') {
      lines.push(pad + 'There is NO: ' + humanizeAtom(node.child.text));
    } else if (node.type === 'not') {
      const sub = booleanToLines(node.child, indent + 1);
      lines.push(pad + 'NOT true that:');
      lines.push.apply(lines, sub);
    } else {
      lines.push(pad + '• ' + humanizeAtom(node.text));
    }
    return lines;
  }

  // ---------------------------------------------------------------------------
  // Population roles & clinical intent
  // ---------------------------------------------------------------------------

  function populationRole(name) {
    const n = name.toLowerCase();
    if (/numerator\s+exclusion/.test(n)) return 'Numerator Exclusion';
    if (/\bnumerator\b/.test(n)) return 'Numerator';
    if (/denominator\s+exclusion/.test(n)) return 'Denominator Exclusion';
    if (/denominator\s+exception/.test(n)) return 'Denominator Exception';
    if (/\bdenominator\b/.test(n)) return 'Denominator';
    if (/initial\s+population/.test(n)) return 'Initial Population';
    if (/measure\s+population\s+exclusion/.test(n)) return 'Measure Population Exclusion';
    if (/measure\s+population/.test(n)) return 'Measure Population';
    if (/measure\s+observation/.test(n)) return 'Measure Observation';
    if (/stratif/.test(n)) return 'Stratification';
    if (/supplemental\s+data/.test(n)) return 'Supplemental Data Element';
    return '';
  }

  const POPULATION_ORDER = [
    'Initial Population', 'Denominator', 'Denominator Exclusion',
    'Denominator Exception', 'Numerator', 'Numerator Exclusion',
    'Measure Population', 'Measure Population Exclusion', 'Measure Observation',
    'Stratification', 'Supplemental Data Element',
  ];

  function inferReturnType(def) {
    const e = def.scanExpression.toLowerCase();
    if (def.kind === 'function') return 'Function';
    if (/^exists\b/.test(e.trim()) || /\b(and|or|not)\b/.test(e) || /[<>=]/.test(e)) return 'Boolean';
    if (/^\[/.test(e.trim())) return 'List';
    if (/^(first|last|singleton)\b/.test(e.trim())) return 'Tuple / single item';
    return 'Value or expression';
  }

  // ---------------------------------------------------------------------------
  // Review flags
  // ---------------------------------------------------------------------------

  function buildReviewFlags(def, retrieves) {
    const flags = [];
    const e = def.scanExpression;
    const lower = e.toLowerCase();

    if (/\b(last|first)\s*\(/i.test(e) && !/sort\s+by/i.test(e)) {
      const which = /\blast\s*\(/i.test(e) ? 'Last()' : 'First()';
      flags.push({
        severity: 'Review',
        definition: def.name,
        line: def.startLine,
        message: which + ' used without an explicit sort',
        why: which + ' returns whichever element the engine happens to order first unless you sort explicitly (e.g. `sort by effective desc`). Results can vary between systems.',
      });
    }
    if (/\bexists\b/i.test(lower)) {
      flags.push({
        severity: 'Info',
        definition: def.name,
        line: def.startLine,
        message: 'exists hides how many events matched',
        why: '`exists` only reports true/false. If the count matters (e.g. two visits required), a count check may be more appropriate.',
      });
    }
    retrieves.forEach(r => {
      if (r.resourceType === 'MedicationRequest') {
        flags.push({
          severity: 'Info',
          definition: def.name,
          line: def.startLine,
          message: 'MedicationRequest represents an order, not a dispense',
          why: 'A MedicationRequest means the medication was ordered/prescribed. It does not confirm the patient filled or took it.',
        });
      }
      if (r.resourceType === 'Condition' && !/clinicalstatus/i.test(lower)) {
        flags.push({
          severity: 'Info',
          definition: def.name,
          line: def.startLine,
          message: 'Condition retrieve does not check clinicalStatus',
          why: 'Without a clinicalStatus filter, resolved or entered-in-error conditions may be counted.',
        });
      }
    });
    return flags;
  }

  // ---------------------------------------------------------------------------
  // Per-definition explanation (plain English)
  // ---------------------------------------------------------------------------

  function explainDefinition(def, retrieves, timing, role) {
    const parts = [];
    if (role) {
      const roleText = {
        'Initial Population': 'the broadest group of patients the measure applies to',
        'Denominator': 'the patients eligible to be measured',
        'Denominator Exclusion': 'patients removed from the denominator before scoring',
        'Denominator Exception': 'patients with a valid reason not to meet the numerator',
        'Numerator': 'the patients who met the clinical goal (counted as compliant)',
        'Numerator Exclusion': 'patients removed from the numerator',
        'Measure Population': 'the population for a continuous-variable measure',
        'Measure Observation': 'the value being measured for each patient',
        'Stratification': 'a subgroup breakdown of the results',
        'Supplemental Data Element': 'extra data reported alongside the measure',
      }[role];
      if (roleText) parts.push('This is the ' + role + ' — ' + roleText + '.');
    }
    retrieves.forEach(r => {
      const vs = r.valueSet ? ' matching "' + r.valueSet + '"' : '';
      parts.push('Looks at ' + r.resourceType + ' records' + vs + '.');
    });
    if (timing.phrases.length || timing.offsets.length) {
      const bits = timing.phrases.concat(timing.offsets);
      parts.push('Applies a timing rule (' + bits.join(', ') + ').');
    }
    if (/^exists\b/i.test(def.scanExpression.trim())) {
      parts.push('Returns true when at least one matching record is found.');
    }
    if (parts.length === 0) {
      parts.push('Defines a reusable clinical concept used elsewhere in the library.');
    }
    return parts.join(' ');
  }

  // ---------------------------------------------------------------------------
  // Overall summary + confidence
  // ---------------------------------------------------------------------------

  function themeSentence(code) {
    const l = code.toLowerCase();
    if ((l.includes('fracture') || l.includes('fragility')) &&
        (l.includes('bmd') || l.includes('bone density') || l.includes('osteoporosis'))) {
      return 'It appears to identify patients (commonly older women) who had a fragility fracture and then received timely osteoporosis management — a BMD test or medication — within a follow-up window.';
    }
    if (l.includes('colorectal') || l.includes('colonoscopy') || l.includes('fecal')) {
      return 'It appears to support colorectal cancer screening logic, checking for qualifying tests within recommended age and time windows.';
    }
    if (l.includes('diabetes') && (l.includes('hba1c') || l.includes('glycemic'))) {
      return 'It appears to evaluate diabetes control, commonly checking HbA1c values against a quality target.';
    }
    if (l.includes('mammogra') || (l.includes('breast') && l.includes('screen'))) {
      return 'It appears to define breast cancer screening eligibility and compliance.';
    }
    if (l.includes('hypertension') || l.includes('blood pressure')) {
      return 'It appears to evaluate blood-pressure control for hypertensive patients.';
    }
    if (l.includes('initial population') || l.includes('numerator') || l.includes('denominator')) {
      return 'It follows the standard quality-measure population structure (Initial Population → Denominator → Numerator, with possible Exclusions).';
    }
    return 'It expresses clinical criteria using data retrieves, timing relationships and existence checks typical of quality measures.';
  }

  function computeConfidence(library, defs, unresolvedTotal) {
    const detected = [];
    const inferred = [];
    if (library.name) detected.push('library declared');
    if (library.context) detected.push('context declared');
    if (library.model) detected.push(library.model + ' model declared');
    if (defs.length) detected.push(defs.length + ' definition' + (defs.length === 1 ? '' : 's') + ' found');
    const roles = defs.filter(d => d.populationRole).length;
    if (roles) inferred.push(roles + ' population role' + (roles === 1 ? '' : 's') + ' inferred from names');
    inferred.push('clinical intent inferred from names, terminology and timing');

    let level = 'Low';
    if (library.name && library.context && defs.length >= 2) level = 'High';
    else if (defs.length >= 1) level = 'Moderate';
    if (unresolvedTotal > 0 && level === 'High') level = 'Moderate';

    const reason = 'Structural facts were detected directly (' + detected.join(', ') +
      '). Clinical meaning was inferred (' + inferred.join('; ') + ').' +
      (unresolvedTotal ? ' ' + unresolvedTotal + ' reference(s) could not be resolved locally.' : '');
    return { level: level, reason: reason };
  }

  // ---------------------------------------------------------------------------
  // Top-level analyze()
  // ---------------------------------------------------------------------------

  function analyze(rawCode) {
    const code = String(rawCode == null ? '' : rawCode).replace(/\r\n?/g, '\n');
    const scanCode = stripForScan(code);

    const library = extractLibrary(code);
    const includes = extractIncludes(code);
    const parameters = extractParameters(code);
    const terminology = extractTerminology(code);

    const rawDefs = extractDefinitions(code, scanCode);
    const symbolTable = new Set(rawDefs.map(d => d.name));

    const definitions = rawDefs.map(def => {
      const retrieves = extractRetrieves(def.scanExpression);
      const operators = extractOperators(def.scanExpression);
      const timing = extractTiming(def.scanExpression);
      const role = populationRole(def.name);
      const refInfo = analyzeReferences(def, symbolTable);
      const flags = def.kind === 'function' ? [] : buildReviewFlags(def, retrieves);
      const booleanTree = def.kind === 'function' ? null : parseBoolean(def.expression);

      return {
        name: def.name,
        kind: def.kind,
        sourceStartLine: def.startLine,
        sourceEndLine: def.endLine,
        expression: def.expression,
        inferredReturnType: inferReturnType(def),
        references: refInfo.references,
        unresolvedReferences: refInfo.unresolved,
        retrieves: retrieves,
        attributesRead: extractAttributes(def.scanExpression),
        operators: operators,
        timing: timing,
        temporalWindows: extractTemporalWindows(def),
        populationRole: role,
        booleanTree: booleanTree,
        booleanLines: booleanTree ? booleanToLines(booleanTree) : [],
        valueSets: retrieves.filter(r => r.valueSet).map(r => r.valueSet),
        explanation: explainDefinition(def, retrieves, timing, role),
        confidence: role || retrieves.length ? 'High' : 'Moderate',
        reviewFlags: flags,
      };
    });

    return assemble(definitions, {
      library: library, includes: includes, parameters: parameters,
      terminology: terminology, rawCode: code,
    }, {});
  }

  /**
   * Assemble a full analysis object from a finished `definitions` array plus
   * library metadata. Shared by the CQL path (analyze) and the ELM path
   * (elm.js) so both render identically. `opts` can override confidence,
   * summary text, and validation for the ELM path.
   */
  function assemble(definitions, meta, opts) {
    opts = opts || {};
    const library = meta.library;
    const terminology = meta.terminology || { valueSets: [] };
    const code = meta.rawCode || '';

    const dependencyGraph = {};
    const allUnresolved = [];
    const temporalFlows = [];
    let reviewFlags = [];

    definitions.forEach(def => {
      dependencyGraph[def.name] = def.references || [];
      (def.unresolvedReferences || []).forEach(u => {
        allUnresolved.push({ from: def.name, name: u, line: def.sourceStartLine });
      });
      (def.temporalWindows || []).forEach(w => temporalFlows.push(w));
      reviewFlags = reviewFlags.concat(def.reviewFlags || []);
    });

    allUnresolved.forEach(u => {
      reviewFlags.push({
        severity: 'Review', definition: u.from, line: u.line,
        message: 'Unresolved reference: "' + u.name + '"',
        why: 'This name is referenced but not defined in the pasted source. It may live in an included library, or the name may be mistyped.',
      });
    });

    const cycles = detectCycles(dependencyGraph);
    cycles.forEach(cycle => {
      reviewFlags.push({
        severity: 'High', definition: cycle[0],
        line: (definitions.find(d => d.name === cycle[0]) || {}).sourceStartLine || 0,
        message: 'Circular dependency: ' + cycle.join(' → '),
        why: 'These definitions reference each other in a loop, which cannot be evaluated.',
      });
    });

    const usesValueSets = definitions.some(d => (d.valueSets || []).length) || (terminology.valueSets || []).length;
    if (usesValueSets) {
      reviewFlags.push({
        severity: 'Info', definition: '(library)', line: 0,
        message: 'Value-set membership is asserted, not validated',
        why: 'This tool cannot confirm the codes inside each value set. Value-set correctness must be verified against your terminology service.',
      });
    }

    const rolesPresent = definitions.filter(d => d.populationRole);
    const orderedRoles = POPULATION_ORDER
      .map(r => rolesPresent.find(d => d.populationRole === r))
      .filter(Boolean)
      .map(d => ({ role: d.populationRole, definition: d.name, line: d.sourceStartLine }));
    const populationFlow = {
      steps: orderedRoles,
      narrative: buildPopulationNarrative(orderedRoles, code),
      inferred: true,
    };

    const confidence = opts.confidence || computeConfidence(library, definitions, allUnresolved.length);
    const summary = {
      text: opts.summaryText || buildSummaryText(library, definitions, code),
      confidence: confidence.level,
      confidenceReason: confidence.reason,
    };

    const validation = Object.assign({
      structure: definitions.length ? 'Passed' : 'No definitions found',
      syntax: 'Not evaluated',
      model: library.model ? library.model + ' ' + (library.modelVersion || '') : 'Not declared',
      missingReferences: allUnresolved.length,
      valueSetValidation: 'Not evaluated',
      elmTranslation: 'Not run',
      execution: 'Not run',
      specificationCompliance: 'Not evaluated',
    }, opts.validation || {});

    return {
      library: library,
      includes: meta.includes || [],
      parameters: meta.parameters || [],
      terminology: terminology,
      definitions: definitions,
      unresolvedReferences: allUnresolved,
      dependencyGraph: dependencyGraph,
      cycles: cycles,
      populationFlow: populationFlow,
      temporalFlows: temporalFlows,
      reviewFlags: reviewFlags,
      diagnostics: [],
      summary: summary,
      validation: validation,
      rawCode: code,
      sourceKind: opts.sourceKind || 'CQL',
    };
  }

  function buildSummaryText(library, defs, code) {
    const name = library.name || 'this unnamed library';
    const ctx = library.context ? ' evaluated in the ' + library.context + ' context' : '';
    let text = 'This CQL' + (library.name ? ' library "' + library.name + '"' : ' snippet') + ctx + '. ';
    text += themeSentence(code);
    if (defs.length) {
      text += ' It defines ' + defs.length + ' named concept' + (defs.length === 1 ? '' : 's') + '.';
    }
    return text;
  }

  function buildPopulationNarrative(orderedRoles, code) {
    if (!orderedRoles.length) return '';
    const names = orderedRoles.map(r => r.role);
    const sentences = [];
    if (names.includes('Initial Population')) {
      sentences.push('The measure starts from the Initial Population.');
    }
    if (names.includes('Denominator')) {
      sentences.push('Eligible patients form the Denominator.');
    }
    if (names.some(n => n.indexOf('Exclusion') !== -1)) {
      sentences.push('Excluded patients are then removed.');
    }
    if (names.includes('Numerator')) {
      sentences.push('Patients who meet the clinical goal fall into the Numerator (counted as compliant).');
    }
    return sentences.join(' ');
  }

  return {
    analyze: analyze,
    assemble: assemble,
    escapeHTML: escapeHTML,
    booleanToLines: booleanToLines,
    populationRole: populationRole,
    // Exposed for unit testing:
    _internals: {
      stripForScan: stripForScan,
      findDeclarations: findDeclarations,
      extractDefinitions: extractDefinitions,
      parseBoolean: parseBoolean,
      booleanToLines: booleanToLines,
      humanizeAtom: humanizeAtom,
      splitTop: splitTop,
      lineAt: lineAt,
      detectCycles: detectCycles,
      populationRole: populationRole,
      themeSentence: themeSentence,
    },
  };
});
