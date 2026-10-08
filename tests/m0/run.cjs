// G0 seal runner: no downloads, browser automation, expected-value rewrites or Git writes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {root,sha256,read,readJson}=require('./utils.cjs');
const historical=['articulation','articulation-audio','articulation-browser','fidelity','fidelity-audio','fidelity-parameters','fidelity-timing','fidelity-normalization','fidelity-browser','music','rhythm','audio','timing','baseline','legacy','listening','local-bundle','browser-snapshot'];
const m0=['m0-baseline','m0-contract','m0-dataset','m0-acceptance','m0-identity'];
function files(dir){return fs.readdirSync(path.join(root,dir),{withFileTypes:true}).filter(item=>item.name!=='artifacts').flatMap(item=>item.isDirectory()?files(dir+'/'+item.name):[dir+'/'+item.name]);}
const sourcePaths=['.gitattributes',...readJson('tests/baseline/v061-manifest.json').production.map(p=>p.path),...files('tests').filter(p=>p!=='tests/m0-regression-summary.json')];
const sources=()=>[...new Set(sourcePaths)].sort().map(path=>({path,sha256:sha256(read(path))}));
if(process.argv.includes('--verify-evidence')){
  const saved=readJson('tests/m0-regression-summary.json');assert.equal(saved.status,'passed');assert.deepEqual(saved.sources,sources(),'current evidence sources drifted');
  assert.equal(saved.tests.length,23);assert.ok(saved.tests.every(t=>t.status==='passed'&&t.exitCode===0));
  console.log(JSON.stringify({status:'passed',evidenceSourceFiles:saved.sources.length,tests:23,verificationOnly:true}));
}else{
  const before=sources(),startedAtUtc=new Date().toISOString(),tests=[];
  for(const name of [...m0,...historical]){
    const file='tests/'+name+'.test.cjs',start=Date.now(),result=spawnSync(process.execPath,[file],{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024});
    const entry={file,status:result.status===0&&!result.error?'passed':'failed',exitCode:result.status,durationMs:Date.now()-start,stdout:result.stdout||'',stderr:result.stderr||'',error:result.error?.message||null};tests.push(entry);
    process.stderr.write(`${entry.status}: ${file}\n`);
  }
  const after=sources();assert.deepEqual(after,before,'tests must not mutate evidence inputs');
  const frozen=readJson('tests/baseline/v061-manifest.json');for(const p of frozen.production)assert.equal(sha256(read(p.path)),p.sha256,'M0 production freeze: '+p.path);
  const performance=readJson('tests/m0/pixel-baseline-performance.json');assert.equal(performance.contourMeasured,false);assert.equal(performance.protocol.measuredCalls,7200);assert.equal(performance.rows.length,240);
  for(const p of performance.source)assert.equal(sha256(read(p.path)),p.sha256,'benchmark source changed');
  for(const row of performance.rows){assert.equal(row.samplesMs.length,30);assert.ok(row.samplesMs.every(n=>Number.isFinite(n)&&n>=0));}
  const report={schema:'pixelmusic-m0-regression-v1',scope:'M0 B01-B04 only',status:tests.every(t=>t.status==='passed')?'passed':'failed',localDate:'2026-10-08',timezone:'Asia/Shanghai',startedAtUtc,finishedAtUtc:new Date().toISOString(),
    environment:{node:process.version,platform:process.platform,arch:process.arch},tests,sources:after,
    productionFreeze:{files:9,matched:true},dataset:{inputs:120,geometry:24,photos:12,calibration:24,holdout:12},
    benchmark:{path:'tests/m0/pixel-baseline-performance.json',evidenceType:performance.evidenceType,measuredCalls:7200,p95Ms:performance.aggregate.p95Ms,worstCaseP95Ms:performance.worstCaseP95Ms},
    newEvidence:{unitSuites:23,realAudioRenders:0,browserSessions:0,userFileConfirmation:false,contourAlgorithmImplemented:false},
    historicalEvidence:{path:'tests/articulation-regression-summary.json',sha256:sha256(read('tests/articulation-regression-summary.json')),retainedNotRerendered:true},
    gates:{G0:'passed-if-all-listed-tests-passed-and-deliverable-documents-audited',G1:'not-started',G2:'not-started',G3:'not-started',G4:'not-started',G5:'not-started',G6:'not-started'},unresolvedM0Blockers:[]};
  console.log(JSON.stringify(report,null,2));if(report.status!=='passed')process.exitCode=1;
}
