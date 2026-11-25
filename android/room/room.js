'use strict';
const $=sel=>document.querySelector(sel);
const main=$('main'), bottomNav=$('#bottom-nav'), pending=new Map();
let serial=0,revision=0,page='login',name='',owner=false,setup=false,cache,selected,hideTimer;
let offline=false,hasAccount=false,locked=false,previewUrl=null,cloudUrl='',studentEmail='';
function rpc(op,data={}){
  if(offline && ['home','subject','source','addSource'].includes(op))return offlineData(op,data);
  const id=++serial;
  return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});Classroom.request(id,JSON.stringify({...data,op}));});
}
window.complete=(id,raw)=>{
  const call=pending.get(id);if(!call)return;pending.delete(id);
  const result=JSON.parse(raw);
  if(result.error)call.reject(Error(result.error));else call.resolve(result.value);
};
function message(value){$('#message').hidden=false;$('#message').textContent=value;clearTimeout(hideTimer);hideTimer=setTimeout(()=>$('#message').hidden=true,6500);}
window.backupComplete=(success,description)=>message((success?'✓ ':'')+description);
function el(tag,text='',cls=''){const n=document.createElement(tag);n.className=cls;n.textContent=text;return n;}
function wrap(cls,...items){const n=el('div','',cls);n.append(...items);return n;}
function button(label,action,cls=''){
  const b=el('button',label,cls);b.type='button';
  b.onclick=async()=>{b.disabled=true;try{await action();}catch(err){message(err.message);}finally{b.disabled=false;}};return b;
}
function hero(title,subtitle){return wrap('hero',el('h1',title),el('small',subtitle));}
function tile(title,detail,symbol,fn){
  const b=button('',fn,'tile'), icon=el('i',symbol);
  icon.setAttribute('aria-hidden','true');
  b.append(icon,el('strong',title),el('small',detail));
  return b;
}
function field(label,key,type='text',value=''){
  const l=el('label',label,'field'),n=el(type==='textarea'?'textarea':'input');
  if(type!=='textarea')n.type=type;else n.rows=3;
  if(type==='email'){n.dir='ltr';n.maxLength=254;n.autocomplete='email';n.spellcheck=false;}
  n.name=key;n.value=value;if(type==='textarea')n.defaultValue=value;n.required=true;l.append(n);return l;
}
function form(title,fields,label,fn){
  const f=el('form'),status=el('p');status.setAttribute('role','status');
  const submit=el('button',label,'primary');submit.type='submit';
  if(title)f.append(el('h3',title));
  f.append(...fields,submit,status);
  f.onsubmit=async e=>{e.preventDefault();submit.disabled=true;status.textContent='جارٍ التنفيذ…';
    try{await fn(Object.fromEntries(new FormData(f)),status,e.submitter);if(status.textContent==='جارٍ التنفيذ…')status.textContent='';}
    catch(err){status.textContent=err.message;}finally{submit.disabled=false;}};
  return f;
}
const links=()=>[['home',owner?'لوحة الصف':'المواد'],['feed','الإشعارات'],['feedback','الاقتراحات'],...(owner?[['accounts','الطلاب']]:[]),['settings','الإعدادات']];
// Icon geometry from Lucide (ISC), https://lucide.dev/license.
const navIconPaths={
  home:['m3 10 9-7 9 7v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z','M9 21v-6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v6'],
  feed:['M10 20a2 2 0 0 0 4 0','M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9'],
  feedback:['M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z'],
  accounts:['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2','M22 21v-2a4 4 0 0 0-3-3.87','M16 3.13a4 4 0 0 1 0 7.75','M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0'],
  settings:['M4 7h16M4 17h16','M10 4v6M15 14v6'],
};
function navIcon(key){
  const namespace='http://www.w3.org/2000/svg';
  const icon=document.createElementNS(namespace,'svg');
  for(const [attribute,value] of Object.entries({viewBox:'0 0 24 24','aria-hidden':'true',fill:'none',stroke:'currentColor','stroke-width':'1.8','stroke-linecap':'round','stroke-linejoin':'round'}))
    icon.setAttribute(attribute,value);
  for(const value of navIconPaths[key]){
    const path=document.createElementNS(namespace,'path');
    path.setAttribute('d',value);icon.append(path);
  }
  return icon;
}
function navigation(){
  const show=Boolean(name)&&(owner||!locked);
  bottomNav.hidden=!show;
  document.documentElement.classList.toggle('has-bottom-nav',show);
  document.body.dataset.role=owner?'owner':'student';
  $('#role').textContent=owner?'المالك':'الطالب';
  if(!show){bottomNav.replaceChildren();return;}
  if(!bottomNav.childElementCount){
    bottomNav.replaceChildren(...links().map(([key,label])=>{
      const entry=button('',()=>go(key,undefined,true),'bottom-tab');
      entry.dataset.page=key;
      entry.setAttribute('aria-label',label);
      entry.append(navIcon(key),el('span',label,'bottom-tab-label'));
      return entry;
    }));
  }
  const active=['subject','source','quiz','newSource'].includes(page)?'home':page==='notes'?'settings':page;
  for(const entry of bottomNav.children){
    if(entry.dataset.page===active)entry.setAttribute('aria-current','page');
    else entry.removeAttribute('aria-current');
  }
}
bottomNav.addEventListener('keydown',event=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  const options=Array.from(bottomNav.children);
  const index=options.indexOf(document.activeElement);
  if(index<0)return;
  event.preventDefault();
  const offset=event.key==='ArrowLeft'?1:-1;
  const next=event.key==='Home'?0:event.key==='End'?options.length-1:(index+offset+options.length)%options.length;
  options[next].focus();
});
async function boot(){
  const state=await rpc('boot');
  owner=state.owner;setup=state.setup;hasAccount=state.hasAccount;locked=state.locked;offline=!owner;
  cloudUrl=state.cloudUrl||'';studentEmail=state.email||'';
  if(owner&&state.savedSession){
    try{name=(await rpc('resume')).name;}
    catch(err){message(err.message);}
  }else if(!owner)name=state.studentName||'';
  await go(owner?(!name?'login':'home'):locked?'unlock':studentEmail?'home':'linkEmail');
}
async function go(next,item,focusPage=false){
  if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null;}
  page=next;const mine=++revision;
  if(item&&(next==='subject'||next==='newSource'))selected=item;
  navigation();
  const pages={unlock,linkEmail,login,home,feed,feedback,accounts,settings,notes,subject,newSource,source,quiz,sharedAll};
  try{
    if((name||offline)&&['home','feed','feedback','accounts','settings','subject'].includes(next))cache=await rpc('home');
    if(mine!==revision)return;
    const nodes=await pages[next](item);
    if(mine===revision){
      main.replaceChildren(...nodes.filter(Boolean));window.scrollTo(0,0);
      if(next==='accounts')refreshRegistrations($('#registrations'));
      if(next==='feed'&&!owner)refreshStudentNotices(true).catch(err=>message(err.message));
      if(next==='feedback'&&!owner)refreshStudentFeedback();
      if(focusPage){
        const heading=main.querySelector('h1');
        if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}
      }
    }
  }catch(err){
    if(mine!==revision)return;
    if(err.message.includes('انتهت الجلسة')){name='';await go(owner?'login':'unlock');return;}
    main.replaceChildren(hero('تعذّر فتح الصفحة',err.message),button('إعادة المحاولة',()=>go(next,item)),button('العودة',()=>go(owner&&!name?'login':!owner&&locked?'unlock':'home')));
  }
}
function login(){
  return [hero('لوحة قوم دروس','إدارة الصف'),form(setup?'إنشاء حساب المالك':'تسجيل الدخول',[field('الاسم','name'),field(setup?'كلمة السر · ٨ أحرف على الأقل':'كلمة السر','password','password')],setup?'إنشاء اللوحة':'دخول',async data=>{
    name=(await rpc(setup?'setup':'login',data)).name;
    setup=false;
    await go('home');
  })];
}
function unlock(){
  const identity=hasAccount&&studentEmail
    ? field('البريد الإلكتروني','email','email',studentEmail)
    : field('الاسم','name','text',name);
  return [hero('قوم دروس','حساب الطالب على هذا الهاتف'),
    !hasAccount&&el('p','يحتاج التسجيل إلى دعوة من المالك واتصال بالإنترنت. يظهر اسمك وبريدك للمالك، وتبقى كلمة السر على هاتفك.','empty-state'),
    form(hasAccount?'تسجيل الدخول':'إنشاء حساب الطالب',[
      identity,...(!hasAccount?[field('البريد الإلكتروني','email','email'),field('رمز دعوة الصف','invite')]:[]),
      field('كلمة السر · ٦ أحرف على الأقل','password','password')
    ],hasAccount?'دخول':'تسجيل',async data=>{
      const account=await rpc(hasAccount?'unlock':'register',data);
      name=account.name;studentEmail=account.email;
      locked=false;hasAccount=true;
      await go(studentEmail?'home':'linkEmail');
    })];
}
function linkEmail(){
  return [hero('ربط البريد الإلكتروني','حساب الطالب'),
    el('p','أضف بريدك لاستخدام إشعارات الصف واقتراحاته ومنشوراته. يظهر البريد في لوحة المالك.','empty-state'),
    form('',[field('البريد الإلكتروني','email','email'),field('رمز دعوة الصف','invite')],'ربط البريد',async data=>{
      studentEmail=(await rpc('linkEmail',data)).email;
      await go('home');
    }),button('لاحقًا',()=>go('home'))];
}
const symbols=['ϟ','⚗','✿','Aa','∑'];
const number=new Intl.NumberFormat('ar-SY');
function home(){
  const subjects=cache.subjects,grid=wrap('grid');
  const render=q=>{
    const hits=subjects.filter(s=>s.name.includes(q));
    grid.replaceChildren(...hits.map(s=>{
      const count=s.docs||0;
      const detail=count===0?'لا مصادر بعد':count===1?'مصدر واحد':count===2?'مصدران':number.format(count)+(count<=10?' مصادر':' مصدرًا');
      const progress=s.page?' · ص '+number.format(s.page):'';
      return tile(s.name,detail+progress,symbols[(s.id-1)%symbols.length],()=>{tab='sources';return go('subject',s);});
    }));
    if(!hits.length)grid.append(el('p',q?'ما في مادة بهذا الاسم.':'لا توجد مواد بعد.','empty-state'));
  };
  const search=el('input');search.type='search';search.placeholder='ابحث عن مادة';search.setAttribute('aria-label',search.placeholder);search.oninput=()=>render(search.value.trim());render('');
  const waiting=cache.feedback.filter(x=>!x.reply).length;
  return [hero(owner?'نظرة على الصف':'المواد الدراسية',owner?name:(name||'مكتبة الدروس')),
    owner&&wrap('grid stat-grid',tile('تسجيلات الطلاب','عرض المسجلين','◉',()=>go('accounts')),tile('صندوق الاقتراحات',number.format(waiting)+' بانتظار الرد','✉',()=>go('feedback')),tile('إشعار جديد','إرسال إلى الصف','＋',()=>go('feed'))),
    owner&&button('منشورات الطلاب',()=>go('sharedAll'), 'primary'),owner&&el('h2','المواد الدراسية','section-title'),search,grid,owner&&form('مادة جديدة',[field('اسم المادة','name')],'إضافة مادة',async d=>{await rpc('addSubject',d);await go('home');})];
}
function noticeCards(notices){
  return notices.map(n=>wrap('card',el('small',date(n.created)),el('h3',n.title),el('pre',n.body)));
}
async function refreshStudentNotices(refresh=false){
  const list=$('#student-notices');
  if(!list)return;
  const {notices,online,configured,blocked}=await rpc('studentNotices',{refresh});
  if(!list.isConnected)return;
  if(blocked){list.replaceChildren(el('p',blocked,'empty-state'));return;}
  if(!studentEmail){list.replaceChildren(button('ربط البريد الإلكتروني',()=>go('linkEmail')));return;}
  const status=online?(notices.length?'':'لا توجد إشعارات بعد.')
    :notices.length?'تعذّر الوصول إلى لوحة المالك. هذه الإشعارات المحفوظة على الهاتف.'
    :configured?'بانتظار الاتصال بخادم الصف. تظهر التحديثات عند عودة الإنترنت.':'اربط الصف عبر الإنترنت من الإعدادات لاستقبال الإشعارات.';
  list.replaceChildren(...(status?[el('p',status,'empty-state')]:[]),...noticeCards(notices));
}
window.noticesUpdated=()=>refreshStudentNotices().catch(()=>{});
async function feed(){
  const heading=hero('الإشعارات','أخبار الصف وتذكيراته');
  if(!owner){
    const list=wrap('registration-list');list.id='student-notices';list.setAttribute('aria-live','polite');
    return [heading,button('تحديث الإشعارات',()=>refreshStudentNotices(true)),list];
  }
  const notices=cloudUrl?(await rpc('onlineNotices')).notices:cache.notices;
  return [heading,!cloudUrl&&connectionPrompt(),cloudUrl&&form('إشعار عام',[field('العنوان','title'),field('نص الإشعار','body','textarea')],'نشر للطلاب',async data=>{
    await rpc('onlinePublish',data);await go('feed');
  }),...noticeCards(notices),!notices.length&&el('p','ستظهر أخبار الصف هنا عند نشرها.'),button('تحديث',()=>go('feed'))];
}
const date=v=>new Intl.DateTimeFormat('ar-SY',{weekday:'long',month:'long',day:'numeric',year:'numeric'}).format(v);
function feedbackCard(entry){
  const heading=(owner?entry.name+' · ':'')+date(entry.created);
  return wrap('card',el('small',heading),el('pre',entry.body),el('b',entry.reply?'رد المالك':'بانتظار الرد'),
    ...(entry.reply?[el('pre',entry.reply)]:[]));
}
function showStudentFeedback(list,result){
  if(result.blocked){list.replaceChildren(el('p',result.blocked,'empty-state'));return;}
  if(!studentEmail){list.replaceChildren(button('ربط البريد الإلكتروني',()=>go('linkEmail')));return;}
  const entries=result.entries.map(feedbackCard);
  const pending=result.pending.map(item=>wrap('card',el('small',date(item.created)),
    el('pre',item.body),el('strong','بانتظار الإرسال')));
  const state=!result.configured?'اربط الصف عبر الإنترنت لإرسال الاقتراحات.'
    :pending.length||entries.length?'':'لم ترسل اقتراحات بعد.';
  list.replaceChildren(...pending,...entries,...(state?[el('p',state,'empty-state')]:[]));
}
async function refreshStudentFeedback(refresh=false){
  const list=$('#student-feedback');
  if(!list)return;
  try{
    const result=await rpc('studentFeedback',{refresh});
    if(list.isConnected)showStudentFeedback(list,result);
  }catch(error){if(list.isConnected)list.replaceChildren(el('p',error.message,'empty-state'));}
}
window.cloudUpdated=()=>refreshStudentFeedback();
let ownerInboxSnapshot='', ownerInboxChecking=false;
setInterval(async()=>{
  if(!owner||!cloudUrl||page!=='feedback'||document.hidden||ownerInboxChecking||
      main.querySelector('textarea:focus')||Array.from(main.querySelectorAll('textarea')).some(input=>input.value!==input.defaultValue))return;
  const current=revision;
  ownerInboxChecking=true;
  try{
    const {entries}=await rpc('onlineFeedback');
    if(current===revision&&JSON.stringify(entries)!==ownerInboxSnapshot&&
        !main.querySelector('textarea:focus')&&!Array.from(main.querySelectorAll('textarea')).some(input=>input.value!==input.defaultValue)){
      await go('feedback');
    }
  }catch{}finally{ownerInboxChecking=false;}
},5000);
async function feedback(){
  if(owner){
    const entries=cloudUrl?(await rpc('onlineFeedback')).entries:cache.feedback;
    ownerInboxSnapshot=JSON.stringify(entries);
    return [hero('صندوق الاقتراحات','رسائل الطلاب'),!cloudUrl&&connectionPrompt(),
      ...entries.map(entry=>{
        const card=feedbackCard(entry);
        if(cloudUrl)card.append(form('الرد',[field('نص الرد','body','textarea',entry.reply||'')],'حفظ الرد',async data=>{
          await rpc('onlineReply',{...data,id:entry.id});await go('feedback');
        }));
        return card;
      }),
      !entries.length&&el('p','لا توجد اقتراحات بعد.','empty-state'),button('تحديث',()=>go('feedback'))];
  }
  const draftKey='suggestion-draft';
  const draft=field('اكتب اقتراحك','body','textarea',localStorage.getItem(draftKey)||localStorage.getItem('suggestion-pending-body')||'');
  const input=draft.querySelector('textarea');input.maxLength=2000;
  input.oninput=()=>localStorage.setItem(draftKey,input.value);
  const list=wrap('registration-list');list.id='student-feedback';
  list.append(el('p','جارٍ جلب الاقتراحات…','empty-state'));
  const composer=form('',[draft],'إرسال للمالك',async data=>{
    const body=data.body.trim();
    if(!body)throw Error('اكتب الاقتراح أولًا.');
    const result=await rpc('studentSuggest',{body});
    localStorage.removeItem('suggestion-pending-body');localStorage.removeItem('suggestion-pending-id');
    if(input.value.trim()===body){input.value='';localStorage.removeItem(draftKey);}
    showStudentFeedback(list,result);
    message(result.pending.length?'حُفظ الاقتراح للإرسال عند الاتصال.':'وصل الاقتراح إلى المالك.');
  });
  return [hero('الاقتراحات','رسائلي وردود المالك'),composer,button('تحديث الردود',()=>refreshStudentFeedback(true)),list];
}
const dateTime=v=>new Intl.DateTimeFormat('ar-SY',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}).format(v);
function updateRegistrationList(container, data){
  container.replaceChildren(el('small',number.format(data.total)+' تسجيل'),
    ...data.entries.map(entry=>{
      const email=el('p',entry.email||'البريد غير مربوط');
      if(entry.email)email.dir='ltr';
      const card=wrap('card',el('strong',entry.name),email,el('small','تم التسجيل · '+dateTime(entry.created)));
      if(entry.email){
        if(entry.enrolled)card.append(button('إلغاء اعتماد الجهاز',async()=>{
          if(!confirm('إلغاء اعتماد الجهاز الحالي لهذا البريد؟'))return;
          await rpc('onlineResetRegistration',{email:entry.email});
          await go('accounts');
        },'danger'));
        const blocked=Boolean(entry.blocked);
        card.append(el('small',blocked?'محظور':'مسموح له باستخدام الصف'),
          button(blocked?'رفع الحظر':'حظر البريد',async()=>{
            if(!blocked&&!confirm('حظر '+entry.email+' من الصف على جميع أجهزته؟'))return;
            await rpc(blocked?'onlineUnblockEmail':'onlineBlockEmail',{email:entry.email});
            await go('accounts');
          },blocked?'':'danger'));
      }
      return card;
    }),
    ...(!data.entries.length?[el('p','تظهر هنا أسماء الطلاب بعد ربط الصف.','empty-state')]:[]));
}
async function refreshRegistrations(container){
  if(!container?.isConnected||container.dataset.loading)return;
  container.dataset.loading='true';
  try{
    const data=await rpc(cloudUrl?'onlineRegistrations':'registrations');
    const snapshot=JSON.stringify(data);
    if(container.isConnected&&container.dataset.snapshot!==snapshot){
      updateRegistrationList(container,data);
      container.dataset.snapshot=snapshot;
    }
  }catch(err){if(container.isConnected&&!container.dataset.snapshot)container.replaceChildren(el('p',err.message,'empty-state'));}
  finally{delete container.dataset.loading;}
}
setInterval(()=>{
  if(owner&&page==='accounts'&&!document.hidden)refreshRegistrations($('#registrations'));
},5000);
async function accounts(){
  const list=wrap('registration-list');list.id='registrations';
  const code=el('input');
  code.readOnly=true;code.dir='ltr';code.setAttribute('aria-label','رمز دعوة الطالب');
  const result=wrap('card',el('strong','رمز الدعوة · صالح ٢٤ ساعة'),code,
    button('نسخ الرمز',async()=>{code.select();if(!document.execCommand('copy'))throw Error('حدّد الرمز وانسخه.');message('نُسخ رمز الدعوة.');}));
  result.hidden=true;
  const invitation=form('دعوة طالب',[field('اسم الطالب','name'),field('بريد الطالب','email','email')],'إنشاء دعوة',async(data,status)=>{
    const issued=await rpc('onlineCreateInvite',data);
    code.value=issued.invite;result.hidden=false;code.focus();code.select();status.textContent='أُنشئت الدعوة.';
  });
  const revoke=form('إلغاء دعوة معلّقة',[field('بريد الطالب','email','email')],'إلغاء الدعوة',async(data,status)=>{
    await rpc('onlineRevokeInvite',data);result.hidden=true;code.value='';status.textContent='أُلغيت الدعوة.';
  });
  return [hero('الطلاب',cloudUrl?'تسجيلات الصف':'التسجيلات المحفوظة'),invitation,result,revoke,list,
    cache.students.length>0&&el('h2','حسابات الصف السابقة'),
    ...cache.students.map(entry=>wrap('card',el('strong',entry.name),
      el('small',entry.last_seen?'آخر نشاط: '+dateTime(entry.last_seen):'لم يسجّل الدخول بعد'),
      el('p','مصادر أضافها: '+entry.sources+' · اختبارات أجاب عنها: '+entry.quizzes+' · اقتراحات: '+entry.suggestions)))];
}
function connectionPrompt(){
  return button('ربط الصف عبر الإنترنت',()=>go('settings'));
}
async function notes(){
  const picker=el('select');
  picker.setAttribute('aria-label','المادة');
  readings.forEach(([subject],index)=>{
    const option=el('option',subject);option.value=String(index);picker.append(option);
  });
  const entry=field('ملاحظتك','text','textarea');
  const input=entry.querySelector('textarea');
  input.rows=8;input.maxLength=16000;input.required=false;
  await load();
  async function load(){
    const index=picker.value;
    input.disabled=true;
    try{
      const data=await rpc('getNote',{index:Number(index)});
      if(index===picker.value)input.value=data.text;
    }finally{if(index===picker.value)input.disabled=false;}
  }
  picker.onchange=()=>load().catch(error=>message(error.message));
  return [hero('ملاحظاتي','محفوظة على هاتفك'),form('',[wrap('field',el('span','المادة'),picker),entry],
    'حفظ الملاحظة',async(data,status)=>{
      if(input.disabled)return;
      await rpc('saveNote',{index:Number(picker.value),text:data.text});
      status.textContent='حُفظت الملاحظة على هذا الهاتف.';
    })];
}
function settings(){
  const enrollment=owner?wrap('card',el('h2','اتصال لوحة المالك')):null;
  if(enrollment){
    const status=el('p','جارٍ التحقق من الاتصال…');
    enrollment.append(status);
    rpc('onlineStatus').then(()=>{status.textContent='متصل بالصف عبر الإنترنت.';}).catch(async error=>{
      status.textContent=error.message;
      if(!error.message.includes('بانتظار اعتماد'))return;
      try{
        const {code}=await rpc('ownerEnrollment');
        const label=field('رمز اعتماد هذا الهاتف','device','text',code);
        label.querySelector('input').readOnly=true;
        enrollment.append(label);
      }catch(err){status.textContent=err.message;}
    });
  }
  return [hero('الإعدادات',name||'قوم دروس'),enrollment,
    offline&&!studentEmail&&button('ربط البريد الإلكتروني',()=>go('linkEmail')),
    offline&&studentEmail&&form('ربط هذا الجهاز بالصف',[field('رمز دعوة الصف','invite')],'تفعيل الدعوة',async(data,status)=>{
      await rpc('renewInvitation',data);status.textContent='ربطنا جهازك بالصف.';
    }),
    offline&&button('ملاحظاتي',()=>go('notes')),
    owner&&wrap('card',el('h2','النسخ الاحتياطي المشفّر'),
      el('p','احفظ نسخة من بيانات هذه اللوحة على الهاتف. لبيانات الصف عبر الإنترنت نسخة احتياطية تُؤخذ من الخادم.'),
      form('حفظ نسخة احتياطية',[field('كلمة مرور للنسخة · ١٢ حرفًا على الأقل','password','password')],'اختيار مكان الحفظ',async d=>{
        await rpc('backup',{password:d.password});message('اختر مكان حفظ ملف النسخة المشفّرة.');
      }),
      form('استعادة نسخة احتياطية',[field('كلمة مرور النسخة السابقة','password','password')],'اختيار ملف للاستعادة',async d=>{
        if(!confirm('سيُستبدل محتوى لوحة المالك بالبيانات الموجودة في النسخة. هل تريد المتابعة؟'))return;
        await rpc('restore',{password:d.password});message('اختر ملف النسخة لاستعادة البيانات.');
      })
    ),
    !offline&&button('تسجيل الخروج',async()=>{await rpc('logout');name='';await go('login');})];
}
async function prepareSourceImage(file){
  if(!file.size||file.size>15000000)throw Error('اختر صورة حتى ١٥ ميغابايت.');
  const bitmap=await createImageBitmap(file);
  try{
    const canvas=el('canvas');
    const ctx=canvas.getContext('2d');
    for(let limit=1850;limit>=450;limit=Math.floor(limit*.75)){
      const scale=Math.min(1,limit/Math.max(bitmap.width,bitmap.height));
      canvas.width=Math.max(1,Math.round(bitmap.width*scale));
      canvas.height=Math.max(1,Math.round(bitmap.height*scale));
      ctx.fillStyle='#fff';
      ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
      const image=canvas.toDataURL('image/jpeg',.78);
      if(image.length<=550000)return image;
    }
    throw Error('تعذّر تجهيز الصورة. اختر صورة أصغر.');
  }finally{bitmap.close();}
}
function sourceForm(subject){
  const upload=field('اختيار صورة من المعرض','file','file');
  upload.className='source-picker';
  upload.querySelector('input').accept='image/jpeg,image/png,image/webp';
  const title=field('عنوان المصدر','title');
  title.querySelector('input').maxLength=180;
  let previousFile='',previousTitle='',requestId='';
  return form('',[title,upload],owner?'حفظ المصدر':'إرسال للمراجعة',async data=>{
    const title=data.title.trim();
    if(!title)throw Error('اكتب عنوان المصدر.');
    const image=await prepareSourceImage(data.file);
    if(owner){
      await rpc('addSource',{subject:subject.id,title,image});
    }else{
      if(previousFile!==image||previousTitle!==title){
        previousFile=image;previousTitle=title;
        requestId=crypto.randomUUID();
      }
      await rpc('sharedPublish',{subject:subject.name,title,image,requestId});
      message('أُرسلت الصورة إلى المالك للمراجعة.');
    }
    await go('subject',subject);
  });
}
function sharedFeed(subject){
  const list=wrap('registration-list');
  const status=el('p','','empty-state');
  const controls=wrap('row');
  let loading=false,entries=[],next=null;
  function card(entry){
    const image=el('img');
    image.alt=entry.title;
    const details=el('details');
    details.append(el('summary','عرض الصورة'));
    details.ontoggle=async()=>{
      if(!details.open||image.hasAttribute('src')||details.dataset.loading)return;
      details.dataset.loading='true';
      const notice=el('p','جارٍ تحميل الصورة…');
      details.append(notice);
      try{
        const {entry:record}=await rpc('sharedImage',{id:entry.id});
        image.src=record.image;
        details.append(image);
        notice.remove();
      }catch(err){notice.textContent=err.message;}
      finally{delete details.dataset.loading;}
    };
    if(owner&&!entry.approved)details.append(button('اعتماد الصورة',async()=>{
      if(!image.hasAttribute('src'))throw Error('افتح الصورة وراجعها قبل اعتمادها.');
      if(!confirm('هل راجعت الصورة وتأكدت من خلوها من البيانات الشخصية؟'))return;
      await rpc('onlineApproveSource',{id:entry.id});await load();
    }));
    if(owner)details.append(button('حذف المنشور',async()=>{
      if(!confirm('حذف هذا المصدر من جميع أجهزة الصف؟'))return;
      await rpc('onlineRemoveSource',{id:entry.id});
      await load();
    }));
    return wrap('card',el('strong',entry.title),el('small',entry.added_by+' · '+entry.subject+' · '+dateTime(entry.created)),details);
  }
  async function load(cursor=null,append=false){
    if(loading)return;
    loading=true;
    try{
      const data=await rpc('sharedList',{subject,before:cursor});
      if(append)entries.push(...data.entries);
      else entries=data.entries;
      next=data.next;
      list.replaceChildren(...entries.map(card));
      status.textContent=entries.length?'':'لا توجد منشورات بعد.';
      controls.replaceChildren(refresh,...(next?[more]:[]));
    }catch(err){status.textContent=err.message;}
    finally{loading=false;}
  }
  const refresh=button('تحديث المنشورات',()=>load());
  const more=button('عرض منشورات أقدم',()=>load(next,true));
  controls.append(refresh);
  const section=wrap('registration-list',controls,status,list);
  load();
  return section;
}
function sharedAll(){
  return [hero('منشورات الطلاب','كل المواد'),sharedFeed()];
}
let tab='sources';
async function subject(item){
  const s=cache.subjects.find(s=>s.id===selected.id);selected=s;
  const content=await rpc('subject',{subject:s.id});
  const controls=wrap('row',button('المصادر',()=>{tab='sources';return go('subject',s);},tab==='sources'?'primary':''),button('الاختبارات',()=>{tab='quizzes';return go('subject',s);},tab==='quizzes'?'primary':''));
  if(tab==='quizzes'){
    return [hero(s.name,'اختبارات المادة'),controls,owner&&form('مسودة سؤال اختباري',[field('عنوان الاختبار','title'),field('السؤال','question'),field('الخيارات · كل خيار بسطر','choices','textarea'),field('رقم الإجابة الصحيحة بداية من ١','answer','number')],'حفظ المسودة',async d=>{await rpc('draft',{...d,subject:s.id,choices:d.choices.split('\n').map(x=>x.trim()).filter(Boolean),answer:Number(d.answer)-1});await go('subject',s);}),
      ...content.quizzes.map(q=>wrap('card',el('small',q.published?'منشور':'بانتظار الاعتماد'),button(q.title,()=>go('quiz',q)),...(!q.published&&owner?[button('اعتماد ونشر',async()=>{await rpc('publish',{id:q.id});await go('subject',s);})]:[]))),!content.quizzes.length&&el('p','لم يُنشر اختبار لهذه المادة بعد.')];
  }
  let last='';
  const items=[];let count=0;const dayCounts={};for(const d of content.sources){const k=date(d.created);dayCounts[k]=(dayCounts[k]||0)+1;}
  for(const d of content.sources){const day=date(d.created);if(day!==last){items.push(el('h3',day));last=day;count=dayCounts[day];}items.push(button('مصدر '+number.format(count--)+' · '+d.title+(owner&&d.added_by?' · '+d.added_by:''),()=>go('source',d),'source-item'));}
  const add=button('إضافة مصدر',()=>go('newSource',s,true),'primary');
  return [hero(s.name,s.page?'وصل الصف إلى صفحة '+number.format(s.page):''),controls,el('h2','مصادر المادة','section-title'),offline&&locked?button('فتح مصادري المحفوظة',()=>go('unlock')):add,!locked&&sharedFeed(s.name),...items,owner&&form('تقدّم الصف',[field('رقم الصفحة','page','number',s.page||'')],'حفظ الصفحة',async d=>{await rpc('progress',{subject:s.id,page:Number(d.page)});await go('subject',s);})];
}
function newSource(){
  return [button('العودة إلى المصادر',()=>go('subject',selected),'back-action'),
    hero('إضافة مصدر',selected.name),sourceForm(selected)];
}
async function source(item){const record=await rpc('source',{id:item.id});const img=el('img');img.src=record.image instanceof Blob?(previewUrl=URL.createObjectURL(record.image)):record.image;img.alt='صورة المصدر';
  return [button('العودة للمادة',()=>go('subject',selected)),hero(record.title,date(record.created)+(owner&&record.added_by?' · أضافه '+record.added_by:'')),wrap('card',...(record.body?[el('pre',record.body)]:[]),img),owner&&button('حذف المصدر',async()=>{if(confirm('حذف هذا المصدر من الصف؟')){await rpc('remove',{id:item.id});await go('subject',selected);}})];}
async function quiz(item){const q=await rpc('quiz',{id:item.id}),choices=JSON.parse(q.choices),result=el('p');
  return [hero(q.title,selected.name),wrap('card',el('h3',q.question),...choices.map((v,i)=>button(v,async()=>{if(owner){message('معاينة المالك');return;}const score=await rpc('solve',{id:item.id,choice:i});result.textContent=i===score.answer?'إجابة صحيحة':'الإجابة الصحيحة · '+choices[score.answer];})),result),button('العودة للمادة',()=>go('subject',selected))];}
window.backPage=()=>{if(page==='source'||page==='quiz'||page==='newSource'){go('subject',selected);return true;}if(page==='notes'){go('settings');return true;}if(!owner&&locked)return false;if((name||offline)&&page!=='home'){go('home');return true;}return false;};
boot().catch(e=>message(e.message));
