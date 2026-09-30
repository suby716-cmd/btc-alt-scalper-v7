import {makeFetch,KV} from './mock.mjs';
const opt=process.argv[2]||'';
globalThis.fetch=makeFetch({cmc:opt.includes('cmc'),failBoj:opt.includes('nobj')});
const mod=await import('../worker/worker.mjs'); const w=mod.default;
const kv=new KV(); const env=opt.includes('nokv')?{}:{SCALPER_KV:kv};
async function get(path,method='POST'){ const t=Date.now(); const r=await w.fetch(new Request('https://x.test'+path,{method}),env); const j=await r.json(); return {j,ms:Date.now()-t,status:r.status}; }
const a=await get('/altseason'); const j=a.j;
console.log('status',a.status,'ok',j.ok,'ms',a.ms,'cache',JSON.stringify(j.cache),'kvPuts',kv.puts);
if(!j.ok){console.log(JSON.stringify(j).slice(0,800)); process.exit(1)}
console.log('score',JSON.stringify(j.score.total),'comparable',j.score.comparable,'stage',j.score.stage?.label,'coverage',j.score.coverage);
console.log('components',j.score.components.map(c=>`${c.key}:${c.pts}/${c.max}(${c.detail})`).join(' | '));
console.log('drivers',JSON.stringify(j.score.drivers),'path',JSON.stringify(j.score.path),'momentum',JSON.stringify(j.score.momentum),'streak',JSON.stringify(j.score.streak));
console.log('m2 used',JSON.stringify(j.inputs.m2.used),'rejected',JSON.stringify(j.inputs.m2.rejected),'m2 latest',j.inputs.m2.value&&Math.round(j.inputs.m2.value),j.inputs.m2.key,'yoy',j.inputs.m2.yoy);
console.log('dom',JSON.stringify(j.inputs.dom),'eth',JSON.stringify(j.inputs.ethbtc));
console.log('breadth',JSON.stringify({...j.breadth,coins:undefined,groups:undefined}),'groups',JSON.stringify(j.breadth.groups),'reach',j.breadth.reach);
console.log('rotation',JSON.stringify(j.rotation));
console.log('analogs',JSON.stringify(j.analogs));
console.log('windowStats',JSON.stringify(j.history.windowStats.map(w=>({id:w.id,start:w.startScore,peak:w.peakScore,pm:w.peakMonth}))));
console.log('calibration',JSON.stringify(j.history.calibration.map(c=>({T:c.threshold,hit:c.hitRate,fa:c.falseAlarmRate,leads:c.leads.map(l=>l.id+':'+l.firstCross)}))));
const ms=j.history.months; console.log('months',ms.length,ms[0].k,'→',ms.at(-1).k,'first full',ms.find(m=>m.s!=null)?.k,'first macro',ms.find(m=>m.mo!=null)?.k);
console.log('sample every 6m:',ms.filter((m,i)=>i%9===0).map(m=>`${m.k}:${m.s??'-'}/${m.mo??'-'}${m.ds==='anchor'?'~':''}`).join(' '));
console.log('sources',JSON.stringify(j.sources));
const b=await get('/altseason'); console.log('2nd call cache',JSON.stringify(b.j.cache),'ms',b.ms);
const c=await get('/altseason?part=hist'); console.log('part=hist',JSON.stringify(c.j).slice(0,200));
const m=await get('/macro'); console.log('/macro ok',m.j.ok,'dom',m.j.btcDominance,'mayer',m.j.mayerMultiple&&+m.j.mayerMultiple.toFixed(3),'fg',m.j.fearGreed,'hasMacroRegime',!!m.j.macroRegime,'ms',m.ms);
const h=await get('/health','GET'); console.log('health',JSON.stringify(h.j));
