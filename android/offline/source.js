const subject = new URLSearchParams(location.search).get('subject');
document.querySelector('#subject').textContent = subject;
const list = document.querySelector('#sources');
const statusBox = document.querySelector('#status');
const db = new Promise((resolve,reject) => {
  const req = indexedDB.open('class-sources',1);
  req.onupgradeneeded = () => req.result.createObjectStore('sources',{keyPath:'id',autoIncrement:true}).createIndex('subject','subject');
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
function node(tag,value) {
  const item = document.createElement(tag);
  item.textContent = value;
  return item;
}
async function records() {
  const req = (await db).transaction('sources').objectStore('sources').index('subject').getAll(subject);
  return new Promise((resolve,reject) => {req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
}
const urls = [];
async function render() {
  const entries = await records();
  urls.splice(0).forEach(url=>URL.revokeObjectURL(url));
  list.replaceChildren();
  const day = new Intl.DateTimeFormat('ar-SY',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  for (const entry of entries.reverse()) {
    const item=node('article',''), detail=node('details','');
    detail.append(node('summary',entry.title));
    if(entry.text)detail.append(node('pre',entry.text));
    const img = document.createElement('img');
    img.alt = 'صورة المصدر';
    img.loading = 'lazy';
    img.src = typeof entry.image==='string'?entry.image:URL.createObjectURL(entry.image);
    if(img.src.startsWith('blob:'))urls.push(img.src);
    detail.append(img);
    item.append(node('small',day.format(entry.date)),detail);
    list.append(item);
  }
  if (!entries.length) list.append(node('p','اختر أول صورة لإضافتها إلى مصادر المادة.'));
}
const key = text => text.normalize('NFKC').replace(/[ً-ْـ]/g,'').replace(/[أإآ]/g,'ا').replace(/[^\p{L}\p{N}]+/gu,' ').trim().toLowerCase();
document.querySelector('form').onsubmit = async event => {
  event.preventDefault();
  const button = document.querySelector('#read');
  button.disabled = true;
  try {
    const file = document.querySelector('#photo').files[0];
    if (!file || file.size > 5*1024*1024) throw Error('اختر صورة حجمها حتى ٥ ميغابايت.');
    statusBox.textContent='جارٍ تجهيز الصورة…';
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1,2200/Math.max(bitmap.width,bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1,Math.round(bitmap.width*scale));
    canvas.height = Math.max(1,Math.round(bitmap.height*scale));
    const ctx=canvas.getContext('2d');
    ctx.fillStyle='#fff';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
    bitmap.close();
    const image=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.92));
    if(!image)throw Error('تعذّر تجهيز الصورة.');
    const title=document.querySelector('#title').value.trim();
    if(!title)throw Error('اكتب عنوان المصدر.');
    if ((await records()).some(item=>key(item.title)===key(title))) throw Error('هذا المصدر موجود في المادة.');
    const tx=(await db).transaction('sources','readwrite');
    tx.objectStore('sources').add({subject,title,image,date:Date.now()});
    await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(Error('تعذّر حفظ المصدر على الهاتف.'));});
    await render();
    event.target.reset();
    statusBox.textContent='حُفظت الصورة في مصادر المادة.';
  } catch(error){statusBox.textContent=error.message;}
  finally{button.disabled=false;}
};
render().catch(()=>{statusBox.textContent='تعذّر فتح المصادر المحفوظة.';});
