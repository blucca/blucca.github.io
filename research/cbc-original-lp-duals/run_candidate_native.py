#!/usr/bin/env python3
# Two candidate LP cases plus the one-variable integer BAB path control.
import datetime,json,os,pathlib,resource,subprocess,time,traceback
import pulp as lp
from run_mre import run_case,ROOT

def stage(value,**extra):
 data={'stage':value,'pid':os.getpid(),'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),**extra}
 (ROOT/'candidate-native-stage.json').write_text(json.dumps(data,indent=2));print(json.dumps(data),flush=True)

def tiny_bab(name,cbc):
 directory=ROOT/'native-results'/name;directory.mkdir(parents=True,exist_ok=True)
 modelo=lp.LpProblem('Tiny_Integer_BAB',lp.LpMinimize)
 x=modelo.add_variable_dicts('x',[0],lowBound=0,cat=lp.LpInteger)[0]
 modelo+=x;modelo+=x>=1.2
 solver=lp.COIN_CMD(path=str(cbc),msg=False,mip=True,keepFiles=True,logPath=str(directory/'cbc.log'))
 rec={'case':name,'cbc_path':str(cbc),'pulp_version':lp.__version__,
      'model':'min x; x >= 1.2; x integer >= 0','expected_x':2,'expected_objective':2,
      'scope':'BAB primal/integrality control only; integer-model dual contract not evaluated',
      'cwd':str(directory),'native_commands':[],'started_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat()}
 original=subprocess.Popen;children=[]
 def capture(args,*p_args,**p_kwargs):
  rec['native_commands'].append(list(map(str,args)))
  child=original(args,*p_args,**p_kwargs);children.append(child);return child
 oldcwd=os.getcwd();before=resource.getrusage(resource.RUSAGE_CHILDREN);start=time.perf_counter()
 try:
  os.chdir(directory);modelo.writeLP('original-model.lp');subprocess.Popen=capture
  status=modelo.solve(solver);value=lp.value(x);objective=lp.value(modelo.objective)
  rec.update(solve_return=str(status),x=value,objective=objective,
             expected_primal_and_integer_pass=abs(value-2)<=1e-6 and abs(objective-2)<=1e-6)
 except Exception as error:
  rec.update(error_type=type(error).__name__,error=str(error),traceback=traceback.format_exc())
 finally:
  subprocess.Popen=original;os.chdir(oldcwd);after=resource.getrusage(resource.RUSAGE_CHILDREN)
  rec.update(native_exit_codes=[c.returncode for c in children],wall_seconds=time.perf_counter()-start,
             cpu_user_seconds=after.ru_utime-before.ru_utime,cpu_system_seconds=after.ru_stime-before.ru_stime,
             completed_at_utc=datetime.datetime.now(datetime.timezone.utc).isoformat())
  (directory/'result.json').write_text(json.dumps(rec,indent=2)+'\n');print(json.dumps(rec,indent=2),flush=True)
 return rec

stage('RUN_OLD_AND_STOCK_TINY_BAB')
results=[]
os.environ['LD_LIBRARY_PATH']=str(ROOT/'master-prefix/lib')
results.append(tiny_bab('bab-oneinteger-old-release',ROOT/'official-release/bin/cbc'))
results.append(tiny_bab('bab-oneinteger-stock-master',ROOT/'master-prefix/bin/cbc'))
stage('WAIT_CANDIDATE_BUILD')
end=time.monotonic()+1200
while time.monotonic()<end:
 state=json.loads((ROOT/'candidate-build-state.json').read_text())
 if state['stage']=='FAILED':stage('STOP_BUILD_FAILED',error=state.get('error'));raise SystemExit(1)
 if state['stage']=='COMPLETE':break
 time.sleep(15)
else:stage('STOP_BUILD_WAIT_EXPIRED');raise SystemExit(1)
os.environ['LD_LIBRARY_PATH']=str(ROOT/'candidate-prefix/lib')+':'+str(ROOT/'master-prefix/lib')
cbc=ROOT/'candidate-prefix/bin/cbc'
stage('RUN_CANDIDATE_ORIGINAL_LP_AND_RHS_PLUS_ONE')
results.append(run_case('candidate-lp-only-default',cbc))
results.append(run_case('candidate-lp-only-default-rhs0-plus-one',cbc,311))
results.append(tiny_bab('bab-oneinteger-candidate-lp-only',cbc))
(ROOT/'native-results/summary-candidate.json').write_text(json.dumps(results,indent=2)+'\n')
passed=all('error' not in r and all(c==0 for c in r['native_exit_codes']) and
           (r.get('expected_primal_and_integer_pass',False) or r.get('original_model_checks',{}).get('full_original_dual_contract_ok',False)) for r in results)
stage('COMPLETE' if passed else 'FAILED',all_expected_controls_pass=passed)
raise SystemExit(0 if passed else 1)
