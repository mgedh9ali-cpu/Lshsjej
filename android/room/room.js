'use strict';
const $=sel=>document.querySelector(sel);
const main=$('main'), drawer=$('aside'), pending=new Map();
let serial=0,revision=0,page='login',name='',owner=false,paired=false,setup=false,cache,selected,hideTimer;
function rpc(op,data={}){
  const id=++serial;
  return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});Classroom.request(id,JSON.stringify({...data,op}));});
}
window.complete=(id,raw)=>{
  const call=pending.get(id);if(!call)return;pending.delete(id);
  const result=JSON.parse(raw);
  if(result.error)call.reject(Error(result.error));else call.resolve(result.value);
};
function message(value){$('#message').hidden=false;$('#message').textContent=value;clearTimeout(hideTimer);hideTimer=setTimeout(()=>$('#message').hidden=true,6500);}
function el(tag,text='',cls=''){const n=document.createElement(tag);n.className=cls;n.textContent=text;return n;}
function wrap(cls,...items){const n=el('div','',cls);n.append(...items);return n;}
function button(label,action,cls=''){
  const b=el('button',label,cls);b.type='button';
  b.onclick=async()=>{b.disabled=true;try{await action();}catch(err){message(err.message);}finally{b.disabled=false;}};return b;
}
function hero(title,subtitle){return wrap('hero',el('small',subtitle),el('h1',title));}
function tile(title,detail,symbol,fn){const b=button('',fn,'tile');b.append(el('i',symbol),el('strong',title),el('small',detail));return b;}
function field(label,key,type='text',value=''){
  const l=el('label',label,'field'),n=el(type==='textarea'?'textarea':'input');
  if(type!=='textarea')n.type=type;else n.rows=3;
  n.name=key;n.value=value;n.required=true;l.append(n);return l;
}
function form(title,fields,label,fn){
  const f=el('form'),status=el('p');status.setAttribute('role','status');
  const submit=el('button',label,'primary');submit.type='submit';
  f.append(el('h3',title),...fields,submit,status);
  f.onsubmit=async e=>{e.preventDefault();submit.disabled=true;status.textContent='جارٍ التنفيذ…';
    try{await fn(Object.fromEntries(new FormData(f)),status);if(status.textContent==='جارٍ التنفيذ…')status.textContent='';}
    catch(err){status.textContent=err.message;}finally{submit.disabled=false;}};
  return f;
}
const links=()=>[['home',owner?'لوحة الصف':'المواد'],['feed','الإشعارات'],['feedback','الاقتراحات'],...(owner?[['accounts','الطلاب']]:[]),['settings','الإعدادات']];
function navigation(){
  $('#menu').hidden=!name;$('#role').textContent=owner?'المالك':'الطالب';
  const tabs=name?links():[];
  drawer.querySelector('nav').replaceChildren(...tabs.map(([k,l])=>button(l,()=>go(k))));
  $('footer').replaceChildren(...tabs.filter(([k])=>['home','feed','feedback'].includes(k)).map(([k,l])=>button(l,()=>go(k),k===page?'active':'')));
}
$('#menu').onclick=()=>{drawer.hidden=false;$('#close').focus();};$('#close').onclick=()=>{drawer.hidden=true;$('#menu').focus();};
async function boot(){
  const state=await rpc('boot');owner=state.owner;paired=state.paired;setup=state.setup;
  await go('login');
}
async function go(next,item){
  drawer.hidden=true;page=next;const mine=++revision;
  if(item&&next==='subject')selected=item;
  navigation();
  const pages={login,home,feed,feedback,accounts,settings,subject,source,quiz,pair};
  try{
    if(name&&['home','feed','feedback','accounts','settings','subject'].includes(next))cache=await rpc('home');
    if(mine!==revision)return;
    const nodes=await pages[next](item);
    if(mine===revision){main.replaceChildren(...nodes.filter(Boolean));window.scrollTo(0,0);}
  }catch(err){
    if(mine!==revision)return;
    if(err.message.includes('انتهت الجلسة')){name='';await go('login');return;}
    main.replaceChildren(hero('تعذّر فتح الصفحة',err.message),button('إعادة المحاولة',()=>go(next,item)),button('العودة',()=>go(name?'home':'login')));
  }
}
function pair(){return [hero('ربط الهاتف بالصف','الاتصال عبر شبكة الواي فاي المشتركة'),form('رمز الربط',[field('الصق الرمز الذي شاركه المالك','invite','textarea')],'ربط الصف',async d=>{await rpc('pair',d);paired=true;await go('login');}),button('العودة لمساحة الهاتف',()=>rpc('local'))];}
function login(){
  if(!owner&&!paired)return [hero('مساحتك الدراسية','قوم دروس'),wrap('grid',
    tile('فتح صفّي','مواد الصف وإشعارات المالك','⌂',()=>go('pair')),
    tile('مساحة الهاتف','قراءة الصور والمصادر دون اتصال','▤',()=>rpc('local')))];
  const first=owner&&setup;
  return [hero(owner?'لوحة قوم دروس':'قوم دروس',owner?'إدارة الصف':'مساحة الطالب'),form(first?'إنشاء حساب المالك':'تسجيل الدخول',[field('الاسم','name'),field(first?'كلمة السر · ٨ أحرف على الأقل':'كلمة السر','password','password')],first?'إنشاء اللوحة':'دخول',async d=>{
    const result=await rpc(first?'setup':'login',d);name=result.name;setup=false;await go('home');
  }),!owner&&button('تغيير رمز الصف',()=>go('pair')),!owner&&button('مساحة الهاتف دون اتصال',()=>rpc('local'))];
}
const symbols=['ϟ','⚗','✿','Aa','∑'];
function home(){
  const subjects=cache.subjects,grid=wrap('grid');
  const render=q=>{const hits=subjects.filter(s=>s.name.includes(q));grid.replaceChildren(...hits.map(s=>tile(s.name,s.docs+' مصادر'+(s.page?' · صفحة '+s.page:''),symbols[(s.id-1)%5],()=>go('subject',s))));if(!hits.length)grid.append(el('p','ما في مادة بهذا الاسم.'));};
  const search=el('input');search.type='search';search.placeholder='ابحث عن مادة';search.setAttribute('aria-label',search.placeholder);search.oninput=()=>render(search.value.trim());render('');
  const waiting=cache.feedback.filter(x=>!x.reply).length;
  return [hero(owner?'نظرة على الصف':'أهلًا، '+name,owner?name+' · '+cache.students.length+' طلاب':'قوم دروس · '+subjects.length+' مواد'),
    owner&&wrap('grid',tile('صندوق الاقتراحات',waiting+' بانتظار الرد','✉',()=>go('feedback')),tile('إشعار جديد','إرسال إلى الصف','＋',()=>go('feed'))),
    owner&&button('ربط هواتف الطلاب',()=>go('settings')),el('h2','المواد الدراسية'),search,grid,owner&&form('مادة جديدة',[field('اسم المادة','name')],'إضافة مادة',async d=>{await rpc('addSubject',d);await go('home');})];
}
function feed(){return [hero('الإشعارات','أخبار الصف وتذكيراته'),owner&&form('إشعار عام',[field('العنوان','title'),field('نص الإشعار','body','textarea')],'نشر للطلاب',async d=>{await rpc('notice',d);await go('feed');}),
  ...cache.notices.map(n=>wrap('card',el('small',date(n.created)),el('h3',n.title),el('pre',n.body))),!cache.notices.length&&el('p','ستظهر أخبار الصف هنا عند نشرها.'),button('تحديث',()=>go('feed'))];}
