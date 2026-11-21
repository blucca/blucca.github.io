#!/usr/bin/env python3
# Only the already-reviewed CBC LP-only gate patch; companions remain unchanged.
import datetime,json,os,pathlib,resource,shutil,subprocess,time
ROOT=pathlib.Path(__file__).resolve().parent
BASE='87e3a7d5066937c6f16f6e19afac571c8e1a4903'
SOURCE=ROOT/'candidate-src'/('Cbc-'+BASE+'-lp-only-explicit-force')
BUILD=ROOT/'candidate-build'/'Cbc'
PREFIX=ROOT/'candidate-prefix'
for p in [SOURCE.parent,BUILD,PREFIX]:p.mkdir(parents=True,exist_ok=True)
os.sched_setaffinity(0,set(sorted(os.sched_getaffinity(0))[:2]))
resource.setrlimit(resource.RLIMIT_AS,(2*1024**3,2*1024**3))
state={'stage':'START','pid':os.getpid(),'base_cbc_pin':BASE,'patch':str(ROOT/'lp-only-explicit-force.patch'),
       'source':str(SOURCE),'build':str(BUILD),'prefix':str(PREFIX),
       'stock_prefix':str(ROOT/'master-prefix'),'companions':json.loads((ROOT/'companion-pins.json').read_text()),
       'affinity':sorted(os.sched_getaffinity(0)),'make_jobs':2,'compiler_address_limit_bytes':2*1024**3,'commands':[]}
def checkpoint(stage,**extra):
 state.update(stage=stage,at=datetime.datetime.now(datetime.timezone.utc).isoformat(),**extra)
 (ROOT/'candidate-build-state.json').write_text(json.dumps(state,indent=2))
 print(json.dumps({'stage':stage,**extra}),flush=True)
def command(args,cwd,env=None):
 start=time.monotonic();before=resource.getrusage(resource.RUSAGE_CHILDREN)
 entry={'args':list(map(str,args)),'cwd':str(cwd),'started_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat()}
 state['commands'].append(entry);checkpoint('COMMAND',current_command=entry)
 result=subprocess.run(entry['args'],cwd=cwd,env=env)
 after=resource.getrusage(resource.RUSAGE_CHILDREN)
 entry.update(exit_code=result.returncode,wall_seconds=time.monotonic()-start,
              cpu_user_seconds=after.ru_utime-before.ru_utime,cpu_system_seconds=after.ru_stime-before.ru_stime,
              child_max_rss_kib=after.ru_maxrss)
 checkpoint('COMMAND_DONE',current_command=entry)
 if result.returncode:raise RuntimeError('command failed: '+str(entry))
try:
 checkpoint('COPY_STOCK_SOURCE')
 shutil.copytree(ROOT/'master-src'/('Cbc-'+BASE),SOURCE)
 command(['patch','-p1','--batch','--input='+str(ROOT/'lp-only-explicit-force.patch')],SOURCE)
 env=dict(os.environ)
 env.update(CFLAGS='-O2 -DNDEBUG',CXXFLAGS='-O2 -DNDEBUG',PKG_CONFIG_PATH=str(ROOT/'master-prefix/lib/pkgconfig'),
            LD_LIBRARY_PATH=str(PREFIX/'lib')+':'+str(ROOT/'master-prefix/lib'))
 state['build_environment']={k:env[k] for k in ['CFLAGS','CXXFLAGS','PKG_CONFIG_PATH','LD_LIBRARY_PATH']}
 original=json.loads((ROOT/'master-build-state.json').read_text())
 stock_config=next(c['args'] for c in original['commands'] if c['args'][0].endswith('/Cbc-'+BASE+'/configure'))
 flags=[('--prefix='+str(PREFIX)) if f.startswith('--prefix=') else f for f in stock_config[1:]]
 command([str(SOURCE/'configure'),*flags],BUILD,env)
 command(['make','-j2'],BUILD,env)
 command(['make','install'],BUILD,env)
 command([str(PREFIX/'bin/cbc'),'-quit'],ROOT,env)
 with (ROOT/'candidate-ldd.txt').open('w') as log:
  subprocess.run(['ldd',str(PREFIX/'bin/cbc')],env=env,stdout=log,stderr=subprocess.STDOUT,check=True)
 stockenv=dict(os.environ);stockenv['LD_LIBRARY_PATH']=str(ROOT/'master-prefix/lib')
 with (ROOT/'stock-ldd.txt').open('w') as log:
  subprocess.run(['ldd',str(ROOT/'master-prefix/bin/cbc')],env=stockenv,stdout=log,stderr=subprocess.STDOUT,check=True)
 checkpoint('COMPLETE',cbc=str(PREFIX/'bin/cbc'),free_bytes=os.statvfs(ROOT).f_bavail*os.statvfs(ROOT).f_frsize)
except Exception as error:
 checkpoint('FAILED',error_type=type(error).__name__,error=str(error)[:6000])
 raise
