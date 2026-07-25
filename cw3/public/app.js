// Coldwave — real app.js wired to the backend (same origin)
const $ = id => document.getElementById(id);
const esc = s => String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
async function api(path, opts){ const r = await fetch(path, opts); return r.json(); }

const VIEWS = {
  unibox:{title:'Unibox',subtitle:'Manage replies from every campaign in one place.'},
  campaigns:{title:'Campaigns',subtitle:'Create, monitor and optimize cold email campaigns.'},
  accounts:{title:'Email Accounts',subtitle:'Connect sending accounts and monitor their health.'},
};
let state = { view:'campaigns', campaignId:null, ctab:'leads', uniCat:'primary', uniFilter:{type:'all'}, camp:null };

// ---------- navigation ----------
document.querySelectorAll('[data-view]').forEach(btn=>btn.addEventListener('click',()=>go(btn.dataset.view)));
function go(view){
  state.view=view; state.campaignId=null;
  document.querySelectorAll('.rail-btn').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  showView(view+'-view');
  $('page-title').textContent=VIEWS[view].title; $('page-subtitle').textContent=VIEWS[view].subtitle;
  if(view==='unibox') renderUnibox();
  if(view==='campaigns'){ topActions('<button class="primary-btn" onclick="openModal(\'campaign-modal\')">＋ Add New</button>'); loadCampaigns(); }
  if(view==='accounts'){ topActions('<button class="primary-btn" onclick="openInboxModal()">＋ Add New</button>'); loadAccounts(); }
}
function showView(id){ document.querySelectorAll('.view').forEach(v=>v.classList.remove('active-view')); $(id).classList.add('active-view'); }
function topActions(html){ $('top-actions').innerHTML = html; }

// ---------- modals ----------
function openModal(id){ $(id).classList.add('show'); }
function closeModal(id){ $(id).classList.remove('show'); }
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>closeModal(b.dataset.close)));
document.querySelectorAll('.modal-backdrop').forEach(m=>m.addEventListener('click',e=>{ if(e.target===m) m.classList.remove('show'); }));

// ============================================================================
// ACCOUNTS
// ============================================================================
async function loadAccounts(filter=''){
  const list=$('account-list'); list.innerHTML='<div class="loading">Loading…</div>';
  try{
    const d = await api('/inboxes');
    if(!d.ok){ list.innerHTML='<div class="loading">'+esc(d.error)+'</div>'; return; }
    window._inboxes = d.inboxes;
    const rows = d.inboxes.filter(a=>a.email.toLowerCase().includes(filter.toLowerCase()));
    if(!rows.length){ list.innerHTML='<div class="loading">No inboxes yet — add one to start sending.</div>'; return; }
    list.innerHTML = rows.map(a=>{
      const ok=a.status==='active';
      return `<article class="data-card account-grid">
        <input class="checkbox" type="checkbox">
        <strong>${esc(a.email)}</strong>
        <strong>${a.sent_today||0} of 30</strong>
        <strong class="muted">${esc(a.provider)}</strong>
        <strong class="health" style="color:${ok?'var(--green)':'var(--orange)'}">${ok?'Healthy':esc(a.status)}</strong>
        <span class="kebab" style="cursor:pointer" onclick="delInbox(${a.id})" title="Remove">🗑</span>
      </article>`;
    }).join('');
  }catch(e){ list.innerHTML='<div class="loading">Could not reach backend: '+esc(e.message)+'</div>'; }
}
$('account-search').addEventListener('input',e=>loadAccounts(e.target.value));
async function delInbox(id){ if(!confirm('Remove this inbox?'))return; const d=await api('/inboxes/'+id,{method:'DELETE'}); if(d.ok)loadAccounts(); else alert(d.error); }

