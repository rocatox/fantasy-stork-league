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
