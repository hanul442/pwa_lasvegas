// 층 이름 정비 (2026-10-30): one Korean word per floor for sentences and an English sign with the
// floor number, the same on the server and in the client; slugs stay as they were.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FLOORS } from '../lib/constants.mjs';
import { TIERS } from '../public/js/chips.js';

test('floors read 1F HALL to 8F OLYMPUS on both sides', () => {
  assert.deepEqual(FLOORS.map(f => `${f.no}F ${f.en} ${f.name}`), ['1F HALL 홀', '2F CLUB 클럽', '3F SALON 살롱', '4F PENTHOUSE 펜트하우스', '5F SKY 스카이', '6F VAULT 볼트', '7F CROWN 크라운', '8F OLYMPUS 올림포스']);
  assert.deepEqual(FLOORS.map(f => f.slug), ['gold-room', 'high-limit', 'salon-prive', 'penthouse', 'sky-lounge', 'vault', 'crown', 'olympus']);
  for (const f of FLOORS) assert.deepEqual([TIERS[f.slug].name, TIERS[f.slug].en, TIERS[f.slug].no], [f.name, f.en, f.no]);
});

test('every floor has its own door, and the game opens behind it before the buy-in', () => {
  const door = readFileSync(new URL('../public/js/floor-door.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../public/floor-door.css', import.meta.url), 'utf8');
  for (const f of FLOORS) {
    assert.ok(door.includes(`'${f.slug}'`) || door.includes(`  ${f.slug}:`), `${f.slug} door markup`);
    assert.ok(css.includes(`.floor-door--${f.slug}`), `${f.slug} door style`);
  }
  assert.match(css, /prefers-reduced-motion/);
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.ok(app.indexOf('await door.opened') < app.indexOf('const bought = await buyInSheet'), 'door first, then the buy-in');
});