function openInboxModal(){ $('provider-step').style.display='block'; $('smtp-step').style.display='none'; $('inbox-msg').textContent=''; openModal('inbox-modal'); }
$('add-account').onclick=openInboxModal;
$('pick-smtp').onclick=()=>{ $('provider-step').style.display='none'; $('smtp-step').style.display='block'; };
$('back-provider').onclick=()=>{ $('provider-step').style.display='block'; $('smtp-step').style.display='none'; };
$('smtp-step').addEventListener('submit', async e=>{
  e.preventDefault();
  const btn=$('inbox-save'); btn.disabled=true; btn.textContent='Verifying…';
  try{
    const d = await api('/inboxes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      email:$('in-email').value.trim(), smtp_host:$('in-host').value.trim(), smtp_port:$('in-port').value.trim(),
      smtp_user:$('in-user').value.trim(), smtp_pass:$('in-pass').value.trim() })});
    if(d.ok){ closeModal('inbox-modal'); $('smtp-step').reset(); loadAccounts(); }
    else $('inbox-msg').textContent=d.error;
  }catch(err){ $('inbox-msg').textContent='Could not reach backend: '+err.message; }
  btn.disabled=false; btn.textContent='Verify & connect';
});

// ============================================================================
// CAMPAIGNS LIST
// ============================================================================
async function loadCampaigns(){
  const list=$('campaign-list'); list.innerHTML='<div class="loading">Loading…</div>';
  try{
    const d = await api('/campaigns');
    if(!d.ok){ list.innerHTML='<div class="loading">'+esc(d.error)+'</div>'; return; }
    window._campaigns=d.campaigns; drawCampaigns();
  }catch(e){ list.innerHTML='<div class="loading">Could not reach backend: '+esc(e.message)+'</div>'; }
}
function drawCampaigns(){
  const q=($('campaign-search').value||'').toLowerCase();
  const sf=$('campaign-status-filter').value;
  const rows=(window._campaigns||[]).filter(c=>c.name.toLowerCase().includes(q)&&(!sf||c.status===sf));
  const list=$('campaign-list');
  if(!rows.length){ list.innerHTML='<div class="loading">No campaigns yet.</div>'; return; }
  list.innerHTML = rows.map(c=>{
    const leads=+c.lead_count||0, sent=+c.sent_count||0, replied=+c.replied_count||0;
    const planned=leads*(+c.step_count||1);
    const pct=planned?Math.min(100,Math.round(sent/planned*100)):0;
    const rate=sent?(replied/sent*100).toFixed(2):'0.00';
    const active=c.status==='active';
    return `<article class="data-card campaign-grid" style="cursor:pointer" onclick="openCampaign(${c.id})">
      <input class="checkbox" type="checkbox" onclick="event.stopPropagation()">
      <strong>${esc(c.name)}</strong>
      <span><span class="status-badge ${esc(c.status)}">${esc(c.status)}</span></span>
      <span class="progress"><b>${pct}%</b><span class="progress-bar"><span style="width:${pct}%"></span></span></span>
      <strong>${sent}</strong>
      <strong>${replied} <span class="muted" style="font-weight:400">| ${rate}%</span></strong>
      <span class="kebab" style="cursor:pointer" title="${active?'Pause':'Start'}" onclick="event.stopPropagation();rowToggle(${c.id},'${c.status}')">${active?'⏸':'▶'}</span>
      <span class="kebab" style="cursor:pointer" onclick="event.stopPropagation();delCampaign(${c.id})">🗑</span>
    </article>`;
  }).join('');
}
$('campaign-search').addEventListener('input',drawCampaigns);
$('campaign-status-filter').addEventListener('change',drawCampaigns);
$('add-campaign').onclick=()=>openModal('campaign-modal');
$('campaign-form').addEventListener('submit', async e=>{
  e.preventDefault();
  try{
    const d = await api('/campaigns',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:$('camp-name').value})});
    if(d.ok){ closeModal('campaign-modal'); $('campaign-form').reset(); openCampaign(d.campaign.id); }
    else $('camp-msg').textContent=d.error;
  }catch(err){ $('camp-msg').textContent='Could not reach backend: '+err.message; }
});
async function rowToggle(id,status){
  const d = await api('/campaigns/'+id+'/'+(status==='active'?'pause':'start'),{method:'POST'});
  if(!d.ok) alert(d.error);
  loadCampaigns();
}
async function delCampaign(id){ if(!confirm('Delete this campaign and all its leads?'))return; const d=await api('/campaigns/'+id,{method:'DELETE'}); if(d.ok)loadCampaigns(); else alert(d.error); }

