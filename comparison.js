(() => {
  'use strict';
  // Restoring an old pixel offset can override a link's anchor after panels change size.
  history.scrollRestoration = 'manual';
  const data = JSON.parse(document.getElementById('comparison-data').textContent);
  const models = new Map(data.models.map(row => [row.arm, row]));
  const checks = [...document.querySelectorAll('[data-filter-arm]')];
  const pricing = document.getElementById('price-view');
  const estimates = document.getElementById('show-estimates');
  const defaultTheme = themeSelect.value;
  const tables = [...document.querySelectorAll('.comparison-table')];
  const marks = [...document.querySelectorAll('svg [data-arm]')];
  let highlighted = null;
  let restoring = true;
  let sharedScenario = null;
  const slug = text => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const usesCharge = row => pricing.value === 'charged' && row.provider_charged_usd != null;
  const price = row => usesCharge(row) ? Number(row.provider_charged_usd) : row.current_cost;
  function visible(arm) {
    return checks.find(c => c.dataset.filterArm === arm)?.checked;
  }
  function field(row, key) {
    if (key === 'cost') return price(row);
    if (key === 'time') return row.active_minutes;
    if (key === 'reviews') return row.candidate_reviews;
    return row[key];
  }
  function numeric(text) {
    const match = text.replace(/,/g, '').match(/[-+]?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : Infinity;
  }
  function sortTable(table, column, direction) {
    const rows = [...table.tBodies[0].rows];
    const header = table.tHead.rows[0].cells[column];
    const key = header.dataset.sort;
    const value = tr => {
      const row = models.get(tr.dataset.arm);
      if (table.dataset.grouped) return price(row);
      if (key && row) return field(row, key);
      const text = tr.cells[column]?.textContent.trim() || '';
      return column === 0 ? text : numeric(text);
    };
    rows.sort((a, b) => {
      const x = value(a), y = value(b);
      // Missing values remain at the end, in either direction.
      if (x === Infinity || y === Infinity) return x === y ? 0 : x === Infinity ? 1 : -1;
      return (typeof x === 'string' ? x.localeCompare(y) : x - y) * direction;
    });
    rows.forEach(row => table.tBodies[0].append(row));
    [...table.tHead.rows[0].cells].forEach(h => h.removeAttribute('aria-sort'));
    header.setAttribute('aria-sort', direction === 1 ? 'ascending' : 'descending');
    table.dataset.column = column;
    table.dataset.direction = direction;
  }
  tables.forEach(table => {
    table.dataset.viewKey = table.closest('[id]').id + '-' + (table.tHead.rows[0].cells[1].dataset.sort || slug(table.tHead.rows[0].cells[1].textContent));
    [...table.tHead.rows[0].cells].forEach(h => h.dataset.viewSortKey = h.dataset.sort || slug(h.textContent));
    if (table.dataset.grouped) return; // Stage sequence is useful; do not sort individual stages.
    [...table.tHead.rows[0].cells].forEach((header, index) => {
      // Keep categorical check outcomes intact; sort model or explicitly named measures.
      if (table.closest('#quality') && index > 1) return;
      if (!header.dataset.sort && index > 0 && !header.classList.contains('num')) return;
      const label = header.textContent;
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = label;
      button.setAttribute('aria-label', 'Sort by ' + label);
      header.replaceChildren(button);
      button.addEventListener('click', () => {
        const direction = header.getAttribute('aria-sort') === 'ascending' ? -1 : 1;
        sortTable(table, index, direction);
        queueURL();
      });
    });
    const first = table.dataset.defaultSort ? [...table.tHead.rows[0].cells].findIndex(h => h.dataset.sort === table.dataset.defaultSort) : [...table.tHead.rows[0].cells].findIndex(h => /cost/i.test(h.textContent));
    if (first >= 0) sortTable(table, first, table.dataset.defaultSort === 'quality' ? -1 : 1);
  });
  const defaultSorts = tables.map(table => ({column:table.dataset.column, direction:table.dataset.direction, rows:[...table.tBodies[0].rows]}));
  function highlight(arm) {
    highlighted = highlighted === arm ? null : arm;
    marks.forEach(n => {
      n.classList.toggle('model-muted', Boolean(highlighted && n.dataset.arm !== highlighted));
      n.classList.toggle('model-highlight', n.dataset.arm === highlighted);
    });
    queueURL();
  }
  marks.filter(n => ['text','circle','path'].includes(n.tagName.toLowerCase())).forEach(n => {
    n.tabIndex = 0; n.setAttribute('role', 'button');
    n.setAttribute('aria-label', 'Highlight ' + models.get(n.dataset.arm).model);
    n.addEventListener('click', () => highlight(n.dataset.arm));
    n.addEventListener('keydown', e => {if (e.key === 'Enter' || e.key === ' ') {e.preventDefault(); highlight(n.dataset.arm);}});
  });
  document.addEventListener('keydown', e => {if (e.key === 'Escape') {highlighted = null; sharedScenario = null; marks.forEach(n => n.classList.remove('model-muted', 'model-highlight')); showScenarioNote(); queueURL();}});
  const scatters = [...document.querySelectorAll('#snapshot svg, #quality svg')];
  scatters.forEach(svg => {
    svg.dataset.priceChart = 'true';
    [...svg.children].forEach(n => {
      if (!n.dataset.arm) return;
      n.dataset.originalTransform = n.getAttribute('transform') || '';
      const title = n.querySelector('title');
      if (title) n.dataset.originalTitle = title.textContent;
    });
  });
  const moneyCells = [...document.querySelectorAll('[data-price-arm]')];
  moneyCells.forEach(cell => cell.dataset.originalHtml = cell.innerHTML);
  const priceHeadings = [...document.querySelectorAll('[data-price-heading]')];
  priceHeadings.forEach(n => n.dataset.originalHeading = n.textContent);
  const costPhases = [...document.querySelectorAll('svg[data-packed]')].find(svg => /usage cost/.test(svg.getAttribute('aria-label')));
  const humanChart = document.querySelector('.human-curve').closest('svg');
  const curves = [...humanChart.querySelectorAll('.human-curve')];
  curves.forEach(curve => {
    curve.dataset.originalSaving = curve.dataset.saving;
    curve.dataset.viewKey = curve.dataset.arm + (curve.dataset.estimated === 'true' ? '-fast' : curve.dataset.model.includes('current pricing') ? '-current' : '');
  });
  const humanLegend = curves.map(curve => {
    const line = curve.nextElementSibling, name = line.nextElementSibling, amount = name.nextElementSibling;
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    line.before(group); group.append(line, name, amount);
    return {curve, group, y:Number(name.getAttribute('y'))};
  });
  const baselineLegend = humanLegend.at(-1).group.nextElementSibling;
  const baselineParts = [baselineLegend, baselineLegend.nextElementSibling, baselineLegend.nextElementSibling.nextElementSibling];
  const originalBaselineY = Number(baselineLegend.getAttribute('y1'));
  const priceCharts = [...scatters, costPhases, humanChart];
  priceCharts.forEach((svg,index) => {
    const figure = svg.closest('figure');
    if (!figure.id) figure.id = ['cost-time','cost-quality','phase-cost','human-cost-figure'][index];
    const note = document.createElement('p');
    note.className = 'price-mode-note small'; note.hidden = true;
    note.textContent = 'Neuralwatt: recorded charges. Dimmed models: token-price estimates, not subscription bills.';
    if (svg === humanChart) note.textContent += ' Luna 6 high remains a $0.92 token-price reference.';
    svg.after(note);
  });
  const priceTargets = [...priceCharts.filter(svg => !svg.closest('#snapshot')), ...new Set(moneyCells.map(cell => cell.closest('table')))];
  priceTargets.forEach(target => {
    if (target.closest('#snapshot')) return;
    const toolbar = document.createElement('div'); toolbar.className = 'price-toolbar comparison-toolbar';
    const label = document.createElement('label'); label.append('Pricing view ');
    const select = pricing.cloneNode(true); select.removeAttribute('id'); select.dataset.priceControl = 'true';
    label.append(select); toolbar.append(label);
    const copy = document.createElement('button'); copy.type = 'button'; copy.dataset.copyView = 'true'; copy.textContent = target === humanChart ? 'Copy link to this scenario' : 'Copy link to this view';
    toolbar.append(copy);
    (target.tagName.toLowerCase() === 'table' ? target.closest('.table-wrap') || target : target).before(toolbar);
    select.addEventListener('change', () => {pricing.value = select.value; update(); queueURL();});
  });
  const scenarioNote = document.createElement('p'); scenarioNote.className = 'scenario-note small'; scenarioNote.hidden = true;
  const scenarioText = document.createElement('span');
  const scenarioButton = document.createElement('button'); scenarioButton.type = 'button'; scenarioButton.textContent = 'Show comparison';
  scenarioNote.append(scenarioText, ' ', scenarioButton); humanChart.after(scenarioNote);
  function showScenarioNote() {
    scenarioNote.hidden = !sharedScenario;
    if (sharedScenario) scenarioText.textContent = 'Linked scenario: ' + durationLabel(sharedScenario.minutes) + ' of human time saved at $' + sharedScenario.rate.toFixed(2) + '/hour.';
  }
  scenarioButton.addEventListener('click', () => {
    const box = humanChart.getBoundingClientRect();
    showHumanTooltip(sharedScenario.minutes, sharedScenario.rate, curves.find(c => c.dataset.viewKey === sharedScenario.curve) || null, box.left, box.top);
  });
  const mixedNote = 'Neuralwatt: recorded charges. Dimmed models: token-price estimates, not subscription bills.';
  function extraCost(arm, originalSaving) {
    const row = models.get(arm);
    return usesCharge(row) ? price(row) - models.get(data.baseline).current_cost : Number(originalSaving);
  }
  function update() {
    const mixed = pricing.value === 'charged';
    const selected = [...models.keys()].filter(visible);
    if (highlighted && !selected.includes(highlighted)) {
      highlighted = null;
      marks.forEach(n => n.classList.remove('model-muted', 'model-highlight'));
    }
    document.getElementById('selection-count').textContent = selected.length + ' of ' + models.size + ' configurations';
    marks.forEach(n => {
      const show = visible(n.dataset.arm) && (!n.dataset.estimate || estimates.checked);
      n.style.display = show ? '' : 'none';
      if (n.dataset.estimate && show) n.style.display = 'inline';
      const onPriceChart = priceCharts.includes(n.closest('svg'));
      n.classList.toggle('price-estimate', mixed && onPriceChart && !usesCharge(models.get(n.dataset.arm)) && !n.parentElement.closest('[data-arm]'));
    });
    moneyCells.forEach(cell => {
      const charged = mixed && cell.dataset.charge != null;
      const amount = charged ? cell.dataset.charge : cell.dataset.tariff;
      cell.classList.toggle('price-estimate', mixed && !charged);
      cell.innerHTML = mixed ? (amount == null ? 'Unknown' : '$' + Number(amount).toFixed(Number(cell.dataset.precision))) + '<br><span class="small">' + (charged ? 'charged' : 'token estimate') + '</span>' : cell.dataset.originalHtml;
    });
    priceHeadings.forEach(n => n.textContent = mixed ? 'Cost · selected basis' : n.dataset.originalHeading);
    tables.forEach(table => {
      [...table.tBodies[0].rows].forEach(tr => {tr.hidden = !visible(tr.dataset.arm);});
      if (table.dataset.column) sortTable(table, Number(table.dataset.column), Number(table.dataset.direction));
      if (table.dataset.grouped) sortTable(table, 0, 1);
    });
    const overview = document.querySelector('#snapshot .comparison-table');
    overview.tHead.rows[0].cells[1].querySelector('button').textContent = mixed ? 'Cost · selected basis' : 'Token-price cost';
    overview.tHead.rows[0].cells[1].querySelector('button').setAttribute('aria-label', 'Sort by ' + (mixed ? 'Cost · selected basis' : 'Token-price cost'));
    // Retain the same dollar axis when switching prices; only observed cost positions move.
    scatters.forEach(svg => {
      [...svg.children].forEach(n => {
        const row = models.get(n.dataset.arm);
        if (!row) return;
        const delta = usesCharge(row) ? (price(row) - row.cost) / 60 * 790 : 0;
        n.setAttribute('transform', n.dataset.originalTransform + (delta ? ` translate(${delta} 0)` : ''));
        if (n.dataset.originalTitle) n.querySelector('title').textContent = usesCharge(row) ? n.dataset.originalTitle.replace(/\$\d+\.\d{2}/, '$' + price(row).toFixed(2) + ' charged') : n.dataset.originalTitle + (mixed ? ' · token estimate' : '');
      });
      [...svg.querySelectorAll('text')].filter(n => n.textContent === 'Cost at stated token tariffs' || n.textContent === 'Cost · charges and token estimates').forEach(n => {n.textContent = mixed ? 'Cost · charges and token estimates' : 'Cost at stated token tariffs';});
    });
    [...costPhases.children].filter(n => n.dataset.arm).forEach(group => {
      const row = models.get(group.dataset.arm);
      let x = 330, total = 0;
      [...group.querySelectorAll('rect')].forEach((rect, index) => {
        const phase = ['initial', 'review', 'correction', 'final'][index];
        const amount = row.phase_prices[phase][usesCharge(row) ? 'charged' : 'tariff'];
        const width = amount / 60 * 550;
        rect.setAttribute('x', x); rect.setAttribute('width', width);
        rect.querySelector('title').textContent = phase + ': $' + amount.toFixed(3) + (mixed ? usesCharge(row) ? ' charged' : ' token estimate' : '');
        x += width; total += amount;
      });
      const label = [...group.querySelectorAll('text')].at(-1);
      label.setAttribute('x', x + 10); label.textContent = '$' + total.toFixed(2);
    });
    document.querySelectorAll('svg[data-packed]').forEach(svg => {
      let index = 0;
      const step = Number(svg.dataset.step);
      [...svg.children].filter(n => n.dataset.arm).sort((a, b) => svg.dataset.order === 'time' ? models.get(a.dataset.arm).active_minutes - models.get(b.dataset.arm).active_minutes : price(models.get(a.dataset.arm)) - price(models.get(b.dataset.arm))).forEach(n => {
        if (visible(n.dataset.arm)) n.setAttribute('transform', `translate(0 ${Number(svg.dataset.firstY) + index++ * step - Number(n.dataset.baseY)})`);
      });
      const original = Number(svg.dataset.originalHeight);
      const height = original - (models.size - index) * step;
      svg.setAttribute('viewBox', `0 0 1040 ${height}`);
      svg.setAttribute('height', height);
      svg.querySelector('[data-chart-footer]').setAttribute('transform', `translate(0 ${height - original})`);
      svg.querySelector('rect').setAttribute('height', height);
    });
    curves.forEach(curve => {
      const saving = extraCost(curve.dataset.arm, curve.dataset.originalSaving);
      curve.dataset.saving = saving;
      curve.dataset.priceBasis = usesCharge(models.get(curve.dataset.arm)) ? 'charged' : 'tariff';
      const first = saving * 60 / 200;
      const minutes = [first, ...Array.from({length:240}, (_,i) => (i+1)/4).filter(m => m > first)];
      curve.querySelector('polyline').setAttribute('points', minutes.map(m => `${(100+m/60*610).toFixed(3)},${(580-saving*60/m/200*435).toFixed(3)}`).join(' '));
      curve.setAttribute('aria-label', curve.dataset.model + ': $' + saving.toFixed(2) + ' more than Luna 6 high. ' + (mixed ? curve.dataset.priceBasis === 'charged' ? 'Neuralwatt charge versus Luna token estimate.' : 'Token-price estimates.' : 'Token-price estimates.') + ' Use arrow keys to compare human time saved and hourly cost.');
    });
    humanChart.querySelectorAll('text[data-original-saving]').forEach(n => {
      n.textContent = (n.dataset.estimate ? '~' : '') + '$' + extraCost(n.dataset.arm, n.dataset.originalSaving).toFixed(2) + ' more on AI';
    });
    const legends = humanLegend.filter(item => item.curve.style.display !== 'none').sort((a,b) => Number(b.curve.dataset.saving) - Number(a.curve.dataset.saving));
    legends.forEach((item,index) => item.group.setAttribute('transform', `translate(0 ${190+index*43-item.y})`));
    baselineParts.forEach(n => n.setAttribute('transform', `translate(0 ${190+legends.length*43+12-originalBaselineY})`));
    document.querySelectorAll('.price-mode-note').forEach(n => n.hidden = !mixed);
    const status = document.getElementById('price-basis-status');
    status.hidden = !mixed; status.textContent = mixedNote;
    const note = document.getElementById('pricing-note');
    note.textContent = mixed ? mixedNote + ' Sorting, phase costs and the human-time chart follow these amounts. The Luna reference is still a token estimate. Historical figures in the article and evidence remain unchanged.' : 'Token tariffs compare the recorded workload at the stated rates. They are not subscription invoices or measured allowance consumption. Sonnet uses current prices; its original point stays visible. Model summaries show route-specific charges and conditions.';
    hideHumanTooltip();
    document.querySelectorAll('[data-price-control]').forEach(select => select.value = pricing.value);
  }
  const changed = () => {update(); queueURL();};
  checks.forEach(c => c.addEventListener('change', changed));
  pricing.addEventListener('change', changed);
  estimates.addEventListener('change', changed);
  document.getElementById('show-all-models').addEventListener('click', () => {checks.forEach(c => c.checked = true); changed();});
  document.getElementById('hide-all-models').addEventListener('click', () => {checks.forEach(c => c.checked = false); changed();});
  function openHash() {
    let id;
    try {id = decodeURIComponent(location.hash.slice(1));} catch {return;}
    const target = document.getElementById(id);
    if (!target) return;
    let parent = target;
    while (parent) {
      if (parent.tagName === 'DETAILS') parent.open = true;
      parent = parent.parentElement;
    }
    if (target.classList.contains('model-profile') && document.body.classList.contains('reading-quick')) {
      document.body.classList.remove('reading-quick');
      document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode !== 'quick' && b.dataset.mode !== 'full')));
    }
    requestAnimationFrame(() => target.scrollIntoView({block:'start'}));
  }
  // Stable names let links survive table sorting and opening nested model summaries.
  const disclosures = [...document.querySelectorAll('details')];
  disclosures.forEach(details => {
    if (!details.id) {
      const context = details.parentElement.closest('section[id],details[id],div[id],footer[id]')?.id || 'report';
      details.id = context + '-' + slug(details.querySelector(':scope > summary').textContent);
    }
    details.addEventListener('toggle', () => queueURL());
  });
  const scrollTables = [...document.querySelectorAll('.table-wrap')];
  scrollTables.forEach((wrapper,index) => {
    wrapper.dataset.viewKey = wrapper.querySelector('table').dataset.viewKey || wrapper.closest('[id]').id + '-table-' + index;
    wrapper.addEventListener('scroll', () => {if (!restoring) history.replaceState(null,'',viewURL());}, {passive:true});
  });
  const readingMode = () => document.body.classList.contains('reading-quick') ? 'quick' : document.querySelector('[data-mode="full"]').getAttribute('aria-pressed') === 'true' ? 'full' : 'read';
  function viewURL() {
    const url = new URL(location.href), p = url.searchParams;
    ['price','models','fast','highlight','sort','open','read','theme','human','tables'].forEach(key => p.delete(key));
    if (pricing.value !== 'tariff') p.set('price', pricing.value);
    const selected = checks.filter(c => c.checked).map(c => c.dataset.filterArm);
    if (selected.length !== models.size) p.set('models', selected.join(',') || 'none');
    if (estimates.checked) p.set('fast', '1');
    if (highlighted) p.set('highlight', highlighted);
    const sorts = tables.flatMap((table,index) => {
      if (table.dataset.grouped || (table.dataset.column === defaultSorts[index].column && table.dataset.direction === defaultSorts[index].direction)) return [];
      return table.dataset.column == null ? [] : [table.dataset.viewKey + ':' + table.tHead.rows[0].cells[Number(table.dataset.column)].dataset.viewSortKey + ':' + (table.dataset.direction === '1' ? 'asc' : 'desc')];
    });
    if (sorts.length) p.set('sort', sorts.join(','));
    const mode = readingMode(); if (mode !== 'read') p.set('read', mode);
    // Encode only differences from the reading mode, keeping full-report links short.
    const panels = disclosures.flatMap(d => d.open === (mode === 'full' && !d.matches('.model-profile,.filter-list')) ? [] : [(d.open ? '' : '-') + d.id]);
    if (panels.length) p.set('open', panels.join(','));
    p.set('theme', themeSelect.value);
    if (sharedScenario) p.set('human', [sharedScenario.minutes,sharedScenario.rate,sharedScenario.curve].join(','));
    const offsets = scrollTables.filter(w => w.scrollLeft > 1 && w.scrollWidth > w.clientWidth).map(w => w.dataset.viewKey + ':' + (w.scrollLeft / (w.scrollWidth-w.clientWidth)).toFixed(3));
    if (offsets.length) p.set('tables', offsets.join(','));
    return url;
  }
  let pendingURL = false;
  function queueURL() {
    if (restoring || pendingURL) return;
    pendingURL = true;
    queueMicrotask(() => {pendingURL = false; const url = viewURL(); if (url.href !== location.href) history.pushState(null,'',url);});
  }
  function restoreURL() {
    restoring = true;
    const p = new URL(location.href).searchParams;
    pricing.value = p.get('price') === 'charged' ? 'charged' : 'tariff';
    const selected = p.has('models') ? new Set(p.get('models').split(',')) : null;
    checks.forEach(c => c.checked = selected == null || selected.has(c.dataset.filterArm));
    estimates.checked = p.get('fast') === '1';
    highlighted = models.has(p.get('highlight')) ? p.get('highlight') : null;
    const mode = ['quick','full'].includes(p.get('read')) ? p.get('read') : 'read';
    document.body.classList.toggle('reading-quick', mode === 'quick');
    document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed',String(mode === 'read' ? !['quick','full'].includes(b.dataset.mode) : b.dataset.mode === mode)));
    disclosures.forEach(d => d.open = mode === 'full' && !d.matches('.model-profile,.filter-list'));
    for (const panel of (p.get('open') || '').split(',')) {
      const details = disclosures.find(d => d.id === panel.replace(/^-/,''));
      if (details) details.open = !panel.startsWith('-');
    }
    themeSelect.value = p.has('theme') ? (['light','dark'].includes(p.get('theme')) ? p.get('theme') : 'auto') : defaultTheme;
    if (themeSelect.value === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = themeSelect.value;
    tables.forEach((table,index) => {
      const defaults = defaultSorts[index];
      if (defaults.column != null) {table.dataset.column = defaults.column; table.dataset.direction = defaults.direction;}
      else {delete table.dataset.column; delete table.dataset.direction; [...table.tHead.rows[0].cells].forEach(h => h.removeAttribute('aria-sort')); defaults.rows.forEach(r => table.tBodies[0].append(r));}
    });
    for (const entry of (p.get('sort') || '').split(',')) {
      const [key,field,direction] = entry.split(':'); const table = tables.find(t => t.dataset.viewKey === key);
      if (!table || table.dataset.grouped || !['asc','desc'].includes(direction)) continue;
      const index = [...table.tHead.rows[0].cells].findIndex(h => h.dataset.viewSortKey === field && h.querySelector('button'));
      if (index >= 0) {table.dataset.column = index; table.dataset.direction = direction === 'asc' ? '1' : '-1';}
    }
    sharedScenario = null;
    if (p.has('human')) {
      const [minutes,rate,curve] = p.get('human').split(',');
      if (minutes !== '' && rate !== '' && Number.isFinite(Number(minutes)) && Number.isFinite(Number(rate)) && Number(minutes)>=0 && Number(minutes)<=60 && Number(rate)>=0 && Number(rate)<=200) sharedScenario = {minutes:Number(minutes),rate:Number(rate),curve:curves.some(c => c.dataset.viewKey === curve) ? curve : ''};
    }
    update(); showScenarioNote();
    marks.forEach(n => {n.classList.toggle('model-muted', Boolean(highlighted && n.dataset.arm !== highlighted)); n.classList.toggle('model-highlight',n.dataset.arm === highlighted);});
    openHash();
    requestAnimationFrame(() => {
      const offsets = new Map((p.get('tables') || '').split(',').map(e => e.split(':')));
      scrollTables.forEach(w => {const ratio = Number(offsets.get(w.dataset.viewKey) || 0); if (Number.isFinite(ratio)) w.scrollLeft = Math.max(0,Math.min(1,ratio)) * (w.scrollWidth-w.clientWidth);});
      requestAnimationFrame(() => restoring = false);
    });
  }
  document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', queueURL));
  themeSelect.addEventListener('change', queueURL);
  humanFigure.addEventListener('pointerdown', event => {if (event.target.closest('svg')) saveScenario();});
  humanFigure.addEventListener('keydown', event => {if (event.target.closest('.human-curve') && event.key.startsWith('Arrow')) saveScenario();});
  function saveScenario() {
    if (humanTooltip.dataset.minutes == null) return;
    sharedScenario = {minutes:Number(humanTooltip.dataset.minutes),rate:Number(humanTooltip.dataset.rate),curve:humanTooltip.dataset.comparison || ''};
    showScenarioNote(); queueURL();
  }
  document.querySelectorAll('[data-copy-view]').forEach(button => button.addEventListener('click', async () => {
    if (button.closest('#human-cost-figure')) saveScenario();
    const url = viewURL();
    const context = button.closest('section[id],figure[id],details[id]');
    if (context?.id) url.hash = context.id;
    history.replaceState(null,'',url);
    const label = button.textContent;
    document.getElementById('view-link-status').textContent = 'This view’s link is ready in the address bar.';
    try {await navigator.clipboard.writeText(url.href); button.textContent = 'Link copied'; document.getElementById('view-link-status').textContent = 'Link copied';}
    catch {button.textContent = 'Copy the address bar link'; document.getElementById('view-link-status').textContent = 'The address bar contains this view’s link.';}
    setTimeout(() => button.textContent = label, 1800);
  }));
  window.addEventListener('popstate', restoreURL);
  window.addEventListener('hashchange', () => {openHash();});
  window.addEventListener('load', openHash);
  restoreURL();
})();
