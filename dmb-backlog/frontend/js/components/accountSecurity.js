import { credentialLabel } from '../adminLabels.js';
import { button, field } from '../ui/primitives.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const policyErrors = {PASSWORD_LENGTH_INVALID:'Пароль не соответствует допустимой длине.',PASSWORD_CONTROL_CHARACTER:'Уберите управляющие символы из пароля.',PASSWORD_TOO_COMMON:'Выберите менее распространённый пароль, отличный от логина.',PASSWORD_UNCHANGED:'Новый пароль должен отличаться от текущего.',SETUP_TOKEN_INVALID:'Код недействителен. Получите новое приглашение у администратора.',CURRENT_PASSWORD_INVALID:'Текущий пароль неверен.'};
export const securityError = e => policyErrors[e?.message] || ( e?.status === 429 ? 'Слишком много попыток. Подождите и повторите.' : e?.status === 401 ? 'Пароль неверен или сессия завершена. Войдите снова.' : e?.status >= 500 || !e?.status ? 'Сервис недоступен. Попробуйте позже.' : 'Действие не выполнено. Проверьте данные и срок действия кода.');
const passwordField = (id, label, current = false) => `${field({id,label,type:'password',required:true,attrs:{autocomplete:current?'current-password':'new-password',maxlength:128}})}${button({label:'Показать / скрыть пароль',variant:'ghost',attrs:{'data-reveal':id,'aria-label':'Показать пароль: '+label,'aria-pressed':false}})}`;
function reveal(root) { root.querySelectorAll('[data-reveal]').forEach(b => b.onclick = () => { const i=root.querySelector('#'+b.dataset.reveal); const revealed=i.type==='password'; i.type=revealed?'text':'password'; b.setAttribute('aria-pressed',String(revealed)); }); }
function feedback(root, text) { root.querySelector('[role="alert"]').textContent=text; }

export function clearAccount(app) {
    app.api.setAccessToken(null);
    app.store?.set('currentUser', null);
    localStorage.removeItem('dmb_user');
    app.auth.channel?.postMessage({type:'logout'});
    location.hash='/login';
    app.renderLoginPage();
}

export function renderSecurity(app) {
    const user=app.store.get('currentUser');
    return `<section class="settings-page account-security-page ui-editor-stack"><h1>Безопасность</h1><p>Логин: <strong>${escape(user?.login)}</strong></p><p>Пароль изменён: ${escape(user?.password_changed_at || 'нет данных')}</p>
    <p>От 15 до 128 символов. Можно использовать пробелы и кириллицу.</p>
    <form id="security-password" class="ui-editor-stack">${passwordField('security-current','Текущий пароль',true)}${passwordField('security-new','Новый пароль')}${passwordField('security-repeat','Повтор нового пароля')}${button({label:'Изменить пароль и выйти со всех устройств',variant:'primary',attrs:{type:'submit'}})}</form>
    <p role="alert" aria-live="polite"></p><h2>Активные сессии</h2><p>Браузер и адрес — приблизительные сведения. VPN может объединять устройства.</p><div id="security-sessions"></div>${button({label:'Завершить остальные сессии',attrs:{id:'security-revoke-others'}})}<h2>События безопасности</h2>${user?.permissions?.admin==='full'?button({label:'Журнал всех пользователей',attrs:{id:'security-admin-events'}}):''}<div id="security-events"></div>${button({label:'Предыдущие события',attrs:{id:'security-more'}})}</section>`;
}

