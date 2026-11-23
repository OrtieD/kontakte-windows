// afterPack: Icon und Versionsinfo ohne Wine in die Windows-.exe schreiben
const fs = require('fs');
const path = require('path');
exports.default = async function (context) {
  if (context.electronPlatformName !== 'win32') return;
  const ResEdit = await import('resedit');
  const PE = await import('pe-library');
  const R = ResEdit.default || ResEdit, P = PE.default || PE;
  const name = context.packager.appInfo.productFilename;
  const exe = path.join(context.appOutDir, `${name}.exe`);
  const ver = context.packager.appInfo.version;
  const e = P.NtExecutable.from(fs.readFileSync(exe), { ignoreCert: true });
  const res = P.NtExecutableResource.from(e);
  const ico = R.Data.IconFile.from(fs.readFileSync(path.join(__dirname, 'icon.ico')));
  const groups = R.Resource.IconGroupEntry.fromEntries(res.entries);
  const ids = groups.length ? groups.map(g => g.id) : [1];
  for (const id of ids) R.Resource.IconGroupEntry.replaceIconsForResource(res.entries, id, 1033, ico.icons.map(i => i.data));
  const vi = R.Resource.VersionInfo.fromEntries(res.entries);
  for (const v of vi) {
    const [a, b, c] = ver.split('.').map(Number);
    v.setFileVersion(a, b, c, 0, 1033); v.setProductVersion(a, b, c, 0, 1033);
    v.setStringValues({ lang: 1033, codepage: 1200 }, { FileDescription: 'Kontakte', ProductName: 'Kontakte', CompanyName: 'Ortie', OriginalFilename: `${name}.exe`, InternalName: name, FileVersion: ver, ProductVersion: ver });
    v.outputToResourceEntries(res.entries);
  }
  res.outputResource(e);
  fs.writeFileSync(exe, Buffer.from(e.generate()));
  console.log('  • Icon gesetzt (resedit)', exe);
};
