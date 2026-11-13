'use strict';
/* TrilhaSaúde: dados e login ficam salvos no navegador (localStorage). */
const P={home:'<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',cal:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>',file:'<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',bell:'<path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>',user:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',route:'<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.5 6H15a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h6.5"/>',chat:'<path d="M4 5h16v11H9l-5 4z"/>',steth:'<path d="M6 3v6a4 4 0 0 0 8 0V3"/><path d="M10 13v2a5 5 0 0 0 10 0v-2"/><circle cx="20" cy="11" r="2"/>',chev:'<path d="M9 6l6 6-6 6"/>',back:'<path d="M15 6l-6 6 6 6"/>',check:'<path d="M5 12l5 5 9-10"/>',trash:'<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'};
const ic=n=>`<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${P[n]}</svg>`;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $=s=>document.querySelector(s);
const STEPS=[['Cadastro','Conta criada no app'],['Consulta inicial','Avaliação com a equipe de saúde'],['Coleta do exame','Material coletado para análise'],['Análise do resultado','O laboratório analisa o material'],['Retorno com a equipe','Conversa sobre o resultado']];
const STAT=[['Agendado',''],['Coletado','wait'],['Em análise','wait'],['Resultado disponível','ok']];
const S={tab:'home',sub:null,form:null,auth:'login',err:'',del:false};

/* ---------- Armazenamento ---------- */
let USERS={},sess=null;
try{USERS=JSON.parse(localStorage.getItem('trilhosaude_users'))||{};sess=localStorage.getItem('trilhosaude_session')}catch(e){}
const persist=()=>{try{localStorage.setItem('trilhosaude_users',JSON.stringify(USERS));sess?localStorage.setItem('trilhosaude_session',sess):localStorage.removeItem('trilhosaude_session')}catch(e){}};
const me=()=>USERS[sess];
const D=()=>me().data;
const note=(t,s)=>{D().notes.unshift({t,s,r:false,at:Date.now()});D().notes.length=Math.min(D().notes.length,30)};
async function hash(p,salt){
  if(window.crypto&&crypto.subtle){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(salt+p));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')}
  return btoa(unescape(encodeURIComponent(salt+p)));
}

