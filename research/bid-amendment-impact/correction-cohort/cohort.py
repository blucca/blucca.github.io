#!/usr/bin/env python3
"""Reproducible official-data research; standard library only. UTC date bounds.
Fetch the complete Find a Tender API cursor chain, then classify explicit F14 changes.
Raw response bytes, response metadata and output hashes remain alongside this script.
"""
import argparse, collections, csv, datetime as dt, hashlib, html, json, re, time
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from urllib.parse import urlencode, urljoin, urlparse

ROOT = Path(__file__).resolve().parent
START='2024-11-04T00:00:00Z'
END='2024-11-11T00:00:00Z'
BASE='https://www.find-tender.service.gov.uk'
API=BASE+'/api/1.0/ocdsReleasePackages'
SOURCES=[]
OFFLINE=False
RATE_BLOCKED=False

def save_json(p,d): p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
def sha(b): return hashlib.sha256(b).hexdigest()
def fetch(url,path):
    global RATE_BLOCKED
    meta_path=path.with_suffix(path.suffix+'.meta.json')
    if path.exists() and meta_path.exists():
        b=path.read_bytes(); meta=json.loads(meta_path.read_text())
        SOURCES.append(meta); return b
    error_path=path.with_suffix('.error.json')
    if OFFLINE:
        if error_path.exists():
            raise RuntimeError(json.loads(error_path.read_text())['error'])
        raise FileNotFoundError('Offline cache missing: '+str(path.relative_to(ROOT)))
    if RATE_BLOCKED:
        raise RuntimeError('Collection stopped after server rate-limit response; resume after its Retry-After interval')
    path.parent.mkdir(parents=True,exist_ok=True)
    for attempt in range(3):
        try:
            with urlopen(Request(url,headers={'User-Agent':'BluccaResearch/1.0 (+https://blucca.github.io/research/bid-amendment-impact/)','Accept':'application/json' if '/api/' in url else 'text/html'}),timeout=35) as r:
                b=r.read(); status=r.status; headers=dict(r.headers); final=r.url
            meta={'url':url,'final_url':final,'retrieved_at':dt.datetime.now(dt.timezone.utc).isoformat(),'status':status,'content_type':headers.get('Content-Type'),'bytes':len(b),'sha256':sha(b),'file':str(path.relative_to(ROOT))}
            path.write_bytes(b); save_json(meta_path,meta);SOURCES.append(meta);return b
        except HTTPError as e:
            save_json(error_path,{'url':url,'status':e.code,'error':str(e),'retry_after':e.headers.get('Retry-After'),'recorded_at':dt.datetime.now(dt.timezone.utc).isoformat()})
            if e.code in (429,503):RATE_BLOCKED=True
            raise

def text_html(b):
    s=re.sub(r'<script\b[^>]*>.*?</script>|<style\b[^>]*>.*?</style>','',b.decode(),flags=re.S)
    s=html.unescape(re.sub('<[^>]+>','\n',s))
    return '\n'.join(x.strip() for x in s.splitlines() if x.strip())

def changes(obj,path=''):
    out=[]
    if isinstance(obj,dict):
        for k,v in obj.items():
            p=path+'/'+k.replace('~','~0').replace('/','~1')
            if k=='unstructuredChanges' and isinstance(v,list):
                out.extend({'pointer':p+'/'+str(i),'change':c} for i,c in enumerate(v))
            else: out.extend(changes(v,p))
    elif isinstance(obj,list):
        for i,v in enumerate(obj):out.extend(changes(v,path+'/'+str(i)))
    return out

