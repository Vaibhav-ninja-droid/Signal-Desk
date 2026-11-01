import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateDataset,filterReports,timeBins,sortReports,buildBrief,matchesSearch} from '../dist/model.js';
const raw=JSON.parse(fs.readFileSync(new URL('../dist/data.json',import.meta.url)));
const dataset=validateDataset(raw);
test('the example has 60 unique chronological reports across five incidents',()=>{
 assert.equal(dataset.reports.length,60);assert.equal(new Set(dataset.reports.map(r=>r.id)).size,60);assert.equal(new Set(dataset.reports.map(r=>r.topic)).size,5);
 assert.ok(dataset.reports.every((r,i)=>!i||Date.parse(r.timestamp)>=Date.parse(dataset.reports[i-1].timestamp)));
});
test('token search requires every word and does not interpret query syntax',()=>{
 const r=dataset.reports.find(r=>r.title==='Crews reach the substation');
 assert.ok(matchesSearch(r,'NORTHBANK substation'));assert.ok(!matchesSearch(r,'substation flooding'));assert.ok(!matchesSearch(r,'substat'));assert.ok(!matchesSearch(r,'substation OR flooding'));
});
test('filters compose and saved-only excludes unbookmarked reports',()=>{
 const r=dataset.reports.find(r=>r.severity==='high');const evidence={[r.id]:{saved:true,note:'inspect'}};
 assert.deepEqual(filterReports(dataset.reports,{savedOnly:true,topic:r.topic,severity:'high'},evidence),[r]);
 assert.equal(filterReports(dataset.reports,{savedOnly:true,severity:'low'},evidence).length,0);
});
test('every report belongs to exactly one time interval, including the last report',()=>{
 const bins=timeBins(dataset.reports);
 for(const r of dataset.reports)assert.equal(bins.filter(b=>Date.parse(r.timestamp)>=b.start&&Date.parse(r.timestamp)<b.end).length,1);
 const first=bins[0];assert.equal(filterReports(dataset.reports,{time:first}).length,5);
});
test('invalid imports fail instead of accepting duplicate IDs, unsafe IDs or severity',()=>{
 for(const patch of [{severity:'urgent'},{id:'<script>'},{timestamp:'2026-01-01'},{timestamp:'2026-02-30T09:00:00Z'},{id:'__proto__'},{severity:['low']}])assert.throws(()=>validateDataset({...raw,reports:[{...raw.reports[0],...patch}]}));
 assert.throws(()=>validateDataset({...raw,reports:[raw.reports[0],raw.reports[0]]}));
 assert.throws(()=>validateDataset({name:'empty',reports:[]}));
});
test('brief exports saved reports across filters and includes notes',()=>{
 const report=dataset.reports[0];const brief=buildBrief(dataset,[],{[report.id]:{saved:true,note:'Trace this report.'}});
 assert.ok(brief.includes(report.title));assert.ok(brief.includes('Trace this report.'));assert.ok(brief.includes('Reports: 1'));
 assert.ok(!brief.includes(dataset.reports[1].title));
});
test('severity sort puts high reports first; chronological sort does not mutate input',()=>{
 const first=dataset.reports[0].id;
 assert.equal(sortReports(dataset.reports,'severity')[0].severity,'high');
 assert.equal(sortReports(dataset.reports,'newest')[0].id,dataset.reports.at(-1).id);
 assert.equal(dataset.reports[0].id,first);
});
