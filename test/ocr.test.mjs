import test from 'node:test';
import assert from 'node:assert/strict';
import { duplicateTopic, parseOcr, topicKey } from '../lib/ocr.mjs';

test('keeps the same topic across Arabic title prefixes and diacritics', () => {
  const topics = [{ id: 1, title: 'قانون أوم' }, { id: 2, title: 'قانون كيرشوف' }];
  assert.equal(duplicateTopic('مُلخّص عن قانون أوم', 'تعريف المقاومة', topics)?.id, 1);
  assert.equal(duplicateTopic('قانون لنز', 'تعريف المقاومة', topics), undefined);
  assert.equal(topicKey('Exercises on Ohm’s Law'), 'ohm s law');
});

test('holds short or low-confidence OCR', () => {
  const line = (n, word, confidence) => [5, 1, 1, 1, 1, n, 0, 0, 0, 0, confidence, word].join('\t');
  const words = ['قانون', 'أوم', 'يوضح', 'العلاقة', 'بين', 'التيار', 'وفرق', 'الجهد'];
  const table = confidence => ['header', ...words.map((word, i) => line(i + 1, word, confidence))].join('\n');
  assert.equal(parseOcr(table(90)).readable, true);
  assert.equal(parseOcr(table(50)).readable, false);
  assert.equal(parseOcr('header\n' + line(1, 'درس', 90)).readable, false);
});
