// 합성 데이터로 Worker 파이프라인이 끝까지 도는지 검증하는 테스트용 mock (실제 시세 아님)
const D=86400000;
function interp(anchors,t,log=false){ // anchors [[iso, v]]
  const pts=anchors.map(([d,v])=>[Date.parse(d+'-01'),v]);
  if(t<=pts[0][0]) return pts[0][1]; if(t>=pts.at(-1)[0]) return pts.at(-1)[1];
  for(let i=0;i<pts.length-1;i++){ if(t>=pts[i][0]&&t<=pts[i+1][0]){ const f=(t-pts[i][0])/(pts[i+1][0]-pts[i][0]); return log?Math.exp(Math.log(pts[i][1])*(1-f)+Math.log(pts[i+1][1])*f):pts[i][1]+(pts[i+1][1]-pts[i][1])*f; } }
}
export const BTC=[['2011-01',0.3],['2012-01',5],['2013-01',13],['2013-11',1100],['2014-01',800],['2015-01',250],['2016-01',430],['2017-01',1000],['2017-12',14000],['2018-12',3700],['2019-12',7200],['2020-03',6400],['2020-12',29000],['2021-04',58000],['2021-07',33000],['2021-11',64000],['2022-12',16500],['2023-12',42000],['2024-03',70000],['2024-12',94000],['2025-10',110000],['2026-09',95000]];
const ETHBTC=[['2016-05',0.02],['2017-03',0.03],['2017-06',0.10],['2018-01',0.10],['2018-12',0.037],['2019-12',0.019],['2020-12',0.03],['2021-05',0.08],['2021-12',0.07],['2022-09',0.07],['2023-10',0.05],['2024-03',0.055],['2024-12',0.036],['2025-04',0.02],['2025-08',0.04],['2026-09',0.03]];
const FED=[['2011-01',0.1],['2015-12',0.15],['2018-12',2.4],['2019-12',1.55],['2020-04',0.05],['2022-03',0.1],['2023-08',5.33],['2024-08',5.33],['2025-12',3.7],['2026-09',3.6]];
const DOL=[['2011-01',90],['2014-06',96],['2016-12',112],['2018-03',108],['2020-12',112],['2021-12',113],['2022-10',126],['2024-01',120],['2025-06',114],['2026-09',116]];
const M2=[['2011-01',9000],['2019-12',15300],['2020-03',15800],['2021-03',20000],['2022-03',21700],['2023-04',20800],['2024-12',21500],['2026-08',23300]];
const FXE=[['2011-01',1.3],['2014-06',1.36],['2017-01',1.06],['2018-02',1.24],['2022-09',0.98],['2025-07',1.17],['2026-09',1.12]];
const FXJ=[['2011-01',82],['2013-01',90],['2015-06',123],['2020-01',109],['2022-10',148],['2024-07',160],['2026-09',148]];
const FXG=[['2011-01',1.6],['2016-07',1.3],['2018-04',1.42],['2022-09',1.11],['2025-07',1.36],['2026-09',1.3]];
const EA=[['2011-01',9000000],['2020-01',12300000],['2022-01',15500000],['2026-07',16600000]];
const JP=[['2011-01',7600000],['2020-01',10000000],['2026-06',12700000]];
const UK=[['2011-01',2100000],['2020-01',2800000],['2022-01',3100000],['2026-06',3250000]];
const DLL=[['2017-11',0.4],['2020-01',5],['2021-06',110],['2022-04',185],['2023-09',125],['2024-12',205],['2026-09',300]];
const iso=t=>new Date(t).toISOString().slice(0,10);
function daily(anchors,start,end,log=false,skipWeekends=true){ let s='observation_date,X\n'; for(let t=Date.parse(start);t<=end;t+=D){const dw=new Date(t).getUTCDay(); if(skipWeekends&&(dw===0||dw===6)) continue; s+=iso(t)+','+interp(anchors,t,log).toFixed(4)+'\n'; } return s; }
function monthly(anchors,start,end){ let s='observation_date,X\n'; for(let d=new Date(start+'T00:00:00Z');d.getTime()<=end;d=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1))) s+=iso(d.getTime())+','+interp(anchors,d.getTime()).toFixed(3)+'\n'; return s; }
export function makeFetch({cmc=false,failBoj=false}={}){
  const NOW=Date.now(); let upbitPages=0;
  return async function(url,opt){
    url=String(url); const R=(body,status=200,type='application/json')=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'content-type':type}});
    if(url.includes('fredgraph.csv')){
      const id=new URL(url).searchParams.get('id'); const end=NOW-2*D;
      const mk={
        M2SL:()=>monthly(M2,'2010-06-01',NOW-40*D), EFFR:()=>daily(FED,'2010-06-01',end,false,false), DTWEXBGS:()=>daily(DOL,'2010-06-01',end),
        WTISPLC:()=>monthly([['2011-01',90],['2016-01',33],['2022-06',114],['2026-08',70]],'2010-06-01',NOW-40*D),
        SP500:()=>daily([['2016-10',2100],['2020-03',2300],['2022-10',3600],['2026-09',6800]],'2016-10-01',end),
        DEXUSEU:()=>daily(FXE,'2010-06-01',end), DEXJPUS:()=>daily(FXJ,'2010-06-01',end), EXUSUK:()=>daily(FXG,'2010-06-01',end),
        CBBTCUSD:()=>daily(BTC,'2014-12-01',end,true,false), CBETHUSD:()=>{ let s='observation_date,X\n'; for(let t=Date.parse('2016-05-18');t<=end;t+=D) s+=iso(t)+','+(interp(BTC,t,true)*interp(ETHBTC,t)).toFixed(3)+'\n'; return s; }
      }[id]; return mk?R(mk(),200,'text/csv'):R('',404);
    }
    if(url.includes('data-api.ecb.europa.eu')){ let s='KEY,FREQ,TIME_PERIOD,OBS_VALUE,OBS_STATUS\n'; for(let d=new Date('2011-01-01T00:00:00Z');d.getTime()<=NOW-30*D;d=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1))) s+=`BSI.M...,M,${iso(d.getTime()).slice(0,7)},${interp(EA,d.getTime()).toFixed(0)},A\n`; return R(s,200,'text/csv'); }
    if(url.includes('stat-search.boj.or.jp')){ if(failBoj) return R('err',500); let s='SERIES_CODE,NAME\nMAM1NAM2M2MO,M2\nSURVEY_DATES,VALUES\n'; for(let d=new Date('2011-01-01T00:00:00Z');d.getTime()<=NOW-30*D;d=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1))) s+=`${iso(d.getTime()).slice(0,4)}${iso(d.getTime()).slice(5,7)},${interp(JP,d.getTime()).toFixed(0)}\n`; return R(s,200,'text/csv'); }
    if(url.includes('bankofengland.co.uk')){ const M=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; let s='DATE,LPMAUYN\n'; for(let d=new Date('2011-01-01T00:00:00Z');d.getTime()<=NOW-45*D;d=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1))) s+=`28 ${M[d.getUTCMonth()]} ${d.getUTCFullYear()},${interp(UK,d.getTime()).toFixed(0)}\n`; return R(s,200,'text/csv'); }
    if(url.includes('blockchain.info')){ const values=[]; for(let t=Date.parse('2011-01-01');t<=NOW;t+=4*D) values.push({x:Math.floor(t/1000),y:interp(BTC,t,true)}); return R({values}); }
    if(url.includes('stablecoins.llama.fi')){ const a=[]; for(let t=Date.parse('2017-11-30');t<=NOW;t+=D) a.push({date:String(Math.floor(t/1000)),totalCirculatingUSD:{peggedUSD:interp(DLL,t)*1e9}}); return R(a); }
    if(url.includes('coinmarketcap.com')){ if(!cmc) return R('{}',403); const quotes=[]; const dom=[['2013-04',93],['2014-12',88],['2016-12',87],['2017-06',48],['2018-01',33],['2018-12',53],['2020-10',60],['2021-05',41],['2022-06',41],['2023-12',52],['2024-12',58],['2025-10',59],['2026-09',58]]; for(let t=Date.parse('2013-04-28');t<=NOW;t+=D) quotes.push({timestamp:new Date(t).toISOString(),btcDominance:interp(dom,t)}); return R({data:{quotes}}); }
    if(url.includes('api.coingecko.com')) return R({data:{market_cap_percentage:{btc:58.6}}});
    if(url.includes('coingecko.com/en/charts')) return R('<html>BTC 58.6% 59.4% 60.1% 61.0% 58.0%</html>',200,'text/html');
    if(url.includes('alternative.me')) return R({data:Array.from({length:30},(_,i)=>({value:String(40+i%10),value_classification:'Fear'}))});
    if(url.includes('api.upbit.com/v1/candles/days')){
      const sym=new URL(url).searchParams.get('market').replace('KRW-',''); const count=+new URL(url).searchParams.get('count');
      if(count===200){ upbitPages++; const n=upbitPages<=3?200:60; return R(Array.from({length:n},(_,i)=>({candle_date_time_utc:new Date(NOW-((upbitPages-1)*200+i)*D).toISOString().slice(0,19),trade_price:1e8*(1+((upbitPages-1)*200+i)*0.0005),timestamp:NOW-((upbitPages-1)*200+i)*D}))); }
      const drift={BTC:0.001,ETH:0.0025,XRP:0.0012,SOL:-0.001,ADA:0.002,DOGE:0.0005,LINK:0.003,AVAX:-0.002,SUI:0.004,HBAR:0.001,XLM:0.0015,UNI:0.0005,AAVE:0.0035,NEAR:-0.003,ONDO:0.0045,TAO:0.005}[sym]; if(drift===undefined) return R([],404);
      const rows=[]; let p=1000*(sym==='BTC'?1e5:1); const arr=[]; for(let i=0;i<count;i++){ p*=1+drift+(Math.sin(i*1.7+sym.length)*0.01); arr.push(p);} 
      for(let i=count-1;i>=0;i--) rows.push({candle_date_time_utc:new Date(NOW-(count-1-i)*D).toISOString().slice(0,19),trade_price:arr[i],candle_acc_trade_price:1e9*(1+(i>count-8?0.6:0)),timestamp:NOW-(count-1-i)*D});
      return R(rows);
    }
    return R('',404);
  };
}
export class KV{ constructor(){this.m=new Map(); this.puts=0} async get(k,t){const v=this.m.get(k); return v?JSON.parse(v):null} async put(k,v){this.puts++;this.m.set(k,v)} }
