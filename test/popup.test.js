import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STORE_KEY } from '../src/storage.js';

// DOM event harness: real controller/model/repository/renderer, fake DOM and Chrome APIs.
// Does not claim actual browser layout, native dialogs, or permission verification.
class Node {
  constructor(tag='div') { this.tag=tag; this.children=[]; this.dataset={}; this.events={}; this.value=''; this.hidden=false; this.disabled=false; this._text=''; }
  set textContent(value) {this._text=String(value); this.children=[];}
  get textContent() {return this._text+this.children.map(c=>c.textContent).join('');}
  append(...nodes) {for(const n of nodes) this.children.push(...(n.tag==='fragment'?n.children:[n]));}
  replaceChildren(...nodes) {this.children=[]; this._text=''; this.append(...nodes);}
  addEventListener(event,fn) {(this.events[event]??=[]).push(fn);}
  setAttribute(key,value) {this[key]=value;}
  querySelectorAll(selector) {const tags=selector.split(',').map(x=>x.trim()); return this.children.flatMap(c=>[...(tags.includes(c.tag)?[c]:[]),...c.querySelectorAll(selector)]);}
  focus() {globalThis.document.activeElement=this;}
  fire(type) {if(this.disabled) return; for(const fn of this.events[type]||[]) fn({target:this,preventDefault(){}});}
}
const settle=async()=>{for(let i=0;i<6;i++) await new Promise(resolve=>setImmediate(resolve));};
test('팝업 실제 모듈: 입력 보존·중복 클릭·저장 목록·편집·갱신 취소·삭제·손상 데이터 차단',async()=>{
  const savedGlobals={document:globalThis.document,chrome:globalThis.chrome,confirm:globalThis.confirm};
  const nodes=new Map();
  for(const match of readFileSync(new URL('../popup.html',import.meta.url),'utf8').matchAll(/<([\w-]+)[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const n=new Node(match[1]); n.hidden=match[0].includes(' hidden'); n.disabled=match[0].includes(' disabled'); nodes.set(match[2],n);
  }
  const $=id=>nodes.get(id); let data,fail=false,writes=0,confirm=true;
  const documentEvents={};
  globalThis.document={getElementById:$,createElement:tag=>new Node(tag),createDocumentFragment:()=>new Node('fragment'),activeElement:null,addEventListener:(event,handler)=>{documentEvents[event]=handler;}};
  globalThis.confirm=()=>assert.fail('Native confirm must not be called');
  globalThis.chrome={storage:{local:{
    get:async()=>({[STORE_KEY]:structuredClone(data)}),
    set:async value=>{if(fail) throw Error('quota'); writes++; data=structuredClone(value[STORE_KEY]);}
  }},windows:{getCurrent:async()=>({type:'normal'})},tabs:{query:async()=>[
    {index:0,title:'<img onerror=alert(1)>',url:'https://example.com',active:true},
    {index:1,title:'참고',url:'https://b.com'}
  ]}};
  try {
    await import(`../popup.js?integration=${Date.now()}`); await settle();
    assert.equal($('empty').hidden,false);
    $('load').fire('click'); await settle();
    $('name').value='입력 보존 과제'; $('name').fire('input');
    fail=true; $('draft').fire('submit'); await settle();
    assert.equal($('draft').hidden,false); assert.equal($('name').value,'입력 보존 과제'); assert.equal(writes,0);
    assert.match($('error').textContent,/저장하지 못했습니다/);
    assert.equal($('error').hidden,false);
    assert.equal(document.activeElement,$('error'));
    fail=false; $('draft').fire('submit'); $('draft').fire('submit'); await settle();
    assert.equal(writes,1); assert.equal($('draft').hidden,true); assert.match($('tasks').textContent,/입력 보존 과제/);
    assert.match($('status').textContent,/저장을 확인/);
    assert.equal($('error').hidden,true);
    assert.equal(document.activeElement,$('tasks').querySelectorAll('button').find(button=>button.textContent==='이어서 할 일 확인'));
    let opened=0;
    globalThis.chrome.windows.getCurrent=async()=>({id:1,type:'normal'});
    globalThis.chrome.windows.get=async()=>({id:1,type:'normal'});
    globalThis.chrome.tabs.create=async()=>{opened++;};
    $('tasks').querySelectorAll('button').find(button=>button.textContent==='이어서 할 일 확인').fire('click');
    assert.equal(opened,0); assert.equal($('resume-view').hidden,false);
    assert.equal(document.activeElement,$('resume-name'));
    assert.equal($('resume-action').textContent,'다음 예제 읽기'===data.tasks[0].nextAction?'다음 예제 읽기':data.tasks[0].nextAction || '다음 행동을 남기지 않았습니다.');
    assert.equal($('reference-panel').open,false); $('open-start').fire('click'); await settle(); assert.equal(opened,1);
    const originalQuery=globalThis.chrome.tabs.query;
    globalThis.chrome.tabs.query=async()=>[];
    let completeOpen;
    globalThis.chrome.tabs.create=()=>new Promise(resolve=>{completeOpen=resolve;});
    const reference=$('resume-tabs').querySelectorAll('input')[0];
    reference.checked=true; reference.fire('change');
    $('open-references').fire('click'); await settle();
    assert.equal(reference.disabled,true);
    assert.equal($('open-references').disabled,true);
    assert.equal($('resume-view').inert,true);
    completeOpen(); await settle();
    assert.equal($('resume-tabs').querySelectorAll('input')[0].disabled,false);
    assert.equal($('resume-tabs').querySelectorAll('input')[0].checked,false);
    assert.equal($('resume-view').inert,false);
    globalThis.chrome.tabs.query=originalQuery;
    $('resume-back').fire('click');
    assert.equal(document.activeElement,$('tasks').querySelectorAll('button').find(button=>button.textContent==='이어서 할 일 확인'));
    const initial=structuredClone(data);
    $('tasks').querySelectorAll('button').find(button=>button.textContent==='내용 보기 · 수정').fire('click');
    $('cancel').focus(); $('cancel').fire('click');
    assert.equal($('confirm-panel').hidden,false); assert.equal($('draft').inert,true);
    assert.equal(document.activeElement,$('confirm-cancel'));
    documentEvents.keydown({key:'Escape',preventDefault(){}});
    assert.equal($('confirm-panel').hidden,true); assert.equal($('draft').inert,false);
    assert.equal(document.activeElement,$('cancel'));
    const arrows=$('tabs').querySelectorAll('button'); arrows[1].fire('click');
    $('name').value='수정한 과제'; $('name').fire('input');
    $('draft').fire('submit'); await settle();
    assert.equal(data.tasks[0].tabs[0].url,'https://b.com/'); assert.equal(data.tasks[0].createdAt,initial.tasks[0].createdAt);
    $('tasks').querySelectorAll('button').find(button=>button.textContent==='내용 보기 · 수정').fire('click');
    $('refresh-tabs').fire('click'); await settle();
    assert.equal($('replacement').hidden,false);
    const beforeReplace=structuredClone(data);
    $('draft').fire('submit'); assert.equal($('confirm-panel').hidden,false);
    $('confirm-cancel').fire('click'); await settle(); assert.deepEqual(data,beforeReplace);
    $('draft').fire('submit'); $('confirm-accept').fire('click'); await settle();
    assert.equal(data.tasks[0].tabs[0].url,'https://example.com/'); assert.equal(data.tasks[0].name,'수정한 과제');
    $('tasks').querySelectorAll('button').find(button=>button.textContent==='내용 보기 · 수정').fire('click');
    data.revision++; $('draft').fire('submit'); await settle();
    assert.match($('error').textContent,/다른 화면/); assert.equal($('save').disabled,true); assert.equal($('draft').hidden,false);
    $('reload').focus(); $('reload').fire('click');
    $('confirm-cancel').fire('click'); assert.equal($('draft').hidden,false);
    assert.equal(document.activeElement,$('reload'));
    $('reload').fire('click'); $('confirm-accept').fire('click'); await settle();
    const deleteButton=$('tasks').querySelectorAll('button').find(button=>button.textContent==='삭제');
    deleteButton.focus(); deleteButton.fire('click'); assert.equal($('delete-panel').hidden,false);
    $('delete-cancel').fire('click'); await settle(); assert.equal(data.tasks.length,1);
    assert.equal($('list-view').inert,false);
    assert.equal(document.activeElement,deleteButton);
    $('tasks').querySelectorAll('button').find(button=>button.textContent==='삭제').fire('click'); $('delete-confirm').fire('click'); await settle(); assert.equal(data.tasks.length,0);
    // Pagination keeps selections outside the first 50 visible rows.
    globalThis.chrome.tabs.query=async()=>Array.from({length:51},(_,index)=>({index,title:`탭 ${index}`,url:`https://example.com/${index}`,active:index===50}));
    $('load').fire('click'); await settle();
    assert.equal($('tabs').children.length,50); assert.equal($('more').hidden,false);
    $('tabs').querySelectorAll('input')[0].checked=false; $('tabs').querySelectorAll('input')[0].fire('change');
    $('more').fire('click'); assert.equal($('tabs').children.length,51); assert.match($('selection').textContent,/50 \/ 51/);
    assert.equal($('tabs').querySelectorAll('input')[0].checked,false);
    assert.equal($('tabs').querySelectorAll('input').at(-1).checked,true);
    $('cancel').fire('click'); $('confirm-accept').fire('click');
    globalThis.chrome.tabs.query=async()=>[{index:0,url:'chrome://settings',title:'설정'}];
    $('load').fire('click'); await settle();
    assert.equal($('tabs').children.length,0); assert.equal($('save').disabled,true); assert.equal($('exclusions').hidden,false);
    $('cancel').fire('click'); $('confirm-accept').fire('click');
    data={schemaVersion:999,revision:3,tasks:[]}; const before=writes;
    $('reload').fire('click'); await settle(); assert.match($('error').textContent,/지원하지 않는/);
    assert.equal(writes,before); assert.equal(data.schemaVersion,999);
  } finally {Object.assign(globalThis,savedGlobals);}
});

