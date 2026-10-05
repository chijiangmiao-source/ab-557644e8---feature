// app.js — 规程录入与回放页面逻辑（零依赖原生 ESM）
import { replay, replayWhatIf, validateModel, LIMITS } from '/engine/engine.js';

const $ = (sel) => document.querySelector(sel);

const DEFAULT_MODEL = {
  name: '轨道应急载荷隔离规程-双区域复位',
  regions: [
    { id: 'R_POWER', name: '供电区域', initialStateId: 'A_OFF' },
    { id: 'R_LATCH', name: '锁扣区域', initialStateId: 'B_LOCKED' }
  ],
  states: [
    { id: 'A_OFF', name: '供电断开', parentId: '', regionId: 'R_POWER', kind: 'atomic', initialChildId: '' },
    { id: 'A_ON', name: '供电接通(复合)', parentId: '', regionId: 'R_POWER', kind: 'composite', initialChildId: 'A_ON_READY' },
    { id: 'A_ON_READY', name: '就绪(嵌套层)', parentId: 'A_ON', regionId: 'R_POWER', kind: 'atomic', initialChildId: '' },
    { id: 'B_LOCKED', name: '锁扣闭合', parentId: '', regionId: 'R_LATCH', kind: 'atomic', initialChildId: '' },
    { id: 'B_RELEASED', name: '锁扣释放', parentId: '', regionId: 'R_LATCH', kind: 'atomic', initialChildId: '' }
  ],
  nestedRegions: [],
  events: ['FIRE', 'RESET'],
  transitions: [
    { id: 'tr_power_on', event: 'FIRE', priority: '10', sourceId: 'A_OFF', targetId: 'A_ON' },
    { id: 'tr_latch_release', event: 'FIRE', priority: '20', sourceId: 'B_LOCKED', targetId: 'B_RELEASED' },
    { id: 'tr_root_reset', event: 'RESET', priority: '1', sourceId: '', targetId: '' }
  ]
};

const state = structuredClone(DEFAULT_MODEL);

/* ---------------- 表格行渲染 ---------------- */

function row(cellsHtml) {
  const tr = document.createElement('tr');
  tr.innerHTML = cellsHtml;
  return tr;
}

function inputCell(value, placeholder = '') {
  return `<input type="text" value="${escapeAttr(value ?? '')}" placeholder="${escapeAttr(placeholder)}" />`;
}

