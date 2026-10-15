// Тесты src/core/i18n.js: t/tr, подстановки, formatTime, склонение «день/дня/дней».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { t, tr, setLang, getLang, formatTime, daysWord } from '../src/core/i18n.js';

test('t: строка по ключу с подстановками; неизвестный ключ возвращается как есть', () => {
  assert.equal(t('appTitle'), 'Росчерк');
  assert.equal(t('passed', { done: 23, total: 100 }), 'пройдено 23/100');
  assert.equal(t('streak', { n: 7 }), 'Серия: 7');
  assert.equal(t('nonexistentKey'), 'nonexistentKey');
  assert.equal(t('time', { t: '0:41' }), 'Время 0:41');
});

test('tr: выбор языка, fallback на ru, строка как есть, null → пусто', () => {
  assert.equal(tr({ ru: 'Маршрут', en: 'Route' }), 'Маршрут');
  assert.equal(tr('plain'), 'plain');
  assert.equal(tr(null), '');
  assert.equal(tr(undefined), '');
  setLang('en');
  assert.equal(getLang(), 'en');
  assert.equal(tr({ ru: 'Маршрут', en: 'Route' }), 'Route');
  assert.equal(tr({ ru: 'Только ru' }), 'Только ru', 'en отсутствует → ru');
  assert.equal(t('play'), 'Играть', 'в v1 наполнен только ru');
  setLang('xx');
  assert.equal(getLang(), 'ru', 'неизвестный язык → ru');
});

test('formatTime: 0:41, 12:03, округление, отрицательное → 0:00', () => {
  assert.equal(formatTime(41000), '0:41');
  assert.equal(formatTime(723000), '12:03');
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(499), '0:00');
  assert.equal(formatTime(500), '0:01');
  assert.equal(formatTime(-5000), '0:00');
  assert.equal(formatTime(3600000), '60:00', 'часы не показываем');
});

test('daysWord: склонения 1/2/5/11/21/22/25/101/111', () => {
  assert.equal(daysWord(1), 'день');
  assert.equal(daysWord(2), 'дня');
  assert.equal(daysWord(4), 'дня');
  assert.equal(daysWord(5), 'дней');
  assert.equal(daysWord(0), 'дней');
  assert.equal(daysWord(11), 'дней');
  assert.equal(daysWord(12), 'дней');
  assert.equal(daysWord(14), 'дней');
  assert.equal(daysWord(21), 'день');
  assert.equal(daysWord(22), 'дня');
  assert.equal(daysWord(25), 'дней');
  assert.equal(daysWord(101), 'день');
  assert.equal(daysWord(111), 'дней');
  assert.equal(daysWord(112), 'дней');
});

test('тосты тупика stroke: два текста — выбор старта и порядок обхода', () => {
  assert.equal(t('deadend'), 'Тупик. Попробуй другую точку старта');
  assert.equal(t('deadendOrder'), 'Тупик. Этот отрезок надо было пройти позже');
});
