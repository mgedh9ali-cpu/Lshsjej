'use strict';
const $=sel=>document.querySelector(sel);
const main=$('main'), bottomNav=$('#bottom-nav'), pending=new Map();
let serial=0,revision=0,page='login',name='',owner=false,setup=false,cache,selected,hideTimer;
let offline=false,hasAccount=false,locked=false,previewUrl=null,cloudUrl='',studentEmail='';
function rpc(op,data={},progress){
  if(offline && ['home','subject','source','addSource'].includes(op))return offlineData(op,data);
  const id=++serial;
  return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject,progress});Classroom.request(id,JSON.stringify({...data,op}));});
}
window.uploadProgress=(id,bytes,total)=>pending.get(id)?.progress?.(bytes,total);
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
      entry.append(navIcon(key),el('span',key==='home'&&owner?'الصف':label,'bottom-tab-label'));
      return entry;
    }));
  }
  const active=['subject','source','quiz','newSource','sharedAll','reports'].includes(page)?'home':page;
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
  cloudUrl=state.cloudUrl||'';studentEmail=state.studentEmail||'';
  if(owner&&state.savedSession){
    try{name=(await rpc('resume')).name;}
    catch(err){message(err.message);}
  }else if(!owner)name=state.studentName||'';
  await go(locked&&!owner?'unlock':owner&&!name?'login':'home');
}
let sourceImageObserver;
async function go(next,item,focusPage=false){
  sourceImageObserver?.disconnect();
  sourceImageObserver=undefined;
  if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null;}
  page=next;const mine=++revision;
  if(item&&(next==='subject'||next==='newSource'))selected=item;
  navigation();
  const pages={unlock,login,home,feed,feedback,accounts,settings,subject,newSource,source,quiz,sharedAll,reports};
  try{
    if((name||offline)&&['home','feed','feedback','accounts','subject'].includes(next))cache=await rpc('home');
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
  const email=field('البريد الإلكتروني','email','email',studentEmail);
  email.querySelector('input').dir='ltr';
  email.querySelector('input').autocomplete='username';
  const password=field('كلمة السر','password','password');
  password.querySelector('input').autocomplete=hasAccount?'current-password':'new-password';
  return [hero('قوم دروس','حساب الطالب على هذا الهاتف'),
    form(hasAccount?'تسجيل الدخول':'إنشاء حساب الطالب',[
      ...(!hasAccount?[field('الاسم','name')]:[]),email,password
    ],hasAccount?'دخول':'إنشاء الحساب',async data=>{
      name=(await rpc(hasAccount?'unlock':'register',data)).name;
      studentEmail=data.email.trim().toLowerCase();
      locked=false;hasAccount=true;
      await go('home');
    })];
}
const symbols=['ϟ','⚗','✿','Aa','∑'];
const number=new Intl.NumberFormat('ar-SY');
async function home(){
  const subjects=[...cache.subjects],grid=wrap('grid');
  if(!owner&&!locked){
    try{
      const catalog=await rpc('sharedSubjects');
      for(const {name:subjectName} of catalog.subjects){
        if(!subjects.some(subject=>subject.name===subjectName))subjects.push({id:subjects.length+1,name:subjectName,sharedOnly:true});
      }
    }catch(err){message(err.message);}
  }
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
    owner&&wrap('row',button('منشورات الطلاب',()=>go('sharedAll'),'primary'),button('تقارير الصف',()=>go('reports'))),owner&&el('h2','المواد الدراسية','section-title'),search,grid,owner&&form('مادة جديدة',[field('اسم المادة','name')],'إضافة مادة',async d=>{await rpc('onlineAddSubject',d);await rpc('addSubject',d);await go('home');})];
}
let noticeFilter='all';
function wasRead(key){return localStorage.getItem(key)==='yes';}
function markRead(key){localStorage.setItem(key,'yes');}
function noticeCards(notices,track=false){
  return notices.map(n=>{
    const key='qum-notice:'+n.id;
    const read=track&&wasRead(key);
    const card=wrap('card inbox-card',el('small',date(n.created)),el('h3',n.title),el('pre',n.body));
    if(track){
      card.dataset.unread=String(!read);
      card.append(read?el('small','مقروءة'):button('تحديد كمقروءة',()=>{
        markRead(key);return refreshStudentNotices();
      }));
    }
    return card;
  });
}
async function refreshStudentNotices(refresh=false){
  const list=$('#student-notices');
  if(!list)return;
  const {notices,online,configured}=await rpc('studentNotices',{refresh});
  if(!list.isConnected)return;
  const shown=noticeFilter==='unread'?notices.filter(n=>!wasRead('qum-notice:'+n.id)):notices;
  const status=online?(shown.length?'':noticeFilter==='unread'?'لا توجد إشعارات غير مقروءة.':'لا توجد إشعارات بعد.')
    :notices.length?'تعذّر الوصول إلى لوحة المالك. هذه الإشعارات المحفوظة على الهاتف.'
    :configured?'بانتظار الاتصال بخادم الصف. تظهر التحديثات عند عودة الإنترنت.':'اربط الصف عبر الإنترنت من الإعدادات لاستقبال الإشعارات.';
  list.replaceChildren(...(status?[el('p',status,'empty-state')]:[]),...noticeCards(shown,true));
}
window.noticesUpdated=()=>refreshStudentNotices().catch(()=>{});
async function feed(){
  const heading=hero('الإشعارات','أخبار الصف وتذكيراته');
  if(!owner){
    const list=wrap('registration-list');list.id='student-notices';list.setAttribute('aria-live','polite');
    const filters=segments('فرز الإشعارات',[['all','الكل'],['unread','غير المقروءة']],noticeFilter,value=>{
      noticeFilter=value;return refreshStudentNotices();
    });
    return [heading,wrap('row',filters,button('تحديث',()=>refreshStudentNotices(true))),list];
  }
  const notices=cloudUrl?(await rpc('onlineNotices')).notices:cache.notices;
  return [heading,!cloudUrl&&connectionPrompt(),cloudUrl&&form('إشعار عام',[field('العنوان','title'),field('نص الإشعار','body','textarea')],'نشر للطلاب',async data=>{
    await rpc('onlinePublish',data);message('تم نشر الإشعار في الصف.');await go('feed');
  }),...noticeCards(notices),!notices.length&&el('p','ستظهر أخبار الصف هنا عند نشرها.'),button('تحديث',()=>go('feed'))];
}
const date=v=>new Intl.DateTimeFormat('ar-SY',{weekday:'long',month:'long',day:'numeric',year:'numeric'}).format(v);
let ownerFeedbackFilter='all', studentFeedbackFilter='all';
function feedbackCard(entry){
  const heading=(owner?entry.name+' · ':'')+date(entry.created);
  const card=wrap('card inbox-card',el('small',heading),el('pre',entry.body),el('strong',entry.reply?'تم الرد':'بانتظار الرد'));
  if(owner){
    const key='qum-owner-suggestion:'+entry.id;
    const read=wasRead(key);
    card.dataset.unread=String(!read);
    card.append(read?el('small','مقروء'):button('تحديد كمقروء',()=>{
      markRead(key);
      if(ownerFeedbackFilter==='unread')card.remove();
      else{
        card.dataset.unread='false';
        const mark=card.querySelector('button');
        if(mark)mark.replaceWith(el('small','مقروء'));
      }
    }));
  }
  if(entry.reply){
    const key='qum-reply:'+entry.id;
    const read=localStorage.getItem(key)===entry.reply;
    const reply=wrap('reply',el('small','رد المالك'),el('pre',entry.reply));
    card.append(reply);
    if(!owner){
      card.dataset.unread=String(!read);
      card.append(read?el('small','مقروء'):button('تحديد الرد كمقروء',()=>{
        localStorage.setItem(key,entry.reply);return refreshStudentFeedback();
      }));
    }
  }
  return card;
}
function showStudentFeedback(list,result){
  const entries=result.entries.filter(entry=>studentFeedbackFilter==='all'||(entry.reply&&localStorage.getItem('qum-reply:'+entry.id)!==entry.reply)).map(feedbackCard);
  const pending=result.pending.map(item=>wrap('card',el('small',date(item.created)),
    el('pre',item.body),el('strong','بانتظار الإرسال')));
  const state=!result.configured?'اربط الصف عبر الإنترنت لإرسال الاقتراحات.'
    :pending.length||entries.length?'':studentFeedbackFilter==='unread'?'لا توجد ردود غير مقروءة.':'لم ترسل اقتراحات بعد.';
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
    const visible=entries.filter(entry=>ownerFeedbackFilter==='all'||(ownerFeedbackFilter==='unread'? !wasRead('qum-owner-suggestion:'+entry.id):Boolean(entry.reply)===(ownerFeedbackFilter==='done')));
    const filters=segments('فرز الاقتراحات',[['all','الكل'],['unread','غير المقروءة'],['waiting','بانتظار الرد'],['done','تم الرد']],ownerFeedbackFilter,value=>{
      ownerFeedbackFilter=value;return go('feedback');
    });
    return [hero('الاقتراحات','رسائل الطلاب'),filters,!cloudUrl&&connectionPrompt(),
      ...visible.map(entry=>{
        const card=feedbackCard(entry);
        if(cloudUrl){
          const editor=el('details');
          editor.append(el('summary',entry.reply?'تعديل الرد':'الرد على الطالب'),form('',[field('نص الرد','body','textarea',entry.reply||'')],'إرسال الرد',async data=>{
            const receipt=await rpc('onlineReply',{body:data.body,id:entry.id});
            if(receipt.id!==entry.id||receipt.reply!==data.body.trim())throw Error('تعذّر تأكيد حفظ الرد.');
            markRead('qum-owner-suggestion:'+entry.id);
            message('حُفظ الرد على الخادم وسيظهر عند مزامنة الطالب.');
            await go('feedback');
          }));
          card.append(editor);
        }
        return card;
      }),
      !visible.length&&el('p','لا توجد اقتراحات في هذا العرض.','empty-state'),button('تحديث',()=>go('feedback'))];
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
  const filters=segments('فرز الردود',[['all','الكل'],['unread','ردود غير مقروءة']],studentFeedbackFilter,value=>{
    studentFeedbackFilter=value;return refreshStudentFeedback();
  });
  return [hero('الاقتراحات','رسائلي وردود المالك'),composer,wrap('row',filters,button('تحديث',()=>refreshStudentFeedback(true))),list];
}
const dateTime=v=>new Intl.DateTimeFormat('ar-SY',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}).format(v);
function updateRegistrationList(container, data){
  container.replaceChildren(el('small',number.format(data.total)+' تسجيل'),
    ...data.entries.map(entry=>wrap('card',el('strong',entry.name),el('small','تم التسجيل · '+dateTime(entry.created)))),
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
  const code=el('input');code.readOnly=true;code.dir='ltr';code.setAttribute('aria-label','رمز الدعوة');
  const result=wrap('card',el('strong','رمز الدعوة · صالح ٢٤ ساعة'),code);result.hidden=true;
  const invitation=form('دعوة طالب',[field('اسم الطالب','name'),field('بريد الطالب','email','email')],
    'إنشاء دعوة',async(data,status)=>{
      const issued=await rpc('onlineCreateInvite',data);
      code.value=issued.invite;result.hidden=false;code.focus();code.select();status.textContent='انسخ الرمز وأرسله إلى الطالب.';
    });
  return [hero('الطلاب',cloudUrl?'تسجيلات الصف':'التسجيلات المحفوظة'),invitation,result,list,
    cache.students.length>0&&el('h2','حسابات الصف السابقة'),
    ...cache.students.map(entry=>wrap('card',el('strong',entry.name),
      el('small',entry.last_seen?'آخر نشاط: '+dateTime(entry.last_seen):'لم يسجّل الدخول بعد'),
      el('p','مصادر أضافها: '+entry.sources+' · اختبارات أجاب عنها: '+entry.quizzes+' · اقتراحات: '+entry.suggestions)))];
}
function connectionPrompt(){
  return button('ربط الصف عبر الإنترنت',()=>go('settings'));
}
function applyTheme(theme){
  document.documentElement.dataset.theme=theme;
}
applyTheme(localStorage.getItem('qum-theme')||'system');
function segments(label,choices,active,change){
  const group=wrap('segments');
  group.setAttribute('role','group');group.setAttribute('aria-label',label);
  for(const [key,title] of choices){
    const action=button(title,async()=>{
      await change(key);
      for(const item of group.children)item.setAttribute('aria-pressed',String(item.dataset.value===key));
    });
    action.dataset.value=key;action.setAttribute('aria-pressed',String(key===active));group.append(action);
  }
  return group;
}
function confirmAction(title,description,action='حذف'){
  return new Promise(resolve=>{
    const dialog=el('dialog','','app-dialog');
    let accepted=false;
    dialog.setAttribute('aria-label',title);
    const done=value=>{accepted=value;dialog.close();};
    dialog.append(el('h2',title),el('p',description),wrap('row',
      button('إلغاء',()=>done(false)),button(action,()=>done(true),'danger')));
    dialog.addEventListener('close',()=>{dialog.remove();resolve(accepted);},{once:true});
    document.body.append(dialog);dialog.showModal();
  });
}
function settings(){
  const theme=segments('المظهر',[['system','حسب الجهاز'],['light','فاتح'],['dark','داكن']],localStorage.getItem('qum-theme')||'system',value=>{
    localStorage.setItem('qum-theme',value);applyTheme(value);
  });
  const appearance=wrap('card',el('h2','المظهر'),theme);
  const account=wrap('card',el('h2','الحساب'),el('strong',name));
  if(!owner){
    if(studentEmail)account.append(el('small',studentEmail),form('ربط الجهاز بالصف',[field('رمز الدعوة من المالك','invite')],
      'تفعيل الدعوة',async(data,status)=>{
        await rpc('redeemStudentInvite',data);status.textContent='رُبط الجهاز بالصف.';
      }));
    else account.append(form('إضافة بريد للحساب المحلي',[field('البريد الإلكتروني','email','email'),field('كلمة السر الحالية','password','password')],'حفظ البريد',async data=>{
      await rpc('unlock',data);studentEmail=data.email.trim().toLowerCase();await go('settings');
    }));
  }
  account.append(button('تسجيل الخروج',async()=>{
    if(!await confirmAction('تسجيل الخروج','ستبقى بيانات الحساب على الهاتف.','تسجيل الخروج'))return;
    await rpc(owner?'logout':'studentLogout');name='';locked=!owner;await go(owner?'login':'unlock');
  }));
  const connection=owner?wrap('card',el('h2','اتصال لوحة المالك')):wrap('card',el('h2','تنبيهات الجهاز'));
  const status=el('p','جارٍ الفحص…');
  connection.append(status);
  if(owner){
    const refresh=async()=>{
      status.textContent='جارٍ فحص الاتصال…';
      try{await rpc('onlineStatus');status.textContent='متصل بالصف عبر الإنترنت.';}
      catch(error){status.textContent=error.message;}
    };
    connection.append(button('فحص الاتصال',refresh),form('اعتماد هاتف المالك',[field('رمز الاعتماد من لوحة الويب','invite')],
      'ربط الهاتف',async(data,feedback)=>{
        await rpc('redeemOwnerInvite',data);await refresh();feedback.textContent='اعتُمد الهاتف.';
      }));refresh();
  }else{
    const checked=async()=>{
      try{
        const result=await rpc('studentAlertSettings');
        status.textContent=result.enabled?(result.allowed?'التنبيهات مفعلة أثناء مزامنة التطبيق.':'اسمح بالإشعارات من إعدادات أندرويد.'):'تنبيهات الجهاز متوقفة.';
        toggle.textContent=result.enabled&&result.allowed?'إيقاف التنبيهات':'تفعيل التنبيهات';
        toggle.dataset.active=String(result.enabled&&result.allowed);
      }catch(err){status.textContent=err.message;}
    };
    const toggle=button('تفعيل التنبيهات',async()=>{
      await rpc('studentAlertSettings',{enabled:toggle.dataset.active!=='true'});
      await checked();
    });
    connection.append(toggle);checked();
    window.studentPermissionChanged=()=>{if(connection.isConnected)checked();};
  }
  return [hero('الإعدادات',''),appearance,connection,account];
}
async function reports(){
  if(!owner)return [];
  const {totals,subjects}=await rpc('onlineReport');
  const counts=wrap('grid',...[
    ['الطلاب',totals.students],['المصادر',totals.sources],['الإشعارات المنشورة',totals.notices],['اقتراحات بانتظار الرد',totals.pending]
  ].map(([label,count])=>wrap('card',el('small',label),el('strong',number.format(count)))));
  return [hero('تقارير الصف',''),counts,
    wrap('card',el('h2','المصادر حسب المادة'),...(subjects.length?subjects.map(({subject,total})=>
      wrap('row',el('span',subject),el('strong',number.format(total)))):[el('p','لا توجد مصادر منشورة بعد.','empty-state')]))];
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
function fileBase64(file){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result.split(',')[1]);
    reader.onerror=()=>reject(Error('تعذّرت قراءة الملف.'));
    reader.readAsDataURL(file);
  });
}
function sourceForm(subject){
  const upload=field('اختيار صورة أو ملف','file','file');
  upload.className='source-picker';
  const title=field('عنوان المصدر','title');
  title.querySelector('input').maxLength=180;
  let previousPayload='',requestId='';
  const progress=el('progress');
  progress.max=100;progress.hidden=true;progress.setAttribute('aria-label','رفع المصدر');
  return form('',[title,upload,progress],'نشر في '+subject.name,async (data,status)=>{
    const title=data.title.trim(), selectedFile=data.file;
    if(!title)throw Error('اكتب عنوان المصدر.');
    if(!selectedFile.size)throw Error('اختر صورة أو ملفًا.');
    progress.hidden=true;
    status.textContent='جارٍ تجهيز الملف…';
    let attachment;
    if(['image/jpeg','image/png','image/webp'].includes(selectedFile.type)){
      attachment={image:await prepareSourceImage(selectedFile)};
    }else{
      if(selectedFile.size>1048576)throw Error('حجم الملف يجب ألا يتجاوز ١ ميغابايت.');
      attachment={file:{name:selectedFile.name,base64:await fileBase64(selectedFile)}};
    }
    const payload=JSON.stringify({title,...attachment});
    if(previousPayload!==payload){previousPayload=payload;requestId=crypto.randomUUID();}
    progress.value=0;progress.hidden=false;
    status.textContent='بدأ رفع الملف…';
    try{
      await rpc('sharedPublish',{subject:subject.name,title,...attachment,requestId},(bytes,total)=>{
        progress.value=Math.floor(100*bytes/total);
        status.textContent=bytes===total?'اكتمل رفع الملف، بانتظار تأكيد النشر…':'جارٍ رفع الملف · '+number.format(progress.value)+'٪';
      });
    }catch(error){progress.hidden=true;throw error;}
    message(owner?'نُشر المصدر في '+subject.name+'.':'أُرسل المصدر إلى المالك للمراجعة.');
    await go('subject',subject);
  });
}
function sharedFeed(subject){
  const list=wrap('registration-list');
  const status=el('p','','empty-state');
  const controls=wrap('row');
  let loading=false,entries=[],next=null;
  const observer=new IntersectionObserver(visible=>{
    for(const entry of visible){
      if(!entry.isIntersecting)continue;
      observer.unobserve(entry.target);
      entry.target.loadSourceImage();
    }
  },{rootMargin:'100px'});
  sourceImageObserver=observer;
  function card(entry){
    const image=el('img');
    image.alt=entry.title;
    image.decoding='async';
    const photo=wrap('source-photo');
    const status=el('p','جارٍ تحميل الصورة…','empty-state');
    photo.append(status);
    photo.loadSourceImage=async()=>{
      photo.replaceChildren(status);
      try{
        const {entry:record}=await rpc('sharedImage',{id:entry.id});
        image.src=record.image;
        photo.replaceChildren(image);
      }catch(err){
        photo.replaceChildren(el('p',err.message,'empty-state'),button('إعادة تحميل الصورة',photo.loadSourceImage));
      }
    };
    if(!entry.attachment)observer.observe(photo);
    const metadata=[entry.added_by,subject?null:entry.subject,dateTime(entry.created)].filter(Boolean).join(' · ');
    const post=wrap('card',el('strong',entry.title),el('small',metadata));
    if(!entry.attachment)post.append(photo);
    post.append(button('تنزيل المصدر',()=>rpc('sharedDownload',{id:entry.id})));
    if(owner&&!entry.approved)post.append(button('اعتماد المصدر',async()=>{
      if(!await confirmAction('اعتماد المصدر','راجع المصدر وتأكد من خلوّه من البيانات الشخصية.','اعتماد'))return;
      await rpc('onlineApproveSource',{id:entry.id});await load();
    }));
    if(owner||entry.mine)post.append(button('حذف المنشور',async()=>{
        if(!await confirmAction('حذف المنشور','سيختفي هذا المصدر من صفحة المادة لدى جميع الطلاب.'))return;
        await rpc('sharedRemove',{id:entry.id});
        await load();
      }));
    return post;
  }
  async function load(cursor=null,append=false){
    if(loading)return;
    loading=true;
    try{
      const data=await rpc('sharedList',{subject,before:cursor,files:true});
      if(!section.isConnected)return;
      if(append){
        entries.push(...data.entries);
        list.append(...data.entries.map(card));
      }else{
        observer.disconnect();
        entries=data.entries;
        list.replaceChildren(...entries.map(card));
      }
      next=data.next;
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
function studyPanel(subject){
  const list=wrap('registration-list');
  const status=el('p','جارٍ تحميل المحتوى…','empty-state');
  const children=[status,list];
  async function refresh(){
    try{
      const {entries}=await rpc('sharedStudy',{subject:subject.name});
      status.textContent=entries.length?'':'لا توجد اختبارات أو ملخصات بعد.';
      list.replaceChildren(...entries.map(entry=>{
        const post=wrap('card',el('h3',entry.title));
        if(entry.kind==='summary')post.append(el('pre',entry.body));
        if(entry.kind==='link')post.append(button('فتح رابط الاختبار',()=>rpc('openStudyLink',{url:entry.body})));
        if(entry.kind==='quiz'){
          const result=el('p');
          const choices=entry.body.choices.map((choice,index)=>button(choice,()=>grade(index)));
          const options=wrap('row',...choices);
          let submitting=false;
          const grade=async index=>{
            if(submitting)return;
            submitting=true;
            try{
              const score=await rpc('sharedSolve',{id:entry.id,choice:index});
              result.textContent=score.correct?'إجابة صحيحة':'الإجابة الصحيحة · '+entry.body.choices[score.answer];
              options.hidden=true;
            }catch(error){submitting=false;throw error;}
          };
          if(owner)choices.forEach(choice=>{choice.disabled=true;});
          post.append(el('p',entry.body.question),options,result);
        }
        return post;
      }));
    }catch(err){status.textContent=err.message;}
  }
  if(owner){
    const title=()=>field('العنوان','title');
    const send=kind=>async(data,status)=>{
      const extra=kind==='quiz'?{choices:data.choices.split('\n').map(v=>v.trim()).filter(Boolean),answer:Number(data.answer)-1}:{};
      await rpc('onlineAddLesson',{...data,...extra,kind,subject:subject.name});
      status.textContent='تم النشر.';
      await refresh();
    };
    const editor=el('details');
    editor.append(el('summary','إضافة اختبار أو ملخص'),
      form('ملخص',[title(),field('نص الملخص','body','textarea')],'نشر الملخص',send('summary')),
      form('رابط اختبار',[title(),field('رابط HTTPS','body','url')],'نشر الرابط',send('link')),
      form('اختبار داخل التطبيق',[title(),field('السؤال','question'),field('الخيارات · كل خيار بسطر','choices','textarea'),field('رقم الإجابة الصحيحة بداية من ١','answer','number')],'نشر الاختبار',send('quiz')));
    children.unshift(editor);
  }
  refresh();
  return wrap('registration-list',...children);
}
let tab='sources';
async function subject(item){
  const s=selected.sharedOnly?selected:cache.subjects.find(s=>s.id===selected.id);selected=s;
  const content=s.sharedOnly?{sources:[],quizzes:[]}:await rpc('subject',{subject:s.id});
  const controls=wrap('row',button('المصادر',()=>{tab='sources';return go('subject',s);},tab==='sources'?'primary':''),button('الاختبارات والملخصات',()=>{tab='quizzes';return go('subject',s);},tab==='quizzes'?'primary':''));
  if(tab==='quizzes'){
    return [hero(s.name,''),controls,studyPanel(s),
      ...content.quizzes.map(q=>wrap('card',el('small',q.published?'منشور':'بانتظار الاعتماد'),button(q.title,()=>go('quiz',q)),...(!q.published&&owner?[button('اعتماد ونشر',async()=>{await rpc('publish',{id:q.id});await go('subject',s);})]:[])))];
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
  return [button('العودة للمادة',()=>go('subject',selected)),hero(record.title,date(record.created)+(owner&&record.added_by?' · أضافه '+record.added_by:'')),wrap('card',...(record.body?[el('pre',record.body)]:[]),img),owner&&button('حذف المصدر',async()=>{if(await confirmAction('حذف المصدر','سيُحذف هذا المصدر من الصف.')){await rpc('remove',{id:item.id});await go('subject',selected);}})];}
async function quiz(item){const q=await rpc('quiz',{id:item.id}),choices=JSON.parse(q.choices),result=el('p');
  return [hero(q.title,selected.name),wrap('card',el('h3',q.question),...choices.map((v,i)=>button(v,async()=>{if(owner){message('معاينة المالك');return;}const score=await rpc('solve',{id:item.id,choice:i});result.textContent=i===score.answer?'إجابة صحيحة':'الإجابة الصحيحة · '+choices[score.answer];})),result),button('العودة للمادة',()=>go('subject',selected))];}
window.backPage=()=>{if(page==='source'||page==='quiz'||page==='newSource'){go('subject',selected);return true;}if(!owner&&locked)return false;if((name||offline)&&page!=='home'){go('home');return true;}return false;};
boot().catch(e=>message(e.message));