function escapeAttr(s) {
  return String(s).replace(/[&"<>]/g, (c) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' }[c]));
}

function renderRootRegions() {
  const tb = $('#root-regions-table tbody');
  tb.innerHTML = '';
  state.regions.forEach((r, i) => {
    const tr = row(`
      <td>${inputCell(r.id)}</td>
      <td>${inputCell(r.name)}</td>
      <td>${inputCell(r.initialStateId)}</td>
      <td class="del" title="删除">✕</td>`);
    bindRow(tr, ['id', 'name', 'initialStateId'], r);
    tr.querySelector('.del').addEventListener('click', () => {
      state.regions.splice(i, 1);
      renderRootRegions();
    });
    tb.appendChild(tr);
  });
}

function kindCell(kind) {
  const opts = ['atomic', 'composite', 'orthogonal']
    .map((k) => `<option value="${k}" ${k === kind ? 'selected' : ''}>${k}</option>`)
    .join('');
  return `<select>${opts}</select>`;
}

function renderStates() {
  const tb = $('#states-table tbody');
  tb.innerHTML = '';
  state.states.forEach((s, i) => {
    const tr = row(`
      <td>${inputCell(s.id)}</td>
      <td>${inputCell(s.name)}</td>
      <td>${kindCell(s.kind)}</td>
      <td>${inputCell(s.parentId ?? '', '空=顶层')}</td>
      <td>${inputCell(s.regionId)}</td>
      <td>${inputCell(s.initialChildId ?? '', '复合必填')}</td>
      <td class="del" title="删除">✕</td>`);
    bindRow(tr, ['id', 'name', 'parentId', 'regionId', 'initialChildId'], s);
    tr.querySelector('select').addEventListener('change', (e) => {
      s.kind = e.target.value;
    });
    tr.querySelector('.del').addEventListener('click', () => {
      state.states.splice(i, 1);
      renderStates();
    });
    tb.appendChild(tr);
  });
}

function renderNestedRegions() {
  const tb = $('#nested-regions-table tbody');
  tb.innerHTML = '';
  state.nestedRegions.forEach((r, i) => {
    const tr = row(`
      <td>${inputCell(r.containerId)}</td>
      <td>${inputCell(r.id)}</td>
      <td>${inputCell(r.name)}</td>
      <td>${inputCell(r.initialStateId)}</td>
      <td class="del" title="删除">✕</td>`);
    bindRow(tr, ['containerId', 'id', 'name', 'initialStateId'], r);
    tr.querySelector('.del').addEventListener('click', () => {
      state.nestedRegions.splice(i, 1);
      renderNestedRegions();
    });
    tb.appendChild(tr);
  });
}

function bindRow(tr, keys, target) {
  const inputs = tr.querySelectorAll('input');
  inputs.forEach((inp, i) => {
    inp.addEventListener('input', () => {
      target[keys[i]] = inp.value;
    });
  });
}

/* ---------------- 事件 chips ---------------- */

function renderEvents() {
  const box = $('#events-editor');
  box.innerHTML = '';
  state.events.forEach((ev, i) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `<input value="${escapeAttr(ev)}" /><button type="button" title="删除事件">✕</button>`;
    const inp = chip.querySelector('input');
    inp.addEventListener('change', () => {
      state.events[i] = inp.value.trim();
    });
    chip.querySelector('button').addEventListener('click', () => {
      state.events.splice(i, 1);
      renderEvents();
    });
    box.appendChild(chip);
  });
  const add = document.createElement('button');
  add.type = 'button';
  add.textContent = '+ 事件';
  add.addEventListener('click', () => {
    const name = `EV${state.events.length + 1}`;
    state.events.push(name);
    renderEvents();
    const inputs = box.querySelectorAll('input');
    inputs[inputs.length - 1]?.focus();
  });
  box.appendChild(add);
}

/* ---------------- 迁移表 ---------------- */

function eventOptions(selected) {
  const blank = '<option value="">(选择事件)</option>';
  return (
    blank +
    state.events
      .map((e) => `<option value="${escapeAttr(e)}" ${e === selected ? 'selected' : ''}>${escapeAttr(e)}</option>`)
      .join('')
  );
}

function renderTransitions() {
  const tb = $('#transitions-table tbody');
  tb.innerHTML = '';
  state.transitions.forEach((t, i) => {
    const tr = row(`
      <td>${inputCell(t.id)}</td>
      <td><select>${eventOptions(t.event)}</select></td>
      <td>${inputCell(t.priority)}</td>
      <td>${inputCell(t.sourceId ?? '', '空=根')}</td>
      <td>${inputCell(t.targetId ?? '', '空=根')}</td>
      <td class="del" title="删除">✕</td>`);
    const inputs = tr.querySelectorAll('input');
    const keys = ['id', 'priority', 'sourceId', 'targetId'];
    inputs.forEach((inp, k) =>
      inp.addEventListener('input', () => {
        t[keys[k]] = inp.value;
      })
    );
    tr.querySelector('select').addEventListener('change', (e) => {
      t.event = e.target.value;
    });
    tr.querySelector('.del').addEventListener('click', () => {
      state.transitions.splice(i, 1);
      renderTransitions();
    });
    tb.appendChild(tr);
  });
}

/* ---------------- 模型组装 ---------------- */

function buildModel() {
  const statesByOrtho = new Map();
  for (const r of state.nestedRegions) {
    if (!r.containerId) continue;
    if (!statesByOrtho.has(r.containerId)) statesByOrtho.set(r.containerId, []);
    statesByOrtho.get(r.containerId).push({ id: r.id, name: r.name, initialStateId: r.initialStateId });
  }
  const states = state.states.map((s) => {
    const out = {
      id: s.id.trim(),
      name: s.name,
      parentId: s.parentId ? s.parentId.trim() : null,
      regionId: s.regionId.trim(),
      kind: s.kind
    };
    if (s.kind === 'composite') out.initialChildId = s.initialChildId.trim();
    if (s.kind === 'orthogonal') out.regions = statesByOrtho.get(s.id) || [];
    return out;
  });
  return {
    name: state.name,
    regions: state.regions.map((r) => ({
      id: r.id.trim(),
      name: r.name,
      initialStateId: r.initialStateId.trim()
    })),
    states,
    events: state.events.map((e) => e.trim()).filter(Boolean),
    transitions: state.transitions
      .filter((t) => t.id.trim())
      .map((t) => ({
        id: t.id.trim(),
        event: t.event,
        priority: Number.parseInt(t.priority, 10),
        sourceId: t.sourceId ? t.sourceId.trim() : null,
        targetId: t.targetId ? t.targetId.trim() : null
      }))
  };
}

/* ---------------- 证据渲染 ---------------- */

const nameOf = (model) => (id) => {
  if (id == null) return '根';
  const s = model.states.find((x) => x.id === id);
  return s && s.name ? `${s.name}(${id})` : id;
};

function renderErrors(result) {
  const box = $('#errors');
  if (result.ok) {
    box.classList.add('hidden');
    return;
  }
  box.classList.remove('hidden');
  let html = '<h4>规程被拒绝</h4><ul>';
  if (result.stage === 'VALIDATION') {
    html += result.errors
      .map(
        (e) =>
          `<li>[${e.code}] ${escapeHtml(e.message)}${e.ref ? ` <span class="loc">@ ${e.ref}</span>` : ''}</li>`
      )
      .join('');
  } else {
    html += `<li><span class="loc">首个失败事件：#${result.eventIndex + 1} “${escapeHtml(
      result.event ?? ''
    )}”</span>（${result.code}）— ${escapeHtml(result.message ?? '')}</li>`;
  }
  html += '</ul>';
  box.innerHTML = html;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function renderInitial(result, model) {
  const box = $('#initial-config');
  const init = result.initial;
  if (!init) {
    box.innerHTML = '';
    return;
  }
  const label = nameOf(model);
  box.innerHTML = `
    <h4>初始稳定配置（进入序列：${init.entered.map(label).join(' → ') || '—'}）</h4>
    ${init.regions
      .map(
        (r) =>
          `<div class="region-row"><span>${escapeHtml(r.regionName || r.regionId)}</span>
             <span>${label(r.activeStateId)}</span></div>`
      )
      .join('')}`;
}

function renderTimeline(result, model) {
  const tl = $('#timeline');
  tl.innerHTML = '';
  const label = nameOf(model);
  for (const step of result.evidence || []) {
    const card = document.createElement('div');
    card.className = 'step-card';
    const candPills = step.candidates
      .map((c) => {
        const picked = (step.selected || []).includes(c.transitionId);
        return `<span class="pill ${picked ? 'selected' : ''}">${c.transitionId} · 优先级 ${c.priority}</span>`;
      })
      .join('') || '<span class="kv">无候选迁移（事件被忽略，配置不变）</span>';

    const arbRows = (step.arbitration || [])
      .map((a) => {
        if (a.selected)
          return `<div class="arb-row"><span class="tag sel">选中</span><span>${a.transitionId}</span></div>`;
        return `<div class="arb-row"><span class="tag preempt">让出</span><span class="pill lost">${a.transitionId}</span>
          <span class="kv">${escapeHtml(a.reason || '')}（被 ${a.preemptedBy} 抢占）</span></div>`;
      })
      .join('');

    const exits = (step.exits || []).map((s) => `<span class="pill exit">↯ ${label(s)}</span>`).join('');
    const entries = (step.entries || []).map((s) => `<span class="pill entry">↦ ${label(s)}</span>`).join('');

    const regionRows = (step.regions || [])
      .map((r) => {
        const leaves = (r.activeLeafIds || []).map(label).join('，') || '—';
        return `<div class="region-row"><span>${escapeHtml(r.regionName || r.regionId)}</span>
             <span>${label(r.activeStateId)} <span class="kv">叶：${leaves}</span></span></div>`;
      })
      .join('');

    card.innerHTML = `
      <div class="step-head">
        <span class="ev">事件：${escapeHtml(step.event)}</span>
        <span class="idx">#${step.eventIndex + 1}${step.ok === false ? ' · 拒绝点' : ''}</span>
      </div>
      <div class="block-title">候选迁移（活动状态或其祖先的匹配迁移）</div>
      <div>${candPills}</div>
      ${arbRows ? `<div class="block-title">优先级裁决</div>${arbRows}` : ''}
      <div class="block-title">退出序列（至最近公共祖先）</div>
      <div>${exits || '<span class="kv">—</span>'}</div>
      <div class="block-title">进入序列（文档顺序 + 初始后代）</div>
      <div>${entries || '<span class="kv">—</span>'}</div>
      <div class="block-title">各区域活动状态（稳定配置）</div>
      ${regionRows}`;
    tl.appendChild(card);
  }
}

function setVerdict(result) {
  const v = $('#verdict');
  if (result.ok) {
    v.textContent = `✓ 回放完成，${(result.evidence || []).length} 个事件，最终 ${result.finalLeaves.length} 个活动叶`;
    v.className = 'verdict ok';
  } else {
    v.textContent = result.stage === 'VALIDATION' ? '✗ 模型校验失败' : `✗ 回放于事件 #${(result.eventIndex ?? 0) + 1} 被拒绝`;
    v.className = 'verdict bad';
  }
}

/* ---------------- 交互 ---------------- */

let lastBaseline = null; // { model, seq }：最近一次成功回放，作为预演基线

function clearWhatIfResult() {
  $('#whatif-result').innerHTML = '';
  const errBox = $('#whatif-errors');
  errBox.classList.add('hidden');
  errBox.innerHTML = '';
}

function clearWhatIf() {
  clearWhatIfResult();
  $('#whatif-event').value = '';
  $('#whatif-panel').classList.add('hidden');
  lastBaseline = null;
}

function setupWhatIf(model, seq) {
  const sel = $('#whatif-index');
  sel.innerHTML = seq
    .map((ev, i) => `<option value="${i}">#${i + 1} · ${escapeHtml(ev)}</option>`)
    .join('');
  $('#whatif-event-options').innerHTML = (model.events || [])
    .map((e) => `<option value="${escapeAttr(e)}"></option>`)
    .join('');
  $('#whatif-event').value = '';
  $('#whatif-result').innerHTML = '';
  $('#whatif-errors').classList.add('hidden');
  $('#whatif-panel').classList.remove('hidden');
}

function runReplay() {
  const model = buildModel();
  const seqText = $('#event-sequence').value;
  const seq = seqText
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  // 先跑本地引擎（与 /api/replay 同一实现），保证页面可离线演示
  const result = replay(model, seq);
  setVerdict(result);
  renderErrors(result);
  renderInitial(result, model);
  renderTimeline(result, model);

  // 再次完成普通回放：清除旧对照结果；仅成功回放可作为预演基线
  clearWhatIf();
  if (result.ok && seq.length > 0) {
    lastBaseline = { model, seq };
    setupWhatIf(model, seq);
  }
}

/* ---------------- 单处替换预演渲染 ---------------- */

function whatIfSideHtml(sideLabel, step, model, rejected) {
  const label = nameOf(model);
  if (!step) {
    return `<div class="cmp-side missing"><div class="cmp-side-head">${sideLabel}</div>
      <div class="kv">— 此步不存在（该轨迹已提前终止，不构造后续步骤）—</div></div>`;
  }
  const candPills = (step.candidates || [])
    .map((c) => {
      const picked = (step.selected || []).includes(c.transitionId);
      return `<span class="pill ${picked ? 'selected' : ''}">${c.transitionId} · 优先级 ${c.priority}</span>`;
    })
    .join('') || '<span class="kv">无候选迁移</span>';
  const selected = (step.selected || [])
    .map((t) => `<span class="pill selected">${t}</span>`)
    .join('') || '<span class="kv">无</span>';
  const regionRows = (step.regions || [])
    .map((r) => {
      const leaves = (r.activeLeafIds || []).map(label).join('，') || '—';
      return `<div class="region-row"><span>${escapeHtml(r.regionName || r.regionId)}</span>
        <span>${label(r.activeStateId)} <span class="kv">叶：${leaves}</span></span></div>`;
    })
    .join('') || '<span class="kv">—</span>';
  const rejectBlock = rejected
    ? `<div class="cmp-reject">拒绝：[${escapeHtml(rejected.code)}] ${escapeHtml(rejected.message || '')}</div>`
    : '';
  return `<div class="cmp-side ${rejected ? 'is-rejected' : ''}">
    <div class="cmp-side-head">${sideLabel} · 事件 ${escapeHtml(step.event)}</div>
    ${rejectBlock}
    <div class="block-title">候选迁移</div><div>${candPills}</div>
    <div class="block-title">选中迁移</div><div>${selected}</div>
    <div class="block-title">区域活动叶</div>${regionRows}
  </div>`;
}

const STATUS_LABEL = {
  'identical-before': ['一致（替换点前）', 'cmp-tag same-before'],
  identical: ['一致', 'cmp-tag same'],
  diverged: ['配置分歧', 'cmp-tag diff'],
  rejected: ['该侧拒绝·对照终止', 'cmp-tag reject'],
  unreachable: ['后续不存在', 'cmp-tag none']
};

function renderWhatIf(result, model) {
  const box = $('#whatif-result');
  const errBox = $('#whatif-errors');
  errBox.classList.add('hidden');
  if (!result.ok) {
    box.innerHTML = '';
    let detail;
    if (result.stage === 'VALIDATION') {
      detail = result.errors.map((e) => `[${e.code}] ${escapeHtml(e.message)}`).join('；');
    } else {
      const loc = result.eventIndex != null ? `事件 #${result.eventIndex + 1} “${escapeHtml(result.event ?? '')}”：` : '';
      detail = `${loc}[${result.code || result.stage}] ${escapeHtml(result.message || '')}`;
    }
    errBox.classList.remove('hidden');
    errBox.innerHTML = `<h4>预演无法建立</h4><div>${detail}</div>`;
    return;
  }

  const cmp = result.comparison;
  const rep = result.replacement;
  let banner;
  if (cmp.termination) {
    const t = cmp.termination;
    const cc = cmp.counterpartConfig;
    const label = nameOf(model);
    const otherCfg = cc
      ? `另一侧（基线）同事件 #${cc.eventIndex + 1} “${escapeHtml(cc.event)}” 的对应配置活动叶：${
          cc.leaves.map(label).join('，')
        }`
      : '另一侧在该事件亦无成功配置。';
    banner = `<div class="cmp-banner reject">
      替代轨迹在事件 #${t.eventIndex + 1} “${escapeHtml(result.alternativeSequence[t.eventIndex])}”
      被拒绝（${escapeHtml(t.code)}），对照在此首个失败事件终止，后续步骤不予构造。<br />
      <span class="kv">${otherCfg}</span></div>`;
  } else if (cmp.diverged) {
    const d = cmp.divergenceIndex;
    banner = `<div class="cmp-banner diff">首个稳定配置分歧：事件 #${d + 1}
      “${escapeHtml(result.alternativeSequence[d])}”（替换点 #${rep.eventIndex + 1}
      ${escapeHtml(rep.originalEvent)} → ${escapeHtml(rep.replacementEvent)}）。
      替换点之前两侧逐序号一致。</div>`;
  } else {
    banner = `<div class="cmp-banner same">替换未改变任何稳定配置：两条轨迹 ${cmp.rows.length} 个事件逐序号一致。</div>`;
  }

  const rowsHtml = cmp.rows
    .map((row) => {
      const [tagText, tagClass] = STATUS_LABEL[row.status] || ['', ''];
      const altRejected =
        row.status === 'rejected' && cmp.termination
          ? { code: cmp.termination.code, message: cmp.termination.message }
          : null;
      const altMissing = row.status === 'unreachable';
      const mark = row.replaced ? '<span class="rep-mark">替换点</span>' : '';
      return `<div class="cmp-row ${row.divergencePoint ? 'is-divergence' : ''}">
        <div class="cmp-row-head">
          <span class="cmp-idx">#${row.eventIndex + 1}</span>
          ${mark}
          <span class="cmp-tag ${tagClass}">${tagText}</span>
        </div>
        <div class="cmp-grid">
          ${whatIfSideHtml('基线', row.baseline, model, null)}
          ${whatIfSideHtml('替代', altMissing ? null : row.alternative, model, altRejected)}
        </div>
      </div>`;
    })
    .join('');

  box.innerHTML = `${banner}<div class="cmp-rows">${rowsHtml}</div>`;
}

function runWhatIf() {
  if (!lastBaseline) return;
  const idx = Number.parseInt($('#whatif-index').value, 10);
  const replacement = $('#whatif-event').value.trim();
  // 与 /api/whatif 同一引擎实现：接口结果与浏览器逐字段一致
  const result = replayWhatIf(lastBaseline.model, lastBaseline.seq, idx, replacement);
  renderWhatIf(result, lastBaseline.model);
}

function renderAll() {
  renderRootRegions();
  renderStates();
  renderNestedRegions();
  renderEvents();
  renderTransitions();
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-add]');
  if (!btn) return;
  const kind = btn.dataset.add;
  if (kind === 'rootRegion') {
    if (state.regions.length + state.nestedRegions.length >= LIMITS.MAX_REGIONS_TOTAL) {
      return alert(`并行区域总数不得超过 ${LIMITS.MAX_REGIONS_TOTAL}`);
    }
    state.regions.push({ id: `R${state.regions.length + 1}`, name: '', initialStateId: '' });
    renderRootRegions();
  } else if (kind === 'state') {
    if (state.states.length >= LIMITS.MAX_STATES) return alert(`状态不得超过 ${LIMITS.MAX_STATES}`);
    state.states.push({ id: `S${state.states.length + 1}`, name: '', parentId: '', regionId: state.regions[0]?.id || '', kind: 'atomic', initialChildId: '' });
    renderStates();
  } else if (kind === 'nestedRegion') {
    if (state.regions.length + state.nestedRegions.length + 1 > LIMITS.MAX_REGIONS_TOTAL) {
      return alert(`并行区域总数不得超过 ${LIMITS.MAX_REGIONS_TOTAL}`);
    }
    state.nestedRegions.push({ containerId: '', id: `NR${state.nestedRegions.length + 1}`, name: '', initialStateId: '' });
    renderNestedRegions();
  } else if (kind === 'transition') {
    state.transitions.push({ id: `tr${state.transitions.length + 1}`, event: state.events[0] || '', priority: '100', sourceId: '', targetId: '' });
    renderTransitions();
  }
});

$('#btn-replay').addEventListener('click', runReplay);
$('#btn-whatif-run').addEventListener('click', runWhatIf);
$('#btn-whatif-cancel').addEventListener('click', clearWhatIf);
$('#btn-validate').addEventListener('click', () => {
  const v = validateModel(buildModel());
  const result = v.ok
    ? { ok: true, initial: { entered: v.initial.entered, regions: [] }, evidence: [], finalLeaves: v.initial.leaves }
    : { ok: false, stage: 'VALIDATION', errors: v.errors };
  setVerdict(result);
  renderErrors(result);
  renderInitial({ initial: null }, buildModel());
});
$('#btn-load-default').addEventListener('click', () => {
  Object.assign(state, structuredClone(DEFAULT_MODEL));
  $('#event-sequence').value = 'FIRE, RESET';
  renderAll();
  runReplay();
});

renderAll();
$('#event-sequence').value = 'FIRE, RESET';
runReplay();