// ============================================================================
// CAMPAIGN DETAIL
// ============================================================================
async function openCampaign(id){ state.campaignId=id; state.ctab='leads'; await refreshCampaign(); }
async function refreshCampaign(){
  showView('campaign-detail-view');
  try{
    const d = await api('/campaigns/'+state.campaignId);
    if(!d.ok){ alert(d.error); return go('campaigns'); }
    state.camp=d;
    const st=d.stats||{};
    $('page-title').textContent=d.campaign.name;
    $('page-subtitle').textContent=`${d.leadCount} leads · ${st.sent||0} sent · ${st.queued||0} queued · ${d.campaign.status}`;
    const active=d.campaign.status==='active';
    topActions(
      (active?'<button class="secondary-btn" onclick="pauseCampaign()">⏸ Pause</button>'
             :'<button class="primary-btn" onclick="startCampaign()">▶ Start campaign</button>')
      +'<button class="org-btn" onclick="runDiagnose()">🩺 Diagnose</button>'
      +'<button class="org-btn" onclick="go(\'campaigns\')">← All campaigns</button>');
    document.querySelectorAll('.tab2').forEach(b=>b.classList.toggle('active',b.dataset.ctab===state.ctab));
    renderCtab();
  }catch(e){ alert('Could not reach backend: '+e.message); go('campaigns'); }
}
document.querySelectorAll('.tab2').forEach(b=>b.addEventListener('click',()=>{ state.ctab=b.dataset.ctab; document.querySelectorAll('.tab2').forEach(x=>x.classList.toggle('active',x===b)); renderCtab(); }));
async function startCampaign(){ const d=await api('/campaigns/'+state.campaignId+'/start',{method:'POST'}); if(!d.ok)alert(d.error); refreshCampaign(); }
async function pauseCampaign(){ const d=await api('/campaigns/'+state.campaignId+'/pause',{method:'POST'}); if(!d.ok)alert(d.error); refreshCampaign(); }

async function runDiagnose(){
  const b=$('ctab-body');
  b.innerHTML='<div class="loading">Running checks…</div>';
  document.querySelectorAll('.tab2').forEach(x=>x.classList.remove('active'));
  try{
    const d=await api('/campaigns/'+state.campaignId+'/diagnose');
    if(!d.ok){ b.innerHTML='<div class="loading">'+esc(d.error)+'</div>'; return; }
    const blocked=d.verdict.startsWith('BLOCKED');
    b.innerHTML=`<div class="step-card" style="border-color:${blocked?'#6e3a1b':'#1f5c3a'}">
      <div class="step-head"><b>${blocked?'⚠ Sending is blocked':'✓ All checks pass'}</b></div>
      <div style="color:${blocked?'var(--orange)':'var(--green)'};font-weight:600;margin-bottom:6px">${esc(d.verdict)}</div>
      <span class="muted">Server time (UTC): ${esc(d.campaign.serverTimeUtc)} · campaign local: ${esc(d.campaign.campaignLocalDay)} ${d.campaign.campaignLocalHour}:xx ${esc(d.campaign.timezone)} · window ${esc(d.campaign.window)}</span>
    </div>
    <div class="step-card"><div class="step-head"><b>Checks</b></div>
      ${d.checks.map(c=>`<div class="chk"><span class="chk-mark ${c.pass?'ok':'bad'}">${c.pass?'✓':'✗'}</span>
        <span><b>${esc(c.name)}</b><small class="muted">${esc(c.detail)}</small></span></div>`).join('')}
    </div>
    <div class="step-card"><div class="step-head"><b>Force a send now</b></div>
      <span class="muted">Ignores the schedule and pacing, sends one queued email immediately, and shows the raw error if it fails. Use this to prove SMTP works.</span>
      <div class="tabbar-row" style="margin-top:14px"><span></span><button class="primary-btn" id="fs-btn" onclick="forceSend()">Send one now</button></div>
      <div class="mini-msg" id="fs-msg"></div></div>`;
  }catch(e){ b.innerHTML='<div class="loading">Could not reach backend: '+esc(e.message)+'</div>'; }
}
async function forceSend(){
  const btn=$('fs-btn'); btn.disabled=true; btn.textContent='Sending…';
  try{
    const d=await api('/campaigns/'+state.campaignId+'/force-send',{method:'POST'});
    const m=$('fs-msg');
    if(d.ok){ m.style.color='var(--green)'; m.textContent='SENT to '+d.to+' from '+d.from+' — subject: '+d.subject+'. Check that inbox.'; }
    else { m.style.color='var(--orange)'; m.textContent='FAILED: '+d.error; }
  }catch(e){ $('fs-msg').textContent='Could not reach backend: '+e.message; }
  btn.disabled=false; btn.textContent='Send one now';
}

