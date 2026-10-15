// Реестр режимов (§5.1, §6): у каждого модуля — обязательные поля контракта и собственная
// иконка (поле icon), по которой оболочка рисует карточку на главном экране без карты id → иконка.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODES, MODE_BY_ID, MODE_IDS } from '../src/modes/index.js';

const METHODS = ['create', 'serialize', 'layout', 'render', 'pointer', 'isSolved', 'reset', 'hint', 'stats', 'perfect', 'ghost', 'nextLabel', 'footer'];

test('реестр: zip → flow → stroke (порядок Ежедневной), id уникальны', () => {
  assert.deepEqual(MODE_IDS, ['zip', 'flow', 'stroke']);
  for (const m of MODES) assert.equal(MODE_BY_ID[m.id], m);
});

test('каждый режим: методы контракта §5.1, name/tagline/helpText {ru}, цвета, icon', () => {
  const icons = new Set();
  for (const m of MODES) {
    for (const name of METHODS) assert.equal(typeof m[name], 'function', `${m.id}.${name}`);
    for (const field of ['name', 'tagline', 'helpText']) assert.equal(typeof m[field].ru, 'string', `${m.id}.${field}.ru`);
    assert.match(m.color, /^#[0-9a-fA-F]{6}$/);
    assert.match(m.colorLight, /^#[0-9a-fA-F]{6}$/);
    assert.equal(typeof m.icon, 'string', `${m.id}.icon`);
    assert.ok(!icons.has(m.icon), `иконка ${m.icon} повторяется`);
    icons.add(m.icon);
  }
  assert.equal(typeof MODE_BY_ID.zip.truncate, 'function', 'zip: необязательный truncate для подсказки rollback');
});
