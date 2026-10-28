function text(tag, value) {
  const node = document.createElement(tag); node.textContent = value; return node;
}
export function renderTabs(container, state, visible, onSelect, onStart, onMove) {
  const focused = document.activeElement?.dataset.focusKey;
  const fragment = document.createDocumentFragment();
  for (const tab of state.tabs.slice(0, visible)) {
    const row = text('article', ''); row.className = 'tab';
    const label = text('label', '');
    label.title=tab.title;
    const check = document.createElement('input');
    check.type = 'checkbox'; check.checked = state.selectedIds.includes(tab.id);
    check.dataset.focusKey = `select-${tab.id}`;
    check.addEventListener('change', () => onSelect(tab.id, check.checked));
    label.append(check, text('span', tab.title));
    const url = text('p', tab.url); url.className = 'url';
    url.title=tab.url;
    const startLabel = text('label', '');
    const radio = document.createElement('input');
    radio.type = 'radio'; radio.name = 'start-tab'; radio.checked = state.startTabId === tab.id;
    radio.disabled = !check.checked; radio.dataset.focusKey = `start-${tab.id}`;
    radio.setAttribute('aria-label', `${tab.title}에서 시작`);
    radio.addEventListener('change', () => onStart(tab.id));
    startLabel.append(radio, text('span', '여기서 시작'));
    const controls = text('div',''); controls.className='tab-controls';
    controls.append(startLabel);
    if (onMove) {
      for (const [delta,caption] of [[-1,'↑'],[1,'↓']]) {
        const button=text('button',caption); button.type='button';
        button.disabled=state.tabs.indexOf(tab)+delta<0 || state.tabs.indexOf(tab)+delta>=state.tabs.length;
        button.dataset.focusKey=`move-${delta}-${tab.id}`;
        button.setAttribute('aria-label',`${tab.title} ${delta<0?'위로':'아래로'} 이동`);
        button.addEventListener('click',()=>onMove(tab.id,delta)); controls.append(button);
      }
    }
    row.append(label, url, controls); fragment.append(row);
  }
  container.replaceChildren(fragment);
  if (focused) [...container.querySelectorAll('input, button')].find(n => n.dataset.focusKey === focused)?.focus();
}
export function renderTasks(container,tasks,onEdit,onDelete,onResume) {
  container.replaceChildren(...tasks.map(task=>{
    const card=text('article',''); card.className='task-card';
    const title=text('h2',task.name);
    const action=text('p',task.nextAction || '다음 행동을 남기지 않았습니다.');
    action.className='task-next-action';
    const meta=text('p',`${task.tabs.length}개 탭 · 수정 ${new Date(task.updatedAt).toLocaleString('ko-KR')}`);
    const buttons=text('div',''); buttons.className='actions';
    if (onResume) {
      const resume=text('button','이어서 할 일 확인'); resume.type='button'; resume.className='primary';
      resume.dataset.taskId=task.id;
      resume.addEventListener('click',()=>onResume(task.id)); buttons.append(resume);
    }
    const manage=text('details',''); manage.className='task-manage';
    manage.append(text('summary','작업 관리'));
    const entries=[['내용 보기 · 수정',onEdit],['삭제',onDelete]];
    for (const [caption,handler] of entries) {
      const button=text('button',caption); button.type='button';
      if (caption==='삭제') button.className='danger';
      button.addEventListener('click',()=>handler(task.id)); manage.append(button);
    }
    buttons.append(manage);
    card.append(title,text('p','돌아오면 할 일'),action,buttons,meta); return card;
  }));
}
export function renderExcluded(container, excluded) {
  container.replaceChildren(...excluded.map(item => text('li', `${item.title}: ${item.reason}`)));
}
