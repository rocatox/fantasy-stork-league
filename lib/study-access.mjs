// CUSTOM access is approved for the explicitly approved studies only; unknown licenses fail closed.
export function expectedStudyLicense(study){
 if(["247772625","8740141174","8739749420","8702046608","8739832651","3883692006","1176017658","8732924035","927364554","2204484313"].includes(String(study.studyId))&&study.license==='Collaborator permission — custom terms')return 'CUSTOM';
 if(study.license==='CC BY 4.0')return 'CC_BY';
 if(study.license==='CC BY-NC 4.0')return 'CC_BY_NC';
 throw Error('Study license is not approved');
}