export async function initSecurity(app) {
    const root=document.querySelector('.settings-page');
    reveal(root);
    const form=root.querySelector('form');
    form.onsubmit=async event=>{
        event.preventDefault();
        const current=root.querySelector('#security-current'), next=root.querySelector('#security-new'), repeat=root.querySelector('#security-repeat');
        if(next.value!==repeat.value) { feedback(root,'Пароли не совпадают.'); return; }
        const submit=form.querySelector('[type="submit"]'); submit.disabled=true;
        try { await app.api.post('/auth/password/change',{current_password:current.value,new_password:next.value}); form.reset(); clearAccount(app); window.toast?.('Пароль изменён. Войдите снова.','success'); }
        catch(e) { feedback(root,securityError(e)); }
        finally { submit.disabled=false; }
    };
    async function loadSessions() {
        const rows=await app.api.get('/auth/sessions');
        const list=root.querySelector('#security-sessions');
        list.innerHTML=rows.map(r=>`<article class="ui-editor-stack"><strong>${r.is_current?'Это устройство':'Другая сессия'}</strong><span>${escape(r.client_label)}</span><span>${escape(r.ip_address)} · Создана ${escape(r.created_at)} · Активность ${escape(r.last_activity_at)}</span>${button({label:'Завершить',attrs:{'data-session':r.id}})}</article>`).join('');
        list.querySelectorAll('[data-session]').forEach(b=>b.onclick=async()=>{ try { await app.api.delete('/auth/sessions/'+b.dataset.session); if(rows.find(r=>r.id===b.dataset.session)?.is_current)clearAccount(app); else await loadSessions(); }catch(e){feedback(root,securityError(e));} });
    }
    root.querySelector('#security-revoke-others').onclick=async()=>{try{ const reauth_token=await confirmCredentials(app,'revoke_others',null,'Завершить все остальные сессии'); await app.api.post('/auth/sessions/revoke-others',{reauth_token}); await loadSessions(); }catch(e){if(e)feedback(root,securityError(e));}};
    let page=1, allEvents=false;
    async function loadEvents() { const result=await app.api.get((allEvents?'/admin/security-events':'/auth/security-events')+'?page='+page); root.querySelector('#security-events').innerHTML=result.items.map(e=>`<p>${escape(e.created_at)} · ${escape(e.action)} · ${escape(e.outcome)}</p>`).join('') || '<p>Событий нет</p>'; }
    const adminEvents=root.querySelector('#security-admin-events');
    if(adminEvents) adminEvents.onclick=async()=>{allEvents=!allEvents;page=1;adminEvents.textContent=allEvents?'Только мои события':'Журнал всех пользователей';try{await loadEvents();}catch(e){feedback(root,securityError(e));}};
    root.querySelector('#security-more').onclick=async()=>{page++; try{await loadEvents();}catch(e){feedback(root,securityError(e));}};
    try { await Promise.all([loadSessions(),loadEvents()]); } catch(e){feedback(root,securityError(e));}
}

export function confirmCredentials(app,purpose,target,title) {
    return new Promise((resolve,reject)=>{
        const dialog=document.createElement('dialog'); dialog.className='account-security-dialog ui-editor-stack';
        dialog.innerHTML=`<form class="ui-editor-stack"><h2>${escape(title)}</h2>${passwordField('reauth-password','Ваш текущий пароль',true)}<p role="alert"></p>${button({label:'Подтвердить',variant:'primary',attrs:{type:'submit'}})}${button({label:'Отмена',attrs:{id:'reauth-cancel'}})}</form>`;
        document.body.append(dialog); reveal(dialog); dialog.showModal(); dialog.querySelector('input').focus();
        const close=()=>{dialog.querySelector('form').reset();dialog.close();dialog.remove();};
        dialog.oncancel=e=>{e.preventDefault();close();reject(null);};
        dialog.querySelector('#reauth-cancel').onclick=()=>{close();reject(null);};
        dialog.querySelector('form').onsubmit=async e=>{e.preventDefault();const b=dialog.querySelector('[type="submit"]');b.disabled=true;try{const result=await app.api.post('/auth/reauthenticate',{password:dialog.querySelector('input').value,purpose,target_user_id:target});close();resolve(result.token);}catch(error){feedback(dialog,securityError(error));}finally{b.disabled=false;}};
    });
}

export function showOneTimeSecret(result, recipient) {
    const dialog=document.createElement('dialog');dialog.className='account-security-dialog ui-editor-stack';
    dialog.innerHTML=`<h2>Одноразовый код для ${escape(recipient)}</h2><p>Действует до ${escape(result.expires_at)}. Передайте адрес формы и код через разрешённый корпоративный канал после проверки личности.</p><p>${escape(location.origin+location.pathname+'#/activate')}</p><output></output>${button({label:'Скопировать код',attrs:{id:'copy-secret'}})}${button({label:'Закрыть',attrs:{id:'close-secret'}})}<p role="alert"></p>`;
    let token=result.token;result.token=null;dialog.querySelector('output').textContent=token;
    const close=()=>{token=null;dialog.textContent='';dialog.close();dialog.remove();};
    dialog.oncancel=e=>{e.preventDefault();close();};dialog.querySelector('#close-secret').onclick=close;
    dialog.querySelector('#copy-secret').onclick=async()=>{try{await navigator.clipboard.writeText(token);feedback(dialog,'Код скопирован.');}catch{feedback(dialog,'Не удалось скопировать. Выделите код вручную.');}};
    document.body.append(dialog);dialog.showModal();
}

