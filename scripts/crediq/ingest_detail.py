import json, subprocess, os, datetime, re
KEY=re.search(r"SUPABASE_KEY = '([^']+)", open(os.environ.get('FMC_CONFIG', os.environ['HOME']+'/mnt/first-mile-claude/config.js')).read()).group(1)
def sql(q):
    out=subprocess.run([os.environ['HOME']+"/sq.sh"],input=q,capture_output=True,text=True).stdout
    return out
import urllib.request
req=urllib.request.Request("https://qrtleqasnhbnruodlgpt.supabase.co/rest/v1/crediq_raw?select=line&kind=eq.loan_detail&limit=5000",headers={"apikey":KEY,"Authorization":"Bearer "+KEY})
rows=[json.loads(r['line']) for r in json.load(urllib.request.urlopen(req))]
def nz(v): return None if v in (None,'','-','—','N/A') else v
def num(v):
    v=nz(v)
    if v is None: return None
    v=re.sub(r'[^0-9.\-]','',v)
    try: return float(v)
    except: return None
def dt(v):
    v=nz(v)
    try: return datetime.datetime.strptime(v,'%m/%d/%Y').date().isoformat()
    except: return None
def yn(v):
    v=nz(v); return None if v is None else v.lower().startswith('y')
def lit(v):
    if v is None: return 'NULL'
    if isinstance(v,bool): return 'true' if v else 'false'
    if isinstance(v,(int,float)): return repr(v)
    return "'"+str(v).replace("'","''")+"'"
n=0
stmts=[]
for d in rows:
    yr=nz(d.get('yr')) or ''
    ys=[int(x) for x in re.findall(r'\d{4}',yr)]
    size=nz(d.get('size')) or ''
    unit=None
    m=re.match(r'([\d,\.]+)\s*(\w+)?',size)
    bsize=num(m.group(1)) if m else None
    unit=(m.group(2) if m else None)
    # latest financial NOI / DSCR from the fin string: "Date ~ d1 ~ d2 ~ Revenue ~ ... ~ NOI ~ a ~ b ~ ... ~ DSCR NCF ~ x ~ y"
    fin=(d.get('fin') or '').split(' ~ ')
    def last_of(label):
        try:
            i=fin.index(label); dates=fin.index('Revenue')-1
            vals=fin[i+1:i+1+dates]; vals=[v for v in vals if nz(v)]
            return vals[-1] if vals else None
        except: return None
    dates=[]
    try: dates=fin[1:fin.index('Revenue')]
    except: pass
    upd={
      'originator':nz(d.get('originator')),'mortgage_rate':num(d.get('rate')),'rate_type':nz(d.get('rate_type')),
      'amortization':nz(d.get('amortization')),'io_periods':int(num(d.get('io_periods'))) if num(d.get('io_periods')) is not None else None,
      'prepay_desc':nz(d.get('prepay')),'lockout_end_date':dt(d.get('lockout_end')),'payment_status':nz(d.get('payment_status')),
      'watchlist':yn(d.get('watchlist')),'watchlist_reason':nz(d.get('wl_reason')),'special_serviced':yn(d.get('special_serviced')),
      'ss_transfer_date':dt(d.get('ss_date')),'ss_reason':nz(d.get('ss_reason')),'workout_strategy':nz(d.get('workout')),'modified':yn(d.get('modified')),
      'property_type':nz(d.get('prop_type')),'property_subtype':nz(d.get('prop_sub')),'year_built':ys[0] if ys else None,'year_renovated':ys[1] if len(ys)>1 else None,
      'building_size':bsize,'size_unit':unit,'address':', '.join(x for x in [nz(d.get('address')),nz(d.get('address2'))] if x) or None,
      'appraisal_date':dt(d.get('appr_date')),'appraised_value':num(d.get('appr_val')),'uw_noi':num(d.get('uw_noi')),'uw_ncf':num(d.get('uw_ncf')),
      'ltv':num(d.get('ltv')),'debt_yield':num(d.get('dy')),'master_servicer':nz(d.get('master')),'special_servicer':nz(d.get('special')),
      'borrower':nz(d.get('borrower')),'sponsor':nz(d.get('sponsor')),'whole_loan_balance':num(d.get('whole')),
      'latest_noi':num(last_of('NOI')),'latest_dscr':num(last_of('DSCR NCF')) or num(last_of('DSCR NOI')),
      'financials_as_of':dt(dates[-1]) if dates else None,
      'servicer_commentary':nz(d.get('commentary')) if d.get('commentary') and 'No recent commentary' not in d.get('commentary') else None,
    }
    sets=", ".join(f"{k}={lit(v)}" for k,v in upd.items())
    extra=json.dumps({'defeasance':nz(d.get('defeasance')),'term_months':nz(d.get('term')),'wl_added':nz(d.get('wl_added')),'financials_raw':d.get('fin'),'crediq_updated':nz(d.get('updated'))})
    stmts.append(f"update market_loans set {sets}, detail = coalesce(detail,'{{}}'::jsonb) || {lit(extra)}::jsonb, updated_at=now() where source='crediq' and detail->>'crediq_loan_pk'={lit(d['loan_pk'])}")
for i in range(0,len(stmts),20):
    r=sql("; ".join(stmts[i:i+20])); n+=1
    if 'success' not in r: print(r[:300])
print(len(rows),'detail rows applied')
