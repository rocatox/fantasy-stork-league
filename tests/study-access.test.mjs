import test from 'node:test';
import assert from 'node:assert/strict';
import {expectedStudyLicense} from '../lib/study-access.mjs';
import {readFileSync} from 'node:fs';
import {STUDY_IDS} from '../lib/operational-policy.mjs';
const seed=JSON.parse(readFileSync(new URL('../data/seed.json',import.meta.url)));
test('Saintonge collaborator access is scoped and citation preserved verbatim',()=>{
 const study=seed.studies.find(s=>s.studyId==='247772625');
 assert.equal(expectedStudyLicense(study),'CUSTOM');
 assert.equal(study.attribution,'Musseau, R. & Barbraud, C. – CIGOGNES DE SAINTONGE – ID_PROG 493 (Movebank study ID: 247772625).');
 assert.throws(()=>expectedStudyLicense({...study,studyId:'unapproved'}));
 assert.throws(()=>expectedStudyLicense({...study,license:'CC0'}));
 for(const s of seed.studies)assert.ok(expectedStudyLicense(s));
 assert.deepEqual([...STUDY_IDS].sort(),seed.studies.map(s=>s.studyId).sort());
});

test('approved collaborator registry excludes retired Loburg and retains per-study credit',()=>{
 const added=['8740141174','8739749420','8702046608','8739832651','3883692006','1176017658','8732924035','927364554','2204484313'];
 assert.equal(seed.studies.length,17);
 assert.ok(!seed.studies.some(s=>s.studyId==='10449318'));
 assert.ok(!seed.birds.some(b=>b.studyId==='10449318'));
 for(const id of added){const s=seed.studies.find(s=>s.studyId===id);assert.equal(expectedStudyLicense(s),'CUSTOM');assert.equal(s.eventPartition,'individual');assert.ok(s.attribution);assert.ok(s.sourceUrl.includes(id));}
 const rules=JSON.parse(readFileSync(new URL('../data/rules.json',import.meta.url)));
 assert.deepEqual(rules.approvedMovebankStudyIds.map(String).sort(),seed.studies.map(s=>s.studyId).sort());
});
