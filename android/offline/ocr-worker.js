importScripts('core.js', 'models.js');
let engine;
async function initialize() {
  const module = await TesseractCore();
  for (const lang of ['ara','eng']) {
    const model = Uint8Array.from(atob(models[lang]), char => char.charCodeAt(0));
    module.FS.writeFile('/' + lang + '.traineddata', model);
  }
  const api = new module.TessBaseAPI();
  if (api.Init(null,'ara+eng',1)) throw Error();
  return {module,api};
}
onmessage = async event => {
  try {
    const {module,api} = await (engine ||= initialize());
    module.FS.writeFile('/input', new Uint8Array(event.data));
    if (api.SetImageFile(1,0)) throw Error();
    api.SetPageSegMode(3);
    let text = api.GetUTF8Text();
    let confidence = api.MeanTextConf();
    if (confidence < 65 || text.trim().length < 8) {
      api.SetPageSegMode(6);
      const second = api.GetUTF8Text();
      if (api.MeanTextConf() > confidence || !text.trim()) {
        text = second;
        confidence = api.MeanTextConf();
      }
    }
    api.Clear();
    postMessage({text:text.trim(),confidence});
  } catch { postMessage({error:true}); }
};
