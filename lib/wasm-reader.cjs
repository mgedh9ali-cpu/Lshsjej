const { join } = require('node:path');
async function read() {
  const [folder, mode] = process.argv.slice(2);
  require(join(folder, 'models.cjs'));
  const engine = await require(join(folder, 'core.cjs'))();
  for (const [lang, encoded] of Object.entries(globalThis.models)) {
    engine.FS.writeFile('/' + lang + '.traineddata', Buffer.from(encoded,'base64'));
  }
  const api = new engine.TessBaseAPI();
  if (api.Init(null,'ara+eng',1)) throw Error('OCR initialization failed');
  const bytes = [];
  for await (const chunk of process.stdin) bytes.push(chunk);
  engine.FS.writeFile('/input',Buffer.concat(bytes));
  if (api.SetImageFile(1,0)) throw Error('Invalid image');
  api.SetVariable('tessedit_pageseg_mode',mode);
  api.Recognize(null);
  process.stdout.write('level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n' + api.GetTSVText());
  api.End();
}
read().catch(error=>{console.error(error.message);process.exitCode=1;});
