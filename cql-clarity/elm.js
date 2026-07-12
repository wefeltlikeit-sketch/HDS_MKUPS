/*
 * CQL Clarity — ELM ingestion adapter
 * -------------------------------------------------
 * ELM (Expression Logical Model) is the compiled JSON form of CQL. Because it
 * is already resolved and typed, walking the ELM tree yields EXACT references,
 * retrieves, data types, and source locators — no heuristics.
 *
 * analyzeELM() produces the same structured object shape as CQLAnalyzer.analyze
 * (via CQLAnalyzer.assemble), so the UI and spec generator render it unchanged.
 *
 * Browser: window.CQLElm.  Node: module.exports (analyzer injected).
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./analyzer.js'));
  } else {
    root.CQLElm = factory(root.CQLAnalyzer);
  }
})(typeof self !== 'undefined' ? self : this, function (CQLAnalyzer) {
  'use strict';

  const booleanToLines = CQLAnalyzer.booleanToLines;
  const populationRole = CQLAnalyzer.populationRole;

  /** True when a parsed object looks like an ELM library. */
  function looksLikeELM(obj) {
    if (!obj || typeof obj !== 'object') return false;
    const lib = obj.library || obj;
    return !!(lib && (lib.statements || lib.identifier || lib.schemaIdentifier));
  }

  // --------------------------------------------------------------- traversal
  /** Depth-first visit of every object with a `type`, calling fn(node). */
  function walk(node, fn) {
    if (Array.isArray(node)) { node.forEach(n => walk(n, fn)); return; }
    if (!node || typeof node !== 'object') return;
    if (typeof node.type === 'string') fn(node);
    for (const k in node) {
      if (k === 'annotation') continue; // narrative, not logic
      if (Object.prototype.hasOwnProperty.call(node, k)) walk(node[k], fn);
    }
  }

  function localType(dataType) {
    if (!dataType) return '';
    // "{http://hl7.org/fhir}Condition" -> "Condition"
    const m = String(dataType).match(/\}?([A-Za-z]+)$/);
    return m ? m[1] : String(dataType);
  }

  function valueSetOf(retrieveNode) {
    // codes may be a ValueSetRef directly, or wrapped in ToList/ToCode etc.
    let vs = '';
    walk(retrieveNode.codes, n => { if (!vs && n.type === 'ValueSetRef' && n.name) vs = n.name; });
    return vs;
  }

  // --------------------------------------------------------------- describe
  const OP_SYMBOL = {
    Equal: '=', Equivalent: '~', NotEqual: '!=', Greater: '>', Less: '<',
    GreaterOrEqual: '>=', LessOrEqual: '<=',
  };
  const TIMING_TYPE = {
    IncludedIn: 'during', In: 'during', Includes: 'includes', Overlaps: 'overlaps',
    Before: 'before', After: 'after', Starts: 'starts', Ends: 'ends',
    Meets: 'meets', SameAs: 'same as', ProperIncludes: 'properly includes',
    ProperlyIncludedIn: 'properly during', SameOrAfter: 'on or after',
    SameOrBefore: 'on or before',
  };

  function describe(node) {
    if (!node || typeof node !== 'object') return String(node == null ? '' : node);
    switch (node.type) {
      case 'ExpressionRef':
        return node.libraryName ? node.name + ' (from ' + node.libraryName + ')' : node.name;
      case 'ParameterRef':
        return node.name === 'MeasurementPeriod' ? 'the measurement period' : node.name;
      case 'ValueSetRef':
        return '"' + node.name + '"';
      case 'Literal':
        return node.value != null ? String(node.value) : (node.valueType || '').replace(/.*\}/, '');
      case 'Property':
        return humanizeProperty(node.path);
      case 'Exists':
        return 'At least one ' + describeSource(node.operand) + ' exists';
      case 'Retrieve':
        return describeRetrieve(node);
      case 'Query':
        return describeQuery(node);
      case 'Not':
        return 'NOT (' + describe(node.operand) + ')';
      case 'CalculateAgeAt':
      case 'CalculateAge':
        return 'patient age';
      case 'FunctionRef':
        return node.name + '()';
      case 'Start':
        return 'start of ' + describe(node.operand);
      case 'End':
        return 'end of ' + describe(node.operand);
      case 'Add':
      case 'Subtract': {
        const ops = node.operand || [];
        const base = describe(ops[0]);
        const q = ops[1];
        if (q && q.type === 'Quantity') {
          return base + (node.type === 'Add' ? ' plus ' : ' minus ') + q.value + ' ' + q.unit + (String(q.value) === '1' ? '' : 's');
        }
        return base;
      }
      case 'Interval':
        return describeInterval(node);
      case 'And': case 'Or':
        return '(' + flattenLogical(node, node.type).map(describe).join(node.type === 'And' ? ' and ' : ' or ') + ')';
      default:
        return describeSpecial(node);
    }
  }

  function describeSpecial(node) {
    // Comparisons
    if (OP_SYMBOL[node.type] && Array.isArray(node.operand) && node.operand.length === 2) {
      const l = node.operand[0], r = node.operand[1];
      // Gender shortcut
      if (l.type === 'Property' && /gender/i.test(l.path || '') && r.type === 'Literal') {
        return 'Patient is ' + String(r.value).toLowerCase();
      }
      return describe(l) + ' ' + OP_SYMBOL[node.type] + ' ' + describe(r);
    }
    // Age range: In(CalculateAgeAt, Interval[a,b])
    if ((node.type === 'In' || node.type === 'IncludedIn') && Array.isArray(node.operand)) {
      const l = node.operand[0], r = node.operand[1];
      if (l && (l.type === 'CalculateAgeAt' || l.type === 'CalculateAge') && r && r.type === 'Interval') {
        const lo = literalNum(r.low), hi = literalNum(r.high);
        if (lo != null && hi != null) return 'Patient age is between ' + lo + ' and ' + hi;
      }
      return describe(l) + ' during ' + describe(r);
    }
    // Generic timing binary
    if (TIMING_TYPE[node.type] && Array.isArray(node.operand) && node.operand.length === 2) {
      return describe(node.operand[0]) + ' ' + TIMING_TYPE[node.type] + ' ' + describe(node.operand[1]);
    }
    return '(' + humanizeType(node.type) + ')';
  }

  function literalNum(node) {
    if (node && node.type === 'Literal' && node.value != null) {
      const n = Number(node.value);
      return isNaN(n) ? node.value : n;
    }
    return null;
  }

  function humanizeProperty(path) {
    const map = {
      gender: 'gender', onset: 'onset', abatement: 'resolution',
      clinicalStatus: 'clinical status', effective: 'effective date',
      authoredOn: 'authored date', performed: 'performed date', value: 'value',
    };
    return map[path] || path || 'value';
  }
  function humanizeType(t) {
    return String(t || 'expression').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase() + ' expression';
  }

  function describeRetrieve(node) {
    const rt = localType(node.dataType);
    const vs = valueSetOf(node);
    return (vs ? '"' + vs + '" ' : '') + rt + ' records';
  }
  function describeSource(node) {
    if (!node) return 'record';
    if (node.type === 'Retrieve') return describeRetrieve(node);
    if (node.type === 'Exists') return describeSource(node.operand);
    if (node.type === 'Query') {
      const src = querySource(node);
      return src ? describeRetrieve(src) : 'record';
    }
    return describe(node);
  }
  function querySource(q) {
    let retrieve = null;
    const sources = q.source || [];
    (Array.isArray(sources) ? sources : [sources]).forEach(s => {
      if (s && s.expression && s.expression.type === 'Retrieve') retrieve = s.expression;
      else if (s && s.expression) walk(s.expression, n => { if (!retrieve && n.type === 'Retrieve') retrieve = n; });
    });
    return retrieve;
  }
  function describeQuery(q) {
    const src = querySource(q);
    let text = src ? describeRetrieve(src) : 'records';
    if (q.where) {
      const t = timingPhraseIn(q.where);
      if (t) text += ' (' + t + ')';
    }
    return text;
  }
  function timingPhraseIn(node) {
    let phrase = '';
    walk(node, n => { if (!phrase && TIMING_TYPE[n.type]) phrase = TIMING_TYPE[n.type]; });
    return phrase;
  }
  function describeInterval(node) {
    return '[' + describe(node.low) + ', ' + describe(node.high) + ']';
  }

  // --------------------------------------------------------------- boolean tree
  function flattenLogical(node, type) {
    const out = [];
    (node.operand || []).forEach(op => {
      if (op && op.type === type) out.push.apply(out, flattenLogical(op, type));
      else out.push(op);
    });
    return out;
  }
  function buildBoolTree(node) {
    if (!node) return { type: 'atom', text: '' };
    if (node.type === 'And') return { type: 'and', children: flattenLogical(node, 'And').map(buildBoolTree) };
    if (node.type === 'Or') return { type: 'or', children: flattenLogical(node, 'Or').map(buildBoolTree) };
    if (node.type === 'Not') {
      if (node.operand && node.operand.type === 'Exists') {
        return { type: 'none', child: { type: 'atom', text: describeSource(node.operand.operand) } };
      }
      return { type: 'not', child: buildBoolTree(node.operand) };
    }
    return { type: 'atom', text: describe(node) };
  }

  // --------------------------------------------------------------- annotations
  /** Reconstruct source text from an ELM annotation narrative node. */
  function narrativeText(node) {
    if (!node) return '';
    if (Array.isArray(node)) return node.map(narrativeText).join('');
    if (typeof node === 'string') return node;
    let out = '';
    if (node.value) out += (Array.isArray(node.value) ? node.value.join('') : node.value);
    if (node.s) out += narrativeText(node.s);
    return out;
  }
  function statementSource(def) {
    const ann = def.annotation || [];
    for (const a of ann) {
      if (a && a.s) return narrativeText(a.s).replace(/\s+$/, '');
    }
    return '';
  }
  function bodyFromStatement(text) {
    // Drop the "define "Name":" header to leave the expression body.
    const idx = text.indexOf(':');
    return idx !== -1 ? text.slice(idx + 1).replace(/^\s+/, '') : text;
  }

  // --------------------------------------------------------------- metadata
  function parseLocatorLines(locator) {
    // "6:3-7:38" -> { start: 6, end: 7 }
    const m = String(locator || '').match(/^(\d+):\d+-(\d+):\d+$/);
    return m ? { start: parseInt(m[1], 10), end: parseInt(m[2], 10) } : null;
  }

  function extractMeta(lib) {
    const id = lib.identifier || {};
    const library = { name: id.id || '', version: id.version || '', model: '', modelVersion: '', context: '' };
    const usings = (lib.usings && lib.usings.def) || [];
    usings.forEach(u => {
      if (u.localIdentifier && u.localIdentifier !== 'System') {
        library.model = u.localIdentifier;
        library.modelVersion = u.version || '';
      }
    });
    const contexts = (lib.contexts && lib.contexts.def) || [];
    if (contexts.length) library.context = contexts[0].name || '';

    const includes = ((lib.includes && lib.includes.def) || []).map(i => ({
      name: i.path || i.localIdentifier || '', version: i.version || '', alias: i.localIdentifier || '',
    }));
    const parameters = ((lib.parameters && lib.parameters.def) || []).map(p => ({ name: p.name || '', definition: '' }));
    const grab = (arr) => (arr || []).map(x => ({ name: x.name || '', id: x.id || '' }));
    const terminology = {
      valueSets: grab(lib.valueSets && lib.valueSets.def),
      codeSystems: grab(lib.codeSystems && lib.codeSystems.def),
      codes: grab(lib.codes && lib.codes.def),
      concepts: grab(lib.concepts && lib.concepts.def),
    };
    if (!library.context && contexts.length === 0) {
      // fall back to a statement context
      const stmts = (lib.statements && lib.statements.def) || [];
      const withCtx = stmts.find(s => s.context);
      if (withCtx) library.context = withCtx.context;
    }
    return { library: library, includes: includes, parameters: parameters, terminology: terminology };
  }

  // --------------------------------------------------------------- review flags
  function elmReviewFlags(def, retrieves, nodeTypes, attributesRead, line) {
    const flags = [];
    retrieves.forEach(r => {
      if (r.resourceType === 'MedicationRequest') {
        flags.push({ severity: 'Info', definition: def.name, line: line,
          message: 'MedicationRequest represents an order, not a dispense',
          why: 'A MedicationRequest means the medication was ordered/prescribed. It does not confirm the patient filled or took it.' });
      }
      if (r.resourceType === 'Condition' && attributesRead.indexOf('clinicalStatus') === -1) {
        flags.push({ severity: 'Info', definition: def.name, line: line,
          message: 'Condition retrieve does not check clinicalStatus',
          why: 'Without a clinicalStatus filter, resolved or entered-in-error conditions may be counted.' });
      }
    });
    if (nodeTypes.has('Exists')) {
      flags.push({ severity: 'Info', definition: def.name, line: line,
        message: 'exists hides how many events matched',
        why: '`exists` only reports true/false. If the count matters, a count check may be more appropriate.' });
    }
    if (nodeTypes.has('Last') || nodeTypes.has('First')) {
      // In ELM a sorted query has a `sort` property somewhere; approximate.
      flags.push({ severity: 'Review', definition: def.name, line: line,
        message: (nodeTypes.has('Last') ? 'Last()' : 'First()') + ' selects one element',
        why: 'Confirm the source is explicitly sorted; otherwise the selected element may be nondeterministic across engines.' });
    }
    return flags;
  }

  // --------------------------------------------------------------- main
  function analyzeELM(input) {
    let obj = input;
    if (typeof input === 'string') obj = JSON.parse(input);
    const lib = obj.library || obj;
    const meta = extractMeta(lib);
    const statements = (lib.statements && lib.statements.def) || [];

    // Reconstruct a readable CQL-like source view with matching line numbers.
    const headerLines = [];
    if (meta.library.name) headerLines.push('library ' + meta.library.name + (meta.library.version ? " version '" + meta.library.version + "'" : ''));
    if (meta.library.model) headerLines.push('using ' + meta.library.model + (meta.library.modelVersion ? " version '" + meta.library.modelVersion + "'" : ''));
    meta.includes.forEach(i => headerLines.push('include ' + i.name + (i.version ? " version '" + i.version + "'" : '') + (i.alias ? ' called ' + i.alias : '')));
    meta.parameters.forEach(p => headerLines.push('parameter ' + p.name));
    if (meta.library.context) headerLines.push('context ' + meta.library.context);
    const srcLines = headerLines.slice();
    if (srcLines.length) srcLines.push('');

    const symbolNames = new Set(statements.map(s => s.name));
    const definitions = [];

    statements.forEach(stmt => {
      // Skip the compiler-generated context statement (e.g. Patient = singleton).
      if (stmt.name === meta.library.context && stmt.expression &&
          (stmt.expression.type === 'SingletonFrom' || stmt.expression.type === 'Retrieve')) {
        return;
      }
      const isFunction = stmt.type === 'FunctionDef' || Array.isArray(stmt.operand);
      const expr = stmt.expression;

      // Collect structured facts from the expression tree.
      const nodeTypes = new Set();
      const refs = [];
      const retrieves = [];
      const properties = [];
      const timingTypes = new Set();
      const offsets = [];
      const temporalWindows = [];
      walk(expr, n => {
        nodeTypes.add(n.type);
        if (n.type === 'ExpressionRef' && n.name && n.name !== stmt.name && !n.libraryName) {
          if (refs.indexOf(n.name) === -1) refs.push(n.name);
        }
        if (n.type === 'Retrieve') retrieves.push({ resourceType: localType(n.dataType), valueSet: valueSetOf(n) });
        if (n.type === 'Property' && n.path && properties.indexOf(n.path) === -1) properties.push(n.path);
        if (TIMING_TYPE[n.type]) timingTypes.add(TIMING_TYPE[n.type]);
        if (n.type === 'Quantity' && /year|month|week|day|hour|minute/i.test(n.unit || '')) {
          offsets.push(n.value + ' ' + n.unit);
        }
        // Temporal window: In/IncludedIn with an Interval on the right operand.
        if ((n.type === 'In' || n.type === 'IncludedIn') && Array.isArray(n.operand) && n.operand[1] && n.operand[1].type === 'Interval') {
          const iv = n.operand[1];
          temporalWindows.push({
            definition: stmt.name,
            windowBegins: describe(iv.low),
            windowEnds: describe(iv.high),
            requirement: 'Event must occur within the interval',
            boundaryType: 'Interval brackets determine inclusivity',
            line: 0,
          });
        }
      });

      const resolvedRefs = refs.filter(r => symbolNames.has(r));
      const unresolved = refs.filter(r => !symbolNames.has(r));

      // Source text & line range.
      const srcText = statementSource(stmt);
      const loc = parseLocatorLines(stmt.locator);
      let startLine, endLine, exprText;
      if (srcText) {
        startLine = srcLines.length + 1;
        srcText.split('\n').forEach(l => srcLines.push(l));
        endLine = srcLines.length;
        srcLines.push('');
        exprText = bodyFromStatement(srcText);
      } else {
        startLine = srcLines.length + 1;
        srcLines.push('define "' + stmt.name + '": (compiled — no source annotation)');
        endLine = srcLines.length;
        srcLines.push('');
        exprText = '(see ELM structure)';
      }
      if (loc) { /* keep displayed range from reconstructed text for click-to-highlight consistency */ }

      const role = isFunction ? '' : populationRole(stmt.name);
      const tree = isFunction ? null : buildBoolTree(expr);
      const returnType = elmReturnType(stmt) || (isFunction ? 'Function' : structuralReturn(nodeTypes));
      temporalWindows.forEach(w => { w.line = startLine; });

      definitions.push({
        name: stmt.name,
        kind: isFunction ? 'function' : 'define',
        sourceStartLine: startLine,
        sourceEndLine: endLine,
        expression: exprText,
        inferredReturnType: returnType,
        references: resolvedRefs,
        unresolvedReferences: unresolved,
        retrieves: retrieves,
        attributesRead: properties,
        operators: Array.from(nodeTypes).filter(t => /^(And|Or|Not|Exists|Query|Retrieve|In|IncludedIn|Overlaps|Before|After)$/.test(t)),
        timing: { phrases: Array.from(timingTypes), offsets: offsets },
        temporalWindows: temporalWindows,
        populationRole: role,
        booleanTree: tree,
        booleanLines: tree ? booleanToLines(tree) : [],
        valueSets: retrieves.filter(r => r.valueSet).map(r => r.valueSet),
        explanation: explainELM(stmt.name, role, retrieves, timingTypes),
        confidence: 'High',
        reviewFlags: isFunction ? [] : elmReviewFlags({ name: stmt.name }, retrieves, nodeTypes, properties, startLine),
      });
    });

    const rawCode = srcLines.join('\n');
    const summaryText = 'This measure "' + (meta.library.name || 'library') + '"' +
      (meta.library.context ? ' (context ' + meta.library.context + ')' : '') +
      ' was read from compiled ELM. ' + CQLAnalyzer._internals.themeSentence(rawCode + ' ' +
        definitions.map(d => d.name + ' ' + d.valueSets.join(' ')).join(' ')) +
      ' It defines ' + definitions.length + ' named concept' + (definitions.length === 1 ? '' : 's') + '.';

    return CQLAnalyzer.assemble(definitions, {
      library: meta.library, includes: meta.includes, parameters: meta.parameters,
      terminology: meta.terminology, rawCode: rawCode,
    }, {
      sourceKind: 'ELM',
      summaryText: summaryText,
      confidence: {
        level: 'High',
        reason: 'Parsed from compiled ELM — declarations, references, retrieves, and data types are exact (not heuristic). Clinical intent and population roles are still inferred from names.',
      },
      validation: {
        syntax: 'Compiled (ELM provided)',
        elmTranslation: 'Provided',
        structure: 'Passed (from ELM)',
      },
    });
  }

  function elmReturnType(stmt) {
    const rt = stmt.resultTypeName || (stmt.expression && stmt.expression.resultTypeName);
    if (typeof rt === 'string') return localType(rt);
    return '';
  }
  function structuralReturn(nodeTypes) {
    if (nodeTypes.has('And') || nodeTypes.has('Or') || nodeTypes.has('Not') || nodeTypes.has('Exists') ||
        nodeTypes.has('Equal') || nodeTypes.has('Greater') || nodeTypes.has('Less')) return 'Boolean';
    if (nodeTypes.has('Retrieve') || nodeTypes.has('Query')) return 'List';
    return 'Value or expression';
  }
  function explainELM(name, role, retrieves, timingTypes) {
    const parts = [];
    const roleText = {
      'Initial Population': 'the broadest group of patients the measure applies to',
      'Denominator': 'the patients eligible to be measured',
      'Numerator': 'the patients who met the clinical goal (counted as compliant)',
      'Denominator Exclusion': 'patients removed from the denominator before scoring',
    }[role];
    if (roleText) parts.push('This is the ' + role + ' — ' + roleText + '.');
    retrieves.forEach(r => parts.push('Looks at ' + r.resourceType + ' records' + (r.valueSet ? ' matching "' + r.valueSet + '"' : '') + '.'));
    if (timingTypes.size) parts.push('Applies a timing rule (' + Array.from(timingTypes).join(', ') + ').');
    if (!parts.length) parts.push('Defines a reusable clinical concept used elsewhere in the library.');
    return parts.join(' ');
  }

  return {
    analyzeELM: analyzeELM,
    looksLikeELM: looksLikeELM,
    _internals: { walk: walk, describe: describe, buildBoolTree: buildBoolTree, narrativeText: narrativeText, extractMeta: extractMeta },
  };
});
