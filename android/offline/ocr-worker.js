importScripts('core.js', 'models.js');
async function initialize(language, progress) {
  progress('engine', 0);
  const module = await TesseractCore({
    TesseractProgress(percent) { progress('recognize', percent); },
  });
  progress('models', 0);
  for (const lang of language.split('+')) {
    const model = Uint8Array.from(atob(models[lang]), char => char.charCodeAt(0));
    module.FS.writeFile('/' + lang + '.traineddata', model);
  }
  const api = new module.TessBaseAPI();
  if (api.Init(null,language,1)) throw Error();
  return {module,api};
}
onmessage = async event => {
  const legacy = event.data instanceof ArrayBuffer;
  const { bytes, language } = legacy ? {bytes:event.data,language:'ara+eng'} : event.data;
  const progress = (stage, percent) => {
    if (!legacy) postMessage({type:'progress',stage,percent});
  };
  try {
    if (!['ara','eng','ara+eng'].includes(language)) throw Error();
    const {module,api} = await initialize(language, progress);
    module.FS.writeFile('/input', new Uint8Array(bytes));
    progress('recognize', 0);
    function read(mode) {
      api.SetPageSegMode(mode);
      if (api.SetImageFile(1,0)) throw Error();
      const text = (api.GetUTF8Text() || '').trim();
      return {text,confidence:api.MeanTextConf()};
    }
    let best = read(3);
    if (best.confidence < 60 || best.text.length < 8) {
      progress('retry', 0);
      const retry = read(6);
      if (retry.text && (retry.confidence > best.confidence || !best.text)) best = retry;
    }
    progress('finish', 100);
    api.Clear();
    postMessage(best);
  } catch { postMessage({error:true}); }
};
