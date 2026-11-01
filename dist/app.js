import {SEVERITY, TOPIC_COLORS, tokens, validateDataset, timeBins, filterReports, sortReports, buildBrief} from './model.js';
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const paths = {
 grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
 bookmark:'<path d="M6 3h12v18l-6-4-6 4z"/>',
 info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
 help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1.5 1-1.5 1-1.5 3m0 3h.01"/>',
 download:'<path d="M12 3v12m-4-4 4 4 4-4M4 15v5h16v-5"/>',
 upload:'<path d="M12 15V3m-4 4 4-4 4 4M4 15v5h16v-5"/>',
 layers:'<path d="m12 3 9 5-9 5-9-5 9-5zm-9 9 9 5 9-5m-18 5 9 5 9-5"/>',
 reset:'<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
 play:'<path d="m8 4 12 8-12 8z"/>',
 pause:'<path d="M8 4v16M16 4v16"/>',
 reports:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6m-6 4h6m-6 4h4"/>',
 alert:'<path d="m12 3 10 18H2L12 3zm0 6v5m0 3h.01"/>',
 search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
 'filter-off':'<path d="M4 4h16l-6 7v9l-4-2v-7L4 4zM3 21l18-18"/>',
 close:'<path d="m6 6 12 12M6 18 18 6"/>',
 notice:'<path d="m3 11 15-6v14L3 13v-2zm2 3 2 7h4l-2-6M21 8v8"/>',
 field:'<path d="M4 21V8l8-5 8 5v13M8 21v-7h8v7M9 8h6"/>',
 public:'<circle cx="12" cy="7" r="4"/><path d="M4 21v-3a8 8 0 0 1 16 0v3"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.reports}</svg>`;
function icons() { $$('[data-icon]').forEach(el => el.innerHTML = icon(el.dataset.icon)); }
icons();
const state = {dataset:null,evidence:{},view:'overview',topic:'',query:'',category:'',severity:'',source:'',time:null,sort:'newest',visible:0,playing:false,timer:null,mode:'browser',queryIds:null,searchSequence:0,detailId:null};
let toastTimer, noteTimer, persistChain = Promise.resolve();
const storageKey = 'signal-desk.workspace.v1';
const utc = timestamp => new Date(timestamp).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'UTC'});
const date = timestamp => new Date(timestamp).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}).toUpperCase();
function toast(message) { $('#toast').textContent = message; $('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,3500); }
function topicInfo() {const topics=new Map();state.dataset.reports.forEach(r=>{if(!topics.has(r.topic))topics.set(r.topic,{id:r.topic,name:r.incident,short:r.incident.split(' ').slice(0,2).join(' '),color:TOPIC_COLORS[topics.size%TOPIC_COLORS.length]});});return [...topics.values()];}
function evidenceClean(value) {const clean={};if(!value||typeof value!=='object')return clean;for(const r of state.dataset.reports){const e=value[r.id];if(e&&typeof e==='object')clean[r.id]={saved:e.saved===true,note:typeof e.note==='string'?e.note.slice(0,4000):''};}return clean;}
async function api(path, options={}) {const response=await fetch(path,{...options,headers:{'Content-Type':'application/json',...options.headers},signal:options.signal||AbortSignal.timeout(8000)});if(!response.ok){let message=`Request failed (${response.status})`;try{message=(await response.json()).error||message;}catch{}throw new Error(message);}return response.json();}
function persist() {
 const snapshot={dataset:state.dataset,evidence:state.evidence};
 if(state.mode==='api') {
   const body=JSON.stringify({evidence:state.evidence});
   persistChain=persistChain.catch(()=>{}).then(()=>api('/api/workspace',{method:'PUT',body}));
   return persistChain.catch(error=>{toast(`Could not save changes: ${error.message}`);throw error;});
 }
 try {localStorage.setItem(storageKey,JSON.stringify(snapshot));return Promise.resolve();}catch {toast('Browser storage is full or unavailable. Export your brief to keep it.');return Promise.reject(new Error('Storage unavailable'));}
}
function getFilters(ignoreTime=false) {return {savedOnly:state.view==='saved',topic:state.topic,query:state.query,category:state.category,severity:state.severity,source:state.source,time:ignoreTime?null:state.time};}
function currentReports(ignoreTime=false) {return filterReports(state.dataset.reports.slice(0,state.visible),getFilters(ignoreTime),state.evidence,state.queryIds);}
function configureDataset() {
 $('#dataset-name').textContent=state.dataset.name;
 $('#workspace-name').textContent=state.dataset.name==='Harbour City exercise'?'Harbour City':state.dataset.name;
 $('#workspace-initials').textContent=state.dataset.name.split(/\s+/).slice(0,2).map(s=>s[0]).join('').toUpperCase();
 $('#data-label').innerHTML='<span></span>'+(state.dataset.name==='Harbour City exercise'?'FICTIONAL DATA':'IMPORTED DATA');
 $('#scenario-date').textContent=date(state.dataset.reports[0].timestamp);
 $('#replay-range').max=state.dataset.reports.length;
 for(const field of ['category','source']){
  const select=$('#'+field);select.replaceChildren(new Option('All '+(field==='category'?'categories':'sources'),''));
  [...new Set(state.dataset.reports.map(r=>r[field]))].sort().forEach(v=>select.add(new Option(v,v)));
 }
 const topics=topicInfo();
 $('.nav-section-head .tiny').textContent=topics.length;
 $('#channels').innerHTML=topics.map(t=>`<button class="channel" data-topic="${escape(t.id)}"><span class="channel-dot" style="--dot:${t.color}"></span><span class="channel-title">${escape(t.short)}</span><span class="channel-number" data-topic-count="${escape(t.id)}">0</span></button>`).join('');
}
function render() {
 if(!state.dataset)return;
 const reports=sortReports(currentReports(),state.sort),available=state.dataset.reports.slice(0,state.visible),savedCount=state.dataset.reports.filter(r=>state.evidence[r.id]?.saved).length;
 $('#metric-reports').textContent=reports.length;$('#metric-incidents').textContent=new Set(reports.map(r=>r.topic)).size;$('#metric-high').textContent=reports.filter(r=>r.severity==='high').length;$('#metric-saved').textContent=savedCount;$('#saved-nav').textContent=savedCount;$('#mobile-saved').textContent=savedCount;
 $('#metric-report-note').textContent=state.visible===state.dataset.reports.length?'Across your current filters':'Within the replay window';
 $('#replay-range').value=state.visible;$('#replay-count').textContent=`${state.visible} / ${state.dataset.reports.length}`;
 $('#replay-status').textContent=state.playing?'Replaying':state.visible===state.dataset.reports.length?'Full scenario':state.visible===0?'Ready to replay':`Paused at ${utc(available.at(-1).timestamp)} UTC`;
 $('#play').innerHTML=icon(state.playing?'pause':'play')+`<span>${state.playing?'Pause replay':state.visible===state.dataset.reports.length?'Replay scenario':'Play scenario'}</span>`;
 $$('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===state.view);b.setAttribute('aria-current',b.dataset.view===state.view?'page':'false');});
 $('#breadcrumb-current').textContent=state.view==='saved'?'Saved evidence':'Overview';
 $('#page-title').innerHTML=state.view==='saved'?'Your evidence.<br>A clearer <span>picture.</span>':'A little clarity.<br>A lot of <span>signal.</span>';
 $('#page-description').textContent=state.view==='saved'?'The reports you kept. The connections you made.':'Connect the reports. Understand the bigger picture.';
 $('#feed-title').innerHTML=`${state.view==='saved'?'Your saved evidence':'The report feed'} <span class="count-pill" id="feed-count">${reports.length}</span>`;
 $('#feed-description').textContent=state.view==='saved'?'Open a report to add your observation.':'Every report is a starting point. Open one to investigate.';
 $$('[data-topic]').forEach(b=>b.classList.toggle('active',b.dataset.topic===state.topic));
 $$('[data-topic-count]').forEach(el=>el.textContent=available.filter(r=>r.topic===el.dataset.topicCount).length);
 renderChart();renderIncidents(reports);renderFilters();renderReports(reports);
}
function renderChart() {
 const bins=timeBins(state.dataset.reports),reports=currentReports(true);
 const counts=bins.map(b=>reports.filter(r=>Date.parse(r.timestamp)>=b.start&&Date.parse(r.timestamp)<b.end).length),max=Math.max(...counts,1);
 $('#chart').innerHTML=bins.map((b,i)=>{const height=Math.max(2,counts[i]/max*100);return `<button class="chart-bar ${state.time?.start===b.start?'selected':''}" style="--height:${height}%" data-bin="${i}" aria-label="${utc(b.start)} to ${utc(b.end)} UTC: ${counts[i]} reports" aria-pressed="${state.time?.start===b.start}"><span class="bar-tooltip">${utc(b.start)} · ${counts[i]} reports</span><span class="bar-fill" style="height:${height}%"></span></button>`;}).join('');
 $('#axis-start').textContent=utc(bins[0].start);$('#axis-middle').textContent=utc(bins[Math.floor(bins.length/2)].start);$('#axis-end').textContent=utc(bins.at(-1).end);
 $('#clear-time').hidden=!state.time;$('#chart-legend').hidden=!!state.time;
}
function renderIncidents(reports) {
 const topics=topicInfo().map(t=>({...t,count:reports.filter(r=>r.topic===t.id).length})).filter(t=>t.count).sort((a,b)=>b.count-a.count);
 $('#incident-count').textContent=topics.length;
 $('#incident-list').innerHTML=topics.length?topics.map(t=>`<button class="incident-row" data-incident="${escape(t.id)}" title="Filter ${escape(t.name)}"><span class="incident-bullet" style="--dot:${t.color}"></span><span class="incident-name">${escape(t.name)}</span><span class="incident-number">${t.count}</span><span class="incident-arrow" aria-hidden="true">↗</span></button>`).join(''):'<div class="empty-state">No incidents in this view.</div>';
}
function renderFilters() {
 const chips=[];if(state.topic)chips.push(['topic',topicInfo().find(t=>t.id===state.topic)?.name||state.topic]);if(state.time)chips.push(['time',`${utc(state.time.start)}–${utc(state.time.end)} UTC`]);
 for(const key of ['category','severity','source'])if(state[key])chips.push([key,state[key]]);
 if(state.query)chips.push(['query',`Search: ${state.query}`]);
 $('#active-filters').hidden=!chips.length;$('#active-filters').innerHTML=chips.map(([k,v])=>`<button data-clear="${k}">${escape(v)}<span aria-hidden="true">×</span><span class="sr-only">Remove filter</span></button>`).join('');
}
function renderReports(reports) {
 $('#report-list').setAttribute('aria-busy','false');
 const sourceIcon = source => source==='Service notice'?'notice':source==='Field update'?'field':'public';
 if(!reports.length){$('#report-list').innerHTML=`<div class="empty-state"><span class="empty-icon">${icon(state.view==='saved'?'bookmark':'search')}</span><strong>${state.visible===0?'The story starts here.':state.view==='saved'?'No saved evidence in this view.':'No reports match this view.'}</strong>${state.visible===0?'Press play to watch the scenario unfold.':state.view==='saved'?'Save reports from the overview, or clear your filters.':'Try a different keyword or clear your filters.'}<br><button class="button button-outline" id="empty-action">${state.visible===0?'Start replay':state.view==='saved'?'Explore all reports':'Clear filters'}</button></div>`;}
 else $('#report-list').innerHTML=reports.map(r=>`<article class="report-row"><button class="report-open" data-open="${escape(r.id)}" aria-label="Investigate: ${escape(r.title)}"><span class="report-title">${escape(r.title)}</span><span class="report-preview">${escape(r.body)}</span><span class="report-context"><span class="report-topic">${escape(r.location)}</span><span class="context-dot"></span><span>${escape(r.category)}</span><span class="context-dot"></span><span>${escape(r.status)}</span>${state.evidence[r.id]?.note?'<span class="context-dot"></span><span>Has note</span>':''}</span></button><span class="report-source">${icon(sourceIcon(r.source))}${escape(r.source)}</span><span class="severity-badge ${r.severity}"><span></span>${r.severity}</span><time class="report-time" datetime="${r.timestamp}" title="${escape(date(r.timestamp))} · ${utc(r.timestamp)} UTC">${utc(r.timestamp)}</time><button class="icon-button bookmark-button ${state.evidence[r.id]?.saved?'saved':''}" data-save="${escape(r.id)}" aria-label="${state.evidence[r.id]?.saved?'Unsave':'Save'}: ${escape(r.title)}" aria-pressed="${!!state.evidence[r.id]?.saved}">${icon('bookmark')}</button></article>`).join('');
 $('#feed-summary').textContent=`${reports.length} ${reports.length===1?'report':'reports'} shown · ${state.visible} of ${state.dataset.reports.length} available · times in UTC`;
}
function clearFilters() {clearTimeout(searchTimer);Object.assign(state,{query:'',topic:'',category:'',severity:'',source:'',time:null,queryIds:null});state.searchSequence++;$('#search').value='';for(const id of ['category','severity','source'])$('#'+id).value='';render();}
function setView(view) {state.view=view;clearFilters();}
async function saveToggle(id) {
 const previous=state.evidence[id]||{saved:false,note:''};state.evidence[id]={...previous,saved:!previous.saved};
 render();if(state.detailId===id&&$('#detail-dialog').open)updateDetailSave(id);
 try {await persist();toast(state.evidence[id]?.saved?'Added to your evidence file.':'Removed from saved evidence.');}catch{}
}
function updateDetailSave(id) {const saved=!!state.evidence[id]?.saved;const b=$('#detail-save');if(b){b.innerHTML=icon('bookmark')+(saved?'Saved to evidence':'Save to evidence');b.setAttribute('aria-pressed',saved);}}
function openReport(id) {
 flushNote();const r=state.dataset.reports.find(r=>r.id===id);if(!r)return;state.detailId=id;
 const related=sortReports(state.dataset.reports.slice(0,state.visible).filter(x=>x.topic===r.topic&&x.id!==id),'newest').slice(0,4);
 $('#detail-content').innerHTML=`<div class="detail-head"><span class="detail-id">REPORT / ${escape(r.id)}</span><button class="icon-button" id="close-detail" aria-label="Close report">${icon('close')}</button></div><div class="detail-body"><div class="detail-badges"><span class="severity-badge ${r.severity}"><span></span>${r.severity} severity</span><time datetime="${r.timestamp}">${date(r.timestamp)} · ${utc(r.timestamp)} UTC</time></div><h2 id="detail-title">${escape(r.title)}</h2><div class="detail-context"><span>${escape(r.location)}</span><span> / </span><span>${escape(r.category)}</span></div><p class="detail-copy">${escape(r.body)}</p><dl class="detail-meta"><div><dt>Source type</dt><dd>${escape(r.source)}</dd></div><div><dt>Reported status</dt><dd>${escape(r.status)}</dd></div><div><dt>Incident</dt><dd>${escape(r.incident)}</dd></div><div><dt>Report identifier</dt><dd>${escape(r.id)}</dd></div></dl><p class="detail-source-note">Source and status labels come from the dataset. They are not an independent verification of this report.</p><button class="button button-dark detail-save" id="detail-save" aria-pressed="false"></button><label class="note-label" for="report-note">Your observation <span id="note-status" class="note-status">Saved automatically</span></label><textarea id="report-note" maxlength="4000" placeholder="What matters here? Add context or a connection to another report…">${escape(state.evidence[id]?.note||'')}</textarea><div class="related-title">RELATED REPORTS / ${related.length}</div>${related.length?related.map(x=>`<button class="related-report" data-related="${escape(x.id)}"><time>${utc(x.timestamp)}</time><span>${escape(x.title)}</span></button>`).join(''):'<p class="detail-source-note">No other reports in this channel have arrived yet.</p>'}</div>`;
 updateDetailSave(id);$('#detail-dialog').scrollTop=0;if(!$('#detail-dialog').open)$('#detail-dialog').showModal();
 $('#close-detail').addEventListener('click',()=>$('#detail-dialog').close());$('#detail-save').addEventListener('click',()=>saveToggle(id));
 $('#report-note').addEventListener('input',()=>{clearTimeout(noteTimer);const saved=state.evidence[id]?.saved||false;state.evidence[id]={saved,note:$('#report-note').value};$('#note-status').textContent='Saving…';noteTimer=setTimeout(()=>saveNote(id),400);});
 $$('[data-related]').forEach(b=>b.addEventListener('click',()=>openReport(b.dataset.related)));
}
async function saveNote(id) {noteTimer=null;try{await persist();if(state.detailId===id&&$('#note-status'))$('#note-status').textContent='Saved';render();}catch{if($('#note-status'))$('#note-status').textContent='Not saved — export to keep';}}
function flushNote() {if(noteTimer){clearTimeout(noteTimer);noteTimer=null;saveNote(state.detailId);}}
function stopReplay() {clearInterval(state.timer);state.timer=null;state.playing=false;}
function startReplay() {if(state.visible===state.dataset.reports.length)state.visible=0;state.playing=true;state.timer=setInterval(()=>{state.visible=Math.min(state.dataset.reports.length,state.visible+1);if(state.visible===state.dataset.reports.length){stopReplay();toast('Replay complete. All reports are now in view.');}render();},Number($('#replay-speed').value));render();}
function toggleReplay() {if(state.playing){stopReplay();render();}else startReplay();}
function guide(){$('#guide-dialog').showModal();}
async function search() {
 state.query=$('#search').value.trim();const sequence=++state.searchSequence;
 if(state.mode!=='api'||!tokens(state.query).length){state.queryIds=null;render();return;}
 $('#report-list').setAttribute('aria-busy','true');
 try {const result=await api('/api/search?q='+encodeURIComponent(state.query));if(sequence!==state.searchSequence)return;state.queryIds=new Set(result.ids);render();}catch(error){if(sequence!==state.searchSequence)return;state.queryIds=null;render();toast('Search is using the browser fallback. '+error.message);}
}
function exportBrief() {
 const reports=currentReports();const saved=state.dataset.reports.filter(r=>state.evidence[r.id]?.saved);
 if(!saved.length&&!reports.length){toast('There are no reports to export.');return;}
 const blob=new Blob([buildBrief(state.dataset,reports,state.evidence)],{type:'text/markdown;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='signal-desk-brief.md';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast(`Exported ${saved.length||reports.length} reports to your brief.`);
}
async function replaceDataset(dataset) {
 stopReplay();flushNote();await persistChain.catch(()=>{});
 if(state.mode==='api')await api('/api/dataset',{method:'PUT',body:JSON.stringify(dataset)});
 state.dataset=dataset;state.evidence={};state.visible=dataset.reports.length;state.view='overview';state.searchSequence++;
 clearFilters();configureDataset();render();if(state.mode==='browser')await persist().catch(()=>{});
}
async function importDataset(file) {
 if(!file)return;try{if(file.size>2000000)throw new Error('Choose a JSON file smaller than 2 MB.');const dataset=validateDataset(JSON.parse(await file.text()));if(Object.values(state.evidence).some(e=>e.saved||e.note)&&!confirm('Importing replaces this dataset and its saved evidence. Export a brief first if you want to keep it. Continue?'))return;
 await replaceDataset(dataset);toast(`Imported ${dataset.reports.length} reports.`);
 }catch(error){toast(error instanceof SyntaxError?'That file is not valid JSON.':error.message);}finally{$('#import-file').value='';}
}
async function restoreDemo() {if(!confirm('Restore the original exercise? This replaces imported data, saved evidence and notes.'))return;try {const response=await fetch('./data.json');if(!response.ok)throw new Error('Could not load the exercise.');await replaceDataset(validateDataset(await response.json()));$('#guide-dialog').close();toast('Original exercise restored.');}catch(error){toast(error.message);}}
async function init() {
 try {
  let workspace;
  try {workspace=await api('/api/workspace',{signal:AbortSignal.timeout(1200)});if(workspace.kind!=='signal-desk')throw new Error('Not a Signal Desk API');state.dataset=validateDataset(workspace.dataset);state.mode='api';}catch{
   let cached;try{cached=JSON.parse(localStorage.getItem(storageKey));if(cached)state.dataset=validateDataset(cached.dataset);}catch{}
   if(!state.dataset){const response=await fetch('./data.json');if(!response.ok)throw new Error('Could not load demo data.');state.dataset=validateDataset(await response.json());}workspace=cached||{};
  }
  state.evidence=evidenceClean(workspace.evidence);state.visible=state.dataset.reports.length;
  $('#mode-label').textContent=state.mode==='api'?'Connected workspace':'Browser workspace';
  if(state.mode==='api')$('#storage-info').textContent='This workspace stores reports, evidence and notes in your local SQLite database. The original scenario is fictional. Source labels are dataset claims, not independently verified facts.';
  configureDataset();render();
 } catch(error){$('#report-list').innerHTML=`<div class="empty-state"><strong>We couldn’t open the workspace.</strong>${escape(error.message)}<br>Serve this folder using the included Python server and reload.</div>`;toast('Workspace could not load.');}
}
$$('[data-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
$('#channels').addEventListener('click',event=>{const b=event.target.closest('[data-topic]');if(b){state.topic=state.topic===b.dataset.topic?'':b.dataset.topic;render();}});
$('#incident-list').addEventListener('click',event=>{const b=event.target.closest('[data-incident]');if(b){state.topic=state.topic===b.dataset.incident?'':b.dataset.incident;render();$('#feed-title').scrollIntoView({behavior:'smooth',block:'center'});}});
$('#chart').addEventListener('click',event=>{const b=event.target.closest('[data-bin]');if(b){const bin=timeBins(state.dataset.reports)[Number(b.dataset.bin)];state.time=state.time?.start===bin.start?null:bin;render();}});
$('#clear-time').addEventListener('click',()=>{state.time=null;render();});
$('#report-list').addEventListener('click',event=>{const open=event.target.closest('[data-open]'),save=event.target.closest('[data-save]');if(open)openReport(open.dataset.open);if(save)saveToggle(save.dataset.save);if(event.target.closest('#empty-action')){if(state.visible===0)startReplay();else if(state.view==='saved')setView('overview');else clearFilters();}});
let searchTimer;$('#search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(search,120);});
for(const key of ['category','severity','source','sort'])$('#'+key).addEventListener('change',e=>{state[key]=e.target.value;render();});
$('#clear-filters').addEventListener('click',clearFilters);
$('#active-filters').addEventListener('click',event=>{const b=event.target.closest('[data-clear]');if(b){const key=b.dataset.clear;state[key]=key==='time'?null:'';if(key==='query'){$('#search').value='';state.queryIds=null;state.searchSequence++;}if(['category','severity','source'].includes(key))$('#'+key).value='';render();}});
$('#play').addEventListener('click',toggleReplay);$('#reset-replay').addEventListener('click',()=>{stopReplay();state.visible=0;render();});$('#replay-range').addEventListener('input',event=>{stopReplay();state.visible=Number(event.target.value);render();});$('#replay-speed').addEventListener('change',()=>{if(state.playing){stopReplay();startReplay();}});
$('#export').addEventListener('click',exportBrief);$('#import-button').addEventListener('click',()=>$('#import-file').click());$('#import-file').addEventListener('change',event=>importDataset(event.target.files[0]));
for(const id of ['guide-side','guide-top','about-button'])$('#'+id).addEventListener('click',guide);$('#close-guide').addEventListener('click',()=>$('#guide-dialog').close());$('#restore-demo').addEventListener('click',restoreDemo);
$('#detail-dialog').addEventListener('close',()=>{flushNote();state.detailId=null;});
for(const dialog of $$('dialog'))dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();}});
document.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){if($$('dialog[open]').length)return;event.preventDefault();$('#search').focus();}});
window.addEventListener('pagehide',()=>flushNote());
init();
