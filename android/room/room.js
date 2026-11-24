'use strict';
const $=sel=>document.querySelector(sel);
const main=$('main'), bottomNav=$('#bottom-nav'), pending=new Map();
let serial=0,revision=0,page='login',name='',owner=false,setup=false,cache,selected,hideTimer;
let offline=false,hasAccount=false,locked=false,previewUrl=null,cloudUrl='';
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
  cloudUrl=state.cloudUrl||'';
  if(owner&&state.savedSession){
    try{name=(await rpc('resume')).name;}
    catch(err){message(err.message);}
  }else if(!owner)name=state.studentName||'';
  await go(locked&&!owner?'unlock':owner&&!name?'login':'home');
}
async function go(next,item,focusPage=false){
  activeReading?.abort();
  if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null;}
  page=next;const mine=++revision;
  if(item&&(next==='subject'||next==='newSource'))selected=item;
  navigation();
  const pages={unlock,login,home,feed,feedback,accounts,settings,notes,subject,newSource,source,quiz};
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
  return [hero('قوم دروس','حساب الطالب على هذا الهاتف'),
    !hasAccount&&el('p','تبقى كلمة السر على هاتفك. بعد ربط الصف، يظهر اسمك في لوحة المالك.','empty-state'),
    form(hasAccount?'تسجيل الدخول':'إنشاء حساب الطالب',[
      field('الاسم','name','text',name),field('كلمة السر · ٦ أحرف على الأقل','password','password')
    ],hasAccount?'دخول':'تسجيل',async data=>{
      name=(await rpc(hasAccount?'unlock':'register',data)).name;
      locked=false;hasAccount=true;
      await go('home');
    })];
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
    owner&&el('h2','المواد الدراسية','section-title'),search,grid,owner&&form('مادة جديدة',[field('اسم المادة','name')],'إضافة مادة',async d=>{await rpc('addSubject',d);await go('home');})];
}
function noticeCards(notices){
  return notices.map(n=>wrap('card',el('small',date(n.created)),el('h3',n.title),el('pre',n.body)));
}
async function refreshStudentNotices(refresh=false){
  const list=$('#student-notices');
  if(!list)return;
  const {notices,online,configured}=await rpc('studentNotices',{refresh});
  if(!list.isConnected)return;
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
    ...data.entries.map(entry=>wrap('card',el('strong',entry.name),el('small','تم التسجيل · '+dateTime(entry.created)))),
    ...(!data.entries.length?[el('p','تظهر هنا أسماء الطلاب بعد ربط الصف.','empty-state')]:[]));
}
async function refreshRegistrations(container){
  try{const data=await rpc(cloudUrl?'onlineRegistrations':'registrations');if(container.isConnected)updateRegistrationList(container,data);}
  catch(err){message(err.message);}
}
async function accounts(){
  const list=wrap('registration-list');list.id='registrations';
  return [hero('الطلاب',cloudUrl?'تسجيلات الصف':'التسجيلات المحفوظة'),list,
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
  const origin='https://lshsjej.mgedh-9ali.workers.dev';
  return [hero('الإعدادات',name||'قوم دروس'),
    owner&&form('اتصال لوحة المالك',[field('مفتاح المالك','key','password')],
      cloudUrl?'تحديث الاتصال':'ربط الصف',async(data,status)=>{
        await rpc('configureCloud',{...data,url:cloudUrl||origin});cloudUrl=cloudUrl||origin;
        status.textContent='تم ربط الصف عبر الإنترنت.';
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
    offline&&hasAccount&&!locked&&button('تسجيل الخروج',async()=>{await rpc('lock');locked=true;await go('unlock');}),
    !offline&&button('تسجيل الخروج',async()=>{await rpc('logout');name='';await go('login');})];
}
let activeReading=null;
function ocr(bytes,language,onProgress,signal){
  const worker=new Worker('ocr-worker.js');
  return new Promise((resolve,reject)=>{
    const cancel=()=>finish(Error('أُوقفت القراءة.'));
    const finish=(error,value)=>{
      clearTimeout(timer);
      signal.removeEventListener('abort',cancel);
      worker.terminate();
      if(error)reject(error);else resolve(value);
    };
    const timer=setTimeout(()=>finish(Error('انتهت مهلة القراءة. جرّب قصّ الصفحة أو اكتب النص يدويًا.')),65000);
    signal.addEventListener('abort',cancel,{once:true});
    worker.onerror=()=>finish(Error('تعذّر تشغيل قارئ الصور.'));
    worker.onmessage=({data})=>{
      if(data.type==='progress'){onProgress(data);return;}
      finish(data.error?Error('تعذّرت قراءة الصورة. جرّب قصّها أو اكتب النص يدويًا.'):null,data);
    };
    worker.postMessage({bytes,language},[bytes]);
  });
}
async function prepareSourceImage(file,crop,rotation,signal){
  const image=await createImageBitmap(file);
  try{
    if(signal.aborted)throw Error('أُوقفت القراءة.');
    const width=crop==='whole'?image.width:Math.ceil(image.width/2);
    const left=crop==='right'?image.width-width:0;
    const scale=Math.min(1,1850/Math.max(width,image.height),Math.sqrt(2300000/(width*image.height)));
    const canvas=el('canvas');
    const scaledWidth=Math.max(1,Math.round(width*scale));
    const scaledHeight=Math.max(1,Math.round(image.height*scale));
    const sideways=rotation===90||rotation===270;
    canvas.width=sideways?scaledHeight:scaledWidth;
    canvas.height=sideways?scaledWidth:scaledHeight;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.save();
    ctx.translate(canvas.width/2,canvas.height/2);
    ctx.rotate(rotation*Math.PI/180);
    ctx.drawImage(image,left,0,width,image.height,-scaledWidth/2,-scaledHeight/2,scaledWidth,scaledHeight);
    ctx.restore();
    let original=canvas.toDataURL('image/jpeg',.72);
    if(original.length>550000)original=canvas.toDataURL('image/jpeg',.42);
    if(original.length>550000)throw Error('قص الصورة حول النص أو اختر صورة أصغر.');
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
    const histogram=new Uint32Array(256);
    const data=pixels.data;
    for(let i=0;i<data.length;i+=4){
      const level=(77*data[i]+150*data[i+1]+29*data[i+2])>>8;
      histogram[level]++;data[i]=level;
    }
    const count=data.length/4;
    let low=0,high=255,seen=0;
    while(low<254&&seen+histogram[low]<count*.035)seen+=histogram[low++];
    seen=0;
    while(high>1&&seen+histogram[high]<count*.96)seen+=histogram[high--];
    const spread=Math.max(48,high-low);
    for(let i=0;i<data.length;i+=4)data[i]=data[i+1]=data[i+2]=255*(data[i]-low)/spread;
    ctx.putImageData(pixels,0,0);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.9));
    if(!blob)throw Error('تعذّر تجهيز الصورة.');
    return {original,bytes:await blob.arrayBuffer()};
  }finally{image.close();}
}
function sourceForm(subject){
  const upload=field('اختيار صورة من المعرض','file','file');
  upload.className='source-picker';
  const picker=upload.querySelector('input');
  picker.accept='image/jpeg,image/png,image/webp';
  const fileLabel=el('small','JPG · PNG · WEBP');
  upload.append(fileLabel);
  picker.onchange=()=>{fileLabel.textContent=picker.files[0]?.name||'JPG · PNG · WEBP';};
  const select=(label,key,options,initial)=>{
    const row=el('label',label,'field'), input=el('select');
    input.name=key;
    for(const [value,text] of options){const option=el('option',text);option.value=value;input.append(option);}
    input.value=initial;row.append(input);return row;
  };
  const language=select('لغة الصورة','language',[['ara','العربية'],['eng','الإنجليزية'],['ara+eng','عربية وإنجليزية']],subject.name.includes('الإنجليزي')?'eng':'ara');
  const crop=select('الجزء المطلوب','crop',[['whole','الصورة كاملة'],['right','الصفحة اليمنى'],['left','الصفحة اليسرى']],'whole');
  const progress=el('progress');progress.max=100;progress.value=0;progress.hidden=true;
  progress.setAttribute('aria-label','تقدّم قراءة الصورة');
  const preview=wrap('registration-list');
  const cancel=button('إيقاف القراءة',()=>activeReading?.abort());cancel.hidden=true;
  const options=el('details','','source-options');
  const rotation=select('اتجاه الصورة','rotation',[
    ['0','كما هي'],['90','تدوير يمينًا'],['270','تدوير يسارًا'],['180','قلب الصورة'],
  ],'0');
  options.append(el('summary','خيارات القراءة'),language,crop,rotation);
  const manual=el('button','كتابة النص يدويًا','back-action');manual.type='submit';
  const scan=form('',[upload,options,progress,cancel],'قراءة الصورة',async(data,status,submitter)=>{
    if(!data.file.size||data.file.size>15000000)throw Error('اختر صورة حتى ١٥ ميغابايت.');
    const controller=new AbortController();
    activeReading=controller;manual.disabled=true;preview.replaceChildren();
    progress.hidden=false;progress.value=0;cancel.hidden=false;
    const show=(percent,label)=>{
      progress.value=Math.max(percent,progress.value);
      status.textContent=label+' · '+number.format(progress.value)+'٪';
    };
    try{
      show(5,'جارٍ تجهيز الصورة');
      const {original,bytes}=await prepareSourceImage(data.file,data.crop,Number(data.rotation),controller.signal);
      if(controller.signal.aborted)return;
      let result={text:'',confidence:0},failure='';
      if(submitter!==manual)try{
        let retry=false;
        result=await ocr(bytes,data.language,event=>{
          if(event.stage==='retry')retry=true;
          if(event.stage==='recognize'){
            const percent=Math.round(Math.max(0,Math.min(100,Number(event.percent)||0)));
            show(retry?90+Math.round(percent*.08):25+Math.round(percent*.62),retry?'جارٍ إعادة فحص السطور':'جارٍ قراءة السطور');
          }else{
            const stage={engine:[10,'جارٍ تشغيل القارئ'],models:[17,'جارٍ تحميل نموذج اللغة'],retry:[90,'جارٍ إعادة فحص السطور'],finish:[98,'جارٍ تجهيز المعاينة']}[event.stage];
            if(stage)show(...stage);
          }
        },controller.signal);
      }catch(error){if(controller.signal.aborted)return;failure=error.message;}
      if(controller.signal.aborted||!preview.isConnected)return;
      const text=result.text.slice(0,16000);
      const latin=(text.match(/[A-Za-z]/g)||[]).length;
      const arabic=(text.match(/[\u0621-\u064a]/g)||[]).length;
      const needsReview=result.confidence<70||text.length<8||(data.language==='ara'&&latin>Math.max(3,arabic*.1));
      const titleField=field('عنوان المصدر','title','text',text.split('\n').find(line=>line.trim())?.trim().slice(0,180)||'');
      titleField.querySelector('input').maxLength=180;
      const bodyField=field('النص المقروء','body','textarea',text);
      bodyField.querySelector('textarea').maxLength=16000;
      bodyField.querySelector('textarea').rows=8;
      const image=el('img');image.src=original;image.alt='صورة المصدر للمقارنة مع النص';
      const save=form('معاينة وتعديل النص',[titleField,bodyField,image],offline?'حفظ المصدر':'نشر المصدر',async values=>{
        const title=values.title.trim(),body=values.body.trim();
        if(!title||!body)throw Error('اكتب عنوان المصدر والنص أولًا.');
        await rpc('addSource',{subject:subject.id,title,body,image:original});
        await go('subject',subject);
      });
      preview.append(save);
      preview.scrollIntoView({block:'start'});
      if(submitter===manual){progress.hidden=true;status.textContent='';}
      else if(failure){progress.hidden=true;status.textContent=failure;}
      else show(100,needsReview?'النص يحتاج مراجعة قبل الحفظ':'اكتملت القراءة. راجع النص قبل الحفظ');
    }finally{
      cancel.hidden=true;manual.disabled=false;
      if(controller.signal.aborted){progress.hidden=true;status.textContent='أُوقفت القراءة.';}
      if(activeReading===controller)activeReading=null;
    }
  });
  scan.classList.add('source-scan');scan.append(manual);
  return wrap('registration-list',scan,preview);
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
  return [hero(s.name,s.page?'وصل الصف إلى صفحة '+number.format(s.page):''),controls,el('h2','مصادر المادة','section-title'),offline&&locked?button('فتح مصادري المحفوظة',()=>go('unlock')):add,...items,!items.length&&el('p',offline&&locked?'سجّل الدخول لعرض مصادرك.':'لا توجد مصادر لهذه المادة بعد.','empty-state'),owner&&form('تقدّم الصف',[field('رقم الصفحة','page','number',s.page||'')],'حفظ الصفحة',async d=>{await rpc('progress',{subject:s.id,page:Number(d.page)});await go('subject',s);})];
}
function newSource(){
  return [button('العودة إلى المصادر',()=>go('subject',selected),'back-action'),
    hero('إضافة مصدر',selected.name),sourceForm(selected)];
}
async function source(item){const record=await rpc('source',{id:item.id});const img=el('img');img.src=record.image instanceof Blob?(previewUrl=URL.createObjectURL(record.image)):record.image;img.alt='صورة المصدر';
  return [button('العودة للمادة',()=>go('subject',selected)),hero(record.title,date(record.created)+(owner&&record.added_by?' · أضافه '+record.added_by:'')),wrap('card',el('pre',record.body),img),owner&&button('حذف المصدر',async()=>{if(confirm('حذف هذا المصدر من الصف؟')){await rpc('remove',{id:item.id});await go('subject',selected);}})];}
async function quiz(item){const q=await rpc('quiz',{id:item.id}),choices=JSON.parse(q.choices),result=el('p');
  return [hero(q.title,selected.name),wrap('card',el('h3',q.question),...choices.map((v,i)=>button(v,async()=>{if(owner){message('معاينة المالك');return;}const score=await rpc('solve',{id:item.id,choice:i});result.textContent=i===score.answer?'إجابة صحيحة':'الإجابة الصحيحة · '+choices[score.answer];})),result),button('العودة للمادة',()=>go('subject',selected))];}
window.backPage=()=>{if(page==='source'||page==='quiz'||page==='newSource'){go('subject',selected);return true;}if(page==='notes'){go('settings');return true;}if(!owner&&locked)return false;if((name||offline)&&page!=='home'){go('home');return true;}return false;};
boot().catch(e=>message(e.message));
