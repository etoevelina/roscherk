// Тесты src/core/input.js: один активный указатель (§4.1), чистая логика без DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPointerTracker } from '../src/core/input.js';

const down = (id, x = 0, y = 0, isPrimary = true) => ({ type: 'pointerdown', pointerId: id, isPrimary, x, y, t: 1 });
const move = (id, x, y) => ({ type: 'pointermove', pointerId: id, x, y, t: 2 });
const up = (id, x = 0, y = 0) => ({ type: 'pointerup', pointerId: id, x, y, t: 3 });

test('первый pointerdown запоминается, второй палец игнорируется до up', () => {
  const tr = createPointerTracker();
  assert.deepEqual(tr.handle(down(1, 10, 10)), { type: 'down', x: 10, y: 10, t: 1 });
  assert.equal(tr.active, true);
  assert.equal(tr.handle(down(2, 50, 50)), null);
  assert.equal(tr.handle(move(2, 60, 60)), null, 'движение второго пальца не проходит');
  assert.equal(tr.handle(up(2, 60, 60)), null, 'отпускание второго пальца не завершает росчерк');
  assert.equal(tr.active, true);
  assert.deepEqual(tr.handle(move(1, 20, 20)), { type: 'move', x: 20, y: 20, t: 2 });
  assert.deepEqual(tr.handle(up(1, 20, 20)), { type: 'up', x: 20, y: 20, t: 3 });
  assert.equal(tr.active, false);
  // После up новый палец принимается.
  assert.deepEqual(tr.handle(down(2, 5, 5)), { type: 'down', x: 5, y: 5, t: 1 });
});

test('не-primary pointerdown игнорируется', () => {
  const tr = createPointerTracker();
  assert.equal(tr.handle(down(7, 0, 0, false)), null);
  assert.equal(tr.active, false);
});

test('move/up без активного указателя ничего не дают', () => {
  const tr = createPointerTracker();
  assert.equal(tr.handle(move(1, 1, 1)), null);
  assert.equal(tr.handle(up(1)), null);
});

test('pointercancel завершает росчерк как up с последней позицией', () => {
  const tr = createPointerTracker();
  tr.handle(down(1, 10, 10));
  tr.handle(move(1, 30, 40));
  const ev = tr.handle({ type: 'pointercancel', pointerId: 1, t: 9 });
  assert.equal(ev.type, 'up');
  assert.equal(ev.x, 30);
  assert.equal(ev.y, 40);
  assert.equal(tr.active, false);
});

test('lostpointercapture, blur и hidden завершают росчерк как up', () => {
  for (const type of ['lostpointercapture', 'blur', 'hidden']) {
    const tr = createPointerTracker();
    tr.handle(down(3, 1, 2));
    const ev = tr.handle({ type, pointerId: 3, t: 5 });
    assert.equal(ev.type, 'up', type);
    assert.equal(tr.active, false, type);
  }
});

test('cancel чужого указателя не трогает активный', () => {
  const tr = createPointerTracker();
  tr.handle(down(1));
  assert.equal(tr.handle({ type: 'pointercancel', pointerId: 2, t: 5 }), null);
  assert.equal(tr.active, true);
});

test('abort завершает активный росчерк и ничего не делает без него', () => {
  const tr = createPointerTracker();
  assert.equal(tr.abort(), null);
  tr.handle(down(1, 4, 4));
  assert.equal(tr.abort().type, 'up');
  assert.equal(tr.active, false);
});
