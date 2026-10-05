import test from 'node:test';
import assert from 'node:assert/strict';
import { replay, previewSubstitution } from '../src/engine/engine.js';
import { twoRegionResetModel } from './fixtures/models.js';

test('替换预演：基线证据原样保留，且与普通回放逐字段一致', () => {
  const seq = ['FIRE', 'RESET'];
  const r = previewSubstitution(twoRegionResetModel, seq, 0, 'RESET');
  assert.ok(r.ok, r.errors?.map((e) => e.message).join(';'));
  assert.deepEqual(r.baseline, replay(twoRegionResetModel, seq));
  // 原序列不被改写
  assert.deepEqual(seq, ['FIRE', 'RESET']);
  assert.deepEqual(r.baselineSequence, ['FIRE', 'RESET']);
  assert.deepEqual(r.replacedSequence, ['RESET', 'RESET']);
  assert.deepEqual(r.replacement, { eventIndex: 0, from: 'FIRE', to: 'RESET' });
});

test('内置两区域规程：将 FIRE 替换为 RESET 时在首步出现稳定配置分歧', () => {
  const r = previewSubstitution(twoRegionResetModel, ['FIRE', 'RESET'], 0, 'RESET');
  assert.ok(r.ok);
  const cmp = r.comparison;
  assert.equal(cmp.firstDivergenceIndex, 0);
  assert.equal(cmp.prefixIdentical, true);
  assert.equal(cmp.terminatedReason, 'COMPLETED');
  assert.equal(cmp.terminalEventIndex, null);
  assert.equal(cmp.rows.length, 2);

  const [step0, step1] = cmp.rows;
  assert.equal(step0.atSubstitution, true);
  assert.equal(step0.equal, false);
  assert.equal(step0.divergence, 'CONFIG');
  // 基线首步：两区域并行 FIRE
  assert.deepEqual(step0.baseline.selected.sort(), ['tr_latch_release', 'tr_power_on']);
  assert.equal(step0.baseline.candidates.length, 2);
  const bLeaves = Object.fromEntries(step0.baseline.regions.map((x) => [x.regionId, x.activeLeafIds]));
  assert.deepEqual(bLeaves.R_POWER.sort(), ['A_ON_READY']);
  assert.deepEqual(bLeaves.R_LATCH, ['B_RELEASED']);
  // 替换首步：根复位，配置留在初始叶
  assert.deepEqual(step0.preview.selected, ['tr_root_reset']);
  assert.deepEqual(step0.preview.candidates.map((c) => c.transitionId), ['tr_root_reset']);
  const pLeaves = Object.fromEntries(step0.preview.regions.map((x) => [x.regionId, x.activeLeafIds]));
  assert.deepEqual(pLeaves.R_POWER, ['A_OFF']);
  assert.deepEqual(pLeaves.R_LATCH, ['B_LOCKED']);
  assert.equal(step0.sameConfiguration, false);

  // 第二步两侧都执行 RESET，回到同一初始配置
  assert.equal(step1.equal, true);
  assert.equal(step1.sameConfiguration, true);
});

test('替换点前各步一致：分歧只能出现在替换点或之后', () => {
  const r = previewSubstitution(twoRegionResetModel, ['FIRE', 'RESET'], 1, 'FIRE');
  assert.ok(r.ok);
  assert.equal(r.comparison.rows[0].equal, true);
  assert.equal(r.comparison.rows[0].beforeSubstitution, true);
  // 基线第二步 RESET 回初始；替换第二步 FIRE 无候选（A_OFF/B_LOCKED 已被首步退出），配置停在 FIRE 后
  assert.equal(r.comparison.rows[1].atSubstitution, true);
  assert.equal(r.comparison.rows[1].equal, false);
  assert.deepEqual(r.comparison.rows[1].preview.selected, []);
  assert.equal(r.comparison.firstDivergenceIndex, 1);
});