const date=v=>new Intl.DateTimeFormat('ar-SY',{weekday:'long',month:'long',day:'numeric',year:'numeric'}).format(v);
function feedback(){return [hero(owner?'صندوق الاقتراحات':'اقتراحاتي',owner?'مراجعة رسائل الطلاب':'رسائلي وردود المالك'),!owner&&form('اقتراح جديد',[field('اكتب اقتراحك','body','textarea')],'إرسال للمالك',async d=>{await rpc('suggest',d);await go('feedback');}),
  ...cache.feedback.map(f=>wrap('card',el('small',f.name+' · '+date(f.created)),el('pre',f.body),el('b',f.reply?'رد المالك':'بانتظار الرد'),el('pre',f.reply||''),...(owner?[form('الرد',[field('نص الرد','body','textarea',f.reply||'')],'حفظ الرد',async d=>{await rpc('reply',{...d,id:f.id});await go('feedback');})]:[]))),button('تحديث',()=>go('feedback'))];}
function accounts(){return [hero('طلاب الصف',cache.students.length+' حسابات'),form('حساب طالب جديد',[field('اسم الطالب','name'),field('كلمة السر · ٨ أحرف على الأقل','password','password')],'إنشاء الحساب',async d=>{await rpc('account',d);await go('accounts');}),...cache.students.map(a=>wrap('card',el('strong',a.name)))];}
function settings(){
  const code=el('pre');
  return [hero('الإعدادات',name),owner&&wrap('card',el('h2','ربط هواتف الطلاب'),el('p','اتصلوا بنفس شبكة الواي فاي. اترك لوحة المالك مفتوحة أثناء استخدام الصف.'),
    button('تشغيل الصف ومشاركة الرمز',async()=>{const invite=(await rpc('share')).invite;code.textContent=(invite.startsWith('qum1/127.')?'رمز للتجربة على نفس الهاتف فقط. لمشاركة الصف مع الطلاب اتصل بالواي فاي ثم أعِد المشاركة.\n':'')+invite;code.style.userSelect='all';},'primary'),code),
    button('تسجيل الخروج',async()=>{await rpc('logout');name='';await go('login');})];
}
function ocr(bytes){
  const worker=new Worker('ocr-worker.js');
  return new Promise((resolve,reject)=>{
    const stop=(error,value)=>{clearTimeout(timer);worker.terminate();if(error)reject(Error(error));else resolve(value);};
    const timer=setTimeout(()=>stop('استغرقت القراءة وقتًا طويلًا. قص الصورة وحاول مجددًا.'),90000);
    worker.onerror=()=>stop('تعذّر تشغيل قارئ الصور.');worker.onmessage=e=>{const d=e.data;stop(d.error||d.confidence<45||!d.text?'تعذّرت قراءة النص. جرّب صورة أوضح.':'',d.text);};
    worker.postMessage(bytes,[bytes]);
  });
}
function sourceForm(){
  const upload=field('صورة من المعرض','file','file');upload.querySelector('input').accept='image/jpeg,image/png,image/webp';
  return form('إضافة مصدر',[upload],'قراءة الصورة ونشر المصدر',async(d,status)=>{
    if(!d.file.size||d.file.size>5000000)throw Error('اختر صورة حتى ٥ ميغابايت.');
    const bmp=await createImageBitmap(d.file),canvas=el('canvas'),scale=Math.min(1,1900/Math.max(bmp.width,bmp.height));canvas.width=Math.max(1,Math.round(bmp.width*scale));canvas.height=Math.max(1,Math.round(bmp.height*scale));
    const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bmp,0,0,canvas.width,canvas.height);bmp.close();
    status.textContent='جارٍ قراءة النص العربي والإنجليزي…';
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.92));
    const body=await ocr(await blob.arrayBuffer());let image=canvas.toDataURL('image/jpeg',.65);
    if(image.length>550000)image=canvas.toDataURL('image/jpeg',.35);
    if(image.length>550000)throw Error('قص الصورة حول نص الصفحة ثم أعد المحاولة.');
    await rpc('addSource',{subject:selected.id,title:body.trim().split('\n')[0].slice(0,180),body,image});await go('subject',selected);
  });
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
  for(const d of content.sources){const day=date(d.created);if(day!==last){items.push(el('h2',day));last=day;count=dayCounts[day];}items.push(button('مصدر '+count--+' · '+d.title,()=>go('source',d),'tile'));}
  return [hero(s.name,s.page?'وصل الصف إلى صفحة '+s.page:'مكتبة المادة'),controls,sourceForm(),...items,owner&&form('تقدّم الصف',[field('رقم الصفحة','page','number',s.page||'')],'حفظ الصفحة',async d=>{await rpc('progress',{subject:s.id,page:Number(d.page)});await go('subject',s);})];
}
async function source(item){const record=await rpc('source',{id:item.id});const img=el('img');img.src=record.image;img.alt='صورة المصدر';
  return [button('العودة للمادة',()=>go('subject',selected)),hero(record.title,date(record.created)),wrap('card',el('pre',record.body),img),owner&&button('حذف المصدر',async()=>{if(confirm('حذف هذا المصدر من الصف؟')){await rpc('remove',{id:item.id});await go('subject',selected);}})];}
async function quiz(item){const q=await rpc('quiz',{id:item.id}),choices=JSON.parse(q.choices),result=el('p');
  return [hero(q.title,selected.name),wrap('card',el('h3',q.question),...choices.map((v,i)=>button(v,async()=>{if(owner){message('معاينة المالك');return;}const score=await rpc('solve',{id:item.id,choice:i});result.textContent=i===score.answer?'إجابة صحيحة':'الإجابة الصحيحة · '+choices[score.answer];})),result),button('العودة للمادة',()=>go('subject',selected))];}
window.backPage=()=>{if(!drawer.hidden){drawer.hidden=true;return true;}if(page==='source'||page==='quiz'){go('subject',selected);return true;}if(!name&&page==='pair'){go('login');return true;}if(name&&page!=='home'){go('home');return true;}return false;};
boot().catch(e=>message(e.message));
