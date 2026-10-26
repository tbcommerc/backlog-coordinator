import assert from 'node:assert/strict';
import test from 'node:test';
import {API} from '../js/api.js';

test('password setup succeeds on an empty 204 response with a JSON content type', async () => {
  const old = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(null, {status: 204, headers: {'Content-Type': 'application/json'}});
  };
  try {
    assert.equal(await new API().post('/auth/password/setup', {token: 'test-token', new_password: 'test-only-password'}), null);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = old;
  }
});

for (const path of ['/auth/login','/auth/password/change','/auth/password/setup','/auth/reauthenticate','/admin/users/1/password-reset']) {
  test(`sensitive request ${path} never retries after 401`,async()=>{
    const old=globalThis.fetch;let calls=0;
    globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({detail:'INVALID_CREDENTIALS'}),{status:401,headers:{'Content-Type':'application/json'}});};
    try { await assert.rejects(new API().post(path,{password:'not persisted'}),e=>e.status===401);assert.equal(calls,1); }finally{globalThis.fetch=old;}
  });
}
test('rotation conflict retries at most once',async()=>{
  const old=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;return new Response('{}',{status:409});};
  try{assert.equal(await new API().refreshToken(),false);assert.equal(calls,2);}finally{globalThis.fetch=old;}
});
test('refresh infrastructure outage does not masquerade as invalid credentials',async()=>{
  const old=globalThis.fetch;globalThis.fetch=async()=>new Response('{}',{status:503});
  try{await assert.rejects(new API().refreshToken(),e=>e.status===503);}finally{globalThis.fetch=old;}
});
