from pathlib import Path
from PIL import Image,ImageDraw
import numpy as np,json
rng=np.random.default_rng(7);out={};sheet=Image.new('RGB',(800,8*100),'white')
for idx,p in enumerate(sorted(Path('public/stork-portraits').glob('*.webp'))):
 im=Image.open(p).convert('RGB');a=np.array(im).astype(float);sat=(a.max(2)-a.min(2))/(a.max(2)+1);delta=np.sqrt(((a[1:,1:]-a[:-1,:-1])**2).sum(2));mask=(delta>55)&(sat[1:,1:]>.35)&(sat[:-1,:-1]>.35);ys,xs=np.where(mask);pts=np.column_stack([xs+1,ys+1]);pts=pts[(pts[:,1]<190)&(pts[:,1]>4)&(pts[:,0]>4)&(pts[:,0]<252)];best=None;score=-1
 for _ in range(2500):
  if len(pts)<3:break
  q=pts[rng.choice(len(pts),3,replace=False)];A=2*(q[1:]-q[0]);b=(q[1:]**2).sum(1)-(q[0]**2).sum()
  try:c=np.linalg.solve(A,b)
  except np.linalg.LinAlgError:continue
  r=np.linalg.norm(q[0]-c)
  if not(100<c[0]<155 and 85<c[1]<150 and 85<r<124):continue
  near=np.abs(np.linalg.norm(pts-c,axis=1)-r)<2.4
  # Prefer coverage around the circumference over dense edge texture.
  ang=np.arctan2(pts[near,1]-c[1],pts[near,0]-c[0]);bins=len(np.unique((ang*36/(2*np.pi)).astype(int)));v=bins+near.sum()/200
  if v>score:best=(c,r);score=v
 if best is None:best=(np.array([128.,113.]),106.)
 c,r=best;near=np.abs(np.linalg.norm(pts-c,axis=1)-r)<3;q=pts[near];A=np.column_stack([2*q[:,0],2*q[:,1],np.ones(len(q))]);b=(q*q).sum(1);fit=np.linalg.lstsq(A,b,rcond=None)[0];cx,cy=fit[:2];radius=np.sqrt(fit[2]+cx*cx+cy*cy)
 out[str(idx+1)]=[round(cx,2),round(cy,2),round(radius,2)]
 draw=ImageDraw.Draw(im);draw.ellipse((cx-radius,cy-radius,cx+radius,cy+radius),outline='lime',width=2);sheet.paste(im.resize((96,96)),((idx%8)*100,(idx//8)*100))
Path('data/portrait-circles.json').write_text(json.dumps(out,separators=(',',':')))
sheet.save('../../work/portrait-circles.jpg')
