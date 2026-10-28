import { collectCandidates, reconcileSelection, validateDraft, defaultName } from './src/model.js';
import { readCurrentTabs, openSavedUrl, openReferences } from './src/tabs.js';
import { renderTabs, renderExcluded, renderTasks } from './src/render.js';
import { createRepository } from './src/storage.js';

const $ = id => document.getElementById(id);
const repository = createRepository();
let store = null, state = null, taskId = null, visible = 50, visibleTasks = 50;
let busy = false, blocked = false, replacement = false;
let pendingDelete=null, resumeTask=null, referenceIds=new Set(), resumeVisible=50;
let confirmation=null, returnFocus=null, queuedFocus=null;
const message = (value,kind='info') => {
  $('error').hidden=kind!=='error';
  $('error').textContent=kind==='error'?value:'';
  $('status').textContent=kind==='error'?'':value;
  if (kind==='error') focusWhenReady($('error'));
};
function focusWhenReady(element) {
  if (!element) return;
  if (busy) queuedFocus=element;
  else element.focus();
}
function ask(title,description,label,action) {
  if (busy || confirmation || pendingDelete) return;
  returnFocus=document.activeElement;
  confirmation=action;
  $('confirm-title').textContent=title;
  $('confirm-message').textContent=description;
  $('confirm-accept').textContent=label;
  $('confirm-panel').hidden=false;
  syncControls();
  $('confirm-panel').scrollIntoView?.({block:'nearest'});
  $('confirm-cancel').focus();
}
function closeConfirmation(restore=true) {
  confirmation=null; $('confirm-panel').hidden=true;
  syncControls();
  if (restore) focusWhenReady(returnFocus);
  returnFocus=null;
}
$('confirm-cancel').addEventListener('click',()=>closeConfirmation());
$('confirm-accept').addEventListener('click',()=>{
  if (!confirmation || busy) return;
  const action=confirmation; closeConfirmation(false); action();
});
document.addEventListener('keydown',event=>{
  if (event.key!=='Escape' || busy) return;
  if (confirmation) {event.preventDefault(); closeConfirmation();}
  else if (pendingDelete) {event.preventDefault(); cancelDelete();}
});
function syncControls() {
  const paused=busy || Boolean(confirmation) || Boolean(pendingDelete);
  for (const id of ['list-view','draft','resume-view']) $(id).inert=paused;
  $('reload').disabled = paused;
  $('load').disabled = paused || blocked || !store;
  $('editor-fields').disabled = paused;
  $('save').disabled = paused || blocked || !state || Boolean(validateDraft(state));
  for (const button of $('tasks').querySelectorAll('button')) button.disabled = paused || blocked;
  $('more-tasks').disabled = paused || blocked;
  $('delete-confirm').disabled=busy || blocked;
  $('delete-cancel').disabled=busy;
  for (const element of $('resume-view').querySelectorAll('button, input')) element.disabled=paused;
  for (const element of $('resume-tabs').querySelectorAll('button, input')) element.disabled=paused;
  $('open-references').disabled=paused || referenceIds.size===0;
}
async function run(action) {
  if (busy) return;
  const previousFocus=document.activeElement;
  queuedFocus=null;
  busy = true; syncControls();
  try { await action(); }
  catch (error) {
    if (['CONFLICT','UNCERTAIN','INVALID','SCHEMA','READ','API'].includes(error.code)) blocked = true;
    message(error.message || '처리하지 못했습니다. 다시 시도하세요.','error');
  } finally {
    busy = false; syncControls();
    const target=queuedFocus || previousFocus;
    queuedFocus=null;
    if (target && !target.disabled && target.isConnected!==false) target.focus();
  }
}
function showList(focusId) {
  state = null; taskId = null; replacement = false; blocked = false;
  pendingDelete=null; resumeTask=null; referenceIds.clear();
  $('delete-panel').hidden=true; $('resume-view').hidden=true;
  $('draft').hidden = true; $('list-view').hidden = false;
  const tasks = [...store.tasks].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  renderTasks($('tasks'),tasks.slice(0,visibleTasks),editTask,deleteTask,showResume);
  $('empty').hidden = tasks.length !== 0;
  $('more-tasks').hidden = visibleTasks >= tasks.length;
  syncControls();
  const target=[...$('tasks').querySelectorAll('button')].find(button=>button.dataset.taskId && (!focusId || button.dataset.taskId===focusId));
  focusWhenReady(target || $('load'));
}
function update() {
  renderTabs($('tabs'),state,visible,(id,checked)=>{
    const selected = new Set(state.selectedIds);
    checked ? selected.add(id) : selected.delete(id);
    Object.assign(state,reconcileSelection(state.tabs,[...selected],state.startTabId)); update();
  },id=>{ state.startTabId=id; update(); },(id,direction)=>{
    const index=state.tabs.findIndex(t=>t.id===id), next=index+direction;
    if (next<0 || next>=state.tabs.length) return;
    [state.tabs[index],state.tabs[next]]=[state.tabs[next],state.tabs[index]]; update();
  });
  $('selection').textContent = `${state.selectedIds.length} / ${state.tabs.length}개 선택 · 시작: ${state.tabs.find(t=>t.id===state.startTabId)?.title || '없음'}`;
  $('validation').textContent = validateDraft(state) || '저장할 수 있습니다.';
  $('more').hidden = visible >= state.tabs.length;
  $('replacement').hidden = !replacement;
  $('save').textContent = replacement ? '탭 교체 확인 후 저장' : taskId ? '수정 저장' : '작업 저장';
  syncControls();
}
function openEditor(draft,id=null) {
  pendingDelete=null; $('delete-panel').hidden=true;
  state=draft; taskId=id; visible=50; blocked=false; replacement=false;
  $('name').value=state.name; $('next-action').value=state.nextAction;
  $('editor-title').textContent=id?'작업 수정':'새 작업';
  $('draft').hidden=false; $('list-view').hidden=true;
  $('refresh-tabs').hidden=!id;
  $('editor-delete').hidden=!id;
  renderExcluded($('excluded'),state.excluded || []);
  $('exclusions').hidden=!(state.excluded?.length);
  update(); focusWhenReady($('name'));
}
function editTask(id) {
  if (busy) return;
  const task=store.tasks.find(t=>t.id===id);
  openEditor({tabs:structuredClone(task.tabs),selectedIds:task.tabs.map(t=>t.id),startTabId:task.startTabId,name:task.name,nextAction:task.nextAction},id);
  message('저장된 내용을 편집합니다. 현재 창 탭으로 자동 교체하지 않습니다.');
}
function deleteTask(id) {
  if (busy || confirmation || pendingDelete) return;
  const task=store.tasks.find(t=>t.id===id);
  pendingDelete=id;
  returnFocus=document.activeElement;
  $('delete-message').textContent=`“${task.name}” 저장 작업을 삭제할까요? 열린 브라우저 탭은 닫지 않습니다. 편집 중인 미저장 내용도 사라집니다.`;
  $('delete-panel').hidden=false;
  syncControls();
  $('delete-panel').scrollIntoView?.({block:'nearest'});
  $('delete-cancel').focus();
}
function cancelDelete() {
  pendingDelete=null; $('delete-panel').hidden=true; syncControls();
  focusWhenReady(returnFocus); returnFocus=null; message('삭제를 취소했습니다.');
}
$('delete-cancel').addEventListener('click',cancelDelete);
$('delete-confirm').addEventListener('click',()=>{
  if (!pendingDelete || busy || blocked) return;
  const id=pendingDelete;
  run(async()=>{message('삭제 중입니다…'); store=await repository.remove(store,id); showList(); message('작업을 삭제했습니다. 열린 탭은 유지됩니다.');});
});
$('editor-delete').addEventListener('click',()=>deleteTask(taskId));
function drawResume() {
  const container=$('resume-tabs');
  container.replaceChildren();
  const references=resumeTask.tabs.filter(tab=>tab.id!==resumeTask.startTabId);
  for (const tab of references.slice(0,resumeVisible)) {
    const row=document.createElement('div'); row.className='resume-link';
    const check=document.createElement('input'); check.type='checkbox';
    check.disabled=tab.id===resumeTask.startTabId; check.checked=referenceIds.has(tab.id);
    check.setAttribute('aria-label',`${tab.title} 참고 탭 선택`);
    check.addEventListener('change',()=>{
      if (busy) {check.checked=referenceIds.has(tab.id); return;}
      check.checked?referenceIds.add(tab.id):referenceIds.delete(tab.id); syncControls();
    });
    const link=document.createElement('button'); link.type='button'; link.className='link-button';
    link.textContent=`${tab.id===resumeTask.startTabId?'시작 · ':''}${tab.title}`; link.title=tab.url;
    link.addEventListener('click',()=>openOne(tab));
    row.append(check,link); container.append(row);
  }
  $('resume-more').hidden=resumeVisible>=references.length;
  syncControls();
}
function showResume(id) {
  if (busy) return;
  resumeTask=store.tasks.find(t=>t.id===id); referenceIds.clear(); resumeVisible=50;
  $('list-view').hidden=true; $('draft').hidden=true; $('resume-view').hidden=false;
  $('delete-panel').hidden=true; pendingDelete=null;
  $('resume-name').textContent=resumeTask.name;
  $('resume-action').textContent=resumeTask.nextAction || '다음 행동을 남기지 않았습니다.';
  const start=resumeTask.tabs.find(tab=>tab.id===resumeTask.startTabId);
  $('start-context').textContent=`여기서 이어갑니다 · ${start.title}`;
  $('start-context').title=start.url;
  $('reference-panel').open=false;
  $('reference-summary').textContent=`필요할 때 참고 자료 보기 · ${resumeTask.tabs.length-1}개`;
  $('resume-result').textContent=''; drawResume();
  message('하려던 일을 확인하고 이어서 시작하세요.');
  focusWhenReady($('resume-name'));
}
function openOne(tab) {
  run(async()=>{const result=await openSavedUrl(tab.url); message(result.reused?'이미 열린 탭으로 이동했습니다.':'새 탭을 열었습니다.');});
}
$('open-start').addEventListener('click',()=>openOne(resumeTask.tabs.find(t=>t.id===resumeTask.startTabId)));
$('open-references').addEventListener('click',()=>run(async()=>{
  const selected=resumeTask.tabs.filter(t=>referenceIds.has(t.id));
  const results=await openReferences(selected);
  referenceIds=new Set(results.filter(r=>!r.ok).map(r=>r.id));
  $('resume-result').textContent=`${results.filter(r=>r.ok).length}개 열기/재사용 완료, ${referenceIds.size}개 실패. 실패한 항목만 선택 상태로 남았습니다.`;
  drawResume();
  if (referenceIds.size) message('일부 참고 탭을 열지 못했습니다. 실패한 항목만 선택되어 있으니 다시 열기를 누르세요.','error');
  else focusWhenReady($('open-start'));
}));
$('resume-back').addEventListener('click',()=>{const id=resumeTask.id; showList(id); message('작업 목록입니다.');});
$('resume-more').addEventListener('click',()=>{resumeVisible+=50; drawResume();});
$('reload').addEventListener('click',()=>{
  const reload=()=>run(async()=>{ const latest=await repository.read(); store=latest; showList(); message('목록을 다시 읽었습니다.'); });
  if (state) ask('목록 다시 읽기','미저장 입력을 버리고 저장된 목록을 다시 읽을까요?','입력 버리고 다시 읽기',reload);
  else reload();
});
$('load').addEventListener('click',()=>run(async()=>{
  const result=collectCandidates(await readCurrentTabs());
  openEditor({...result,name:defaultName(result.tabs,result.startTabId),nextAction:''});
  message(`현재 창을 읽었습니다. 중복 ${result.duplicates}개 병합, 제외 ${result.excluded.length}개.`);
}));
$('refresh-tabs').addEventListener('click',()=>run(async()=>{
  const result=collectCandidates(await readCurrentTabs());
  Object.assign(state,result); replacement=true; visible=50;
  renderExcluded($('excluded'),result.excluded); $('exclusions').hidden=!result.excluded.length;
  update(); message(`탭 교체 미리보기 · 중복 ${result.duplicates}개, 제외 ${result.excluded.length}개. 취소하면 기존 작업이 유지됩니다.`);
}));
$('cancel').addEventListener('click',()=>{
  ask('편집 취소','미저장 입력을 버리고 목록으로 돌아갈까요?','입력 버리고 목록으로',()=>{
    const id=taskId; showList(id); message('편집을 취소했습니다. 저장 내용은 변경하지 않았습니다.');
  });
});
$('draft').addEventListener('submit',event=>{
  event.preventDefault();
  if (busy || blocked || validateDraft(state)) return;
  const save=()=>run(async()=>{
    message('저장 중입니다. 완료를 기다려주세요…');
    const id=taskId;
    store=await repository.save(store,structuredClone(state),taskId);
    const savedId=id || store.tasks.at(-1).id;
    showList(savedId); message('로컬 저장을 확인했습니다.');
  });
  if (replacement) ask('저장할 탭 교체','선택한 현재 창 탭으로 기존 탭 목록을 교체하여 저장할까요?','탭 교체하고 저장',save);
  else save();
});
for (const [element,key] of [['name','name'],['next-action','nextAction']]) {
  $(element).addEventListener('input',event=>{state[key]=event.target.value; $('validation').textContent=validateDraft(state)||'저장할 수 있습니다.'; syncControls();});
}
$('all').addEventListener('click',()=>{Object.assign(state,reconcileSelection(state.tabs,state.tabs.map(t=>t.id),state.startTabId)); update();});
$('none').addEventListener('click',()=>{Object.assign(state,reconcileSelection(state.tabs,[],null)); update();});
$('more').addEventListener('click',()=>{visible+=50; update();});
$('more-tasks').addEventListener('click',()=>{visibleTasks+=50; showList();});
run(async()=>{store=await repository.read(); showList(); message('저장한 작업을 선택하거나 현재 창에서 새 작업을 만드세요.');});