/* ---------- Utilidades ---------- */
const fdt=v=>{const d=new Date(v);return isNaN(d)?'':d.toLocaleString('pt-BR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).replace('.','')};
const fd=v=>v?v.split('-').reverse().join('/'):'';
const greet=()=>{const h=new Date().getHours();return h<12?'Bom dia':h<18?'Boa tarde':'Boa noite'};
const sorted=()=>[...D().appts].sort((a,b)=>new Date(a.date)-new Date(b.date));
const initial=()=>esc(me().name.trim()[0]?.toUpperCase()||'?');
function remind(){ // avisa sobre consultas nas próximas 24h
  const d=D(),now=Date.now();
  d.appts.forEach(a=>{const t=new Date(a.date).getTime();if(!a.warned&&d.lemb&&t>now&&t-now<864e5){a.warned=1;note('Consulta nas próximas 24 horas',`${a.title} · ${fdt(a.date)}`)}});
}

/* ---------- Telas ---------- */
const apptRow=(a,full)=>{
  const past=new Date(a.date)<Date.now();
  return `<div class="row" ${full?'':'data-a="tab" data-v="consultas" role="button" tabindex="0"'}><span class="badge">${ic('steth')}</span><span class="t"><b>${esc(a.title)}</b><span class="s">${esc(a.who)}${a.who?' · ':''}${fdt(a.date)}</span></span>${full?`<span class="acts">${past?'<span class="pill">Realizada</span>':`<button class="${a.ok?'pill ok':'btn ghost'}" data-a="conf" data-id="${a.id}">${a.ok?'Confirmada':'Confirmar'}</button>`}<button class="x" data-a="delA" data-id="${a.id}" aria-label="Excluir consulta">${ic('trash')}</button></span>`:ic('chev')}</div>`;
};
function home(){
  const d=D(),up=sorted().filter(a=>new Date(a.date)>=Date.now()).slice(0,2),first=esc(me().name.trim().split(' ')[0]);
  return `<div class="top"><div><small>${greet()}, ${first}</small><h1>Olá, ${first}!</h1><p class="sub">Vamos cuidar da sua saúde hoje?</p></div><button class="avatar" data-a="tab" data-v="perfil" aria-label="Abrir perfil">${initial()}</button></div>
  <div class="hero"><small>${d.done<5?'Seu exame está em andamento':'Jornada concluída'}</small><b>${d.done<5?'Você está no caminho certo':'Você concluiu todas as etapas'}</b><div class="bar"><i style="width:${d.done/5*100}%"></i></div><p>${d.done} de 5 etapas concluídas</p></div>
  <div class="sec"><h2>Acessos rápidos</h2></div>
  <div class="quick"><button data-a="tab" data-v="consultas">${ic('cal')}Minhas consultas</button><button data-a="tab" data-v="exames">${ic('file')}Meus exames</button><button data-a="go" data-v="jornada">${ic('route')}Acompanhar jornada</button><button data-a="go" data-v="chat">${ic('chat')}Falar com a equipe</button></div>
  <div class="sec"><h2>Próximos compromissos</h2><button class="link" data-a="tab" data-v="consultas">Ver todos</button></div>
  ${up.length?up.map(a=>apptRow(a,false)).join(''):'<p class="empty">Nenhum compromisso por aqui. Agende sua consulta na aba Consultas.</p>'}`;
}
function consultas(){
  const l=sorted();
  return `<div class="top"><div><h1>Consultas</h1><p class="sub">Seus compromissos de saúde</p></div><button class="btn" data-a="new" data-v="appt">Agendar</button></div>
  ${S.form=='appt'?`<form class="f" data-f="appt"><label>Tipo de consulta<input name="title" required maxlength="60" placeholder="Ex.: Consulta ginecológica"></label><label>Profissional ou local<input name="who" maxlength="60" placeholder="Ex.: Dra. Camila, UBS Centro"></label><label>Data e hora<input type="datetime-local" name="date" required></label><div class="two"><button class="btn">Salvar consulta</button><button type="button" class="btn ghost" data-a="cancel">Cancelar</button></div></form>`:''}
  <div style="margin-top:16px">${l.length?l.map(a=>apptRow(a,true)).join(''):'<p class="empty">Você ainda não agendou nenhuma consulta.</p>'}</div>`;
}
function exames(){
  const l=[...D().exams].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  return `<div class="top"><div><h1>Exames</h1><p class="sub">Acompanhe o andamento de cada um</p></div><button class="btn" data-a="new" data-v="exam">Adicionar</button></div>
  ${S.form=='exam'?`<form class="f" data-f="exam"><label>Nome do exame<input name="name" required maxlength="60" placeholder="Ex.: Papanicolau"></label><label>Data<input type="date" name="date" required></label><label>Situação<select name="status">${STAT.map(s=>`<option>${s[0]}</option>`).join('')}</select></label><div class="two"><button class="btn">Salvar exame</button><button type="button" class="btn ghost" data-a="cancel">Cancelar</button></div></form>`:''}
  <div style="margin-top:16px">${l.length?l.map(e=>`<div class="row"><span class="badge">${ic('file')}</span><span class="t"><b>${esc(e.name)}</b><span class="s">${fd(e.date)}</span><select class="pill ${(STAT.find(s=>s[0]==e.status)||[])[1]||''}" data-st="${e.id}" aria-label="Situação de ${esc(e.name)}">${STAT.map(s=>`<option ${s[0]==e.status?'selected':''}>${s[0]}</option>`).join('')}</select></span><button class="x" data-a="delE" data-id="${e.id}" aria-label="Excluir exame">${ic('trash')}</button></div>`).join(''):'<p class="empty">Nenhum exame cadastrado ainda.</p>'}</div>`;
}
function jornada(){
  const n=D().done;
  return `<button class="back" data-a="tab" data-v="home">${ic('back')}Voltar</button><h1>Sua jornada</h1><p class="sub">${n} de 5 etapas concluídas</p>
  <div style="margin-top:18px">${STEPS.map((s,i)=>`<div class="step ${i<n?'done':i==n?'now':''}"><span class="c">${i<n?ic('check'):''}</span><div><b>${s[0]}</b><span>${s[1]}</span></div></div>`).join('')}</div>
  <div class="two f" style="flex-direction:row">${n<5?'<button class="btn" data-a="next">Concluir etapa atual</button>':''}${n>1?'<button class="btn ghost" data-a="undo">Desfazer última</button>':''}</div>`;
}
function notificacoes(){
  const l=D().notes;
  return `<div class="top"><div><h1>Notificações</h1><p class="sub">Avisos sobre exames e consultas</p></div>${l.length?'<button class="link" data-a="readall">Marcar lidas</button>':''}</div>
  <div style="margin-top:16px">${l.length?l.map((n,i)=>`<div class="row" data-a="read" data-id="${i}" role="button" tabindex="0">${n.r?'<span style="width:9px"></span>':'<span class="dot"></span>'}<span class="t"><b>${esc(n.t)}</b><span class="s">${esc(n.s)}</span></span></div>`).join('')+'<button class="link" data-a="clearn">Limpar notificações</button>':'<p class="empty">Você não tem notificações.</p>'}</div>`;
}
function perfil(){
  const u=me();
  return `<div class="center" style="padding-top:8px"><div class="avatar" style="width:76px;height:76px;font-size:30px;margin:0 auto 10px">${initial()}</div><h1>${esc(u.name)}</h1><p class="sub">${esc(sess)}</p></div>
  <form class="f" data-f="perfil"><label>Nome<input name="name" required maxlength="60" value="${esc(u.name)}"></label><label>Telefone<input name="phone" type="tel" maxlength="20" value="${esc(u.data.phone)}" placeholder="(81) 90000-0000"></label><button class="btn">Salvar perfil</button></form>
  <div class="row"><span class="t"><b>Lembretes de consulta</b><span class="s">Avisar 24 horas antes</span></span><button class="sw ${u.data.lemb?'on':''}" data-a="lemb" role="switch" aria-checked="${!!u.data.lemb}" aria-label="Lembretes de consulta"></button></div>
  <button class="btn ghost big" data-a="logout" style="margin-top:6px">Sair da conta</button>
  <button class="btn danger big" data-a="delacc" style="margin-top:10px">${S.del?'Toque de novo para excluir tudo':'Excluir minha conta'}</button>`;
}
function chat(){
  return `<div class="screen" id="cs"><button class="back" data-a="tab" data-v="home">${ic('back')}Voltar</button><h1>Equipe de cuidado</h1><p class="sub">Mensagens ficam salvas neste aparelho</p><div class="chat">${D().msgs.map(m=>`<div class="msg ${m.me?'me':'team'}">${esc(m.t)}</div>`).join('')}</div></div><form class="send" data-f="chat"><input name="t" id="inp" placeholder="Escreva sua mensagem" aria-label="Mensagem" autocomplete="off"><button class="btn">Enviar</button></form>`;
}
function authView(){
  const c=S.auth=='cad';
  return `<div class="screen auth"><div class="logo" aria-hidden="true">🩺</div><h1>TrilhaSaúde</h1><p class="sub">Acompanhe seus exames e consultas em um só lugar</p>
  <form class="f" data-f="auth">${c?'<label>Nome<input name="name" required maxlength="60" autocomplete="name"></label>':''}<label>E-mail<input type="email" name="email" required autocomplete="email"></label><label>Senha<input type="password" name="password" required minlength="6" autocomplete="${c?'new-password':'current-password'}"></label>${S.err?`<p class="err" role="alert">${esc(S.err)}</p>`:''}<button class="btn big">${c?'Criar conta':'Entrar'}</button></form>
  <button class="link" data-a="mode">${c?'Já tenho conta. Entrar':'Ainda não tenho conta. Cadastrar'}</button></div>`;
}
const V={home,consultas,exames,jornada,notificacoes,perfil};
const TABS=[['home','Início','home'],['consultas','Consultas','cal'],['exames','Exames','file'],['notificacoes','Notificações','bell'],['perfil','Perfil','user']];

function render(){
  const root=$('#app');
  if(sess&&!USERS[sess])sess=null;
  if(!sess){root.innerHTML=authView();return}
  remind();
  const cur=S.sub||S.tab,un=D().notes.filter(n=>!n.r).length;
  root.innerHTML=(cur=='chat'?chat():`<div class="screen">${V[cur]()}</div>`)+`<nav>${TABS.map(t=>`<button class="${S.tab==t[0]&&!S.sub?'on':''}" data-a="tab" data-v="${t[0]}">${ic(t[2])}${t[1]}${t[0]=='notificacoes'&&un?`<span class="n">${un}</span>`:''}</button>`).join('')}</nav>`;
  const cs=$('#cs');if(cs){cs.scrollTop=cs.scrollHeight;$('#inp').focus()}
}

/* ---------- Ações ---------- */
async function doAuth(v){
  const m=v.email.trim().toLowerCase(),p=v.password;S.err='';
  if(S.auth=='cad'){
    if(USERS[m]){S.err='Este e-mail já tem cadastro. Entre com sua senha.';return}
    const salt=Math.random().toString(36).slice(2);
    USERS[m]={name:v.name.trim(),salt,hash:await hash(p,salt),data:{appts:[],exams:[],notes:[],msgs:[{me:false,t:'Olá! Escreva aqui suas dúvidas sobre consultas e exames.'}],done:1,lemb:true,phone:''}};
    sess=m;note('Bem-vinda ao TrilhaSaúde','Cadastre suas consultas e exames para acompanhá-los aqui.');
  }else{
    const u=USERS[m];
    if(!u||u.hash!==await hash(p,u.salt)){S.err='E-mail ou senha incorretos.';return}
    sess=m;
  }
  S.tab='home';S.sub=null;
}
const ACT={
  tab:v=>{S.tab=v;S.sub=null;S.form=null;S.del=false},
  go:v=>{S.sub=v},
  mode:()=>{S.auth=S.auth=='cad'?'login':'cad';S.err=''},
  new:v=>{S.form=v},cancel:()=>{S.form=null},
  conf:(v,id)=>{const a=D().appts.find(x=>x.id==id);a.ok=!a.ok},
  delA:(v,id)=>{D().appts=D().appts.filter(x=>x.id!=id)},
  delE:(v,id)=>{D().exams=D().exams.filter(x=>x.id!=id)},
  next:()=>{const d=D();if(d.done<5){note('Etapa concluída',STEPS[d.done][0]);d.done++}},
  undo:()=>{if(D().done>1)D().done--},
  read:(v,i)=>{D().notes[i].r=true},
  readall:()=>D().notes.forEach(n=>n.r=true),
  clearn:()=>{D().notes=[]},
  lemb:()=>{D().lemb=!D().lemb},
  logout:()=>{sess=null;S.tab='home';S.sub=null},
  delacc:()=>{if(!S.del){S.del=true;return}delete USERS[sess];sess=null;S.del=false;S.tab='home'}
};
$('#app').addEventListener('click',e=>{
  const b=e.target.closest('[data-a]');if(!b)return;
  ACT[b.dataset.a]?.(b.dataset.v,b.dataset.id);persist();render();
});
$('#app').addEventListener('keydown',e=>{if((e.key=='Enter'||e.key==' ')&&e.target.matches('[role=button]')){e.preventDefault();e.target.click()}});
$('#app').addEventListener('change',e=>{
  const s=e.target.closest('[data-st]');if(!s)return;
  const ex=D().exams.find(x=>x.id==s.dataset.st);ex.status=s.value;
  note('Exame atualizado',`${ex.name}: ${ex.status}`);persist();render();
});
$('#app').addEventListener('submit',async e=>{
  e.preventDefault();
  const f=e.target,k=f.dataset.f,v=Object.fromEntries(new FormData(f));
  if(k=='auth')await doAuth(v);
  else if(k=='appt'){D().appts.push({id:Date.now(),title:v.title.trim(),who:v.who.trim(),date:v.date,ok:false});note('Consulta agendada',`${v.title.trim()} · ${fdt(v.date)}`);S.form=null}
  else if(k=='exam'){D().exams.push({id:Date.now(),name:v.name.trim(),date:v.date,status:v.status});note('Exame cadastrado',`${v.name.trim()} · ${v.status}`);S.form=null}
  else if(k=='perfil'){me().name=v.name.trim();D().phone=v.phone.trim();note('Perfil atualizado','Seus dados foram salvos.')}
  else if(k=='chat'){
    const t=v.t.trim();if(!t)return;
    const who=sess;D().msgs.push({me:true,t});persist();render();
    setTimeout(()=>{if(USERS[who]){USERS[who].data.msgs.push({me:false,t:'Recebemos sua mensagem. A equipe responde em breve.'});persist();if(sess==who&&S.sub=='chat')render()}},900);
    return;
  }
  persist();render();
});
render();
