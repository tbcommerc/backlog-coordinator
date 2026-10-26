import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dashboard = fs.readFileSync(path.join(here, '../js/components/dashboard.js'), 'utf8');
const pagesCss = fs.readFileSync(path.join(here, '../css/pages.css'), 'utf8');

test('month timeline loads reporting meetings inside the selected month', () => {
  assert.match(dashboard, /if \(st\.view === 'month'\) \{[\s\S]*dateFrom[\s\S]*dateTo[\s\S]*\/reporting-meetings\?include_closed=true&include_completeness=false&date_from=\$\{dateFrom\}&date_to=\$\{dateTo\}/);
  assert.match(dashboard, /event_type: 'reporting_meeting'/);
  assert.match(dashboard, /st\.events = \[\.\.\.timelineEvents, \.\.\.reportingMeetings\]/);
});

test('quarter timeline does not request reporting meetings', () => {
  const requestGuard = dashboard.match(/const requests = \[api\.get\(url\)\];([\s\S]*?)const \[timelineResult, meetingsResult\]/)?.[1] || '';
  assert.match(requestGuard, /if \(st\.view === 'month'\)/);
  assert.doesNotMatch(requestGuard, /if \(st\.view === 'quarter'\)[\s\S]*reporting-meetings/);
});

test('month marker labels are distributed across collision-free lanes', () => {
  assert.match(dashboard, /function layoutMonthMarkers\([\s\S]*laneEnds\.findIndex\([\s\S]*marker\.lane = lane/);
  assert.match(dashboard, /--month-marker-offset:\$\{\(markerLayout\.laneCount - 1\) \* 24\}px/);
  assert.match(dashboard, /--marker-lane-offset:\$\{marker\.lane \* 24\}px/);
  assert.match(pagesCss, /\.dash-quarter-bar-track-wrap--month \{[^}]*padding-top: calc\(24px \+ var\(--month-marker-offset, 0px\)\)/);
  assert.match(pagesCss, /\.dash-quarter-bar-track-wrap--month \.dash-marker-label \{[^}]*bottom: calc\(18px \+ var\(--marker-lane-offset, 0px\)\)/);
});