def enumerate_api():
    # API documentation describes updatedFrom/updatedTo as last-update bounds,
    # and uses timestamps without a timezone suffix. Explicit output scope is UTC.
    url=API+'?'+urlencode({'updatedFrom':START[:-1],'updatedTo':'2024-11-10T23:59:59','limit':100})
    all_records=[]; seen_urls=set(); pages=[]
    for n in range(1,101):
        if url in seen_urls:raise ValueError('Cursor loop')
        seen_urls.add(url)
        b=fetch(url,ROOT/'api'/f'page-{n:03d}.json');d=json.loads(b)
        records=d['releases'];all_records.extend(records)
        next_url=d.get('links',{}).get('next')
        pages.append({'page':n,'url':url,'count':len(records),'next':next_url,'first_id':records[0]['id'] if records else None,'last_id':records[-1]['id'] if records else None})
        print('API page',n,'records',len(records),'total',len(all_records),flush=True)
        if not next_url:break
        if urlparse(next_url).netloc!='www.find-tender.service.gov.uk':raise ValueError('Unexpected next host')
        url=next_url
    else:raise ValueError('Page cap reached')
    unique={};duplicate=[]
    for i,r in enumerate(all_records):
        key=(r['ocid'],r['id'])
        if key in unique:
            duplicate.append({'ocid':key[0],'id':key[1],'identical':r==unique[key]})
        else:unique[key]=r
    records=list(unique.values())
    candidates=[r for r in records if changes(r) or any(t.endswith('Update') for t in r.get('tag',[]))]
    summary={'start_inclusive_utc':START,'end_exclusive_utc':END,'api_parameters':{'updatedFrom':START[:-1],'updatedTo':'2024-11-10T23:59:59','limit':100},'date_parameter_meaning':'Earliest/latest date and time record was last updated (official API documentation)','pages':pages,'terminal_next_absent':True,'raw_record_count':len(all_records),'unique_ocid_release_id_count':len(records),'duplicates':duplicate,'tag_counts':dict(collections.Counter(','.join(r['tag']) for r in records)),'release_date_outside_week':[{'ocid':r['ocid'],'id':r['id'],'date':r['date']} for r in records if not START<=r['date']<END],'correction_candidate_count':len(candidates)}
    save_json(ROOT/'api-enumeration.json',summary);save_json(ROOT/'api-releases.json',records);save_json(ROOT/'correction-candidates.json',candidates)
    save_json(ROOT/'source-manifest.json',SOURCES)
    print(json.dumps({k:v for k,v in summary.items() if k!='pages'},indent=2))
    return records,candidates