export function showSetup(app) {
    let token=new URLSearchParams(location.hash.split('?')[1]||'').get('token')||'';
    history.replaceState(null,'',location.pathname+location.search+'#/activate');
    const root=document.getElementById('app');
    root.innerHTML=`<section class="login-card account-setup ui-editor-stack"><h1>Задать пароль</h1><p>От 15 до 128 символов. Пароль задаёте только вы.</p><form class="ui-editor-stack">${field({id:'setup-code',label:'Одноразовый код',required:true,attrs:{autocomplete:'off',maxlength:128}})}${passwordField('setup-new','Новый пароль')}${passwordField('setup-repeat','Повтор пароля')}${button({label:'Установить пароль',variant:'primary',attrs:{type:'submit'}})}</form><p role="alert"></p><a href="#/login" id="setup-login">Вернуться ко входу</a></section>`;
    root.querySelector('#setup-code').value=token;token=null;reveal(root);
    root.querySelector('#setup-login').onclick=()=>{root.querySelector('form').reset();app.renderLoginPage();};
    root.querySelector('form').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget, b=form.querySelector('[type="submit"]');if(root.querySelector('#setup-new').value!==root.querySelector('#setup-repeat').value){feedback(root,'Пароли не совпадают.');return;}b.disabled=true;try{await app.api.post('/auth/password/setup',{token:root.querySelector('#setup-code').value,new_password:root.querySelector('#setup-new').value});form.reset();location.hash='/login';app.renderLoginPage();window.toast?.('Пароль установлен. Войдите с вашим логином.','success');}catch(error){feedback(root,securityError(error));}finally{b.disabled=false;}};
}

export async function manageAccount(app,user,onComplete) {
    const dialog=document.createElement('dialog');dialog.className='account-security-dialog ui-editor-stack';
    const labels={invitation:'Выдать приглашение',password_reset:'Сбросить доступ',revoke_sessions:'Завершить все сессии',change_login:'Изменить логин',access_state:user.is_active?'Отключить':'Включить'};
    dialog.innerHTML=`<form class="ui-editor-stack"><h2>Доступ: ${escape(user.name)}</h2><p>${escape(user.login)} · ${escape(credentialLabel(user.credential_state))}</p><label for="account-action">Действие</label><select class="input ui-control ui-control" id="account-action">${Object.entries(labels).filter(([k])=>k!=='invitation'||user.credential_state==='invited').map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select>${field({id:'account-reason',label:'Основание / номер обращения',attrs:{maxlength:256}})}${field({id:'account-login',label:'Новый логин (только для смены логина)',attrs:{maxlength:254}})}<p>Сброс и отключение немедленно закрывают доступ. Код передаётся только после проверки личности.</p><p role="alert"></p>${button({label:'Продолжить',variant:'primary',attrs:{type:'submit'}})}${button({label:'Закрыть',attrs:{id:'account-close'}})}</form>`;
    const close=()=>{dialog.textContent='';dialog.close();dialog.remove();};dialog.oncancel=e=>{e.preventDefault();close();};dialog.querySelector('#account-close').onclick=close;
    dialog.querySelector('form').onsubmit=async e=>{e.preventDefault();const purpose=dialog.querySelector('select').value;const reason=dialog.querySelector('#account-reason').value;if(purpose!=='invitation'&&!reason.trim()){feedback(dialog,'Укажите основание.');return;}const b=dialog.querySelector('[type="submit"]');b.disabled=true;try{
        const reauth_token=await confirmCredentials(app,purpose,user.id,labels[purpose]+' — '+user.name);
        const body={reauth_token};if(purpose!=='invitation')body.reason=reason;if(purpose==='change_login')body.login=dialog.querySelector('#account-login').value;if(purpose==='access_state')body.is_active=!user.is_active;
        const paths={invitation:'invitation',password_reset:'password-reset',revoke_sessions:'revoke-sessions',change_login:'login',access_state:'access-state'};
        const result=await app.api.request(['change_login','access_state'].includes(purpose)?'PATCH':'POST','/admin/users/'+user.id+'/'+paths[purpose],body);
        close();await onComplete?.();if(result.token)showOneTimeSecret(result,user.login);else window.toast?.('Доступ обновлён','success');
    }catch(error){if(error)feedback(dialog,securityError(error));}finally{b.disabled=false;}};
    document.body.append(dialog);dialog.showModal();
}
