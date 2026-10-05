import test from 'node:test';
import assert from 'node:assert/strict';
import { replay, replayWhatIf } from '../src/engine/engine.js';
import { twoRegionResetModel } from './fixtures/models.js';

test('内置两区域规程：将 FIRE 替换为 RESET，首步即出现稳定配置分歧', () => {
  const r = replayWhatIf(twoRegionResetModel, ['FIRE', 'RESET'], 0, 'RESET');
  assert.ok(r.ok, r.message);
  assert.deepEqual(r.alternativeSequence, ['RESET', 'RESET']);
  assert.equal(r.replacement.eventIndex, 0);
  assert.equal(r.replacement.originalEvent, 'FIRE');
  assert.equal(r.replacement.replacementEvent, 'RESET');

  const cmp = r.comparison;
  assert.equal(cmp.diverged, true);
  assert.equal(cmp.divergenceIndex, 0); // 首步差异
  assert.equal(cmp.termination, null);

  const first = cmp.rows[0];
  assert.equal(first.status, 'diverged');
  assert.equal(first.divergencePoint, true);
  // 基线 FIRE：两区域并行迁移；替代 RESET：根复位，初始配置不变
  assert.deepEqual(first.baseline.configAfter.sort(), ['A_ON_READY', 'B_RELEASED']);
  assert.deepEqual(first.alternative.configAfter.sort(), ['A_OFF', 'B_LOCKED']);
  // 该步两侧候选、选中迁移与区域活动叶都在
  assert.equal(first.baseline.candidates.length, 2);
  assert.equal(first.alternative.selected[0], 'tr_root_reset');
  assert.equal(first.alternative.regions.length, 2);
});

test('替换点之后的分歧：替换点前逐序号一致，差异从替换位置开始', () => {
  const r = replayWhatIf(twoRegionResetModel, ['FIRE', 'RESET'], 1, 'FIRE');
  assert.ok(r.ok, r.message);
  assert.deepEqual(r.alternativeSequence, ['FIRE', 'FIRE']);
  const cmp = r.comparison;
  assert.equal(cmp.divergenceIndex, 1);
  assert.equal(cmp.rows[0].status, 'identical-before');
  assert.equal(cmp.rows[0].configEqual, true);
  assert.equal(cmp.rows[1].status, 'diverged');
  assert.equal(cmp.rows[1].divergencePoint, true);
  assert.equal(cmp.rows[0].divergencePoint, false);
});

test('替换为同值事件：两条轨迹全程一致，无分歧', () => {
  const r = replayWhatIf(twoRegionResetModel, ['FIRE', 'RESET'], 0, 'FIRE');
  assert.ok(r.ok, r.message);
  assert.equal(r.comparison.diverged, false);
  assert.equal(r.comparison.divergenceIndex, null);
  assert.ok(r.comparison.rows.every((row) => row.status === 'identical' || row.status === 'identical-before'));
  assert.ok(r.comparison.rows.every((row) => row.configEqual));
});

test('替代事件未声明：定位替换位置且不改写基线证据', () => {
  const plain = replay(twoRegionResetModel, ['FIRE', 'RESET']);
  const r = replayWhatIf(twoRegionResetModel, ['FIRE', 'RESET'], 1, 'NOPE');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'UNKNOWN_EVENT');
  assert.equal(r.eventIndex, 1); // 定位到替换位置（第二个事件）
  // 基线回放证据原样保留
  assert.ok(r.baseline.ok);
  assert.deepEqual(r.baseline, plain);
});

test('替代轨迹先被拒绝：在首个失败事件终止，给出错误码与另一侧对应配置，不伪造后续步骤', () => {
  // 基线 ['ARM','REARM'] 成功；ARM 替换为 CONFLICT 触发同优先级冲突
  const m = {
    name: '预演终止',
    regions: [{ id: 'R1', name: '区域一', initialStateId: 'C' }],
    states: [
      { id: 'C', name: '外层', parentId: null, regionId: 'R1', kind: 'composite', initialChildId: 'L' },
      { id: 'L', name: '叶', parentId: 'C', regionId: 'R1', kind: 'atomic' },
      { id: 'X', name: '旁路', parentId: null, regionId: 'R1', kind: 'atomic' }
    ],
    events: ['ARM', 'CONFLICT', 'REARM'],
    transitions: [
      { id: 'tr_leaf_lo', event: 'ARM', priority: 9, sourceId: 'L', targetId: 'X' },
      { id: 'tr_ancestor_hi', event: 'ARM', priority: 1, sourceId: 'C', targetId: 'X' },
      { id: 'tr_leaf_c', event: 'CONFLICT', priority: 5, sourceId: 'L', targetId: 'X' },
      { id: 'tr_ancestor_c', event: 'CONFLICT', priority: 5, sourceId: 'C', targetId: 'X' },
      { id: 'tr_back', event: 'REARM', priority: 1, sourceId: 'X', targetId: 'C' }
    ]
  };
  const r = replayWhatIf(m, ['ARM', 'REARM'], 0, 'CONFLICT');
  assert.ok(r.ok, r.message);
  const cmp = r.comparison;
  assert.equal(cmp.diverged, true);
  assert.equal(cmp.divergenceIndex, 0);
  assert.equal(cmp.termination.side, 'alternative');
  assert.equal(cmp.termination.eventIndex, 0);
  assert.equal(cmp.termination.code, 'SAME_PRIORITY_CONFLICT');
  assert.equal(cmp.rejection.code, 'SAME_PRIORITY_CONFLICT');

  // 另一侧（基线）在同一事件的对应配置
  assert.equal(cmp.counterpartConfig.side, 'baseline');
  assert.deepEqual(cmp.counterpartConfig.leaves, ['X']);

  // 首个失败事件标记为 rejected；其后替代轨迹不存在的步骤不得伪造
  assert.equal(cmp.rows[0].status, 'rejected');
  assert.equal(cmp.rows[0].alternative.ok, false);
  assert.equal(cmp.rows[1].status, 'unreachable');
  assert.equal(cmp.rows[1].alternative, null);
  assert.ok(cmp.rows[1].baseline); // 基线该步仍真实存在
});

test('基线回放本身失败：不建立对照，但返回基线结果', () => {
  const r = replayWhatIf(twoRegionResetModel, ['NOPE'], 0, 'RESET');
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'BASELINE');
  assert.equal(r.baseline.code, 'UNKNOWN_EVENT');
});

test('替换位置越界：拒绝并保留基线', () => {
  const r = replayWhatIf(twoRegionResetModel, ['FIRE'], 5, 'RESET');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'REPLACE_INDEX');
  assert.ok(r.baseline.ok);
});

test('预演为纯函数：不修改模型与基线序列，重复运行逐字段一致', () => {
  const seq = ['FIRE', 'RESET'];
  const run = () => JSON.stringify(replayWhatIf(twoRegionResetModel, seq, 0, 'RESET'));
  assert.equal(run(), run());
  assert.deepEqual(seq, ['FIRE', 'RESET']);
});