function renderCtab(){
  const b=$('ctab-body'), d=state.camp;
  if(state.ctab==='leads') return renderLeadsTab(b,d);
  if(state.ctab==='sequence') return renderSequenceTab(b,d);
  if(state.ctab==='schedule') return renderScheduleTab(b,d);
  if(state.ctab==='options') return renderOptionsTab(b,d);
}

// ---- LEADS + CSV MAPPING ----
function renderLeadsTab(b,d){
  const list = d.leads.length
    ? `<div class="table-head lead-grid"><span>Email</span><span>First name</span><span>Company</span><span>Status</span></div>
       <div class="card-list" style="padding-left:0;padding-right:0">${d.leads.map(l=>`
        <article class="data-card lead-grid"><strong>${esc(l.email)}</strong><span class="muted">${esc(l.first_name)}</span><span class="muted">${esc(l.company)}</span><span><span class="status-badge draft">${esc(l.status)}</span></span></article>`).join('')}
       ${d.leadCount>d.leads.length?`<div class="loading">+ ${d.leadCount-d.leads.length} more…</div>`:''}</div>`
    : '<div class="loading">No leads yet. Upload a CSV — you\'ll map the columns next.</div>';
  b.innerHTML = `<div class="tabbar-row"><span class="muted">Upload any CSV — choose which column is which on the next screen.</span>
    <label class="primary-btn filebtn">Upload CSV<input id="csv-file" type="file" accept=".csv,text/csv" hidden></label></div>
    <div class="mini-msg" id="csv-msg"></div>${list}`;
  $('csv-file').addEventListener('change',handleCsv);
}
const FIELDS=[{v:'',l:'Do not import'},{v:'email',l:'Email'},{v:'first_name',l:'First Name'},{v:'last_name',l:'Last Name'},{v:'company',l:'Company Name'}];
function guessField(h){ h=h.toLowerCase().replace(/[^a-z]/g,''); if(h.includes('email'))return 'email'; if(h==='firstname'||h==='first')return 'first_name'; if(h==='lastname'||h==='last')return 'last_name'; if(h.includes('company')||h.includes('organization'))return 'company'; return ''; }
function handleCsv(ev){
  const f=ev.target.files[0]; if(!f)return; ev.target.value='';
  const r=new FileReader();
  r.onload=()=>{ try{
      const {headers,rows}=parseCsv(r.result);
      if(!rows.length){ $('csv-msg').textContent='No data rows found.'; return; }
      window._csv={headers,rows};
      $('map-count').textContent=rows.length.toLocaleString();
      const used=new Set();
      $('map-rows').innerHTML=headers.map((h,i)=>{
        let g=guessField(h); if(g&&used.has(g))g=''; if(g)used.add(g);
        return `<div class="map-row"><span class="map-name">${esc(h||('Column '+(i+1)))}</span>
          <select data-col="${i}">${FIELDS.map(o=>`<option value="${o.v}" ${o.v===g?'selected':''}>${o.l}</option>`).join('')}</select>
          <span class="map-samples">${rows.slice(0,3).map(rw=>`<i>${esc(rw[i]||'—')}</i>`).join('')}</span></div>`;
      }).join('');
      $('map-msg').textContent=''; openModal('map-modal');
    }catch(e){ $('csv-msg').textContent='Could not parse file: '+e.message; } };
  r.readAsText(f);
}
$('map-import').onclick=async ()=>{
  const sels=[...document.querySelectorAll('#map-rows select')], mapping={};
  for(const s of sels){ if(!s.value)continue;
    if(mapping[s.value]!==undefined){ $('map-msg').textContent='Each type can be picked only once.'; return; }
    mapping[s.value]=+s.dataset.col; }
  if(mapping.email===undefined){ $('map-msg').textContent='You must map one column to Email.'; return; }
  const leads=window._csv.rows.map(r=>({ email:r[mapping.email]||'',
    first_name:mapping.first_name!==undefined?(r[mapping.first_name]||''):'',
    last_name:mapping.last_name!==undefined?(r[mapping.last_name]||''):'',
    company:mapping.company!==undefined?(r[mapping.company]||''):'' }));
  const btn=$('map-import'); btn.disabled=true;
  let ins=0,skip=0,inv=0;
  try{
    for(let i=0;i<leads.length;i+=2000){
      $('map-msg').textContent='Importing '+Math.min(i+2000,leads.length).toLocaleString()+' of '+leads.length.toLocaleString()+'…';
      const d=await api('/campaigns/'+state.campaignId+'/leads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({leads:leads.slice(i,i+2000)})});
      if(!d.ok){ $('map-msg').textContent=d.error; btn.disabled=false; return; }
      ins+=d.inserted; skip+=d.skipped; inv+=(d.invalid||0);
    }
    closeModal('map-modal'); refreshCampaign();
  }catch(e){ $('map-msg').textContent='Upload failed: '+e.message+' — imported rows are saved; press Import again to continue.'; }
  btn.disabled=false;
};
function parseCsv(text){
  const lines=text.replace(/\r/g,'').split('\n').filter(l=>l.length&&l.split(',').some(c=>c.trim()));
  if(lines.length<2)return{headers:[],rows:[]};
  return { headers:splitCsv(lines[0]).map(h=>h.trim()), rows:lines.slice(1).map(splitCsv) };
}
function splitCsv(line){ const o=[];let c='',q=false;
  for(let i=0;i<line.length;i++){const ch=line[i];
    if(q){ if(ch==='"'&&line[i+1]==='"'){c+='"';i++;} else if(ch==='"')q=false; else c+=ch; }
    else { if(ch==='"')q=true; else if(ch===','){o.push(c);c='';} else c+=ch; } }
  o.push(c); return o.map(x=>x.trim()); }

// ---- SEQUENCE + TEST EMAIL ----
function renderSequenceTab(b,d){
  window._steps = d.steps.length ? d.steps.map(s=>({subject:s.subject||'',body:s.body||'',delay_days:s.delay_days||0})) : [{subject:'',body:'',delay_days:0}];
  drawSteps(b,d);
}
function drawSteps(b,d){
  const steps=window._steps;
  let html=steps.map((s,i)=>`<div class="step-card">
    <div class="step-head"><b>Step ${i+1}</b>${steps.length>1?`<span class="kebab" style="cursor:pointer" onclick="rmStep(${i})">🗑</span>`:''}</div>
    <label class="fld">Subject ${i>0?'<small>(blank = same thread as previous)</small>':''}<input value="${esc(s.subject)}" oninput="updStep(${i},'subject',this.value)" placeholder="Hey {{firstName}}, quick question"></label>
    <label class="fld">Body<textarea oninput="updStep(${i},'body',this.value)" placeholder="Hi {{firstName}}, … use {{firstName}} {{lastName}} {{company}}">${esc(s.body)}</textarea></label>
    ${i<steps.length-1?`<div class="delay-row">Then wait <input type="number" min="0" value="${steps[i+1].delay_days}" oninput="updStep(${i+1},'delay_days',this.value)"> days before the next step</div>`:''}
  </div>`).join('');
  html+=`<div class="tabbar-row"><button class="secondary-btn" onclick="addStep()">＋ Add step</button><button class="primary-btn" id="seq-save" onclick="saveSteps()">Save sequence</button></div><div class="mini-msg" id="seq-msg"></div>`;
  const leads=(d.leads||[]).slice(0,50);
  html+=`<div class="step-card test-card"><div class="step-head"><b>✈ Send a test email</b></div>
    <span class="muted">Sends the step with variables filled from a real lead, subject prefixed [TEST]. Save the sequence first.</span>
    <div class="two-col">
      <label class="fld">Which step<select id="t-step">${steps.map((_,i)=>`<option value="${i+1}">Step ${i+1}</option>`).join('')}</select></label>
      <label class="fld">Lead data<select id="t-lead"><option value="">Sample (Alex / Acme Inc)</option>${leads.map(l=>`<option value="${l.id}">${esc(l.email)}</option>`).join('')}</select></label>
    </div>
    <label class="fld">Send test to<input id="t-to" type="email" placeholder="you@example.com"></label>
    <div class="tabbar-row"><span></span><button class="primary-btn" id="t-btn" onclick="sendSeqTest()">Send test email</button></div>
    <div class="mini-msg" id="t-msg"></div></div>`;
  b.innerHTML=html;
}
function updStep(i,k,v){ window._steps[i][k]=(k==='delay_days')?(+v||0):v; }
function addStep(){ window._steps.push({subject:'',body:'',delay_days:3}); drawSteps($('ctab-body'),state.camp); }
function rmStep(i){ window._steps.splice(i,1); drawSteps($('ctab-body'),state.camp); }
async function saveSteps(){
  const btn=$('seq-save'); btn.disabled=true;
  try{ const d=await api('/campaigns/'+state.campaignId+'/steps',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({steps:window._steps})});
    $('seq-msg').textContent=d.ok?('Sequence saved ('+d.count+' steps).'):d.error;
  }catch(e){ $('seq-msg').textContent='Could not reach backend: '+e.message; }
  btn.disabled=false;
}
async function sendSeqTest(){
  const to=$('t-to').value.trim(); if(!to){ $('t-msg').textContent='Enter a recipient.'; return; }
  const btn=$('t-btn'); btn.disabled=true; btn.textContent='Sending…';
  try{ const d=await api('/campaigns/'+state.campaignId+'/test-email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({to,stepNumber:+$('t-step').value||1,leadId:$('t-lead').value?+$('t-lead').value:null})});
    $('t-msg').textContent=d.ok?('Test sent from '+d.from+' — subject: '+d.subject):d.error;
  }catch(e){ $('t-msg').textContent='Could not reach backend: '+e.message; }
  btn.disabled=false; btn.textContent='Send test email';
}

// ---- SCHEDULE ----
const TZS=['UTC','America/New_York','America/Chicago','America/Denver','America/Los_Angeles','Europe/London','Europe/Paris','Europe/Berlin','Asia/Dubai','Asia/Karachi','Asia/Dhaka','Asia/Kolkata','Asia/Bangkok','Asia/Singapore','Asia/Tokyo','Australia/Sydney'];
const DAYS={1:'Monday',2:'Tuesday',3:'Wednesday',4:'Thursday',5:'Friday',6:'Saturday',7:'Sunday'};
const hourLabel=h=>h===0?'12:00 AM':h<12?h+':00 AM':h===12?'12:00 PM':h===24?'Midnight':(h-12)+':00 PM';
function renderScheduleTab(b,d){
  const c=d.campaign, days=new Set(c.send_days||[1,2,3,4,5]);
  b.innerHTML=`<div class="step-card"><div class="step-head"><b>Timing</b></div>
    <div class="two-col">
      <label class="fld">Send from<select id="s-from">${Array.from({length:24},(_,h)=>`<option value="${h}" ${h===c.send_window_start?'selected':''}>${hourLabel(h)}</option>`).join('')}</select></label>
      <label class="fld">Until<select id="s-to">${Array.from({length:24},(_,i)=>{const h=i+1;return `<option value="${h}" ${h===c.send_window_end?'selected':''}>${hourLabel(h)}</option>`;}).join('')}</select></label>
    </div>
    <label class="fld">Timezone<select id="s-tz">${TZS.map(t=>`<option ${t===c.timezone?'selected':''}>${t}</option>`).join('')}</select></label>
    <span class="muted">Emails only go out between these hours in this timezone.</span></div>
    <div class="step-card"><div class="step-head"><b>Days</b></div>
    <div class="days-row">${[1,2,3,4,5,6,7].map(n=>`<label class="day-chip"><input type="checkbox" data-day="${n}" ${days.has(n)?'checked':''}>${DAYS[n]}</label>`).join('')}</div></div>
    <div class="tabbar-row"><span></span><button class="primary-btn" id="s-save" onclick="saveSchedule()">Save schedule</button></div>
    <div class="mini-msg" id="s-msg"></div>`;
}
async function saveSchedule(){
  const c=state.camp.campaign;
  const send_days=[...document.querySelectorAll('#ctab-body input[data-day]')].filter(i=>i.checked).map(i=>+i.dataset.day);
  const btn=$('s-save'); btn.disabled=true;
  try{ const d=await api('/campaigns/'+state.campaignId+'/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      timezone:$('s-tz').value, send_window_start:+$('s-from').value, send_window_end:+$('s-to').value,
      send_days, daily_limit:c.daily_limit, stop_on_reply:c.stop_on_reply })});
    if(d.ok){ state.camp.campaign=d.campaign; $('s-msg').textContent='Schedule saved.'; } else $('s-msg').textContent=d.error;
  }catch(e){ $('s-msg').textContent='Could not reach backend: '+e.message; }
  btn.disabled=false;
}

