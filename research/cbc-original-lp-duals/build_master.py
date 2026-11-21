#!/usr/bin/env python3
# Exactly Cbc #861 current-master executable and its four required companions.
import datetime,json,os,pathlib,resource,subprocess,sys,tarfile,time,urllib.request
ROOT=pathlib.Path(__file__).resolve().parent
PREFIX=ROOT/'master-prefix'
SOURCES=ROOT/'master-src'
BUILDS=ROOT/'master-build'
ARCHIVES=ROOT/'master-archives'
for directory in [PREFIX,SOURCES,BUILDS,ARCHIVES]:directory.mkdir(exist_ok=True)
allowed=sorted(os.sched_getaffinity(0));os.sched_setaffinity(0,set(allowed[:2]))
# At most two compilers; each gets a 2 GiB virtual address-space limit.
resource.setrlimit(resource.RLIMIT_AS,(2*1024**3,2*1024**3))
previous=json.loads((ROOT/'master-build-state.json').read_text()) if (ROOT/'master-build-state.json').exists() else {}
state={'stage':'RESUME','pid':os.getpid(),'affinity':allowed[:2],'compiler_address_limit_bytes':2*1024**3,'make_jobs':2,'commands':previous.get('commands',[]),'pins':json.loads((ROOT/'companion-pins.json').read_text()),'archives':previous.get('archives',{})}
def checkpoint(stage,**extra):
 state.update(stage=stage,at=datetime.datetime.now(datetime.timezone.utc).isoformat(),**extra)
 (ROOT/'master-build-state.json').write_text(json.dumps(state,indent=2))
 print(json.dumps({'stage':stage,**extra}),flush=True)
def command(args,cwd,env=None):
 start=time.monotonic();entry={'args':list(map(str,args)),'cwd':str(cwd),'started_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat()}
 state['commands'].append(entry);checkpoint('COMMAND',current_command=entry)
 before=resource.getrusage(resource.RUSAGE_CHILDREN)
 result=subprocess.run(entry['args'],cwd=cwd,env=env,check=False)
 after=resource.getrusage(resource.RUSAGE_CHILDREN)
 entry.update(exit_code=result.returncode,wall_seconds=time.monotonic()-start,cpu_user_seconds=after.ru_utime-before.ru_utime,cpu_system_seconds=after.ru_stime-before.ru_stime,child_max_rss_kib=after.ru_maxrss)
 checkpoint('COMMAND_DONE',current_command=entry)
 if result.returncode:raise RuntimeError('command failed: '+str(entry))
 return result
try:
 for repo in ['CoinUtils','Osi','Clp','Cgl']:
  if repo in state['pins']:continue
  checkpoint('PIN',repo=repo)
  pin=subprocess.check_output(['git','ls-remote','https://github.com/coin-or/'+repo+'.git','refs/heads/master'],text=True).split()[0]
  state['pins'][repo]=pin
 state['pins']['Cbc']='87e3a7d5066937c6f16f6e19afac571c8e1a4903'
 (ROOT/'companion-pins.json').write_text(json.dumps(state['pins'],indent=2))
 env=dict(os.environ)
 env.update(CFLAGS='-O2 -DNDEBUG',CXXFLAGS='-O2 -DNDEBUG',PKG_CONFIG_PATH=str(PREFIX/'lib/pkgconfig'),LD_LIBRARY_PATH=str(PREFIX/'lib'),COIN_SKIP_PROJECTS='Data/Sample Data/miplib3 ThirdParty/ASL ThirdParty/Glpk ThirdParty/Mumps ThirdParty/NaUTy')
 state['build_environment']={k:env[k] for k in ['CFLAGS','CXXFLAGS','PKG_CONFIG_PATH','LD_LIBRARY_PATH','COIN_SKIP_PROJECTS']}
 for repo,pin in state['pins'].items():
  checkpoint('SOURCE_DOWNLOAD',repo=repo,pin=pin)
  archive=ARCHIVES/(repo+'-'+pin+'.tar.gz')
  url='https://codeload.github.com/coin-or/'+repo+'/tar.gz/'+pin
  if not archive.exists():urllib.request.urlretrieve(url,archive)
  state.setdefault('archives',{})[repo]={'url':url,'path':str(archive),'bytes':archive.stat().st_size}
  source=SOURCES/(repo+'-'+pin)
  if not source.exists():
   with tarfile.open(archive,'r:gz') as f:f.extractall(SOURCES,filter='data')
  build=BUILDS/repo;build.mkdir(exist_ok=True)
  checkpoint('CONFIGURE',repo=repo,pin=pin)
  helptext=subprocess.check_output([str(source/'configure'),'--help'],cwd=build,text=True)
  (build/'configure-help.txt').write_text(helptext)
  flags=['--prefix='+str(PREFIX),'--disable-static','--enable-shared']
  for optional in ['asl','glpk','mumps','nauty','sample','miplib','lapack','blas']:
   if '--with-'+optional in helptext or '--without-'+optional in helptext:flags.append('--without-'+optional)
  if not (build/'config.status').exists():command([str(source/'configure'),*flags],build,env)
  checkpoint('MAKE',repo=repo,pin=pin)
  command(['make','-j2'],build,env)
  checkpoint('INSTALL',repo=repo,pin=pin)
  command(['make','install'],build,env)
  checkpoint('PROJECT_DONE',repo=repo,pin=pin,free_bytes=os.statvfs(ROOT).f_bavail*os.statvfs(ROOT).f_frsize)
 checkpoint('VERIFY_CBC')
 command([str(PREFIX/'bin/cbc'),'-quit'],ROOT,env)
 checkpoint('COMPLETE',cbc=str(PREFIX/'bin/cbc'))
except Exception as error:
 checkpoint('FAILED',error_type=type(error).__name__,error=str(error)[:6000])
 raise
