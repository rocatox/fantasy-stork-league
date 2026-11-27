import test from 'node:test';
import assert from 'node:assert/strict';
import {birdName} from '../lib/bird-name.mjs';
import {explorerBirds,compareBirds} from '../lib/map-birds.mjs';
test('display names remove tag metadata but preserve distinguishing place numbers',()=>{
 for(const [raw,expected] of [
 ['MICHEL (www.cigognesdesaintonge)','Michel'],['PHILIBERT (www.cigognesdesaintonge.com)','Philibert'],
 ['Alex 10195 ACW90','Alex'],['Mose XA122 (3994)','Mose'],['Kiki 9696 E0717','Kiki'],
 ['WHST-noband03-Hamburg','Hamburg 3'],['WHST-noband14-Hamburg','Hamburg 14'],
 ['Frensdorf I -3 (AHH07, 14057)','Frensdorf I-3'],['Frensdorf I -2 (AHH06, 14056)','Frensdorf I-2'],
 ['Frensdorf II -1 (AHH08, 14058)','Frensdorf II-1'],['Wingersdorf3 (AEH99, 12176)','Wingersdorf 3'],
 ['Schweizerried 2 / DER AU831 (eobs3984)','Schweizerried 2'],['Walsdorf1-2024 (AHH10, 12182)','Walsdorf 1-2024'],
 ['  Place   003  ','Place 3'],['Mary-Jane','Mary-Jane']]) assert.equal(birdName(raw),expected);
});

test('display names use Unicode title case across words and hyphens',()=>{
 for(const [raw,expected] of [
  ['BERNARD','Bernard'],['SYBELLE','Sybelle'],['THÉIA','Théia'],
  ['JEAN-CLAUDE','Jean-Claude'],['mary-jANE','Mary-Jane'],["O’NEIL","O’Neil"],
  ['DR. FUNK','Dr. Funk'],['WHST-noband03-HAMBURG','Hamburg 3'],
  ['frensdorf ii-1','Frensdorf II-1'],['LIV','Liv'],['','']
 ])assert.equal(birdName(raw),expected);
});
test('clean names and original identifiers remain searchable and numbers sort naturally',()=>{
 const a={id:'a',name:'WHST-noband03-Hamburg'},b={id:'b',name:'WHST-noband14-Hamburg'};
 assert.deepEqual(explorerBirds([a,b],{only:false,query:'Hamburg 3'}),[a]);
 assert.deepEqual(explorerBirds([a,b],{only:false,query:'noband03'}),[a]);
 assert.ok(compareBirds(a,b,'name')<0);
 assert.equal(a.name,'WHST-noband03-Hamburg');
});

test('ring and transmitter suffixes are removed without truncating compound names',()=>{
 for(const [raw,expected] of [
  ['Chuchu AHA16 10138 (30CF095)','Chuchu'],['Chuchu Aha 16 10138','Chuchu'],
  ['Gudrun AKL13 10187 (30CF0AE)','Gudrun'],['Gudrun Akl 13 10187','Gudrun'],
  ['Lou AFV93 10122 (30CF09C)','Lou'],['Lou Afv 93 10122','Lou'],
  ['Wendelin A6Y46 7998','Wendelin'],['Wendelin A 6Y 46 7998','Wendelin'],
  ['Heidi A9V51 (eobs 7994)','Heidi'],['Maja ABU51 eobs (12163)','Maja'],
  ['Däumling AHT84 15329','Däumling'],['Lola-Marie 12326 AKN38','Lola-Marie'],
  ['Günter von Störzig 12339 AJE23','Günter Von Störzig'],
  ['Anita aus Seiboldsdorf 12573 ALV82','Anita Aus Seiboldsdorf'],
  ['Mary Jane','Mary Jane'],['St Mary 123','St Mary 123'],['Saint Mary123','Saint Mary 123'],['Frensdorf II-1','Frensdorf II-1'],
  ['2023 Cheine2 BA047441 colour ring X1K19 (e-obs7986)','Cheine 2'],
  ['Basuto 2023 Mahlsdorf BA046621 colour ring X52K6 (e-obs7962)','Basuto'],
  ['Claus DEH BA040928 colour ring XM973 (e-obs9651)','Claus'],
  ['Seppl 2023 Siedenlangenbeck2 BA047430 colour Ring X04P2 (e-obs7019)','Seppl'],
  ['Trabi DEH BA045342 colour ring X2A73 (e-obs7981)','Trabi']
 ])assert.equal(birdName(raw),expected,raw);
});

test('numeric-only names get stable aliases and retain their exact original identifier',()=>{
 assert.equal(birdName('10111'),'Jack (10111)');
 assert.equal(birdName('10111 (30CF090) AFR55'),'Jack (10111)');
 assert.equal(birdName('00010111'),'Jack (00010111)');
 assert.equal(birdName('Jack (10111)'),'Jack (10111)');
 assert.equal(birdName('10113'),'Robin (10113)');
 assert.equal(birdName('10152'),'Pip (10152)');
 assert.equal(birdName('10159'),'Avery (10159)');
 for(const value of ['10113','10152','10159','900719925474099312345']){
  assert.match(birdName(value),new RegExp('^[A-Z][a-z]+ \\('+value+'\\)$'));
  assert.equal(birdName(birdName(value)),birdName(value));
 }
 const birds=[{id:'one',name:'10111 (30CF090) AFR55'},{id:'two',name:'Chuchu AHA16 10138 (30CF095)'}];
 for(const query of ['Jack','10111','AFR55'])assert.deepEqual(explorerBirds(birds,{only:false,query}),[birds[0]]);
 for(const query of ['Chuchu','AHA16','10138'])assert.deepEqual(explorerBirds(birds,{only:false,query}),[birds[1]]);
 assert.equal(birds[0].name,'10111 (30CF090) AFR55');
});

