// The economy before the RP season (2026-10-29): see tests/legacy-economy.mjs.
import './legacy-economy.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaultState } from '../lib/state.mjs';
import { pushFeed, feedView } from '../lib/engagement.mjs';
import { reactToFeed, reactionSummary, reactionNews } from '../lib/brag.mjs';
import { newsFor } from '../lib/news.mjs';

function withMoment() {
  const state = defaultState();
  pushFeed(state, { type: 'HOT_WIN', actorId: 'hanseo', game: 'Blackjack', amount: 5_000_000_000, multiple: 10 });
  return { state, f: state.feed[0] };
}

test('others cheer a moment once each; sending nothing takes it back; my own moment refuses', () => {
  const { state, f } = withMoment();
  const r1 = reactToFeed(state, state.users.min, f.id, 'clap');
  assert.deepEqual(r1, { counts: { clap: 1, fire: 0, lol: 0 }, mine: 'clap' });
  // The same request again changes nothing (a retried request is harmless).
  assert.deepEqual(reactToFeed(state, state.users.min, f.id, 'clap').counts.clap, 1);
  reactToFeed(state, state.users.june, f.id, 'lol');
  const switched = reactToFeed(state, state.users.min, f.id, 'fire');
  assert.deepEqual(switched.counts, { clap: 0, fire: 1, lol: 1 });
  assert.deepEqual(reactToFeed(state, state.users.min, f.id, '').counts, { clap: 0, fire: 0, lol: 1 });
  assert.throws(() => reactToFeed(state, state.users.hanseo, f.id, 'clap'), /OWN_MOMENT/);
  assert.throws(() => reactToFeed(state, state.users.min, f.id, 'heart'), /BAD_REACTION/);
  assert.throws(() => reactToFeed(state, state.users.min, 'feed_nope', 'clap'), /FEED_NOT_FOUND/);
});

test('the feed shows counts and my pick, never who reacted', () => {
  const { state, f } = withMoment();
  reactToFeed(state, state.users.min, f.id, 'clap');
  reactToFeed(state, state.users.june, f.id, 'clap');
  const [mine] = feedView(state, 5, 'june');
  assert.equal(mine.reactions, undefined);
  assert.deepEqual(mine.react, { counts: { clap: 2, fire: 0, lol: 0 }, mine: 'clap' });
  assert.equal(feedView(state, 5, 'hanseo')[0].react.mine, null);
  assert.deepEqual(reactionSummary({}, 'x'), { counts: { clap: 0, fire: 0, lol: 0 }, mine: null });
});

test('the one whose moment it was hears who reacted, as news', () => {
  const { state, f } = withMoment();
  const since = Date.now() - 1000;
  reactToFeed(state, state.users.min, f.id, 'clap');
  const one = reactionNews(state, 'hanseo', since);
  assert.equal(one.length, 1);
  assert.match(one[0].title, /님이 👏/);
  assert.match(one[0].body, /대박/);
  reactToFeed(state, state.users.june, f.id, 'lol');
  const news = newsFor(state, 'hanseo', since).filter(n => n.type === 'REACTION');
  assert.equal(news.length, 1);
  assert.match(news[0].title, /외 1명이 반응했어요/);
  assert.equal(news[0].push, false);
  assert.equal(reactionNews(state, 'min', since).length, 0, 'reactors get nothing back');
  // Others see the moment itself in their news, with the reaction buttons on.
  const forMin = newsFor(state, 'min', since).find(n => n.id === f.id);
  assert.equal(forMin.reactable, true);
});

test('the new share scripts are in the offline shell', () => {
  const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  for (const f of ['js/share.js', 'js/brags.js']) assert.ok(sw.includes(`'${f}'`), f);
});
