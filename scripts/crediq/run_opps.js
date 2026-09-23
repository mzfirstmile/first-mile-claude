const fs=require('fs');
const src=fs.readFileSync(process.env.HOME+'/fmc/market-research.js','utf8');
const pick=(a,b)=>{const i=src.indexOf(a), j=src.indexOf(b,i); if(i<0||j<0) throw new Error('marker '+a); return src.slice(i,j);};
let code='';
code+=pick('  function _esc(s) {','  function _statusLabel(s)');
code+=pick('  function _tierClass(tier) {','  function _toast(msg');
code+=pick('  // Per-market loan signal summary','  function _renderNarrative(elId');
const data=JSON.parse(fs.readFileSync('loans.json','utf8'));
const stub=`let _viewType='office', _opps=null, _oppSig='flagged', _loggedDeals=new Set(), _loanIndex={}, _loans=[], _loanFilter='live', _mrTab='markets', _currentMarket=null, _mapInstance=null;
 const document={getElementById:()=>null,querySelectorAll:()=>[]};
 const window={supaFetch: async (t,q)=> t==='market_loans' ? (q.includes('offset=0')? DATA : []) : []};
 function _toast(){}`;
const f=new Function('DATA', stub+code+`
 return (async()=>{ await _loadOpps(); return _opps.map(a=>({...a, th:_oppThesis(a)})); })();`);
f(data).then(rows=>{
  const out=rows.filter(a=>a.market.state==='PA' && /office|retail/i.test(a.property_type||'') && a.flags.length)
   .sort((a,b)=>b.points-a.points || (b.mktScore||0)-(a.mktScore||0));
  fs.writeFileSync('pa_opps.json', JSON.stringify(out.map(a=>({name:a.property_name,address:a.address,town:a.market.name,type:a.property_type,sub:a.property_subtype,size:a.building_size,unit:a.size_unit,debt:a.current_balance,eff:a.effBal,portfolio:a.isPortfolio,loanNames:a.loan_names,rate:a.mortgage_rate,maturity:a.maturity_date,status:a.payment_status,ss:a.special_serviced,wl:a.watchlist,noi:a.noi,noiBasis:a.noiBasis,noiChg:a.noiChg,ltv:a.ltv,oscore:a.market.office_score,otier:a.market.office_tier,orank:a.market.rank_office,rscore:a.market.score,flags:a.flags.map(f=>f.label),points:a.points,thesis:a.th.text,play:a.th.play,url:a.source_url})),null,1));
  console.log(out.length); out.forEach(a=>console.log(a.points, a.property_name,'|',a.market.name,'|',a.property_type,'|',a.flags.map(f=>f.label).join(', ')));
  // also counts of all PA office/retail
  const all=rows.filter(a=>a.market.state==='PA' && /office|retail/i.test(a.property_type||''));
  console.log('PA office/retail live props:', all.length);
}).catch(e=>console.error(e));
