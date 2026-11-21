#!/usr/bin/env python3
# Cbc issue 861 only: author's five-row / six-column continuous RMP.
import datetime,json,os,pathlib,resource,subprocess,sys,time,traceback
import pulp as lp
ROOT=pathlib.Path(__file__).resolve().parent
A=[[2,0,0,0,0,0],[0,2,0,0,0,0],[0,0,3,0,0,0],[0,0,0,7,0,2],[0,0,0,0,10,0]]
B=[310,120,45,32,103]
TOL=1e-6
EXPECTED_PI=[.5,.5,1/3,1/7,.1]
EXPECTED_DJ=[0,0,0,0,0,5/7]

def run_case(name,cbc,rhs0=310,presolve=None,options=None):
 directory=ROOT/'native-results'/name;directory.mkdir(parents=True,exist_ok=True)
 b=[rhs0,*B[1:]]
 # The original PuLP 4.x APIs, variable bounds and matrix are unchanged.
 modelo=lp.LpProblem('Problema_Maestro',lp.LpMinimize)
 x=modelo.add_variable_dicts('x_i',list(range(6)),lowBound=0,cat=lp.LpContinuous)
 modelo+=lp.lpSum(x[i] for i in range(6))
 for j in range(5):modelo+=lp.lpSum(A[j][i]*x[i] for i in range(6))>=b[j]
 solver=lp.COIN_CMD(path=str(cbc),msg=False,mip=False,keepFiles=True,
                    logPath=str(directory/'cbc.log'),presolve=presolve,options=options or [])
 rec={'case':name,'source':'https://github.com/coin-or/Cbc/issues/861',
      'cbc_path':str(cbc),
      'python_version':sys.version,'pulp_version':lp.__version__,'pulp_source':lp.__file__,
      'started_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
      'A':A,'b':b,'c':[1]*6,'lower_bounds':[0]*6,'upper_bounds':[None]*6,
      'row_senses':['>=']*5,'category':'Continuous',
      'api':'LpProblem.add_variable_dicts + COIN_CMD(mip=False)',
      'solver_options':{'presolve':presolve,'options':options or [],'keepFiles':True,'msg':False},
      'cwd':str(directory),'tolerance':TOL,'native_commands':[]}
 original_popen=subprocess.Popen;children=[]
 def capture_popen(args,*p_args,**p_kwargs):
  rec['native_commands'].append(list(map(str,args)))
  child=original_popen(args,*p_args,**p_kwargs);children.append(child);return child
 cwd=os.getcwd();start=time.perf_counter();before=resource.getrusage(resource.RUSAGE_CHILDREN)
 try:
  os.chdir(directory)
  modelo.writeLP('original-model.lp')
  subprocess.Popen=capture_popen
  status=modelo.solve(solver)
  rec['solve_return']=str(status)
  values=[lp.value(x[i]) for i in range(6)]
  pi=[c.pi for c in modelo.constraints()];dj=[x[i].dj for i in range(6)]
  rec.update(objective=lp.value(modelo.objective),x=values,pi=pi,dj=dj,
             row_names=[c.name for c in modelo.constraints()],column_names=[x[i].name for i in range(6)],
             pulp_reported_slack=[c.slack for c in modelo.constraints()])
  activity=[sum(A[i][j]*values[j] for j in range(6)) for i in range(5)]
  slack=[activity[i]-b[i] for i in range(5)]
  reduced_from_pi=[1-sum(A[i][j]*pi[i] for i in range(5)) for j in range(6)]
  stationarity=[reduced_from_pi[j]-dj[j] for j in range(6)]
  row_comp=[pi[i]*slack[i] for i in range(5)]
  var_comp=[values[j]*dj[j] for j in range(6)]
  gap=sum(values)-sum(b[i]*pi[i] for i in range(5))
  expected_x=[rhs0/2,60,15,32/7,103/10,0]
  expected_obj=sum(expected_x)
  kkt={'activity':activity,'coverage_slack_Ax_minus_b':slack,
       'reduced_cost_c_minus_AT_pi':reduced_from_pi,'stationarity_c_minus_AT_pi_minus_dj':stationarity,
       'row_complementarity_pi_times_slack':row_comp,'variable_complementarity_x_times_dj':var_comp,
       'primal_objective_sum_x':sum(values),'dual_objective_bT_pi':sum(b[i]*pi[i] for i in range(5)),
       'primal_dual_gap':gap,'gap_decomposition':sum(row_comp)+sum(var_comp),
       'primal_feasible':min(values+slack)>=-TOL,'dual_feasible':min(pi+reduced_from_pi+dj)>=-TOL,
       'stationarity_ok':max(map(abs,stationarity))<=TOL,
       'row_complementarity_ok':max(map(abs,row_comp))<=TOL,
       'variable_complementarity_ok':max(map(abs,var_comp))<=TOL,'gap_ok':abs(gap)<=TOL,
       'expected_x_error':max(abs(values[i]-expected_x[i]) for i in range(6)),
       'expected_pi_error':max(abs(pi[i]-EXPECTED_PI[i]) for i in range(5)),
       'expected_dj_error':max(abs(dj[i]-EXPECTED_DJ[i]) for i in range(6)),
       'expected_objective':expected_obj,'expected_objective_error':abs(rec['objective']-expected_obj)}
  kkt['full_original_dual_contract_ok']=all(kkt[k] for k in ['primal_feasible','dual_feasible','stationarity_ok','row_complementarity_ok','variable_complementarity_ok','gap_ok'])
  rec['original_model_checks']=kkt
 except Exception as e:
  rec.update(error_type=type(e).__name__,error=str(e),traceback=traceback.format_exc())
 finally:
  subprocess.Popen=original_popen;os.chdir(cwd)
  after=resource.getrusage(resource.RUSAGE_CHILDREN)
  rec.update(wall_seconds=time.perf_counter()-start,cpu_user_seconds=after.ru_utime-before.ru_utime,
             cpu_system_seconds=after.ru_stime-before.ru_stime,native_exit_codes=[c.returncode for c in children],
             completed_at_utc=datetime.datetime.now(datetime.timezone.utc).isoformat())
  (directory/'result.json').write_text(json.dumps(rec,indent=2)+'\n')
  print(json.dumps({k:rec.get(k) for k in ['case','solve_return','objective','x','pi','dj','native_exit_codes','original_model_checks','error','wall_seconds']},indent=2),flush=True)
 return rec

if __name__=='__main__':
 group=sys.argv[1]
 if group=='old':
  cases=[('old-release-default',pathlib.Path(sys.argv[2]).resolve(),310,None,[])]
 elif group=='master':
  cbc=pathlib.Path(sys.argv[2]).resolve()
  off=['boundPropLevel off','singletonBounds off']
  cases=[('master-default',cbc,310,None,[]),
         ('master-author-presolve-off-preprocess-off',cbc,310,False,['preprocess off']),
         ('master-bound-propagation-and-singleton-off',cbc,310,None,off),
         ('master-default-rhs0-plus-one',cbc,311,None,[]),
         ('master-bounds-off-rhs0-plus-one',cbc,311,None,off)]
 else:raise SystemExit('Only old or master groups are defined for #861')
 summary=[run_case(*case) for case in cases]
 destination=ROOT/'native-results'/('summary-'+group+'.json')
 destination.write_text(json.dumps(summary,indent=2)+'\n')
 if any('error' in r or any(code!=0 for code in r['native_exit_codes']) for r in summary):raise SystemExit(1)
