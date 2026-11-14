// Pure calculations and rendering smoke checks; this does not replace browser QA.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'data.json')));

function app() {
  const elements = new Map([...fs.readFileSync(path.join(root, 'index.html'), 'utf8').matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, {
    innerHTML: '', textContent: '', checked: false, hidden: id === 'load-error', value: '',
    setAttribute() {}, addEventListener() {}, showModal() { this.open = true; }, close() { this.open = false; },
  }]));
  const document = { getElementById: id => elements.get(id), querySelectorAll: () => [], addEventListener() {} };
  const context = vm.createContext({ document, window: { matchMedia: () => ({ matches: false }) }, console, Intl, Date });
  vm.runInContext(fs.readFileSync(path.join(root, 'chronicle.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'app.js'), 'utf8').replace(/\nstart\(\);\s*$/, ''), context);
  context.fixture = structuredClone(snapshot);
  vm.runInContext('state.members = fixture.members; initChronicle(fixture);', context);
  return { context, elements, run: source => vm.runInContext(source, context) };
}

test('every chapter renders the real snapshot without exceptions', () => {
  const { run, elements } = app();
  run('renderGuildStats(fixture); renderClassBreakdown(); renderSquadSwitch(); renderTrivia(); renderRoster();');
  for (const id of ['guild-stats', 'trivia-grid', 'legacy-list', 'dungeon-grid', 'roster-body', 'highlight-grid']) assert.ok(elements.get(id).innerHTML.length > 20, id);
  assert.match(elements.get('dungeon-grid').innerHTML, /: Cleared/);
  assert.match(elements.get('dungeon-grid').innerHTML, /Cleared/);
  for (const m of snapshot.members) run(`characterDetails(memberById(${m.id}));`);
});

test('weekly deltas exclude missing baselines and counter resets', () => {
  const { run } = app();
  assert.equal(run(`weeklyValue({ dataAvailable: true, history: [{at:'2026-11-13T12:00:00Z',stats:{1518:10}},{at:'2026-11-13T13:00:00Z',stats:{1518:14}}]},1518)`), 4);
  assert.equal(run(`weeklyValue({ dataAvailable: true, history: [{at:'2026-11-13T12:00:00Z',stats:{1518:10}},{at:'2026-11-13T13:00:00Z',stats:{1518:2}}]},1518)`), null);
  assert.equal(run(`weeklyValue({ dataAvailable: true, history: [{at:'2026-11-13T12:00:00Z',stats:{1518:10}}]},1518)`), null);
});

test('linked accounts deduplicate challenge IDs and never infer links from rank', () => {
  const { run } = app();
  run(`state.members = [{id:1,name:'Main',rank:0,legacy:{available:true,challenges:[{id:42,points:1,completed:true}]}},{id:2,name:'Alt',rank:6,legacy:{available:true,challenges:[{id:42,points:1,completed:true},{id:43,points:1,completed:true}]}}]; fixture.config.accounts=[];`);
  assert.equal(run('legacyAccounts().length'), 2);
  run(`fixture.config.accounts=[{name:'Player',characterIds:[1,2]}];`);
  assert.equal(run('legacyAccounts().length'), 1);
  assert.equal(run('legacyAccounts()[0].points'), 2);
});

test('mixed selection crosses squad boundaries and excludes everyone else', () => {
  const { run } = app();
  const ids = run(`const a = state.members.find(m=>squadOf(m)==='a'); const b = state.members.find(m=>squadOf(m)==='b'); chronicle.party = new Set([String(a.id),String(b.id)]); dungeonMembers().map(m=>m.id);`);
  assert.equal(ids.length, 2);
  assert.equal(run(`new Set(dungeonMembers().map(squadOf)).size`), 2);
});

test('dungeon evidence dialog and complete award list render', () => {
  const { run, elements } = app();
  run(`showDungeon('city-of-dalaran', fixture.members[0].id); chronicle.allAwards=true; renderAwards();`);
  assert.equal(elements.get('record-dialog').open, true);
  assert.match(elements.get('record-content').innerHTML, /Shade of the Archmage/);
  assert.equal((elements.get('trivia-grid').innerHTML.match(/class="trivia-card"/g) || []).length, 10);
});

test('public names are escaped in roster and character details', () => {
  const { run, elements } = app();
  run(`state.members[0].name='<img src=x onerror=alert(1)>'; state.squadFilter='all'; renderRoster();`);
  assert.ok(elements.get('roster-body').innerHTML.includes('&lt;img'));
  assert.ok(!elements.get('roster-body').innerHTML.includes('<img src=x'));
});