def classify_one(r):
    url=BASE+'/Notice/'+r['id']+'?origin=SearchResults'
    row={'ocid':r['ocid'],'notice_id':r['id'],'release_date':r['date'],'title':r.get('tender',{}).get('title',''),'buyer':r.get('buyer',{}).get('name',''),'tags':r['tag'],'notice_url':BASE+'/Notice/'+r['id'],'retrieval_url':url,'changes':changes(r)}
    try:
        b=fetch(url,ROOT/'notices'/(r['id']+'.html'))
        txt=text_html(b);(ROOT/'notices'/(r['id']+'.txt')).write_text(txt+'\n')
        lines=txt.splitlines()
        form=next((x for x in lines if re.match(r'^F\d{2}:',x)),None)
        published=next((x for x in lines if x.startswith('Published ')),None)
        row.update(form_label=form,published_label=published,notice_fetch_status='success',is_f14=form.startswith('F14:') if form else None)
        if published:
            normalized=re.sub(r'\s+',' ',published.removeprefix('Published '))
            try:
                stamp=dt.datetime.strptime(normalized,'%d %B %Y, %I:%M%p').replace(tzinfo=dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:00Z')
                row['published_utc_minute']=stamp;row['published_within_target_week']=START<=stamp<END
            except ValueError:row['published_parse_error']=normalized
    except Exception as e:
        row.update(notice_fetch_status='error',notice_fetch_error=str(e),is_f14=None)
    sections=set(); effective_sections=set(); date_changes=[]; finance_changes=[]; technical_changes=[]; unknown=[]
    for e in row['changes']:
        c=e['change'];section=re.sub(r'\s+','',str(c.get('where',{}).get('section',''))).rstrip('.')
        e['normalized_section']=section;e['has_old_and_new']='oldValue' in c and 'newValue' in c
        e['old_new_different']=e['has_old_and_new'] and c['oldValue']!=c['newValue']
        if section:sections.add(section)
        else:unknown.append(e['pointer'])
        if section and e['old_new_different']:effective_sections.add(section)
        if section=='IV.2.2' and c.get('oldValue',{}).get('date') and c.get('newValue',{}).get('date') and c['oldValue']['date'] != c['newValue']['date']:
            date_changes.append(e['pointer'])
        if section=='III.1.2' and e['old_new_different']:finance_changes.append(e['pointer'])
        if section=='III.1.3' and e['old_new_different']:technical_changes.append(e['pointer'])
    row.update(explicit_sections=sorted(sections),effective_sections=sorted(effective_sections),reported_change_count=len(row['changes']),effective_change_count=sum(e['old_new_different'] for e in row['changes']),multi_section=len(sections)>=2,multi_effective_section=len(effective_sections)>=2,receipt_deadline_date_change=bool(date_changes),finance_section_change=bool(finance_changes),technical_section_change=bool(technical_changes),deadline_and_finance_or_technical=bool(date_changes and (finance_changes or technical_changes)),deadline_and_both_finance_and_technical=bool(date_changes and finance_changes and technical_changes),deadline_change_pointers=date_changes,finance_change_pointers=finance_changes,technical_change_pointers=technical_changes,changes_without_section=unknown)
    return row

def classify(records,candidates):
    rows=[]
    for r in candidates:
        rows.append(classify_one(r))
        if not OFFLINE:time.sleep(0.25)
    rows.sort(key=lambda x:x['notice_id'])
    f14=[x for x in rows if x['is_f14'] is True]
    counters={name:sum(bool(x[name]) for x in f14) for name in ['multi_section','multi_effective_section','receipt_deadline_date_change','finance_section_change','technical_section_change','deadline_and_finance_or_technical','deadline_and_both_finance_and_technical']}
    result={'name':'Find a Tender fixed API-window retrieval sample','target_start_inclusive_utc':START,'target_end_exclusive_utc':END,'classification_denominator':'Unique (ocid, release.id) candidates in the complete recorded API links.next chain whose official notice HTML identifies form F14','candidate_rule':'Any non-empty recursively located unstructuredChanges array or release tag ending in Update; official F14 label then determines inclusion. Other API releases remain available in api-releases.json.','api_unique_releases':len(records),'candidate_count':len(rows),'verified_f14_count':len(f14),'non_f14_candidates':[{'notice_id':r['notice_id'],'form_label':r.get('form_label')} for r in rows if r['is_f14'] is False],'unresolved_candidates':[{'notice_id':r['notice_id'],'error':r.get('notice_fetch_error'),'form_label':r.get('form_label')} for r in rows if r['is_f14'] is None or (r.get('notice_fetch_status')=='success' and not r.get('form_label'))],'counts':counters,'f14_unique_ocids':len(set(x['ocid'] for x in f14)),'f14_notice_ids':[x['notice_id'] for x in f14],'multi_section_notice_ids':[x['notice_id'] for x in f14 if x['multi_section']],'deadline_and_finance_or_technical_notice_ids':[x['notice_id'] for x in f14 if x['deadline_and_finance_or_technical']],'deadline_and_both_notice_ids':[x['notice_id'] for x in f14 if x['deadline_and_both_finance_and_technical']],'f14_without_structured_changes':[x['notice_id'] for x in f14 if not x['changes']],'f14_without_all_old_new':[x['notice_id'] for x in f14 if any(not c['has_old_and_new'] for c in x['changes'])],'f14_without_section':[x['notice_id'] for x in f14 if x['changes_without_section']],'f14_publication_outside_week':[x['notice_id'] for x in f14 if x.get('published_within_target_week') is False],'f14_publication_unparsed':[x['notice_id'] for x in f14 if 'published_within_target_week' not in x],'definitions':{'multi_section':'At least two distinct explicit where.section values in unstructuredChanges, whitespace removed and terminal dot removed.','multi_effective_section':'At least two such sections have both oldValue and newValue present and unequal as JSON values.','receipt_deadline_date_change':'IV.2.2 with explicit oldValue.date and newValue.date, both present and different.','finance_section_change':'III.1.2 with both oldValue and newValue present and different. Raw labels remain in evidence.','technical_section_change':'III.1.3 with both oldValue and newValue present and different. Raw labels remain in evidence.','count_unit':'One unique official F14 notice; multiple changes in one section count once for section incidence; repeated API deliveries are deduplicated.'}}
    save_json(ROOT/'classified-candidates.json',rows);save_json(ROOT/'f14-cohort.json',f14);save_json(ROOT/'results.json',result)
    fields=['notice_id','ocid','title','buyer','form_label','release_date','published_label','published_utc_minute','explicit_sections','effective_sections','reported_change_count','multi_section','multi_effective_section','receipt_deadline_date_change','finance_section_change','technical_section_change','deadline_and_finance_or_technical','deadline_and_both_finance_and_technical','notice_url']
    with (ROOT/'f14-cohort.csv').open('w',newline='') as f:
        w=csv.DictWriter(f,fieldnames=fields);w.writeheader()
        for r in f14:w.writerow({k:(';'.join(r[k]) if isinstance(r.get(k),list) else r.get(k,'')) for k in fields})
    save_json(ROOT/'source-manifest.json',sorted(SOURCES,key=lambda x:x['file']))
    print(json.dumps(result,ensure_ascii=False,indent=2),flush=True)
    return result

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline', action='store_true', help='Recompute from saved official bytes; perform zero network calls')
    args=parser.parse_args(); OFFLINE=args.offline
    docs=BASE+'/apidocumentation/1.0/GET-ocdsReleasePackages'
    b=fetch(docs,ROOT/'sources'/'ocds-api-documentation.html')
    (ROOT/'sources'/'ocds-api-documentation.txt').write_text(text_html(b)+'\n')
    records,candidates=enumerate_api()
    classify(records,candidates)
