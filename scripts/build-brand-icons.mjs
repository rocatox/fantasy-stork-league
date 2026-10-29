import sharp from 'sharp';
import {writeFile,copyFile} from 'node:fs/promises';
// Geometry follows the original approved Migration Arrow, without generated texture.
const body='M151 182 H428 Q440 182 451 195 L680 429 Q690 439 700 429 L850 276 Q879 249 922 249 H969 V354 L908 378 Q888 386 874 402 L580 706 Q557 730 526 741 L283 810 Q256 818 265 795 L445 593 Q454 583 445 572 L140 205 Q127 183 151 182 Z';
const beak='M982 249 L1120 288 L982 348 Z';
const shapes=(color)=>`<path fill="${color}" d="${body}"/><path fill="#c29a34" d="${beak}"/>`;
const svg=(color,bg=false,mask=false)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1254 1254">${bg?'<path fill="#202b4d" d="M0 0h1254v1254H0z"/>':''}<g transform="${mask?'translate(125.4 125.4) scale(.8) ':''}translate(0 130)">${shapes(color)}</g></svg>`;
for(const [name,color] of [['navy','#202b4d'],['white','#ffffff']]) await writeFile(`public/migration-arrow-${name}-v1.svg`,svg(color));
const src=Buffer.from(svg('#ffffff',true));
for(const n of [16,32,48,180,192,256,512]) await sharp(src).resize(n,n).png().toFile(`public/migration-arrow-${n}-v1.png`);
await sharp(Buffer.from(svg('#ffffff',true,true))).resize(512,512).png().toFile('public/migration-arrow-maskable-512-v1.png');
const favicon=Buffer.from(svg('#202b4d'));
for(const n of [16,32,48]) await sharp(favicon).resize(n,n).png().toFile(`public/migration-arrow-favicon-${n}-v2.png`);
const images=await Promise.all([16,32,48].map(n=>sharp(favicon).resize(n,n).png().toBuffer()));
const header=Buffer.alloc(6+16*images.length);header.writeUInt16LE(1,2);header.writeUInt16LE(images.length,4);let offset=header.length;
images.forEach((b,i)=>{const n=[16,32,48][i],p=6+i*16;header[p]=n;header[p+1]=n;header.writeUInt16LE(1,p+4);header.writeUInt16LE(32,p+6);header.writeUInt32LE(b.length,p+8);header.writeUInt32LE(offset,p+12);offset+=b.length;});
await writeFile('public/favicon.ico',Buffer.concat([header,...images]));
await copyFile('public/migration-arrow-192-v1.png','public/icon-192.png');await copyFile('public/migration-arrow-512-v1.png','public/icon-512.png');
await writeFile('public/favicon.svg',svg('#202b4d'));
