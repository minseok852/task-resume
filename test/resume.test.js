import test from 'node:test';
import assert from 'node:assert/strict';
import {openSavedUrl,openReferences} from '../src/tabs.js';
function fixture(tabs=[]) {
  const calls=[];
  const api={windows:{getCurrent:async()=>({id:1,type:'normal'}),get:async id=>({id,type:'normal'}),update:async(id,options)=>calls.push(['focus',id,options])},tabs:{query:async()=>tabs,update:async(id,options)=>calls.push(['activate',id,options]),create:async options=>calls.push(['create',options])}};
  return {api,calls};
}
test('동일 URL은 현재 일반 창의 앞선 탭 우선 재사용',async()=>{
  const f=fixture([{id:10,windowId:2,index:0,url:'https://a.com'},{id:11,windowId:1,index:2,url:'https://A.com:443'},{id:12,windowId:1,index:0,url:'https://a.com',incognito:true}]);
  assert.deepEqual(await openSavedUrl('https://a.com',true,f.api),{reused:true});
  assert.equal(f.calls[0][1],11); assert.equal(f.calls[1][1],1); assert.equal(f.calls.length,2);
});
test('닫힌 기존 탭 재조회 후 없으면 하나만 새로 생성',async()=>{
  const f=fixture(),tab={id:10,windowId:1,index:0,url:'https://a.com'}; let count=0;
  f.api.tabs.query=async()=>count++===0?[tab]:[];
  f.api.tabs.update=async()=>{throw Error('gone');};
  await openSavedUrl('https://a.com',true,f.api);
  assert.deepEqual(f.calls,[['create',{windowId:1,url:'https://a.com/',active:true}]]);
});
test('금지 URL·시크릿 창에서는 생성하지 않으며 창 포커스 부분 실패 보고',async()=>{
  const f=fixture(); await assert.rejects(openSavedUrl('javascript:alert(1)',true,f.api)); assert.equal(f.calls.length,0);
  f.api.windows.getCurrent=async()=>({id:1,type:'normal',incognito:true}); await assert.rejects(openSavedUrl('https://a.com',true,f.api));
  const g=fixture([{id:2,windowId:1,index:0,url:'https://a.com'}]);
  g.api.windows.update=async()=>{throw Error('focus');}; await assert.rejects(openSavedUrl('https://a.com',true,g.api),/활성화했지만/);
  assert.equal(g.calls.length,1);
});
test('선택 참고 탭만 순서대로 비활성 생성·기존 재사용·개별 실패',async()=>{
  const f=fixture([{id:2,windowId:1,index:0,url:'https://a.com'}]);
  const create=f.api.tabs.create;
  f.api.tabs.create=async options=>{if(options.url==='https://bad.com/') throw Error('create'); return create(options);};
  const result=await openReferences([{id:'a',url:'https://a.com'},{id:'b',url:'https://b.com'},{id:'c',url:'https://bad.com'}],f.api);
  assert.deepEqual(result.map(r=>r.ok),[true,true,false]);
  assert.deepEqual(f.calls,[['create',{windowId:1,url:'https://b.com/',active:false}]]);
});
test('팝업·시크릿 탭은 재사용하지 않음',async()=>{
  const f=fixture([{id:3,windowId:3,index:0,url:'https://a.com'},{id:4,windowId:4,index:0,url:'https://a.com',incognito:true}]);
  f.api.windows.get=async()=>({type:'popup'});
  assert.equal((await openSavedUrl('https://a.com',true,f.api)).reused,false);
  assert.equal(f.calls[0][0],'create');
});
