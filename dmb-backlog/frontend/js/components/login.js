import { button, checkbox, control, field, fieldFrame, icon } from '../ui/primitives.js';
import { setButtonBusy } from '../ui/controls.js';

export function renderLogin() {
  return `<div id="login-screen" class="login-screen"><section class="login-card" aria-labelledby="login-title">
    <div class="login-body"><div class="login-brand"><span class="login-mark" aria-hidden="true">${icon('layers')}</span><strong>Backlog Coordinator</strong></div>
    <h1 id="login-title">Добро пожаловать</h1><p class="login-description">Введите учётные данные для продолжения</p>
    <form id="login-form" class="ui-editor-stack">
      ${field({id:'login-email',label:'Логин',type:'text',attrs:{autocomplete:'username',placeholder:'Выдан администратором',maxlength:254}})}
      ${fieldFrame({id:'login-password',label:'Пароль',controlMarkup:`<div class="ui-input-action">${control({id:'login-password',type:'password',attrs:{autocomplete:'current-password'}})}${button({label:'Показать пароль',icon:'eye',iconOnly:true,variant:'ghost',attrs:{id:'login-pw-toggle','aria-pressed':false},className:'login-password-toggle'})}</div>`})}
      <div class="login-options"><span id="login-support">Забыли пароль? Обратитесь к администратору.</span><a href="#/activate" id="login-activate">Есть код приглашения</a></div>
      <div id="login-error" class="ui-alert" data-ui-tone="danger" role="alert">${icon('alert-circle')}<span>Неверный пароль. Попробуйте ещё раз.</span></div>
      ${button({label:'Войти в систему',icon:'log-in',variant:'primary',attrs:{id:'login-btn',type:'submit'},className:'login-submit'})}
    </form></div><footer class="login-footer">© 2026 Backlog Coordinator</footer>
  </section></div>`;
}

export function initLogin(onSubmit) {
  const form=document.getElementById('login-form');
  const toggle=document.getElementById('login-pw-toggle');
  toggle.addEventListener('click',()=>{
    const input=document.getElementById('login-password');
    const reveal=input.type==='password';
    input.type=reveal?'text':'password';
    toggle.setAttribute('aria-pressed',String(reveal));
    toggle.setAttribute('aria-label',reveal?'Скрыть пароль':'Показать пароль');
    toggle.title=reveal?'Скрыть пароль':'Показать пароль';
    toggle.innerHTML=icon(reveal?'eye-off':'eye');
    window.lucide?.createIcons();
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    const submit=document.getElementById('login-btn');
    if(submit.disabled)return;
    const error=document.getElementById('login-error');
    error.style.display='none';
    setButtonBusy(submit,true,'Входим…');
    try {
      await onSubmit(document.getElementById('login-email').value,document.getElementById('login-password').value);
    } catch (e) { error.querySelector('span').textContent = e?.status === 429 ? 'Слишком много попыток. Подождите и повторите.' : e?.status === 401 ? 'Неверный логин или пароль.' : 'Сервис недоступен. Попробуйте позже.'; error.style.display='flex'; }
    finally { if(submit.isConnected)setButtonBusy(submit,false); }
  });
}
