import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepository, validateStore, taskFromDraft, STORE_KEY } from '../src/storage.js';
import { collectCandidates } from '../src/model.js';

function draft(name='과제') {
  return {...collectCandidates([{index:0,url:'https://example.com',title:'문서',active:true},{index:1,url:'https://b.com',title:'참고'}]),name,nextAction:'다음 예제 읽기'};
}
function fixture() {
  let data, writes=0;
  const area={get:async()=>({[STORE_KEY]:structuredClone(data)}),set:async value=>{writes++; data=structuredClone(value[STORE_KEY]);}};
  return {area,get data(){return data;},set data(value){data=structuredClone(value);},get writes(){return writes;}};
}
test('최초 저장·재조회·수정·갱신·삭제 생명주기와 시각/ID/순서 보존',async()=>{
  const f=fixture(), repo=createRepository(f.area,{locks:false});
  const empty=await repo.read(); assert.deepEqual(empty,{schemaVersion:1,revision:0,tasks:[]});
  const saved=await repo.save(empty,draft('  과제  '));
  assert.equal(saved.revision,1); assert.equal(saved.tasks[0].name,'과제');
  const original=saved.tasks[0]; assert.equal(original.createdAt,original.updatedAt);
  const edit={...original,selectedIds:original.tabs.map(t=>t.id),tabs:[...original.tabs].reverse(),name:'수정'};
  const edited=await repo.save(saved,edit,original.id);
  assert.equal(edited.tasks[0].id,original.id); assert.equal(edited.tasks[0].createdAt,original.createdAt);
  assert.deepEqual(edited.tasks[0].tabs.map(t=>t.order),[0,1]);
  assert.equal(edited.tasks[0].tabs[0].id,original.tabs[1].id);
  const replace={...draft('수정'),nextAction:original.nextAction};
  const refreshed=await repo.save(edited,replace,original.id);
  assert.equal(refreshed.tasks[0].createdAt,original.createdAt);
  assert.equal(refreshed.tasks[0].nextAction,original.nextAction);
  assert.notEqual(refreshed.tasks[0].tabs[0].id,original.tabs[0].id);
  const reopened=await createRepository(f.area).read(); assert.deepEqual(reopened,refreshed);
  assert.deepEqual((await repo.remove(reopened,original.id)).tasks,[]);
});
test('잘못된 schema·깨진 참조·중복 ID·URL·순서·시각·알 수 없는 필드를 거부하고 원본 미변경',async()=>{
  const valid={schemaVersion:1,revision:1,tasks:[taskFromDraft(draft())]};
  const mutations=[s=>s.schemaVersion=2,s=>s.tasks[0].startTabId='missing',s=>s.tasks[0].tabs[1].id=s.tasks[0].tabs[0].id,s=>s.tasks[0].tabs[0].url='javascript:alert(1)',s=>s.tasks[0].tabs[0].order=5,s=>s.tasks[0].createdAt='bad',s=>s.tasks[0].unknown=true,s=>s.revision=-1,s=>s.tasks[0].tabs[1].url=s.tasks[0].tabs[0].url,s=>s.tasks[0].name=' '];
  for (const mutate of mutations) {
    const broken=structuredClone(valid); mutate(broken);
    const f=fixture(); f.data=broken; const repo=createRepository(f.area);
    await assert.rejects(repo.read()); await assert.rejects(repo.save(valid,draft()));
    assert.equal(f.writes,0); assert.deepEqual(f.data,broken);
  }
});
test('저장소가 객체 키 순서를 바꿔도 저장 확인·편집 가능',async()=>{
  const f=fixture(),set=f.area.set;
  const reverse=v=>Array.isArray(v)?v.map(reverse):v && typeof v==='object'?Object.fromEntries(Object.entries(v).reverse().map(([k,x])=>[k,reverse(x)])):v;
  f.area.set=async value=>{await set(value); f.data=reverse(f.data);};
  const repo=createRepository(f.area,{locks:false});
  const saved=await repo.save(await repo.read(),draft());
  const edited=await repo.save(saved,{...saved.tasks[0],selectedIds:saved.tasks[0].tabs.map(t=>t.id),name:'키 순서 무관'},saved.tasks[0].id);
  assert.equal(edited.tasks[0].name,'키 순서 무관');
});
test('수정·삭제 충돌 및 같은 revision 외부 변경을 쓰기 전에 거부',async()=>{
  const f=fixture(),repo=createRepository(f.area,{locks:false});
  const saved=await repo.save(await repo.read(),draft());
  const changed=structuredClone(saved); changed.tasks[0].name='다른 편집'; f.data=changed;
  await assert.rejects(repo.save(saved,draft(),saved.tasks[0].id),e=>e.code==='CONFLICT');
  await assert.rejects(repo.remove(saved,saved.tasks[0].id),e=>e.code==='CONFLICT');
  assert.equal(f.writes,1); assert.deepEqual(f.data,changed);
});
test('API 저장 실패 시 원본과 draft 유지, 재시도 가능',async()=>{
  const f=fixture(),repo=createRepository(f.area,{locks:false}), input=draft();
  const before=structuredClone(input),empty=await repo.read(); const set=f.area.set;
  f.area.set=async()=>{throw Error('quota');};
  await assert.rejects(repo.save(empty,input),e=>e.code==='WRITE');
  assert.deepEqual(input,before); assert.equal(f.data,undefined);
  f.area.set=set; assert.equal((await repo.save(empty,input)).tasks.length,1);
});
test('바이트 한도·작업 한도는 쓰기 전에 검사',async()=>{
  const f=fixture(),repo=createRepository(f.area,{locks:false,maxBytes:10});
  await assert.rejects(repo.save(await repo.read(),draft()),e=>e.code==='QUOTA');
  assert.equal(f.writes,0);
  f.data={schemaVersion:1,revision:1,tasks:Array.from({length:100},()=>taskFromDraft(draft()))};
  const fullRepo=createRepository(f.area,{locks:false});
  await assert.rejects(fullRepo.save(await fullRepo.read(),draft()),e=>e.code==='LIMIT'); assert.equal(f.writes,0);
});
test('중복 저장 요청은 한 번만 쓰기, 삭제 실패도 원본 유지',async()=>{
  const f=fixture(),repo=createRepository(f.area,{locks:false}),empty=await repo.read();
  const first=repo.save(empty,draft());
  await assert.rejects(repo.save(empty,draft()),e=>e.code==='BUSY');
  const saved=await first; assert.equal(f.writes,1);
  f.area.set=async()=>{throw Error('fail');};
  await assert.rejects(repo.remove(saved,saved.tasks[0].id),e=>e.code==='WRITE');
  assert.deepEqual(f.data,saved);
});
test('저장 후 읽기 실패·외부 덮어쓰기는 성공으로 반환하지 않음',async()=>{
  for (const mode of ['read-fail','changed']) {
    const f=fixture(), repo=createRepository(f.area,{locks:false});
    const empty=await repo.read(),set=f.area.set;
    f.area.set=async value=>{await set(value); if(mode==='read-fail') f.area.get=async()=>{throw Error('fail');}; else f.data={...f.data,revision:99};};
    await assert.rejects(repo.save(empty,draft()),e=>e.code==='UNCERTAIN');
    assert.equal(f.writes,1);
  }
});
test('시각 역행 때 수정 시각 역행을 막고 작업·탭 UUID 검증',()=>{
  const original=taskFromDraft(draft(),undefined,'2026-10-28T10:00:00.000Z');
  const edited=taskFromDraft({...original,selectedIds:original.tabs.map(t=>t.id)},original,'2026-10-28T09:00:00.000Z');
  assert.equal(edited.updatedAt,original.updatedAt);
  assert.equal(edited.createdAt,original.createdAt);
  assert.equal(validateStore({schemaVersion:1,revision:1,tasks:[edited]}).tasks.length,1);
});
test('저장소 API 부재·조회 실패는 명확한 오류',async()=>{
  await assert.rejects(createRepository({}).read(),e=>e.code==='API');
  await assert.rejects(createRepository({get:async()=>{throw Error('read');},set:async()=>{}}).read(),e=>e.code==='READ');
});