// ---- OPTIONS ----
async function renderOptionsTab(b,d){
  b.innerHTML='<div class="loading">Loading inboxes…</div>';
  const inb=await api('/inboxes');
  if(!inb.ok){ b.innerHTML='<div class="loading">'+esc(inb.error)+'</div>'; return; }
  const sel=new Set(d.selectedAccountIds); window._sel=sel;
  const c=d.campaign;
  b.innerHTML=`<div class="step-card"><div class="step-head"><b>Accounts to send from</b></div>
    <span class="muted">Emails rotate across the inboxes you pick.</span>
    ${inb.inboxes.length?inb.inboxes.map(i=>`<label class="day-chip wide-chip"><input type="checkbox" ${sel.has(i.id)?'checked':''} onchange="if(this.checked)window._sel.add(${i.id});else window._sel.delete(${i.id})">${esc(i.email)} <small class="muted">${esc(i.provider)}</small></label>`).join(''):'<div class="loading">No inboxes — connect one first.</div>'}</div>
    <div class="step-card"><div class="step-head"><b>Sending options</b></div>
    <label class="day-chip wide-chip"><input type="checkbox" id="o-stop" ${c.stop_on_reply?'checked':''}>Stop sending on reply</label>
    <label class="fld" style="max-width:200px">Daily limit<input id="o-limit" type="number" min="1" max="2000" value="${c.daily_limit||30}"></label></div>
    <div class="tabbar-row"><span></span><button class="primary-btn" id="o-save" onclick="saveOptions()">Save options</button></div>
    <div class="mini-msg" id="o-msg"></div>`;
}
async function saveOptions(){
  const c=state.camp.campaign, btn=$('o-save'); btn.disabled=true;
  try{
    const d1=await api('/campaigns/'+state.campaignId+'/accounts',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({accountIds:[...window._sel]})});
    const d2=await api('/campaigns/'+state.campaignId+'/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      timezone:c.timezone,send_window_start:c.send_window_start,send_window_end:c.send_window_end,send_days:c.send_days,
      daily_limit:+$('o-limit').value||30,stop_on_reply:$('o-stop').checked })});
    if(d1.ok&&d2.ok){ state.camp.campaign=d2.campaign; $('o-msg').textContent='Options saved ('+d1.count+' inbox(es)).'; }
    else $('o-msg').textContent=d1.error||d2.error;
  }catch(e){ $('o-msg').textContent='Could not reach backend: '+e.message; }
  btn.disabled=false;
}

