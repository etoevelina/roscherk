// Реестр режимов (§5.1, §6): у каждого модуля — обязательные поля контракта и собственная
// иконка (поле icon), по которой оболочка рисует карточку на главном экране без карты id → иконка.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODES, MODE_BY_ID, MODE_IDS, ROTATION_IDS } from '../src/modes/index.js';

const METHODS = ['create', 'serialize', 'layout', 'render', 'pointer', 'isSolved', 'reset', 'hint', 'stats', 'perfect', 'ghost', 'nextLabel', 'footer'];

test('реестр: zip → flow → stroke (порядок Ежедневной) + words только в кампании, id уникальны', () => {
  assert.deepEqual(MODE_IDS, ['zip', 'flow', 'stroke', 'words', 'draw']);
  assert.deepEqual(ROTATION_IDS, ['zip', 'flow', 'stroke'], 'чередование Ежедневной не меняется (§2.5)');
  for (const m of MODES) assert.equal(MODE_BY_ID[m.id], m);
});

test('draw: расширения контракта §2.6 — непрерывный рендер, весь холст, действия, события сима, только кампания', () => {
  const d = MODE_BY_ID.draw;
  assert.equal(d.continuous, true);
  assert.equal(d.worldRect, true);
  assert.equal(d.campaignOnly, true);
  assert.equal(typeof d.actions, 'function');
  assert.equal(typeof d.act, 'function');
  assert.equal(typeof d.drainEvents, 'function');
  assert.ok(!d.dom && !d.keyboard, 'draw рисует на холсте');
});

test('words: расширения контракта §2.5 — DOM-вид, клавиатура, Lumin, шторка подсказок, только кампания, окно по темам', () => {
  const w = MODE_BY_ID.words;
  assert.equal(w.dom, true);
  assert.equal(typeof w.view, 'function');
  assert.equal(typeof w.tap, 'function');
  assert.equal(w.keyboard, true);
  assert.equal(typeof w.key, 'function');
  assert.equal(w.skin, 'lumin');
  assert.equal(typeof w.hintOptions, 'function');
  assert.equal(w.campaignOnly, true);
  assert.equal(w.openByChapter, true);
  assert.equal(typeof w.chapterTitle, 'function');
  assert.equal(typeof w.titleFor, 'function');
  assert.ok(Array.isArray(w.intro) && w.intro.length === 3, 'знакомство из трёх карточек');
  for (const id of ['zip', 'flow', 'stroke']) {
    const m = MODE_BY_ID[id];
    assert.ok(!m.dom && !m.keyboard && !m.skin && !m.campaignOnly && !m.hintOptions, `${id} не задаёт расширений`);
  }
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
