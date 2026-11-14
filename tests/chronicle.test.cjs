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
    setAttribute() {}, addEventListener() {}, focus() {}, showModal() { this.open = true; }, close() { this.open = false; },
  }]));
  const documentListeners = {};
  const document = { getElementById: id => elements.get(id), querySelectorAll: () => [], addEventListener(type, handler) { documentListeners[type] = handler; } };
  const context = vm.createContext({ document, window: { matchMedia: () => ({ matches: false }) }, console, Intl, Date });
  vm.runInContext(fs.readFileSync(path.join(root, 'chronicle.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'app.js'), 'utf8').replace(/\nstart\(\);\s*$/, ''), context);
  context.fixture = structuredClone(snapshot);
  vm.runInContext('state.members = fixture.members; initChronicle(fixture);', context);
  return { context, elements, documentListeners, run: source => vm.runInContext(source, context) };
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

test('Legacy stays per character and excludes conflicting completion records', () => {
  const { run } = app();
  run(`state.members = [{id:1,name:'Main',rank:0,legacy:{available:true,challenges:[{id:42,points:1,completed:true},{id:44,points:1,completed:true,conflicting:true}]}},{id:2,name:'Alt',rank:6,legacy:{available:true,challenges:[{id:42,points:1,completed:true},{id:43,points:1,completed:true}]}}]; fixture.config.accounts=[];`);
  assert.equal(run('legacyAccounts().length'), 2);
  run(`fixture.config.accounts=[{name:'Player',characterIds:[1,2]}];`);
  assert.equal(run('legacyAccounts().length'), 2);
  assert.equal(run('legacyAccounts().find(a=>a.name==="Main").points'), 1);
  assert.equal(run('legacyAccounts().find(a=>a.name==="Alt").points'), 2);
});

test('newest activity wins, category priority resolves same-snapshot ties, and roster order is stable', () => {
  const { run } = app();
  const result = run(`
    const older = activityCandidate({at:'2026-11-14T10:00:00Z',category:'dungeon',headline:'old clear',sequence:0});
    const latestFunny = activityCandidate({at:'2026-11-14T11:00:00Z',category:'mischief',headline:'funny',sequence:3});
    const latestLevel = activityCandidate({at:'2026-11-14T11:00:00Z',category:'level',headline:'level',sequence:2});
    const latestClear = activityCandidate({at:'2026-11-14T11:00:00Z',category:'dungeon',headline:'clear',sequence:0});
    const selected = selectLatestActivity([older, latestFunny, latestLevel, latestClear]);
    const ordered = orderActivityRows([{at:'2026-11-14T11:00:00Z',memberOrder:1},{at:'2026-11-14T11:00:00Z',memberOrder:0},{at:'2026-11-14T10:00:00Z',memberOrder:2}]);
    [selected.headline, ordered.map(row=>row.memberOrder).join(',')];
  `);
  assert.equal(result[0], 'clear');
  assert.equal(result[1], '0,1,2');
});

test('profession and funny-stat milestones require prior evidence and meaningful thresholds', () => {
  const { run } = app();
  assert.equal(run('milestoneCrossed(12, 19, [10,25,50])'), null);
  assert.equal(run('milestoneCrossed(24, 53, [10,25,50])'), 50);
  assert.equal(run('milestoneCrossed(null, 100, [100])'), null);
  assert.equal(run(`detectProfessionMilestone(null, [{name:'Engineering',skill:150}])`), null);
  assert.equal(run(`detectProfessionMilestone([{name:'Engineering',skill:149}], [{name:'Engineering',skill:152}]).skill`), 150);
  assert.equal(run(`detectProfessionMilestone([{name:'Engineering',skill:149}], [{name:'Engineering',skill:149}])`), null);
});

test('activity shows eight entries first and its control expands and collapses the feed', () => {
  const { run, elements, documentListeners } = app();
  run(`
    const at = Date.parse(fixture.generatedAt);
    state.members = Array.from({length:10}, (_,i) => ({
      id:i+1,name:'Member '+i,level:20,dataAvailable:true,history:[
        {at:new Date(at-3600000).toISOString(),level:20,clears:[],legacy:[],stats:{},professions:[]},
        {at:new Date(at-60000-i).toISOString(),level:21,clears:[],legacy:[],stats:{},professions:[]}
      ]
    }));
    renderHighlights();
  `);
  assert.equal((elements.get('highlight-grid').innerHTML.match(/class="activity-row"/g) || []).length, 8);
  assert.match(elements.get('highlight-grid').innerHTML, /data-member="1"/);
  assert.equal(elements.get('more-activity').textContent, 'Show more activity');
  run('openCharacter = id => { window.lastOpened = id; };');
  const characterLink = { id: '', dataset: { member: '1' }, closest() { return this; } };
  documentListeners.click({ target: characterLink });
  assert.equal(run('window.lastOpened'), '1');
  const button = { id: 'more-activity', dataset: {}, closest() { return this; } };
  documentListeners.click({ target: button });
  assert.equal((elements.get('highlight-grid').innerHTML.match(/class="activity-row"/g) || []).length, 10);
  assert.equal(elements.get('more-activity').textContent, 'Show less activity');
  documentListeners.click({ target: button });
  assert.equal((elements.get('highlight-grid').innerHTML.match(/class="activity-row"/g) || []).length, 8);
});

test('relative update age uses snapshot time and handles invalid or future timestamps', () => {
  const { run } = app();
  const now = Date.parse('2026-11-14T12:00:00Z');
  assert.equal(run(`relativeAge('2026-11-14T11:25:00Z', ${now})`), '35 min ago');
  assert.equal(run(`relativeAge('2026-11-14T10:00:00Z', ${now})`), '2 hours ago');
  assert.equal(run(`relativeAge('2026-11-13T12:00:00Z', ${now})`), 'Yesterday');
  assert.equal(run(`relativeAge('2026-11-12T12:00:00Z', ${now})`), '2 days ago');
  assert.equal(run(`relativeAge('not-a-date', ${now})`), 'Update age unavailable');
  assert.equal(run(`relativeAge('2026-11-14T12:01:00Z', ${now})`), 'Just now');
});

test('Legacy rows show per-character points, a progress bar, and no next-reward copy', () => {
  const { run, elements } = app();
  run(`state.members = [{id:7,name:'Mara Example',className:'Mage',stale:true,legacy:{available:true,challenges:[
    {id:101,completed:true,conflicting:false},{id:102,completed:true,conflicting:true}
  ]}}]; renderLegacy();`);
  const html = elements.get('legacy-list').innerHTML;
  assert.match(html, /Mara Example/);
  assert.match(html, /1 \/ 65/);
  assert.match(html, /Character records only · retained/);
  assert.match(html, /class="legacy-progress"/);
  assert.doesNotMatch(html, /next reward|2 more observed/i);
  assert.match(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /Unlinked characters show only points confirmed on their profile\. Account totals may be higher\./);
});

test('dungeon and award filters remain wired to their current state', () => {
  const { run, documentListeners, elements } = app();
  const dungeonFilter = { id: '', dataset: { dungeonSquad: 'b' }, closest() { return this; } };
  documentListeners.click({ target: dungeonFilter });
  assert.equal(run('chronicle.dungeonSquad'), 'b');
  assert.equal(run(`dungeonMembers().every(member => squadOf(member) === 'b')`), true);
  const awardFilter = { id: '', dataset: { awardPeriod: 'week' }, closest() { return this; } };
  documentListeners.click({ target: awardFilter });
  assert.equal(run('chronicle.awardPeriod'), 'week');
  assert.match(elements.get('award-coverage').textContent, /Observed gains since Monday/);
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