// ============================================================================
// UNIBOX
// ============================================================================
document.querySelectorAll('.tab[data-cat]').forEach(t=>t.addEventListener('click',()=>{
  state.uniCat=t.dataset.cat;
  document.querySelectorAll('.tab[data-cat]').forEach(x=>x.classList.toggle('active',x===t));
  loadMessages();
}));
document.querySelectorAll('[data-ufilter]').forEach(b=>b.addEventListener('click',()=>{
  state.uniFilter={type:b.dataset.ufilter};
  document.querySelectorAll('.status-item').forEach(x=>x.classList.toggle('active',x===b));
  drawMessages();
}));
$('uni-search').addEventListener('input',drawMessages);

async function renderUnibox(){
  topActions('<button class="org-btn" onclick="loadMessages()">Refresh</button>');
  loadMessages(); loadUniFilters();
}
async function loadUniFilters(){
  try{
    const [c,i]=await Promise.all([api('/campaigns'),api('/inboxes')]);
    $('filter-campaigns').innerHTML=(c.campaigns||[]).map(x=>`<button class="plain-item" onclick="state.uniFilter={type:'campaign',id:${x.id}};markPlain(this);drawMessages()">${esc(x.name)}</button>`).join('')||'<span class="muted" style="padding:0 14px">—</span>';
    $('filter-inboxes').innerHTML=(i.inboxes||[]).map(x=>`<button class="plain-item" onclick="state.uniFilter={type:'inbox',id:${x.id}};markPlain(this);drawMessages()">${esc(x.email)}</button>`).join('')||'<span class="muted" style="padding:0 14px">—</span>';
  }catch{}
}
function markPlain(el){ document.querySelectorAll('.status-item,.plain-item').forEach(x=>x.classList.remove('active')); el.classList.add('active'); }
async function loadMessages(){
  const wrap=$('message-list'); wrap.innerHTML='<div class="loading">Loading…</div>';
  try{
    const d=await api('/unibox?category='+state.uniCat);
    if(!d.ok){ wrap.innerHTML='<div class="loading">'+esc(d.error)+'</div>'; return; }
    window._msgs=d.messages; drawMessages();
  }catch(e){ wrap.innerHTML='<div class="loading">Could not reach backend: '+esc(e.message)+'</div>'; }
}
function drawMessages(){
  const q=($('uni-search').value||'').toLowerCase(), f=state.uniFilter;
  const rows=(window._msgs||[]).filter(m=>{
    if(f.type==='unread'&&m.is_read)return false;
    if(f.type==='campaign'&&m.campaign_id!==f.id)return false;
    if(f.type==='inbox'&&m.account_id!==f.id)return false;
    const hay=(m.from_email+' '+(m.from_name||'')+' '+(m.subject||'')+' '+(m.body||'')).toLowerCase();
    return hay.includes(q);
  });
  const wrap=$('message-list');
  if(!rows.length){ wrap.innerHTML='<div class="loading">'+(state.uniCat==='primary'?'No campaign replies yet.':'Nothing here yet.')+'</div>'; return; }
  wrap.innerHTML=rows.map(m=>{
    const snippet=(m.body||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,90);
    const when=new Date(m.created_at).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
    return `<article class="message-card ${m.is_read?'':'unread'}" onclick="openMessage(${m.id},this)">
      <div class="message-top"><span class="message-email">${esc(m.from_name||m.from_email)}</span><span class="message-date">${when}</span></div>
      <div class="message-subject">${esc(m.subject||'(no subject)')}</div>
      <div class="message-snippet">${esc(snippet)}</div>
      ${m.campaign_name?`<div class="message-snippet" style="margin-top:6px;color:var(--blue-2)">${esc(m.campaign_name)}</div>`:''}
    </article>`;
  }).join('');
}
async function openMessage(id,card){
  document.querySelectorAll('.message-card').forEach(c=>c.classList.remove('selected')); if(card)card.classList.add('selected');
  const det=$('message-detail'); det.className='message-detail message-open'; det.innerHTML='<div class="loading">Loading thread…</div>';
  try{
    const d=await api('/unibox/thread/'+id);
    if(!d.ok){ det.innerHTML='<div class="loading">'+esc(d.error)+'</div>'; return; }
    const last=d.thread[d.thread.length-1];
    window._replyTo=id;
    det.innerHTML=`<h2>${esc(last.subject||'(no subject)')}</h2>
      <div class="message-meta">Replying goes out from the inbox that received it</div>
      <div class="thread-scroll">${d.thread.map(m=>{
        const out=m.direction==='outbound';
        return `<div class="bubble ${out?'out':''}"><div class="bubble-head"><b>${esc(out?('You'):(m.from_name||m.from_email))}</b><span class="muted">${new Date(m.created_at).toLocaleString()}</span></div><div class="bubble-body">${m.body||''}</div></div>`;
      }).join('')}</div>
      <div class="reply-box"><textarea id="reply-body" placeholder="Write your reply…"></textarea>
      <div class="tabbar-row"><span class="mini-msg" id="reply-msg" style="margin:0"></span><button class="primary-btn" id="reply-btn" onclick="sendReply()">Send reply</button></div></div>`;
    loadMessages();
  }catch(e){ det.innerHTML='<div class="loading">Could not reach backend: '+esc(e.message)+'</div>'; }
}
async function sendReply(){
  const body=$('reply-body').value.trim();
  if(!body){ $('reply-msg').textContent='Write something first.'; return; }
  const btn=$('reply-btn'); btn.disabled=true; btn.textContent='Sending…';
  try{
    const d=await api('/unibox/reply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messageId:window._replyTo,body})});
    if(d.ok) openMessage(window._replyTo,null);
    else { $('reply-msg').textContent=d.error; }
  }catch(e){ $('reply-msg').textContent='Could not reach backend: '+e.message; }
  btn.disabled=false; btn.textContent='Send reply';
}

// boot
go('campaigns');
