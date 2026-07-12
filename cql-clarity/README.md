# CQL Clarity

A browser-based tool that turns pasted **CQL or compiled ELM (JSON)** into a
plain-English breakdown for business users — and generates audience-tuned
**specification documents** from the same analysis. It is a **structural reader,
not a compiler**: for CQL it never claims the code is valid, it clearly separates
what it *detected* from what it *inferred* and what it *cannot determine*, and it
can prove every claim back to a source line.

Live demo: https://wefeltlikeit-sketch.github.io/HDS_MKUPS/cql-clarity/

---

## CQL vs ELM input

The translator **auto-detects** which you paste:

- **CQL** is read with a scanner (heuristic). Findings are labelled *inferred*
  where appropriate and confidence reflects that.
- **ELM** is the compiled JSON form of CQL, so it is parsed **exactly** —
  references, retrieves, data types, and source ranges come straight from the
  expression tree. ELM analyses report **High** confidence with an *Input: ELM*
  badge. If your pipeline already produces ELM, paste that for the most accurate
  output.

Either way the tool produces the same views and documents.

---

## Run it

**Locally:** double-click `index.html` (or open it in any browser). It needs an
internet connection the first time to load Tailwind/fonts from a CDN. Everything
else runs in the browser — no CQL or ELM ever leaves the machine.

**Host it online:** upload the whole folder to any static host (GitHub Pages,
Netlify, Cloudflare Pages, S3, …). No build step and no server code — the six
front-end files below are all that's needed.

---

## Feature tour

After pasting CQL/ELM and clicking **Translate intent**, the analysis appears as
tabs:

- **Summary** — clinical intent (inferred), the confidence indicator with its
  reasoning, and the *Detected directly* metadata (library, model, context,
  includes, parameters, value sets).
- **Spec docs** — the headline feature. Generates two documents from the same
  analysis:
  - **Business Measure Specification** (narrative, no code): purpose, who is
    measured, eligibility in plain English, timing windows, what counts as
    compliant, assumptions to confirm, data used.
  - **Engineering Intent Brief** (code + intent): per-definition intent with the
    CQL, a **data-requirements matrix** (resource / value set / attributes read),
    a dependency-first evaluation order, and implementation gotchas.
  - Each mode supports **Copy Markdown**, **Download .md**, and **Open printable
    / PDF** (a standalone styled document with a print button).
- **Definitions** — structured, collapsible cards: inferred return type,
  resources, value sets, timing, dependencies (clickable), confidence, source
  lines, and the logic rewritten in plain English.
- **Dependencies** — a reference tree, unresolved references, and circular-
  dependency warnings, all source-linked.
- **Population** — the measure population flow (Initial Population → Denominator →
  Numerator …) with a narrative, roles clearly labelled as inferred.
- **Timing** — temporal windows (e.g. a six-month follow-up) and the timing
  operators used per definition.
- **Provenance** — proves every line. Each claim is tagged **Detected /
  Inferred / Not determined** and links to the exact source line, plus a
  **line-coverage meter** that shows what fraction of the source was accounted
  for and lists anything that wasn't.
- **Review flags** — things to verify (Info / Review / High), each with *why it
  matters* and a source link. Never labelled as confirmed errors.
- **Validation** — an honest status panel; anything requiring a real compiler
  (syntax, ELM translation, value-set contents, execution) is marked as not run.

Other surfaces: **My Library** (save / reopen / search / delete analyses,
stored locally), **Examples**, **Lessons**, **Reference** (glossary + patterns),
and a **Guided Simulator** clearly labelled as a fixed demo, not a CQL runtime.

Boolean logic is rewritten as nested `ALL of… / AT LEAST ONE of… / There is
NO…`, and every rendered value is HTML-escaped, so pasted `<script>` /
`<img onerror>` display as text and never execute.

---

## Files

| File | Purpose |
|------|---------|
| `index.html` | Page shell, layout, navigation, styles |
| `app.js` | UI rendering and interaction (all untrusted values HTML-escaped) |
| `analyzer.js` | CQL analysis engine + shared `assemble()` — no DOM, unit-testable |
| `elm.js` | ELM (JSON) ingestion → produces the same analysis-object shape |
| `spec.js` | Spec Document Generator (business / engineer; Markdown + printable HTML) |
| `provenance.js` | Per-claim provenance and line-coverage model |
| `*.test.js` | Node test suites for the four modules above |
| `package.json` | Marks this folder CommonJS for Node so the modules run under `node --test` |

**Architecture.** `analyzer.js` (CQL) and `elm.js` (ELM) both emit one structured
analysis object; `app.js`, `spec.js`, and `provenance.js` render from that object
without knowing which input produced it. This is what lets CQL and ELM share the
entire UI, and it is where a future CQL→ELM compiler or AI-narrative layer would
plug in.

---

## Tests

```sh
npm test
# or directly:
node --test cql/analyzer.test.js cql/spec.test.js cql/elm.test.js cql/provenance.test.js
```

**52 cases** covering:

- **analyzer** — define-extraction edge cases (final define, functions after
  defines, comments/strings containing keywords), dependency and
  unresolved/circular detection, boolean-structure translation, timing windows,
  CRLF/LF handling, and that malicious HTML renders as text.
- **spec** — business vs engineer output, the data-requirements matrix,
  dependency ordering, HTML escaping, and the standalone printable document.
- **elm** — metadata extraction, exact dependencies, retrieves/attributes,
  boolean/timing translation, review flags, JSON-string input, and escaping.
- **provenance** — every claim carries a source anchor, correct line anchoring,
  category tagging, and the coverage / unaccounted-lines calculation.

---

## Privacy & security

Entirely client-side. Pasted CQL/ELM and saved analyses stay in the browser
(`localStorage`); nothing is sent to a server. All dynamic content is
HTML-escaped before rendering.

---

## Not included yet (roadmap)

Real CQL→ELM compilation, execution against sample FHIR data, value-set
validation, multi-file `include` resolution, terminology (VSAC/OID) enrichment,
an AI-enhanced narrative grounded in the structured object, and version
comparison. Because both input paths emit the same analysis object, these can be
added without reworking the UI.
