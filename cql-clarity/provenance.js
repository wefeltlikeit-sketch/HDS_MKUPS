/*
 * CQL Clarity — Provenance & Coverage
 * -------------------------------------------------
 * Answers "prove every line": for a given analysis it emits
 *   - claims[]  : every plain-English assertion the tool makes, each tagged
 *                 Detected / Inferred / Not determined and anchored to a
 *                 source line (so a reviewer can audit it)
 *   - coverage  : what fraction of the source lines were actually accounted
 *                 for (in a definition, a recognized header, or a comment),
 *                 plus an explicit list of any lines that were NOT.
 *
 * Pure and DOM-free. Browser: window.CQLProvenance. Node: module.exports.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CQLProvenance = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const HEADER_RE = /^\s*(library|using|include|parameter|context|valueset|codesystem|code|concept|define|function|private)\b/i;
  const COMMENT_RE = /^\s*(\/\/|\/\*|\*)/;

  /** First line in [start,end] whose text contains token (else start). */
  function findLine(lines, start, end, token) {
    if (!token) return start;
    const needle = String(token).toLowerCase();
    const lo = Math.max(1, start);
    const hi = Math.min(lines.length, end || start);
    for (let i = lo; i <= hi; i++) {
      if ((lines[i - 1] || '').toLowerCase().indexOf(needle) !== -1) return i;
    }
    return start;
  }

  function buildProvenance(a) {
    const lines = (a.rawCode || '').split('\n');
    const isElm = a.sourceKind === 'ELM';
    const claims = [];

    (a.definitions || []).forEach(def => {
      const at = (token) => findLine(lines, def.sourceStartLine, def.sourceEndLine, token);

      claims.push({
        definition: def.name, line: def.sourceStartLine,
        category: isElm ? 'Detected' : 'Inferred',
        text: 'Returns ' + def.inferredReturnType,
        evidence: isElm ? 'ELM result type' : 'inferred from expression shape',
      });

      if (def.populationRole) {
        claims.push({
          definition: def.name, line: def.sourceStartLine, category: 'Inferred',
          text: 'Plays the role: ' + def.populationRole,
          evidence: 'inferred from the definition name',
        });
      }

      (def.retrieves || []).forEach(r => {
        claims.push({
          definition: def.name, line: at(r.valueSet || r.resourceType), category: 'Detected',
          text: 'Reads ' + r.resourceType + ' records' + (r.valueSet ? ' matching "' + r.valueSet + '"' : ''),
          evidence: r.valueSet ? '"' + r.valueSet + '"' : r.resourceType,
        });
      });

      (def.attributesRead || []).forEach(attr => {
        claims.push({
          definition: def.name, line: at('.' + attr), category: 'Detected',
          text: 'Uses the ' + attr + ' field', evidence: '.' + attr,
        });
      });

      ((def.timing && def.timing.phrases) || []).forEach(ph => {
        claims.push({
          definition: def.name, line: at(ph), category: 'Detected',
          text: 'Applies timing: ' + ph, evidence: ph,
        });
      });
      ((def.timing && def.timing.offsets) || []).forEach(off => {
        claims.push({
          definition: def.name, line: def.sourceStartLine, category: 'Detected',
          text: 'Time offset: ' + off, evidence: off,
        });
      });

      (def.references || []).forEach(ref => {
        claims.push({
          definition: def.name, line: at('"' + ref + '"'), category: 'Detected',
          text: 'Depends on "' + ref + '"', evidence: '"' + ref + '"',
        });
      });
      (def.unresolvedReferences || []).forEach(ref => {
        claims.push({
          definition: def.name, line: at('"' + ref + '"'), category: 'Detected',
          text: 'References undefined "' + ref + '"', evidence: '"' + ref + '"',
        });
      });

      if (def.booleanTree && def.booleanLines && def.booleanLines.length) {
        const t = def.booleanTree.type;
        const label = t === 'and' ? 'ALL conditions must be true'
          : t === 'or' ? 'AT LEAST ONE condition must be true'
          : t === 'none' ? 'an absence (NONE) check'
          : t === 'not' ? 'a negation' : 'a single condition';
        claims.push({
          definition: def.name, line: def.sourceStartLine, category: 'Detected',
          text: 'Overall logic: ' + label, evidence: 'expression structure',
        });
      }
    });

    // ---- line coverage --------------------------------------------------
    const inAnyDef = (ln) => (a.definitions || []).some(d => ln >= d.sourceStartLine && ln <= d.sourceEndLine);
    let nonBlank = 0, attributed = 0, definitionLines = 0, headerLines = 0, commentLines = 0;
    const unaccounted = [];
    lines.forEach((text, idx) => {
      const ln = idx + 1;
      if (!text.trim()) return;
      nonBlank++;
      if (inAnyDef(ln)) { attributed++; definitionLines++; }
      else if (COMMENT_RE.test(text)) { attributed++; commentLines++; }
      else if (HEADER_RE.test(text)) { attributed++; headerLines++; }
      else unaccounted.push({ line: ln, text: text.trim().slice(0, 120) });
    });
    const percent = nonBlank ? Math.round((attributed / nonBlank) * 100) : 100;

    const detected = claims.filter(c => c.category === 'Detected').length;
    const inferred = claims.filter(c => c.category === 'Inferred').length;

    return {
      claims: claims,
      counts: { total: claims.length, detected: detected, inferred: inferred, sourced: claims.length },
      coverage: {
        totalLines: lines.length, nonBlank: nonBlank, attributed: attributed,
        definitionLines: definitionLines, headerLines: headerLines, commentLines: commentLines,
        unaccounted: unaccounted, percent: percent,
      },
    };
  }

  return { buildProvenance: buildProvenance, _internals: { findLine: findLine } };
});
