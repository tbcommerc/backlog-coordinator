import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const notificationStore = fs.readFileSync(new URL('../js/notificationStore.js', import.meta.url), 'utf8');
const dashboard = fs.readFileSync(new URL('../js/components/dashboard.js', import.meta.url), 'utf8');
const settings = fs.readFileSync(new URL('../js/components/settings.js', import.meta.url), 'utf8');
const componentsCss = fs.readFileSync(new URL('../css/components.css', import.meta.url), 'utf8');
const pagesCss = fs.readFileSync(new URL('../css/pages.css', import.meta.url), 'utf8');

assert.match(app, /aria-controls="notif-dropdown"/, 'bell must own the popup semantically');
assert.match(app, /aria-expanded/, 'bell must expose popup state');
assert.match(app, /<button type="button" class="notif-dropdown-item/, 'popup notifications must be keyboard controls');
assert.match(app, /data-retry-notifications/, 'popup errors must be recoverable');
assert.match(app, /openNotificationTarget/, 'popup must use the shared target contract');
assert.match(dashboard, /action_items/, 'dashboard action queue must include server-defined required actions');
assert.match(dashboard, /recent_items/, 'dashboard action queue must also include unread actionable notifications');
assert.match(dashboard, /seen\.has\(key\)/, 'dashboard action queue must deduplicate notifications with the same target');
assert.match(dashboard, /\.slice\(0, 4\)/, 'dashboard must keep the action queue focused');
assert.match(dashboard, /Ближайшие даты/, 'dashboard must expose a separate upcoming-dates list');
assert.match(dashboard, /\/reporting-meetings\?include_closed=false/, 'upcoming dates must include scheduled reporting meetings');
assert.match(dashboard, /\/timeline\?year=/, 'upcoming dates must include project calendar events');
assert.doesNotMatch(dashboard, />К календарю</, 'upcoming dates must not link to the calendar');
assert.match(dashboard, /dashboard-workspace/, 'dashboard must place operational lists below the retained timeline');
assert.deepEqual(
  [...dashboard.matchAll(/data-tl-action="view-(month|quarter)"/g)].map(match => match[1]),
  ['month', 'quarter', 'month', 'quarter'],
  'timeline view switch must place month before quarter in both render modes',
);
assert.match(dashboard, /notificationCategoryMeta/, 'dashboard and notification center must share category presentation metadata');
assert.match(dashboard, /notificationImportanceMeta/, 'dashboard and notification center must share importance presentation metadata');
assert.match(dashboard, /notificationActionLabel/, 'dashboard and notification center must share action copy');
assert.match(dashboard, /app\.notificationStore\?\.snapshot \|\| null/, 'dashboard initialization must reuse an already loaded atomic snapshot');
assert.match(dashboard, /cachedSnapshot/, 'dashboard refresh failure must preserve the last successful snapshot');
assert.match(dashboard, /Показаны последние полученные действия/, 'stale dashboard data must be labeled without replacing the action cards');
assert.match(app, /createNotificationStore/, 'notification surfaces must share one client-side store');
assert.match(notificationStore, /\/notifications\/snapshot/, 'the shared store must consume the atomic snapshot endpoint');
assert.match(dashboard, /data-action-url/, 'dashboard must preserve exact targets');
assert.match(dashboard, /openNotificationTarget/, 'dashboard must use the shared target contract');
assert.match(pagesCss, /\.dash-notif-item\.is-unread\s*\{[^}]*border-color:\s*color-mix[^}]*background:\s*color-mix/, 'dashboard unread cards must match the notification center state treatment');
assert.match(pagesCss, /\.dash-notif-item\.is-read:not\(\.is-resolved\)\s*\{[^}]*border-color:\s*color-mix[^}]*background:\s*color-mix/, 'dashboard read cards must match the notification center state treatment');
assert.match(pagesCss, /\.dash-notif-stale\s*\{[^}]*var\(--warning\)/, 'dashboard stale state must use a non-destructive warning treatment');
assert.match(pagesCss, /\.dashboard-workspace\s*\{[^}]*grid-template-columns:/, 'dashboard operational lists must use a responsive grid');
assert.match(pagesCss, /\.dashboard-workspace\s*\{[^}]*align-items:\s*stretch/, 'dashboard panels must share the same desktop row height');
assert.match(pagesCss, /\.dashboard-workspace \.widget-header\s*\{[^}]*height:\s*72px[^}]*min-height:\s*72px/, 'dashboard panel headers must have the same fixed desktop height');
assert.match(pagesCss, /\.dashboard-workspace \.widget-body\s*\{[^}]*overflow:\s*visible/, 'dashboard lists must not create nested scrolling regions');
assert.match(pagesCss, /\.dash-notif-action\s*\{[\s\S]*?font-size:\s*11px/, 'dashboard action labels must remain visible on narrow screens');
assert.match(settings, /Изменения не сохранены/, 'preference failure must be explicit');
assert.match(settings, /applyNotificationPrefs\(savedNotificationPrefs\)/, 'failed optimistic preferences must roll back');
assert.doesNotMatch(componentsCss, /\.notification-card\.is-resolved\s*\{\s*opacity:/, 'resolved cards must not fade all content');
assert.match(componentsCss, /\.notification-card\.is-read:not\(\.is-resolved\)\s*\{[^}]*border-color:\s*color-mix[^}]*background:\s*color-mix/, 'read cards must use a visibly muted background and border without fading the whole card');
assert.match(componentsCss, /\.notification-card\.is-read:not\(\.is-resolved\)[^}]*\.notification-card-meta\s*\{\s*color:\s*var\(--text-muted\)/, 'read card copy and metadata must use the muted text color');
assert.doesNotMatch(componentsCss, /\.notification-card\.is-read[^}]*opacity:/, 'read cards must preserve accessible controls and priority contrast');
assert.match(componentsCss, /\.notification-title-priority\s*\{[^}]*align-self:\s*center/, 'priority chip must be vertically centered against the notification title');
assert.match(componentsCss, /\.notification-card\.is-unread\s*\{[^}]*border-color:\s*color-mix[^}]*background:\s*color-mix/, 'unread cards must have an explicit accent surface');
assert.match(componentsCss, /\.notification-card\.is-unread::before\s*\{\s*background:\s*var\(--accent\)/, 'unread cards must have an accent status stripe');
assert.match(componentsCss, /\.notification-new-label\s*\{[^}]*background:\s*var\(--accent\)[^}]*color:\s*#fff/, 'unread text label must remain clearly visible');
assert.match(componentsCss, /\.notification-card-actions \.btn-primary\s*\{[^}]*width:\s*160px[^}]*flex:\s*0 0 160px/, 'all notification primary actions must have the same fixed width');
assert.match(componentsCss, /\.notification-toolbar\s*\{[^}]*background:\s*var\(--bg-secondary\)/, 'notification filters must use the shared neutral toolbar surface');
assert.match(componentsCss, /\.notification-toolbar\s*\{[^}]*grid-template-columns:\s*max-content minmax\(0,1fr\) max-content/, 'notification state switch and reset must keep intrinsic widths on wide screens');
assert.match(componentsCss, /\.notification-state-filter\s*\{[^}]*width:\s*max-content[^}]*max-width:\s*100%/, 'notification state filter must not stretch into unused toolbar space');
assert.doesNotMatch(componentsCss, /\.notification-search/, 'removed notification search must not leave dead layout styles');
assert.match(componentsCss, /\.filter-chip\s*\{[^}]*border-radius:\s*var\(--radius-full\)[^}]*cursor:\s*pointer/, 'all notification filter groups must inherit the shared interactive chip contract');
assert.match(componentsCss, /\.notification-importance-chip\.importance-high\.active\s*\{[^}]*var\(--warning\)/, 'selected high-priority chip must preserve its semantic color');
assert.match(componentsCss, /#notifications-load-more\[hidden\][^{]*\{\s*display:\s*none/, 'hidden notification pagination must override shared button display');
assert.match(componentsCss, /\.notification-load-more:has\(#notifications-load-more\[hidden\]\)\s*\{\s*display:\s*none/, 'empty pagination wrapper must not leave vertical spacing');

console.log('notificationSurfaces.test.mjs: OK');
