export function normalizeUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('주소가 아직 없습니다');
  if (raw.length > 8192) throw new Error('주소가 8192자를 초과합니다');
  let url;
  try { url = new URL(raw); } catch { throw new Error('올바르지 않은 주소입니다'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('HTTP·HTTPS 주소만 지원합니다');
  if (url.username || url.password) throw new Error('로그인 정보가 포함된 주소는 제외합니다');
  if (url.href.length > 8192) throw new Error('정규화한 주소가 8192자를 초과합니다');
  return url.href;
}
export function collectCandidates(rawTabs, makeId = () => crypto.randomUUID()) {
  const tabs = [], excluded = [], byUrl = new Map();
  let startTabId = null, duplicates = 0;
  for (const raw of [...rawTabs].sort((a, b) => a.index - b.index)) {
    try {
      if (raw.incognito) throw new Error('시크릿 탭은 지원하지 않습니다');
      const url = normalizeUrl(raw.url);
      let tab = byUrl.get(url);
      if (tab) duplicates++;
      else {
        tab = { id: makeId(), title: (raw.title?.trim() || url).slice(0, 500), url };
        tabs.push(tab); byUrl.set(url, tab);
      }
      if (raw.active) startTabId = tab.id;
    } catch (error) {
      excluded.push({ title: String(raw.title || '제목 없는 탭').slice(0, 500), reason: error.message });
    }
  }
  return { tabs, excluded, duplicates, selectedIds: tabs.map(t => t.id), startTabId: startTabId || tabs[0]?.id || null };
}
export function reconcileSelection(tabs, selectedIds, startTabId) {
  const chosen = tabs.filter(t => selectedIds.includes(t.id));
  return { selectedIds: chosen.map(t => t.id), startTabId: chosen.some(t => t.id === startTabId) ? startTabId : chosen[0]?.id || null };
}
export function validateDraft(draft) {
  const selected = draft.tabs.filter(t => draft.selectedIds.includes(t.id));
  if (!draft.name.trim()) return '작업명을 입력하세요';
  if (draft.name.length > 80) return '작업명은 80자 이하로 입력하세요';
  if (draft.nextAction.length > 500) return '다음 행동은 500자 이하로 입력하세요';
  if (!selected.length) return '탭을 하나 이상 선택하세요';
  if (selected.length > 200) return '탭은 200개까지 선택할 수 있습니다';
  if (!selected.some(t => t.id === draft.startTabId)) return '선택한 탭에서 시작 탭을 지정하세요';
  return '';
}
export function defaultName(tabs, startTabId, date = new Date()) {
  return (tabs.find(t => t.id === startTabId)?.title || `새 작업 ${date.toLocaleString('ko-KR')}`).slice(0, 80);
}