test('替代事件未声明：在替换位置拒绝，给出错误码，不改写基线证据，且不伪造后续步骤', () => {
  const seq = ['FIRE', 'RESET'];
  const r = previewSubstitution(twoRegionResetModel, seq, 0, 'NOPE');
  assert.ok(r.ok);
  const cmp = r.comparison;
  assert.equal(cmp.terminatedReason, 'PREVIEW_REJECTED');
  assert.equal(cmp.terminalEventIndex, 0);
  assert.equal(cmp.firstDivergenceIndex, 0);
  assert.equal(cmp.rows.length, 1); // 对照在首个失败事件终止，无后续行

  const row = cmp.rows[0];
  assert.equal(row.baseline.ok, true);
  assert.equal(row.preview.ok, false);
  assert.equal(row.preview.code, 'UNKNOWN_EVENT');
  assert.equal(row.divergence, 'REJECTION');
  // 另一侧对应配置仍在（基线该步候选与活动叶）
  assert.equal(row.baseline.candidates.length, 2);
  assert.equal(row.baseline.regions.length, 2);
  // 拒绝侧没有稳定配置，也没有被伪造出的候选裁决
  assert.deepEqual(row.preview.regions, []);
  assert.deepEqual(row.preview.candidates, []);
  // 基线完整结果未受影响
  assert.deepEqual(r.baseline, replay(twoRegionResetModel, seq));
  assert.ok(r.preview.ok === false && r.preview.eventIndex === 0);
});

test('替换在后续事件引发拒绝：对照终止于首个失败事件，保留另一侧该步配置', () => {
  const m = {
    name: '后置跨区域拒绝',
    regions: [
      { id: 'RA', name: '甲', initialStateId: 'A1' },
      { id: 'RB', name: '乙', initialStateId: 'B1' }
    ],
    states: [
      { id: 'A1', name: '', parentId: null, regionId: 'RA', kind: 'atomic' },
      { id: 'A2', name: '', parentId: null, regionId: 'RA', kind: 'atomic' },
      { id: 'B1', name: '', parentId: null, regionId: 'RB', kind: 'atomic' },
      { id: 'B2', name: '', parentId: null, regionId: 'RB', kind: 'atomic' }
    ],
    events: ['GO', 'SAFE', 'BAD'],
    transitions: [
      { id: 'ta', event: 'GO', priority: 1, sourceId: 'A1', targetId: 'A2' },
      { id: 'tb', event: 'BAD', priority: 1, sourceId: 'B1', targetId: 'A2' }
    ]
  };
  const r = previewSubstitution(m, ['GO', 'SAFE'], 1, 'BAD');
  assert.ok(r.ok);
  const cmp = r.comparison;
  assert.equal(cmp.rows.length, 2);
  assert.equal(cmp.rows[0].equal, true);
  const last = cmp.rows[1];
  assert.equal(last.baseline.ok, true);
  assert.deepEqual(last.baseline.selected, []); // SAFE 无匹配，配置不变
  assert.equal(last.preview.ok, false);
  assert.equal(last.preview.code, 'CROSS_REGION_TARGET');
  assert.deepEqual(last.preview.candidates.map((c) => c.transitionId), ['tb']);
  assert.equal(last.divergence, 'REJECTION');
  assert.equal(cmp.terminatedReason, 'PREVIEW_REJECTED');
  assert.equal(cmp.terminalEventIndex, 1);
});

test('替换后两条轨迹逐位等价：无分歧且均完整', () => {
  const r = previewSubstitution(twoRegionResetModel, ['FIRE', 'RESET'], 0, 'FIRE');
  assert.ok(r.ok);
  assert.equal(r.comparison.firstDivergenceIndex, null);
  assert.equal(r.comparison.prefixIdentical, true);
  assert.ok(r.comparison.rows.every((row) => row.equal));
});

test('预演重复执行结果逐字段一致（确定性）', () => {
  const run = () =>
    JSON.stringify(previewSubstitution(twoRegionResetModel, ['FIRE', 'RESET'], 0, 'RESET'));
  assert.equal(run(), run());
});

test('非法入参：替换位置越界或替代事件为空时返回 INPUT 错误', () => {
  const badIndex = previewSubstitution(twoRegionResetModel, ['FIRE'], 1, 'RESET');
  assert.equal(badIndex.ok, false);
  assert.equal(badIndex.stage, 'INPUT');
  assert.equal(badIndex.errors[0].code, 'INPUT');

  const emptyEvent = previewSubstitution(twoRegionResetModel, ['FIRE'], 0, '  ');
  assert.equal(emptyEvent.ok, false);
  assert.equal(emptyEvent.stage, 'INPUT');

  const notArray = previewSubstitution(twoRegionResetModel, null, 0, 'RESET');
  assert.equal(notArray.ok, false);
  assert.equal(notArray.stage, 'INPUT');
});

test('模型校验失败时预演返回 VALIDATION 错误', () => {
  const bad = { ...twoRegionResetModel, states: [] };
  const r = previewSubstitution(bad, ['FIRE'], 0, 'RESET');
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'VALIDATION');
  assert.ok(r.errors.length > 0);
});
