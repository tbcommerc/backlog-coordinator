import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('Avatar consumers use the shared family and cannot restore local initials or colour algorithms',()=>{
 for(const file of ['app.js','components/admin.js','components/taskComments.js','components/workQueue.js','components/modal.js']){
  const s=read('js/'+file);assert.match(s,/import\s*\{[^}]*\bavatar(?:\s+as\s+\w+)?[^}]*\}\s*from\s*['"][^'"]*ui\/dataDisplay\.js['"]/s,file);assert.doesNotMatch(s,/getUserInitials|getAvatarColor|AVATAR_COLORS/,file);
 }
 assert.doesNotMatch(read('js/components/admin.js'),/id="user-avatar-preview"\s+style=/);
 assert.doesNotMatch(read('css/pages.css'),/\.settings-avatar\s*\{[^}]*\b(?:width|height|background|border-radius)\s*:/);
 assert.doesNotMatch(read('js/components/modal.js'),/class="task-detail-avatar"\s+style=/);
});
