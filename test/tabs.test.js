import test from 'node:test';
import assert from 'node:assert/strict';
import { readCurrentTabs } from '../src/tabs.js';
test('일반 창에서 현재 창만 조회', async () => {
  const tabs=[{index:0,url:'https://example.com'}];
  const api={windows:{getCurrent:async()=>({type:'normal'})},tabs:{query:async query=>{assert.deepEqual(query,{currentWindow:true}); return tabs;}}};
  assert.equal(await readCurrentTabs(api),tabs);
});
test('시크릿·팝업 창에서는 조회하지 않음', async () => {
  for (const window of [{type:'normal',incognito:true},{type:'popup'}]) {
    await assert.rejects(readCurrentTabs({windows:{getCurrent:async()=>window},tabs:{query:()=>assert.fail('must not query')}}));
  }
});
test('API 부재·조회 실패는 빈 성공으로 바꾸지 않음', async () => {
  await assert.rejects(readCurrentTabs({}));
  await assert.rejects(readCurrentTabs({windows:{getCurrent:async()=>({type:'normal'})},tabs:{query:async()=>{throw Error('denied');}}}),/denied/);
});
