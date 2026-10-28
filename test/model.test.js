import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, collectCandidates, reconcileSelection, validateDraft, defaultName } from '../src/model.js';

test('URL 표준 정규화, 쿼리와 fragment 차이는 유지', () => {
  assert.equal(normalizeUrl('HTTPS://EXAMPLE.COM:443'), 'https://example.com/');
  for (const [a,b] of [['?a=1&b=2','?b=2&a=1'], ['#a','#b'], ['/A','/a']]) {
    assert.notEqual(normalizeUrl('https://example.com'+a), normalizeUrl('https://example.com'+b));
  }
});
test('제한 주소·자격증명·너무 긴 주소 제외', () => {
  for (const value of ['', undefined, 'broken', 'chrome://settings', 'javascript:alert(1)', 'file:///a', 'https://user:pass@example.com', 'https://e.com/'+'x'.repeat(8192)]) assert.throws(() => normalizeUrl(value));
});
test('창 순서·중복 병합·활성 중복 대표 선택 및 일시 tabId 배제', () => {
  let id=0;
  const result=collectCandidates([
    {id:99,index:2,url:'https://a.com',active:true},
    {index:1,url:'https://b.com',title:'B'},
    {index:0,url:'https://A.com:443',title:'A'},
    {index:3,url:'chrome://settings'},
    {index:4,url:'https://secret.com',incognito:true}
  ], () => `uuid-${++id}`);
  assert.deepEqual(result.tabs.map(t=>t.title), ['A','B']);
  assert.equal(result.duplicates,1); assert.equal(result.excluded.length,2);
  assert.equal(result.startTabId,result.tabs[0].id);
  assert.equal(result.tabs[0].id,'uuid-1'); assert.equal(result.tabs[0].tabId,undefined);
});
test('시작 탭 제외·전체 해제·선택 순서 정규화', () => {
  const tabs=[{id:'a'},{id:'b'},{id:'c'}];
  assert.deepEqual(reconcileSelection(tabs,['c','b'],'a'),{selectedIds:['b','c'],startTabId:'b'});
  assert.deepEqual(reconcileSelection(tabs,[],'a'),{selectedIds:[],startTabId:null});
});
test('빈 목록과 제목 대체·제목 및 기본 작업명 길이', () => {
  assert.equal(collectCandidates([]).startTabId,null);
  const result=collectCandidates([{index:0,url:'https://a.com',title:''},{index:1,url:'https://b.com',title:'x'.repeat(600)}]);
  assert.equal(result.tabs[0].title,'https://a.com/'); assert.equal(result.tabs[1].title.length,500);
  assert.equal(defaultName(result.tabs,result.tabs[1].id).length,80);
  assert.match(defaultName([],null,new Date('2026-10-28T00:00:00Z')),/^새 작업 /);
});
test('빈 선택·시작 참조·이름·메모·200개 선택 한도', () => {
  const tabs=Array.from({length:201},(_,i)=>({id:String(i)}));
  const draft={tabs,selectedIds:['0'],startTabId:'0',name:'과제',nextAction:''};
  assert.equal(validateDraft(draft),'');
  for (const change of [{name:' '},{name:'x'.repeat(81)},{nextAction:'x'.repeat(501)},{selectedIds:[]},{startTabId:'missing'},{selectedIds:tabs.map(t=>t.id)}]) assert.notEqual(validateDraft({...draft,...change}),'');
  assert.equal(validateDraft({...draft,selectedIds:tabs.slice(0,200).map(t=>t.id),name:'x'.repeat(80),nextAction:'x'.repeat(500)}),'');
});
