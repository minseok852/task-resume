import { normalizeUrl } from './model.js';

export async function readCurrentTabs(api = globalThis.chrome) {
  if (!api?.tabs?.query || !api?.windows?.getCurrent) throw new Error('Chrome 확장으로 로드한 뒤 사용하세요');
  const window = await api.windows.getCurrent();
  if (window.incognito || window.type !== 'normal') throw new Error('일반 Chrome 창에서 실행하세요');
  return api.tabs.query({ currentWindow: true });
}

// A user action opens one validated URL; existing normal-window tabs are reused.
export async function openSavedUrl(raw, active = true, api = globalThis.chrome, targetWindow) {
  const url = normalizeUrl(raw);
  const current = targetWindow || await api.windows.getCurrent();
  if (current.incognito || current.type !== 'normal') throw new Error('일반 Chrome 창에서 실행하세요.');
  for (let attempt=0; attempt<2; attempt++) {
    const tabs=(await api.tabs.query({})).filter(tab=>{
      if (tab.incognito) return false;
      try { return normalizeUrl(tab.url)===url; } catch { return false; }
    }).sort((a,b)=>(a.windowId===current.id?0:1)-(b.windowId===current.id?0:1)||a.windowId-b.windowId||a.index-b.index);
    for (const tab of tabs) {
      let window;
      try { window=await api.windows.get(tab.windowId); } catch { continue; }
      if (window.type!=='normal' || window.incognito) continue;
      if (!active) return {reused:true};
      try { await api.tabs.update(tab.id,{active:true}); }
      catch { break; } // Tab may have disappeared; query once more before creating.
      try { await api.windows.update(tab.windowId,{focused:true}); }
      catch { throw new Error('탭을 활성화했지만 창 앞으로 이동하지 못했습니다. Chrome 창을 확인하세요.'); }
      return {reused:true};
    }
  }
  await api.tabs.create({windowId:current.id,url,active});
  return {reused:false};
}

export async function openReferences(tabs, api = globalThis.chrome) {
  const target=await api.windows.getCurrent();
  const results=[];
  for (const tab of tabs) {
    try { const result=await openSavedUrl(tab.url,false,api,target); results.push({id:tab.id,ok:true,...result}); }
    catch { results.push({id:tab.id,ok:false}); }
  }
  return results;
}
