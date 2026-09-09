import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('../css/modal-system.css');
const index = read('../index.html');
const accessibility = read('../js/modalAccessibility.js');
const modal = read('../js/components/modal.js');
const reports = read('../js/components/reports.js');
const admin = read('../js/components/admin.js');
const express = read('../js/components/expressEstimate.js');
const catalog = read('../modal-catalog.html');

assert.match(index, /modal-system\.css\?v=2/);
assert.match(css, /\.modal-overlay:not\(#task-detail-overlay\):not\(#create-task-overlay\)/);
assert.match(css, /\.admin-modal-overlay/);
assert.match(css, /\.feedback-confirm-overlay/);
assert.match(css, /\.conflict-overlay/);
assert.match(css, /\.modal-backdrop/);
assert.match(css, /dialog\.customer-reference-dialog::backdrop/);
assert.match(css, /\.app-modal--small\s*\{\s*--modal-width:\s*420px/);
assert.match(css, /\.app-modal--medium\s*\{\s*--modal-width:\s*680px/);
assert.match(css, /\.app-modal--large\s*\{\s*--modal-width:\s*920px/);
assert.match(css, /max-height:\s*calc\(100dvh - 32px\)/);
assert.match(css, /\.modal-close,[\s\S]*?width:\s*40px;[\s\S]*?height:\s*40px/);
assert.match(css, /@media \(max-width:\s*640px\)[\s\S]*?\.modal-close,[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px/);
assert.match(css, /\.feedback-confirm-actions\) \{[\s\S]*?padding:\s*16px 24px;[\s\S]*?gap:\s*10px;/);
assert.match(css, /\.conflict-btn-ghost\) \{[\s\S]*?border:\s*1px solid color-mix/);
assert.match(css, /@media \(max-width:\s*640px\)[\s\S]*?\.feedback-confirm-actions\) \{[\s\S]*?padding:\s*14px 16px;/);

assert.match(accessibility, /\.conflict-overlay, \.modal-backdrop, dialog/);
assert.match(accessibility, /overlay\.matches\('dialog, \[role="dialog"\], \[role="alertdialog"\]'\)/);
assert.match(accessibility, /!overlay\.matches\('dialog'\) \|\| overlay\.open/);
assert.match(accessibility, /else if \(dialog\.matches\('dialog'\)\) dialog\.close\(\)/);

assert.doesNotMatch(reports, /window\.confirm\s*\(/);
assert.match(reports, /await confirmAction\(\{/);
assert.match(admin, /class="modal modal-timeline" role="dialog" aria-modal="true"/);
assert.match(admin, /class="modal-footer">[\s\S]*?id="tl-modal-cancel"[\s\S]*?id="tl-modal-save"/);
assert.match(express, /class="app-modal app-modal--medium" role="dialog"/);
assert.match(modal, /class="conflict-modal conflict-modal--wide" role="alertdialog"/);
assert.match(catalog, /Все модальные окна системы/);
assert.equal((catalog.match(/\{ id:'[^']+', group:'/g) || []).length, 35);
assert.match(catalog, /data-modal-scenario=/);
assert.match(catalog, /document\.documentElement\.dataset\.ready = 'true'/);

// Особая композиция карточки задачи остаётся отдельным workspace-контрактом.
assert.match(css, /Карточка задачи: только более заметное закрытие, без изменения layout/);
assert.match(css, /:is\(#task-detail-overlay, #create-task-overlay\) :is\(\.iconbtn\.close, \.task-detail-btn-close\)/);
assert.match(modal, /class="task-detail-modal modal" id="task-detail-modal"/);
assert.match(read('../css/components.css'), /:is\(#task-detail-overlay, #create-task-overlay\):not\(\.modal-closing\) \.task-detail-modal/);
assert.match(modal, /<div class="mhead" id="mhead"><\/div>/);
assert.match(modal, /<div class="tabs" id="tabs">/);
assert.match(modal, /<div class="mbody" id="mbody"><\/div>/);
assert.match(modal, /<div class="mfoot" id="mfoot"><\/div>/);
