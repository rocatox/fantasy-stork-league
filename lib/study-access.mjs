// CUSTOM access is approved for this specific study only; unknown licenses fail closed.
export function expectedStudyLicense(study){
 if(String(study.studyId)==='247772625'&&study.license==='Collaborator permission — custom terms')return 'CUSTOM';
 if(study.license==='CC BY 4.0')return 'CC_BY';
 if(study.license==='CC BY-NC 4.0')return 'CC_BY_NC';
 throw Error('Study license is not approved');
}
