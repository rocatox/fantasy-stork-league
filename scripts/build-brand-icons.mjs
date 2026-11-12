import sharp from 'sharp';
import {writeFile,copyFile} from 'node:fs/promises';
// Extract the user's original, unsimplified option 1 without redrawing its bird.
const master=await sharp('assets/brand/original-concept-board.png').extract({left:99,top:29,width:478,height:488}).resize(512,512).png().toBuffer();
const circle=Buffer.from('<svg width="512" height="512"><circle cx="256" cy="256" r="250" fill="white"/></svg>');
const logo=await sharp(master).composite([{input:circle,blend:'dest-in'}]).png().toBuffer();
await writeFile('assets/brand/spread-wing-master.png',logo);
for(const size of [16,32,48,96,192,512])await sharp(logo).resize(size,size).png().toFile(`public/spread-wing-${size}-v1.png`);
// Installed icons have opaque navy padding; the maskable bird fits inside its safe circle.
for(const [name,size,scale]of [['apple',180,.92],['maskable',512,.8]]){
 const inner=await sharp(logo).resize(Math.round(size*scale),Math.round(size*scale)).png().toBuffer();
 await sharp({create:{width:size,height:size,channels:4,background:'#202b4d'}}).composite([{input:inner,gravity:'center'}]).png().toFile(`public/spread-wing-${name}-${size}-v1.png`);
}
const images=await Promise.all([16,32,48].map(n=>sharp(logo).resize(n,n).png().toBuffer()));
const header=Buffer.alloc(6+16*images.length);header.writeUInt16LE(1,2);header.writeUInt16LE(images.length,4);let offset=header.length;
images.forEach((b,i)=>{const n=[16,32,48][i],p=6+i*16;header[p]=n;header[p+1]=n;header.writeUInt16LE(1,p+4);header.writeUInt16LE(32,p+6);header.writeUInt32LE(b.length,p+8);header.writeUInt32LE(offset,p+12);offset+=b.length;});
await writeFile('public/favicon.ico',Buffer.concat([header,...images]));
await writeFile('public/favicon.svg',`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><image width="512" height="512" href="data:image/png;base64,${logo.toString('base64')}"/></svg>`);
await copyFile('public/spread-wing-192-v1.png','public/icon-192.png');await copyFile('public/spread-wing-512-v1.png','public/icon-512.png');

