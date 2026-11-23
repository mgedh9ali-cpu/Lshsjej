// Introductory reading is bundled. Personal images retain their original IndexedDB store.
const readings = [
  ['الفيزياء','السرعة المتوسطة','السرعة المتوسطة تساوي المسافة الكلية مقسومة على الزمن الكلي.\n\nمثال: قطع عدّاء ١٠٠ متر في ٢٠ ثانية. سرعته المتوسطة ٥ أمتار في الثانية.\n\nجرّب: قطع درّاج ٦٠٠ متر في دقيقتين. حوّل الدقيقتين إلى ١٢٠ ثانية ثم اقسم المسافة على الزمن.'],
  ['الكيمياء','العنصر والمركّب','العنصر مادة تتكوّن من نوع واحد من الذرات، مثل الحديد. يتكوّن المركّب من اتحاد ذرات عنصرين مختلفين أو أكثر بنسبة محدّدة.\n\nيتكوّن جزيء الماء H₂O من ذرتي هيدروجين وذرة أكسجين. أمّا جزيء الأكسجين O₂ فيبقى عنصرًا لأن ذرّتيه من النوع نفسه.'],
  ['العلوم','من الخلية إلى الجهاز','الخلية وحدة البناء والوظيفة في الكائن الحي. تتعاون خلايا متخصّصة لتشكّل نسيجًا، وتتآلف أنسجة مختلفة لتشكّل عضوًا.\n\nمثال: يحتوي القلب على نسيج عضلي ينقبض لضخ الدم. يعمل القلب مع الأوعية الدموية ضمن جهاز الدوران.'],
  ['الإنجليزي','المضارع البسيط','نستخدم المضارع البسيط للتعبير عن العادات.\nI read every day.\nShe reads every day.\n\nفي السؤال نستخدم do أو does، ويأتي الفعل بصيغته الأساسية.\nDoes she read every day?\n\nجرّب تحويل الجملة He plays football إلى سؤال. الجواب: Does he play football?'],
  ['الرياضيات','حلّ معادلة من الدرجة الأولى','للحفاظ على توازن المعادلة، طبّق العملية نفسها على الطرفين.\n\nمثال: ٣س + ٥ = ٢٠. اطرح ٥ من الطرفين فتحصل على ٣س = ١٥. اقسم الطرفين على ٣، فتكون س = ٥.\n\nتحقّق بالتعويض: ٣ × ٥ + ٥ = ٢٠.']
];
let libraryDB;
function localDb(){
  if(!libraryDB)libraryDB=new Promise((resolve,reject)=>{
    const q=indexedDB.open('class-sources',1);
    q.onupgradeneeded=()=>q.result.createObjectStore('sources',{keyPath:'id',autoIncrement:true}).createIndex('subject','subject');
    q.onsuccess=()=>resolve(q.result);q.onerror=()=>{libraryDB=null;reject(Error('تعذّر فتح المصادر المحفوظة.'));};
  });
  return libraryDB;
}
function readRequest(q){return new Promise((resolve,reject)=>{q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(Error('تعذّر تحميل المصادر.'));});}
async function offlineData(op,d){
  if(op==='home'){
    const subjects=readings.map(([name],i)=>({id:i+1,name,docs:0}));
    if(!locked){
      const db=await localDb();
      await Promise.all(subjects.map(async s=>{s.docs=await readRequest(db.transaction('sources').objectStore('sources').index('subject').count(s.name));}));
    }
    return {subjects,feedback:[],students:[],notices:[]};
  }
  if(op==='subject'&&locked)return {sources:[],quizzes:[]};
  if(locked)throw Error('سجّل الدخول لفتح مصادرك المحفوظة.');
  const db=await localDb();
  if(op==='source'){
    const r=await readRequest(db.transaction('sources').objectStore('sources').get(d.id));
    if(!r)throw Error('المصدر غير موجود.');
    return {title:r.title,body:r.text,image:r.image,created:r.date};
  }
  const subject=readings[d.subject-1][0];
  if(op==='subject'){
    const rows=await readRequest(db.transaction('sources').objectStore('sources').index('subject').getAll(subject));
    return {sources:rows.reverse().map(r=>({id:r.id,title:r.title,created:r.date})),quizzes:[]};
  }
  if(op==='addSource'){
    const tx=db.transaction('sources','readwrite'),store=tx.objectStore('sources'),q=store.index('subject').getAll(subject);
    const norm=t=>t.normalize('NFKC').replace(/[ً-ْـ]/g,'').trim().toLowerCase();
    await new Promise((resolve,reject)=>{
      q.onsuccess=()=>{if(q.result.some(r=>norm(r.title)===norm(d.title)||norm(r.text)===norm(d.body))){tx.abort();return;}
        store.add({subject,title:d.title,text:d.body,image:d.image,date:Date.now()});};
      tx.oncomplete=resolve;tx.onabort=()=>reject(Error(tx.error?'تعذّر الحفظ.':'المصدر موجود في المادة.'));tx.onerror=()=>reject(Error('تعذّر حفظ المصدر.'));
    });return {};
  }
}
