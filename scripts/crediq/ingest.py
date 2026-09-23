# Ingest CRED iQ loan-table rows (pipe-delimited, from Find > Loan Mode) into market_loans.
import json, sys, math, subprocess, datetime
A="23456789CFGHJMPQRVWX"
def dec(code):
    c=code.replace("+","").rstrip("0"); lat=-90.0; lng=-180.0; res=[20.0,1.0,0.05,0.0025,0.000125]; last=1
    for i in range(0,min(len(c),10)-1,2):
        r=res[i//2]; lat+=A.index(c[i])*r; lng+=A.index(c[i+1])*r; last=r
    return lat+last/2, lng+last/2
def hav(a,b,c,d):
    R=3958.8; p=math.radians
    x=math.sin(p(c-a)/2)**2+math.cos(p(a))*math.cos(p(c))*math.sin(p(d-b)/2)**2
    return 2*R*math.asin(math.sqrt(x))
def sql(q):
    out=subprocess.run([f"{__import__('os').environ['HOME']}/sq.sh"],input=q,capture_output=True,text=True).stdout
    return json.loads(out) if out.strip().startswith('[') else out
def lit(v):
    if v is None or v=='': return 'NULL'
    if isinstance(v,(int,float)): return str(v)
    return "'"+str(v).replace("'","''")+"'"
def d(s):
    try: return datetime.datetime.strptime(s,'%m/%d/%Y').date().isoformat()
    except: return None
def money(s):
    s=(s or '').replace('$','').replace(',','').strip()
    try: return float(s)
    except: return None
mk=sql("select id,name,latitude,longitude from market_research_markets where phase='shortlisted' and state in ('PA','WA','NC') and latitude is not null")
rows=[l.strip() for l in open(sys.argv[1]) if l.strip()]
today=datetime.date.today().isoformat(); vals=[]; seen=set()
for r in rows:
    p=r.split('|')
    if len(p)<13: continue
    loc,loan,pc,lname,lid,prop,mat,orig,cur,obal,deal,dtype,dist=p[:13]
    lid = lid or ("cq-"+loan)
    key=(lid,deal)
    if key in seen: continue
    seen.add(key)
    lat=lng=None; mid=None
    if pc and '+' in pc:
        lat,lng=dec(pc)
        best=min(mk,key=lambda m:hav(lat,lng,float(m['latitude']),float(m['longitude'])))
        if hav(lat,lng,float(best['latitude']),float(best['longitude']))<=3.0: mid=best['id']
    url=f"https://portal.cred-iq.com/l/-/{pc}?l={loc}#section=LocationLoan&subSection=summary&loanId={loan}" if loc else None
    detail=json.dumps({"crediq_loan_pk":loan,"distribution_date":d(dist)})
    vals.append("("+",".join([lit(mid),"'crediq'",lit(lid),lit(loc),lit(url),lit(lname),lit(prop),lit(lat),lit(lng),lit(deal),lit(dtype),lit(d(orig)),lit(d(mat)),lit(money(obal)),lit(money(cur)),lit(detail)+"::jsonb",lit(today)])+")")
print(len(vals),'rows;',sum(1 for v in vals if not v.startswith('(NULL')),'matched to a market')
for i in range(0,len(vals),150):
    q=("insert into market_loans (market_id,source,source_loan_id,source_location_id,source_url,loan_name,property_name,latitude,longitude,deal_name,deal_type,origination_date,maturity_date,original_balance,current_balance,detail,data_as_of) values "
       +",".join(vals[i:i+150])+
       " on conflict (source,source_loan_id,deal_name) do update set market_id=excluded.market_id, source_location_id=excluded.source_location_id, source_url=excluded.source_url, loan_name=excluded.loan_name, property_name=excluded.property_name, latitude=excluded.latitude, longitude=excluded.longitude, deal_type=excluded.deal_type, origination_date=excluded.origination_date, maturity_date=excluded.maturity_date, original_balance=excluded.original_balance, current_balance=excluded.current_balance, detail=market_loans.detail || excluded.detail, data_as_of=excluded.data_as_of, updated_at=now()")
    print(sql(q))
