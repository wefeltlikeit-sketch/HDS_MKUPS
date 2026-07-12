/*
 * CQL Clarity — UI layer.
 * All rendering escapes untrusted values via esc(). The analysis itself lives
 * in analyzer.js (CQLAnalyzer). This file only turns the structured result
 * into safe DOM/markup and handles navigation, storage and export.
 */
(function () {
  'use strict';
  const esc = CQLAnalyzer.escapeHTML;
  const $ = (id) => document.getElementById(id);

  let lastAnalysis = null;
  let lastCode = '';

  // ---------------------------------------------------------------- navigation
  function navigateTo(section) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    const t = $('section-' + section);
    if (t) t.classList.add('active');
    document.querySelectorAll('[id^="nav-"]').forEach(el => el.classList.remove('nav-active'));
    const nav = $('nav-' + section);
    if (nav) nav.classList.add('nav-active');
    if (section === 'examples') renderExamples();
    if (section === 'learn') renderLessons();
    if (section === 'reference') { renderGlossary(); renderPatterns(); }
    if (section === 'library') renderLibrary();
  }
  window.navigateTo = navigateTo;

  // ------------------------------------------------------------------ storage
  const LIB_KEY = 'cqlclarity_library';
  const STAT_KEY = 'cqlclarity_stats';
  const loadJSON = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
  const saveJSON = (k, v) => localStorage.setItem(k, JSON.stringify(v));

  function bumpStat(key) {
    const s = loadJSON(STAT_KEY, {});
    s[key] = (s[key] || 0) + 1;
    saveJSON(STAT_KEY, s);
    renderActivity();
  }
  function renderActivity() {
    const s = loadJSON(STAT_KEY, {});
    const lib = loadJSON(LIB_KEY, []);
    const rows = [
      ['Translations run', s.translations || 0],
      ['Saved analyses', lib.length],
      ['Lessons completed', (loadJSON('cqlclarity_lessons', {}).completed || []).length],
    ];
    $('activity-stats').innerHTML = rows.map(r =>
      `<div class="flex justify-between"><span>${esc(r[0])}</span><span class="font-mono text-slate-300">${esc(r[1])}</span></div>`
    ).join('');
  }

  // ------------------------------------------------------------------ toast
  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-800 border border-slate-600 text-sm px-5 py-2.5 rounded-3xl shadow-xl z-[100]';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity .2s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 200); }, 2000);
  }

  // ============================================================== TRANSLATE
  function analyzeInput(code) {
    const t = code.trim();
    if (t[0] === '{' || t[0] === '[') {
      try {
        const obj = JSON.parse(t);
        if (window.CQLElm && CQLElm.looksLikeELM(obj)) return CQLElm.analyzeELM(obj);
      } catch (e) { /* not valid JSON — treat as CQL */ }
    }
    return CQLAnalyzer.analyze(code);
  }

  function translateCQL() {
    const code = $('cql-input').value;
    if (!code.trim()) { toast('Paste some CQL or ELM first.'); return; }
    lastCode = code;
    lastAnalysis = analyzeInput(code);
    bumpStat('translations');
    $('results').classList.remove('hidden');
    renderSourceView(lastAnalysis.rawCode);
    renderConfidence(lastAnalysis);
    renderSummaryTab(lastAnalysis);
    renderSpecTab(lastAnalysis);
    renderDefinitionsTab(lastAnalysis);
    renderDependenciesTab(lastAnalysis);
    renderPopulationTab(lastAnalysis);
    renderTimingTab(lastAnalysis);
    renderFlagsTab(lastAnalysis);
    renderValidationTab(lastAnalysis);
    showTab('summary');
    $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  window.translateCQL = translateCQL;

  function renderSourceView(code) {
    const lines = code.split('\n');
    $('source-view').innerHTML = lines.map((ln, i) =>
      `<div class="src-line" data-line="${i + 1}"><span class="src-num">${i + 1}</span><span class="src-text">${esc(ln) || ' '}</span></div>`
    ).join('');
  }
  function highlightLine(n) {
    if (!n) return;
    const el = document.querySelector(`.src-line[data-line="${n}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('flash');
    void el.offsetWidth; // reflow to restart animation
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1300);
  }
  window.highlightLine = highlightLine;

  // ------------------------------------------------------------- tabs
  function showTab(name) {
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
    $('tab-' + name).classList.remove('hidden');
    document.querySelectorAll('.tab-btn').forEach(b => {
      const on = b.dataset.tab === name;
      b.classList.toggle('tab-active', on);
      b.classList.toggle('text-slate-400', !on);
    });
  }
  window.showTab = showTab;

  // ------------------------------------------------------------- confidence
  const CONF_COLOR = { High: 'emerald', Moderate: 'amber', Low: 'rose' };
  function renderConfidence(a) {
    const c = CONF_COLOR[a.summary.confidence] || 'slate';
    const isElm = a.sourceKind === 'ELM';
    const srcColor = isElm ? 'violet' : 'sky';
    $('confidence-bar').innerHTML =
      `<div class="p-3 rounded-2xl bg-slate-900 border border-slate-700 flex items-start gap-x-3 flex-wrap">
        <span class="text-xs font-semibold px-2.5 py-1 rounded-full bg-${srcColor}-900/40 text-${srcColor}-300 whitespace-nowrap" title="${isElm ? 'Parsed from compiled ELM — exact structure' : 'Parsed from CQL text — structural heuristics'}">Input: ${esc(a.sourceKind || 'CQL')}</span>
        <span class="text-xs font-semibold px-2.5 py-1 rounded-full bg-${c}-900/40 text-${c}-300 whitespace-nowrap">Confidence: ${esc(a.summary.confidence)}</span>
        <span class="text-xs text-slate-400 leading-snug flex-1 min-w-[200px]">${esc(a.summary.confidenceReason)}</span>
      </div>`;
    $('flag-count').textContent = a.reviewFlags.length;
  }

  // ------------------------------------------------------------- summary tab
  function evidenceLegend() {
    return `<div class="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4 text-xs">
      <div class="p-2.5 rounded-2xl bg-emerald-900/20 border border-emerald-800/40"><div class="font-semibold text-emerald-300">Detected directly</div><div class="text-slate-400">Structure read from the text.</div></div>
      <div class="p-2.5 rounded-2xl bg-amber-900/20 border border-amber-800/40"><div class="font-semibold text-amber-300">Inferred</div><div class="text-slate-400">Guessed from names & patterns.</div></div>
      <div class="p-2.5 rounded-2xl bg-slate-800/60 border border-slate-700"><div class="font-semibold text-slate-300">Not determined</div><div class="text-slate-400">Needs a real compiler.</div></div>
    </div>`;
  }
  function kv(label, value) {
    if (!value) return '';
    return `<div class="flex gap-x-2 text-sm"><span class="text-slate-500 w-32 flex-shrink-0">${esc(label)}</span><span class="text-slate-200">${esc(value)}</span></div>`;
  }
  function renderSummaryTab(a) {
    let html = evidenceLegend();
    html += `<div class="p-4 bg-slate-950 rounded-2xl border border-slate-700 mb-4">
      <div class="uppercase text-teal-400 text-[11px] tracking-widest mb-1">Clinical intent <span class="text-amber-400 normal-case tracking-normal">· inferred</span></div>
      <div class="text-sm leading-relaxed">${esc(a.summary.text)}</div></div>`;

    html += `<div class="p-4 bg-slate-900 rounded-2xl border border-slate-700 space-y-1">
      <div class="uppercase text-emerald-400 text-[11px] tracking-widest mb-2">Detected directly</div>`;
    html += kv('Library', a.library.name + (a.library.version ? ' v' + a.library.version : ''));
    html += kv('Data model', a.validation.model);
    html += kv('Context', a.library.context);
    if (a.includes.length) html += kv('Includes', a.includes.map(i => i.name + (i.alias ? ' (' + i.alias + ')' : '')).join(', '));
    if (a.parameters.length) html += kv('Parameters', a.parameters.map(p => p.name).join(', '));
    if (a.terminology.valueSets.length) html += kv('Value sets', a.terminology.valueSets.map(v => v.name).join(', '));
    html += kv('Definitions', a.definitions.length);
    html += `</div>`;
    $('tab-summary').innerHTML = html;
  }

  // ------------------------------------------------------------- spec docs
  let specMode = 'business';
  function renderSpecTab(a) {
    const spec = CQLSpec.buildSpec(a, specMode);
    const btn = (mode, label) =>
      `<button onclick="setSpecMode('${mode}')" class="text-xs px-3 py-1.5 rounded-2xl ${specMode === mode ? 'bg-teal-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}">${label}</button>`;
    $('tab-specdocs').innerHTML =
      `<div class="mb-3">
        <div class="text-xs text-slate-400 mb-2">Generate an audience-tuned spec from this analysis. Switch modes, then copy, download, or open a printable version.</div>
        <div class="flex flex-wrap items-center gap-2">
          <div class="flex gap-1 p-1 bg-slate-900 border border-slate-700 rounded-2xl">
            ${btn('business', 'Business spec')}${btn('engineer', 'Engineering brief')}
          </div>
          <div class="flex-1"></div>
          <button onclick="copySpecMarkdown()" class="text-xs px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-2xl">Copy Markdown</button>
          <button onclick="downloadSpecMd()" class="text-xs px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-2xl">Download .md</button>
          <button onclick="openSpecPrint()" class="text-xs px-3 py-1.5 bg-teal-600 hover:bg-teal-500 text-white rounded-2xl">Open printable / PDF</button>
        </div>
      </div>
      <div class="spec-paper rounded-2xl p-6 max-h-[70vh] overflow-auto">
        <h1 style="font-size:1.4rem;font-weight:700;margin-bottom:.15rem">${esc(spec.title)}</h1>
        <div style="color:#666;margin-bottom:1rem">${esc(spec.subtitle)}</div>
        ${CQLSpec.specToHTML(spec)}
      </div>`;
  }
  window.setSpecMode = (m) => { specMode = m; if (lastAnalysis) renderSpecTab(lastAnalysis); };
  window.copySpecMarkdown = () => {
    if (!lastAnalysis) return;
    const md = CQLSpec.specToMarkdown(CQLSpec.buildSpec(lastAnalysis, specMode));
    navigator.clipboard.writeText(md).then(() => toast('Spec Markdown copied')).catch(() => toast('Copy failed'));
  };
  window.downloadSpecMd = () => {
    if (!lastAnalysis) return;
    const spec = CQLSpec.buildSpec(lastAnalysis, specMode);
    const base = (lastAnalysis.library.name || 'cql') + '-' + specMode + '-spec';
    download(base + '.md', CQLSpec.specToMarkdown(spec), 'text/markdown');
  };
  window.openSpecPrint = () => {
    if (!lastAnalysis) return;
    const doc = CQLSpec.toStandaloneHTML(CQLSpec.buildSpec(lastAnalysis, specMode));
    const blob = new Blob([doc], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank');
    if (!w) { download('spec.html', doc, 'text/html'); toast('Pop-up blocked — downloaded instead'); }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  // ------------------------------------------------------------- definitions
  function roleBadge(role) {
    if (!role) return '';
    return `<span class="text-[10px] px-2 py-0.5 rounded-full bg-teal-900/40 text-teal-300">${esc(role)}</span>`;
  }
  function confBadge(level) {
    const c = CONF_COLOR[level] || 'slate';
    return `<span class="text-[10px] px-2 py-0.5 rounded-full bg-${c}-900/30 text-${c}-300">${esc(level)}</span>`;
  }
  function chip(text) { return `<span class="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300">${esc(text)}</span>`; }

  function depLink(name) {
    const target = (lastAnalysis.definitions.find(d => d.name === name) || {}).sourceStartLine;
    return `<button onclick="highlightLine(${target || 0})" class="text-teal-300 hover:underline text-xs">${esc(name)}</button>`;
  }

  function renderDefinitionsTab(a) {
    if (!a.definitions.length) {
      $('tab-definitions').innerHTML = `<div class="p-4 bg-amber-900/10 border border-amber-700/40 rounded-2xl text-sm text-amber-200">No definitions were detected. Try pasting a fuller library including <code>define "…":</code> statements.</div>`;
      return;
    }
    $('tab-definitions').innerHTML = a.definitions.map((d, i) => {
      const flagBits = d.reviewFlags.map(f => chip(f.severity + ': ' + f.message)).join(' ');
      const bool = d.booleanLines.length
        ? `<div class="mt-2"><div class="text-[11px] uppercase tracking-widest text-slate-500 mb-1">Logic in plain English</div><pre class="bool font-mono text-xs bg-slate-950 rounded-xl p-3 text-slate-200">${esc(d.booleanLines.join('\n'))}</pre></div>`
        : '';
      const rows = [
        d.inferredReturnType && kv('Returns', d.inferredReturnType),
        d.retrieves.length && kv('Resource types', d.retrieves.map(r => r.resourceType).join(', ')),
        d.valueSets.length && kv('Value sets', d.valueSets.join(', ')),
        (d.timing.phrases.length || d.timing.offsets.length) && kv('Timing', d.timing.phrases.concat(d.timing.offsets).join(', ')),
      ].filter(Boolean).join('');
      const deps = d.references.length
        ? `<div class="flex gap-x-2 text-sm items-baseline"><span class="text-slate-500 w-32 flex-shrink-0">Depends on</span><span>${d.references.map(depLink).join(', ')}</span></div>`
        : '';
      const unresolved = d.unresolvedReferences.length
        ? `<div class="flex gap-x-2 text-sm items-baseline"><span class="text-slate-500 w-32 flex-shrink-0">Unresolved</span><span class="text-rose-300 text-xs">${d.unresolvedReferences.map(esc).join(', ')}</span></div>`
        : '';
      return `<div class="card mb-3 bg-slate-900 border border-slate-700 rounded-2xl" id="def-${i}">
        <div class="p-4 flex items-center justify-between cursor-pointer" onclick="toggleCard(${i})">
          <div class="flex items-center gap-x-2 min-w-0">
            <span class="font-semibold text-teal-200 truncate">${esc(d.name)}</span>
            ${roleBadge(d.populationRole)} ${d.kind === 'function' ? chip('function') : ''}
          </div>
          <div class="flex items-center gap-x-2 flex-shrink-0">
            ${confBadge(d.confidence)}
            <button onclick="event.stopPropagation();highlightLine(${d.sourceStartLine})" class="text-[10px] text-slate-400 hover:text-teal-300">lines ${d.sourceStartLine}–${d.sourceEndLine}</button>
          </div>
        </div>
        <div class="card-body px-4 pb-4 space-y-2">
          <div class="text-sm text-slate-300">${esc(d.explanation)}</div>
          ${rows}${deps}${unresolved}
          ${bool}
          ${flagBits ? `<div class="flex flex-wrap gap-1 pt-1">${flagBits}</div>` : ''}
        </div>
      </div>`;
    }).join('');
  }
  window.toggleCard = (i) => $('def-' + i).classList.toggle('card-collapsed');

  // ------------------------------------------------------------- dependencies
  function renderDependenciesTab(a) {
    let html = '';
    const roots = a.definitions.filter(d => a.definitions.every(o => (a.dependencyGraph[o.name] || []).indexOf(d.name) === -1));
    const drawn = new Set();
    function tree(name, depth) {
      const pad = depth * 18;
      let out = `<div style="padding-left:${pad}px" class="py-0.5">${depth ? '↳ ' : ''}${depLink(name)}</div>`;
      if (drawn.has(name)) return out;
      drawn.add(name);
      (a.dependencyGraph[name] || []).forEach(child => { out += tree(child, depth + 1); });
      return out;
    }
    html += `<div class="p-4 bg-slate-950 rounded-2xl border border-slate-700 font-mono text-sm mb-4">`;
    html += (roots.length ? roots : a.definitions).map(d => tree(d.name, 0)).join('');
    html += `</div>`;

    if (a.unresolvedReferences.length) {
      html += `<div class="p-4 bg-rose-900/10 border border-rose-800/40 rounded-2xl mb-3">
        <div class="text-rose-300 font-semibold text-sm mb-1">Unresolved references (${a.unresolvedReferences.length})</div>
        <ul class="text-sm text-slate-300 space-y-0.5">${a.unresolvedReferences.map(u =>
          `<li>"${esc(u.name)}" — referenced by <button onclick="highlightLine(${u.line})" class="text-teal-300 hover:underline">${esc(u.from)}</button> (line ${u.line})</li>`
        ).join('')}</ul></div>`;
    }
    if (a.cycles.length) {
      html += `<div class="p-4 bg-rose-900/20 border border-rose-700/50 rounded-2xl">
        <div class="text-rose-300 font-semibold text-sm mb-1">Circular dependencies</div>
        ${a.cycles.map(c => `<div class="text-sm text-slate-200 font-mono">${esc(c.join(' → '))}</div>`).join('')}</div>`;
    }
    $('tab-dependencies').innerHTML = html;
  }

  // ------------------------------------------------------------- population
  function renderPopulationTab(a) {
    const f = a.populationFlow;
    if (!f.steps.length) {
      $('tab-population').innerHTML = `<div class="text-sm text-slate-400 p-4 bg-slate-900 rounded-2xl border border-slate-700">No standard population roles (Initial Population, Denominator, Numerator…) were detected from the definition names.</div>`;
      return;
    }
    let html = `<div class="text-xs text-amber-400 mb-3">Roles inferred from definition names.</div>`;
    html += `<div class="space-y-2 mb-4">` + f.steps.map((s, i) =>
      `<div class="flex items-center gap-x-3">
        <div class="flex-1 p-3 bg-slate-900 border border-slate-700 rounded-2xl flex items-center justify-between">
          <span class="text-sm font-medium">${esc(s.role)}</span>
          <button onclick="highlightLine(${s.line})" class="text-xs text-teal-300 hover:underline">${esc(s.definition)} · line ${s.line}</button>
        </div>
      </div>${i < f.steps.length - 1 ? '<div class="text-center text-slate-600 text-xs">↓</div>' : ''}`
    ).join('') + `</div>`;
    if (f.narrative) html += `<div class="p-4 bg-slate-950 rounded-2xl border border-slate-700 text-sm leading-relaxed">${esc(f.narrative)}</div>`;
    $('tab-population').innerHTML = html;
  }

  // ------------------------------------------------------------- timing
  function renderTimingTab(a) {
    let html = '';
    if (a.temporalFlows.length) {
      html += a.temporalFlows.map(w =>
        `<div class="p-4 bg-slate-900 border border-slate-700 rounded-2xl mb-3">
          <button onclick="highlightLine(${w.line})" class="text-teal-300 font-medium text-sm hover:underline">${esc(w.definition)} · line ${w.line}</button>
          <table class="mt-2 text-sm w-full">
            <tr><td class="text-slate-500 py-0.5 pr-3 align-top w-36">Window begins</td><td class="font-mono text-xs">${esc(w.windowBegins)}</td></tr>
            <tr><td class="text-slate-500 py-0.5 pr-3 align-top">Window ends</td><td class="font-mono text-xs">${esc(w.windowEnds)}</td></tr>
            <tr><td class="text-slate-500 py-0.5 pr-3 align-top">Requirement</td><td>${esc(w.requirement)}</td></tr>
            <tr><td class="text-slate-500 py-0.5 pr-3 align-top">Boundary</td><td class="text-slate-400 text-xs">${esc(w.boundaryType)}</td></tr>
          </table>
        </div>`
      ).join('');
    }
    const withTiming = a.definitions.filter(d => d.timing.phrases.length || d.timing.offsets.length);
    if (withTiming.length) {
      html += `<div class="p-4 bg-slate-950 rounded-2xl border border-slate-700"><div class="text-[11px] uppercase tracking-widest text-slate-500 mb-2">Timing operators by definition</div>` +
        withTiming.map(d => `<div class="text-sm py-1 flex justify-between"><button onclick="highlightLine(${d.sourceStartLine})" class="text-teal-300 hover:underline">${esc(d.name)}</button><span class="text-slate-400 text-xs">${esc(d.timing.phrases.concat(d.timing.offsets).join(', '))}</span></div>`).join('') +
        `</div>`;
    }
    if (!html) html = `<div class="text-sm text-slate-400 p-4 bg-slate-900 rounded-2xl border border-slate-700">No temporal relationships were detected.</div>`;
    $('tab-timing').innerHTML = html;
  }

  // ------------------------------------------------------------- flags
  const SEV_COLOR = { High: 'rose', Review: 'amber', Info: 'sky' };
  function renderFlagsTab(a) {
    if (!a.reviewFlags.length) {
      $('tab-flags').innerHTML = `<div class="text-sm text-slate-400 p-4 bg-slate-900 rounded-2xl border border-slate-700">No review flags raised.</div>`;
      return;
    }
    const order = { High: 0, Review: 1, Info: 2 };
    const sorted = a.reviewFlags.slice().sort((x, y) => order[x.severity] - order[y.severity]);
    $('tab-flags').innerHTML = `<div class="text-xs text-slate-500 mb-3">These are things to verify — not confirmed errors. Only a real compiler/validator can confirm defects.</div>` +
      sorted.map(f => {
        const c = SEV_COLOR[f.severity] || 'slate';
        return `<div class="p-3 mb-2 bg-slate-900 border border-slate-700 rounded-2xl">
          <div class="flex items-center gap-x-2 mb-1">
            <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-${c}-900/40 text-${c}-300">${esc(f.severity)}</span>
            <span class="text-sm font-medium">${esc(f.message)}</span>
            ${f.line ? `<button onclick="highlightLine(${f.line})" class="ml-auto text-xs text-teal-300 hover:underline">${esc(f.definition)} · line ${f.line}</button>` : `<span class="ml-auto text-xs text-slate-500">${esc(f.definition)}</span>`}
          </div>
          <div class="text-xs text-slate-400 leading-snug">${esc(f.why)}</div>
        </div>`;
      }).join('');
  }

  // ------------------------------------------------------------- validation
  function renderValidationTab(a) {
    const v = a.validation;
    const rows = [
      ['Basic structure', v.structure],
      ['CQL syntax', v.syntax],
      ['Data model', v.model],
      ['Missing references', v.missingReferences + ' found'],
      ['Value-set validation', v.valueSetValidation],
      ['ELM translation', v.elmTranslation],
      ['Execution', v.execution],
      ['Specification compliance', v.specificationCompliance],
    ];
    $('tab-validation').innerHTML =
      `<div class="text-xs text-slate-500 mb-3">This tool performs structural analysis only. Anything marked “Not evaluated/run” requires a real CQL-to-ELM compiler.</div>
       <div class="bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden">` +
      rows.map((r, i) => `<div class="flex justify-between px-4 py-2.5 text-sm ${i ? 'border-t border-slate-800' : ''}"><span class="text-slate-400">${esc(r[0])}</span><span class="text-slate-200">${esc(r[1])}</span></div>`).join('') +
      `</div>`;
  }

  // ============================================================== EXPORT
  function buildMarkdown(a) {
    const lines = [];
    lines.push('# CQL Clarity analysis: ' + (a.library.name || 'Untitled'));
    lines.push('');
    lines.push('> Confidence: **' + a.summary.confidence + '** — ' + a.summary.confidenceReason);
    lines.push('');
    lines.push('## Summary (inferred)');
    lines.push(a.summary.text);
    lines.push('');
    lines.push('## Detected');
    lines.push('- Library: ' + (a.library.name || '—') + (a.library.version ? ' v' + a.library.version : ''));
    lines.push('- Data model: ' + a.validation.model);
    lines.push('- Context: ' + (a.library.context || '—'));
    lines.push('- Definitions: ' + a.definitions.length);
    lines.push('');
    lines.push('## Definitions');
    a.definitions.forEach(d => {
      lines.push('### ' + d.name + (d.populationRole ? ' — ' + d.populationRole : ''));
      lines.push('- Source: lines ' + d.sourceStartLine + '–' + d.sourceEndLine);
      lines.push('- Returns (inferred): ' + d.inferredReturnType);
      if (d.retrieves.length) lines.push('- Resource types: ' + d.retrieves.map(r => r.resourceType).join(', '));
      if (d.valueSets.length) lines.push('- Value sets: ' + d.valueSets.join(', '));
      if (d.references.length) lines.push('- Depends on: ' + d.references.join(', '));
      if (d.unresolvedReferences.length) lines.push('- Unresolved: ' + d.unresolvedReferences.join(', '));
      lines.push('');
      lines.push(d.explanation);
      if (d.booleanLines.length) {
        lines.push('');
        lines.push('```');
        lines.push(d.booleanLines.join('\n'));
        lines.push('```');
      }
      lines.push('');
    });
    if (a.reviewFlags.length) {
      lines.push('## Review flags');
      a.reviewFlags.forEach(f => lines.push('- **' + f.severity + '** (' + f.definition + (f.line ? ', line ' + f.line : '') + '): ' + f.message + ' — ' + f.why));
      lines.push('');
    }
    lines.push('## Validation');
    lines.push('_Structural analysis only; syntax/ELM/execution not run._');
    return lines.join('\n');
  }

  function download(filename, text, type) {
    const blob = new Blob([text], { type: type || 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportMarkdown() { if (lastAnalysis) download((lastAnalysis.library.name || 'cql-analysis') + '.md', buildMarkdown(lastAnalysis), 'text/markdown'); }
  function exportJSON() {
    if (!lastAnalysis) return;
    const clean = JSON.parse(JSON.stringify(lastAnalysis, (k, val) => k === 'booleanTree' ? undefined : val));
    download((lastAnalysis.library.name || 'cql-analysis') + '.json', JSON.stringify(clean, null, 2), 'application/json');
  }
  function copyExplanation() {
    if (!lastAnalysis) return;
    const text = lastAnalysis.summary.text + '\n\n' +
      lastAnalysis.definitions.map(d => d.name + ': ' + d.explanation).join('\n\n');
    navigator.clipboard.writeText(text).then(() => toast('Explanation copied')).catch(() => toast('Copy failed'));
  }
  function copyAIPrompt() {
    if (!lastAnalysis) return;
    const prompt = 'You are a clinical informaticist. Explain this CQL to business users in plain language, ' +
      'covering the clinical goal, each definition, the population flow, timing windows, and data caveats. ' +
      'Ground your answer only in the code below.\n\n```cql\n' + lastCode + '\n```';
    navigator.clipboard.writeText(prompt).then(() => toast('AI prompt copied')).catch(() => toast('Copy failed'));
  }
  window.exportMarkdown = exportMarkdown;
  window.exportJSON = exportJSON;
  window.copyExplanation = copyExplanation;
  window.copyAIPrompt = copyAIPrompt;

  // ============================================================== LIBRARY
  function saveToLibrary() {
    if (!lastAnalysis) return;
    const lib = loadJSON(LIB_KEY, []);
    lib.unshift({
      id: Date.now(),
      title: lastAnalysis.library.name || 'Untitled analysis',
      date: new Date().toISOString(),
      code: lastCode,
      summary: lastAnalysis.summary.text,
      defines: lastAnalysis.definitions.length,
      confidence: lastAnalysis.summary.confidence,
    });
    saveJSON(LIB_KEY, lib.slice(0, 100));
    renderActivity();
    toast('Saved to My Library');
  }
  window.saveToLibrary = saveToLibrary;

  function renderLibrary() {
    const q = ($('library-search').value || '').toLowerCase();
    const lib = loadJSON(LIB_KEY, []).filter(it =>
      !q || (it.title + ' ' + it.summary).toLowerCase().includes(q));
    if (!lib.length) {
      $('library-list').innerHTML = `<div class="text-sm text-slate-400">No saved analyses yet. Translate some CQL and click “Save to My Library”.</div>`;
      return;
    }
    $('library-list').innerHTML = lib.map(it =>
      `<div class="p-4 bg-slate-900 border border-slate-700 rounded-2xl">
        <div class="flex justify-between items-start mb-1">
          <div class="font-semibold text-teal-200">${esc(it.title)}</div>
          <span class="text-[10px] text-slate-500">${esc(new Date(it.date).toLocaleDateString())}</span>
        </div>
        <div class="text-xs text-slate-400 line-clamp-2 mb-3">${esc(it.summary)}</div>
        <div class="flex flex-wrap gap-2 text-[11px]">
          <span class="px-2 py-0.5 bg-slate-800 rounded">${esc(it.defines)} defines</span>
          <span class="px-2 py-0.5 bg-slate-800 rounded">${esc(it.confidence)} confidence</span>
          <button onclick="reopenAnalysis(${it.id})" class="ml-auto px-3 py-1 bg-teal-600 hover:bg-teal-500 text-white rounded-2xl">Reopen</button>
          <button onclick="deleteAnalysis(${it.id})" class="px-3 py-1 border border-slate-700 hover:bg-slate-800 rounded-2xl">Delete</button>
        </div>
      </div>`
    ).join('');
  }
  window.renderLibrary = renderLibrary;
  window.reopenAnalysis = (id) => {
    const it = loadJSON(LIB_KEY, []).find(x => x.id === id);
    if (!it) return;
    $('cql-input').value = it.code;
    navigateTo('translate');
    translateCQL();
  };
  window.deleteAnalysis = (id) => {
    saveJSON(LIB_KEY, loadJSON(LIB_KEY, []).filter(x => x.id !== id));
    renderLibrary(); renderActivity();
  };

  // ============================================================== INPUT HELPERS
  function clearTranslator() {
    $('cql-input').value = '';
    $('results').classList.add('hidden');
    lastAnalysis = null; lastCode = '';
  }
  function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { $('cql-input').value = ev.target.result; $('cql-input').focus(); };
    reader.readAsText(file);
    e.target.value = '';
  }
  window.clearTranslator = clearTranslator;
  window.handleFileUpload = handleFileUpload;
  window.loadExample = (id) => {
    const ex = EXAMPLES.find(e => e.id === id);
    if (!ex) return;
    $('cql-input').value = ex.cql;
    navigateTo('translate');
    translateCQL();
  };
  window.loadElmExample = () => {
    $('cql-input').value = JSON.stringify(ELM_EXAMPLE, null, 2);
    navigateTo('translate');
    translateCQL();
  };

  // ============================================================== CONTENT DATA
  const EXAMPLES = [
    { id: 0, title: 'OMW — Osteoporosis Management (Post-Fracture)', category: 'HEDIS / dQM',
      intent: 'Women 67–85 with a fragility fracture who received BMD testing or osteoporosis medication within 6 months.',
      cql: `library OMW_FractureManagement version '1.0.0'

using FHIR version '4.0.1'

include FHIRHelpers version '4.0.1' called FHIRHelpers

parameter MeasurementPeriod default Interval[@2025-01-01, @2026-01-01)

context Patient

define "Initial Population":
  AgeInYearsAt(start of MeasurementPeriod) in Interval[67, 85]
    and Patient.gender = 'female'

define "Index Fracture":
  [Condition: "Fragility Fracture"] F
    where F.clinicalStatus ~ "active"
      and F.onset during MeasurementPeriod

define "BMD Test After Fracture":
  exists (
    [Observation: "Bone Mineral Density Test"] B
      where B.effective during Interval[start of "Index Fracture".onset, start of "Index Fracture".onset + 6 months]
  )

define "Osteoporosis Medication":
  exists (
    [MedicationRequest: "Osteoporosis Medication"] M
      where M.authoredOn during Interval[start of "Index Fracture".onset, start of "Index Fracture".onset + 6 months]
  )

define "Numerator":
  "BMD Test After Fracture" or "Osteoporosis Medication"` },
    { id: 1, title: 'Colorectal Cancer Screening', category: 'Preventive',
      intent: 'Adults 45–75 who received appropriate colorectal cancer screening.',
      cql: `define "Initial Population":
  AgeInYearsAt(start of MeasurementPeriod) in Interval[45, 75]

define "Colorectal Cancer Screening":
  exists ([Procedure: "Colonoscopy"] P where P.performed during MeasurementPeriod)
  or exists ([Observation: "Fecal Immunochemical Test"] O where O.effective during MeasurementPeriod)` },
    { id: 2, title: 'Diabetes — HbA1c Poor Control', category: 'Chronic',
      intent: 'Diabetic patients whose most recent HbA1c is greater than 9%.',
      cql: `define "Has Diabetes":
  exists ([Condition: "Diabetes"] C
    where C.clinicalStatus ~ "active"
      and Interval[C.onset, C.abatement] overlaps MeasurementPeriod)

define "Most Recent HbA1c":
  Last([Observation: "HbA1c"] O sort by effective desc)

define "Poor Control":
  "Has Diabetes" and "Most Recent HbA1c".value > 9 '%'` },
    { id: 3, title: 'Exclusion Logic (Hospice / LTC)', category: 'HEDIS / dQM',
      intent: 'Common denominator exclusion patterns.',
      cql: `define "Initial Population":
  AgeInYearsAt(start of MeasurementPeriod) >= 18

define "Hospice Exclusion":
  exists ([Condition: "Hospice Care"] H where H.clinicalStatus ~ "active")

define "Denominator Exclusions":
  "Hospice Exclusion"` },
  ];

  // A compact but valid ELM library (compiled OMW) for the "Load ELM example".
  const ELM_EXAMPLE = (function () {
    const lit = (v, t) => ({ type: 'Literal', valueType: t || '{urn:hl7-org:elm-types:r1}Integer', value: v });
    const prop = (p, s) => ({ type: 'Property', path: p, scope: s });
    const vs = (n) => ({ type: 'ValueSetRef', name: n });
    const retr = (rt, v) => ({ type: 'Retrieve', dataType: '{http://hl7.org/fhir}' + rt, codes: vs(v) });
    const ref = (n) => ({ type: 'ExpressionRef', name: n });
    const q = (al, rt, v, w) => ({ type: 'Query', source: [{ alias: al, expression: retr(rt, v) }], where: w });
    const inIv = (a, b) => ({ type: 'IncludedIn', operand: [a, b] });
    const win = { type: 'Interval',
      low: { type: 'Start', operand: prop('onset', 'IF') },
      high: { type: 'Add', operand: [{ type: 'Start', operand: prop('onset', 'IF') }, { type: 'Quantity', value: 6, unit: 'month' }] } };
    return { library: {
      identifier: { id: 'OMW_FractureManagement', version: '1.0.0' },
      schemaIdentifier: { id: 'urn:hl7-org:elm', version: 'r1' },
      usings: { def: [
        { localIdentifier: 'System', uri: 'urn:hl7-org:elm-types:r1' },
        { localIdentifier: 'FHIR', uri: 'http://hl7.org/fhir', version: '4.0.1' } ] },
      includes: { def: [{ localIdentifier: 'FHIRHelpers', path: 'FHIRHelpers', version: '4.0.1' }] },
      parameters: { def: [{ name: 'MeasurementPeriod' }] },
      valueSets: { def: [
        { name: 'Fragility Fracture', id: 'urn:oid:2.16.840.1.113883.3.464.1004.1' },
        { name: 'Bone Mineral Density Test', id: 'urn:oid:2.16.840.1.113883.3.464.1004.2' },
        { name: 'Osteoporosis Medication', id: 'urn:oid:2.16.840.1.113883.3.464.1004.3' } ] },
      contexts: { def: [{ name: 'Patient' }] },
      statements: { def: [
        { name: 'Patient', context: 'Patient', expression: { type: 'SingletonFrom', operand: retr('Patient', '') } },
        { name: 'Initial Population', context: 'Patient', locator: '10:1-12:34',
          annotation: [{ type: 'Annotation', s: { s: [{ value: ['define "Initial Population":\n  AgeInYearsAt(start of MeasurementPeriod) in Interval[67, 85]\n    and Patient.gender = \'female\''] }] } }],
          expression: { type: 'And', operand: [
            { type: 'In', operand: [{ type: 'CalculateAgeAt', operand: [] }, { type: 'Interval', low: lit(67), high: lit(85) }] },
            { type: 'Equal', operand: [prop('gender', 'Patient'), lit('female', '{urn:hl7-org:elm-types:r1}String')] } ] } },
        { name: 'Index Fracture', context: 'Patient', locator: '14:1-17:38',
          annotation: [{ type: 'Annotation', s: { s: [{ value: ['define "Index Fracture":\n  [Condition: "Fragility Fracture"] F\n    where F.clinicalStatus ~ \'active\'\n      and F.onset during MeasurementPeriod'] }] } }],
          expression: q('F', 'Condition', 'Fragility Fracture', { type: 'And', operand: [
            { type: 'Equivalent', operand: [prop('clinicalStatus', 'F'), lit('active', '{urn:hl7-org:elm-types:r1}String')] },
            inIv(prop('onset', 'F'), { type: 'ParameterRef', name: 'MeasurementPeriod' }) ] }) },
        { name: 'BMD Test After Fracture', context: 'Patient', locator: '19:1-23:4',
          annotation: [{ type: 'Annotation', s: { s: [{ value: ['define "BMD Test After Fracture":\n  exists ([Observation: "Bone Mineral Density Test"] B\n    where B.effective during Interval[start of "Index Fracture".onset, start of "Index Fracture".onset + 6 months])'] }] } }],
          expression: { type: 'Exists', operand: q('B', 'Observation', 'Bone Mineral Density Test', inIv(prop('effective', 'B'), win)) } },
        { name: 'Osteoporosis Medication', context: 'Patient', locator: '25:1-29:4',
          annotation: [{ type: 'Annotation', s: { s: [{ value: ['define "Osteoporosis Medication":\n  exists ([MedicationRequest: "Osteoporosis Medication"] M\n    where M.authoredOn during Interval[start of "Index Fracture".onset, start of "Index Fracture".onset + 6 months])'] }] } }],
          expression: { type: 'Exists', operand: q('M', 'MedicationRequest', 'Osteoporosis Medication', inIv(prop('authoredOn', 'M'), win)) } },
        { name: 'Numerator', context: 'Patient', locator: '31:1-32:56',
          annotation: [{ type: 'Annotation', s: { s: [{ value: ['define "Numerator":\n  "BMD Test After Fracture" or "Osteoporosis Medication"'] }] } }],
          expression: { type: 'Or', operand: [ref('BMD Test After Fracture'), ref('Osteoporosis Medication')] } } ] } } };
  })();

  function renderExamples() {
    $('examples-grid').innerHTML = EXAMPLES.map(ex =>
      `<div class="bg-slate-900 border border-slate-700 hover:border-teal-700 rounded-2xl p-4 flex flex-col">
        <span class="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-teal-300 w-fit mb-2">${esc(ex.category)}</span>
        <div class="font-semibold text-sm mb-1">${esc(ex.title)}</div>
        <div class="text-xs text-slate-400 flex-1">${esc(ex.intent)}</div>
        <button onclick="loadExample(${ex.id})" class="mt-3 text-xs py-1.5 bg-teal-600 hover:bg-teal-500 text-white rounded-2xl">Load &amp; translate</button>
      </div>`
    ).join('');
  }

  const LESSONS = [
    { id: 1, title: 'What is CQL and why it matters', body: 'CQL (Clinical Quality Language) is an HL7 standard for expressing clinical logic in a form that is both human-readable and computable. NCQA uses it for digital HEDIS measures and CMS for many eCQMs. Your rules engine compiles CQL into ELM (Expression Logical Model) for execution.' },
    { id: 2, title: 'Library structure & context', body: 'Every file starts with a library declaration, optional using/include statements, parameters, then a single context (almost always Patient for quality measures). The context scopes retrieves — in Patient context, [Condition] returns only that patient\'s conditions.' },
    { id: 3, title: 'Retrieves, timing & population logic', body: 'The power of CQL comes from combining retrieves ([Condition: "X"]) with timing operators (during, overlaps, after) and existence checks (exists). Population definitions (Initial Population, Denominator, Numerator, Exclusions) assemble these into a measure.' },
  ];
  function renderLessons() {
    const state = loadJSON('cqlclarity_lessons', { completed: [] });
    $('lessons-list').innerHTML = LESSONS.map((l, i) => {
      const done = state.completed.includes(l.id);
      return `<div onclick="showLesson(${i})" class="px-4 py-3 rounded-2xl cursor-pointer hover:bg-slate-800 flex justify-between items-center">
        <span class="text-sm font-medium">${esc(l.title)}</span>
        <span class="text-xs ${done ? 'text-emerald-400' : 'text-slate-500'}">${done ? '✓ done' : ''}</span></div>`;
    }).join('');
  }
  window.showLesson = (i) => {
    const l = LESSONS[i];
    $('lesson-content').innerHTML =
      `<h3 class="font-semibold text-lg mb-2">${esc(l.title)}</h3>
       <p class="text-sm leading-relaxed text-slate-300">${esc(l.body)}</p>
       <button onclick="markLessonDone(${l.id})" class="mt-5 text-xs px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-2xl">Mark complete</button>`;
  };
  window.markLessonDone = (id) => {
    const state = loadJSON('cqlclarity_lessons', { completed: [] });
    if (!state.completed.includes(id)) state.completed.push(id);
    saveJSON('cqlclarity_lessons', state);
    renderLessons(); renderActivity(); toast('Lesson marked complete');
  };

  const GLOSSARY = [
    { term: 'Context', def: 'Evaluation scope (Patient, Practitioner, Unfiltered). Most measures use Patient.' },
    { term: 'Retrieve', def: '[ResourceType: valueset] — pulls clinical data like Conditions or Observations.' },
    { term: 'MeasurementPeriod', def: 'Parameter interval representing the reporting period.' },
    { term: 'during / overlaps', def: 'Timing operators relating events to periods or other events.' },
    { term: 'exists', def: 'Returns true if at least one item meets the criteria.' },
    { term: 'AgeInYearsAt', def: 'Patient age in whole years at a given date.' },
    { term: 'clinicalStatus', def: 'FHIR Condition element (active, resolved…) often filtered in logic.' },
    { term: 'ELM', def: 'Expression Logical Model — the compiled form of CQL your engine executes.' },
  ];
  function renderGlossary() {
    const q = ($('glossary-search') && $('glossary-search').value || '').toLowerCase();
    const list = GLOSSARY.filter(g => !q || (g.term + g.def).toLowerCase().includes(q));
    $('glossary-list').innerHTML = list.map(g =>
      `<div class="flex gap-x-3 text-sm"><div class="font-semibold w-28 flex-shrink-0 text-teal-300">${esc(g.term)}</div><div class="text-slate-300">${esc(g.def)}</div></div>`
    ).join('');
  }
  window.renderGlossary = renderGlossary;
  const PATTERNS = [
    { t: 'Age + Measurement Period', c: 'AgeInYearsAt(start of MeasurementPeriod) in Interval[67, 85]' },
    { t: 'Exists condition in period', c: 'exists ([Condition: "Diabetes"] C where C.clinicalStatus ~ \'active\')' },
    { t: 'Timing window', c: 'B.effective during Interval[start of Fracture.onset, start of Fracture.onset + 6 months]' },
  ];
  function renderPatterns() {
    $('patterns-list').innerHTML = PATTERNS.map(p =>
      `<div class="p-3 bg-slate-950 rounded-2xl"><div class="font-medium text-teal-400">${esc(p.t)}</div><div class="font-mono text-xs text-slate-400 mt-1">${esc(p.c)}</div></div>`
    ).join('');
  }

  // ============================================================== SIMULATOR
  let simFracture = true;
  window.setSimFracture = (on, btn) => {
    simFracture = on;
    document.querySelectorAll('.sim-frac').forEach(b => { b.classList.remove('bg-emerald-900/30', 'border-emerald-700', 'text-emerald-300'); b.classList.add('border-slate-700'); });
    btn.classList.add('bg-emerald-900/30', 'border-emerald-700', 'text-emerald-300'); btn.classList.remove('border-slate-700');
  };
  window.runSimulator = () => {
    const age = parseInt($('sim-age').value, 10);
    const gender = $('sim-gender').value;
    const reasons = [];
    let inPop = false;
    if (age >= 67 && gender === 'female') {
      reasons.push('Meets age (≥67) and gender (female).');
      if (simFracture) { inPop = true; reasons.push('Has a fragility fracture in the period → in population.'); }
      else reasons.push('No fracture recorded → not in population.');
    } else reasons.push('Does not meet age/gender criteria.');
    $('sim-result').classList.remove('hidden');
    $('sim-result').innerHTML =
      `<div class="font-semibold mb-2">${inPop ? '<span class="text-emerald-300">✓ In population</span>' : '<span class="text-rose-300">Not in population</span>'}</div>` +
      reasons.map(r => `<div class="text-xs text-slate-400">• ${esc(r)}</div>`).join('');
  };

  // ============================================================== BOOT
  window.addEventListener('load', () => {
    renderActivity();
    $('cql-input').value = EXAMPLES[0].cql;
  });
})();
