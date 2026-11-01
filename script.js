
(() => {
  'use strict';

  /* ---------- CSV format: the only place that knows the column names ---------- */

  const COL = {
    paper: 'Test Paper',
    attempt: 'Attempt',
    source: 'Source File',
    number: 'Question Number',
    result: 'Result',
    marked: 'Marked Unsure (#icon-saved)',
    domain: 'Domain',
    question: 'Question',
    correct: 'Correct Answer(s)',
    tip: 'Keyword Tip (Correct Answer)',
    yours: 'Your Answer(s)',
    overall: 'Overall Explanation',
    images: 'Explanation Images',
  };
  const OPTION_COLUMN = /^Option (\d+)$/;
  const RESULT_WRONG = 'Incorrect';
  const RESULT_RIGHT = 'Correct';
  const MARKED_YES = 'Yes';
  const JOIN_ANSWERS = '\n\n';
  const TIP_START = 'Keyword tip:';

  // What each Option N Label means, and so which options are correct.
  const LABELS = new Map([
    ['Your answer is correct', { correct: true, chosen: true }],
    ['Your selection is correct', { correct: true, chosen: true }],
    ['Correct answer', { correct: true, chosen: false }],
    ['Correct selection', { correct: true, chosen: false }],
    ['Your answer is incorrect', { correct: false, chosen: true }],
    ['Your selection is incorrect', { correct: false, chosen: true }],
    ['', { correct: false, chosen: false }],
  ]);

  const STORAGE_ANSWERS = 'wrongQuestionsTest.answers.v1';
  const STORAGE_POSITION = 'wrongQuestionsTest.position.v1';
  const NARROW = window.matchMedia('(max-width: 900px)');

  const DATA = JSON.parse(document.getElementById('csv-data').textContent);

  const state = {
    bank: null,
    answers: {},
    drafts: new Map(),
    paper: null,
    domain: '',
    status: 'all',
    list: [],
    index: 0,
  };

  const $ = (selector) => document.querySelector(selector);
  const naturalOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare;
  const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

  /* ---------- Turning the rows into questions ---------- */

  function hashText(text) {
    let a = 0x811c9dc5;
    let b = 0x1b873593;
    for (let i = 0; i < text.length; i += 1) {
      const code = text.charCodeAt(i);
      a = Math.imul(a ^ code, 0x01000193);
      b = Math.imul(b ^ code, 0x85ebca6b);
    }
    return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
  }

  const baseName = (path) => path.slice(path.lastIndexOf('/') + 1);
  const listImages = (cell) => cell.split('\n').filter(Boolean);

  // Reads one row. Returns the reason instead when the row contradicts itself,
  // so that a bad row is reported rather than tested on a guess.
  function readRow(row, optionNumbers) {
    const options = [];
    for (const n of optionNumbers) {
      const text = row[`Option ${n}`] ?? '';
      const label = row[`Option ${n} Label`] ?? '';
      if (text === '') {
        if (label !== '') return 'a label has no option';
        continue;
      }
      if (!LABELS.has(label)) return `unknown option label "${label}"`;
      options.push({
        text,
        label,
        explanation: row[`Option ${n} Explanation`] ?? '',
        ...LABELS.get(label),
      });
    }
    const correct = options.filter((o) => o.correct);
    const chosen = options.filter((o) => o.chosen);
    if (row[COL.question] === '') return 'no question text';
    if (options.length < 2) return 'fewer than two options';
    if (!correct.length) return 'no option is labelled correct';
    if (new Set(options.map((o) => o.text)).size !== options.length) return 'two options have the same text';
    if (correct.map((o) => o.text).join(JOIN_ANSWERS) !== row[COL.correct]) {
      return `the labels disagree with ${COL.correct}`;
    }
    if (chosen.map((o) => o.text).join(JOIN_ANSWERS) !== row[COL.yours]) {
      return `the labels disagree with ${COL.yours}`;
    }
    const allRight = correct.length === chosen.length && correct.every((o) => o.chosen);
    if (row[COL.result] === RESULT_WRONG && allRight) {
      return `${COL.result} is ${RESULT_WRONG} but the chosen answers are correct`;
    }
    if (row[COL.result] === RESULT_RIGHT && !allRight) {
      return `${COL.result} is ${RESULT_RIGHT} but the chosen answers are not correct`;
    }
    return { options, correct };
  }

  // Rows combine only when everything but the attempt details is identical.
  // Attempts shuffle the options and hold images in their own folders, so option
  // order and image folders are ignored. Any other difference keeps them apart.
  function fingerprintOf(row, options) {
    return JSON.stringify([
      row[COL.paper], row[COL.domain], row[COL.question], row[COL.overall],
      options.map((o) => [o.text, o.correct, o.explanation]).sort((x, y) => (x[0] < y[0] ? -1 : 1)),
      listImages(row[COL.images]).map(baseName),
      row[COL.tip].split(JOIN_ANSWERS).sort(),
    ]);
  }

  function buildBank(files) {
    const problems = [];
    const stats = { files: 0, rows: 0, skippedRows: 0 };
    const merged = new Map();
    const rowFile = new WeakMap();
    const required = Object.values(COL);

    for (const file of [...files].sort((x, y) => naturalOrder(x.name, y.name))) {
      const header = file.table[0] ?? [];
      const missing = required.filter((name) => !header.includes(name));
      const optionNumbers = header
        .map((name) => OPTION_COLUMN.exec(name)?.[1])
        .filter(Boolean)
        .map(Number)
        .sort((x, y) => x - y);
      if (missing.length || !optionNumbers.length) {
        const what = missing.length ? missing.join(', ') : 'Option columns';
        problems.push(`${file.name}: not read, because it has no ${what}.`);
        continue;
      }
      stats.files += 1;

      for (const cells of file.table.slice(1)) {
        stats.rows += 1;
        const row = Object.fromEntries(header.map((name, k) => [name, cells[k] ?? '']));
        const where = `${file.name}, ${row[COL.attempt]}, ${row[COL.number]}`;
        if (cells.length !== header.length) {
          stats.skippedRows += 1;
          problems.push(`${where}: left out, because the row has ${cells.length} cells, not ${header.length}.`);
          continue;
        }
        if (row[COL.result] !== RESULT_WRONG && row[COL.result] !== RESULT_RIGHT) {
          stats.skippedRows += 1;
          problems.push(`${where}: left out, because ${COL.result} is "${row[COL.result]}".`);
          continue;
        }
        const read = readRow(row, optionNumbers);
        if (typeof read === 'string') {
          stats.skippedRows += 1;
          problems.push(`${where}: left out, because ${read}.`);
          continue;
        }
        const print = fingerprintOf(row, read.options);
        const existing = merged.get(print);
        const sameAttempt = (other) => other[COL.attempt] === row[COL.attempt] && other[COL.number] === row[COL.number];
        const earlier = existing?.rows.find(sameAttempt);
        if (earlier) {
          stats.skippedRows += 1;
          problems.push(`${where}: left out, because the same attempt is already in ${rowFile.get(earlier)}.`);
          continue;
        }
        rowFile.set(row, file.name);
        if (existing) {
          existing.rows.push(row);
          existing.marked = existing.marked || row[COL.marked] === MARKED_YES;
          existing.images.forEach((image, k) => image.paths.push(listImages(row[COL.images])[k]));
        } else {
          merged.set(print, {
            key: hashText(print),
            paper: row[COL.paper],
            domain: row[COL.domain],
            text: row[COL.question],
            number: row[COL.number],
            options: read.options,
            multi: read.correct.length > 1 || read.options.some((o) => o.label.includes('selection')),
            tip: row[COL.tip],
            overall: row[COL.overall],
            images: listImages(row[COL.images]).map((path) => ({ paths: [path] })),
            marked: row[COL.marked] === MARKED_YES,
            rows: [row],
          });
        }
      }
    }

    const papers = [...new Set([...merged.values()].map((q) => q.paper))].sort(naturalOrder);
    const paperRank = new Map(papers.map((paper, i) => [paper, i]));
    const firstNumber = (value) => Number(/\d+/.exec(value)?.[0] ?? 0);
    const questions = [...merged.values()].sort((x, y) => (
      paperRank.get(x.paper) - paperRank.get(y.paper)
      || firstNumber(x.rows[0][COL.attempt]) - firstNumber(y.rows[0][COL.attempt])
      || firstNumber(x.number) - firstNumber(y.number)
    ));
    return { questions, papers, stats, problems };
  }

  /* ---------- Saved answers ---------- */

  function readStored(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  function writeStored(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* Everything still works for this visit when the browser blocks storage. */
    }
  }

  function gradeOf(q) {
    const saved = state.answers[q.key];
    if (!Array.isArray(saved) || !saved.length) return null;
    if (saved.some((text) => !q.options.some((o) => o.text === text))) return null;
    const chosen = new Set(saved);
    return { chosen, right: q.options.every((o) => o.correct === chosen.has(o.text)) };
  }

  function statusOf(q) {
    const grade = gradeOf(q);
    if (!grade) return 'unanswered';
    return grade.right ? 'correct' : 'incorrect';
  }

  /* ---------- Building elements: text only ever enters as text nodes ---------- */

  function h(tag, attributes, ...children) {
    const element = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes ?? {})) {
      if (value === false || value === null || value === undefined) continue;
      if (name.startsWith('on')) element.addEventListener(name.slice(2), value);
      else element.setAttribute(name, value === true ? '' : value);
    }
    element.append(...children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false && child !== ''));
    return element;
  }

  function icon(name, className, label) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', className);
    svg.setAttribute('focusable', 'false');
    if (label) {
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', label);
    } else {
      svg.setAttribute('aria-hidden', 'true');
    }
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', `#${name}`);
    svg.append(use);
    return svg;
  }

  const INDENTED = /^[ \t ]+\S/;
  const BLANK = /^[ \t ]*$/;
  const CLOSER = /^[\]})]+[,;]?$/;
  const looksLikeHeaderLine = (line) => line.length < 60 && !/[.:?!,;]$/.test(line);

  // The CSVs keep no record of which lines were a code block, so this picks them
  // out by shape. It decides only how a line looks; the text is never altered.
  function markCode(lines) {
    const indented = lines.map((line) => INDENTED.test(line));
    if (!indented.includes(true)) return indented;
    const code = [...indented];
    indented.forEach((isIndented, i) => {
      if (isIndented && i > 0 && !indented[i - 1]) code[i - 1] = true;
    });
    for (let i = 1; i < lines.length; i += 1) {
      if (code[i - 1] && !code[i] && (CLOSER.test(lines[i]) || BLANK.test(lines[i]))) code[i] = true;
    }
    for (let i = lines.length - 2; i >= 0; i -= 1) {
      if (code[i + 1] && !code[i] && (BLANK.test(lines[i]) || looksLikeHeaderLine(lines[i]))) code[i] = true;
    }
    return code;
  }

  function linkedText(line) {
    const parts = [];
    let last = 0;
    for (const match of line.matchAll(/https?:\/\/[^\s"'<>]+/g)) {
      const url = match[0].replace(/[.,;:)\]]+$/, '');
      parts.push(line.slice(last, match.index));
      parts.push(h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, url));
      last = match.index + url.length;
    }
    parts.push(line.slice(last));
    return parts.filter((part) => part !== '');
  }

  // A keyword tip runs from its first word to the end of the line.
  function lineContent(line) {
    const start = line.indexOf(TIP_START);
    if (start < 0) return linkedText(line);
    return [
      ...linkedText(line.slice(0, start)),
      h('mark', { class: 'keyword-tip', 'data-field': 'keyword-tip-sentence' }, linkedText(line.slice(start))),
    ];
  }

  function richText(value) {
    const lines = value.split('\n');
    const code = markCode(lines);
    const blocks = [];
    for (let i = 0; i < lines.length;) {
      if (code[i]) {
        let end = i;
        while (end < lines.length && code[end]) end += 1;
        blocks.push(h('pre', null, lines.slice(i, end).join('\n')));
        i = end;
      } else {
        blocks.push(h('p', null, lineContent(lines[i])));
        i += 1;
      }
    }
    return blocks;
  }

  function collapsible(className, purpose, title, ...content) {
    return h('details', { class: `collapsible ${className}`, 'data-purpose': purpose },
      h('summary', { class: 'collapsible--summary' },
        h('span', { class: 'ud-heading-md' }, title),
        icon('icon-expand', 'ud-icon ud-icon-medium collapsible--chevron')),
      h('div', { class: 'collapsible--body' }, content));
  }

  /* ---------- Images are held in this page ---------- */

  // The images come after the main script so that the first question shows at once.
  function onceParsed(task) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', task, { once: true });
    else task();
  }

  function imageSource(path) {
    const entry = DATA.images[path];
    return `data:${entry.type};base64,${document.getElementById(`img-${entry.id}`).textContent}`;
  }

  function openImage(source) {
    const viewer = $('#image-viewer');
    $('#image-viewer-scroll').replaceChildren(h('img', { src: source, alt: 'Full-size explanation image' }));
    viewer.showModal();
    $('#image-viewer-close').focus();
  }

  function explanationImage(image) {
    const paths = [...new Set(image.paths)];
    const path = paths.find((candidate) => DATA.images[candidate]);
    if (!path) {
      return h('div', { class: 'image-missing', 'data-field': 'image-missing' }, `Image file not found: ${paths[0]}`);
    }
    const source = imageSource(path);
    return h('span', { class: 'ud-component--base-components--open-full-size-image', 'data-field': 'image', 'data-image-src': paths[0] },
      h('button', {
        class: 'open-full-size-image--wrapper',
        type: 'button',
        'aria-label': 'Open image at full size',
        'data-purpose': 'open-full-size-image',
        onclick: () => openImage(source),
      }, h('img', { src: source, alt: '' })));
  }

  /* ---------- One question pane ---------- */

  function selectionIcon(q, kind, chosen) {
    if (q.multi) {
      if (kind === 'answer-incorrect') return 'icon-wrong-selection';
      return chosen ? 'icon-checkbox-filled' : 'icon-checkbox-empty';
    }
    if (kind === 'answer-incorrect') return 'icon-cancel';
    return chosen ? 'icon-success' : 'icon-radio-empty';
  }

  function resultLabel(q, option, chosen) {
    const noun = q.multi ? 'selection' : 'answer';
    if (option.correct) return chosen ? `Your ${noun} is correct` : `Correct ${noun}`;
    return chosen ? `Your ${noun} is incorrect` : '';
  }

  function resultOption(q, option, grade) {
    const chosen = grade.chosen.has(option.text);
    let kind = 'answer-skipped';
    if (option.correct) kind = 'answer-correct';
    else if (chosen) kind = 'answer-incorrect';
    const label = resultLabel(q, option, chosen);
    return h('div', { class: 'result-pane--answer-result-pane' },
      h('div', { class: `answer-result-pane--${kind}`, 'data-purpose': 'answer' },
        label && h('div', null, h('span', {
          class: `result-pane--answer-by-user-label ud-heading-xs ${option.correct ? 'label-correct' : 'label-incorrect'}`,
          'data-purpose': 'answer-result-header-user-label',
        }, label)),
        h('div', { class: 'answer-result-pane--answer-body', 'data-purpose': 'answer-body' },
          h('span', { class: 'answer-result-pane--answer-selection-icon', 'data-purpose': 'answer-result-body-selection-icon' },
            icon(selectionIcon(q, kind, chosen), 'ud-icon ud-icon-small')),
          h('div', { class: 'ud-heading-md rt-scaffolding answer-text', 'data-field': 'answer-text' }, richText(option.text)))),
      option.explanation && collapsible('answer-result-pane--answer-feedback', 'answer-explanation', 'Explanation',
        h('div', { class: 'ud-text-md rt-scaffolding rich-block', 'data-field': 'question-explanation' }, richText(option.explanation))));
  }

  function answerableOption(q, option, index, panel) {
    const draft = state.drafts.get(q.key) ?? new Set();
    const selected = draft.has(index);
    const emptyIcon = q.multi ? 'icon-checkbox-empty' : 'icon-radio-empty';
    const fullIcon = q.multi ? 'icon-checkbox-filled' : 'icon-radio-filled';
    const input = h('input', {
      class: 'ud-sr-only',
      type: q.multi ? 'checkbox' : 'radio',
      name: `answer-${q.key}`,
      value: index,
      checked: selected,
      onchange: () => updateDraft(q, panel),
    });
    return h('div', { class: 'result-pane--answer-result-pane' },
      h('label', { class: `answer-result-pane--answer-skipped is-answerable${selected ? ' is-selected' : ''}`, 'data-purpose': 'answer' },
        h('div', { class: 'answer-result-pane--answer-body', 'data-purpose': 'answer-body' },
          input,
          h('span', { class: 'answer-result-pane--answer-selection-icon', 'data-purpose': 'answer-result-body-selection-icon', 'data-empty': emptyIcon, 'data-full': fullIcon },
            icon(selected ? fullIcon : emptyIcon, 'ud-icon ud-icon-small')),
          h('div', { class: 'ud-heading-md rt-scaffolding answer-text', 'data-field': 'answer-text' }, richText(option.text)))));
  }

  function updateDraft(q, panel) {
    const inputs = [...panel.querySelectorAll('input')];
    const draft = new Set(inputs.filter((input) => input.checked).map((input) => Number(input.value)));
    state.drafts.set(q.key, draft);
    inputs.forEach((input) => {
      const option = input.closest('[data-purpose="answer"]');
      const iconHolder = option.querySelector('[data-purpose="answer-result-body-selection-icon"]');
      option.classList.toggle('is-selected', input.checked);
      iconHolder.replaceChildren(icon(input.checked ? iconHolder.dataset.full : iconHolder.dataset.empty, 'ud-icon ud-icon-small'));
    });
    panel.querySelector('[data-action="check-answer"]').disabled = draft.size === 0;
  }

  function checkAnswer(q) {
    const draft = state.drafts.get(q.key);
    if (!draft || !draft.size) return;
    state.answers[q.key] = q.options.filter((_, index) => draft.has(index)).map((o) => o.text);
    state.drafts.delete(q.key);
    writeStored(STORAGE_ANSWERS, state.answers);
    renderQuestion();
    $('[data-purpose="question-result-header-status-label"]').focus({ preventScroll: true });
    refreshTabStatus(q);
    refreshCounts();
  }

  function attemptsPane(q) {
    const columns = [COL.attempt, COL.number, COL.result, COL.marked, COL.source];
    return collapsible('related-pane', 'attempts-pane', 'Your earlier attempts',
      q.rows.map((row) => h('div', { class: 'attempt-record', 'data-field': 'attempt-record' },
        h('dl', { class: 'attempt-fields' }, columns.flatMap((name) => [
          h('dt', null, name),
          h('dd', { 'data-column': name }, row[name] ?? ''),
        ])),
        h('div', { class: 'ud-heading-sm pane-heading' }, COL.yours),
        h('div', { class: 'ud-text-md rt-scaffolding rich-block', 'data-field': 'your-answers' }, richText(row[COL.yours])))));
  }

  function overallPane(q) {
    const images = h('div', { class: 'explanation-images' });
    const pane = collapsible('related-pane overall-explanation-pane--overall-explanation', 'overall-explanation-pane', 'Overall explanation',
      h('div', { class: 'ud-text-md rt-scaffolding rich-block', 'data-field': 'overall-explanation' }, richText(q.overall)),
      images);
    pane.addEventListener('toggle', () => {
      if (pane.open && !images.childElementCount) {
        onceParsed(() => images.replaceChildren(...q.images.map(explanationImage)));
      }
    });
    return pane;
  }

  function relatedFields(q) {
    return h('div', { class: 'result-pane--question-related-fields' },
      q.tip && h('div', { class: 'related-pane related-pane--open', 'data-purpose': 'tip-pane' },
        h('div', { class: 'ud-heading-md pane-heading' }, COL.tip),
        h('div', { class: 'ud-text-md rt-scaffolding rich-block', 'data-field': 'keyword-tip' }, richText(q.tip))),
      overallPane(q),
      h('div', { class: 'related-pane related-pane--open domain-pane--domain-pane', 'data-purpose': 'domain-pane' },
        h('div', { class: 'ud-heading-md pane-heading' }, 'Domain'),
        h('div', { class: 'ud-text-md', 'data-field': 'domain' }, q.domain)),
      attemptsPane(q));
  }

  const STATUS_ICONS = { unanswered: 'icon-radio-empty', correct: 'icon-success', incorrect: 'icon-error' };
  const STATUS_WORDS = { unanswered: 'Not answered', correct: 'Correct', incorrect: 'Incorrect' };

  function questionPane(q) {
    const grade = gradeOf(q);
    const status = statusOf(q);
    const wrapper = h('div', { class: 'result-pane--question-result-pane-wrapper', 'data-question-key': q.key });
    const panel = h('div', { class: 'result-pane--question-result-pane result-pane--accordion-panel' });

    panel.append(h('div', { class: 'result-pane--question-header-wrapper' },
      h('div', { class: 'result-pane--question-header' },
        h('span', { class: 'result-pane--pane-title ud-heading-md' },
          h('span', { class: 'result-pane--answer-status-icon', 'data-purpose': 'question-result-header-status-icon' },
            h('span', { class: 'result-pane--question-icon-background', 'data-purpose': 'question-result-header-status-icon-background' },
              icon(STATUS_ICONS[status], `ud-icon ud-icon-medium status-${status}`))),
          h('span', { 'data-field': 'question-number' }, q.number),
          grade && h('span', {
            class: `status-label-${status}`,
            'data-purpose': 'question-result-header-status-label',
            tabindex: '-1',
            'aria-live': 'polite',
          }, grade.right ? 'Correct' : 'Incorrect'),
          q.marked && icon('icon-saved', 'ud-icon ud-icon-medium ud-icon-color-warning result-pane--star-rating-icon', COL.marked)),
        h('div', { class: 'result-pane--paper-caption', 'data-field': 'test-paper' }, q.paper),
        h('div', { class: 'result-pane--question-format ud-text-md rt-scaffolding', 'data-field': 'question-prompt' }, richText(q.text)))));

    const content = h('div', { class: 'result-pane--question-result-pane-expanded-content' });
    if (grade) {
      content.append(...q.options.map((option) => resultOption(q, option, grade)), relatedFields(q));
    } else {
      const draft = state.drafts.get(q.key);
      content.append(
        ...q.options.map((option, index) => answerableOption(q, option, index, panel)),
        h('div', { class: 'answer-actions' }, h('button', {
          class: 'ud-btn ud-btn-medium ud-btn-primary',
          type: 'button',
          'data-action': 'check-answer',
          disabled: !draft || !draft.size,
          onclick: () => checkAnswer(q),
        }, 'Check answer')),
      );
    }
    panel.append(content);
    wrapper.append(panel);
    return wrapper;
  }

  /* ---------- Moving between questions ---------- */

  function renderQuestion() {
    const q = state.list[state.index];
    $('#question-view').replaceChildren(...(q ? [questionPane(q)] : []));
    $('#empty-state').hidden = Boolean(q);
    const previous = $('#previous');
    const next = $('#next');
    const focusWasOn = document.activeElement;
    previous.disabled = state.index === 0 || !q;
    next.disabled = state.index >= state.list.length - 1;
    if (focusWasOn === previous && previous.disabled && !next.disabled) next.focus();
    if (focusWasOn === next && next.disabled && !previous.disabled) previous.focus();
    $('#position').textContent = q ? `${state.index + 1} / ${state.list.length}` : '0 / 0';
    showCurrentTab();
  }

  function goTo(index) {
    if (index < 0 || index >= state.list.length) return;
    state.index = index;
    writeStored(STORAGE_POSITION, state.list[index].key);
    renderQuestion();
    window.scrollTo(0, 0);
  }

  function chooseTab(index) {
    goTo(index);
    if (NARROW.matches) {
      closePanels();
      $('#question-view').focus({ preventScroll: true });
    }
  }

  /* ---------- The question tabs and filters ---------- */

  const inPaper = (q) => state.paper === null || q.paper === state.paper;
  const inScope = (q) => inPaper(q) && (state.domain === '' || q.domain === state.domain);
  const matchesStatus = (q, status) => {
    if (status === 'all') return true;
    if (status === 'marked') return q.marked;
    return statusOf(q) === status;
  };

  function statusIcon(q) {
    const status = statusOf(q);
    return icon(STATUS_ICONS[status], `ud-icon ud-icon-small status-${status}`, STATUS_WORDS[status]);
  }

  function questionTab(q, index) {
    return h('button', {
      class: 'question-tab',
      type: 'button',
      'data-position': index,
      'data-question-key': q.key,
      onclick: () => chooseTab(index),
    },
    h('span', { class: 'question-tab--status', 'data-role': 'status' }, statusIcon(q)),
    h('span', { class: 'question-tab--body' },
      h('span', { class: 'question-tab--meta' },
        h('span', { 'data-field': 'tab-number' }, q.number),
        h('span', { 'data-field': 'tab-attempt' }, q.rows[0][COL.attempt]),
        q.marked && icon('icon-saved', 'ud-icon ud-icon-xsmall ud-icon-color-warning', COL.marked)),
      h('span', { class: 'question-tab--front', 'data-field': 'tab-front' }, q.text)));
  }

  function renderTabs() {
    const items = [];
    let paper = null;
    state.list.forEach((q, index) => {
      if (q.paper !== paper) {
        paper = q.paper;
        items.push(h('li', { class: 'question-tabs--group', 'data-field': 'tab-group' }, paper));
      }
      items.push(h('li', null, questionTab(q, index)));
    });
    $('#question-tabs').replaceChildren(...items);
  }

  function showCurrentTab() {
    for (const tab of document.querySelectorAll('.question-tab[aria-current]')) tab.removeAttribute('aria-current');
    const tab = document.querySelector(`.question-tab[data-position="${state.index}"]`);
    if (!tab) return;
    tab.setAttribute('aria-current', 'true');
    if (!$('#question-panel').hidden) tab.scrollIntoView({ block: 'nearest' });
  }

  function refreshTabStatus(q) {
    const holder = document.querySelector(`.question-tab[data-question-key="${q.key}"] [data-role="status"]`);
    if (holder) holder.replaceChildren(statusIcon(q));
  }

  // The list is fixed until a filter changes, so a question stays put once answered.
  function applyFilters() {
    const current = state.list[state.index];
    state.list = state.bank.questions.filter((q) => inScope(q) && matchesStatus(q, state.status));
    state.index = Math.max(state.list.indexOf(current), 0);
    renderTabs();
    renderQuestion();
    hideRetakeConfirm();
    refreshCounts();
    if (state.list.length) writeStored(STORAGE_POSITION, state.list[state.index].key);
    window.scrollTo(0, 0);
  }

  function renderDomains() {
    const pool = state.bank.questions.filter(inPaper);
    const domains = [...new Set(pool.map((q) => q.domain))].sort(naturalOrder);
    if (!domains.includes(state.domain)) state.domain = '';
    $('#domain-filter').replaceChildren(
      h('option', { value: '' }, 'All domains'),
      ...domains.map((domain) => h('option', { value: domain }, domain)),
    );
    $('#domain-filter').value = state.domain;
  }

  function renderStatusPills() {
    const pills = [['all', 'all'], ['correct', 'correct'], ['incorrect', 'incorrect'], ['unanswered', 'unanswered'], ['marked', 'marked']];
    $('#status-filter').replaceChildren(...pills.map(([status, word]) => h('li', null,
      h('label', null,
        h('input', {
          class: 'pill-input ud-sr-only',
          type: 'radio',
          name: 'status-filter',
          value: status,
          checked: state.status === status,
          onchange: () => {
            state.status = status;
            applyFilters();
          },
        }),
        h('span', { class: 'pill', 'data-status': status, 'data-word': word }, '')))));
  }

  function renderPapers() {
    const items = [null, ...state.bank.papers];
    $('#paper-list').replaceChildren(...items.map((paper) => {
      const title = paper ?? 'All test papers';
      return h('li', { class: `curriculum-item-link--curriculum-item${paper === state.paper ? ' is-current' : ''}` },
        h('button', {
          class: 'item-link',
          type: 'button',
          'data-paper': title,
          'aria-current': paper === state.paper ? 'true' : null,
          onclick: () => selectPaper(paper),
        },
        h('span', { class: 'ud-fake-toggle-checkbox', 'data-role': 'complete' }),
        h('span', { class: 'curriculum-item-link--item-container' },
          h('span', { 'data-purpose': 'item-title' }, title),
          h('span', { class: 'curriculum-item-link--meta', 'data-role': 'progress' }, ''))));
    }));
  }

  function refreshPapers() {
    [...$('#paper-list').children].forEach((item, i) => {
      const paper = i === 0 ? null : state.bank.papers[i - 1];
      const pool = state.bank.questions.filter((q) => paper === null || q.paper === paper);
      const answered = pool.filter((q) => gradeOf(q)).length;
      const box = item.querySelector('[data-role="complete"]');
      const complete = pool.length > 0 && answered === pool.length;
      box.classList.toggle('is-complete', complete);
      box.replaceChildren(...(complete ? [icon('icon-tick', 'ud-icon')] : []));
      item.querySelector('[data-role="progress"]').textContent = `${answered} of ${plural(pool.length, 'question')} answered`;
    });
  }

  function refreshCounts() {
    const scoped = state.bank.questions.filter(inScope);
    for (const pill of document.querySelectorAll('.pill')) {
      const { status, word } = pill.dataset;
      const count = scoped.filter((q) => matchesStatus(q, status)).length;
      pill.textContent = `${count} ${word}`;
      pill.previousElementSibling.disabled = count === 0 && state.status !== status;
    }
    const answered = scoped.filter((q) => gradeOf(q)).length;
    $('#progress').textContent = `${answered} of ${plural(scoped.length, 'question')} answered`;
    $('#list-title').textContent = plural(state.list.length, 'question');
    $('#retake').disabled = !state.list.some((q) => gradeOf(q));
    refreshPapers();
  }

  function renderSource() {
    const { stats, questions, problems } = state.bank;
    const parts = [plural(stats.files, 'CSV file'), plural(stats.rows, 'row'), plural(questions.length, 'question')];
    if (stats.skippedRows) parts.push(`${stats.skippedRows} could not be used`);
    $('#source-line').textContent = parts.join(', ');
    const box = $('#problems');
    box.hidden = problems.length === 0;
    box.replaceChildren(
      h('strong', null, `${plural(problems.length, 'problem')} found in the CSV data`),
      h('ul', null, problems.map((problem) => h('li', null, problem))),
    );
  }

  function selectPaper(paper) {
    state.paper = paper;
    [...$('#paper-list').children].forEach((item, i) => {
      const current = (i === 0 ? null : state.bank.papers[i - 1]) === paper;
      item.classList.toggle('is-current', current);
      const button = item.querySelector('.item-link');
      if (current) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    });
    renderDomains();
    applyFilters();
    if (NARROW.matches) {
      closePanels();
      $('#question-view').focus({ preventScroll: true });
    }
  }

  function showRetakeConfirm() {
    const count = state.list.filter((q) => gradeOf(q)).length;
    $('#retake-question').textContent = `Clear your ${plural(count, 'answer')} for the listed questions?`;
    $('#retake-confirm').hidden = false;
    $('#retake').hidden = true;
    $('#retake-no').focus();
  }

  function hideRetakeConfirm() {
    $('#retake-confirm').hidden = true;
    $('#retake').hidden = false;
  }

  function retake() {
    state.list.forEach((q) => {
      delete state.answers[q.key];
      state.drafts.delete(q.key);
    });
    writeStored(STORAGE_ANSWERS, state.answers);
    if (state.status === 'correct' || state.status === 'incorrect') state.status = 'unanswered';
    renderStatusPills();
    applyFilters();
  }

  /* ---------- The side panels: closed until asked for ---------- */

  const PANELS = {
    questions: { panel: '#question-panel', toggle: '#toggle-questions', close: '#close-questions' },
    papers: { panel: '#sidebar', toggle: '#toggle-papers', close: '#close-papers' },
  };

  const openPanels = () => Object.keys(PANELS).filter((name) => !$(PANELS[name].panel).hidden);

  function setPanel(name, open) {
    const { panel, toggle } = PANELS[name];
    $(panel).hidden = !open;
    $(toggle).setAttribute('aria-expanded', String(open));
    const anyOpen = openPanels().length > 0;
    document.body.classList.toggle('panel-open', anyOpen);
    $('#panel-scrim').hidden = !anyOpen;
  }

  function togglePanel(name) {
    const open = $(PANELS[name].panel).hidden;
    if (open && NARROW.matches) closePanels();
    setPanel(name, open);
    if (open) {
      $(PANELS[name].close).focus({ preventScroll: true });
      if (name === 'questions') showCurrentTab();
    }
  }

  function closePanel(name) {
    setPanel(name, false);
    $(PANELS[name].toggle).focus({ preventScroll: true });
  }

  function closePanels() {
    openPanels().forEach((name) => setPanel(name, false));
  }

  /* ---------- Start ---------- */

  function start() {
    state.bank = buildBank(DATA.files);
    state.answers = readStored(STORAGE_ANSWERS, {});
    state.list = state.bank.questions;
    const saved = readStored(STORAGE_POSITION, null);
    state.index = Math.max(state.list.findIndex((q) => q.key === saved), 0);
    renderPapers();
    renderDomains();
    renderStatusPills();
    renderSource();
    renderTabs();
    renderQuestion();
    refreshCounts();
  }

  $('#toggle-questions').addEventListener('click', () => togglePanel('questions'));
  $('#toggle-papers').addEventListener('click', () => togglePanel('papers'));
  $('#close-questions').addEventListener('click', () => closePanel('questions'));
  $('#close-papers').addEventListener('click', () => closePanel('papers'));
  $('#panel-scrim').addEventListener('click', closePanels);
  $('#previous').addEventListener('click', () => goTo(state.index - 1));
  $('#next').addEventListener('click', () => goTo(state.index + 1));
  $('#domain-filter').addEventListener('change', (event) => {
    state.domain = event.target.value;
    applyFilters();
  });
  $('#retake').addEventListener('click', showRetakeConfirm);
  $('#retake-no').addEventListener('click', () => {
    hideRetakeConfirm();
    $('#retake').focus();
  });
  $('#retake-yes').addEventListener('click', retake);
  $('#image-viewer-close').addEventListener('click', () => $('#image-viewer').close());
  $('#image-viewer').addEventListener('click', (event) => {
    if (event.target.id === 'image-viewer' || event.target.id === 'image-viewer-scroll') $('#image-viewer').close();
  });
  NARROW.addEventListener('change', (event) => {
    if (event.matches) closePanels();
  });
  document.addEventListener('keydown', (event) => {
    if ($('#image-viewer').open || event.altKey || event.ctrlKey || event.metaKey) return;
    const panelCoversPage = NARROW.matches && openPanels().length > 0;
    if (event.key === 'Escape' && panelCoversPage) closePanel(openPanels()[0]);
    if (panelCoversPage || event.target.closest('input, select, textarea')) return;
    if (event.key === 'ArrowLeft') goTo(state.index - 1);
    if (event.key === 'ArrowRight') goTo(state.index + 1);
  });

  start();
})();
