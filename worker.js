const UPBIT="https://api.upbit.com";
const BINANCE="https://api.binance.com";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET,OPTIONS","Access-Control-Allow-Headers":"Content-Type"};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}});
export default{async fetch(req,env){const u=new URL(req.url);
if(req.method==="OPTIONS")return new Response(null,{headers:cors});
if(u.pathname==="/health")return json({ok:true,version:"v10.2.3",service:"BTC ALT REGIME TRADER v10.2.3",market:"Upbit KRW",kv:!!env.SCALPER_KV,telegramConfigured:!!(env.TELEGRAM_BOT_TOKEN&&env.TELEGRAM_CHAT_ID),pinConfigured:!!env.PIN,externalContext:{publicMacro:true}});
if(u.pathname==="/upbit"){const path=u.searchParams.get("path");if(!path||!path.startsWith("/v1/"))return new Response(JSON.stringify({error:"invalid path"}),{status:400,headers:{...cors,"Content-Type":"application/json"}});
const r=await fetch(UPBIT+path,{headers:{"Accept":"application/json","User-Agent":"BTC-ALT-REGIME-TRADER/10.2.2"}});return new Response(await r.text(),{status:r.status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}});}
if(u.pathname==="/market"){
  const raw=(u.searchParams.get("symbols")||"BTC,ETH,SOL,XRP,HBAR,ONDO,LINK,AVAX,DOGE,SUI,TAO,UNI,AAVE,ADA,NEAR").toUpperCase().split(",").map(x=>x.trim()).filter(Boolean);
  const symbols=[...new Set(raw)].slice(0,30);
  if(!symbols.length)return json({ok:false,error:"symbols required"},400);

  // IMPORTANT: do not open one Binance connection per coin. Cloudflare Workers has
  // a small simultaneous outbound-connection limit. The old Promise.allSettled()
  // implementation could deadlock / be cancelled when 10-30 symbols were requested.
  // Binance's all-tickers endpoint gives every symbol in ONE request, so /market now
  // needs only two upstream connections total (Upbit + Binance).
  const upMarkets=[...symbols.map(s=>"KRW-"+s),"KRW-USDT"].join(",");
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),7000);
  try{
    const [ur,br]=await Promise.all([
      fetch(UPBIT+"/v1/ticker?markets="+encodeURIComponent(upMarkets),{headers:{"Accept":"application/json","User-Agent":"BTC-ALT-REGIME-TRADER/10.2.3"},signal:controller.signal}),
      fetch(BINANCE+"/api/v3/ticker/24hr",{headers:{"Accept":"application/json","User-Agent":"BTC-ALT-REGIME-TRADER/10.2.3"},signal:controller.signal})
    ]);
    if(!ur.ok)return json({ok:false,error:"Upbit ticker "+ur.status},502);
    // Current KRW prices must still work even if Binance/Kimchi premium is unavailable.
    const up=await ur.json();
    let bn=[];
    if(br.ok){try{const x=await br.json();if(Array.isArray(x))bn=x}catch{}}
    const um=new Map(up.map(x=>[x.market,x]));
    const bm=new Map(bn.map(x=>[x.symbol,x]));
    const usdtKrw=Number(um.get("KRW-USDT")?.trade_price||0);
    const rows=symbols.map(symbol=>{
      const x=um.get("KRW-"+symbol)||{}, b=bm.get(symbol+"USDT")||{};
      const price=Number(x.trade_price), ch=Number(x.signed_change_rate)*100, busdt=Number(b.lastPrice);
      const fair=busdt>0&&usdtKrw>0?busdt*usdtKrw:null;
      const premium=price>0&&fair>0?(price/fair-1)*100:null;
      return {symbol,price:Number.isFinite(price)?price:null,change24h:Number.isFinite(ch)?ch:null,premium:Number.isFinite(premium)?premium:null,binanceUsdt:Number.isFinite(busdt)?busdt:null,fairKrw:Number.isFinite(fair)?fair:null,updatedAt:Number(x.timestamp)||Date.now()};
    });
    return json({ok:true,market:"UPBIT_KRW",reference:"Binance USDT × Upbit USDT/KRW",usdtKrw:usdtKrw||null,kimchiSourceOk:br.ok,rows,updatedAt:Date.now()});
  }catch(e){
    const msg=e?.name==="AbortError"?"upstream timeout":"upstream fetch failed";
    return json({ok:false,error:msg,detail:String(e?.message||e)},504);
  }finally{clearTimeout(timer)}
}
if(u.pathname==="/telegram-test"){if(!env.TELEGRAM_BOT_TOKEN||!env.TELEGRAM_CHAT_ID)return new Response(JSON.stringify({ok:false,message:"Worker Secret에 TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID를 설정하세요."}),{status:400,headers:{...cors,"Content-Type":"application/json"}});
const r=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:env.TELEGRAM_CHAT_ID,text:"⚡ BTC ALT REGIME TRADER v10.2.2\nTelegram 연결 테스트 정상입니다.\n매매는 수동으로 진행합니다."})});
const x=await r.json();return new Response(JSON.stringify({ok:!!x.ok,message:x.ok?"Telegram 테스트 메시지를 요청했습니다.":"Telegram 전송 실패"}),{status:x.ok?200:500,headers:{...cors,"Content-Type":"application/json"}});}
return new Response("BTC ALT REGIME TRADER v10.2.3",{headers:cors});}};